// @ts-check
// Field sketches of the finds (docs/future/11), the small lives of the shore. Each is drawn in the
// journal pen around its model's own traced shape (traced.js, outlines.js), at real scale, so a
// page shows the find as it is: the anemone open under water and shut out of it, the periwinkle on
// the weed, the hermit crab in its borrowed shell, the young edible crab from above, the shells
// found so far. The lugworm has no model (its cast is drawn into the sand), so its coil is drawn
// here from the same wandering spiral the sand shader uses.
//
// Same layout as living.js: the drawing in x 40..236, a scale bar at x 30, labels from x 250.

import { wave, blade } from './pen.js';
import { WASH } from './living.js';
import { standTraced, drawTraced, tracedSize } from './traced.js';

/** The rock of a pool's floor or the shore, from x0 to x1 with its top at y. @param {import('./pen.js').Pen} p @param {number} y */
function rockLine(p, y, x0 = 40, x1 = 236) {
  p.shape(`M${x0} ${y}C${x0 + 30} ${y - 6} ${x0 + 70} ${y - 2} ${(x0 + x1) / 2} ${y}C${x1 - 60} ${y - 6} ${x1 - 30} ${y - 4} ${x1} ${y}V${y + 22}H${x0}Z`, WASH.grey, 0.4, 1.5);
  p.fine(`M${x0 + 20} ${y + 9}l14 -2M${x0 + 96} ${y + 13}l18 -1M${x1 - 50} ${y + 8}l12 2`, 0.8, 0.5);
}

/** Beadlet anemone: open under the pool's water on the left, shut on bare rock at low tide on the right. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function anemone(p, scale) {
  const ground = 214, s = 3800;
  // The pool's water over the left one; the right one stands where the tide has gone.
  p.tint(`M40 96H146V${ground}H40Z`, WASH.water, 0.32);
  p.line(wave(40, 146, 96, 1.4, 14), 1.3);
  p.fine('M146 96V212', 0.8, 0.35);
  rockLine(p, ground);
  const open = standTraced(p, 'anemone-open', 92, ground + 2, s, { sink: 0.17, creases: 30 });
  const shut = standTraced(p, 'anemone-shut', 192, ground + 2, s, { sink: 0.17, creases: 12 });
  // The beadlet's blue beads, round the rim of the shut one.
  const top = ground + 2 - shut.h * 0.83 + shut.h * 0.22;
  for (const [dx, dy] of [[-12, 10], [-4, 5], [6, 5], [13, 10]]) p.dot(192 + dx * (shut.w / 38), top + dy, 2.4, WASH.blue);
  p.label('tentacles', 250, 70, 104, ground - open.h * 0.7);
  p.label('beads', 250, 140, 200, top + 6);
  p.label('shut', 250, 192, 206, ground - shut.h * 0.35);
  p.scale(30, ground - open.h * 0.83, ground, scale);
  return p.svg(380, 250, 'Field sketch of beadlet anemones, open under water and shut at low tide');
}

/** Periwinkles: two grazing the wrack on a rock, the near one big enough to show its whorls. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function periwinkle(p, scale) {
  const ground = 210;
  p.shape('M40 214C60 190 120 182 170 186C206 190 228 202 236 214V236H40Z', WASH.grey, 0.4, 1.5);
  for (const [x0, y0, x1, y1, b] of [[52, 206, 124, 212, 4], [100, 196, 178, 202, -5], [150, 194, 230, 210, 6]]) p.shape(blade(x0, y0, x1, y1, 3.6, b), WASH.brown, 0.55, 1.1);
  const far = standTraced(p, 'periwinkle', 190, ground - 8, 5200, { mirror: true, creases: 14 });
  const near = standTraced(p, 'periwinkle', 104, ground + 2, 8600, { creases: 22 });
  p.label('shell', 250, 70, 98, ground - near.h * 0.75);
  p.label('door', 250, 132, 126, ground - near.h * 0.25);
  p.label('weed', 250, 196, 222, 206);
  p.scale(30, ground - near.h, ground, scale);
  void far;
  return p.svg(380, 240, 'Field sketch of periwinkles grazing the weed on a rock');
}

/**
 * Lugworm casts: the sand cut away to show the U of the burrow, the coil of spent sand heaped at one
 * end (lumps of squeezed sand along a wandering spiral, as the sand shader draws it), the dip at the other.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function lugworm(p, scale) {
  const top = 132;
  p.tint(`M40 ${top}H236V232H40Z`, WASH.sand, 0.4);
  p.line(`M40 ${top}H92C98 ${top} 102 ${top + 7} 110 ${top + 7}S122 ${top} 128 ${top}H236`, 1.6);
  for (const [x, y] of [[58, 160], [86, 204], [150, 218], [214, 170], [228, 214], [70, 182]]) p.dot(x, y, 1.1);
  // The U-shaped burrow under the sand, the worm lying in it.
  p.line(`M110 ${top + 7}C110 186 128 214 150 214S184 186 184 ${top}`, 4.5);
  p.shape(blade(124, 192, 166, 202, 4, 4), WASH.pink, 0.75, 1.1);
  // The cast: a tube of squeezed sand along a spiral that wanders, tightens and climbs, seen a
  // little from above. Drawn piece by piece from the bottom turn up, each piece an ink edge with a
  // sand middle, so every turn lies over the one below.
  const cx = 184, cy = top - 3, R = 30, turns = 3, n = 60;
  /** @type {[number, number, number][]} */ const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2 + 0.6;
    const wander = 1 + 0.16 * Math.sin(a * 1.7 + 1.3) + 0.08 * Math.sin(a * 3.1);
    const r = R * (1 - 0.74 * t) * wander;
    pts.push([cx + Math.cos(a) * r, cy - t * 18 + Math.sin(a) * r * 0.34, 9.5 - 3.5 * t + 0.9 * Math.sin(a * 2.6)]);
  }
  const fill = p.wash ? '#E2CFA6' : '#F4EEE4';
  for (let i = 1; i <= n; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1, w] = pts[i];
    const d = `M${p.f(x0)} ${p.f(y0)}L${p.f(x1)} ${p.f(y1)}`;
    p.line(d, w + 2.4);
    p.raw(`<path d="${d}" stroke="${fill}" stroke-width="${p.f(w)}" stroke-linecap="round" fill="none"/>`);
  }
  // Squeeze marks across the tube, here and there.
  p.fine(pts.filter((_, i) => i % 6 === 3).map(([x, y, w]) => `M${p.f(x - w * 0.3)} ${p.f(y - w * 0.25)}l${p.f(w * 0.5)} ${p.f(w * 0.45)}`).join(''), 0.7, 0.45);
  p.label('cast', 250, 72, 206, top - 20);
  p.label('burrow', 250, 178, 182, 176);
  p.label('dip', 250, 128, 112, top + 8);
  p.scale(30, top - 2 * R * 0.4 - 22, top, scale);
  return p.svg(380, 245, 'Field sketch of a lugworm burrow and its cast');
}

