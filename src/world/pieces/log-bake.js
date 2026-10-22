// @ts-check
// A driftwood log baked from its own seed (docs/future/11, L2): one of four forms (a straight trunk,
// a bowed limb, a forked branch with one arm snapped short, or a root end with a flared foot of
// broken roots), with 0 to 4 snapped stubs, knots, and ends torn, split or worn round. Its seed also
// says how long it drifted at sea (sea 0 fresh .. 1 old): a fresh log keeps patches of bark (drawn
// by piece-draw.wgsl from this number), an old one's ends are worn round.
//
// The mesh keeps the old layout the fungi read (log-surface.js): the trunk first, ring by ring,
// `around` vertices round each (vertex j at the angle 2 pi j / around, 0 its right flank and pi/2 its
// top), then its end caps, then the stubs, the snapped arm and the roots, each a small tube of its
// own. It is built to true proportions (in thicknesses), then its length is squeezed to 1 along z:
// 1 long and 1 thick in mesh units, base on y = 0, as the draw pass expects (model.js logBone).
// Vertex albedo is linear and physical (docs/05). Pure and deterministic.

import { hash32 } from '../../core/rng.js';

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */
/** @typedef {'straight' | 'bowed' | 'forked' | 'rootend'} LogForm */

/** The four forms, in the order the recipe's weights are given. */
export const LOG_FORMS = /** @type {LogForm[]} */ (['straight', 'bowed', 'forked', 'rootend']);

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
const TAU = 2 * Math.PI;

/**
 * Which form a log is and how long it was at sea, from its seed alone (the journal and the draw
 * pass ask without baking). @param {number} seed @param {any} D pieces.json driftwood
 * @returns {{ form: LogForm, sea: number }}
 */
export function logLook(seed, D) {
  const h = hash32(seed >>> 0, 0x10f);
  const w = D.forms.weights, total = w.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
  let pick = u01(hash32(h, 1)) * total, form = LOG_FORMS[0];
  for (let k = 0; k < LOG_FORMS.length; k++) { if (pick < w[k]) { form = LOG_FORMS[k]; break; } pick -= w[k]; }
  // Time at sea leans old: most driftwood has been out a long while.
  const sea = Math.pow(u01(hash32(h, 2)), D.sea.leanOld);
  return { form, sea };
}

/**
 * A tube along a straight line, ring by ring, its far end torn (a fan cap a little inside the rim).
 * In true proportions (thicknesses). Pushes into v (9 floats a vertex: position, normal left 0,
 * then kind info: knot, part, cap) and idx.
 * @param {number[]} v @param {number[]} idx @param {number[]} from @param {number[]} dir unit
 * @param {number} len @param {number} r0 radius at its foot @param {number} r1 at its tip
 * @param {number} rings @param {number} around @param {number} jag how torn the tip is (thicknesses) @param {number} hs a seed
 */
