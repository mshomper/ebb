// @ts-check
// Loose stone meshes (docs/future/10): a few stone shapes baked from blended ellipsoids by the
// creature body bake (src/world/creatures/body-bake.js), then cut by a few seeded planes (a flatter
// top, chipped shoulders), so a group reads as stones rather than eggs. Each is 1 mesh unit long
// (the draw pass scales it to the stone's length) with its base on y = 0. For each, the dark damp
// patch it leaves on the ground, seen when the stone is lifted. Seeded from the recipe, so the shapes
// are the same on every load. Vertex albedo is linear and physical (docs/05): weathered grey rock,
// mottled, darker and browner where it lies in the soil; the draw pass adds the island's rock scan.

import { hash32 } from '../../core/rng.js';
import { bakeBody } from '../creatures/body-bake.js';

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */
/** @typedef {{ mesh: Mesh, damp: Mesh, hx: number, hz: number, hy: number }} StoneShape hx, hz: half width and length; hy: height (mesh units) */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * The ellipsoids of one stone shape: a main body and a few smaller lobes blended in, so it is
 * lumpy and a little lopsided rather than an egg.
 * @param {any} S pieces.json shape @param {number} i which shape
 */
export function stonePrims(S, i) {
  const h = hash32(S.seed, i);
  const r = (/** @type {number} */ k, /** @type {number[]} */ range) => range[0] + (range[1] - range[0]) * u01(hash32(h, k));
  const w = r(1, S.widthShare) / 2, t = r(2, S.heightShare) / 2;
  /** @type {any[]} */ const prims = [{ type: 'ellipsoid', c: [0, t, 0], r: [w, t, 0.42], rot: [0, 0, 0], region: 'rock' }];
  // Lobes spread round the body, each a little lower or higher, so the outline is irregular and
  // the top has a slope or a shoulder rather than a dome.
  for (let l = 0; l < S.lobes; l++) {
    const a = ((l + u01(hash32(h, 10, l)) * 0.7) / S.lobes) * Math.PI * 2;
    const k = 0.5 + 0.3 * u01(hash32(h, 11, l));
    prims.push({ type: 'ellipsoid', c: [Math.cos(a) * w * 0.6, t * (0.55 + 0.5 * u01(hash32(h, 12, l))), Math.sin(a) * 0.3],
      r: [w * k, t * (0.55 + 0.35 * k), 0.42 * k], rot: [(u01(hash32(h, 15, l)) - 0.5) * 24, (u01(hash32(h, 13, l)) - 0.5) * 70, (u01(hash32(h, 14, l)) - 0.5) * 24],
      k: S.blendM, region: 'rock' });
  }
  return prims;
}

/**
 * The cutting planes of one shape: a flatter, slightly tilted top, then a few chips off its
 * shoulders. Each is a unit normal and how far along it (as a share of the stone's reach that way)
 * it cuts. @param {any} S pieces.json shape @param {number} i
 * @returns {{ n: number[], share: number }[]}
 */
export function facetPlanes(S, i) {
  const h = hash32(S.seed, i, 0xfa);
  const F = S.facets;
  const unit = (/** @type {number[]} */ v) => { const l = Math.hypot(v[0], v[1], v[2]); return v.map((x) => x / l); };
  const span = (/** @type {number[]} */ r, /** @type {number} */ k) => r[0] + (r[1] - r[0]) * u01(hash32(h, k));
  const out = [{ n: unit([(u01(hash32(h, 1)) - 0.5) * F.topTilt, 1, (u01(hash32(h, 2)) - 0.5) * F.topTilt]), share: span(F.topShare, 3) }];
  for (let c = 0; c < F.chips; c++) {
    const a = ((c + u01(hash32(h, 10, c)) * 0.8) / F.chips) * Math.PI * 2;
    out.push({ n: unit([Math.cos(a), span(F.chipUp, 11 + 7 * c), Math.sin(a)]), share: span(F.chipShare, 12 + 7 * c) });
  }
  return out;
}

/**
 * Cut a mesh by planes (each pushes the vertices past it back onto it, so the surface turns flat
 * there with a crisp edge), then give it fresh normals from its faces. Changes the mesh in place.
 * @param {Mesh} m 9 floats a vertex @param {{ n: number[], share: number }[]} planes @param {number[]} c the middle they are measured from
 */
