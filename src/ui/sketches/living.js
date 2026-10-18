// @ts-check
// Field sketches of the living things (J1.6): grass, reeds, water lilies, yellow flag iris and sea
// thrift, each drawn with the journal pen (pen.js) so pencil, ink and wash come from one drawing.
// Coordinates are drawing units on a 380 wide sheet; labels sit in the margins with leaders.

import { blade, stem, wave } from './pen.js';

export const WASH = Object.freeze({
  green: '#7E9B5E', leaf: '#93AE6E', brown: '#7A5236', water: '#9DB9C8', mud: '#8A6F55', sand: '#D9C49A',
  pink: '#D98AA8', yellow: '#E3BE3A', petal: '#F1E9E2', gold: '#E2C25A', grey: '#9A9C94',
});

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
    const r = (/** @type {string} */ d) => `<g transform="rotate(${f(ang)} ${f(cx)} ${f(cy)})">${d}</g>`;
    // Heads are drawn upright, then turned with their stem.
    const body = `M${f(cx - 7)} ${f(cy - h / 2 + 7)}a7 7 0 0 1 14 0V${f(cy + h / 2 - 7)}a7 7 0 0 1 -14 0Z`;
    const sub = p.sub();
    sub.shape(body, WASH.brown, 0.75, 1.6);
    for (let y = cy - h / 2 + 8; y < cy + h / 2 - 6; y += 6) sub.fine(`M${f(cx - 5)} ${f(y + 3)}L${f(cx + 5)} ${f(y)}`);
    sub.line(`M${f(cx)} ${f(cy - h / 2)}V${f(cy - h / 2 - 22)}`, 1.3);
    p.raw(r(sub.take()));
  }
  p.line('M60 334C100 326 130 340 170 332S240 326 278 336', 2);
  p.fine('M90 331l-4 10M120 334l3 9M200 330l-3 10M246 331l4 9', 0.9, 0.8);
  p.line('M252 333C252 318 254 306 258 292', 1.4);
  p.shape(blade(258, 296, 272, 274, 2.5), WASH.green, 0.6, 1);
  p.label('spike', 196, 34, 160, 60);
  p.label('head', 204, 92, 150, 110);
  p.label('blade', 8, 128, 92, 150);
  p.label('root', 210, 362, 250, 338);
  p.scale(362, 54, 300, scale);
  return p.svg(380, 400, 'Field sketch of reeds');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function grass(p, scale) {
  p.tint('M20 230H330V290H20Z', WASH.mud, 0.22);
  p.line(wave(20, 330, 230, 1.5, 30), 1.6);
  // Roots under the tuft.
  p.line('M190 232C186 250 176 262 160 276M196 232C198 252 206 266 222 280M192 234C192 252 190 268 192 286', 1.1);
  p.fine('M170 266l-8 2M212 270l8 0M191 272l-6 6M176 254l-6-3', 0.8, 0.7);
  for (let i = 0; i < 14; i++) {
    const bx = 160 + i * 5;
    const tx = bx + (i - 6.5) * 13 + (i % 3) * 4;
    const ty = 78 + (i % 4) * 26 + Math.abs(i - 6.5) * 4;
    p.shape(blade(bx, 230, tx, ty, 2.4, (i - 6.5) * 2), WASH.leaf, 0.42, 1.1);
  }
  // Two flowering stalks with loose seed heads.
  for (const [bx, tx, ty] of [[186, 172, 40], [204, 226, 52]]) {
    p.line(stem(bx, 230, tx, ty, (tx - bx) * 0.3), 1.2);
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      const x = tx + (bx - tx) * t * 0.22, y = ty + (230 - ty) * t * 0.22;
      const side = k % 2 ? 1 : -1;
      p.oval(x + side * 6, y + 2, 2.6, 5.5, WASH.brown, 0.6, 1);
      p.fine(`M${p.f(x)} ${p.f(y)}l${side * 4} 2`, 0.8, 0.8);
    }
  }
  p.label('base', 262, 192, 212, 222);
  p.label('seed', 246, 40, 230, 56);
  p.label('roots', 14, 258, 170, 266);
  p.scale(36, 60, 222, scale);
  return p.svg(380, 300, 'Field sketch of grass');
}

/** A pointed petal from its base to its tip, widest in the middle. @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} w */
export function petal(x0, y0, x1, y1, w) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len * w, ny = (x1 - x0) / len * w;
  const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  return `M${r(x0)} ${r(y0)}Q${r(mx + nx)} ${r(my + ny)} ${r(x1)} ${r(y1)}Q${r(mx - nx)} ${r(my - ny)} ${r(x0)} ${r(y0)}Z`;
}

