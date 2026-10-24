// @ts-check
// Field sketches of the four tea herbs (P2b): water mint, meadowsweet, nettle and chamomile, drawn
// with the journal pen (pen.js) like the other plants in living.js. Each sheet shows the whole
// plant and, in a round inset at the top left, one close detail: mint's square stem, meadowsweet's
// froth of tiny flowers, a nettle leaf's teeth and stinging hairs, chamomile's gold heart.
//
// Layout as living.js: the drawing in x 40..236 on a ground line, a scale bar at x 30, labels in
// the right column from x 250, each with a leader from the thing it names.

import { stem, along, wave } from './pen.js';
import { WASH, petal } from './living.js';

const LILAC = '#B79AD0';
const CREAM = '#EDE2C2';
const STALK = '#9A5B4E';

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/**
 * A leaf with a saw-toothed edge, from its base (bx, by) along angle a (radians, 0 = right, -PI/2 =
 * up), len long and w half wide at its widest; heart says how near the base it is widest.
 * @param {number} bx @param {number} by @param {number} a @param {number} len @param {number} w
 * @param {number} teeth @param {number} [heart] 0.3 broad near the base (nettle) .. 0.5 oval (mint)
 */
function toothed(bx, by, a, len, w, teeth, heart = 0.4) {
  const c = Math.cos(a), s = Math.sin(a);
  const pt = (/** @type {number} */ u, /** @type {number} */ v) => `${r1(bx + c * u - s * v)} ${r1(by + s * u + c * v)}`;
  const half = (/** @type {number} */ t) => w * Math.sin(Math.PI * Math.pow(t, heart / 0.5 * 0.7));
  const n = teeth * 2;
  let d = `M${pt(0, 0)}`;
  for (const side of [1, -1]) {
    for (let k = 1; k <= n; k++) {
      const t = side > 0 ? k / n : 1 - k / n;
      const tooth = k % 2 ? 1 : 0.78;
      d += `L${pt(t * len, side * half(t) * tooth)}`;
    }
  }
  return `${d}Z`;
}

/** A round inset at the top left holding one close detail, its rim drawn, its paper hiding what is behind. @param {import('./pen.js').Pen} p */
function inset(p, cx = 74, cy = 58, r = 30) {
  p.shape(`M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`, WASH.petal, 0.25, 1.1);
}

/** Water mint: a square stem in the shallows, paired round toothed leaves, a lilac head on top. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function watermint(p, scale) {
  const f = p.f;
  p.tint('M40 262H170V300H40Z', WASH.water, 0.35);
  p.tint('M170 262H236V300H170Z', WASH.mud, 0.3);
  p.line(wave(40, 170, 262, 1.4, 22), 1.4);
  p.line('M170 262H236', 1.4);
  p.fine('M56 276h18M110 282h22M190 276h16', 0.9, 0.5);
  // A shorter side shoot first, behind the main stem.
  p.line(stem(186, 262, 196, 140, 4), 1.3);
  for (const [y, s] of [[226, 0.8], [188, 0.65]]) {
    p.shape(toothed(188, y, -0.35, 30 * s, 13 * s, 5, 0.5), WASH.leaf, 0.5, 1.1);
    p.shape(toothed(188, y, Math.PI + 0.35, 30 * s, 13 * s, 5, 0.5), WASH.leaf, 0.5, 1.1);
  }
  p.oval(196, 126, 11, 15, LILAC, 0.75, 1.1);
  // The square stem: two edges, a little apart.
  p.line('M144 262L146 92M152 262L154 92', 1.3);
  // Pairs of round, toothed leaves, smaller toward the top.
  /** @type {[number, number][]} */
  const pairs = [[236, 1], [196, 0.88], [156, 0.74], [120, 0.6]];
  for (const [y, s] of pairs) {
    p.shape(toothed(146, y, Math.PI + 0.3, 46 * s, 20 * s, 6, 0.5), WASH.leaf, 0.5, 1.2);
    p.shape(toothed(152, y, -0.3, 46 * s, 20 * s, 6, 0.5), WASH.leaf, 0.5, 1.2);
    p.fine(`M${f(146)} ${f(y)}L${f(146 - 40 * s)} ${f(y - 12 * s)}M${f(152)} ${f(y)}L${f(152 + 40 * s)} ${f(y - 12 * s)}`, 0.6, 0.45);
  }
  // The flower head: a dense round whorl of tiny lilac flowers.
  p.oval(150, 76, 17, 21, LILAC, 0.75, 1.3);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    p.dot(150 + Math.cos(a) * 9, 76 + Math.sin(a) * 12, 1.3, '#8C6BAA');
  }
  // Inset: the stem cut across is square, with rounded corners.
  inset(p);
  p.shape('M60 46Q60 44 62 44H86Q88 44 88 46V70Q88 72 86 72H62Q60 72 60 70Z', WASH.green, 0.4, 1.3);
  p.fine('M66 50L82 66M82 50L66 66', 0.6, 0.35);
  p.fine('M100 72L144 180', 0.8, 0.4);
  p.label('flower', 250, 66, 167, 72);
  p.label('leaves', 250, 160, 196, 152);
  p.label('stem', 250, 220, 104, 66);
  p.label('water', 250, 286, 120, 272);
  p.scale(30, 66, 262, scale);
  return p.svg(380, 310, 'Field sketch of water mint');
}

