// @ts-check
// Field sketches of the animals (M2): the azure damselfly first. The body is traced from the game's
// own model at rest (outlines.js, tools/gen-sketch-outlines.mjs), so the drawing keeps its true
// shape; the pen adds the stem it clings to, its black bands and the labels. Layout as living.js:
// the drawing in x 40..236, a scale bar at x 30, labels from x 250.

import { blade, wave } from './pen.js';
import { WASH } from './living.js';
import { drawTraced } from './traced.js';
import { OUTLINES } from './outlines.js';

/** The azure's sky blue, as a wash on the journal page. */
const SKY = '#86B8DA';

/**
 * Where a traced outline's edge crosses u (0..1 across): its lowest and highest points there, as
 * shares of the width down from the top. @param {number[][]} pts a closed loop @param {number} u
 */
function spanAt(pts, u) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    if ((u < x0 && u < x1) || (u > x0 && u > x1) || x0 === x1) continue;
    const y = y0 + ((u - x0) * (y1 - y0)) / (x1 - x0);
    lo = Math.max(lo, y); hi = Math.min(hi, y);
  }
  return { lo, hi };
}

/**
 * Azure damselfly: a male at rest on a reed stem over the water, his wings folded together along
 * his back, the sky-blue abdomen ringed with black.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function damselfly(p, scale) {
  const f = p.f;
  const T = OUTLINES.damselfly;
  // The water and a reed stem rising out of it, a blade off its side.
  p.tint('M40 236H236V258H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 236, 1.3, 26), 1.3);
  p.fine('M58 246h22M120 250h18M168 245h16', 0.9, 0.5);
  p.shape(blade(222, 238, 168, 196, 3, 4), WASH.green, 0.4, 1.1);
  p.shape(blade(218, 238, 206, 22, 3.2, -4), WASH.green, 0.45, 1.3);
  // The damselfly, its head to the stem; the body's depth comes from the model.
  const W = 160, x0 = 44, y0 = 104;
  const body = drawTraced(p, 'damselfly', x0, y0, W, { wash: SKY, opacity: 0.55, hatch: 0, creases: 10 });
  /** A point on the drawing from the model's (u across, z along the body: meters, +z to the head). @param {number} z */
  const uOf = (z) => (z + 0.0286) / T.widthM;
  // Black rings at the end of segments two to seven, and the black tip, inked solid on the abdomen.
  if (!p.pencil) {
    const bands = [[-0.0068, -0.0058], [-0.0095, -0.0086], [-0.0123, -0.0114], [-0.0151, -0.0142], [-0.0179, -0.017], [-0.0207, -0.0198], [-0.0284, -0.0262]];
    let d = '';
    for (const [z0, z1] of bands) {
      for (let u = uOf(z0); u <= uOf(z1); u += 0.6 / W) {
        const { lo } = spanAt(T.outline, u);
        if (!Number.isFinite(lo)) continue;
        const [x, yb] = body.at(u, lo);
        d += `M${f(x)} ${f(yb - 0.6)}V${f(yb - 6.2)}`;
      }
    }
    p.fine(d, 1, 0.85);
  }
  // Legs gripping the stem, under the thorax.
  const [lx, ly] = body.at(uOf(0), spanAt(T.outline, uOf(0)).lo);
  p.line(`M${f(lx - 2)} ${f(ly - 1)}L${f(lx + 6)} ${f(ly + 10)}L${f(lx + 26)} ${f(ly + 6)}`, 1.1);
  p.line(`M${f(lx + 3)} ${f(ly - 1)}L${f(lx + 14)} ${f(ly + 4)}L${f(lx + 27)} ${f(ly - 4)}`, 1.1);
  // Labels: the folded wings above the back, a band, the wide-set eyes.
  const uw = uOf(-0.009), uh = uOf(0.0032), ub = uOf(-0.0147);
  const w = spanAt(T.outline, uw), h = spanAt(T.outline, uh), b = spanAt(T.outline, ub);
  const [wx, wy] = body.at(uw, w.hi + 0.004);
  p.label('wings', 250, 52, wx, wy);
  const [bx, by] = body.at(ub, b.lo - 0.01);
  p.label('bands', 250, 190, bx, by);
  const [hx, hy] = body.at(uh, (h.lo + h.hi) / 2);
  p.label('eyes', 250, 112, hx + 2, hy);
  // About 3 cm: the bar is 30 mm at the drawing's scale.
  const mm = W / (T.widthM * 1000);
  p.scale(30, 220 - 30 * mm, 220, scale);
  return p.svg(380, 268, 'Field sketch of an azure damselfly resting on a reed stem, its wings folded along its back');
}
