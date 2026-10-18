// @ts-check
// Field sketches of the ground (J1.6): soil, sand, rock, moss, fresh water, and shore and sea, as
// small cross-sections and close views drawn with the journal pen (pen.js). Labels sit in the right
// margin with leaders to what they name.

import { blade, stem, wave } from './pen.js';
import { WASH } from './living.js';

const EARTH = '#7B5C42';
const SUBSOIL = '#A88B6A';

/** @param {import('./pen.js').Pen} p */
export function soil(p) {
  p.tint('M20 70H250V170H20Z', EARTH, 0.4);
  p.tint('M20 170H250V230H20Z', SUBSOIL, 0.35);
  p.line(wave(20, 250, 70, 2, 28), 1.6);
  p.line('M20 170C70 166 130 174 180 168S230 166 250 170', 1);
  p.line('M20 70V230H250V70', 1.1);
  // Clods, stones and a worm.
  for (const [x, y, r] of [[48, 96, 5], [92, 120, 4], [150, 100, 6], [210, 130, 5], [70, 150, 4], [180, 150, 3]]) p.oval(x, y, r * 1.4, r, EARTH, 0.6, 1);
  for (const [x, y, rx, ry] of [[60, 200, 12, 7], [140, 210, 9, 6], [220, 196, 14, 8]]) p.oval(x, y, rx, ry, WASH.grey, 0.5, 1.1);
  p.line('M84 140C92 132 104 136 110 142S126 152 134 144', 3.2);
  // A sprout and its roots.
  p.shape(blade(190, 70, 176, 36, 2, -2), WASH.leaf, 0.6, 1);
  p.shape(blade(190, 70, 206, 40, 2, 2), WASH.leaf, 0.6, 1);
  p.line('M190 72C188 96 182 118 172 140M190 74C194 100 204 120 214 146M190 76C190 100 192 130 190 160', 1);
  p.fine('M180 120l-8 2M200 112l8-2M190 140l-6 6', 0.8, 0.8);
  // Rain falling on it.
  p.fine('M60 20l-4 14M110 14l-4 14M160 22l-4 14M220 16l-4 14', 1, 0.6);
  p.label('top', 262, 112, 236, 112);
  p.label('roots', 262, 160, 214, 146);
  p.label('rain', 262, 30, 222, 26);
  return p.svg(380, 250, 'Field sketch of soil');
}

/** @param {import('./pen.js').Pen} p */
export function sand(p) {
  p.tint('M20 70H64V210H20Z', WASH.water, 0.4);
  p.tint('M64 70H250V210H64Z', WASH.sand, 0.5);
  p.line('M64 70C58 100 70 130 62 160S66 196 64 210', 1.4);
  p.fine(wave(30, 58, 110, 2, 8) + wave(30, 58, 160, 2, 8), 0.8, 0.6);
  for (const y of [86, 112, 138, 164, 190]) p.line(wave(76, 246, y, 3, 22), 1.1);
  for (let i = 0; i < 26; i++) p.dot(80 + ((i * 37) % 166), 78 + ((i * 53) % 128), 1.2);
  // A shell lying on the ripples.
  p.shape('M150 160L132 140A24 24 0 0 1 168 140Z', WASH.petal, 0.9, 1.2);
  p.fine('M150 160L138 138M150 160L146 134M150 160L154 134M150 160L162 138', 0.8, 0.8);
  p.label('ripples', 262, 92, 240, 88);
  p.label('drains', 262, 144, 236, 150);
  p.label('wet', 262, 196, 80, 182);
  return p.svg(380, 230, 'Field sketch of sand');
}

/** @param {import('./pen.js').Pen} p */
export function rock(p) {
  const body = 'M40 220L68 122L128 72L200 86L240 150L230 220Z';
  p.shape(body, WASH.grey, 0.5, 1.8);
  p.line('M128 72L140 140L240 150M140 140L100 220M68 122L140 140', 1.2);
  // Shade hatching on the faces away from the light.
  for (let y = 150; y < 216; y += 8) p.fine(`M${150 + (y - 150) * 0.1} ${y}L${222 - (y - 150) * 0.05} ${y - 6}`, 0.8, 0.5);
  // Moss on the damp top facet.
  p.shape('M140 84C150 74 172 76 186 84C180 92 158 96 140 92Z', WASH.green, 0.7, 1.1);
  for (const [x, y] of [[150, 84], [160, 82], [170, 86], [178, 84]]) p.dot(x, y, 1.4, WASH.green);
  // Rain running off, a little frost on the shaded foot.
  p.fine('M212 110l6 18M224 130l5 16M232 160l3 16', 1, 0.6);
  p.fine('M180 212l4-6 4 6M196 214l4-6 4 6M212 212l4-6 4 6', 0.9, 0.7);
  p.line('M20 220H250', 1.4);
  for (const [x, rx] of [[28, 6], [252, 8], [262, 5]]) p.oval(x, 216, rx, 4, WASH.grey, 0.5, 1);
  p.label('moss', 262, 50, 186, 82);
  p.label('sheds', 262, 120, 228, 128);
  p.label('frost', 262, 186, 216, 208);
  return p.svg(380, 250, 'Field sketch of rock');
}

