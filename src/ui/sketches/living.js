// @ts-check
// Field sketches of the living things (J1.6): grass, rushes, reeds, water lilies, yellow flag iris,
// sea thrift, marsh marigold, sea campion and grey willow, each drawn with the journal pen (pen.js) so pencil, ink and wash come from one drawing.
//
// Layout for every sheet (380 wide): the drawing sits in x 40..236 on a ground line, a scale bar
// (when there is one) at x 30 on the left, and labels in the right column from x 250, each with a
// leader from a point on the thing it names. Shapes are solid and drawn back to front; everything
// grows from or rests on something.

import { blade, stem, along, wave, cubicPoints, yAt, xAt, polyline } from './pen.js';

export const WASH = Object.freeze({
  green: '#7E9B5E', leaf: '#93AE6E', brown: '#7A5236', water: '#9DB9C8', mud: '#8A6F55', sand: '#D9C49A',
  pink: '#D98AA8', spent: '#C9B49E', yellow: '#E3BE3A', petal: '#F1E9E2', gold: '#E2C25A', grey: '#9A9C94',
  red: '#B9483E', blue: '#6E8EC0', tip: '#3E3833',
});

/** A pointed petal from its base to its tip, widest in the middle. @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} w */
export function petal(x0, y0, x1, y1, w) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len * w, ny = (x1 - x0) / len * w;
  const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  return `M${r(x0)} ${r(y0)}Q${r(mx + nx)} ${r(my + ny)} ${r(x1)} ${r(y1)}Q${r(mx - nx)} ${r(my - ny)} ${r(x0)} ${r(y0)}Z`;
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function reeds(p, scale) {
  const f = p.f;
  p.tint('M20 300H340V318H20Z', WASH.water, 0.35);
  p.tint('M20 318H340V352H20Z', WASH.mud, 0.22);
  p.line(wave(20, 340, 300, 2, 40), 1.6);
  p.fine('M52 308h20M110 310h26M206 309h22M248 311h18M300 309h20', 1, 0.5);
  for (const [bx, tx, ty, w, bend] of [[146, 96, 150, 3, -8], [163, 226, 156, 3, 6], [155, 180, 112, 3, -4], [140, 70, 228, 3, 8], [171, 246, 252, 3, -6]]) {
    p.shape(blade(bx, 300, tx, ty, w, bend), WASH.green, 0.38, 1.3);
  }
  /** @type {[number, number, number, number[] | null][]} */
  const stems = [[150, 140, 54, [86, 140]], [162, 172, 74, [104, 152]], [140, 118, 98, [126, 170]],
    [170, 196, 120, null], [156, 156, 40, null], [146, 128, 150, null], [176, 214, 150, null]];
  for (const [bx, tx, ty, head] of stems) {
    p.line(stem(bx, 300, tx, ty, (tx - bx) * 0.15), 1.6);
    if (!head) continue;
    const [y0, y1] = head;
    const t0 = (y0 - ty) / (300 - ty), t1 = (y1 - ty) / (300 - ty);
    const x0 = tx + (bx - tx) * t0, x1 = tx + (bx - tx) * t1;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = y1 - y0;
    const ang = Math.atan2(x1 - x0, y1 - y0) * -180 / Math.PI;
    // Heads are drawn upright, then turned with their stem.
    const body = `M${f(cx - 7)} ${f(cy - h / 2 + 7)}a7 7 0 0 1 14 0V${f(cy + h / 2 - 7)}a7 7 0 0 1 -14 0Z`;
    const sub = p.sub();
    sub.line(`M${f(cx)} ${f(cy - h / 2)}V${f(cy - h / 2 - 22)}`, 1.3);
    sub.shape(body, WASH.brown, 0.75, 1.6);
    for (let y = cy - h / 2 + 8; y < cy + h / 2 - 6; y += 6) sub.fine(`M${f(cx - 5)} ${f(y + 3)}L${f(cx + 5)} ${f(y)}`);
    p.raw(`<g transform="rotate(${f(ang)} ${f(cx)} ${f(cy)})">${sub.take()}</g>`);
  }
  // The clump's stems carry on under the water, down to the creeping root in the mud.
  p.fine('M146 302L150 334M152 302L154 335M158 302L158 335M164 302L162 334M170 302L166 333', 1, 0.55);
  p.line('M60 334C100 326 130 340 170 332S240 326 278 336', 2);
  p.fine('M90 331l-4 10M120 334l3 9M200 330l-3 10M246 331l4 9', 0.9, 0.8);
  p.line('M252 332C252 318 254 306 258 292', 1.4);
  p.shape(blade(258, 294, 270, 274, 2.5), WASH.green, 0.6, 1);
  p.label('spike', 196, 34, 170, 84);
  p.label('head', 204, 104, 177, 128);
  p.label('blade', 262, 262, 246, 252);
  p.label('root', 226, 370, 200, 331);
  p.scale(362, 54, 300, scale);
  return p.svg(380, 400, 'Field sketch of reeds');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function grass(p, scale) {
  p.tint('M40 228H236V286H40Z', WASH.mud, 0.22);
  p.line(wave(40, 236, 228, 1.5, 28), 1.6);
  // Roots under the tuft, each side root growing from a main root.
  /** @type {[number, number, number, number, number][]} */
  const roots = [[118, 230, 84, 282, -10], [118, 230, 120, 286, 2], [118, 230, 154, 280, 10]];
  for (const r of roots) p.line(stem(...r), 1.1);
  for (const [i, t, dx, dy] of [[0, 0.55, -14, 8], [2, 0.55, 14, 8], [1, 0.7, -10, 7], [1, 0.7, 10, 7]]) {
    const [x, y] = along(...roots[i], t);
    p.line(stem(x, y, x + dx, y + dy, 0), 0.8);
  }
  // A flowering stalk rising up the middle; its seed heads hang from it.
  const S = /** @type {[number, number, number, number, number]} */ ([118, 226, 120, 30, 2]);
  p.line(stem(...S), 1.2);
  // Blades, the outer ones first so the inner ones lie in front; uneven, as a real tuft is.
  const tips = [[46, 146], [60, 112], [82, 98], [98, 74], [114, 90], [134, 70], [150, 96], [168, 84], [190, 124], [208, 150]];
  for (const i of [0, 9, 1, 8, 2, 7, 3, 6, 4, 5]) {
    const [tx, ty] = tips[i];
    p.shape(blade(100 + i * 4, 228, tx, ty, 2.4, (i - 4.5) * 2.2 + (i % 3) - 1), WASH.leaf, 0.42, 1.1);
  }
  for (let k = 0; k < 6; k++) {
    const [x, y] = along(...S, 1 - (0.03 + k * 0.04));
    const side = k % 2 ? 1 : -1;
    p.shape(petal(x, y, x + side * 11, y - 6, 3.2), WASH.brown, 0.6, 0.9);
  }
  const [sx, sy] = along(...S, 0.99);
  p.label('seed', 250, 44, sx + 4, sy + 2);
  p.label('base', 250, 214, 146, 229);
  const [rx, ry] = along(...roots[2], 0.55);
  p.label('roots', 250, 262, rx + 14, ry + 8);
  p.scale(30, 30, 228, scale);
  return p.svg(380, 300, 'Field sketch of grass');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function rushes(p, scale) {
  const f = p.f;
  // The marsh in section: shallow water over a soft bed that rises to a low bank on the right.
  const WATER = 236;
  const bed = cubicPoints([40, 272, 120, 278, 190, 262, 236, 226]);
  const edge = xAt(bed.slice(32), WATER);   // where the bed comes up through the water
  const inWater = bed.filter(([x]) => x <= edge);
  p.tint(`${polyline(bed)}V306H40Z`, WASH.mud, 0.22);
  p.line(polyline(bed), 1.3);

  // The tussock: a mound of old stem bases on the bed, its top just under the water.
  const left = 112, right = 166, top = 242;
  const crownTop = (/** @type {number} */ x) => top + 7 * ((x - 139) / 27) ** 2;
  // A sedge grows at the tussock's left side, behind the rushes: flat leaves arching out and one
  // three-sided stalk with a brown spike hanging from its top.
  p.shape(blade(118, crownTop(118), 46, 182, 2.6, -10), WASH.leaf, 0.42, 1);
  p.shape(blade(121, crownTop(121), 58, 214, 2.4, -6), WASH.leaf, 0.42, 1);
  const sedge = /** @type {[number, number, number, number, number]} */ ([119, crownTop(119), 52, 88, -6]);
  p.line(stem(...sedge), 1.5);
  p.fine(stem(sedge[0] + 1.2, sedge[1], sedge[2] + 0.8, sedge[3] + 2, sedge[4]), 0.6, 0.5);
  p.shape(petal(52, 88, 44, 112, 3.2), WASH.brown, 0.7, 1);

  // The rush stems, round and leafless, rising from the crown: outer ones first so the inner
  // ones stand in front. [base x, tip x, tip y]
  /** @type {[number, number, number][]} */
  const stems = [[124, 66, 104], [154, 214, 96], [127, 86, 70], [151, 196, 66], [130, 106, 46], [147, 180, 52],
    [133, 118, 92], [144, 164, 84], [135, 124, 30], [141, 150, 36], [138, 138, 58]];
  /** @type {[number, number, number, number, number][]} */ const S = stems.map(([bx, tx, ty]) => [bx, crownTop(bx) + 2, tx, ty, (tx - bx) * 0.06]);
  for (const s of S) p.shape(blade(s[0], s[1], s[2], s[3], 1.7, s[4]), WASH.green, 0.45, 1);
  // The crown in front of the stem bases, on the bed, roots down into the mud.
  const crown = `M${left} ${f(yAt(bed, left))}C${left + 2} ${top + 6} ${left + 14} ${top} 139 ${top}` +
    `C${right - 14} ${top} ${right - 2} ${top + 6} ${right} ${f(yAt(bed, right))}` +
    `${polyline(bed.filter(([x]) => x > left && x < right).reverse()).replace('M', 'L')}Z`;
  p.shape(crown, WASH.mud, 0.55, 1.3);
  for (const x of [122, 132, 146, 156]) p.fine(`M${x} ${f(crownTop(x) + 4)}L${f(x + (x - 139) * 0.15)} ${f(yAt(bed, x) - 3)}`, 0.8, 0.5);
  for (const [x, dx] of [[120, -6], [132, -2], [146, 3], [158, 7]]) {
    const y = yAt(bed, x);
    p.line(stem(x, y, x + dx, y + 18, dx * 0.4), 0.9);
  }
  // The water over the crown and the lower stems, and its surface.
  p.tint(`M40 ${WATER}H${f(edge)}${polyline(inWater.slice().reverse()).replace('M', 'L')}Z`, WASH.water, 0.32);
  p.line(wave(40, edge, WATER, 1.3, 26), 1.3);

  // Flowers: a loose brown cluster breaking out of one side of a stem, a little below its tip,
  // each floret on its own short stalk.
  /** @param {[number, number, number, number, number]} s @param {number} t @param {number} side */
  const cluster = (s, t, side) => {
    const [x, y] = along(...s, t);
    for (const [ang, len] of [[-40, 9], [-18, 11], [4, 10], [24, 8], [-58, 7], [44, 6]]) {
      const a = (side > 0 ? ang : 180 - ang) * Math.PI / 180;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len + len * 0.15;
      p.fine(`M${f(x)} ${f(y)}Q${f((x + ex) / 2)} ${f((y + ey) / 2 - 1.5)} ${f(ex)} ${f(ey)}`, 0.8, 0.8);
      p.dot(ex, ey, 1.7, WASH.brown);
    }
    return [x, y];
  };
  const [fx, fy] = cluster(S[3], 0.78, 1);
  cluster(S[8], 0.82, 1);
  cluster(S[2], 0.8, -1);

  p.label('tuft', 250, 44, fx + 12, fy - 6);
  const [sx, sy] = along(...S[1], 0.55);
  p.label('stem', 250, 150, sx + 2, sy);
  p.label('base', 250, 282, right + 1, yAt(bed, right) - 4);
  p.scale(30, 30, top, scale);
  return p.svg(380, 312, 'Field sketch of rushes and sedges');
}

/** A notched lily pad seen low, its notch toward angle a. @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} a */
function pad(cx, cy, rx, ry, a) {
  const x1 = cx + rx * Math.cos(a + 0.28), y1 = cy + ry * Math.sin(a + 0.28);
  const x2 = cx + rx * Math.cos(a - 0.28), y2 = cy + ry * Math.sin(a - 0.28);
  const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  return `M${r(cx)} ${r(cy)}L${r(x1)} ${r(y1)}A${rx} ${ry} 0 1 1 ${r(x2)} ${r(y2)}Z`;
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function lilies(p, scale) {
  p.tint('M40 128H236V284H40Z', WASH.water, 0.32);
  p.tint('M40 284C100 280 160 288 236 283V316H40Z', WASH.mud, 0.25);
  p.line(wave(40, 236, 128, 1.5, 28), 1.4);
  p.line('M40 284C100 280 160 288 236 283', 1.3);
  // Each pad rises on its own stalk from the resting root in the mud.
  /** @type {[number, number, number, number, number][]} */
  const stalks = [[76, 131, 104, 286, -6], [132, 130, 140, 284, 4], [196, 132, 180, 286, 8]];
  for (const s of stalks) p.line(stem(...s), 1.1);
  p.shape('M84 292C108 280 176 282 200 292C176 304 108 304 84 292Z', WASH.brown, 0.55, 1.6);
  for (const x of [100, 128, 156, 184]) p.line(`M${x} 300l${x < 140 ? -3 : 3} 12`, 0.9);
  p.shape(pad(76, 128, 32, 8, 0.6), WASH.green, 0.5, 1.4);
  p.shape(pad(132, 128, 15, 5, 2.4), WASH.green, 0.5, 1.2);
  p.shape(pad(196, 128, 36, 9, 2.8), WASH.green, 0.5, 1.4);
  p.fine('M76 128l-20 4M76 128l18 5M196 128l-22 4M196 128l20 5', 0.7, 0.5);
  // The flower sits on the right pad: back petals, upright ones, then the front ones.
  const fx = 196, fy = 125;
  for (const [tx, ty, w] of [[168, 114, 8], [224, 114, 8], [176, 98, 9], [216, 98, 9]]) p.shape(petal(fx, fy, tx, ty, w), WASH.petal, 0.95, 1.1);
  p.oval(fx, 104, 7, 4, WASH.gold, 0.9, 1);
  for (const [tx, ty, w] of [[186, 92, 8], [206, 92, 8], [178, 120, 7], [214, 120, 7], [196, 112, 6]]) p.shape(petal(fx, fy, tx, ty, w), WASH.petal, 0.95, 1.1);
  p.label('flower', 250, 72, 208, 92);
  p.label('pad', 250, 136, 232, 128);
  const [sx, sy] = along(...stalks[2], 0.5);
  p.label('stalk', 250, 206, sx, sy);
  p.label('root', 250, 300, 200, 292);
  p.scale(30, 128, 284, scale);
  return p.svg(380, 330, 'Field sketch of water lilies');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function iris(p, scale) {
  p.tint('M40 284H236V330H40Z', WASH.mud, 0.22);
  // The ground line stops at the root, which lies half above the soil.
  p.line(wave(40, 92, 284, 1.5, 26), 1.6);
  p.line(wave(194, 236, 284, 1.5, 21), 1.6);
  // The flower stalk rises from the middle of the fan, behind the leaves.
  const S = /** @type {[number, number, number, number, number]} */ ([140, 280, 150, 62, -4]);
  p.line(stem(...S), 1.4);
  /** @type {[number, number, number, number, number][]} */
  const leaves = [[116, 280, 52, 128, -10], [124, 280, 80, 96, -7], [132, 280, 114, 82, -3],
    [150, 280, 184, 86, 3], [158, 280, 206, 104, 7], [166, 280, 224, 132, 10]];
  for (const i of [0, 5, 1, 4, 2, 3]) {
    const [bx, by, tx, ty, bend] = leaves[i];
    p.shape(blade(bx, by, tx, ty, 5.5, bend), WASH.green, 0.42, 1.3);
    p.fine(stem(bx, by - 4, tx, ty, bend * 0.8), 0.6, 0.45);
  }
  // The thick root, drawn last so the leaves grow out of it.
  p.shape('M92 286C110 274 176 274 194 286C176 298 110 298 92 286Z', WASH.brown, 0.5, 1.6);
  for (const x of [110, 140, 170]) p.line(`M${x} 294l${x < 140 ? -3 : x > 140 ? 3 : 0} 13`, 0.9);
  // The flower: three upright standards, then three falls in front of them.
  const fx = 150, fy = 60;
  for (const [tx, ty] of [[138, 26], [150, 18], [162, 26]]) p.shape(petal(fx, fy, tx, ty, 6.5), WASH.yellow, 0.85, 1.1);
  for (const [tx, ty] of [[116, 80], [150, 94], [184, 80]]) {
    p.shape(petal(fx, fy, tx, ty, 11), WASH.yellow, 0.85, 1.2);
    p.fine(`M${fx} ${fy + 3}L${(fx + tx) / 2} ${(fy + ty) / 2 + 2}`, 0.7, 0.6);
  }
  p.label('falls', 250, 36, 163, 27);
  p.label('leaves', 250, 128, 222, 128);
  p.label('root', 250, 296, 194, 286);
  p.scale(30, 24, 284, scale);
  return p.svg(380, 340, 'Field sketch of yellow flag iris');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function thrift(p, scale) {
  p.tint('M40 208H236V248H40Z', WASH.sand, 0.45);
  p.line(wave(40, 236, 208, 1.2, 28), 1.5);
  for (const [x, y] of [[50, 220], [84, 236], [118, 222], [150, 240], [182, 226], [214, 238], [228, 218]]) p.dot(x, y, 1.1);
  // The cushion is half an ellipse sitting on the sand.
  const top = (/** @type {number} */ x) => 208 - 68 * Math.sqrt(Math.max(0, 1 - ((x - 140) / 80) ** 2));
  // Flower stalks rise out of the cushion (drawn first, so the cushion hides their feet).
  /** @type {[number, number, number][]} */
  const heads = [[96, 76, 72], [120, 108, 50], [140, 140, 40], [160, 172, 50], [184, 204, 72]];
  for (const [bx, tx, ty] of heads) p.line(stem(bx, top(bx) + 8, tx, ty, (tx - bx) * 0.15), 1.1);
  p.shape('M60 208A80 68 0 0 1 220 208Z', WASH.green, 0.45, 1.4);
  for (let x = 74; x <= 206; x += 9) {
    const t = top(x);
    if (t + 20 < 204) p.fine(`M${x} ${p.f(t + 20)}L${x + 3} ${p.f(t + 8)}`, 0.8, 0.55);
  }
  // Papery pompoms on the stalks; the last has gone to seed.
  heads.forEach(([, tx, ty], i) => {
    if (i === heads.length - 1) {
      // Gone to seed: a papery head with a soft, scalloped edge.
      let d = '';
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2, b = ((k - 0.5) / 10) * Math.PI * 2;
        const x = tx + Math.cos(a) * 11, y = ty + Math.sin(a) * 11;
        d += k ? `Q${p.f(tx + Math.cos(b) * 14)} ${p.f(ty + Math.sin(b) * 14)} ${p.f(x)} ${p.f(y)}` : `M${p.f(x)} ${p.f(y)}`;
      }
      p.shape(`${d}Z`, WASH.spent, 0.8, 1.1);
      for (const [dx, dy] of [[-4, -2], [3, 2], [0, -5], [4, -4]]) p.dot(tx + dx, ty + dy, 1.3);
      return;
    }
    p.oval(tx, ty, 12, 12, WASH.pink, 0.75, 1.2);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      p.dot(tx + Math.cos(a) * 6.5, ty + Math.sin(a) * 6.5, 1.5);
    }
  });
  p.label('pompom', 250, 40, 184, 48);
  p.label('seeds', 250, 96, 218, 74);
  p.label('cushion', 250, 176, 215, 184);
  p.scale(30, 40, 208, scale);
  return p.svg(380, 260, 'Field sketch of sea thrift');
}

/**
 * A kidney-shaped leaf, notched where its stalk meets it, as marsh marigold's.
 * @param {number} cx @param {number} cy @param {number} w half width @param {number} h height
 */
function kidney(cx, cy, w, h) {
  const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  return `M${r(cx)} ${r(cy + 0.22 * h)}C${r(cx - 1.05 * w)} ${r(cy + 0.55 * h)} ${r(cx - 1.05 * w)} ${r(cy - 0.75 * h)} ${r(cx)} ${r(cy - 0.5 * h)}` +
    `C${r(cx + 1.05 * w)} ${r(cy - 0.75 * h)} ${r(cx + 1.05 * w)} ${r(cy + 0.55 * h)} ${r(cx)} ${r(cy + 0.22 * h)}Z`;
}

/**
 * A rounded petal seen from the side, from its base (bx, by) up to its round top (tx, ty), w half
 * wide at its widest: a buttercup's or a marigold's cup petal.
 * @param {number} bx @param {number} by @param {number} tx @param {number} ty @param {number} w
 */
function lobe(bx, by, tx, ty, w) {
  const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  const my = by - (by - ty) * 0.45;
  return `M${r(bx)} ${r(by)}C${r(bx - w * 0.6)} ${r(my)} ${r(tx - w * 1.15)} ${r(ty + w * 0.2)} ${r(tx)} ${r(ty)}` +
    `C${r(tx + w * 1.15)} ${r(ty + w * 0.2)} ${r(bx + w * 0.6)} ${r(my)} ${r(bx)} ${r(by)}Z`;
}

/** Marsh marigold: round glossy leaves on stalks at the water's soaked edge, golden cups above. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function marigold(p, scale) {
  // Soaked mud at the water's edge, the water itself on the left.
  p.tint('M40 262H96V300H40Z', WASH.water, 0.35);
  p.tint('M96 262H236V300H96Z', WASH.mud, 0.3);
  p.line(wave(40, 96, 262, 1.4, 18), 1.4);
  p.line(wave(96, 236, 262, 1.2, 26), 1.6);
  p.fine('M108 274h16M150 280h22M198 276h18', 0.9, 0.5);
  // Flower stalks first, so the leaves hide their feet.
  /** @type {[number, number, number, number][]} */
  const flowers = [[128, 262, 104, 104], [150, 262, 158, 78], [170, 262, 204, 112]];
  for (const [bx, by, tx, ty] of flowers) p.line(stem(bx, by, tx, ty, (tx - bx) * 0.2), 1.3);
  // Leaves on their own stalks, back ones first; each is notched where its stalk joins.
  /** @type {[number, number, number, number, number][]} */
  const leaves = [[124, 262, 92, 196, 26], [178, 262, 206, 190, 26], [140, 262, 126, 176, 30], [160, 262, 172, 168, 30], [150, 262, 150, 214, 34]];
  for (const [bx, by, cx, cy, w] of leaves) {
    p.line(stem(bx, by, cx, cy + 0.2 * w * 0.9, (cx - bx) * 0.1), 1.2);
    p.shape(kidney(cx, cy, w, w * 0.9), WASH.leaf, 0.5, 1.3);
    // Veins fan out from the notch, and a glint where the leaf is glossy.
    for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) p.fine(`M${cx} ${p.f(cy + 0.16 * w)}L${p.f(cx + Math.sin(a) * w * 0.75)} ${p.f(cy + 0.16 * w - Math.cos(a) * w * 0.6)}`, 0.6, 0.45);
  }
  // Golden cups, seen from the side as a buttercup's: two back petals, the boss of stamens showing
  // over the rim, then three rounded front petals curving up from the stalk's top.
  const cup = (/** @type {number} */ fx, /** @type {number} */ fy, /** @type {number} */ s) => {
    const base = fy + s * 0.5;
    for (const dx of [-0.5, 0.5]) p.shape(lobe(fx + dx * s * 0.3, base, fx + dx * s, fy - s * 0.35, s * 0.42), WASH.yellow, 0.6, 1);
    for (let k = 0; k < 7; k++) p.dot(fx + (k - 3) * s * 0.12, fy - s * 0.12 - (k % 2) * s * 0.1, 0.9);
    for (const dx of [-0.9, 0.9, 0]) p.shape(lobe(fx + dx * s * 0.3, base, fx + dx * s, fy - (dx ? 0 : s * 0.2), s * 0.48), WASH.yellow, 0.9, 1.1);
  };
  cup(104, 104, 20); cup(158, 78, 22);
  // The third has gone over: a star of seed pods where the flower was.
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k / 7) * Math.PI * 2;
    p.shape(petal(204, 112, 204 + Math.cos(a) * 13, 112 + Math.sin(a) * 11, 3.6), WASH.green, 0.55, 1);
  }
  p.label('flower', 250, 60, 172, 70);
  p.label('seeds', 250, 112, 216, 110);
  p.label('leaves', 250, 192, 226, 192);
  p.scale(30, 70, 262, scale);
  return p.svg(380, 310, 'Field sketch of marsh marigold');
}

