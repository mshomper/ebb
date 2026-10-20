// @ts-check
// Field sketches of the living things (J1.6): grass, rushes, reeds, water lilies, yellow flag iris
// and sea thrift, each drawn with the journal pen (pen.js) so pencil, ink and wash come from one drawing.
//
// Layout for every sheet (380 wide): the drawing sits in x 40..236 on a ground line, a scale bar
// (when there is one) at x 30 on the left, and labels in the right column from x 250, each with a
// leader from a point on the thing it names. Shapes are solid and drawn back to front; everything
// grows from or rests on something.

import { blade, stem, along, wave, cubicPoints, yAt, xAt, polyline } from './pen.js';

export const WASH = Object.freeze({
  green: '#7E9B5E', leaf: '#93AE6E', brown: '#7A5236', water: '#9DB9C8', mud: '#8A6F55', sand: '#D9C49A',
  pink: '#D98AA8', spent: '#C9B49E', yellow: '#E3BE3A', petal: '#F1E9E2', gold: '#E2C25A', grey: '#9A9C94',
  red: '#B9483E', blue: '#6E8EC0',
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

/** Beadlet anemone (a find): open under the pool's water on the left, shut out of it on the right. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function anemone(p, scale) {
  // A rock pool's edge: water over the left anemone, bare wet rock under the right.
  p.tint('M40 120H136V214H40Z', WASH.water, 0.32);
  p.line(wave(40, 136, 120, 1.4, 16), 1.3);
  p.shape('M40 214C70 206 110 210 136 214C160 206 210 206 236 214V236H40Z', WASH.grey, 0.4, 1.5);
  // Open: a squat red column, a disc, and a crown of tentacles leaning out.
  p.shape('M64 212C62 186 66 172 88 172S114 186 112 212Z', WASH.red, 0.75, 1.4);
  p.oval(88, 172, 26, 6, WASH.red, 0.85, 1.2);
  for (let i = 0; i < 13; i++) {
    const a = Math.PI * (0.08 + 0.84 * (i / 12));
    const x0 = 88 - Math.cos(a) * 20, y0 = 170;
    p.line(stem(x0, y0, 88 - Math.cos(a) * 36, 150 - Math.sin(a) * 22, (i - 6) * 0.8), 1.6);
  }
  // Shut: a shiny red blob with blue beads round its rim.
  p.shape('M164 212C162 192 172 182 190 182S218 192 216 212Z', WASH.red, 0.8, 1.4);
  p.fine('M176 192C180 188 186 186 192 186', 1.1, 0.8);
  for (const [x, y] of [[170, 198], [180, 190], [200, 189], [210, 197]]) p.oval(x, y, 3.2, 3, WASH.blue, 0.9, 1);
  p.label('tentacles', 250, 70, 120, 146);
  p.label('beads', 250, 150, 211, 196);
  p.label('shut', 250, 188, 216, 204);
  p.scale(30, 150, 212, scale);
  return p.svg(380, 250, 'Field sketch of beadlet anemones, open and shut');
}

/** Periwinkle (a find): two shells grazing a weed-covered rock, one turned to show its door. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function periwinkle(p, scale) {
  p.shape('M40 214C60 186 120 176 170 182C206 186 228 200 236 214Z', WASH.grey, 0.4, 1.5);
  // Wrack strands over the rock.
  for (const [x0, y0, x1, y1, b] of [[60, 200, 120, 206, 4], [96, 190, 170, 196, -5], [150, 186, 222, 204, 6]]) p.shape(blade(x0, y0, x1, y1, 3.4, b), WASH.brown, 0.5, 1.1);
  // A shell from the side: a round body whorl and a low spire, its growth lines drawn in.
  const shell = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ s) => {
    p.shape(`M${cx - 26 * s} ${cy}C${cx - 28 * s} ${cy - 30 * s} ${cx + 14 * s} ${cy - 38 * s} ${cx + 26 * s} ${cy - 10 * s}C${cx + 30 * s} ${cy} ${cx + 20 * s} ${cy + 6 * s} ${cx} ${cy + 6 * s}C${cx - 14 * s} ${cy + 6 * s} ${cx - 24 * s} ${cy + 4 * s} ${cx - 26 * s} ${cy}Z`, WASH.mud, 0.7, 1.4);
    p.shape(`M${cx + 4 * s} ${cy - 26 * s}C${cx + 10 * s} ${cy - 38 * s} ${cx + 22 * s} ${cy - 38 * s} ${cx + 26 * s} ${cy - 28 * s}C${cx + 22 * s} ${cy - 24 * s} ${cx + 12 * s} ${cy - 22 * s} ${cx + 4 * s} ${cy - 26 * s}Z`, WASH.brown, 0.7, 1.2);
    for (const t of [0.3, 0.55, 0.8]) p.fine(`M${p.f(cx - 22 * s + 40 * s * t)} ${p.f(cy - 30 * s * Math.sin(Math.PI * t))}l${p.f(4 * s)} ${p.f(30 * s * Math.sin(Math.PI * t) * 0.8)}`, 0.7, 0.55);
  };
  shell(92, 196, 1);
  shell(176, 190, 0.8);
  // The second is tilted to show its door, a horny plate that seals it shut.
  p.oval(170, 194, 10, 6, WASH.gold, 0.6, 1.1);
  p.label('shell', 250, 70, 104, 168);
  p.label('door', 250, 130, 180, 194);
  p.label('weed', 250, 196, 218, 202);
  p.scale(30, 150, 214, scale);
  return p.svg(380, 240, 'Field sketch of periwinkles on a weedy rock');
}

/** Lugworm casts (a find): the sand cut away to show the U of the burrow, a coil of spent sand at one end and a dip at the other. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function lugworm(p, scale) {
  p.tint('M40 120H236V230H40Z', WASH.sand, 0.4);
  p.line('M40 120H96C102 120 106 126 112 126S122 120 128 120H236', 1.6);
  for (const [x, y] of [[60, 150], [90, 196], [150, 210], [210, 160], [226, 206]]) p.dot(x, y, 1.1);
  // The cast: a coil of spent sand piled at the tail end of the burrow.
  let d = '';
  for (let s = 0; s <= 40; s++) {
    const t = s / 40, a = t * Math.PI * 4.2, r = 22 * (1 - 0.6 * t);
    const x = 184 + Math.cos(a) * r, y = 112 - t * 22 + Math.sin(a) * r * 0.3;
    d += `${s ? 'L' : 'M'}${p.f(x)} ${p.f(y)}`;
  }
  p.shape('M160 120C160 104 172 92 184 92S208 104 208 120Z', WASH.mud, 0.45, 1.3);
  p.line(d, 1.5);
  // The U-shaped burrow under the sand, the worm lying in it.
  p.line('M112 126C112 176 130 206 150 206S184 176 184 120', 4.5);
  p.shape(blade(126, 186, 168, 196, 4, 4), WASH.pink, 0.75, 1.1);
  p.label('cast', 250, 80, 206, 104);
  p.label('burrow', 250, 176, 182, 170);
  p.label('dip', 250, 132, 118, 124);
  p.scale(30, 90, 120, scale);
  return p.svg(380, 240, 'Field sketch of a lugworm burrow and its cast');
}