/** @param {import('./pen.js').Pen} p */
export function moss(p) {
  p.shape('M36 226C52 162 210 150 248 226Z', WASH.grey, 0.45, 1.6);
  const cushion = 'M50 206C54 176 78 164 100 168C112 152 142 148 160 158C182 150 214 158 230 184C236 194 238 202 236 208C180 196 110 196 50 206Z';
  p.shape(cushion, WASH.green, 0.6, 1.4);
  // Tiny star-shaped leaves all over the cushion.
  for (let i = 0; i < 34; i++) {
    const x = 64 + ((i * 41) % 166), y = 172 + ((i * 23) % 26);
    p.fine(`M${x - 3} ${y}h6M${x - 2} ${y - 3}l4 6M${x + 2} ${y - 3}l-4 6`, 0.7, 0.6);
  }
  // Spore capsules on thin stalks.
  for (const [bx, by, tx, ty] of [[100, 166, 94, 112], [150, 154, 156, 96], [200, 162, 212, 120]]) {
    p.line(stem(bx, by, tx, ty, 2), 1);
    p.oval(tx, ty - 6, 3.5, 7, WASH.brown, 0.7, 1);
  }
  // Rain drops beading.
  for (const [x, y] of [[80, 176], [130, 160], [184, 168], [222, 190]]) p.dot(x, y, 2.2, WASH.water);
  p.label('caps', 262, 96, 214, 112);
  p.label('drinks', 262, 168, 236, 196);
  p.label('rain', 262, 36, 186, 164);
  return p.svg(380, 240, 'Field sketch of moss');
}

/** @param {import('./pen.js').Pen} p */
export function fresh(p) {
  const bed = 'M40 100C70 104 90 170 160 190C230 200 270 150 300 100';
  p.tint(`${bed}Z`, WASH.water, 0.45);
  p.tint('M110 150C140 176 200 186 240 160C210 178 150 180 110 150Z', '#5F8196', 0.3);
  p.line('M10 92Q28 94 40 100', 1.4);
  p.line('M300 100Q322 92 346 92', 1.4);
  p.line(bed, 1.5);
  p.line(wave(40, 300, 100, 1.5, 26), 1.3);
  p.fine('M120 112h18M190 116h24M240 110h14', 0.9, 0.6);
  // Reeds at the shallow margin.
  for (const [bx, tx, ty] of [[52, 46, 40], [58, 62, 32], [64, 72, 48]]) p.line(stem(bx, 104, tx, ty, 2), 1.2);
  for (const [x, y] of [[47, 50], [62, 42]]) p.oval(x, y, 3.5, 9, WASH.brown, 0.7, 1);
  // Mist lying on the water.
  p.fine('M110 82c20-6 40 6 60 0s40-6 60 0M140 66c20-6 40 6 60 0', 1.2, 0.45);
  p.label('mist', 150, 30, 176, 64);
  p.label('warm', 268, 34, 226, 98);
  p.label('margin', 10, 216, 70, 120);
  return p.svg(380, 250, 'Field sketch of fresh water');
}

/** @param {import('./pen.js').Pen} p */
export function shore(p) {
  const beach = 'M10 80C80 84 140 120 210 150C260 170 320 186 370 192';
  p.tint(`${beach}V250H10Z`, WASH.sand, 0.5);
  p.tint('M170 132C210 150 250 166 300 180L370 186V128H170Z', WASH.water, 0.4);
  p.tint('M170 132C200 146 236 160 268 172L290 176C250 160 214 146 184 132Z', EARTH, 0.25);
  p.line(beach, 1.6);
  p.line(wave(196, 370, 146, 2.5, 22), 1.2);
  p.fine(wave(230, 370, 160, 2, 18), 0.8, 0.5);
  // High and low water marks.
  p.line('M150 128H370', 0.8);
  p.line('M250 176H370', 0.8);
  // Spray and a thrift tuft above the band.
  for (const [x, y] of [[100, 76], [112, 70], [124, 78], [90, 66]]) p.dot(x, y, 1.6, WASH.water);
  p.shape('M68 86C70 74 86 72 92 86Z', WASH.green, 0.6, 1);
  p.oval(80, 70, 4, 4, WASH.pink, 0.8, 1);
  p.label('high', 278, 116, 300, 126);
  p.label('low', 286, 206, 300, 178);
  p.label('band', 10, 186, 220, 160);
  p.label('spray', 10, 38, 96, 66);
  return p.svg(380, 250, 'Field sketch of the shore');
}
