// @ts-check
// Field sketches of the ground (J1.6): soil, sand, rock, moss, fresh water, and shore and sea. Each
// is a side view or cross-section in x 40..236 with labels in the right column (see living.js for
// the layout). Shapes are solid and drawn back to front; everything rests on a ground line or grows
// from something.

import { blade, stem, along, wave, cubicPoints, xAt, yAt, polyline, ripple } from './pen.js';
import { WASH, petal } from './living.js';

const EARTH = '#7B5C42';
const SUBSOIL = '#A88B6A';

/** @param {import('./pen.js').Pen} p */
export function soil(p) {
  p.tint('M40 70H236V170H40Z', EARTH, 0.4);
  p.tint('M40 170H236V236H40Z', SUBSOIL, 0.35);
  // The block: its surface, the line between topsoil and subsoil, and its sides.
  p.line(wave(40, 236, 70, 1.6, 28), 1.6);
  p.line('M40 170C90 166 150 174 236 168', 1);
  p.line('M40 70V236H236V70', 1.1);
  // Clods in the topsoil, stones in the subsoil, and a worm.
  for (const [x, y, rx, ry] of [[70, 96, 7, 5], [104, 118, 5, 4], [84, 152, 6, 4], [200, 100, 6, 4], [210, 124, 5, 3.5]]) p.oval(x, y, rx, ry, EARTH, 0.6, 1);
  for (const [x, y, rx, ry] of [[72, 206, 13, 8], [140, 214, 10, 6], [204, 200, 14, 8]]) p.oval(x, y, rx, ry, WASH.grey, 0.5, 1.1);
  p.line('M60 134C68 126 80 128 86 134S100 144 108 136', 3);
  // A sprout with its roots: side roots grow from the main one.
  const R = /** @type {[number, number, number, number, number]} */ ([150, 72, 146, 156, 4]);
  p.line(stem(...R), 1.2);
  for (const [t, dx, dy] of [[0.35, -22, 12], [0.55, 24, 12], [0.8, -16, 8]]) {
    const [x, y] = along(...R, t);
    p.line(stem(x, y, x + dx, y + dy, dy * 0.3), 0.9);
  }
  p.shape(blade(150, 70, 134, 40, 2.4, -3), WASH.leaf, 0.6, 1);
  p.shape(blade(150, 70, 168, 44, 2.4, 3), WASH.leaf, 0.6, 1);
  // After rain: drops resting on the surface.
  for (const x of [84, 112, 206]) p.shape(`M${x - 4.5} 70A4.5 5 0 0 1 ${x + 4.5} 70Z`, WASH.water, 0.8, 1);
  const [rx, ry] = along(...R, 0.55);
  p.label('rain', 250, 46, 209, 65);
  p.label('top', 250, 92, 226, 92);
  p.label('roots', 250, 140, rx + 24, ry + 12);
  return p.svg(380, 250, 'Field sketch of soil');
}

/** @param {import('./pen.js').Pen} p */
export function sand(p) {
  // A beach in section: water on the left, the sand rising from it to the right.
  p.tint('M40 112H92L40 140Z', WASH.water, 0.4);
  p.tint('M40 140L92 112L236 84V210H40Z', WASH.sand, 0.5);
  p.line(wave(40, 92, 112, 1.2, 13), 1.2);
  // Under the water the bed is smooth; above it the wind has rippled the sand.
  const ripples = ripple(92, 112, 236, 84, 2.4, 16);
  p.line(`M40 140L92 112${ripples.slice(ripples.indexOf('Q'))}`, 1.5);
  p.line('M40 140V210H236V84', 1.1);
  // Rain soaks straight down to where the sand stays wet.
  const surfY = (/** @type {number} */ x) => 112 - ((x - 92) * 28) / 144;
  let table = '';
  for (let x = 46; x < 232; x += 12) table += `M${x} 152h7`;
  p.fine(table, 1, 0.7);
  for (const x of [134, 196]) {
    let d = '';
    for (let y = surfY(x) + 6; y < 148; y += 8) d += `M${x} ${p.f(y)}v4`;
    p.fine(d, 1, 0.7);
  }
  // Grains through the body, a little thicker in the wet sand below the line.
  for (let i = 0; i < 40; i++) {
    const x = 50 + ((i * 47) % 180), y = 120 + ((i * 29) % 84);
    if (y > surfY(Math.max(92, x)) + 6 && y < 204 && Math.abs(y - 152) > 4) p.dot(x, y, 1.1);
  }
  // A shell lying on the slope.
  const sx = 168, sy = surfY(168);
  p.shape(`M${sx} ${p.f(sy)}L${sx - 14} ${p.f(sy - 13)}A18 18 0 0 1 ${sx + 14} ${p.f(sy - 15)}Z`, WASH.petal, 0.9, 1.2);
  p.fine(`M${sx} ${p.f(sy)}L${sx - 8} ${p.f(sy - 15)}M${sx} ${p.f(sy)}L${sx} ${p.f(sy - 18)}M${sx} ${p.f(sy)}L${sx + 8} ${p.f(sy - 16)}`, 0.8, 0.8);
  p.label('ripples', 250, 66, 226, surfY(226) - 1);
  p.label('drains', 250, 124, 196, 126);
  p.label('wet', 250, 176, 214, 172);
  return p.svg(380, 230, 'Field sketch of sand');
}

