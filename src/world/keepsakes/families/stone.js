// @ts-check
// Stone keepsakes (docs/future/12): hand-sized beach stones. A sphere pushed in and out by a few
// seeded waves, flattened toward a pebble, coloured by its rock with veins or bands running through
// it at a tilt and a fine grain. The rare mark is a holed stone (a hag stone): the sea has worn a
// hole right through, so it is built as a lumpy ring instead.

import { builder } from '../../finds/procedural.js';
import { hash32 } from '../../../core/rng.js';
import { draws, fitTo, gridMesh, lumps, makeWaves, u01 } from './common.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */

/** @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json */
export function stoneNumbers(h0, rarity, K) {
  const S = K.stones, Tr = S.tiers[rarity], d = draws(h0);
  const holed = d.chance(S.marks.holed.chance * (Tr.holedLean ?? 1), 20) ? 1 : 0;
  const veins = d.chance(Tr.veins.chance, 8);
  const bi = d.pick(Tr.base, 9);
  const base = d.tone(S.colors.base[bi], S.colors.jitter, 10);
  return {
    family: 'stone', gen: S.gen, rarity, form: holed ? 'holed' : d.u(2) < Tr.pebbleShare ? 'pebble' : 'stone',
    sizeM: d.range(Tr.sizeM, 3), flat: d.range(Tr.flat, 4), long: d.range(Tr.long, 5),
    lump: d.range(Tr.lump, 6), lumpSeed: d.int([0, 1e6], 7),
    veinCount: veins ? d.int(Tr.veins.count, 11) : 0, veinWidth: d.range(Tr.veins.width, 12),
    veinTilt: d.range([0, 1], 13), veinPhase: d.range([0, 6.283], 14),
    grain: d.range(Tr.grain, 15), base, colorName: S.colors.baseNames[bi], vein: S.colors.vein[d.pick(Tr.vein, 16)].slice(),
    holeShare: d.range(S.marks.holed.holeShare, 21),
    mark: holed ? 'holed' : null,
  };
}

/** @param {any} n @param {any} K */
export function stoneWords(n, K) {
  const S = K.stones;
  let line = `a ${n.colorName} ${n.flat < 0.5 ? 'pebble' : 'stone'}`;
  if (n.veinCount > 0) line += n.veinCount > 2 ? ', banded' : `, with a ${n.veinCount > 1 ? 'pair of veins' : 'vein'} running through`;
  if (n.mark === 'holed') line += ', ' + S.marks.holed.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function stoneMesh(n, K) {
  const M = K.stones.mesh;
  const waves = makeWaves((i) => u01(hash32(n.lumpSeed, i)), 0, 5, [1.2, 3.2], n.lump);
  const ax = [Math.cos(n.veinTilt * 2.2), Math.sin(n.veinTilt * 2.2), 0.3];
  const colourAt = (/** @type {number[]} */ p, /** @type {number} */ k) => {
    const v = n.veinCount > 0 ? Math.max(0, Math.cos(n.veinCount * 3 * (p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]) + n.veinPhase)) : 0;
    const w = v > 1 - n.veinWidth ? 1 : 0;
    // A fine grain: each vertex a touch lighter or darker.
    const g = 1 + n.grain * (u01(hash32(n.lumpSeed, 999, k)) - 0.5);
    return [0, 1, 2].map((r) => (n.base[r] + (n.vein[r] - n.base[r]) * w) * g);
  };
  const b = builder();
  if (n.mark === 'holed') {
    // A lumpy ring lying flat: rows round the ring, columns round its tube.
    const rows = M.rings * 2, cols = M.sides, R = 1, r = 1 - n.holeShare;
    const P = new Float32Array((rows + 1) * cols * 3), C = new Float32Array(P.length), cen = new Float32Array((rows + 1) * 3);
    for (let i = 0; i <= rows; i++) {
      const a = ((i % rows) / rows) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      cen.set([ca * R * n.long, 0, sa * R], i * 3);
      for (let j = 0; j < cols; j++) {
        const t = (j / cols) * Math.PI * 2;
        const dir = [ca * Math.cos(t), Math.sin(t), sa * Math.cos(t)];
        const rr = r * (1 + lumps([ca, Math.sin(t), sa], waves));
        const p = [ca * (R + rr * Math.cos(t)) * n.long, rr * Math.sin(t) * n.flat * 1.6, sa * (R + rr * Math.cos(t))];
        const k = (i * cols + j) * 3;
        P.set(p, k);
        // The last row closes the ring onto the first, so it takes the first row's colours.
        C.set(colourAt(dir, (i % rows) * cols + j), k);
      }
    }
    fitTo(P, cen, n.sizeM);
    gridMesh(b, P, C, rows + 1, cols, cen);
    return b.done();
  }
  const rows = M.rings, cols = M.sides;
  const P = new Float32Array((rows + 1) * cols * 3), C = new Float32Array(P.length), cen = new Float32Array((rows + 1) * 3);
  for (let i = 0; i <= rows; i++) {
    // Rings stop short of the poles, which are closed with caps, so no ring shrinks to a point.
    const th = ((i + 0.5) / (rows + 1)) * Math.PI;
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const dir = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const rad = 1 + lumps(dir, waves);
      const k = (i * cols + j) * 3;
      P.set([dir[0] * rad * n.long, dir[1] * rad * n.flat, dir[2] * rad], k);
      C.set(colourAt(dir, i * cols + j), k);
    }
  }
  // Each ring's own centre, so the caps close over the middle of the ring.
  for (let i = 0; i <= rows; i++) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < cols; j++) { const k = (i * cols + j) * 3; x += P[k]; y += P[k + 1]; z += P[k + 2]; }
    cen.set([x / cols, y / cols, z / cols], i * 3);
  }
  fitTo(P, cen, n.sizeM);
  // Outward from the stone's middle, not each ring's, so the normals face out everywhere.
  const mid = new Float32Array(cen.length);
  let my = 0;
  for (let i = 0; i <= rows; i++) my += cen[i * 3 + 1];
  my /= rows + 1;
  for (let i = 0; i <= rows; i++) mid.set([cen[i * 3], my, cen[i * 3 + 2]], i * 3);
  gridMesh(b, P, C, rows + 1, cols, mid);
  // Caps over the ends.
  for (const [i, up] of [[0, 1], [rows, -1]]) {
    const t = b.vert([cen[i * 3], cen[i * 3 + 1] + up * 0.0, cen[i * 3 + 2]], [0, up, 0], [C[i * cols * 3], C[i * cols * 3 + 1], C[i * cols * 3 + 2]]);
    const first = t - (rows + 1) * cols - (i === rows ? 1 : 0);
    for (let j = 0; j < cols; j++) {
      const a = first + i * cols + j, c = first + i * cols + ((j + 1) % cols);
      if (up > 0) b.tri(t, c, a); else b.tri(t, a, c);
    }
  }
  return b.done();
}