/** Meadowsweet: tall red stems on a damp bank, leaflets in pairs, frothy cream heads. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function meadowsweet(p, scale) {
  const f = p.f;
  p.tint('M40 304H76V334H40Z', WASH.water, 0.35);
  p.tint('M76 304H236V334H76Z', WASH.mud, 0.28);
  p.line(wave(40, 76, 304, 1.2, 16), 1.4);
  p.line('M76 304H236', 1.4);
  p.fine('M92 316h16M150 322h20M200 316h18', 0.9, 0.5);
  // Two tall stems.
  /** @type {[number, number, number, number, number][]} */
  const stems = [[150, 304, 142, 108, -6], [168, 304, 200, 134, 8]];
  for (const [bx, by, tx, ty, b] of stems) p.line(stem(bx, by, tx, ty, b), 1.6);
  // A leaf low on each stem: leaflets in pairs along a stalk, a bigger one at the tip.
  /** @type {[number, number, number, number][]} */
  const leaves = [[150, 268, 92, 236], [166, 254, 222, 222]];
  for (const [bx, by, tx, ty] of leaves) {
    p.line(stem(bx, by, tx, ty, 0), 1.1);
    for (const t of [0.3, 0.6]) {
      const [x, y] = along(bx, by, tx, ty, 0, t);
      const a = Math.atan2(ty - by, tx - bx);
      p.shape(toothed(x, y, a - 1.1, 22, 7, 4, 0.5), WASH.leaf, 0.5, 1);
      p.shape(toothed(x, y, a + 1.1, 22, 7, 4, 0.5), WASH.leaf, 0.5, 1);
    }
    p.shape(toothed(tx, ty, Math.atan2(ty - by, tx - bx), 26, 11, 5, 0.45), WASH.leaf, 0.5, 1.1);
  }
  // Frothy flat-topped heads: a cloud of tiny cream flowers on branching stalks.
  /** @type {[number, number, number, number][]} */
  const heads = [[142, 96, 44, 16], [200, 124, 34, 13]];
  for (const [hx, hy, rx, ry] of heads) {
    for (const dx of [-0.7, -0.3, 0.3, 0.7]) p.fine(`M${f(hx)} ${f(hy + ry + 14)}L${f(hx + dx * rx)} ${f(hy + ry * 0.4)}`, 0.9, 0.6);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2, rr = 0.55 + 0.45 * ((k * 7) % 5) / 4;
      p.oval(hx + Math.cos(a) * rx * rr, hy + Math.sin(a) * ry * rr - 2, 5.5, 5, CREAM, 0.8, 0.9);
    }
    p.oval(hx, hy - 3, 6, 5.5, CREAM, 0.8, 0.9);
  }
  // Inset: the froth is many tiny five-petalled flowers, each with a spray of stamens.
  inset(p);
  for (const [fx, fy] of [[64, 50], [86, 52], [74, 70]]) {
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
      p.shape(petal(fx, fy, fx + Math.cos(a) * 9, fy + Math.sin(a) * 9, 4), CREAM, 0.9, 0.9);
    }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; p.dot(fx + Math.cos(a) * 3, fy + Math.sin(a) * 3, 0.7); }
  }
  p.fine('M104 60L118 90', 0.8, 0.4);
  p.label('froth', 250, 66, 184, 92);
  p.label('stems', 250, 180, 176, 200);
  p.label('leaves', 250, 236, 224, 222);
  p.scale(30, 70, 304, scale);
  return p.svg(380, 344, 'Field sketch of meadowsweet');
}