/** @param {import('./pen.js').Pen} p */
export function rock(p) {
  p.line('M40 214H236', 1.4);
  p.oval(46, 211, 5, 3, WASH.grey, 0.5, 1);
  p.oval(230, 210, 6, 4, WASH.grey, 0.5, 1);
  // The boulder and its facets: every facet line ends on a corner or an edge.
  p.shape('M52 214L66 130L118 82L176 90L220 146L214 214Z', WASH.grey, 0.5, 1.8);
  p.line('M118 82L132 146M66 130L132 146L220 146M132 146L96 214', 1.2);
  // Shade on the front facet, kept inside it.
  let hatch = '';
  for (let y = 156; y <= 206; y += 8) {
    const x0 = 132 - ((y - 146) * 36) / 68 + 7, x1 = 220 - ((y - 146) * 6) / 68 - 7;
    hatch += `M${p.f(x0)} ${y}L${p.f(x1)} ${y - 5}`;
  }
  p.fine(hatch, 0.8, 0.5);
  // Rain running down the right facet.
  p.fine('M168 100L200 142M156 104L182 140', 1, 0.6);
  // Frost along the shaded foot.
  let frost = '';
  for (let x = 150; x <= 202; x += 13) frost += `M${x} 213l3-7 3 7`;
  p.fine(frost, 0.9, 0.8);
  // Moss sitting on the top edge.
  p.shape('M128 83.4C132 74 144 72 150 76C156 70 168 72 170 88.8L128 83.4Z', WASH.green, 0.7, 1.1);
  for (const [x, y] of [[140, 80], [150, 79], [160, 80]]) p.dot(x, y, 1.3, WASH.green);
  p.label('moss', 250, 56, 160, 73);
  p.label('sheds', 250, 140, 221, 145);
  p.label('frost', 250, 196, 215, 212);
  return p.svg(380, 250, 'Field sketch of rock');
}

/** @param {import('./pen.js').Pen} p */
export function moss(p) {
  p.line('M40 214H236', 1.4);
  // Spore capsules on thin stalks, drawn first so the cushion covers their feet.
  /** @type {[number, number, number, number][]} */
  const caps = [[96, 186, 94, 112], [140, 176, 142, 98], [186, 182, 190, 116]];
  for (const [bx, by, tx, ty] of caps) p.line(stem(bx, by, tx, ty, 2), 1);
  // The stone, then the moss cushion lying over its top.
  p.shape('M44 214C52 172 214 164 230 214Z', WASH.grey, 0.45, 1.6);
  p.shape('M56 198C58 180 76 172 92 176C100 162 126 158 142 166C158 158 188 162 202 178C212 184 218 192 220 200C186 192 96 192 56 198Z', WASH.green, 0.6, 1.4);
  // Tiny star-shaped leaves, kept inside the cushion.
  let stars = '';
  let i = 0;
  for (const [y0, x0, x1] of [[181, 86, 194], [189, 72, 208]]) {
    for (let x = x0; x <= x1; x += 12, i++) {
      const sx = x + ((i * 7) % 5) - 2, sy = y0 + ((i * 3) % 3) - 1;
      stars += `M${sx - 3} ${sy}h6M${sx - 2} ${sy - 3}l4 6M${sx + 2} ${sy - 3}l-4 6`;
    }
  }
  p.fine(stars, 0.7, 0.6);
  for (const [, , tx, ty] of caps) p.oval(tx, ty - 8, 3.6, 8, WASH.brown, 0.7, 1);
  // Rain drops resting on the cushion.
  for (const [x, y, r] of [[120, 157, 3], [164, 157, 3], [208, 176, 3]]) p.oval(x, y, r, r, WASH.water, 0.8, 1);
  p.label('caps', 250, 64, 194, 100);
  p.label('rain', 250, 150, 211, 175);
  p.label('drinks', 250, 206, 220, 199);
  return p.svg(380, 240, 'Field sketch of moss');
}

