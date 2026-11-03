// @ts-check
// Field sketches of B3's coast and pond lives (doc 13, the autumn and winter creatures): the ruddy
// turnstone flipping a stone on the strandline, the purple sandpiper on wet rock, the European eel
// on the pond bed, the teal on the water and the grey seal hauled out with her pup. Drawn by hand
// in the pen, as the turtle and the hen are, each at its own shape (no outline is shared): every
// animal is one smooth outline (head, neck and body together, so no part floats free of another),
// its markings drawn inside it. Layout as living.js: the drawing in x 40..236, a scale bar at x 30,
// labels from x 250.

import { blade, wave } from './pen.js';
import { WASH } from './living.js';

const TURN_BACK = '#7A5A42', TURN_DARK = '#2F2A26', ORANGE = '#D98A3A';
const SLATE = '#6E737A', SHEEN = '#7A6E86', PIPER_LEG = '#D6A23A';
const EEL = '#5A5532', EEL_FIN = '#4A4630';
const TEAL_HEAD = '#8A4A2E', TEAL_GREEN = '#3F7A5A';
const SEAL = '#8C8E8A', SEAL_DARK = '#4E504C';

/** @param {number} n */
const r1 = (n) => (Math.round(n * 10) / 10).toString();

/**
 * A smooth outline through points (Catmull-Rom, as cubic curves); a point given as [x, y, 1] is a
 * corner the curve turns sharply at (where a bill meets a face).
 * @param {number[][]} pts @param {boolean} [closed]
 */
export function smooth(pts, closed = true) {
  const n = pts.length;
  const P = (/** @type {number} */ i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), e = P(i + 2);
    const kb = b[2] ? 0 : 1 / 6, kc = c[2] ? 0 : 1 / 6;
    d += `C${r1(b[0] + (c[0] - a[0]) * kb)} ${r1(b[1] + (c[1] - a[1]) * kb)} ${r1(c[0] - (e[0] - b[0]) * kc)} ${r1(c[1] - (e[1] - b[1]) * kc)} ${r1(c[0])} ${r1(c[1])}`;
  }
  return d + (closed ? 'Z' : '');
}

/** Short orange or yellow legs to the ground, toes spread. @param {import('./pen.js').Pen} p @param {number} x @param {number} y0 @param {number} g @param {string} c */
function leg(p, x, y0, g, c) {
  p.shape(`M${x - 2} ${y0}L${x + 2} ${y0}L${x + 2.6} ${g - 1}L${x - 1.4} ${g - 1}Z`, c, 0.85, 1);
  p.line(`M${x + 0.6} ${g - 1}l13 1.5M${x + 0.6} ${g - 1}l-9 1M${x + 0.6} ${g - 1}l6 -3`, 1.1);
}

