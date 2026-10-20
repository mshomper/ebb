// @ts-check
// Drawing a find from its traced model (outlines.js, made by tools/gen-sketch-outlines.mjs) in the
// journal pen: a smooth outline filled with paper and its wash, hatching on the shadow side, and the
// creases (ribs, whorls, leg joints) as fine lines. The model gives the true shape; the pen gives
// the hand.

import { OUTLINES } from './outlines.js';

const PAPER = [244, 238, 228];

/**
 * A smooth path through points (Catmull-Rom as cubic curves).
 * @param {number[][]} pts @param {boolean} closed @param {(n: number) => string} f
 */
export function smooth(pts, closed, f) {
  const n = pts.length;
  if (n < 2) return '';
  const P = (/** @type {number} */ i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** A soft watercolor of the model's own tone, lifted toward the paper. @param {string} hex @param {number} [lift] */
export function washOf(hex, lift = 0.25) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const m = c.map((v, i) => Math.round(v + (PAPER[i] - v) * lift));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Draw a traced subject with its top left at (x, y), w wide. Returns its height and a point lookup
 * for labels.
 * @param {import('./pen.js').Pen} p @param {string} id outlines.js key @param {number} x @param {number} y @param {number} w
 * @param {{ wash?: string, opacity?: number, mirror?: boolean, hatch?: number, creases?: number }} [o]
 *   wash: a color instead of the model's tone; mirror: flip left to right; hatch: spacing (0 none);
 *   creases: how many of the longest to draw
 * @returns {{ h: number, at: (u: number, v: number) => [number, number] }}
 */
export function drawTraced(p, id, x, y, w, o = {}) {
  const T = OUTLINES[/** @type {keyof typeof OUTLINES} */ (id)];
  const h = T.aspect * w;
  /** @param {number[]} q @returns {[number, number]} */
  const at = (q) => [x + (o.mirror ? 1 - q[0] : q[0]) * w, y + q[1] * w];
  const outline = smooth(T.outline.map(at), true, p.f);
  p.shape(outline, o.wash ?? washOf(T.tone), o.opacity ?? 0.6, 1.5);
  if (!p.pencil) {
    // Hatching where the shadow side is: diagonal strokes, closer where it is darker.
    const rows = T.dark.split('/'), GW = rows[0].length;
    const darkAt = (/** @type {number} */ u, /** @type {number} */ v) => {
      const gx = Math.floor((o.mirror ? 1 - u : u) * GW), gy = Math.floor(v * GW);
      const c = rows[gy]?.[gx];
      return c === undefined || c === '.' ? -1 : Number(c);
    };
    const step = o.hatch ?? 3.4;
    let d = '';
    if (step > 0) {
      for (let k = -h; k < w; k += step) {
        const line = Math.round((k + h) / step);
        let run = null;
        for (let t = 0; t <= h; t += 0.8) {
          const px = k + t, py = h - t;
          const dk = px < 0 || px > w ? -1 : darkAt(px / w, py / w);
          const need = line % 2 ? 7 : 5;   // every other stroke only where it is darkest
          const on = dk >= need;
          if (on && !run) run = [px, py];
          if ((!on || t + 0.8 > h) && run) {
            if (Math.hypot(px - run[0], py - run[1]) > 2.5) d += `M${p.f(x + run[0])} ${p.f(y + run[1])}L${p.f(x + px)} ${p.f(y + py)}`;
            run = null;
          }
        }
      }
    }
    if (d) p.fine(d, 0.7, 0.45);
    // The creases, longest first.
    const cr = T.creases.slice(0, o.creases ?? 24).map((c) => smooth(c.map(at), false, p.f)).join('');
    if (cr) p.fine(cr, 0.85, 0.6);
  }
  return { h, at: (u, v) => at([u, v]) };
}

/** A traced subject's real width (m) and height over width. @param {string} id */
export const tracedSize = (id) => {
  const T = OUTLINES[/** @type {keyof typeof OUTLINES} */ (id)];
  return { widthM: T.widthM, aspect: T.aspect };
};

/**
 * Draw a traced subject standing on a ground line at real scale: its middle at x, its base on y.
 * @param {import('./pen.js').Pen} p @param {string} id @param {number} x @param {number} y @param {number} pxPerM
 * @param {{ wash?: string, opacity?: number, mirror?: boolean, hatch?: number, creases?: number, sink?: number }} [o]
 *   sink: share of its height set below the line (a stalk in the rock)
 */
export function standTraced(p, id, x, y, pxPerM, o = {}) {
  const { widthM, aspect } = tracedSize(id);
  const w = widthM * pxPerM, h = aspect * w;
  return { w, h, ...drawTraced(p, id, x - w / 2, y - h * (1 - (o.sink ?? 0)), w, o) };
}