function tube(v, idx, from, dir, len, r0, r1, rings, around, jag, hs) {
  // A frame round dir: u, w with u x w = dir, so the angle turns from u toward w.
  const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cr = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nz = (/** @type {number[]} */ a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
  const u = nz(cr(ref, dir)), w = cr(dir, u);
  const base = v.length / 9;
  for (let n = 0; n < rings; n++) {
    const t = n / (rings - 1);
    for (let j = 0; j < around; j++) {
      const a = (j / around) * TAU;
      const tip = n === rings - 1 ? jag * (0.3 + u01(hash32(hs, j)) ** 2) : 0;
      const s = t * len - tip, r = (r0 + (r1 - r0) * t) * (n === rings - 1 ? 0.9 : 1);
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      v.push(from[0] + dir[0] * s + u[0] * ca + w[0] * sa, from[1] + dir[1] * s + u[1] * ca + w[1] * sa, from[2] + dir[2] * s + u[2] * ca + w[2] * sa,
        0, 0, 0, 0, 1, 0);
    }
  }
  for (let n = 0; n < rings - 1; n++) for (let j = 0; j < around; j++) {
    const a = base + n * around + j, b = base + n * around + ((j + 1) % around), c = a + around, d = b + around;
    idx.push(a, b, c, b, d, c);
  }
  const ring = base + (rings - 1) * around, mid = v.length / 9;
  const e = from.map((x, k) => x + dir[k] * (len - jag * 0.5));
  v.push(e[0], e[1], e[2], 0, 0, 0, 0, 1, 1);
  for (let j = 0; j < around; j++) idx.push(mid, ring + j, ring + ((j + 1) % around));
}

/**
 * Bake one log. @param {any} D pieces.json driftwood @param {number} seed its seed
 * @param {number} aspect its thickness over its length (size / length)
 * @returns {{ mesh: Mesh, hy: number, form: LogForm, sea: number, footprint: number[][] }}
 *   hy: the trunk's height (mesh units); footprint: points along it and at the tips of its arm and
 *   roots, [x, z] in mesh units (the grass clears round them)
 */
export function bakeLogSeed(D, seed, aspect) {
  const L = D.shape, F = D.forms;
  const { form, sea } = logLook(seed, D);
  const h = hash32(seed >>> 0, 0x10c);
  const r = (/** @type {number} */ k, /** @type {number[]} */ range) => range[0] + (range[1] - range[0]) * u01(hash32(h, k));
  const P = F[form];
  const A = L.around, N = L.rings;
  const lenT = 1 / Math.max(0.03, Math.min(0.5, aspect));   // its length, in thicknesses
  const side = u01(hash32(h, 2)) < 0.5 ? -1 : 1;
  const bow = r(1, P.bow) * side, bowUp = r(3, P.bow) * 0.3;
  const taper = r(4, P.taper), ph = u01(hash32(h, 5)) * TAU;
  // A root end flares at its first end; which end is the root is t = 0.
  const flare = form === 'rootend' ? r(7, F.rootend.flare) : 0;
  const flareT = F.rootend.flareShare;
  const knots = Array.from({ length: L.knots[0] + Math.floor(u01(hash32(h, 6)) * (L.knots[1] - L.knots[0] + 1)) }, (_, k) => ({
    z: (-0.35 + 0.7 * u01(hash32(h, 20, k))) * lenT, a: u01(hash32(h, 21, k)) * TAU, size: r(22 + k * 3, L.knotSize) * lenT }));
  // Old wood's breaks are worn round; fresh ones are torn.
  const jag = L.jag * lenT * (1 - D.sea.wearEnds * sea);
  // A split end: a crack running in from the rim, at one angle, some way along.
  const splits = [0, 1].map((end) => (u01(hash32(h, 50 + end)) < F.splitChance
    ? { a: u01(hash32(h, 52 + end)) * TAU, deep: r(54 + end, F.splitDeep) } : null));
  const torn = (/** @type {number} */ end, /** @type {number} */ j) => {
    const a = (j / A) * TAU;
    const spike = u01(hash32(h, 40 + end, j)) ** 3;
    return jag * (0.35 + 0.35 * Math.sin(a * 2 + ph * (end + 1)) + spike);
  };
  /** The trunk's axis at t (0..1), sideways and up, in thicknesses: its bow kept about its middle. @param {number} t */
  const axisAt = (t) => [bow * (Math.sin(Math.PI * t) - 2 / Math.PI), 0.5 + bowUp * Math.sin(Math.PI * t)];
  /** Its radius at t and angle a, before knots. @param {number} t @param {number} a @param {number} z */
  const radiusAt = (t, a, z) => {
    let rad = 0.5 * (1 - taper * t) * (1 + L.swell * Math.sin(a * 3 + ph + z * 9 / lenT) * Math.sin((z * 7) / lenT + ph));
    if (flare > 0 && t < flareT) { const k = 1 - t / flareT; rad *= 1 + flare * k * k; }
    return rad;
  };
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  for (let n = 0; n < N; n++) {
    const t = n / (N - 1), z0 = (t - 0.5) * lenT;
    const [cx, cy] = axisAt(t);
    for (let j = 0; j < A; j++) {
      const a = (j / A) * TAU;
      const end = n === 0 ? torn(0, j) : n === N - 1 ? -torn(1, j) : 0;
      const z = z0 + end;
      let rad = radiusAt(t, a, z);
      if (n === 0 || n === N - 1) rad *= 0.92;
      // A split: a V pinched in toward the axis over the last deep thicknesses at either end.
      for (const [e, sp] of splits.entries()) {
        if (!sp) continue;
        const fromEnd = e ? (1 - t) * lenT : t * lenT;
        if (fromEnd > sp.deep) continue;
        const da = Math.atan2(Math.sin(a - sp.a), Math.cos(a - sp.a));
        rad *= 1 - F.splitPinch * Math.exp(-(da * da) / 0.05) * (1 - fromEnd / sp.deep);
      }
      let knot = 0;
      for (const kn of knots) {
        const da = Math.atan2(Math.sin(a - kn.a), Math.cos(a - kn.a)), dz = z - kn.z;
        knot = Math.max(knot, Math.exp(-((dz * dz) / (kn.size * kn.size * 0.25) + (da * da) / 0.18)));
      }
      rad *= 1 + L.knotRise * knot;
      v.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, z, 0, 0, 0, knot, 0, 0);
    }
  }
  for (let n = 0; n < N - 1; n++) for (let j = 0; j < A; j++) {
    const a = n * A + j, b = n * A + ((j + 1) % A), c = a + A, d = b + A;
    idx.push(a, b, c, b, d, c);
  }
  // End caps: a fan to a middle a little inside the torn rim.
  for (const end of [0, 1]) {
    const ring = end ? (N - 1) * A : 0;
    let mz = 0;
    for (let j = 0; j < A; j++) mz += v[(ring + j) * 9 + 2] / A;
    const [cx, cy] = axisAt(end);
    const mid = v.length / 9;
    v.push(cx, cy, mz + (end ? -1 : 1) * jag * 0.4, 0, 0, 0, 0, 0, 1);
    for (let j = 0; j < A; j++) idx.push(mid, end ? ring + j : ring + ((j + 1) % A), end ? ring + ((j + 1) % A) : ring + j);
  }
  const trunkCount = v.length / 9;
  /** A point on the trunk's axis, and its surface's radius toward angle a, at t. @param {number} t @param {number} a */
  const onTrunk = (t, a) => {
    const [cx, cy] = axisAt(t), z = (t - 0.5) * lenT;
    return { c: [cx, cy, z], rad: radiusAt(t, a, z) };
  };
  /** @type {number[][]} */ const tips = [];
  const S = F.stub;
  // Snapped stubs: where side branches broke off, never straight down into the ground.
  const nStubs = Math.min(S.count[1], S.count[0] + Math.floor(u01(hash32(h, 60)) * (S.count[1] - S.count[0] + 1)) + (P.extraStubs ?? 0));
  for (let k = 0; k < nStubs; k++) {
    const hs = hash32(h, 61, k);
    const t = 0.14 + 0.72 * u01(hash32(hs, 1));
    const a = (-0.3 + 1.6 * u01(hash32(hs, 2))) * Math.PI;
    const { c, rad } = onTrunk(t, a);
    const lean = ((S.leanDeg * Math.PI) / 180) * (0.5 + 0.5 * u01(hash32(hs, 3)));
    const dir = [Math.cos(a) * Math.cos(lean), Math.sin(a) * Math.cos(lean), Math.sin(lean)];
    const rs = (S.radius[0] + (S.radius[1] - S.radius[0]) * u01(hash32(hs, 4))) * rad;
    const from = [c[0] + Math.cos(a) * rad * 0.5, c[1] + Math.sin(a) * rad * 0.5, c[2]];
    tube(v, idx, from, dir, rad * 0.5 + S.length[0] + (S.length[1] - S.length[0]) * u01(hash32(hs, 5)), rs, rs * 0.8, 4, 10, rs * 0.6, hs);
  }
  if (form === 'forked') {
    // The arm that snapped: from the fork, out to one side and on toward the far end, ending short.
    const R = F.forked;
    const t = r(70, R.at), sideA = side > 0 ? Math.PI : 0;
    const { c, rad } = onTrunk(t, sideA);
    const ang = (r(71, R.angleDeg) * Math.PI) / 180;
    const dir = [Math.cos(sideA) * Math.sin(ang), 0.12, Math.cos(ang)];
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    const d = dir.map((x) => x / dl);
    const armLen = r(72, R.armLength) * lenT, ra = rad * R.armRadius;
    tube(v, idx, [c[0], c[1], c[2]], d, armLen, ra, ra * 0.85, 6, 14, ra * 0.9, hash32(h, 73));
    tips.push([c[0] + d[0] * armLen, c[2] + d[2] * armLen]);
  }
  if (form === 'rootend') {
    // Broken roots splayed out of the flared foot, the lower ones running into the ground.
    const R = F.rootend;
    const n = R.roots[0] + Math.floor(u01(hash32(h, 80)) * (R.roots[1] - R.roots[0] + 1));
    for (let k = 0; k < n; k++) {
      const hs = hash32(h, 81, k);
      const a = ((k + 0.2 + 0.6 * u01(hash32(hs, 1))) / n) * TAU;
      const { c, rad } = onTrunk(flareT * 0.35, a);
      const span = (/** @type {number[]} */ g, /** @type {number} */ q) => g[0] + (g[1] - g[0]) * u01(hash32(hs, q));
      const dir = [Math.cos(a), Math.sin(a) * 0.7, -span(R.backShare, 2)];
      const dl = Math.hypot(dir[0], dir[1], dir[2]);
      const d = dir.map((x) => x / dl);
      const rl = rad * 0.6 + span(R.length, 3);
      const rr = span(R.radius, 4) * 0.5;
      const from = [c[0] + Math.cos(a) * rad * 0.4, c[1] + Math.sin(a) * rad * 0.4, c[2]];
      tube(v, idx, from, d, rl, rr, rr * 0.35, 5, 10, rr * 0.8, hs);
      if (d[1] > -0.4) tips.push([from[0] + d[0] * rl, from[2] + d[2] * rl]);
    }
  }
  const count = v.length / 9;
  const V = new Float32Array(v);
  // Exactly 1 long along z (the trunk's own length), base on y = 0 under the trunk; stubs and roots
  // may reach below it, into the ground.
  let ylo = Infinity, yhi = -Infinity, zlo = Infinity, zhi = -Infinity;
  for (let q = 0; q < trunkCount; q++) {
    ylo = Math.min(ylo, V[q * 9 + 1]); yhi = Math.max(yhi, V[q * 9 + 1]);
    zlo = Math.min(zlo, V[q * 9 + 2]); zhi = Math.max(zhi, V[q * 9 + 2]);
  }
  const zc = (zlo + zhi) / 2, zs = zhi - zlo;
  for (let q = 0; q < count; q++) { V[q * 9 + 1] -= ylo; V[q * 9 + 2] = (V[q * 9 + 2] - zc) / zs; }
  // Normals from the faces, in mesh units (the squeeze's inverse transpose, as the draw pass wants).
  const acc = new Float64Array(count * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, d] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [0, 1, 2].map((k) => V[b * 9 + k] - V[a * 9 + k]), e2 = [0, 1, 2].map((k) => V[d * 9 + k] - V[a * 9 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const q of [a, b, d]) for (let k = 0; k < 3; k++) acc[q * 3 + k] += f[k];
  }
  for (let q = 0; q < count; q++) {
    const l = Math.hypot(acc[q * 3], acc[q * 3 + 1], acc[q * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) V[q * 9 + 3 + k] = acc[q * 3 + k] / l;
  }
  // Its tone: long weathered streaks, end grain, knots, and the sand stain underneath.
  const M = L.mottle;
  const ph2 = u01(hash32(h, 9)) * TAU;
  for (let q = 0; q < count; q++) {
    const o = q * 9;
    const knot = V[o + 6], cap = V[o + 8];
    const z = V[o + 2];
    const tone = 1 + M.broad * Math.sin(z * M.broadPerUnit + ph2) * Math.sin(z * 2.3 + ph) + M.fine * Math.sin(z * M.finePerUnit + ph2 * 3);
    const endGrain = q < trunkCount ? Math.max(cap, Math.max(0, Math.abs(V[o + 5]) - 0.55) / 0.45) : cap;
    const under = Math.min(1, Math.max(0, (L.stainLine - V[o + 1]) / L.stainLine) + Math.max(0, -V[o + 4]) * 0.35);
    for (let c = 0; c < 3; c++) {
      let a = L.albedo[c] * tone;
      a += (L.endAlbedo[c] - a) * Math.min(1, endGrain);
      a += (L.knotAlbedo[c] - a) * Math.min(1, knot * 1.3);
      a += (L.underside[c] - a) * under;
      V[o + 6 + c] = a;
    }
  }
  /** @type {number[][]} */ const footprint = [];
  for (let k = 0; k <= 4; k++) { const t = k / 4; footprint.push([axisAt(t)[0], ((t - 0.5) * lenT - zc) / zs]); }
  for (const [x, z] of tips) footprint.push([x, (z - zc) / zs]);
  return { mesh: { vertices: V, count, indices: Uint32Array.from(idx) }, hy: yhi - ylo, form, sea, footprint };
}
