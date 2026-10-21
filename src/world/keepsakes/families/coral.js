// @ts-check
// Coral sprigs (docs/future/12): a small broken branch of coral, sea-worn. A stem that forks and
// forks again, each branch thinner and turning a little, with blunt rounded tips; bleached white
// or pink, the rarer ones deep red. The rare mark is a fan: the branches all spread in one plane,
// a sea fan's lace.

import { builder } from '../../finds/procedural.js';
import { hash32 } from '../../../core/rng.js';
import { draws, fitTo, gridMesh, u01 } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function coralNumbers(h0, rarity, K) {
  const S = K.corals, Tr = S.tiers[rarity], d = draws(h0);
  const fan = d.chance(S.marks.fan.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const bi = d.pick(Tr.base, 9);
  return {
    family: 'coral', gen: S.gen, rarity, form: fan ? 'fan' : 'branch',
    sizeM: d.range(Tr.sizeM, 3), depth: d.int(Tr.depth, 4), spread: d.range([0.35, 0.7], 5), thick: d.range([0.05, 0.08], 6),
    branchSeed: d.int([0, 1e6], 7), base: d.tone(S.colors.base[bi], S.colors.jitter, 10), baseName: S.colors.baseNames[bi],
    fan, mark: fan ? 'fan' : null,
  };
}

/** @param {any} n @param {any} K */
export function coralWords(n, K) {
  let line = `a sprig of ${n.baseName} coral${n.depth > 3 ? ', finely branched' : ''}`;
  if (n.mark) line += ', ' + K.corals.marks.fan.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function coralMesh(n, K) {
  const M = K.corals.mesh, b = builder();
  /** @type {{ pts: number[][], rad: number[] }[]} */ const tubes = [];
  // Grow branches: each a short bent tube, forking into two at its end until depth runs out.
  /** @param {number[]} p0 @param {number[]} dir @param {number} r @param {number} len @param {number} level @param {number} id */
  const grow = (p0, dir, r, len, level, id) => {
    const pts = [], rad = [];
    const bend = (u01(hash32(n.branchSeed, id, 1)) - 0.5) * 0.6;
    let p = p0.slice(), dv = dir.slice();
    for (let i = 0; i <= M.segs; i++) {
      pts.push(p.slice()); rad.push(r * (1 - 0.25 * (i / M.segs)));
      // A slow turn as it goes, kept in a plane for a fan.
      dv = [dv[0] + bend * 0.12, dv[1], n.fan ? 0 : dv[2] + bend * 0.08];
      const l = Math.hypot(dv[0], dv[1], dv[2]);
      dv = dv.map((v) => v / l);
      p = [p[0] + dv[0] * len / M.segs, p[1] + dv[1] * len / M.segs, p[2] + dv[2] * len / M.segs];
    }
    tubes.push({ pts, rad });
    if (level >= n.depth) return;
    for (const side of [-1, 1]) {
      const a = side * n.spread * (0.7 + 0.6 * u01(hash32(n.branchSeed, id, 2 + side)));
      const turn = n.fan ? 0 : u01(hash32(n.branchSeed, id, 5 + side)) * Math.PI;
      // Rotate the direction by a about an axis square to it (in the fan's plane for a fan).
      const ax = n.fan ? [0, 0, 1] : [Math.cos(turn), 0, Math.sin(turn)];
      const c = Math.cos(a), s = Math.sin(a), d0 = dv;
      const cr = [ax[1] * d0[2] - ax[2] * d0[1], ax[2] * d0[0] - ax[0] * d0[2], ax[0] * d0[1] - ax[1] * d0[0]];
      const dot = ax[0] * d0[0] + ax[1] * d0[1] + ax[2] * d0[2];
      const nd = [0, 1, 2].map((k) => d0[k] * c + cr[k] * s + ax[k] * dot * (1 - c));
      grow(pts[pts.length - 1], nd, r * 0.72, len * 0.78, level + 1, id * 2 + (side > 0 ? 1 : 0));
    }
  };
  grow([0, 0, 0], [0, 1, 0], n.thick, 0.42, 0, 1);
  // Tubes into arrays, fitted together to the size, laid down on their side.
  const cols = M.sides;
  const all = tubes.map((t) => {
    const rows = t.pts.length, P = new Float32Array(rows * cols * 3), C = new Float32Array(P.length), cen = new Float32Array(rows * 3);
    for (let i = 0; i < rows; i++) {
      const a = t.pts[Math.max(0, i - 1)], c2 = t.pts[Math.min(rows - 1, i + 1)];
      let tx = c2[0] - a[0], ty = c2[1] - a[1], tz = c2[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = 1, sy = 0, sz = 0;
      if (Math.abs(tx) > 0.9) { sx = 0; sz = 1; }
      // A side vector square to the path, and a third square to both.
      const dd = sx * tx + sy * ty + sz * tz;
      sx -= dd * tx; sy -= dd * ty; sz -= dd * tz;
      const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
      const qx = ty * sz - tz * sy, qy = tz * sx - tx * sz, qz = tx * sy - ty * sx;
      // Laid on its side: y up becomes z, so the sprig lies flat.
      const lay = (/** @type {number[]} */ q) => [q[0], q[2], q[1]];
      cen.set(lay(t.pts[i]), i * 3);
      for (let j = 0; j < cols; j++) {
        const w = (j / cols) * Math.PI * 2, k = (i * cols + j) * 3, r = t.rad[i];
        P.set(lay([t.pts[i][0] + (sx * Math.cos(w) + qx * Math.sin(w)) * r, t.pts[i][1] + (sy * Math.cos(w) + qy * Math.sin(w)) * r, t.pts[i][2] + (sz * Math.cos(w) + qz * Math.sin(w)) * r]), k);
        // Pores: a faint speckle of darker dots.
        const dark = u01(hash32(n.branchSeed, k)) > 0.85 ? 0.85 : 1;
        C.set(n.base.map((/** @type {number} */ v) => v * dark), k);
      }
    }
    return { P, C, cen, rows };
  });
  const allP = new Float32Array(all.reduce((s, q) => s + q.P.length, 0)), allC = new Float32Array(all.reduce((s, q) => s + q.cen.length, 0));
  let o = 0, oc = 0;
  for (const q of all) { allP.set(q.P, o); allC.set(q.cen, oc); o += q.P.length; oc += q.cen.length; }
  fitTo(allP, allC, n.sizeM);
  o = 0; oc = 0;
  for (const q of all) {
    gridMesh(b, allP.subarray(o, o + q.P.length), q.C, q.rows, cols, allC.subarray(oc, oc + q.cen.length), { capStart: true, capEnd: true });
    o += q.P.length; oc += q.cen.length;
  }
  return b.done();
}