/** Nettle: an upright stand on rich soil, toothed leaves in pairs, hanging strings of green flowers. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function nettle(p, scale) {
  const f = p.f;
  p.tint('M40 304H236V334H40Z', WASH.mud, 0.35);
  p.line('M40 304H236', 1.6);
  p.fine('M60 316l6 4M104 320l-4 5M170 314l6 6M214 318l-5 4', 0.9, 0.55);
  // A shorter stem behind.
  p.line(stem(186, 304, 198, 150, 4), 1.3);
  for (const [y, s] of [[262, 0.75], [214, 0.6], [176, 0.45]]) {
    p.shape(toothed(188, y, -0.55, 50 * s, 19 * s, 6, 0.3), WASH.green, 0.5, 1);
    p.shape(toothed(188, y, Math.PI + 0.55, 50 * s, 19 * s, 6, 0.3), WASH.green, 0.5, 1);
  }
  // The main stem, upright.
  p.line(stem(146, 304, 142, 64, -2), 1.6);
  /** @type {[number, number][]} */
  const pairs = [[268, 1], [216, 0.86], [170, 0.7], [128, 0.55], [92, 0.4]];
  pairs.forEach(([y, s], i) => {
    // Strings of tiny green flowers hang from where the leaves join (not on the top pairs).
    if (i < 3) {
      for (const dx of [-1, 1]) {
        p.line(`M${f(145)} ${f(y - 2)}Q${f(145 + dx * 18)} ${f(y + 8)} ${f(145 + dx * 26)} ${f(y + 30)}`, 0.9);
        for (let k = 1; k <= 4; k++) p.dot(145 + dx * (6 + k * 5), y + k * 7, 1.4, WASH.leaf);
      }
    }
    p.shape(toothed(144, y, Math.PI + 0.45, 62 * s, 24 * s, 7, 0.3), WASH.green, 0.5, 1.2);
    p.shape(toothed(146, y, -0.45, 62 * s, 24 * s, 7, 0.3), WASH.green, 0.5, 1.2);
    p.fine(`M${f(144)} ${f(y)}L${f(144 - 52 * s)} ${f(y - 24 * s)}M${f(146)} ${f(y)}L${f(146 + 52 * s)} ${f(y - 24 * s)}`, 0.6, 0.45);
  });
  // Inset: one leaf close up, its teeth and the fine stinging hairs.
  inset(p);
  p.shape(toothed(52, 74, -0.75, 50, 17, 7, 0.3), WASH.green, 0.5, 1.1);
  p.fine('M60 66l-2 -5M68 62l1 -6M74 54l-3 -4M82 50l2 -5M70 70l4 -3M80 60l4 -2M64 58l-4 -2', 0.7, 0.75);
  p.fine('M104 64L128 120', 0.8, 0.4);
  p.label('hairs', 250, 50, 104, 52);
  p.label('leaves', 250, 140, 200, 128);
  p.label('flowers', 250, 270, 172, 290);
  p.scale(30, 64, 304, scale);
  return p.svg(380, 344, 'Field sketch of nettle');
}

/** Chamomile: a low feathery mat on sandy turf, white daisies with gold hearts on short stalks. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function chamomile(p, scale) {
  const f = p.f;
  p.tint('M40 214H236V250H40Z', WASH.sand, 0.45);
  p.line(wave(40, 236, 214, 1, 30), 1.5);
  for (const [x, y] of [[54, 226], [90, 240], [128, 228], [176, 242], [218, 228]]) p.dot(x, y, 1.1);
  // Flower stalks, then the mat over their feet.
  /** @type {[number, number, number, number][]} */
  const fl = [[104, 196, 92, 136], [138, 192, 142, 112], [170, 196, 192, 142]];
  for (const [bx, by, tx, ty] of fl) p.line(stem(bx, by, tx, ty, (tx - bx) * 0.2), 1.1);
  p.shape('M56 214C62 190 100 178 140 178S218 190 224 214Z', WASH.green, 0.4, 1.3);
  // Feathery leaves: fine forking lines over the mat.
  for (let x = 70; x <= 210; x += 12) {
    const y = 206 - 18 * Math.sin(Math.PI * (x - 56) / 168);
    p.fine(`M${x} ${f(y + 10)}L${x + 2} ${f(y)}M${x + 2} ${f(y + 4)}L${x - 3} ${f(y - 2)}M${x + 2} ${f(y + 4)}L${x + 7} ${f(y - 1)}`, 0.8, 0.55);
  }
  // The daisies: white petals round a domed gold heart.
  const daisy = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ s) => {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      p.shape(petal(cx + Math.cos(a) * 5 * s, cy + Math.sin(a) * 3 * s, cx + Math.cos(a) * 17 * s, cy + Math.sin(a) * 10 * s, 3.2 * s), WASH.petal, 0.95, 0.9);
    }
    p.oval(cx, cy - 1 * s, 6 * s, 5 * s, WASH.gold, 0.9, 1.1);
  };
  for (const [, , tx, ty] of fl) daisy(tx, ty, 1);
  // Inset: the heart close up, a dome of tiny gold florets.
  inset(p);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    p.shape(petal(74 + Math.cos(a) * 12, 62 + Math.sin(a) * 6, 74 + Math.cos(a) * 27, 62 + Math.sin(a) * 15, 4), WASH.petal, 0.95, 0.9);
  }
  p.shape('M60 64C60 50 88 50 88 64Z', WASH.gold, 0.9, 1.1);
  for (const [x, y] of [[66, 60], [72, 56], [78, 56], [84, 60], [70, 62], [78, 62], [74, 59]]) p.dot(x, y, 0.9);
  p.fine('M104 70L132 104', 0.8, 0.4);
  p.label('heart', 250, 50, 104, 54);
  p.label('flower', 250, 110, 204, 140);
  p.label('mat', 250, 196, 222, 204);
  p.scale(30, 112, 214, scale);
  return p.svg(380, 260, 'Field sketch of chamomile');
}