/** @param {import('./pen.js').Pen} p */
export function fresh(p) {
  // A pond in section: a steep bank on the left, a deep middle, a long shallow shelf on the right.
  const segs = [[62, 100, 76, 108, 90, 172, 128, 182], [128, 182, 164, 190, 176, 126, 194, 114], [194, 114, 206, 108, 218, 104, 228, 100]];
  const bed = 'M62 100C76 108 90 172 128 182C164 190 176 126 194 114C206 108 218 104 228 100';
  const pts = segs.flatMap((s) => cubicPoints(s, 24));
  p.tint(`${bed}Z`, WASH.water, 0.45);
  p.tint('M92 150C110 172 150 180 168 160C150 170 112 168 92 150Z', '#5F8196', 0.3);
  p.line('M40 92Q52 94 62 100', 1.4);
  p.line('M228 100Q232 98 236 97', 1.4);
  p.line(bed, 1.5);
  p.line(wave(62, 228, 100, 1.2, 24), 1.3);
  p.fine('M96 110h16M136 114h22', 0.9, 0.6);
  // Stones resting on the bottom.
  for (const [x, rx, ry] of [[110, 7, 4], [140, 9, 5], [158, 5, 3]]) p.oval(x, yAt(pts, x) - ry + 1, rx, ry, WASH.grey, 0.6, 1);
  // Mist lying on the water.
  p.fine('M92 94c16-4 32 4 48 0s32-4 48 0M116 87c14-4 28 4 42 0', 1.2, 0.45);
  p.label('mist', 250, 46, 186, 88);
  p.label('warm', 250, 118, 200, 101);
  p.label('margin', 250, 168, 206, yAt(pts, 206));
  return p.svg(380, 230, 'Field sketch of fresh water');
}

/** @param {import('./pen.js').Pen} p */
export function shore(p) {
  // A shore in section: the land falls to the sea; marks for high and low water.
  const prof = cubicPoints([40, 92, 100, 96, 150, 150, 236, 186]);
  const xHigh = xAt(prof, 134), xNow = xAt(prof, 152), xLow = xAt(prof, 170);
  p.tint(`${polyline(prof)}V230H40Z`, WASH.sand, 0.5);
  const below = prof.filter(([x]) => x >= xNow);
  p.tint(`M${p.f(xNow)} 152H236V${p.f(prof[prof.length - 1][1])}${polyline(below.slice().reverse()).replace('M', 'L')}Z`, WASH.water, 0.45);
  const band = prof.filter(([x]) => x >= xHigh && x <= xLow);
  p.tint(`${polyline(band)}${polyline(band.slice().reverse().map(([x, y]) => [x, y + 7])).replace('M', 'L')}Z`, EARTH, 0.25);
  p.line(polyline(prof), 1.6);
  p.line(wave(xNow, 236, 152, 2.2, 20), 1.2);
  let marks = '';
  for (const [x0, y] of [[xHigh, 134], [xLow, 170]]) for (let x = x0 + 2; x < 232; x += 10) marks += `M${p.f(x)} ${y}h6`;
  p.line(marks, 0.9);
  // Thrift on the turf above the band, in the salt spray.
  const tx = 72, ty = yAt(prof, tx);
  p.line(stem(tx, ty - 6, tx + 4, ty - 32, 2), 1);
  p.shape(`M${tx - 12} ${p.f(yAt(prof, tx - 12))}A12 9 0 0 1 ${tx + 12} ${p.f(yAt(prof, tx + 12))}Z`, WASH.green, 0.6, 1.1);
  p.oval(tx + 4, ty - 38, 6, 6, WASH.pink, 0.8, 1);
  p.label('spray', 250, 40, tx + 10, ty - 40);
  p.label('band', 250, 94, xHigh - 2, 133);
  p.label('high', 250, 140, 234, 134);
  p.label('low', 250, 182, 234, 170);
  return p.svg(380, 240, 'Field sketch of the shore');
}
