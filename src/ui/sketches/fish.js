// @ts-check
// The journal sketch of a fish caught on the line (docs/future/17): traced from the very fish the
// page was drawn from (its seed is kept in the fishing section, src/world/fishing/model.js; a
// redraw replaces it), so every island's pages show its own fish. Before one is sketched the page
// draws, in pencil, a plain one of its species. The net fish's pages (src/ui/sketches/catch.js)
// trace their line sketch here too. Tracings are kept per fish for the visit.

import { traceKeepsake } from './keepsake.js';
import { drawTracedData } from './traced.js';
import { registerSketch } from './index.js';
import { fishNumbers, fishMeshOf } from '../../world/nets/living/fish2.js';

/** @type {Map<string, import('./trace.js').Traced>} */
const TRACED = new Map();

/** A fish's tracing, side on (cached). @param {any} n gen 2 numbers @param {any} FR fishing.json */
export function traceFish(n, FR) {
  const key = `${n.kind}:${n.seed}`;
  let T = TRACED.get(key);
  if (!T) { T = traceKeepsake(fishMeshOf(n, FR), {}, [90, 8]); TRACED.set(key, T); }
  return T;
}

/**
 * Draw a fish on a page: shallow water behind it, the fish as wide as the page allows, its scale.
 * @param {any} p the page's pen @param {import('./trace.js').Traced} T @param {any} scale @param {string} name
 */
export function drawFish(p, T, scale, name) {
  p.tint('M44 60H346V220H44Z', '#C9DCE0', 0.3);
  const w = Math.min(270, 140 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
  const x0 = 200 - w / 2, y0 = 140 - h / 2;
  drawTracedData(p, T, x0, y0, w, { creases: 30, hatch: 3.6 });
  p.scale(30, y0, y0 + h, scale);
  return p.svg(380, 245, `Field sketch of a ${name.toLowerCase()}`);
}

/**
 * Register a sketch for each of the island's fish pages (the net fish keep catch.js's, which calls
 * back here once one is sketched on the line). @param {any} FR fishing.json
 * @param {import('../../world/fishing/roster.js').RosterFish[]} fish @param {() => any} state the fishing section
 */
export function registerFishSketches(FR, fish, state) {
  for (const f of fish) {
    if (f.kind === 'named') continue;
    registerSketch(f.page, (p, scale) => {
      const sk = state()?.sketched?.[f.id];
      return drawFish(p, traceFish(fishNumbers(f.id, f.ref, sk?.seed ?? 1, FR), FR), scale, f.name);
    });
  }
}
