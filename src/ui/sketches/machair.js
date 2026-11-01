// @ts-check
// Field sketches of the five machair plants of the meadow islet (B3a): harebell, bird's-foot
// trefoil, wild thyme, red clover and lady's bedstraw, drawn with the journal pen (pen.js) in the
// style of herbs.js. Each sheet stands the plant on shell-sand turf and, in a round inset at the top
// left, shows one close detail: a harebell's bell, trefoil's pea flowers, a thyme shoot's scented
// leaves, a clover leaflet's pale chevron, bedstraw's whorl of needle leaves. Flax (F1) follows, its
// inset one flat blue flower.
//
// Layout as herbs.js: a 380 x 260 sheet, the drawing in x 40..236 on a ground line at y 214, a
// scale bar at x 30, labels in the right column from x 250, each with a leader from what it names.

import { stem, along, wave, blade } from './pen.js';
import { WASH, petal } from './living.js';

const HAREBELL = '#9DB2DA';
const PEA = '#E8C547';
const THYME = '#C68BB8';
const CLOVER = '#D27A9A';

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/** A round inset at the top left holding one close detail, its rim drawn, its paper hiding what is behind. @param {import('./pen.js').Pen} p */
function inset(p, cx = 74, cy = 58, r = 30) {
  p.shape(`M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`, WASH.petal, 0.25, 1.1);
}

/**
 * Machair ground: pale shell sand under a thin turf, a few grains, broken shell bits, short blades.
 * @param {import('./pen.js').Pen} p
 */
function machair(p) {
  const f = p.f;
  p.tint('M40 214H236V250H40Z', WASH.sand, 0.45);
  p.line(wave(40, 236, 214, 1, 30), 1.5);
  for (const [x, y] of [[54, 226], [92, 240], [130, 230], [176, 242], [216, 228]]) p.dot(x, y, 1.1);
  // Broken shell: small open arcs in the sand.
  for (const [x, y] of [[70, 236], [150, 244], [200, 234]]) p.fine(`M${f(x)} ${f(y)}a4 3 0 0 1 8 0`, 0.8, 0.55);
  // A thin turf: short blades along the ground line.
  for (const x of [48, 64, 84, 196, 214, 230]) p.fine(`M${x} 214l-2 -7M${x + 3} 214l2 -6`, 0.8, 0.5);
}

/**
 * An ellipse from its base (bx, by) to its tip along angle a (radians), len long, w half wide: a
 * round-ended leaflet or leaf.
 * @param {number} bx @param {number} by @param {number} a @param {number} len @param {number} w
 */
function ell(bx, by, a, len, w) {
  const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
  const deg = r1((a * 180) / Math.PI), rx = r1(len / 2), ry = r1(w);
  return `M${r1(bx)} ${r1(by)}A${rx} ${ry} ${deg} 1 0 ${r1(tx)} ${r1(ty)}A${rx} ${ry} ${deg} 1 0 ${r1(bx)} ${r1(by)}Z`;
}

/**
 * A nodding bell hanging from its top (x, y), mouth down with five small lobes, s its size, tilt
 * its lean (radians, + swings the mouth to the left).
 * @param {number} x @param {number} y @param {number} s @param {number} tilt
 */
function bell(x, y, s, tilt) {
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  const pt = (/** @type {number} */ u, /** @type {number} */ v) => `${r1(x + (c * u - sn * v) * s)} ${r1(y + (sn * u + c * v) * s)}`;
  return `M${pt(-2, 0)}Q${pt(-6, 3)} ${pt(-6, 11)}L${pt(-8, 15)}Q${pt(-6, 13.4)} ${pt(-4, 15.2)}Q${pt(-2, 13.4)} ${pt(0, 15.2)}` +
    `Q${pt(2, 13.4)} ${pt(4, 15.2)}Q${pt(6, 13.4)} ${pt(8, 15)}L${pt(6, 11)}Q${pt(6, 3)} ${pt(2, 0)}Z`;
}

