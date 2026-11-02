// @ts-check
// Field sketches of the meadow islet's stories without creatures (F20): rye, four tall stalks from
// the islet's turf with long whiskered heads, the inset one head close up; and the marker stone,
// tall and leaning, its notch cut down into its top and lichen crusting its face, a few rye stalks at
// its foot. Drawn with the journal pen (pen.js) in the style of machair.js: a 380 x 260 sheet, the
// drawing in x 40..236 on a ground line at y 214, a scale bar at x 30, labels from x 250.

import { stem, along, wave, blade } from './pen.js';
import { WASH } from './living.js';

const GOLD = '#D9B45A';
const LICHEN = '#B8C49A';
const LICHEN_Y = '#D8C46A';
const STONE = '#9A9A92';

/** Sandy turf along the ground line. @param {import('./pen.js').Pen} p */
function turf(p) {
  p.tint('M40 214H236V250H40Z', WASH.sand, 0.45);
  p.line(wave(40, 236, 214, 1, 30), 1.5);
  for (const x of [48, 66, 90, 186, 206, 226]) p.fine(`M${x} 214l-2 -7M${x + 3} 214l2 -6`, 0.8, 0.5);
}

/**
 * One rye head: a long narrow ear of paired grains up a stalk's tip, whiskers (awns) off each.
 * @param {import('./pen.js').Pen} p @param {number} x @param {number} y the head's foot @param {number} len @param {number} lean
 */
function ear(p, x, y, len, lean) {
  const f = p.f, n = 7;
  for (let k = 0; k < n; k++) {
    const t = k / n, cx = x + lean * t * len, cy = y - t * len;
    for (const side of [-1, 1]) {
      p.oval(cx + side * 2.2, cy - 2, 2.2, 3.2, GOLD, 0.55, 0.8);
      p.fine(`M${f(cx + side * 3)} ${f(cy - 4)}L${f(cx + side * 9 + lean * 4)} ${f(cy - 18)}`, 0.5, 0.55);
    }
  }
}

/** Rye: four tall stalks, leaves low on them, whiskered heads on top. Inset: one head close. @param {import('./pen.js').Pen} p @param {string} scale */
export function rye(p, scale) {
  turf(p);
  /** @type {[number, number, number, number][]} base x, top x, top y, bend */
  const stalks = [[116, 108, 74, -3], [132, 136, 60, 2], [148, 162, 70, 4], [164, 194, 86, 6]];
  for (const [bx, tx, ty, bend] of stalks) {
    p.line(stem(bx, 214, tx, ty, bend), 1.1);
    for (let k = 0; k < 3; k++) {
      const t = 0.15 + k * 0.17, side = k % 2 ? 1 : -1;
      const [x, y] = along(bx, 214, tx, ty, bend, t);
      p.shape(blade(x, y, x + side * 22, y - 18, 2, side), WASH.leaf, 0.5, 0.8);
    }
    ear(p, tx, ty, 34, (tx - bx) / 120);
  }
  // Inset: one head close, a ring at the top left.
  p.shape('M44 58A30 30 0 1 0 104 58A30 30 0 1 0 44 58Z', WASH.petal, 0.25, 1.1);
  ear(p, 74, 82, 46, 0);
  p.label('head', 250, 54, 140, 40);
  p.label('stalk', 250, 170, 140, 160);
  p.scale(30, 70, 214, scale);
  return p.svg(380, 260, 'Field sketch of rye');
}

/** The marker stone: tall, leaning, a notch cut into its top, lichen on its face, rye at its foot. @param {import('./pen.js').Pen} p @param {string} scale */
export function markerstone(p, scale) {
  turf(p);
  const outline = 'M112 214L118 52L136 44L146 66L156 46L172 54L178 214Z';
  p.shape(outline, STONE, 0.5, 1.3);
  // Lichen crusts in blotches, grey-green and yellow.
  for (const [x, y, rx, ry, c] of /** @type {[number, number, number, number, string][]} */ ([[132, 100, 9, 6, LICHEN], [158, 132, 7, 9, LICHEN], [128, 168, 6, 5, LICHEN_Y], [162, 84, 5, 4, LICHEN_Y]])) p.oval(x, y, rx, ry, c, 0.5, 0.7);
  // The notch, cut clean: two short strokes along its faces.
  p.fine('M138 50L146 66L154 50', 0.9, 0.9);
  // A few rye stalks at its foot.
  for (const [bx, tx, ty] of [[190, 194, 150], [200, 210, 158], [208, 222, 166]]) { p.line(stem(bx, 214, tx, ty, 2), 0.9); ear(p, tx, ty, 18, 0.1); }
  p.label('notch', 250, 50, 150, 60);
  p.label('lichen', 250, 130, 162, 132);
  p.scale(30, 44, 214, scale);
  return p.svg(380, 260, 'Field sketch of the marker stone');
}
