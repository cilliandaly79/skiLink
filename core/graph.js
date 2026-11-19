/* skiLink core — trail network & routing
   Builds a routable graph from OpenStreetMap runs/lifts + elevation, speed model, Dijkstra routing, directions.
   Platform-independent: no DOM, no map library, no browser storage. Loads as a plain <script>
   (adds to window.SkiCore) or via require()/import in React Native / Node. */
(function (root, factory) {
  const deps = typeof module === 'object' && module.exports ? Object.assign({}, require('./resorts.js')) : root.SkiCore;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkiCore = Object.assign(root.SkiCore || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SK) {
'use strict';
const {LIFT_TYPES, RANK, liftType} = SK;

function buildGraph(osm, bbox){
  const lat0 = (bbox[0] + bbox[2]) / 2, lon0 = (bbox[1] + bbox[3]) / 2;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const coord = new Map(), ways = [], areas = [];

  for (const e of osm.elements){
    const t = e.tags || {};
    if (e.type !== 'way' || !e.geometry){ if (t.landuse === 'winter_sports' && t.name) areas.push(t.name); continue; }
    let kind = null;
    const nm = t.name || '';
    if (t.disused === 'yes' || t.abandoned === 'yes' || t.demolished === 'yes' || t['piste:abandoned'] === 'yes' ||
        /stillgelegt|abgebaut|disused|abandoned|dismantled|désaffecté|dismesso/i.test(nm)) continue;   // decommissioned
    if (t['piste:type'] === 'downhill' && !t.aerialway){
      if (t.area === 'yes' || (e.nodes[0] === e.nodes[e.nodes.length-1] && e.nodes.length > 3)) continue; // piste areas
      kind = 'run';
    } else if (liftType(t)) kind = 'lift';
    if (!kind || e.nodes.length < 2) continue;
    e.nodes.forEach((id, i) => coord.set(id, e.geometry[i]));
    ways.push({id:e.id, kind, tags:t, ltype: kind === 'lift' ? liftType(t) : null, nodes:e.nodes.slice(), name:t.name || t['piste:name'] || '',
      rank: kind === 'run' ? (RANK[t['piste:difficulty']] || 3) : 0, unknownDiff: kind === 'run' && !RANK[t['piste:difficulty']]});
  }
  if (!ways.length) return null;

  // count how many ways touch each node
  const uses = new Map();
  ways.forEach(w => new Set(w.nodes).forEach(id => uses.set(id, (uses.get(id) || 0) + 1)));
  const split = new Set();
  uses.forEach((n, id) => { if (n > 1) split.add(id); });
  ways.forEach(w => { split.add(w.nodes[0]); split.add(w.nodes[w.nodes.length-1]); });

  // snap loose ends to the nearest vertex of another way
  const CELL = 70, grid = new Map(), cellKey = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
  ways.forEach((w, wi) => w.nodes.forEach(id => {
    const [lat, lon] = coord.get(id), [x, y] = xy(lat, lon), k = cellKey(x, y);
    if (!grid.has(k)) grid.set(k, []); grid.get(k).push({id, wi, x, y});
  }));
  const links = [];
  ways.forEach((w, wi) => [w.nodes[0], w.nodes[w.nodes.length-1]].forEach(end => {
    if (uses.get(end) > 1) return;
    const R = w.kind === 'lift' ? 70 : 40, [x, y] = xy(...coord.get(end));
    let best = null, bd = R;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
      for (const v of grid.get((Math.floor(x / CELL) + dx) + ',' + (Math.floor(y / CELL) + dy)) || []){
        if (v.wi === wi) continue;
        const d = Math.hypot(v.x - x, v.y - y);
        if (d < bd){ bd = d; best = v; }
      }
    }
    if (best){ split.add(best.id); links.push([end, best.id, bd]); }
  }));

  return {ways, coord, split, links, areas, xy, lat0, lon0};
}

function finishGraph(pre, ele){
  const {ways, coord, split, links, xy} = pre;
  const E = (id) => ele[id] ?? null;
  const hasEle = Object.keys(ele).length > 0;

  // orient each way: runs downhill, lifts uphill
  ways.forEach(w => {
    const a = E(w.nodes[0]), b = E(w.nodes[w.nodes.length-1]);
    if (a == null || b == null) return;
    if ((w.kind === 'run' && b - a > 15) || (w.kind === 'lift' && a - b > 15)){ w.nodes.reverse(); w.reversed = true; }
  });

  const edges = [], out = new Map(), inn = new Map(), nodes = new Map();
  const addNode = id => { if (!nodes.has(id)){ const [lat, lon] = coord.get(id); nodes.set(id, {id, lat, lon, ele: E(id)}); } };
  const addEdge = e => {
    const pts = e.ids.map(id => coord.get(id)), cum = [0];
    for (let i = 1; i < pts.length; i++){ const p = xy(...pts[i-1]), q = xy(...pts[i]); cum.push(cum[i-1] + Math.hypot(q[0]-p[0], q[1]-p[1])); }
    const h = cum[cum.length-1]; if (h < 1) return;
    const ea = E(e.from), eb = E(e.to);
    const dz = ea != null && eb != null ? eb - ea : 0;
    Object.assign(e, {pts, cum, h, eleA:ea, eleB:eb, length: Math.hypot(h, dz), vert: Math.max(0, -dz), slope: ea != null && eb != null ? Math.max(0, -dz) / h : 0.2});   // unknown height → typical slope
    addNode(e.from); addNode(e.to);
    e.idx = edges.length; edges.push(e);
    if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e);
    if (!inn.has(e.to)) inn.set(e.to, []); inn.get(e.to).push(e);
  };

  ways.forEach(w => {
    const lt = LIFT_TYPES[w.ltype];
    let speed = 0, wait = 0, label = '';
    if (w.kind === 'lift'){
      speed = lt.speed; wait = lt.wait; label = lt.label;
      if (w.tags.aerialway === 'chair_lift'){ const det = w.tags['aerialway:detachable']; speed = det === 'no' ? 2.3 : det === 'yes' ? 5 : speed; }
      w.duration = parseDuration(w.tags['aerialway:duration']);
    }
    let s = 0;
    for (let i = 1; i < w.nodes.length; i++){
      if (split.has(w.nodes[i]) || i === w.nodes.length - 1){
        addEdge({kind:w.kind, way:w, wayId:w.id, name:w.name, rank:w.rank, from:w.nodes[s], to:w.nodes[i], ids:w.nodes.slice(s, i+1), speed, wait, typeLabel:label});
        s = i;
      }
    }
  });
  // lift speed from the tagged ride duration when OSM has it
  const liftLen = new Map();
  edges.filter(e => e.kind === 'lift').forEach(e => liftLen.set(e.wayId, (liftLen.get(e.wayId) || 0) + e.length));
  edges.filter(e => e.kind === 'lift' && e.way.duration).forEach(e => e.speed = Math.min(12, Math.max(1, liftLen.get(e.wayId) / e.way.duration)));
  // short sections often look flat on a ~90 m elevation model: use the whole run's average steepness too
  if (hasEle){
    const agg = new Map();
    edges.filter(e => e.kind === 'run').forEach(e => { const a = agg.get(e.wayId) || {h:0, v:0}; a.h += e.h; a.v += e.vert; agg.set(e.wayId, a); });
    edges.filter(e => e.kind === 'run').forEach(e => { const a = agg.get(e.wayId); e.slope = Math.max(e.slope, 0.85 * a.v / Math.max(a.h, 1)); });
  }
  // enclosed lifts (cable cars, gondolas, funiculars, trains) can also be ridden down
  const RIDE_DOWN = new Set(['cable_car', 'gondola', 'mixed_lift', 'funicular', 'rack_railway']);
  edges.filter(e => e.kind === 'lift' && RIDE_DOWN.has(e.way.ltype)).forEach(e => {
    addEdge({kind:'lift', down:true, way:e.way, wayId:e.wayId + '-down', name:e.name, rank:0, from:e.to, to:e.from,
      ids:e.ids.slice().reverse(), speed:e.speed, wait:e.wait / 2, typeLabel:e.typeLabel});
  });
  links.forEach(([a, b, d]) => {
    if (d < 1){ return; }
    addEdge({kind:'link', from:a, to:b, ids:[a, b], name:'', rank:0});
    addEdge({kind:'link', from:b, to:a, ids:[b, a], name:'', rank:0});
  });

  // Sectors that only meet in a village (e.g. Zermatt's valley stations) need a short walk.
  // Join way endpoints of *different* components that are close and at a similar height.
  const pre1 = largestSCC([...nodes.keys()], out, inn).comp;
  const WR = 500, wgrid = new Map(), wk = (x, y) => Math.floor(x / WR) + ',' + Math.floor(y / WR);
  const outDeg = id => (out.get(id) || []).length, inDeg = id => (inn.get(id) || []).length;
  const deadEnd = new Set(), source = new Set();
  nodes.forEach((n, id) => { if (!outDeg(id)) deadEnd.add(id); if (!inDeg(id)) source.add(id); });
  const ends = [...new Set(ways.flatMap(w => [w.nodes[0], w.nodes[w.nodes.length-1]]))].filter(id => nodes.has(id))
    .map(id => { const [x, y] = xy(...coord.get(id)); return {id, x, y}; });
  ends.forEach(p => { const k = wk(p.x, p.y); if (!wgrid.has(k)) wgrid.set(k, []); wgrid.get(k).push(p); });
  const walked = new Set();
  // valley stations of different sectors are usually a short walk apart through the village
  // and any two lift stations close together (e.g. funicular top → gondola bottom) are a quick transfer
  const liftUp = edges.filter(e => e.kind === 'lift' && !e.down);
  const valley = new Set(liftUp.map(e => e.from)), stations = new Set(liftUp.flatMap(e => [e.from, e.to]));
  const VR = 1500, vlist = [...stations].map(id => { const [x, y] = xy(...coord.get(id)); return {id, x, y, valley: valley.has(id)}; });
  vlist.forEach(p => vlist.forEach(q => {
    if (p.id >= q.id || pre1.get(p.id) === pre1.get(q.id)) return;
    const d = Math.hypot(q.x - p.x, q.y - p.y), za = E(p.id), zb = E(q.id);
    const R = p.valley && q.valley ? VR : 200;
    if (d > R || d < 1 || (za != null && zb != null && Math.abs(za - zb) > (R === VR ? 80 : 50))) return;
    [[p.id, q.id], [q.id, p.id]].forEach(([a, b]) => { const k = a + '>' + b; if (!walked.has(k)){ walked.add(k); addEdge({kind:'link', walk:true, from:a, to:b, ids:[a, b], name:'', rank:0}); } });
  }));
  ends.forEach(p => {
    if (!deadEnd.has(p.id) && !source.has(p.id)) return;   // only stranded ends need a walk
    const bestBy = new Map();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
      for (const q of wgrid.get((Math.floor(p.x / WR) + dx) + ',' + (Math.floor(p.y / WR) + dy)) || []){
        const c = pre1.get(q.id); if (c === pre1.get(p.id)) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y); if (d > WR || d < 1) continue;
        const za = E(p.id), zb = E(q.id); if (za != null && zb != null && Math.abs(za - zb) > 80) continue;
        if (!bestBy.has(c) || bestBy.get(c).d > d) bestBy.set(c, {q, d});
      }
    }
    bestBy.forEach(({q}) => {
      const walk = (a, b) => { const k = a + '>' + b; if (walked.has(k)) return; walked.add(k);
        addEdge({kind:'link', walk:true, from:a, to:b, ids:[a, b], name:'', rank:0}); };
      if (deadEnd.has(p.id)) walk(p.id, q.id);   // run ends here → walk on
      if (source.has(p.id)) walk(q.id, p.id);    // lift station nothing leads to → walk there
    });
  });

  // keep the largest strongly-connected component for routing & simulation
  const {comp, best} = largestSCC([...nodes.keys()], out, inn);
  edges.forEach(e => { e.main = comp.get(e.from) === best && comp.get(e.to) === best; e.cost = edgeCost(e, 1); });
  return {edges, out, inn, nodes, ways, hasEle, mainNodes: [...nodes.keys()].filter(id => comp.get(id) === best)};
}