/**
 * Ruddy turnstone in its winter coat: stocky and short legged, head down at the front with its short
 * wedge of a bill pushed under a flat stone it is tipping over; dark brown back, the dark breast band
 * reaching up the sides of the neck, the white belly, short orange legs.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function turnstone(p, scale) {
  const g = 206;
  p.tint(`M40 ${g}H236V250H40Z`, WASH.sand, 0.4);
  p.line(`M40 ${g}C90 ${g - 2} 170 ${g + 2} 236 ${g - 1}`, 1.3);
  // A strand of wrack behind it, a pebble.
  p.shape(`M44 ${g + 6}C70 ${g + 1} 96 ${g + 10} 120 ${g + 4}C112 ${g + 12} 80 ${g + 16} 44 ${g + 12}Z`, WASH.brown, 0.55, 1);
  p.oval(170, g + 12, 8, 4.5, WASH.grey, 0.45, 1.1);
  // The far leg, behind the body.
  leg(p, 150, g - 32, g, ORANGE);
  // The whole bird in one line: short tail, rounded back, the neck dipping to a round head held low.
  const body = smooth([[64, g - 62, 1], [84, g - 74], [108, g - 83], [132, g - 86], [152, g - 82], [166, g - 72], [174, g - 58],
    [182, g - 52], [191, g - 53], [198, g - 46], [203, g - 37, 1], [201, g - 30, 1], [194, g - 28], [184, g - 28], [172, g - 30],
    [156, g - 30], [132, g - 30], [106, g - 36], [82, g - 52]]);
  p.shape(body, TURN_BACK, 0.55, 1.5);
  // The white belly under it.
  p.tint(`M106 ${g - 36}C124 ${g - 30} 150 ${g - 29} 168 ${g - 32}C150 ${g - 38} 124 ${g - 40} 106 ${g - 36}Z`, WASH.petal, 0.9);
  // The folded wing to the tail, its feather edges.
  p.shape(`M160 ${g - 76}C140 ${g - 82} 106 ${g - 78} 70 ${g - 62}C94 ${g - 56} 124 ${g - 50} 150 ${g - 52}C162 ${g - 56} 164 ${g - 68} 160 ${g - 76}Z`, TURN_BACK, 0.7, 1.1);
  let edges = '';
  for (let i = 0; i < 5; i++) edges += `M${150 - i * 16} ${g - 72 + i * 2.6}q-6 5 -12 3`;
  p.fine(edges, 0.9, 0.6);
  // The pale face and throat, the dark breast band below them, reaching up the side of the neck.
  p.tint(`M176 ${g - 55}C182 ${g - 54} 190 ${g - 55} 198 ${g - 46}L203 ${g - 37}L201 ${g - 30}C196 ${g - 27} 190 ${g - 27} 184 ${g - 29}C180 ${g - 36} 177 ${g - 46} 176 ${g - 55}Z`, WASH.petal, 0.75);
  p.shape(`M166 ${g - 66}C172 ${g - 54} 178 ${g - 42} 186 ${g - 31}C186 ${g - 28} 182 ${g - 28} 176 ${g - 29}C166 ${g - 29} 158 ${g - 31} 152 ${g - 35}C158 ${g - 46} 162 ${g - 56} 166 ${g - 66}Z`, TURN_DARK, 0.7, 1);
  p.fine(`M184 ${g - 48}C188 ${g - 44} 192 ${g - 39} 194 ${g - 34}`, 1.4, 0.7);
  p.oval(189, g - 46, 2.2, 2, WASH.tip, 0.9, 0.7);
  p.dot(189.3, g - 46, 1);
  // The short, slightly upturned wedge of a bill, pushed under the stone's lifted edge.
  p.shape(`M203 ${g - 37}L214 ${g - 19}L211 ${g - 17}L201 ${g - 30}Z`, WASH.tip, 0.85, 1);
  // The flat stone, tipping up on its near edge, its far edge still on the sand, its shadow.
  p.tint(`M214 ${g - 2}C222 ${g - 4} 232 ${g - 2} 238 ${g}C228 ${g + 2} 220 ${g + 1} 214 ${g - 2}Z`, WASH.tip, 0.3);
  p.shape(`M209 ${g - 15}C212 ${g - 20} 222 ${g - 17} 230 ${g - 11}C235 ${g - 7} 239 ${g - 4} 238 ${g - 1}C232 ${g} 222 ${g - 2} 216 ${g - 5}C211 ${g - 8} 208 ${g - 11} 209 ${g - 15}Z`, WASH.grey, 0.55, 1.1);
  p.fine(`M214 ${g - 15}C220 ${g - 13} 227 ${g - 9} 233 ${g - 5}`, 0.8, 0.4);
  // The near leg.
  leg(p, 136, g - 31, g, ORANGE);
  p.label('bill', 250, 60, 209, g - 26);
  p.label('breast', 250, 116, 166, g - 42);
  p.label('wings', 250, 172, 118, g - 66);
  p.label('legs', 250, 228, 138, g - 12);
  p.scale(30, g - 88, g, scale);
  return p.svg(400, 260, 'Field sketch of a ruddy turnstone on the strandline, head down, tipping a flat stone with its bill');
}

/**
 * Purple sandpiper: plump and short necked on wet, weedy rock, the head running into the body, the
 * long bill a little drooped with a yellow base, slate grey with pale feather edges and a purple
 * sheen, the white belly, the short yellow legs.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function sandpiper(p, scale) {
  const g = 206;
  p.tint('M40 236H236V252H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 236, 1.3, 26), 1.2);
  // The rock it stands on, wet and weedy.
  p.shape(`M48 ${g + 2}C70 ${g - 6} 196 ${g - 8} 226 ${g}C236 ${g + 12} 230 ${g + 30} 214 238H60C46 ${g + 28} 42 ${g + 12} 48 ${g + 2}Z`, WASH.grey, 0.5, 1.4);
  p.fine(`M76 ${g + 10}l16 6M170 ${g + 6}l-12 10M128 ${g + 22}l10 -4`, 0.9, 0.5);
  for (const x of [60, 72, 196, 210]) p.shape(blade(x, 236, x + 4, 222, 2.6, 3), WASH.green, 0.5, 0.9);
  // The far leg.
  leg(p, 152, g - 27, g - 2, PIPER_LEG);
  // The whole bird in one line: tail tipped down, round back, the head on a short neck.
  const body = smooth([[64, g - 46, 1], [86, g - 62], [112, g - 76], [140, g - 84], [162, g - 87], [172, g - 95], [184, g - 100],
    [195, g - 95], [199, g - 90, 1], [198, g - 85, 1], [191, g - 82], [184, g - 76], [188, g - 62], [182, g - 44], [162, g - 30],
    [134, g - 27], [108, g - 33], [82, g - 48]]);
  p.shape(body, SLATE, 0.55, 1.5);
  // The white belly, the mottled breast, the purple sheen on the back.
  p.tint(`M108 ${g - 33}C130 ${g - 26} 160 ${g - 28} 180 ${g - 42}C164 ${g - 40} 134 ${g - 38} 108 ${g - 33}Z`, WASH.petal, 0.85);
  let mott = '';
  for (const [x, y] of [[180, g - 66], [174, g - 58], [182, g - 54], [170, g - 50], [176, g - 46], [186, g - 60]]) mott += `M${x} ${y}l2 3`;
  p.fine(mott, 1.4, 0.55);
  p.tint(`M120 ${g - 78}C140 ${g - 86} 160 ${g - 86} 168 ${g - 80}C156 ${g - 74} 136 ${g - 72} 120 ${g - 78}Z`, SHEEN, 0.55);
  // The folded wing to the tail, its feathers edged pale, the thin pale bar along it.
  p.shape(`M162 ${g - 80}C142 ${g - 84} 102 ${g - 74} 68 ${g - 50}C96 ${g - 46} 128 ${g - 42} 152 ${g - 48}C164 ${g - 54} 166 ${g - 70} 162 ${g - 80}Z`, SLATE, 0.6, 1.1);
  p.tint(`M150 ${g - 76}C130 ${g - 78} 104 ${g - 68} 86 ${g - 56}C110 ${g - 60} 134 ${g - 70} 150 ${g - 76}Z`, SHEEN, 0.45);
  let edges = '';
  for (let i = 0; i < 6; i++) edges += `M${154 - i * 13} ${g - 72 + i * 3.2}q-5 4 -11 3`;
  p.fine(edges, 0.9, 0.65);
  p.fine(`M150 ${g - 52}C128 ${g - 48} 100 ${g - 48} 78 ${g - 49}`, 1.6, 0.35);
  // The eye in its pale ring, a faint pale brow.
  p.fine(`M178 ${g - 96}C184 ${g - 98} 190 ${g - 96} 194 ${g - 93}`, 1.2, 0.35);
  p.oval(186, g - 90, 3, 2.8, WASH.petal, 0.9, 0.7);
  p.dot(186.3, g - 90, 1.2);
  // The long bill, a little drooped, yellow at the base.
  p.shape(`M199 ${g - 90}C212 ${g - 88} 224 ${g - 82} 233 ${g - 73}L231 ${g - 72}C222 ${g - 78} 210 ${g - 83} 198 ${g - 85}Z`, WASH.tip, 0.85, 1);
  p.tint(`M199 ${g - 90}C203 ${g - 89} 206 ${g - 88} 209 ${g - 87}L208 ${g - 84}C205 ${g - 84} 201 ${g - 85} 198 ${g - 85}Z`, PIPER_LEG, 0.85);
  // The near leg.
  leg(p, 138, g - 27, g - 2, PIPER_LEG);
  p.label('bill', 250, 60, 226, g - 78);
  p.label('breast', 250, 116, 182, g - 60);
  p.label('wings', 250, 172, 120, g - 60);
  p.label('legs', 250, 228, 140, g - 12);
  p.scale(30, g - 100, g, scale);
  return p.svg(400, 260, 'Field sketch of a purple sandpiper on a wet, weedy rock');
}

/**
 * European eel: a yellow eel lying in a slow S along the pond bed among the weed: a pointed snout on
 * a small flat head, a round body tapering to a flattened tail, one soft fin running from a third of
 * the way along its back round the tail and forward under the belly, the small fin behind the head,
 * the pale yellow belly.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function eel(p, scale) {
  p.tint('M40 96H236V244H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 96, 1.3, 26), 1.2);
  // The bed: soft mud and a few weed stems.
  p.tint('M40 214C90 208 170 218 236 210V244H40Z', WASH.mud, 0.35);
  p.line('M40 214C90 208 170 218 236 210', 1.2);
  for (const [x, h, b] of [[44, 96, 8], [54, 74, -6], [232, 88, -7]]) p.shape(blade(x, 214, x + b, 214 - h, 2.6, b), WASH.green, 0.45, 0.9);
  // The center line from snout (s 0) to tail (s 1), its half width, and the side normals.
  const N = 48;
  /** @type {number[][]} */ const c = [], nrm = [];
  /** @type {number[]} */ const r = [];
  const at = (/** @type {number} */ s) => [222 - s * 166, 164 + Math.sin(s * Math.PI * 2.6 - 0.5) * 22 * (0.45 + 0.55 * s)];
  const half = (/** @type {number} */ s) => s < 0.03 ? 1.2 + (s / 0.03) * 4.6 : s < 0.09 ? 5.8 + ((s - 0.03) / 0.06) * 1.6
    : s < 0.13 ? 7.4 - ((s - 0.09) / 0.04) * 0.5 : s < 0.42 ? 6.9 + ((s - 0.13) / 0.29) * 1.4 : 8.3 * Math.pow(Math.max(0, 1 - (s - 0.42) / 0.58), 0.85) + 0.5;
  for (let i = 0; i <= N; i++) { c.push(at(i / N)); r.push(half(i / N)); }
  for (let i = 0; i <= N; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(N, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    nrm.push([-dy / l, dx / l]);     // toward the back (up the page)
  }
  const side = (/** @type {number} */ i, /** @type {number} */ k) => [c[i][0] + nrm[i][0] * k, c[i][1] + nrm[i][1] * k];
  const tan0 = [c[0][0] - c[1][0], c[0][1] - c[1][1]], l0 = Math.hypot(tan0[0], tan0[1]);
  const snout = [c[0][0] + (tan0[0] / l0) * 3, c[0][1] + (tan0[1] / l0) * 3];
  const tanN = [c[N][0] - c[N - 1][0], c[N][1] - c[N - 1][1]], lN = Math.hypot(tanN[0], tanN[1]);
  const tail = (/** @type {number} */ k) => [c[N][0] + (tanN[0] / lN) * k, c[N][1] + (tanN[1] / lN) * k];
  // The fin: up from the back a third of the way along, under the belly from halfway, rounded at the tail.
  const rise = (/** @type {number} */ s, /** @type {number} */ from) => Math.max(0, Math.min(1, (s - from) / 0.1)) * (3.2 + 1.4 * Math.max(0, (s - 0.6) / 0.4));
  /** @type {number[][]} */ const finPts = [];
  const d0 = Math.round(0.3 * N), v0 = Math.round(0.5 * N);
  for (let i = d0; i <= N; i += 2) finPts.push(side(i, r[i] + rise(i / N, 0.3)));
  finPts.push(tail(5));
  for (let i = N; i >= v0; i -= 2) finPts.push(side(i, -(r[i] + rise(i / N, 0.5))));
  for (let i = v0; i >= d0; i -= 4) finPts.push(c[i]);
  p.shape(smooth(finPts), EEL_FIN, 0.5, 1);
  let rays = '';
  for (let i = d0 + 2; i < N; i += 2) {
    const s = i / N, a = side(i, r[i]), b = side(i, r[i] + rise(s, 0.3) * 0.85);
    rays += `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`;
    if (i > v0) { const e = side(i, -r[i]), h = side(i, -(r[i] + rise(s, 0.5) * 0.85)); rays += `M${r1(e[0])} ${r1(e[1])}L${r1(h[0])} ${r1(h[1])}`; }
  }
  p.fine(rays, 0.6, 0.45);
  // The body over it: pointed snout, round body, the tail running out to a point.
  /** @type {number[][]} */ const out = [[snout[0], snout[1]]];
  for (let i = 1; i <= N; i++) out.push(side(i, r[i]));
  out.push(tail(1.5));
  for (let i = N; i >= 1; i--) out.push(side(i, -r[i]));
  p.shape(smooth(out), EEL, 0.6, 1.4);
  // The pale yellow belly along its lower side, the darker back.
  /** @type {number[][]} */ const bel = [];
  for (let i = 2; i <= 30; i++) bel.push(side(i, -r[i] * 0.95));
  for (let i = 30; i >= 2; i--) bel.push(side(i, -r[i] * 0.15));
  p.tint(smooth(bel), WASH.yellow, 0.75);
  /** @type {number[][]} */ const bk = [];
  for (let i = 3; i <= 40; i++) bk.push(side(i, r[i] * 0.95));
  for (let i = 40; i >= 3; i--) bk.push(side(i, r[i] * 0.45));
  p.tint(smooth(bk), EEL_FIN, 0.45);
  // The line down its side.
  p.fine(`M${c.slice(7, 44).map((q) => `${r1(q[0])} ${r1(q[1])}`).join('L')}`, 0.7, 0.45);
  // The head: the mouth, the small eye high on the flat head, the gill slit and the small fin behind.
  const m0 = side(0, -0.6), m1 = side(3, -1.8);
  p.fine(`M${r1(snout[0] - 1)} ${r1(snout[1] + 0.6)}Q${r1(m0[0])} ${r1(m0[1] + 1.5)} ${r1(m1[0])} ${r1(m1[1])}`, 0.9, 0.8);
  const eye = side(2, r[2] * 0.4);
  p.oval(eye[0], eye[1], 1.7, 1.5, WASH.gold, 0.9, 0.6);
  p.dot(eye[0] + 0.2, eye[1], 0.8);
  const gl = side(6, r[6] * 0.5), gl2 = side(6, -r[6] * 0.2);
  p.fine(`M${r1(gl[0])} ${r1(gl[1])}Q${r1(gl[0] - 2)} ${r1((gl[1] + gl2[1]) / 2)} ${r1(gl2[0])} ${r1(gl2[1])}`, 0.8, 0.6);
  const pf = c[7];
  p.shape(`M${r1(pf[0])} ${r1(pf[1] - 0.5)}C${r1(pf[0] - 3)} ${r1(pf[1] - 3)} ${r1(pf[0] - 7)} ${r1(pf[1] - 1)} ${r1(pf[0] - 7.5)} ${r1(pf[1] + 1.5)}C${r1(pf[0] - 5)} ${r1(pf[1] + 2.5)} ${r1(pf[0] - 2)} ${r1(pf[1] + 2)} ${r1(pf[0])} ${r1(pf[1] + 1)}Z`, EEL_FIN, 0.5, 0.8);
  p.label('head', 250, 70, eye[0], eye[1] - 2);
  const bl = side(16, -r[16] * 0.7), fn = side(44, r[44] + 2);
  p.label('belly', 250, 132, bl[0], bl[1]);
  p.label('fin', 250, 196, fn[0], fn[1]);
  p.scale(30, 120, 214, scale);
  return p.svg(400, 252, 'Field sketch of a yellow European eel lying in an S along the pond bed among the weed');
}