export function facet(m, planes, c) {
  const V = m.vertices;
  // The original normals say which way each face looks out.
  const before = V.slice();
  for (const { n, share } of planes) {
    let reach = 0;
    for (let v = 0; v < m.count; v++) reach = Math.max(reach, (V[v * 9] - c[0]) * n[0] + (V[v * 9 + 1] - c[1]) * n[1] + (V[v * 9 + 2] - c[2]) * n[2]);
    const d = reach * share;
    for (let v = 0; v < m.count; v++) {
      const o = v * 9;
      const s = (V[o] - c[0]) * n[0] + (V[o + 1] - c[1]) * n[1] + (V[o + 2] - c[2]) * n[2] - d;
      if (s > 0) { V[o] -= s * n[0]; V[o + 1] -= s * n[1]; V[o + 2] -= s * n[2]; }
    }
  }
  const acc = new Float64Array(m.count * 3);
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t], b = m.indices[t + 1], d = m.indices[t + 2];
    const e1 = [0, 1, 2].map((k) => V[b * 9 + k] - V[a * 9 + k]), e2 = [0, 1, 2].map((k) => V[d * 9 + k] - V[a * 9 + k]);
    let f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const was = [0, 1, 2].map((k) => before[a * 9 + 3 + k] + before[b * 9 + 3 + k] + before[d * 9 + 3 + k]);
    if (f[0] * was[0] + f[1] * was[1] + f[2] * was[2] < 0) f = f.map((x) => -x);
    for (const q of [a, b, d]) for (let k = 0; k < 3; k++) acc[q * 3 + k] += f[k];
  }
  for (let v = 0; v < m.count; v++) {
    const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]);
    if (l > 1e-12) for (let k = 0; k < 3; k++) V[v * 9 + 3 + k] = acc[v * 3 + k] / l;
  }
}

/** A soft 0..1 field from a few seeded waves (mottling only: render, not simulation). @param {number[]} p @param {number} ph */
const waves = (p, ph) => 0.5 + 0.5 * Math.sin(p[0] * 1.7 + ph) * Math.sin(p[1] * 2.3 + ph * 1.3) * Math.sin(p[2] * 1.9 + ph * 0.7);

/**
 * Bake one stone: blended ellipsoids, cut by its facets, scaled to 1 long and set on y = 0; its tone
 * mottled at two scales and darkening toward the underside that lies in the damp soil.
 * @param {any} S pieces.json shape @param {number} i @param {number} sink share of the height set into the ground
 * @returns {{ mesh: Mesh, hx: number, hz: number, hy: number }}
 */
export function bakeStone(S, i, sink) {
  const baked = bakeBody({ prims: stonePrims(S, i), albedo: { rock: S.albedo, back: S.albedo } }, S.cellM);
  const mesh = { vertices: baked.vertices, count: baked.count, indices: baked.indices };
  const V = mesh.vertices;
  const bounds = () => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < mesh.count; v++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[v * 9 + a]); hi[a] = Math.max(hi[a], V[v * 9 + a]); }
    return { lo, hi };
  };
  const b0 = bounds();
  facet(mesh, facetPlanes(S, i), [0, (b0.lo[1] + b0.hi[1]) / 2, 0]);
  const { lo, hi } = bounds();
  const len = hi[2] - lo[2], cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  const hy = (hi[1] - lo[1]) / len;
  const ph = u01(hash32(S.seed, i, 7)) * 6.28, ph2 = u01(hash32(S.seed, i, 8)) * 6.28;
  const M = S.mottle;
  const line = hy * sink;
  for (let v = 0; v < mesh.count; v++) {
    const o = v * 9;
    V[o] = (V[o] - cx) / len; V[o + 1] = (V[o + 1] - lo[1]) / len; V[o + 2] = (V[o + 2] - cz) / len;
    const p = [V[o], V[o + 1], V[o + 2]];
    // Mottling: broad weathered patches and a finer grain, a touch warmer or cooler here and there.
    const broad = waves(p.map((x) => x * M.broadPerUnit), ph), fine = waves(p.map((x) => x * M.finePerUnit), ph2);
    const tone = 1 + M.broad * (broad - 0.5) * 2 + M.fine * (fine - 0.5) * 2;
    const warm = M.hue * (broad - 0.5) * 2;
    const hue = [1 + warm, 1, 1 - warm];
    // Below the ground line, and on faces turned down, the stone is soil-stained and damp.
    const under = Math.min(1, Math.max(0, (line * 1.4 - p[1]) / Math.max(line, 1e-3)) + Math.max(0, -V[o + 4]) * 0.6);
    for (let c = 0; c < 3; c++) V[o + 6 + c] = (S.albedo[c] * hue[c] * (1 - under) + S.underside[c] * under) * tone;
  }
  return { mesh, hx: (hi[0] - lo[0]) / len / 2, hz: 0.5, hy };
}