/** Sea campion: a low grey mat on rock above the tide, white flowers over swollen calyces. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function campion(p, scale) {
  // Rock above the tide: two stones' backs, and a crack the mat grows from.
  p.shape('M40 236C52 214 92 206 128 212C150 216 160 230 164 244H40Z', WASH.grey, 0.4, 1.5);
  p.shape('M160 244C164 222 196 210 222 216C232 220 236 230 236 244Z', WASH.grey, 0.35, 1.5);
  p.line('M40 244H236', 1.4);
  p.fine('M70 226l14 6M104 220l10 10M196 226l12 4', 0.8, 0.5);
  p.line('M150 222C154 232 158 238 162 244', 1.1);
  // The loose mat of narrow, waxy leaves, spilling over the rock.
  /** @type {[number, number, number, number, number][]} */
  const leaves = [[156, 226, 96, 206, -4], [156, 226, 118, 196, -3], [158, 224, 140, 190, -2], [160, 224, 180, 190, 2],
    [160, 226, 204, 198, 3], [162, 228, 222, 210, 4], [154, 228, 84, 218, -3]];
  for (const [bx, by, tx, ty, bend] of leaves) p.shape(blade(bx, by, tx, ty, 4.2, bend), WASH.grey, 0.5, 1.1);
  for (const [bx, by, tx, ty, bend] of [[158, 224, 128, 202, -2], [160, 224, 192, 202, 2]]) p.shape(blade(bx, by, tx, ty, 3.6, bend), WASH.leaf, 0.45, 1.1);
  // Flowers on short stalks: the calyx swells like a papery balloon, the petals spread above it.
  /** @type {[number, number, number][]} */
  const fl = [[112, 120, 1], [156, 96, 1.1], [200, 124, 0.95]];
  for (const [fx, fy, s] of fl) {
    p.line(stem(158, 222, fx, fy + 30 * s, (fx - 158) * 0.2), 1.1);
    const cy = fy + 17 * s;
    p.oval(fx, cy, 9 * s, 14 * s, WASH.petal, 0.6, 1.2);
    for (const dx of [-5, -2, 2, 5]) p.fine(`M${p.f(fx + dx * s)} ${p.f(cy - 12 * s)}Q${p.f(fx + dx * 1.6 * s)} ${p.f(cy)} ${p.f(fx + dx * s)} ${p.f(cy + 12 * s)}`, 0.6, 0.55);
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + ((k - 2) / 4) * Math.PI * 0.95;
      const tx = fx + Math.cos(a) * 17 * s, ty = fy + Math.sin(a) * 12 * s;
      p.shape(petal(fx, fy, tx, ty, 6 * s), WASH.petal, 0.95, 1.1);
      // Each petal is notched at its tip.
      p.fine(`M${p.f(tx)} ${p.f(ty)}L${p.f(fx + Math.cos(a) * 13 * s)} ${p.f(fy + Math.sin(a) * 9 * s)}`, 0.7, 0.7);
    }
  }
  p.label('flower', 250, 66, 166, 84);
  p.label('calyx', 250, 132, 209, 140);
  p.label('mat', 250, 200, 220, 210);
  p.scale(30, 80, 244, scale);
  return p.svg(380, 260, 'Field sketch of sea campion');
}

