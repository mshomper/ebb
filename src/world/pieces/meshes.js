// @ts-check
// Loose stone meshes (docs/future/10): a few rounded stone shapes baked from blended ellipsoids by
// the creature body bake (src/world/creatures/body-bake.js), each 1 mesh unit long (the draw pass
// scales it to the stone's length), its base on y = 0; and for each, the dark damp patch it leaves
// on the ground, seen when the stone is lifted. Seeded from the recipe, so the shapes are the same on
// every load. Albedo is linear and physical (docs/05): dry grey-brown rock, darker and browner where
// it has lain in the soil.

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
 * Bake one stone: the mesh scaled to 1 long and set on y = 0, its tone wandering a little over its
 * face (speckle) and darkening toward the underside that lies in the damp soil.
 * @param {any} S pieces.json shape @param {number} i @param {number} sink share of the height set into the ground
 * @returns {{ mesh: Mesh, hx: number, hz: number, hy: number }}
 */
export function bakeStone(S, i, sink) {
  const baked = bakeBody({ prims: stonePrims(S, i), albedo: { rock: S.albedo, back: S.albedo } }, S.cellM);
  const V = baked.vertices;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < baked.count; v++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], V[v * 9 + a]); hi[a] = Math.max(hi[a], V[v * 9 + a]); }
  const len = hi[2] - lo[2], cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  const hy = (hi[1] - lo[1]) / len;
  const seed = hash32(S.seed, i, 7);
  for (let v = 0; v < baked.count; v++) {
    const o = v * 9;
    V[o] = (V[o] - cx) / len; V[o + 1] = (V[o + 1] - lo[1]) / len; V[o + 2] = (V[o + 2] - cz) / len;
    const [x, y, z] = [V[o], V[o + 1], V[o + 2]];
    // A soft tonal wander over the face, from a few seeded waves.
    const ph = u01(seed) * 6.28;
    const n = Math.sin(x * 17 + ph) * Math.sin(y * 23 + ph * 1.3) * Math.sin(z * 19 + ph * 0.7);
    const tone = 1 + S.speckle * n;
    // Below the ground line, and on faces turned down, the stone is soil-stained and damp.
    const line = hy * sink;
    const under = Math.min(1, Math.max(0, (line * 1.4 - y) / Math.max(line, 1e-3)) + Math.max(0, -V[o + 4]) * 0.6);
    for (let c = 0; c < 3; c++) V[o + 6 + c] = (S.albedo[c] * (1 - under) + S.underside[c] * under) * tone;
  }
  return { mesh: { vertices: V, count: baked.count, indices: baked.indices }, hx: (hi[0] - lo[0]) / len / 2, hz: 0.5, hy };
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
