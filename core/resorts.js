/* skiLink core — resorts & reference data
   Preset resorts, lift-pass areas, lift types, difficulty ranks/colour schemes, OpenStreetMap query.
   Platform-independent: no DOM, no map library, no browser storage. Loads as a plain <script>
   (adds to window.SkiCore) or via require()/import in React Native / Node. */
(function (root, factory) {
  const deps = {};
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkiCore = Object.assign(root.SkiCore || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SK) {
'use strict';
const RESORTS = [   // keep in sync with tools/fetch_resorts.py
  {id:'zermatt',    name:'Zermatt',               country:'CH', region:'Alps', bbox:[45.920,7.660,46.030,7.800], passes:['matterhorn']},
  {id:'stanton',    name:'St. Anton am Arlberg',  country:'AT', region:'Alps', bbox:[47.100,10.150,47.170,10.300], passes:['arlberg']},
  {id:'valthorens', name:'Val Thorens',           country:'FR', region:'Alps', bbox:[45.260,6.530,45.330,6.620], passes:['3vallees']},
  {id:'verbier',    name:'Verbier',               country:'CH', region:'Alps', bbox:[46.060,7.180,46.130,7.330], passes:['4vallees']},
  {id:'ischgl',     name:'Ischgl · Samnaun',      country:'AT', region:'Alps', bbox:[46.930,10.250,47.020,10.380]},
  {id:'solden',     name:'Sölden',                country:'AT', region:'Alps', bbox:[46.900,10.880,46.990,11.030]},
  {id:'kitzbuehel', name:'Kitzbühel',             country:'AT', region:'Alps', bbox:[47.380,12.300,47.460,12.420], passes:['kitzski']},
  {id:'courchevel', name:'Courchevel & Méribel',  country:'FR', region:'Alps', bbox:[45.360,6.540,45.440,6.670], passes:['3vallees']},
  {id:'jackson',    name:'Jackson Hole',          country:'US', region:'Rest of the world', bbox:[43.565,-110.885,43.615,-110.800]},
  {id:'whistler',   name:'Whistler Blackcomb',    country:'CA', region:'Rest of the world', bbox:[50.030,-123.000,50.130,-122.850]},
  {id:'vail',       name:'Vail',                  country:'US', region:'Rest of the world', bbox:[39.570,-106.450,39.650,-106.300]},
  {id:'niseko',     name:'Niseko United',         country:'JP', region:'Rest of the world', bbox:[42.820,140.620,42.890,140.720]},
];
// extra data pieces (data/<id>.json) that join resorts into their lift-pass areas
const PARTS = {
  '3v-belleville':[45.330,6.480,45.365,6.680], 'arlberg-lech':[47.165,10.050,47.270,10.250],
  '4v-nendaz':[46.120,7.250,46.210,7.420], 'cervinia':[45.850,7.580,45.950,7.720], 'kitz-south':[47.300,12.300,47.385,12.470],
};
// lift-pass areas: one ticket, several linked resorts — loaded as one connected map
const PASSES = {
  '3vallees':   {id:'3vallees',   name:'Les 3 Vallées',          pass:'3 Vallées pass',   country:'FR', parts:['courchevel', 'valthorens', '3v-belleville'],
                 covers:'Courchevel · Méribel · Val Thorens · Les Menuires · Orelle'},
  'arlberg':    {id:'arlberg',    name:'Ski Arlberg',            pass:'Ski Arlberg pass', country:'AT', parts:['stanton', 'arlberg-lech'],
                 covers:'St. Anton · St. Christoph · Stuben · Lech · Zürs · Warth-Schröcken'},
  '4vallees':   {id:'4vallees',   name:'4 Vallées',              pass:'4 Vallées pass',   country:'CH', parts:['verbier', '4v-nendaz'],
                 covers:'Verbier · La Tzoumaz · Nendaz · Veysonnaz · Thyon'},
  'matterhorn': {id:'matterhorn', name:'Matterhorn Ski Paradise', pass:'International pass', country:'CH', parts:['zermatt', 'cervinia'],
                 covers:'Zermatt · Breuil-Cervinia · Valtournenche'},
  'kitzski':    {id:'kitzski',    name:'KitzSki',                pass:'KitzSki full area', country:'AT', parts:['kitzbuehel', 'kitz-south'],
                 covers:'Kitzbühel · Kirchberg · Jochberg · Pass Thurn'},
};
const partBbox = id => (RESORTS.find(r => r.id === id) || {}).bbox || PARTS[id];
Object.values(PASSES).forEach(p => {   // pass area = union of its pieces
  const bs = p.parts.map(partBbox);
  p.bbox = [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))];
  p.region = 'Alps'; p.isPass = true;
});
const findArea = id => RESORTS.find(r => r.id === id) || PASSES[id];
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// speed m/s, typical line in minutes
const LIFT_TYPES = {
  cable_car:{label:'Cable car', speed:8, wait:6}, gondola:{label:'Gondola', speed:5.5, wait:3},
  mixed_lift:{label:'Chair/gondola', speed:5, wait:2.5}, chair_lift:{label:'Chairlift', speed:4, wait:2},
  drag_lift:{label:'Drag lift', speed:3, wait:1}, 't-bar':{label:'T-bar', speed:3, wait:1}, 'j-bar':{label:'J-bar', speed:3, wait:1},
  platter:{label:'Platter', speed:3, wait:1}, rope_tow:{label:'Rope tow', speed:2, wait:0.5}, magic_carpet:{label:'Magic carpet', speed:1, wait:0.5},
  funicular:{label:'Funicular', speed:8, wait:5}, rack_railway:{label:'Mountain railway', speed:5, wait:8},
};
// OSM piste:difficulty -> internal rank
const RANK = {novice:1, easy:2, intermediate:3, advanced:4, expert:5, freeride:5, extreme:5};
// North America vs. Europe/rest-of-world colour conventions
const SCHEMES = {
  na: {1:{key:'green',label:'Easy',color:'#2a9d58'}, 2:{key:'green',label:'Easy',color:'#2a9d58'}, 3:{key:'blue',label:'Intermediate',color:'#1d6fe0'},
       4:{key:'black',label:'Advanced',color:'#1b1f24'}, 5:{key:'double',label:'Expert',color:'#1b1f24',dash:'7 5'},
       levels:[[2,'Easy only'],[3,'Up to blue'],[4,'Up to black'],[5,'Any terrain']]},
  eu: {1:{key:'green',label:'Beginner',color:'#2a9d58'}, 2:{key:'blue',label:'Easy',color:'#1d6fe0'}, 3:{key:'red',label:'Intermediate',color:'#d62828'},
       4:{key:'black',label:'Difficult',color:'#1b1f24'}, 5:{key:'free',label:'Freeride',color:'#e76f00',dash:'7 5'},
       levels:[[2,'Up to blue'],[3,'Up to red'],[4,'Up to black'],[5,'Any terrain']]},
};

const overpassQuery = b => `[out:json][timeout:120];(way["piste:type"="downhill"](${b});way["aerialway"](${b});way["railway"="funicular"](${b});way["railway"]["rack"](${b}););out body geom;wr["landuse"="winter_sports"]["name"](${b});out tags center;`;
// funiculars and cog railways (e.g. Zermatt's Sunnegga & Gornergrat) work like lifts
function liftType(t){
  if (LIFT_TYPES[t.aerialway]) return t.aerialway;
  if (t.railway === 'funicular') return 'funicular';
  if (t.railway && t.rack && t.rack !== 'no' && !['abandoned', 'disused', 'razed', 'construction', 'platform', 'station'].includes(t.railway)) return 'rack_railway';
  return null;
}

return {RESORTS, PARTS, PASSES, partBbox, findArea, OVERPASS, LIFT_TYPES, RANK, SCHEMES, overpassQuery, liftType};
});
