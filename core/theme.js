/* skiLink core — design tokens (single source of truth)
   Apple system palette (light + dark), type scale, radii, motion. The web app turns these into CSS
   variables (cssVariables); the native app uses the same values in StyleSheet / a theme provider.
   Platform-independent: plain data. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkiCore = Object.assign(root.SkiCore || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const colors = {
  light: {
    bg:'#f2f2f7', bg2:'#ffffff', bg3:'#f2f2f7', fill:'rgba(120,120,128,.12)', fill2:'rgba(120,120,128,.2)',
    label:'#000000', label2:'rgba(60,60,67,.62)', label3:'rgba(60,60,67,.32)', sep:'rgba(60,60,67,.16)',
    tint:'#007aff', green:'#34c759', red:'#ff3b30', orange:'#ff9500', indigo:'#5856d6',
    mat:'rgba(255,255,255,.74)', matSolid:'rgba(255,255,255,.97)', nav:'#1c1c1e',
  },
  dark: {
    bg:'#000000', bg2:'#1c1c1e', bg3:'#2c2c2e', fill:'rgba(118,118,128,.24)', fill2:'rgba(118,118,128,.32)',
    label:'#ffffff', label2:'rgba(235,235,245,.62)', label3:'rgba(235,235,245,.3)', sep:'rgba(84,84,88,.6)',
    tint:'#0a84ff', green:'#30d158', red:'#ff453a', orange:'#ff9f0a', indigo:'#5e5ce6',
    mat:'rgba(30,30,30,.72)', matSolid:'rgba(28,28,30,.97)', nav:'#2c2c2e',
  },
};
const shadows = {
  light: {shadow:'0 8px 28px rgba(0,0,0,.12)', shadowS:'0 1px 3px rgba(0,0,0,.06)'},
  dark:  {shadow:'0 8px 28px rgba(0,0,0,.5)',  shadowS:'0 1px 3px rgba(0,0,0,.4)'},
};
// iOS text styles (pt) with size-specific tracking (em): tight large titles, ~0 body, open small text
const type = {
  largeTitle:{size:34, weight:'700', tracking:-0.025, leading:1.1},
  title:     {size:28, weight:'700', tracking:-0.02,  leading:1.15},
  title3:    {size:20, weight:'600', tracking:-0.02,  leading:1.2},
  headline:  {size:17, weight:'600', tracking:-0.02,  leading:1.3},
  body:      {size:17, weight:'400', tracking:-0.02,  leading:1.4},
  callout:   {size:15, weight:'400', tracking:-0.01,  leading:1.4},
  footnote:  {size:13, weight:'400', tracking:0,      leading:1.35},
  caption:   {size:11.5, weight:'500', tracking:0.02, leading:1.3},
};
const radius = {card:14, control:10, button:14, pill:999, sheet:14, icon:9};
// motion (apple-design skill): critically damped by default; bounce only after a flick
const motion = {
  spring:     {dampingRatio:1.0, response:0.35},
  sheet:      {dampingRatio:0.8, response:0.3, decelerationRate:0.99, rubberBand:0.55,
               css:'cubic-bezier(.32,.72,0,1)', cssMs:500},
  press:      {scale:0.96, ms:80, releaseMs:160, css:'cubic-bezier(.23,1,.32,1)'},
};

const css = (name) => '--' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const block = (obj) => Object.entries(obj).map(([k, v]) => `${css(k)}:${v}`).join(';');
// CSS custom properties for the web app (light + automatic dark)
function cssVariables(){
  return `:root{${block(colors.light)};${block(shadows.light)};--ease-out:${motion.press.css};--sheet-ease:${motion.sheet.css}}` +
         `@media (prefers-color-scheme: dark){:root{${block(colors.dark)};${block(shadows.dark)}}}`;
}

return {theme:{colors, shadows, type, radius, motion}, cssVariables};
});