/**
 * Teal: a drake side on, riding high and swimming to the right: a small compact duck, the round
 * chestnut head on a short neck, the green band sweeping back from the eye to the nape, the small
 * dark bill, the spotted cream breast, grey flanks finely lined, the white stripe along the side, the
 * green patch at the back of the wing and the yellow patch under the tail edged in black.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function teal(p, scale) {
  const w = 188;
  p.tint(`M40 ${w}H236V252H40Z`, WASH.water, 0.32);
  p.line(wave(40, 236, w, 1.3, 26), 1.2);
  p.fine(`M70 ${w + 12}C100 ${w + 9} 150 ${w + 14} 200 ${w + 10}M90 ${w + 26}C120 ${w + 23} 160 ${w + 28} 186 ${w + 24}`, 1, 0.45);
  // The whole duck in one line, above the water: tail, back, neck, head, breast.
  const body = smooth([[56, w - 25, 1], [76, w - 22], [104, w - 30], [134, w - 35], [158, w - 37], [167, w - 42], [169, w - 54],
    [173, w - 68], [185, w - 79], [199, w - 77], [207, w - 67, 1], [207, w - 58, 1], [201, w - 54], [194, w - 49], [192, w - 41],
    [198, w - 30], [200, w - 15], [195, w, 1], [72, w, 1], [64, w - 8], [59, w - 17]]);
  p.shape(body, WASH.grey, 0.5, 1.5);
  // The chestnut head, down to the top of the neck.
  p.tint(`M168 ${w - 50}C168 ${w - 62} 174 ${w - 74} 185 ${w - 79}C194 ${w - 81} 203 ${w - 76} 207 ${w - 67}L207 ${w - 58}C201 ${w - 54} 196 ${w - 51} 193 ${w - 46}C186 ${w - 44} 175 ${w - 46} 168 ${w - 50}Z`, TEAL_HEAD, 0.75);
  p.fine(`M168 ${w - 50}C175 ${w - 46} 186 ${w - 44} 193 ${w - 46}`, 0.8, 0.5);
  // The green band from the eye back to the nape, edged with a fine pale line.
  p.shape(`M198 ${w - 66}C190 ${w - 70} 180 ${w - 70} 172 ${w - 64}C169 ${w - 60} 169 ${w - 55} 170 ${w - 51}C174 ${w - 56} 180 ${w - 59} 186 ${w - 60}C191 ${w - 61} 195 ${w - 62} 198 ${w - 66}Z`, TEAL_GREEN, 0.85, 0.9);
  p.oval(195, w - 66, 2.1, 1.9, WASH.tip, 0.9, 0.7);
  p.dot(195.3, w - 66, 1);
  // The small dark bill.
  p.shape(`M207 ${w - 67}L222 ${w - 62}C226 ${w - 61} 226 ${w - 57} 222 ${w - 57}L207 ${w - 58}Z`, WASH.tip, 0.85, 1);
  // The spotted cream breast, the fine grey lines over the flanks.
  p.tint(`M192 ${w - 41}C198 ${w - 30} 200 ${w - 15} 195 ${w}H178C184 ${w - 14} 184 ${w - 30} 180 ${w - 38}Z`, WASH.sand, 0.6);
  let spots = '';
  for (const [x, y] of [[188, w - 34], [192, w - 26], [186, w - 20], [193, w - 14], [188, w - 8], [184, w - 28]]) spots += `M${x} ${y}l1.5 1`;
  p.fine(spots, 1.6, 0.6);
  p.fine(`M96 ${w - 18}C120 ${w - 21} 150 ${w - 21} 176 ${w - 18}M92 ${w - 10}C120 ${w - 13} 150 ${w - 13} 178 ${w - 10}M100 ${w - 4}C124 ${w - 6} 150 ${w - 6} 176 ${w - 4}`, 0.7, 0.4);
  // The white stripe along the side, black below it; the green patch at the back of the wing.
  p.shape(`M106 ${w - 29}C126 ${w - 33} 148 ${w - 34} 166 ${w - 34}L166 ${w - 31}C148 ${w - 30} 126 ${w - 28} 106 ${w - 26}Z`, WASH.petal, 0.9, 0.8);
  p.fine(`M106 ${w - 25}C126 ${w - 27} 148 ${w - 29} 166 ${w - 30}`, 1.4, 0.6);
  p.shape(`M88 ${w - 26}C96 ${w - 29} 104 ${w - 30} 110 ${w - 30}L108 ${w - 24}C102 ${w - 23} 94 ${w - 22} 88 ${w - 22}Z`, TEAL_GREEN, 0.8, 0.9);
  // The yellow patch under the tail, edged in black, and the dark tail.
  p.shape(`M66 ${w - 4}C70 ${w - 14} 78 ${w - 20} 90 ${w - 18}C86 ${w - 12} 84 ${w - 6} 84 ${w - 1}L70 ${w - 1}Z`, WASH.yellow, 0.8, 1.1);
  p.tint(`M56 ${w - 25}L76 ${w - 22}C70 ${w - 20} 64 ${w - 18} 59 ${w - 17}Z`, WASH.tip, 0.6);
  p.label('head', 250, 60, 184, w - 72);
  p.label('bill', 250, 116, 220, w - 60);
  p.label('speculum', 250, 172, 100, w - 26);
  p.label('tail', 250, 228, 78, w - 10);
  p.scale(30, w - 80, w, scale);
  return p.svg(400, 260, 'Field sketch of a drake teal swimming, its chestnut head banded with green');
}

/** An irregular blotch. @param {number} x @param {number} y @param {number} rx @param {number} ry @param {number} k seed */
function blotch(x, y, rx, ry, k) {
  /** @type {number[][]} */ const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, j = 0.7 + 0.5 * Math.abs(Math.sin(k * 7.1 + i * 2.3));
    pts.push([x + Math.cos(a) * rx * j, y + Math.sin(a) * ry * j]);
  }
  return smooth(pts);
}