/** Grey willow: a many-stemmed bush on a damp bank, catkins on a bare twig, seeds drifting off on fluff. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function willow(p, scale) {
  const f = p.f;
  // The damp bank, the pond's edge on the left.
  p.tint('M40 300H92V330H40Z', WASH.water, 0.35);
  p.tint('M92 300H236V330H92Z', WASH.mud, 0.25);
  p.line(wave(40, 92, 300, 1.3, 18), 1.4);
  p.line(wave(92, 236, 300, 1.2, 24), 1.6);
  // Stems fanning up from one stool (drawn first: the crown hides their tops and forks).
  /** @type {[number, number, number, number, number][]} */
  const stems = [[146, 298, 82, 160, -10], [148, 298, 110, 120, -6], [151, 298, 148, 100, 2], [154, 298, 188, 118, 6], [156, 298, 212, 160, 10]];
  for (const s of stems) p.line(stem(...s), 1.8);
  // The crown: one soft, lobed mass of leaves, low and rounded.
  /** @type {[number, number][]} */ const rim = [];
  for (let k = 0; k <= 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const r = 1 + 0.07 * Math.sin(a * 7 + 0.6) + 0.04 * Math.sin(a * 11);
    rim.push([143 + Math.cos(a) * 88 * r, 150 + Math.sin(a) * 70 * r]);
  }
  p.shape(`${polyline(rim)}Z`, WASH.leaf, 0.45, 1.4);
  // Narrow leaves along the upper rim, and a little shading in the mass.
  for (let k = 0; k < 13; k++) {
    const a = Math.PI * 1.08 + (k / 12) * Math.PI * 0.84;
    const [x, y] = rim[Math.round((a / (Math.PI * 2)) * 72) % 72];
    p.shape(petal(x, y, x + Math.cos(a) * 15, y + Math.sin(a) * 13, 4.2), WASH.leaf, 0.6, 1);
  }
  p.fine('M92 170l10-6M118 190l12-5M150 180l10-7M176 196l12-4M104 138l9-6M196 160l10-6M130 116l9-5', 0.8, 0.5);
  // A bare twig in early spring, its catkins open.
  const tw = /** @type {[number, number, number, number, number]} */ ([206, 112, 232, 52, -3]);
  p.line(stem(...tw), 1.2);
  for (const [t, side] of [[0.38, -1], [0.58, 1], [0.78, -1], [0.95, 1]]) {
    const [x, y] = along(...tw, t);
    p.oval(x + side * 5, y - 3, 3.6, 6.5, WASH.yellow, 0.75, 1);
  }
  // Seeds drifting off on their fluff.
  for (const [x, y, s] of [[226, 240, 1], [212, 266, 0.8]]) {
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.3;
      p.fine(`M${f(x)} ${f(y)}Q${f(x + Math.cos(a) * 6 * s + 2)} ${f(y + Math.sin(a) * 6 * s)} ${f(x + Math.cos(a) * 11 * s)} ${f(y + Math.sin(a) * 11 * s)}`, 0.6, 0.6);
    }
    p.dot(x, y, 1.3, WASH.brown);
  }
  // The stool the stems rise from, roots down into the wet soil.
  p.shape('M128 302C134 291 166 291 172 302Z', WASH.brown, 0.5, 1.4);
  for (const [x, dx] of [[136, -6], [150, 0], [164, 6]]) p.line(stem(x, 302, x + dx, 322, dx * 0.4), 0.9);
  const [cx, cy] = along(...tw, 0.95);
  p.label('catkins', 250, 40, cx + 8, cy - 4);
  p.label('leaves', 250, 124, 226, 128);
  p.label('seeds', 250, 216, 232, 230);
  p.label('stool', 250, 288, 172, 300);
  p.scale(30, 62, 300, scale);
  return p.svg(380, 340, 'Field sketch of grey willow');
}