function parseDuration(v){
  if (!v) return 0;
  let m;
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(v))) return +m[1] * 60;
  if ((m = /^(\d+):(\d{1,2})$/.exec(v))) return +m[1] * 60 + +m[2];
  if ((m = /^PT(?:(\d+)M)?(?:(\d+)S)?$/.exec(v))) return (+m[1] || 0) * 60 + (+m[2] || 0);
  return 0;
}

function largestSCC(ids, out, inn){
  const seen = new Set(), order = [];
  for (const s of ids){
    if (seen.has(s)) continue;
    seen.add(s); const st = [[s, 0]];
    while (st.length){
      const top = st[st.length-1], es = out.get(top[0]) || [];
      if (top[1] < es.length){ const t = es[top[1]++].to; if (!seen.has(t)){ seen.add(t); st.push([t, 0]); } }
      else { order.push(top[0]); st.pop(); }
    }
  }
  const comp = new Map(); let best = -1, bestSize = 0, c = 0;
  for (let i = order.length - 1; i >= 0; i--){
    const s = order[i]; if (comp.has(s)) continue;
    let size = 0; const st = [s]; comp.set(s, c);
    while (st.length){ const u = st.pop(); size++; for (const e of inn.get(u) || []) if (!comp.has(e.from)){ comp.set(e.from, c); st.push(e.from); } }
    if (size > bestSize){ bestSize = size; best = c; }
    c++;
  }
  return {comp, best};
}