/** Harebell: wiry stems on the turf, grass-thin stem leaves, pale blue bells nodding on hair-thin stalks. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function harebell(p, scale) {
  const f = p.f;
  machair(p);
  /** @type {[number, number, number, number, number, number, number][]} base x, top x, top y, bend, bell x, bell y, tilt */
  const stems = [[136, 124, 104, -4, 112, 112, 0.25], [140, 160, 76, 6, 176, 84, -0.2], [144, 202, 112, 10, 216, 122, -0.3]];
  for (const [bx, tx, ty, bend, hx, hy, tilt] of stems) {
    p.line(stem(bx, 214, tx, ty, bend), 1.1);
    // The hair-thin stalk arching over, and the bell hanging from it.
    p.line(`M${f(tx)} ${f(ty)}Q${f((tx + hx) / 2)} ${f(Math.min(ty, hy) - 10)} ${f(hx)} ${f(hy)}`, 0.8);
    p.shape(bell(hx, hy, 1.05, tilt), HAREBELL, 0.75, 1.1);
    // Narrow, grass-like stem leaves.
    for (const [t, side] of [[0.3, -1], [0.55, 1]]) {
      const [x, y] = along(bx, 214, tx, ty, bend, t);
      p.shape(blade(x, y, x + side * 16, y - 14, 1.5, side * 2), WASH.leaf, 0.5, 0.9);
    }
  }
  // A second bell from a side stalk on the middle stem.
  const [sx, sy] = along(140, 214, 160, 76, 6, 0.72);
  p.line(`M${f(sx)} ${f(sy)}Q${f(sx - 10)} ${f(sy - 16)} ${f(sx - 18)} ${f(sy - 6)}`, 0.8);
  p.shape(bell(sx - 18, sy - 6, 0.9, 0.3), HAREBELL, 0.75, 1);
  // The round leaves at the foot, on short stalks (gone by the time it flowers).
  for (const [x, y, a] of [[120, 208, -2.6], [158, 206, -0.5], [172, 211, -0.2]]) {
    p.line(`M${f(140)} 214L${f(x)} ${f(y)}`, 0.8);
    p.shape(ell(x, y, a, 11, 4.6), WASH.leaf, 0.5, 1);
  }
  // Inset: one bell close up, its five lobes turned back and the style hanging below.
  inset(p);
  p.line('M58 34Q68 26 74 36', 0.9);
  p.shape(bell(74, 36, 2.1, 0), HAREBELL, 0.75, 1.2);
  p.fine('M74 40V62M66 44Q65 54 62 64M82 44Q83 54 86 64', 0.6, 0.4);
  p.fine('M74 68V78', 0.9, 0.7);
  p.dot(74, 79, 1.4);
  p.fine('M104 66L112 104', 0.8, 0.4);
  p.label('bell', 250, 50, 104, 54);
  p.label('stem', 250, 130, 192, 140);
  p.label('leaves', 250, 196, 180, 208);
  p.scale(30, 74, 214, scale);
  return p.svg(380, 260, 'Field sketch of harebell');
}

/**
 * A crown of pea flowers round the top of a stalk (cx, cy), fanned upward, n of them, len long;
 * bud picks one to draw closed and red-tipped.
 * @param {import('./pen.js').Pen} p @param {number} cx @param {number} cy @param {number} n @param {number} len @param {number} [bud]
 */
function peas(p, cx, cy, n, len, bud = -1) {
  for (let k = 0; k < n; k++) {
    const a = -Math.PI * 0.92 + (k / (n - 1)) * Math.PI * 0.84;
    const x1 = cx + Math.cos(a) * len, y1 = cy + Math.sin(a) * len;
    if (k === bud) {
      p.shape(petal(cx, cy, x1, y1, len * 0.18), WASH.red, 0.6, 0.9);
      continue;
    }
    // The broad banner behind, the narrow keel in front, tipped a little down.
    p.shape(petal(cx, cy, x1, y1, len * 0.34), PEA, 0.85, 0.9);
    const ka = a + 0.35;
    p.shape(petal(cx, cy, cx + Math.cos(ka) * len * 0.8, cy + Math.sin(ka) * len * 0.8, len * 0.14), PEA, 0.95, 0.8);
  }
  p.oval(cx, cy, len * 0.16, len * 0.14, WASH.green, 0.5, 0.8);
}

