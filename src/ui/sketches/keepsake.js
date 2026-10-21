// @ts-check
// A keepsake's field sketch (docs/future/12, the shelf): its mesh is traced once (trace.js) from the
// side that shows it best, then drawn in the journal pen like a find, with a soft watercolour wash
// of its own colours (so its bands, spots and flames still show) under the ink. The mesh can then
// be dropped: the shelf keeps only the keepsake's numbers, and the tracing comes back from them.

import { makePen } from './pen.js';
import { drawTracedData, smooth } from './traced.js';
import { trace } from './trace.js';

/** The side each shell form shows best from: flat coils and ear shells from above. */
const VIEWS = /** @type {Record<string, [number, number]>} */ ({ coil: [0, 72], ear: [0, 68] });
/** Cells across the colour wash. */
const WASH_CELLS = 36;
let seq = 0;

/**
 * Trace a keepsake's mesh for its sketch. @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} mesh
 * @param {{ form?: string }} n its numbers (for the view) @param {[number, number]} [view] [yaw, pitch]
 *   in degrees, the side to trace from (families/index.js keepsakeView), else by shell form
 * @returns {import('./trace.js').Traced}
 */
export function traceKeepsake(mesh, n, view) {
  const [yaw, pitch] = view ?? VIEWS[n.form ?? ''] ?? [25, 18];
  return trace(mesh, yaw, pitch, { cells: 180, colorGrid: WASH_CELLS });
}

/**
 * The sketch as an SVG string, fitted inside a square of `size` drawing units.
 * @param {import('./trace.js').Traced} T @param {string} aria @param {{ size?: number, stage?: 0|1|2 }} [o]
 */
export function keepsakeSvg(T, aria, o = {}) {
  const S = o.size ?? 200, pad = S * 0.1;
  const room = S - pad * 2;
  const w = T.aspect > 1 ? room / T.aspect : room, h = T.aspect * w;
  const x = (S - w) / 2, y = (S - h) / 2;
  const p = makePen(o.stage ?? 2, {});
  // The ink: outline, hatching on the shadow side, creases. Its own flat wash is left out; the
  // colour wash goes over it, multiplied, so the ink still reads through.
  drawTracedData(p, T, x, y, w, { opacity: 0, creases: 30, hatch: S / 60 });
  if (T.wash && !p.pencil) {
    const id = `ks${++seq}`;
    const outline = smooth(T.outline.map((q) => [x + q[0] * w, y + q[1] * w]), true, p.f);
    const cw = w / T.wash[0].length;
    let rects = '';
    T.wash.forEach((row, gy) => row.forEach((c, gx) => {
      if (c) rects += `<rect x="${p.f(x + gx * cw)}" y="${p.f(y + gy * cw)}" width="${p.f(cw + 0.4)}" height="${p.f(cw + 0.4)}" fill="#${c}"/>`;
    }));
    p.raw(`<defs><clipPath id="${id}c"><path d="${outline}"/></clipPath>` +
      `<filter id="${id}f" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${p.f(cw * 0.6)}"/></filter></defs>` +
      `<g clip-path="url(#${id}c)" style="mix-blend-mode:multiply" opacity="0.92"><g filter="url(#${id}f)">${rects}</g></g>`);
  }
  return p.svg(S, S, aria);
}