/**
 * Grey seal: a cow hauled out on the sandbar in the banana pose, head and hind flippers both raised:
 * the heavy body thickest at the chest, the long head with its straight Roman nose and no stop at the
 * brow, the eye set well back, whiskers; her grey coat blotched dark, the hind flippers held together
 * behind, a fore flipper on the sand; once the pup has been seen, the pup in its white coat lying in
 * front of her, round headed and big eyed.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function seal(p, scale) {
  const g = 192;
  p.tint(`M40 ${g}H236V258H40Z`, WASH.sand, 0.4);
  p.line(`M40 ${g}C100 ${g - 2} 170 ${g + 2} 236 ${g - 1}`, 1.3);
  p.fine(`M180 ${g + 20}C200 ${g + 16} 214 ${g + 22} 230 ${g + 18}M44 ${g + 14}C56 ${g + 12} 66 ${g + 15} 74 ${g + 13}`, 0.9, 0.45);
  // The hind flippers, held together and raised behind, their digits fanned.
  p.shape(`M72 ${g - 14}C62 ${g - 18} 50 ${g - 26} 42 ${g - 33}L38 ${g - 27}L41 ${g - 23}L34 ${g - 19}L39 ${g - 15}L34 ${g - 10}C44 ${g - 7} 58 ${g - 5} 70 ${g - 4}Z`, SEAL_DARK, 0.55, 1.1);
  p.fine(`M66 ${g - 13}L41 ${g - 29}M66 ${g - 10}L37 ${g - 18}M66 ${g - 7}L38 ${g - 11}`, 0.8, 0.5);
  // The whole cow in one line: hips, the back rising to the heavy shoulders, the neck, the long head.
  const body = smooth([[70, g - 16], [98, g - 26], [128, g - 38], [154, g - 50], [170, g - 62], [180, g - 74], [190, g - 82],
    [202, g - 85], [214, g - 81], [227, g - 75], [236, g - 69, 1], [238, g - 64], [233, g - 60], [220, g - 58], [206, g - 57],
    [195, g - 50], [190, g - 36], [186, g - 16], [178, g - 2], [160, g, 1], [82, g, 1], [66, g - 6]]);
  p.shape(body, SEAL, 0.55, 1.5);
  // The paler belly and throat.
  p.tint(`M82 ${g}C110 ${g - 6} 150 ${g - 8} 178 ${g - 2}L160 ${g}Z`, WASH.petal, 0.6);
  p.tint(`M206 ${g - 57}C198 ${g - 52} 192 ${g - 42} 190 ${g - 30}C186 ${g - 40} 190 ${g - 54} 200 ${g - 60}Z`, WASH.petal, 0.3);
  // Dark blotches over the coat.
  let k = 0;
  for (const [x, y, rx, ry] of [[92, g - 14, 5, 3], [110, g - 22, 7, 4], [128, g - 14, 4.5, 3], [142, g - 32, 6, 3.5], [160, g - 20, 5, 3.4],
    [118, g - 8, 4, 2.4], [168, g - 44, 4, 3], [150, g - 8, 3.4, 2.2], [176, g - 30, 3.4, 2.6], [96, g - 6, 3, 2]]) p.shape(blotch(x, y, rx, ry, k++), SEAL_DARK, 0.6, 0.7);
  // The fore flipper on the sand, its claws.
  p.shape(`M168 ${g - 28}C164 ${g - 16} 170 ${g - 7} 182 ${g - 3}C188 ${g - 1} 189 ${g + 2} 184 ${g + 2}C170 ${g + 2} 158 ${g - 4} 155 ${g - 15}C155 ${g - 22} 161 ${g - 28} 168 ${g - 28}Z`, SEAL_DARK, 0.5, 1);
  p.fine(`M180 ${g - 1}l3 2M183 ${g - 2}l3 2M185 ${g - 3}l3 1.5M168 ${g - 20}C166 ${g - 12} 170 ${g - 6} 178 ${g - 3}`, 0.8, 0.6);
  // The head: the eye set back, the ear, the nostrils at the tip, the mouth, the whiskers.
  p.oval(203, g - 74, 2.8, 2.5, WASH.tip, 0.9, 0.8);
  p.dot(203.3, g - 74, 1.3);
  p.dot(191, g - 73, 0.8);
  p.fine(`M234 ${g - 68}l2 3M238 ${g - 62}C232 ${g - 61} 228 ${g - 60} 222 ${g - 60}`, 0.9, 0.8);
  p.fine(`M228 ${g - 63}C234 ${g - 62} 240 ${g - 60} 244 ${g - 58}M227 ${g - 61}C232 ${g - 58} 237 ${g - 55} 241 ${g - 52}M226 ${g - 65}C232 ${g - 66} 238 ${g - 66} 243 ${g - 64}`, 0.7, 0.6);
  if (p.knows('pup')) {
    // The pup in its white coat, lying in front of her: plump, its round head and big dark eye.
    const q = g + 46;
    p.shape(`M86 ${q - 10}L74 ${q - 16}L72 ${q - 8}L66 ${q - 4}L80 ${q - 3}Z`, WASH.petal, 0.85, 1);
    p.shape(smooth([[84, q - 10], [100, q - 24], [126, q - 30], [148, q - 30], [158, q - 35], [168, q - 41], [180, q - 40],
      [188, q - 33], [191, q - 26], [188, q - 20], [180, q - 16], [170, q - 12], [164, q - 5], [154, q, 1], [96, q, 1], [86, q - 4]]), WASH.petal, 0.85, 1.3);
    p.shape(`M150 ${q - 10}C152 ${q - 5} 157 ${q - 2} 164 ${q - 1}C166 ${q} 166 ${q + 2} 163 ${q + 2}C154 ${q + 2} 147 ${q - 2} 145 ${q - 7}Z`, WASH.petal, 0.85, 0.9);
    p.oval(176, q - 31, 3.4, 3.2, WASH.tip, 0.9, 0.8);
    p.dot(176.3, q - 31, 1.7);
    p.dot(189, q - 26, 0.8);
    p.fine(`M185 ${q - 22}C189 ${q - 21} 193 ${q - 20} 196 ${q - 18}M184 ${q - 20}C187 ${q - 18} 191 ${q - 15} 194 ${q - 13}`, 0.7, 0.5);
    let fluff = '';
    for (const [x, y] of [[104, q - 18], [118, q - 22], [132, q - 20], [146, q - 22], [112, q - 10], [128, q - 12], [160, q - 26]]) fluff += `M${x} ${y}q2 -2 4 0`;
    p.fine(fluff, 0.8, 0.4);
  }
  p.label('head', 250, 70, 222, g - 76);
  p.label('coat', 250, 128, 142, g - 32);
  p.label('flippers', 250, 186, 44, g - 26);
  p.label('pup', 250, 236, 136, g + 22);
  p.scale(30, g - 86, g, scale);
  return p.svg(400, 264, 'Field sketch of a grey seal hauled out on the sandbar, her head raised');
}