/** A leaf of three round leaflets fanned from (x, y), pointing along a. @param {import('./pen.js').Pen} p @param {number} x @param {number} y @param {number} a @param {number} s */
function trio(p, x, y, a, s) {
  for (const d of [-0.8, 0, 0.8]) p.shape(ell(x, y, a + d, 9 * s, 3 * s), WASH.leaf, 0.5, 0.8);
}

/** Bird's-foot trefoil: a low sprawling mat, crowns of yellow pea flowers, pods splayed like a bird's foot. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function trefoil(p, scale) {
  const f = p.f;
  machair(p);
  // Flower and pod stalks rise out of the mat, so they go behind it.
  /** @type {[number, number, number, number][]} */
  const stalks = [[110, 196, 112, 140], [146, 192, 160, 122], [184, 196, 200, 142]];
  for (const [bx, by, tx, ty] of stalks) p.line(stem(bx, by, tx, ty, (tx - bx) * 0.3), 1.1);
  // The mat: sprawling stems close to the sand, crowded with small three-part leaves.
  p.shape('M52 214C60 198 100 188 140 188S220 198 228 214Z', WASH.green, 0.35, 1.3);
  p.fine('M140 212C120 206 92 208 62 210M140 212C162 204 190 206 220 210M140 212C130 200 116 196 100 194', 0.9, 0.5);
  for (const [x, y, a] of [[72, 204, -2.2], [96, 196, -1.9], [124, 192, -1.6], [150, 192, -1.4], [176, 194, -1.2], [204, 202, -0.9]]) trio(p, x, y, a, 1.25);
  // Flower crowns; one has a bud still red at the tip.
  peas(p, 112, 140, 5, 18, 2);
  peas(p, 160, 122, 6, 19);
  // Ripe pods splayed from one point, like a bird's toes.
  for (const a of [0.15, 0.6, 1.05, 1.5]) p.shape(blade(200, 142, 200 + Math.cos(a) * 34, 142 + Math.sin(a) * 30, 2.2), WASH.brown, 0.55, 1);
  p.oval(200, 142, 2.6, 2.4, WASH.green, 0.5, 0.9);
  // Inset: one crown close up, the banner and keel of each flower and a red bud.
  inset(p);
  p.line('M74 72V88', 1);
  peas(p, 74, 72, 4, 22, 1);
  p.fine('M104 64L116 128', 0.8, 0.4);
  p.label('flower', 250, 50, 104, 54);
  p.label('pods', 250, 130, 228, 152);
  p.label('mat', 250, 196, 222, 204);
  p.scale(30, 107, 214, scale);
  return p.svg(380, 260, "Field sketch of bird's-foot trefoil");
}

/** Wild thyme: a woody creeping mat on the sand, short shoots of tiny paired leaves, round pink-purple heads. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function thyme(p, scale) {
  const f = p.f;
  machair(p);
  const top = (/** @type {number} */ x) => 214 - 22 * Math.sin(Math.PI * (x - 48) / 182);
  p.shape('M48 214C54 196 90 190 139 190S224 196 230 214Z', WASH.green, 0.35, 1.3);
  // Upright shoots off the mat, each with pairs of tiny oval leaves; most end in a flower head.
  for (let i = 0; i < 9; i++) {
    const x = 66 + i * 18, y0 = top(x) + 4, h = 16 + ((i * 5) % 3) * 6, y1 = y0 - h;
    p.line(`M${f(x)} ${f(y0)}L${f(x + 1)} ${f(y1)}`, 0.9);
    for (let k = 1; k <= 2; k++) {
      const y = y0 - (h * k) / 3;
      p.shape(ell(x, y, Math.PI + 0.5, 6, 2), WASH.leaf, 0.55, 0.7);
      p.shape(ell(x + 1, y, -0.5, 6, 2), WASH.leaf, 0.55, 0.7);
    }
    if (i % 4 !== 3) {
      p.oval(x + 1, y1 - 5, 7.5, 6.5, THYME, 0.8, 1);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i;
        p.dot(x + 1 + Math.cos(a) * 3.6, y1 - 5 + Math.sin(a) * 3, 0.8, '#9C5E8E');
      }
    }
  }
  // The woody stems creeping over the sand at the mat's foot, rooting as they go.
  p.line('M50 212C66 206 86 214 106 208S144 210 166 206S206 213 228 208', 1.4);
  p.fine('M78 211l-2 6M126 209l1 6M176 208l2 6M212 211l-1 5', 0.8, 0.55);
  // Inset: one shoot close up, its tiny oval leaves dotted with scent glands.
  inset(p);
  p.line('M74 86L75 34', 1.1);
  for (const [y, s] of [[74, 1], [58, 0.85], [44, 0.7]]) {
    p.shape(ell(74, y, Math.PI + 0.45, 18 * s, 6 * s), WASH.leaf, 0.55, 1);
    p.shape(ell(75, y, -0.45, 18 * s, 6 * s), WASH.leaf, 0.55, 1);
    for (const side of [-1, 1]) {
      for (const d of [6, 11]) p.dot(74.5 + side * Math.cos(0.45) * d * s, y - Math.sin(0.45) * d * s, 0.7);
    }
  }
  p.fine('M104 66L120 176', 0.8, 0.4);
  p.label('leaves', 250, 50, 104, 54);
  p.label('flower', 250, 120, 159, 158);
  p.label('mat', 250, 196, 226, 206);
  p.scale(30, 152, 214, scale);
  return p.svg(380, 260, 'Field sketch of wild thyme');
}

