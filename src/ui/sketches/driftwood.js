// @ts-check
// The Driftwood page's field sketches (docs/future/11, L2): each log is baked from its own seed
// (src/world/pieces/log-bake.js), so the page's drawing is traced (trace.js) from the very log you
// last tapped, seen from the side and a little above. Each of the four forms also gets a small
// drawing for its row, traced from the last log of that form you tapped, or before then from one
// plain log of its form. Tracings are kept for the visit; nothing is saved.

import { trace } from './trace.js';
import { drawTracedData } from './traced.js';
import { WASH } from './living.js';
import { bakeLogSeed, logLook, LOG_FORMS } from '../../world/pieces/log-bake.js';
import { hash32 } from '../../core/rng.js';

/** @typedef {{ seed: number, size: number, length: number }} LogRef */

/** @type {any} pieces.json driftwood */ let D = null;
/** @type {LogRef | null} */ let last = null;
/** @type {Record<string, LogRef>} */ const lastOf = {};
/** @type {Map<string, import('./trace.js').Traced>} */ const TRACED = new Map();

/** Give the sketches the logs' recipe (pieces.json). @param {any} recipe */
export function setDriftwoodRecipe(recipe) { D = recipe?.driftwood ?? null; }

/** A log was tapped: the page draws it from now on. @param {LogRef & { form?: string }} log */
export function noteLog(log) {
  last = { seed: log.seed >>> 0, size: log.size, length: log.length };
  if (log.form) lastOf[log.form] = last;
}

/** A plain log of a form, to draw before you have tapped one. @param {string} form @returns {LogRef} */
function sampleOf(form) {
  for (let s = 0; s < 400; s++) {
    const seed = hash32(9001, s) >>> 0;
    if (logLook(seed, D).form === form) return { seed, size: 0.14, length: 1.2 };
  }
  return { seed: 1, size: 0.14, length: 1.2 };
}

/**
 * A log traced from the side, a little above. The mesh is squeezed to 1 long and 1 thick; it is
 * traced at its true proportions. @param {LogRef} log
 */
function tracedLog(log) {
  const a = log.size / log.length;
  const key = `${log.seed}:${Math.round(a * 1000)}`;
  let T = TRACED.get(key);
  if (T) return T;
  const { mesh } = bakeLogSeed(D, log.seed, Math.round(a * 1000) / 1000);
  const V = new Float32Array(mesh.vertices);
  for (let q = 0; q < mesh.count; q++) {
    const o = q * 9;
    V[o] *= a; V[o + 1] *= a;
    // The true normal: the mesh's carries the squeeze's inverse.
    const n = [V[o + 3], V[o + 4], V[o + 5] * a], l = Math.hypot(n[0], n[1], n[2]) || 1;
    V[o + 3] = n[0] / l; V[o + 4] = n[1] / l; V[o + 5] = n[2] / l;
  }
  // From well above and a little to the side: a bow, a fork and splayed roots all lie flat on the
  // ground, so they show from above, and the side still gives the log its roundness.
  T = trace({ vertices: V, count: mesh.count, indices: mesh.indices }, 90, 62, { cells: 240 });
  TRACED.set(key, T);
  return T;
}

/**
 * The page's drawing: the log you last tapped (before then, a plain straight trunk), across the page,
 * with its broken end, grain and bark named once the page has learned them. Logs come in every
 * size, so it has no scale bar. @param {import('./pen.js').Pen} p
 */
export function driftwood(p) {
  if (!D) return p.svg(380, 200, 'Field sketch of a driftwood log');
  const T = tracedLog(last ?? sampleOf('straight'));
  // A log is long and thin: it runs right across the page (x 44 to 356), no taller than 110, with
  // its labels above and below it rather than beside.
  const w = Math.min(312, 110 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
  const x0 = 44 + (312 - w) / 2, y0 = 105 - h / 2;
  // The sand it lies on, seen from above.
  p.tint(`M30 ${Math.round(y0 - 14)}C140 ${Math.round(y0 - 22)} 260 ${Math.round(y0 - 10)} 368 ${Math.round(y0 - 16)}V${Math.round(y0 + h + 16)}C260 ${Math.round(y0 + h + 22)} 140 ${Math.round(y0 + h + 10)} 30 ${Math.round(y0 + h + 18)}Z`, WASH.sand, 0.3);
  const d = drawTracedData(p, T, x0, y0, w, { creases: 36, hatch: 3.4 });
  const [ex, ey] = d.at(0.96, T.aspect * 0.35);
  p.label('end', 262, Math.max(26, y0 - 34), ex, ey);
  const [gx, gy] = d.at(0.55, T.aspect * 0.75);
  p.label('grain', 196, Math.min(186, y0 + h + 34), gx, gy);
  const [bx, by] = d.at(0.2, T.aspect * 0.7);
  p.label('bark', 60, Math.min(186, y0 + h + 34), bx, by);
  return p.svg(380, 215, 'Field sketch of the driftwood log you looked at last');
}

/**
 * A form's small drawing for its row on the page. @param {string} form
 * @returns {(p: import('./pen.js').Pen) => string}
 */
export function driftwoodForm(form) {
  return (p) => {
    if (!D) return p.svg(240, 80, `Sketch of a ${form} log`);
    const T = tracedLog(lastOf[form] ?? sampleOf(form));
    const w = Math.min(220, 64 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
    drawTracedData(p, T, 120 - w / 2, 40 - h / 2, w, { creases: 16, hatch: 4 });
    return p.svg(240, 80, `Sketch of a ${form} log`);
  };
}

/** The forms, for the sketch registry (one drawing each, keyed driftwood:<form>). */
export const DRIFTWOOD_FORMS = LOG_FORMS;