/**
 * The damp patch under a stone: a flat oval of dark wet earth, its rim fading toward the soil's
 * tone, facing up, on y = 0. @param {number} hx @param {number} hz half width and length
 * @param {any} D pieces.json damp @returns {Mesh}
 */
export function dampPatch(hx, hz, D) {
  const seg = 28, v = [], idx = [];
  const put = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number[]} */ c) => { v.push(x, 0, z, 0, 1, 0, c[0], c[1], c[2]); return v.length / 9 - 1; };
  const mid = put(0, 0, D.albedo);
  /** @type {number[]} */ const inner = [], outer = [];
  for (let j = 0; j < seg; j++) {
    const a = (j / seg) * Math.PI * 2, wob = 1 + 0.06 * Math.sin(a * 3 + 1.1);
    inner.push(put(Math.cos(a) * hx * D.scale * 0.72 * wob, Math.sin(a) * hz * D.scale * 0.72 * wob, D.albedo));
    outer.push(put(Math.cos(a) * hx * D.scale * wob, Math.sin(a) * hz * D.scale * wob, D.edgeAlbedo));
  }
  for (let j = 0; j < seg; j++) {
    const n = (j + 1) % seg;
    idx.push(mid, inner[n], inner[j], inner[j], inner[n], outer[j], outer[j], inner[n], outer[n]);
  }
  return { vertices: new Float32Array(v), count: v.length / 9, indices: Uint32Array.from(idx) };
}

/**
 * One driftwood log (docs/future/10): a round trunk 1 long along z and 1 thick, built ring by ring
 * so it can bow, taper, swell and carry knots, with broken, splintered ends. Its base is on y = 0;
 * the draw pass squeezes it across to the log's own thickness (model.js logBone). Vertex albedo is
 * linear and physical (docs/05): sea-weathered silver-grey wood, a little warmer and darker on the
 * end grain, darker round each knot, and sand-stained along its underside; the draw pass adds the
 * grain and checking cracks (piece-draw.wgsl).
 * @param {any} L pieces.json driftwood.shape @param {number} i which shape
 * @returns {{ mesh: Mesh, hy: number }}
 */