/**
 * A clover leaf: three oval leaflets fanned from (x, y) along a, each with its pale chevron.
 * @param {import('./pen.js').Pen} p @param {number} x @param {number} y @param {number} a @param {number} len
 */
function cloverLeaf(p, x, y, a, len) {
  for (const d of [-1.1, 0, 1.1]) {
    const b = a + d, c = Math.cos(b), s = Math.sin(b), w = len * 0.36;
    p.shape(ell(x, y, b, len, w), WASH.green, 0.5, 1);
    // The chevron: a pale V across the leaflet, its point toward the leaf's foot.
    const pt = (/** @type {number} */ u, /** @type {number} */ v) => `${r1(x + c * u * len - s * v * w)} ${r1(y + s * u * len + c * v * w)}`;
    const band = `M${pt(0.62, -0.62)}L${pt(0.4, 0)}L${pt(0.62, 0.62)}L${pt(0.7, 0.5)}L${pt(0.5, 0)}L${pt(0.7, -0.5)}Z`;
    p.tint(band, WASH.petal, 0.9);
    p.fine(band, 0.5, 0.4);
  }
}

/**
 * A round clover head at (cx, cy): a ball of tiny tube flowers, rx by ry.
 * @param {import('./pen.js').Pen} p @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 */
function cloverHead(p, cx, cy, rx, ry) {
  // Tube flowers standing out round the rim, then the ball itself.
  for (let k = 0; k < 11; k++) {
    const a = -Math.PI * 0.95 + (k / 10) * Math.PI * 0.9;
    p.shape(petal(cx + Math.cos(a) * rx * 0.7, cy + Math.sin(a) * ry * 0.7, cx + Math.cos(a) * rx * 1.25, cy + Math.sin(a) * ry * 1.2, 2.2), CLOVER, 0.85, 0.8);
  }
  p.oval(cx, cy, rx, ry, CLOVER, 0.75, 1.2);
  const f = p.f;
  for (const [u, v] of [[-0.5, -0.4], [0, -0.55], [0.5, -0.4], [-0.3, 0.05], [0.3, 0.05], [0, 0.45]]) {
    const x = cx + u * rx, y = cy + v * ry;
    p.fine(`M${f(x - 2.4)} ${f(y - 1.6)}L${f(x)} ${f(y + 1)}L${f(x + 2.4)} ${f(y - 1.6)}`, 0.6, 0.5);
  }
}