/* =========================================================================
   SPEEDS, ROUTING
   ========================================================================= */
// cruising speed on a run depends on its steepness (from DEM) and the skier
function runSpeed(e, factor){ return Math.min(75, Math.max(12, 18 + 90 * Math.min(e.slope, 0.6))) * factor / 3.6; }
function edgeCost(e, factor){
  if (e.kind === 'lift') return e.length / e.speed + (e.wait || 0) * 60;
  if (e.kind === 'link') return e.walk ? e.h / 1.2 + 30 : e.length / 2 + 5;
  return e.length / runSpeed(e, factor);
}
function heapPush(h, x){ h.push(x); let i = h.length - 1; while (i){ const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function heapPop(h){
  const top = h[0], last = h.pop();
  if (h.length){ h[0] = last; let i = 0; for (;;){ const l = 2*i+1, r = l+1; let m = i;
    if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r;
    if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
  return top;
}
function dijkstra(G, start, goal, maxRank){
  const dist = new Map([[start, 0]]), prev = new Map(), h = [[0, start]];
  while (h.length){
    const [d, u] = heapPop(h);
    if (d > dist.get(u)) continue;
    if (u === goal) break;
    for (const e of G.out.get(u) || []){
      if (!e.main || (e.kind === 'run' && e.rank > maxRank) || (e.shut && G.live && G.live.enforce)) continue;
      const nd = d + e.cost;
      if (nd < (dist.has(e.to) ? dist.get(e.to) : Infinity)){ dist.set(e.to, nd); prev.set(e.to, e); heapPush(h, [nd, e.to]); }
    }
  }
  if (!dist.has(goal)) return null;
  const edges = [];
  for (let n = goal; n !== start; n = prev.get(n).from) edges.unshift(prev.get(n));
  return {edges, time: dist.get(goal)};
}

function posAt(e, d){
  const c = e.cum, hd = Math.max(0, Math.min(e.h, d * e.h / e.length));
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1){ const m = (lo + hi) >> 1; if (c[m] <= hd) lo = m; else hi = m; }
  const t = (hd - c[lo]) / ((c[hi] - c[lo]) || 1), p = e.pts[lo], q = e.pts[hi];
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}
const eleAt = (e, d) => e.eleA == null ? null : e.eleA + (e.eleB - e.eleA) * Math.min(1, d / e.length);

function nodeLabel(G, id){
  const outs = G.out.get(id) || [], ins = G.inn.get(id) || [];
  const lo = outs.find(e => e.kind === 'lift' && !e.down), li = ins.find(e => e.kind === 'lift' && !e.down);
  if (lo) return `bottom of ${lo.name || lo.typeLabel}`;
  if (li) return `top of ${li.name || li.typeLabel}`;
  const names = [...new Set([...outs, ...ins].filter(e => e.kind === 'run' && e.name).map(e => e.name))];
  if (names.length >= 2) return `${names[0]} / ${names[1]}`;
  if (names.length === 1) return `on ${names[0]}`;
  return 'trail junction';
}
const edgeName = e => e.kind === 'link' ? 'short traverse' : e.name || (e.kind === 'lift' ? 'unnamed ' + e.typeLabel.toLowerCase() : 'unnamed run');

function buildSteps(edges){
  const steps = [];
  for (const e of edges){
    const last = steps[steps.length - 1];
    if (e.kind === 'link' && e.walk && e.h >= 60){
      if (last && last.kind === 'walk'){ last.time += e.cost; last.len += e.h; }
      else steps.push({kind:'walk', name:'', time:e.cost, len:e.h, vert:0, rank:0});
      continue;
    }
    if (e.kind === 'link'){ if (last){ last.time += e.cost; last.linkLen = (last.linkLen || 0) + e.length; } else steps.push({kind:'link', name:'', time:e.cost, len:e.length, vert:0, rank:0}); continue; }
    const key = e.kind + '|' + (e.name || '#' + e.wayId);
    if (last && last.key === key){ last.time += e.cost; last.len += e.length; last.vert += e.vert; last.rank = Math.max(last.rank, e.rank); continue; }
    steps.push({key, kind:e.kind, name:edgeName(e) + (e.down ? ' down' : ''), rank:e.rank, time:e.cost, len:e.length, vert:e.vert, typeLabel:e.typeLabel, wait:e.wait, first:e});
  }
  return steps;
}

return {buildGraph, finishGraph, parseDuration, largestSCC, runSpeed, edgeCost, dijkstra, posAt, eleAt, nodeLabel, edgeName, buildSteps};
});
