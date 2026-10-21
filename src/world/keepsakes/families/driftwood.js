// @ts-check
// Driftwood keepsakes (docs/future/12): a hand-sized piece of sea-worn wood. A bent, tapering
// branch with knots, its grain running along it with a twist, silvered by the sea to a degree, and
// sometimes a broken side stub. The rare mark is a root knot: one end swells into a knuckle of
// roots.

import { builder } from '../../finds/procedural.js';
import { draws, fitTo, gridMesh } from './common.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */

/** @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json */
export function driftwoodNumbers(h0, rarity, K) {
  const S = K.driftwood, Tr = S.tiers[rarity], d = draws(h0);
  const root = d.chance(S.marks.rootKnot.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const wi = d.pick(Tr.wood, 9);
  return {
    family: 'driftwood', gen: S.gen, rarity, form: d.u(2) < 0.5 ? 'branch' : 'twig',
    sizeM: d.range(Tr.sizeM, 3), thick: d.range(Tr.thick, 4), taper: d.range([0.2, 0.6], 5),
    bend: d.range(Tr.bend, 6), bendTurns: d.range([0.5, 1.6], 7), bendPhase: d.range([0, 6.283], 8),
    twist: d.range(Tr.twist, 10), grainCount: d.int([5, 11], 11), knots: d.int(Tr.knots, 12),
    knotSeed: d.int([0, 1e6], 13), stub: d.chance(Tr.stubChance, 14) ? d.range([0.25, 0.75], 15) : 0,
    silver: d.range(Tr.silver, 16), wood: S.colors.wood[wi].slice(), woodName: S.colors.woodNames[wi],
    root, mark: root ? 'rootKnot' : null,
  };
}

/** @param {any} n @param {any} K */
export function driftwoodWords(n, K) {
  const S = K.driftwood;
  let line = `a ${n.silver > 0.6 ? 'silvered' : n.woodName} piece of driftwood`;
  if (n.twist > 0.8) line += ', twisted';
  if (n.mark === 'rootKnot') line += ', ' + S.marks.rootKnot.word;
  else if (n.knots > 2) line += ', knotted';
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function driftwoodMesh(n, K) {
  const M = K.driftwood.mesh, b = builder();
  const silverC = K.driftwood.colors.silver;
  const colour = (/** @type {number} */ t, /** @type {number} */ a) => {
    const g = Math.cos(n.grainCount * a + n.twist * t * Math.PI * 4);
    const line = g > 0.82 ? 0.72 : 1;
    // Ends and edges silver most.
    const s = Math.min(1, n.silver * (0.8 + 0.4 * Math.abs(t - 0.5) * 2));
    return [0, 1, 2].map((r) => (n.wood[r] + (silverC[r] - n.wood[r]) * s) * line);
  };
  /** A tube along a path with radii: rows along it, columns round it. @param {number[][]} pts @param {number[]} rad */
  const tube = (pts, rad, cap = true) => {
    const rows = pts.length, cols = M.sides;
    const P = new Float32Array(rows * cols * 3), C = new Float32Array(P.length), cen = new Float32Array(rows * 3);
    for (let i = 0; i < rows; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(rows - 1, i + 1)];
      let tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // Two directions square to the path.
      let sx = -tz, sy = 0, sz = tx;
      if (Math.hypot(sx, sz) < 0.1) { sx = 1; sz = 0; }
      const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
      const qx = sy * tz - sz * ty, qy = sz * tx - sx * tz, qz = sx * ty - sy * tx;
      cen.set(pts[i], i * 3);
      for (let j = 0; j < cols; j++) {
        const ang = (j / cols) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
        const k = (i * cols + j) * 3;
        P.set([pts[i][0] + (sx * cs + qx * sn) * rad[i], pts[i][1] + (sy * cs + qy * sn) * rad[i], pts[i][2] + (sz * cs + qz * sn) * rad[i]], k);
        C.set(colour(i / (rows - 1), ang), k);
      }
    }
    return { P, C, cen, rows, cols, cap };
  };
  const parts = [];
  const N = M.rows, pts = [], rad = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const w = t * n.bendTurns * Math.PI * 2 + n.bendPhase;
    pts.push([t - 0.5, n.bend * Math.sin(w) * 0.5, n.bend * Math.cos(w * 0.7) * 0.4]);
    let r = n.thick * (1 - n.taper * t);
    // Knots: small swellings at seeded places along it.
    for (let k = 0; k < n.knots; k++) {
      const at = ((Math.sin(n.knotSeed * 0.37 + k * 7.1) + 1) / 2) * 0.8 + 0.1;
      r *= 1 + 0.35 * Math.exp(-(((t - at) / 0.04) ** 2));
    }
    // A root knot swells the near end into a knuckle.
    if (n.root) r *= 1 + 1.3 * Math.exp(-(((t - 0.04) / 0.08) ** 2));
    // Broken ends narrow to splinters.
    r *= Math.min(1, 0.25 + Math.min(t, 1 - t) * 14);
    rad.push(Math.max(0.002, r));
  }
  parts.push(tube(pts, rad));
  if (n.stub) {
    const i0 = Math.round(n.stub * (N - 1)), p0 = pts[i0], r0 = rad[i0] * 0.55;
    const sp = [], sr = [];
    for (let i = 0; i < 5; i++) { const s = i / 4; sp.push([p0[0] + s * 0.06, p0[1] + s * 0.12, p0[2] - s * 0.05]); sr.push(r0 * (1 - 0.5 * s)); }
    parts.push(tube(sp, sr));
  }
  if (n.root) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + n.bendPhase, p0 = pts[1], rp = [], rr = [];
      for (let i = 0; i < 5; i++) { const s = i / 4; rp.push([p0[0] - s * 0.1, p0[1] + Math.cos(a) * s * 0.09, p0[2] + Math.sin(a) * s * 0.09]); rr.push(rad[1] * 0.35 * (1 - 0.8 * s)); }
      parts.push(tube(rp, rr));
    }
  }
  // Fit all parts together to the size.
  const allP = new Float32Array(parts.reduce((s, q) => s + q.P.length, 0)), allC = new Float32Array(parts.reduce((s, q) => s + q.cen.length, 0));
  let o = 0, oc = 0;
  for (const q of parts) { allP.set(q.P, o); allC.set(q.cen, oc); o += q.P.length; oc += q.cen.length; }
  fitTo(allP, allC, n.sizeM);
  o = 0; oc = 0;
  for (const q of parts) {
    const P = allP.subarray(o, o + q.P.length), cen = allC.subarray(oc, oc + q.cen.length);
    gridMesh(b, P, q.C, q.rows, q.cols, cen, { capStart: true, capEnd: true });
    o += q.P.length; oc += q.cen.length;
  }
  return b.done();
}