/** Red clover: leaves of three leaflets with pale chevrons, round pink-red heads on leafy stems. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function clover(p, scale) {
  machair(p);
  // Long-stalked leaves from the foot.
  /** @type {[number, number, number][]} */
  const leaves = [[98, 178, -2.3], [196, 176, -0.8], [154, 194, -1.3]];
  for (const [x, y] of leaves) p.line(stem(140, 214, x, y, (x - 140) * 0.2), 1);
  // Two flowering stems, a leaf partway up each.
  /** @type {[number, number, number, number][]} */
  const stems = [[136, 128, 106, -4], [146, 190, 132, 8]];
  for (const [bx, tx, ty, bend] of stems) p.line(stem(bx, 214, tx, ty, bend), 1.3);
  for (const [x, y, a] of leaves) cloverLeaf(p, x, y, a, 22);
  const [ax, ay] = along(136, 214, 128, 106, -4, 0.5);
  cloverLeaf(p, ax, ay, -2.6, 16);
  const [bx, by] = along(146, 214, 190, 132, 8, 0.55);
  cloverLeaf(p, bx, by, -0.4, 16);
  cloverHead(p, 128, 92, 13, 14);
  cloverHead(p, 190, 118, 12, 13);
  // Inset: one leaflet close up, its veins and the pale chevron across it.
  inset(p);
  p.shape(ell(52, 82, -0.75, 50, 15), WASH.green, 0.5, 1.2);
  const band = 'M70 46L66 68L88 72L82 66L72 64L76 50Z';
  p.tint(band, WASH.petal, 0.9);
  p.fine(band, 0.6, 0.45);
  p.fine('M52 82L88 50M62 73l-6 -10M70 66l-6 -12M78 59l-4 -12M64 73l12 4M72 66l12 3', 0.6, 0.45);
  p.fine('M104 66L114 160', 0.8, 0.4);
  p.label('leaf', 250, 50, 104, 54);
  p.label('head', 250, 110, 203, 114);
  p.label('stem', 250, 176, 171, 172);
  p.scale(30, 76, 214, scale);
  return p.svg(380, 260, 'Field sketch of red clover');
}

/**
 * A whorl of needle leaves round a stem at (x, y): n needles, len long, seen from the side.
 * @param {import('./pen.js').Pen} p @param {number} x @param {number} y @param {number} n @param {number} len
 */
function whorl(p, x, y, n, len) {
  const f = p.f;
  let d = '';
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    d += `M${f(x)} ${f(y)}L${f(x + Math.cos(a) * len)} ${f(y + Math.sin(a) * len * 0.45 - len * 0.25)}`;
  }
  p.line(d, 0.9);
}

/** Lady's bedstraw: wiry stems ringed with whorls of needle leaves, loose froths of tiny yellow flowers, red roots. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function bedstraw(p, scale) {
  const f = p.f;
  machair(p);
  // The red roots, running down through the sand.
  for (const [tx, ty, b] of [[112, 246, -4], [138, 250, 2], [166, 240, 4], [186, 228, 3]]) {
    p.shape(blade(140, 215, tx, ty, 1.8, b), WASH.red, 0.65, 0.9);
  }
  p.fine('M124 232l-6 3M150 238l6 2M172 226l6 -1', 0.7, 0.5);
  /** @type {[number, number, number, number, number, number, number][]} base, top x, top y, bend, froth rx, ry, flowers */
  const stems = [[134, 122, 98, -6, 15, 12, 18], [140, 170, 80, 4, 22, 15, 28], [146, 206, 120, 10, 15, 11, 18]];
  for (const [bx, tx, ty, bend] of stems) {
    p.line(stem(bx, 214, tx, ty, bend), 1.1);
    for (const [t, len] of [[0.2, 10], [0.42, 9], [0.62, 8], [0.8, 6]]) {
      const [x, y] = along(bx, 214, tx, ty, bend, t);
      whorl(p, x, y, 8, len);
    }
  }
  // The froths: loose sprays of tiny four-petalled flowers on fine branching stalks.
  for (const [, tx, ty, , rx, ry, n] of stems) {
    const cy = ty - ry * 0.5;
    for (const dx of [-0.8, -0.35, 0.35, 0.8]) p.fine(`M${f(tx)} ${f(ty + 6)}L${f(tx + dx * rx)} ${f(cy + ry * 0.2)}`, 0.8, 0.55);
    for (let k = 0; k < n; k++) {
      const a = k * 2.39996, rr = Math.sqrt((k + 0.5) / n);
      p.oval(tx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, 2.6, 2.4, WASH.yellow, 0.85, 0.7);
    }
  }
  // Inset: one whorl close up from above, eight needles round the stem, each rolled at the edge.
  inset(p);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const tx = 74 + Math.cos(a) * 25, ty = 58 + Math.sin(a) * 25;
    p.shape(blade(74 + Math.cos(a) * 4, 58 + Math.sin(a) * 4, tx, ty, 2.6), WASH.green, 0.5, 1);
    p.fine(`M${f(74 + Math.cos(a) * 6)} ${f(58 + Math.sin(a) * 6)}L${f(74 + Math.cos(a) * 21)} ${f(58 + Math.sin(a) * 21)}`, 0.5, 0.45);
  }
  p.oval(74, 58, 4.5, 4.5, WASH.green, 0.5, 1.1);
  p.fine('M104 64L124 160', 0.8, 0.4);
  p.label('whorl', 250, 50, 104, 54);
  p.label('flower', 250, 110, 194, 74);
  p.label('root', 250, 236, 168, 238);
  p.scale(30, 66, 214, scale);
  return p.svg(380, 260, "Field sketch of lady's bedstraw");
}