/** Hermit crab: in a borrowed shell on a pool floor, legs and claws out of the shell's mouth. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function hermitcrab(p, scale) {
  const ground = 210;
  p.tint(`M40 92H236V${ground}H40Z`, WASH.water, 0.28);
  p.line(wave(40, 236, 92, 1.4, 28), 1.3);
  rockLine(p, ground);
  const c = standTraced(p, 'hermitcrab', 138, ground + 2, 6400, { creases: 36 });
  const x0 = 138 - c.w / 2, y0 = ground + 2 - c.h;
  p.label('shell', 250, 70, x0 + c.w * 0.35, y0 + c.h * 0.2);
  p.label('claw', 250, 136, x0 + c.w * 0.82, y0 + c.h * 0.55);
  p.label('legs', 250, 196, x0 + c.w * 0.7, y0 + c.h * 0.92);
  p.scale(30, y0, ground, scale);
  return p.svg(380, 245, 'Field sketch of a hermit crab in a borrowed shell');
}

/** Young edible crab: from above on a weedy rock, its crimped shell edge and black-tipped claws. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function ediblecrab(p, scale) {
  // Seen from above, like the crab: a rock under it, strands of wrack across the rock.
  p.shape('M48 98C92 72 200 74 230 102C248 142 240 206 204 224C152 238 82 234 56 206C38 174 38 128 48 98Z', WASH.grey, 0.35, 1.4);
  for (const [x0, y0, x1, y1, b] of [[60, 204, 140, 218, 5], [150, 208, 226, 188, -4], [54, 120, 98, 94, 3]]) p.shape(blade(x0, y0, x1, y1, 3.4, b), WASH.brown, 0.5, 1.1);
  const { widthM, aspect } = tracedSize('ediblecrab');
  const w = widthM * 5000, h = aspect * w, x0 = 138 - w / 2, y0 = 154 - h / 2;
  drawTraced(p, 'ediblecrab', x0, y0, w, { creases: 40 });
  p.label('claws', 250, 80, x0 + w * 0.82, y0 + h * 0.18);
  p.label('shell', 250, 150, x0 + w * 0.6, y0 + h * 0.45);
  p.label('legs', 250, 200, x0 + w * 0.94, y0 + h * 0.7);
  p.scale(30, y0, y0 + h, scale);
  return p.svg(380, 250, 'Field sketch of a young edible crab from above');
}

/**
 * Shells: the ones found so far, laid out on the sand as they wash up on the strandline. A shell
 * shows once its page has learned it (the label keys show-<id>, whose text is empty); before any is
 * found, two faint common ones stand in, in pencil.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function shells(p, scale) {
  const ground = 214, s = 1300;
  p.tint(`M40 150H236V236H40Z`, WASH.sand, 0.35);
  p.line(`M40 ${ground}C90 ${ground - 4} 160 ${ground + 3} 236 ${ground - 2}`, 1.4);
  // A few strands of dried litter: this is the strandline.
  p.fine('M52 206l26 -3M96 210l18 2M160 207l30 -4M200 211l20 1', 0.9, 0.55);
  const has = (/** @type {string} */ id) => p.pencil ? id === 'turret' || id === 'cockle' : p.knows(`show-${id}`);
  // Back row the big ones, front row the small; each at real scale.
  /** @type {[string, number, number][]} id, middle x, base y */
  const place = [['nautilus', 98, ground - 22], ['murex', 186, ground - 18], ['cockle', 70, ground + 6], ['turret', 140, ground + 4], ['periwinkle', 204, ground + 6]];
  /** @type {Record<string, { w: number, h: number }>} */ const at = {};
  for (const [id, x, y] of place) {
    if (!has(id)) continue;
    at[id] = standTraced(p, `shell-${id}`, x, y, s, { creases: id === 'murex' ? 30 : 18 });
  }
  if (at.turret) p.label('spiral', 250, 196, 150, ground);
  if (at.cockle) p.label('ribs', 250, 150, 74, ground - at.cockle.h * 0.5);
  if (at.murex) p.label('spines', 250, 70, 196, ground - 18 - at.murex.h * 0.7);
  p.scale(30, ground - (at.nautilus?.h ?? at.murex?.h ?? 40) - 20, ground - 20, scale);
  return p.svg(380, 245, 'Field sketch of the shells found so far');
}

