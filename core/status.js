/* skiLink core — live lift & run status matching
   Matches names from resort status feeds (Intermaps, Lumiplan, infosnow…) to OpenStreetMap lifts and runs.
   Platform-independent: no DOM, no map library, no browser storage. Loads as a plain <script>
   (adds to window.SkiCore) or via require()/import in React Native / Node. */
(function (root, factory) {
  const deps = {};
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkiCore = Object.assign(root.SkiCore || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SK) {
'use strict';
const STOP = new Set(['the', 'de', 'des', 'du', 'la', 'le', 'les', 'di', 'del', 'und', 'and', 'am', 'im', 'nr', 'no']);
const LIFT_WORDS = /\b(\d*(eub|ksb|kseb|dsb|sb|sl|tb|seb|gb|pb|lsb|kb|stb|ub|tsd|tsf|tc|tk|tph|tlc|ts|fun)|telecabine|telesiege|teleski|telepherique|funiculaire|chairlift|chair|gondola|express|sesselbahn|gondelbahn|seilbahn|schlepplift|kabinenbahn|lift|piste|skiroute|run|slope|ski|route)\b/g;
const normName = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ß/g, 'ss').replace(LIFT_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(t => t && !STOP.has(t));
// lift codes ("A1", "C30") and section numerals ("I", "II") often appear on only one side
const isCode = t => /^([a-z]?\d+[a-z]?|i{1,3}|iv|v|vi)$/.test(t);
function nameScore(a, b){
  const raw = nameScoreRaw(a, b);
  const a2 = a.filter(t => !isCode(t)), b2 = b.filter(t => !isCode(t));
  return (a2.length === a.length && b2.length === b.length) ? raw : Math.max(raw, 0.92 * nameScoreRaw(a2, b2));
}
function nameScoreRaw(a, b){
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b); let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
  let sc = 0.5 * inter / Math.min(A.size, B.size) + 0.5 * inter / Math.max(A.size, B.size);
  const ja = a.join(''), jb = b.join('');
  if (ja === jb) return 1;
  if (ja.length > 4 && jb.length > 4 && (ja.includes(jb) || jb.includes(ja))) sc = Math.max(sc, 0.8);
  return sc;
}
// match each OSM lift/run (by name, or by piste number) to a feed entry
function matchStatus(items, ways, kind){
  const cands = items.map(it => ({it, toks: normName(it.name), num: (it.number || (/^(\d{1,3}[a-z]?)\b/i.exec(it.name) || [])[1] || '').toLowerCase()}));
  let matched = 0;
  ways.filter(w => w.kind === kind).forEach(w => {
    const ref = String(w.tags['piste:ref'] || w.tags.ref || '').toLowerCase();
    const toks = normName(w.name);
    let best = null, bs = 0;
    for (const c of cands){
      let sc = nameScore(toks, c.toks);
      if (ref && c.num && ref === c.num) sc = Math.max(sc, toks.length ? 0.7 + 0.3 * sc : 0.9);
      if (sc > bs){ bs = sc; best = c; }
    }
    w.live = bs >= 0.6 ? best.it.status : null;
    if (w.live) matched++;
  });
  return matched;
}

return {normName, nameScore, matchStatus};
});