/** A notched lily pad seen low. @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} a notch angle */
function pad(cx, cy, rx, ry, a) {
  const x1 = cx + rx * Math.cos(a + 0.28), y1 = cy + ry * Math.sin(a + 0.28);
  const x2 = cx + rx * Math.cos(a - 0.28), y2 = cy + ry * Math.sin(a - 0.28);
  const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  return `M${r(cx)} ${r(cy)}L${r(x1)} ${r(y1)}A${rx} ${ry} 0 1 1 ${r(x2)} ${r(y2)}Z`;
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function lilies(p, scale) {
  p.tint('M20 120H340V284H20Z', WASH.water, 0.32);
  p.tint('M20 284H340V316H20Z', WASH.mud, 0.25);
  p.line(wave(20, 340, 120, 2, 36), 1.4);
  p.line('M20 284C80 280 140 290 200 284S300 280 340 286', 1.3);
  // Stalks down to the resting root in the mud.
  p.line('M110 126C112 180 138 232 150 288', 1.1);
  p.line('M250 128C246 190 214 240 200 290', 1.1);
  p.line('M185 122C190 190 176 240 176 290', 1.1);
  p.shape('M126 292C150 280 210 282 234 292C210 304 150 304 126 292Z', WASH.brown, 0.55, 1.6);
  p.fine('M140 298l-4 10M168 300l0 11M196 300l3 10M222 296l6 9', 0.9, 0.8);
  // Pads, then the flower on the nearest.
  p.shape(pad(250, 124, 46, 11, 2.7), WASH.green, 0.5, 1.4);
  p.shape(pad(185, 118, 30, 8, 1.3), WASH.green, 0.5, 1.3);
  p.shape(pad(110, 122, 54, 13, 0.4), WASH.green, 0.5, 1.4);
  p.fine('M110 122l-30 4M110 122l26 6M110 122l-12 10M250 124l-24 3M250 124l20 5', 0.7, 0.5);
  const fx = 122, fy = 112;
  for (const [tx, ty, w] of [[92, 96, 9], [104, 78, 9], [122, 70, 9], [140, 78, 9], [152, 96, 9], [112, 88, 8], [132, 88, 8]]) {
    p.shape(petal(fx, fy, tx, ty, w), WASH.petal, 0.95, 1.1);
  }
  p.dot(fx, fy - 8, 4, WASH.gold);
  p.label('flower', 10, 50, 96, 84);
  p.label('pad', 262, 86, 262, 116);
  p.label('stalk', 232, 194, 222, 226);
  p.label('root', 246, 306, 232, 294);
  p.scale(362, 120, 286, scale);
  return p.svg(380, 330, 'Field sketch of water lilies');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function iris(p, scale) {
  p.tint('M20 290H330V340H20Z', WASH.mud, 0.22);
  p.line(wave(20, 330, 290, 1.5, 30), 1.6);
  // The creeping root, just under the soil.
  p.shape('M116 300C140 292 200 292 236 300C210 312 140 312 116 300Z', WASH.brown, 0.5, 1.6);
  p.fine('M132 306l-6 12M160 309l-2 13M190 309l2 12M218 305l7 11', 0.9, 0.8);
  // A fan of sword leaves.
  for (const [bx, tx, ty, w] of [[156, 100, 110, 5], [162, 128, 72, 6], [168, 150, 50, 6], [176, 186, 46, 6], [184, 214, 70, 6], [190, 240, 104, 5]]) {
    p.shape(blade(bx, 290, tx, ty, w, 0), WASH.green, 0.42, 1.3);
    p.fine(stem(bx, 290, tx, ty, 0), 0.6, 0.45);
  }
  // The flower stalk and flower: three drooping falls, three upright standards.
  p.line('M196 290C206 230 232 170 250 116', 1.4);
  p.oval(238, 156, 4, 9, WASH.green, 0.6, 1);
  const fx = 250, fy = 110;
  for (const [tx, ty] of [[240, 74], [250, 66], [260, 74]]) p.shape(petal(fx, fy, tx, ty, 9), WASH.yellow, 0.85, 1.1);
  for (const [tx, ty] of [[220, 128], [250, 142], [280, 128]]) p.shape(petal(fx, fy, tx, ty, 16), WASH.yellow, 0.85, 1.2);
  p.fine('M250 112l-18 12M250 112l0 22M250 112l20 12', 0.7, 0.6);
  p.label('falls', 226, 24, 250, 64);
  p.label('leaves', 8, 74, 104, 108);
  p.label('root', 240, 334, 226, 304);
  p.scale(362, 80, 290, scale);
  return p.svg(380, 380, 'Field sketch of yellow flag iris');
}

/** @param {import('./pen.js').Pen} p @param {string} [scale] */
export function thrift(p, scale) {
  p.tint('M20 200H330V250H20Z', WASH.sand, 0.45);
  p.line(wave(20, 330, 200, 1.2, 26), 1.5);
  p.fine('M60 214h3M110 222h3M170 216h3M230 226h3M290 214h3M80 236h3M260 238h3', 1.4, 0.6);
  // The cushion: a low dome of short narrow leaves.
  p.shape('M92 200C98 152 150 130 190 130S282 152 288 200Z', WASH.green, 0.45, 1.4);
  for (let i = 0; i <= 22; i++) {
    const x = 100 + i * 8;
    const h = 66 * Math.sqrt(Math.max(0, 1 - ((x - 190) / 96) ** 2));
    p.fine(`M${x} ${p.f(200 - h * 0.35)}L${p.f(x + 3 + (i % 3))} ${p.f(200 - h + 6)}`, 0.8, 0.55);
  }
  // Stalks and papery pompoms.
  for (const [bx, by, tx, ty] of [[150, 148, 128, 66], [172, 134, 168, 44], [200, 132, 214, 52], [224, 142, 256, 74], [160, 142, 110, 96]]) {
    p.line(stem(bx, by, tx, ty, (tx - bx) * 0.2), 1.1);
    p.oval(tx, ty, 13, 13, WASH.pink, 0.75, 1.2);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      p.dot(tx + Math.cos(a) * 7, ty + Math.sin(a) * 7, 1.6);
    }
  }
  // A few seeds riding the wind.
  for (const [x, y] of [[296, 62], [316, 52], [334, 70]]) { p.dot(x, y, 2); p.fine(`M${x - 2} ${y}l-9 -3`, 0.7, 0.6); }
  p.label('cushion', 8, 232, 100, 190);
  p.label('pompom', 274, 104, 264, 82);
  p.label('seeds', 270, 22, 312, 50);
  p.scale(30, 66, 200, scale);
  return p.svg(380, 260, 'Field sketch of sea thrift');
}
