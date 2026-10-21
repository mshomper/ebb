// @ts-check
// Feather keepsakes (docs/future/12): a feather lying flat. A curved shaft (the rachis) with a vane
// either side, the outer vane narrower as on a flight feather, a downy base, splits in the vane where
// the barbs have parted, and a pattern: plain, barred, tipped or spotted. The rare mark is a twinned
// feather: two vanes grown from one quill.

import { builder } from '../../finds/procedural.js';
import { draws } from './common.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */

/** @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json */
export function featherNumbers(h0, rarity, K) {
  const S = K.feathers, Tr = S.tiers[rarity], d = draws(h0);
  const twin = d.chance(S.marks.twinned.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const bi = d.pick(Tr.base, 9);
  return {
    family: 'feather', gen: S.gen, rarity, form: d.u(2) < Tr.flightShare ? 'flight' : 'contour',
    sizeM: d.range(Tr.sizeM, 3), width: d.range(Tr.width, 4), curve: d.range([-0.12, 0.12], 5),
    asym: d.range([0.45, 0.8], 6), splits: d.int(Tr.splits, 7), splitSeed: d.int([0, 1e6], 8),
    pattern: S.patternOrder[pickW(d.u(11), Tr.patterns)], bars: d.int(Tr.bars, 12),
    base: d.tone(S.colors.base[bi], S.colors.jitter, 10), baseName: S.colors.baseNames[bi],
    mark2: S.colors.mark[d.pick(Tr.mark, 13)].slice(),
    twin, mark: twin ? 'twinned' : null,
  };
}

/** @param {number} u @param {number[]} w */
function pickW(u, w) {
  let t = u * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { if (t < w[i]) return i; t -= w[i]; }
  return w.length - 1;
}

/** @param {any} n @param {any} K */
export function featherWords(n, K) {
  const S = K.feathers;
  let line = `a ${n.baseName} ${n.form === 'flight' ? 'flight feather' : 'feather'}`;
  const p = S.words.patterns[n.pattern];
  if (p) line += ', ' + p;
  if (n.mark === 'twinned') line += ', ' + S.marks.twinned.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function featherMesh(n, K) {
  const M = K.feathers.mesh, b = builder();
  const L = n.sizeM, Wd = L * n.width;
  const quill = 0.12;
  // How much of the vane is there at t along it, on the left (-1) or right (+1) side.
  const half = (/** @type {number} */ t, /** @type {number} */ side) => {
    if (t < quill) return 0;
    const s = (t - quill) / (1 - quill);
    let w = Math.sin(Math.PI * Math.min(1, s * 1.15)) ** 0.6 * (1 - 0.15 * s);
    if (n.form === 'flight') w *= side < 0 ? n.asym : 1;
    // Splits: narrow notches where the barbs have parted.
    for (let k = 0; k < n.splits; k++) {
      const at = 0.3 + 0.6 * (((Math.sin(n.splitSeed * 0.13 + k * 3.7) + 1) / 2));
      const sd = Math.sin(n.splitSeed + k) > 0 ? 1 : -1;
      if (sd === side) w *= 1 - 0.85 * Math.exp(-(((s - at) / 0.012) ** 2));
    }
    return w * Wd * 0.5;
  };
  const colour = (/** @type {number} */ t, /** @type {number} */ x) => {
    let m = 0;
    if (n.pattern === 'barred') m = Math.cos(n.bars * t * Math.PI * 2) > 0.4 ? 1 : 0;
    else if (n.pattern === 'tipped') m = t > 0.82 ? 1 : 0;
    else if (n.pattern === 'spotted') m = Math.cos(n.bars * t * Math.PI * 2) * Math.cos(x * 9) > 0.6 ? 1 : 0;
    else if (n.pattern === 'edged') m = Math.abs(x) > 0.75 ? 1 : 0;
    // Down at the base is paler.
    const down = t < 0.22 ? 0.35 * (1 - t / 0.22) : 0;
    return [0, 1, 2].map((r) => {
      const c = n.base[r] + (n.mark2[r] - n.base[r]) * m;
      return c + (0.85 - c) * down;
    });
  };
  /** One vane-and-shaft feather along a curve, turned by yaw about its quill. @param {number} yaw */
  const one = (yaw) => {
    const rows = M.rows, cols = M.cols, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const place = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ y) => [cy * x - sy * z, y, sy * x + cy * z];
    /** @type {number[]} */ const idx = [];
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      // The shaft curves gently; the vane lies a hair above the ground, the shaft a little higher.
      const cx = n.curve * L * Math.sin(Math.PI * t), cz = t * L;
      for (let j = 0; j < cols; j++) {
        const s = (j / (cols - 1)) * 2 - 1, side = s < 0 ? -1 : 1;
        const x = cx + s * half(t, side);
        const y = (1 - Math.abs(s)) * L * 0.012 + Math.abs(s) * 0.0005;
        idx.push(b.vert(place(x, cz, y), [0, 1, 0], colour(t, s)));
      }
    }
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      const a = idx[i * cols + j], c = idx[i * cols + j + 1], d = idx[(i + 1) * cols + j], e = idx[(i + 1) * cols + j + 1];
      b.tri(a, d, c); b.tri(c, d, e);
    }
    // The bare quill below the vane, a thin pale strip.
    const q0 = b.vert(place(-L * 0.006, 0, 0.001), [0, 1, 0], [0.85, 0.82, 0.74]), q1 = b.vert(place(L * 0.006, 0, 0.001), [0, 1, 0], [0.85, 0.82, 0.74]);
    const q2 = b.vert(place(-L * 0.004, quill * L, 0.002), [0, 1, 0], [0.85, 0.82, 0.74]), q3 = b.vert(place(L * 0.004, quill * L, 0.002), [0, 1, 0], [0.85, 0.82, 0.74]);
    b.tri(q0, q2, q1); b.tri(q1, q2, q3);
  };
  one(0);
  if (n.twin) one(0.35);
  return b.done();
}