const FLAX = '#8FB0E2';

/**
 * A flat five-petal flax flower seen from the front at (cx, cy), r across each petal.
 * @param {import('./pen.js').Pen} p @param {number} cx @param {number} cy @param {number} r
 */
function flaxFlower(p, cx, cy, r) {
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
    p.shape(petal(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.95), FLAX, 0.8, 0.9);
  }
  p.dot(cx, cy, Math.max(0.9, r * 0.16));
}

/**
 * Flax (F1): three slender stems straight up from the islet's grassy turf, short narrow leaves all
 * the way up, flat sky-blue flowers on two tips and round seed bolls on the third. Inset: one flower
 * from the front, its five petals veined from the middle.
 * @param {import('./pen.js').Pen} p @param {string} scale
 */
export function flax(p, scale) {
  const f = p.f;
  machair(p);
  /** @type {[number, number, number, number][]} base x, top x, top y, bend */
  const stems = [[128, 118, 70, -3], [142, 150, 56, 2], [156, 196, 84, 6]];
  for (const [bx, tx, ty, bend] of stems) {
    p.line(stem(bx, 214, tx, ty, bend), 1.1);
    // Short narrow leaves all the way up, alternate sides.
    for (let k = 0; k < 7; k++) {
      const t = 0.12 + k * 0.11, side = k % 2 ? 1 : -1;
      const [x, y] = along(bx, 214, tx, ty, bend, t);
      p.shape(blade(x, y, x + side * 10, y - 12, 1.4, side), WASH.leaf, 0.5, 0.8);
    }
  }
  // Flowers on the first two stems, a short branch to a second on the middle one.
  flaxFlower(p, 118, 64, 8);
  flaxFlower(p, 150, 50, 8);
  const [bx2, by2] = along(142, 214, 150, 56, 2, 0.86);
  p.line(`M${f(bx2)} ${f(by2)}Q${f(bx2 + 10)} ${f(by2 - 8)} ${f(bx2 + 16)} ${f(by2 - 6)}`, 0.8);
  flaxFlower(p, bx2 + 18, by2 - 8, 6.5);
  // Seed bolls on the third: round, with a pointed tip, on short stalks.
  for (const [x, y] of [[196, 80], [208, 92], [186, 92]]) {
    p.line(`M196 86L${x} ${y}`, 0.7);
    p.oval(x, y - 3, 4, 4.4, WASH.spent, 0.6, 1);
    p.fine(`M${x} ${y - 7.4}V${y - 10}`, 0.7, 0.7);
  }
  // Inset: one flower close up, veins running out from the middle.
  inset(p);
  flaxFlower(p, 74, 58, 22);
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
    p.fine(`M${r1(74 + Math.cos(a) * 5)} ${r1(58 + Math.sin(a) * 5)}L${r1(74 + Math.cos(a) * 17)} ${r1(58 + Math.sin(a) * 17)}`, 0.6, 0.45);
  }
  p.label('flower', 250, 50, 158, 50);
  p.label('boll', 250, 110, 212, 92);
  p.label('stem', 250, 190, 146, 170);
  p.scale(30, 56, 214, scale);
  return p.svg(380, 260, 'Field sketch of flax');
}