export function bakeLog(L, i) {
  const h = hash32(L.seed, i, 0x10c);
  const r = (/** @type {number} */ k, /** @type {number[]} */ range) => range[0] + (range[1] - range[0]) * u01(hash32(h, k));
  const A = L.around, N = L.rings;
  const bow = r(1, L.bow) * (u01(hash32(h, 2)) < 0.5 ? -1 : 1), bowUp = r(3, L.bow) * 0.3;
  const taper = r(4, L.taper), ph = u01(hash32(h, 5)) * 6.28;
  const knots = Array.from({ length: L.knots[0] + Math.floor(u01(hash32(h, 6)) * (L.knots[1] - L.knots[0] + 1)) }, (_, k) => ({
    z: -0.35 + 0.7 * u01(hash32(h, 20, k)), a: u01(hash32(h, 21, k)) * Math.PI * 2, size: r(22 + k * 3, L.knotSize) }));
  // Broken ends: each end ring torn back by a seeded, splintered amount round the rim.
  const torn = (/** @type {number} */ end, /** @type {number} */ j) => {
    const a = (j / A) * Math.PI * 2;
    const spike = u01(hash32(h, 40 + end, j)) ** 3;
    return L.jag * (0.35 + 0.35 * Math.sin(a * 2 + ph * (end + 1)) + spike);
  };
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  /** @type {number[][]} */ const axis = [];
  for (let n = 0; n < N; n++) {
    const t = n / (N - 1), z0 = t - 0.5;
    const cx = bow * Math.sin(Math.PI * t), cy = 0.5 + bowUp * Math.sin(Math.PI * t);
    axis.push([cx, cy]);
    for (let j = 0; j < A; j++) {
      const a = (j / A) * Math.PI * 2;
      // The ends: torn back, and a little narrower where the wood split.
      const end = n === 0 ? torn(0, j) : n === N - 1 ? -torn(1, j) : 0;
      const z = z0 + end;
      let rad = 0.5 * (1 - taper * t) * (1 + L.swell * Math.sin(a * 3 + ph + z * 9) * Math.sin(z * 7 + ph));
      if (n === 0 || n === N - 1) rad *= 0.92;
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
    idx.push(a, c, b, b, c, d);
  }
  // End caps: a fan to a middle a little inside the torn rim.
  for (const end of [0, 1]) {
    const ring = end ? (N - 1) * A : 0;
    let mz = 0;
    for (let j = 0; j < A; j++) mz += v[(ring + j) * 9 + 2] / A;
    const [cx, cy] = axis[end ? N - 1 : 0];
    const mid = v.length / 9;
    v.push(cx, cy, mz + (end ? -1 : 1) * L.jag * 0.4, 0, 0, 0, 0, 0, 1);
    for (let j = 0; j < A; j++) idx.push(mid, ring + j, ring + ((j + 1) % A));
  }
  const count = v.length / 9;
  const V = new Float32Array(v);
  // Normals from the faces, each turned to face away from the log's axis.
  const acc = new Float64Array(count * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, d] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [0, 1, 2].map((k) => V[b * 9 + k] - V[a * 9 + k]), e2 = [0, 1, 2].map((k) => V[d * 9 + k] - V[a * 9 + k]);
    let f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [0, 1, 2].map((k) => (V[a * 9 + k] + V[b * 9 + k] + V[d * 9 + k]) / 3);
    const n0 = Math.min(N - 1, Math.max(0, Math.round((m[2] + 0.5) * (N - 1))));
    const out = [m[0] - axis[n0][0], m[1] - axis[n0][1], m[2]];
    if (f[0] * out[0] + f[1] * out[1] + f[2] * out[2] < 0) f = f.map((x) => -x);
    for (const q of [a, b, d]) for (let k = 0; k < 3; k++) acc[q * 3 + k] += f[k];
  }
  let ylo = Infinity, yhi = -Infinity, zlo = Infinity, zhi = -Infinity;
  for (let q = 0; q < count; q++) {
    const l = Math.hypot(acc[q * 3], acc[q * 3 + 1], acc[q * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) V[q * 9 + 3 + k] = acc[q * 3 + k] / l;
    ylo = Math.min(ylo, V[q * 9 + 1]); yhi = Math.max(yhi, V[q * 9 + 1]);
    zlo = Math.min(zlo, V[q * 9 + 2]); zhi = Math.max(zhi, V[q * 9 + 2]);
  }
  // Exactly 1 long, its base on y = 0; then its tone.
  const len = zhi - zlo, zc = (zlo + zhi) / 2;
  const M = L.mottle;
  const ph2 = u01(hash32(h, 9)) * 6.28;
  for (let q = 0; q < count; q++) {
    const o = q * 9;
    V[o + 1] -= ylo; V[o + 2] = (V[o + 2] - zc) / len;
    const knot = V[o + 6], cap = V[o + 8];
    const z = V[o + 2];
    // Long weathered streaks and broad patches along its length.
    const tone = 1 + M.broad * Math.sin(z * M.broadPerUnit + ph2) * Math.sin(z * 2.3 + ph) + M.fine * Math.sin(z * M.finePerUnit + ph2 * 3);
    // End grain: where the face looks along the length, or on the cap.
    const endGrain = Math.max(cap, Math.max(0, Math.abs(V[o + 5]) - 0.55) / 0.45);
    const under = Math.min(1, Math.max(0, (L.stainLine - V[o + 1]) / L.stainLine) + Math.max(0, -V[o + 4]) * 0.35);
    for (let c = 0; c < 3; c++) {
      let a = L.albedo[c] * tone;
      a += (L.endAlbedo[c] - a) * Math.min(1, endGrain);
      a += (L.knotAlbedo[c] - a) * Math.min(1, knot * 1.3);
      a += (L.underside[c] - a) * under;
      V[o + 6 + c] = a;
    }
  }
  return { mesh: { vertices: V, count, indices: Uint32Array.from(idx) }, hy: yhi - ylo };
}

/**
 * Every log shape, with the damp patch a log leaves (round here: the draw pass squeezes it across
 * like the log). @param {any} recipe pieces.json
 * @returns {{ mesh: Mesh, damp: Mesh, hy: number }[]}
 */
export function logShapes(recipe) {
  const D = recipe.driftwood;
  const damp = dampPatch(0.5, 0.5, { ...recipe.damp, ...D.damp });
  return Array.from({ length: D.shape.count }, (_, i) => ({ ...bakeLog(D.shape, i), damp }));
}

/**
 * Every stone shape with its damp patch. @param {any} recipe pieces.json
 * @returns {StoneShape[]}
 */
export function stoneShapes(recipe) {
  /** @type {StoneShape[]} */ const out = [];
  for (let i = 0; i < recipe.shape.count; i++) {
    const s = bakeStone(recipe.shape, i, recipe.sink);
    out.push({ ...s, damp: dampPatch(s.hx, s.hz, recipe.damp) });
  }
  return out;
}
