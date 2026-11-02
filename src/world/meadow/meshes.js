// @ts-check
// Drawing the meadow islet's stories (F20): the marker stone, a tall leaning stone crusted with
// lichen and a V notch cut down into its top; the stooks of cut rye, sheaves leaned together; and
// the patch of noon light the notch throws at midsummer. Meshes in meters (9 floats a vertex:
// position, normal, linear albedo), base on y = 0, for the pieces pass. Drawing only: plain Math is
// fine here, and every wobble comes from a seeded hash so each island's stone is its own.

import { hash32 } from '../../core/rng.js';
import { dampPatch } from '../pieces/meshes.js';

/** @typedef {import('../finds/procedural.js').Mesh} Mesh */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** Smooth normals from the faces. @param {number[]} v @param {number[]} idx */
function normals(v, idx) {
  const n = v.length / 9, acc = new Float64Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [0, 1, 2].map((k) => v[b * 9 + k] - v[a * 9 + k]), e2 = [0, 1, 2].map((k) => v[c * 9 + k] - v[a * 9 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const q of [a, b, c]) for (let k = 0; k < 3; k++) acc[q * 3 + k] += f[k];
  }
  for (let q = 0; q < n; q++) {
    const l = Math.hypot(acc[q * 3], acc[q * 3 + 1], acc[q * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) v[q * 9 + 3 + k] = acc[q * 3 + k] / l;
  }
}

/** @param {number[]} v @param {number[]} idx @returns {Mesh} */
const done = (v, idx) => { normals(v, idx); return { vertices: new Float32Array(v), count: v.length / 9, indices: Uint32Array.from(idx) }; };

/**
 * The marker stone: an elliptical pillar, narrower at the top, wobbled, its top cut by a V notch
 * across its thickness (seen from its broad faces), its skin blotched with grey-green and yellow
 * lichen. @param {any} S meadow-islet.json stone @param {number} seed
 * @returns {{ mesh: Mesh, notchY: number }} notchY: the notch's floor above the base (m)
 */
export function markerStoneMesh(S, seed) {
  const L = S.look, H = S.heightM, N = S.notch;
  const ph = [0, 1, 2, 3, 4, 5].map((k) => u01(hash32(seed, 0x57, k)) * 6.283);
  const wob = (/** @type {number} */ a, /** @type {number} */ y) => 1 + L.wobbleM * (Math.sin(a * 2 + ph[0] + y * 1.3) + 0.6 * Math.sin(a * 3 + ph[1] - y * 2.1) + 0.4 * Math.sin(a * 5 + ph[2] + y * 3.7)) / Math.max(0.2, S.thickM);
  // Even rings up the stone, then closer ones near the top so the notch cuts cleanly.
  const ys = [];
  for (let j = 0; j < L.rings; j++) ys.push((j / L.rings) * (H - N.depthM * 1.6));
  ys.push(H - N.depthM * 1.6, H - N.depthM, H - N.depthM * 0.5, H - N.depthM * 0.2, H);
  const sides = L.sides, v = /** @type {number[]} */ ([]), idx = /** @type {number[]} */ ([]);
  const blotch = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ k) => {
    const f = L.blotchPerM;
    return 0.5 + 0.5 * Math.sin(x * f + ph[3 + k]) * Math.sin(y * f * 0.8 + ph[4]) * Math.sin(z * f * 1.1 + ph[5] + k);
  };
  /** The notch: the highest a point may stand at its x. @param {number} x */
  const roof = (x) => H - N.depthM * Math.max(0, 1 - Math.abs(x) / N.halfWidthM);
  const put = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    y = Math.min(y, roof(x));
    // Lichen in blotches, more on the upper faces; darker and plain where it stands in the soil.
    const g = blotch(x, y, z, 0), w = blotch(x, y, z, 1.7);
    let c = [...L.albedo].map((q, i) => q * (0.92 + 0.16 * u01(hash32(seed, v.length, i))));
    if (g > 1 - L.shareGrey) c = c.map((q, i) => q + (L.lichenGrey[i] - q) * Math.min(1, (g - 1 + L.shareGrey) * 6));
    if (w > 1 - L.shareYellow && y > 0.4) c = c.map((q, i) => q + (L.lichenYellow[i] - q) * Math.min(1, (w - 1 + L.shareYellow) * 6));
    if (y < S.sinkM + 0.05) c = c.map((q) => q * 0.7);
    v.push(x, y, z, 0, 1, 0, c[0], c[1], c[2]);
    return v.length / 9 - 1;
  };
  for (const y of ys) {
    const f = y / H, rx = (S.widthM / 2) * (1 - S.taper * f), rz = (S.thickM / 2) * (1 - S.taper * f);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, w = wob(a, y);
      put(Math.cos(a) * rx * w, y, Math.sin(a) * rz * w);
    }
  }
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let k = 0; k < sides; k++) {
      const a = j * sides + k, b = j * sides + (k + 1) % sides, c = a + sides, d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
  }
  // The cap: a fan from the notch floor at its middle to the top ring.
  const top = (ys.length - 1) * sides, mid = put(0, H, 0);
  for (let k = 0; k < sides; k++) idx.push(top + k, mid, top + (k + 1) % sides);
  // And the base, closed (it is underground, but the shadow pass sees it).
  const bot = put(0, 0, 0);
  for (let k = 0; k < sides; k++) idx.push((k + 1) % sides, bot, k);
  return { mesh: done(v, idx), notchY: H - N.depthM };
}

/**
 * A stook: sheaves of rye leaned together into a cone, their heads up and out, a band of darker
 * stalk where they were bound. @param {any} K meadow-islet.json rye.stooks.look @param {number} seed
 * @returns {Mesh}
 */
export function stookMesh(K, seed) {
  const v = /** @type {number[]} */ ([]), idx = /** @type {number[]} */ ([]);
  const put = (/** @type {number[]} */ p, /** @type {number[]} */ c) => { v.push(p[0], p[1], p[2], 0, 1, 0, c[0], c[1], c[2]); return v.length / 9 - 1; };
  for (let i = 0; i < K.sheaves; i++) {
    const r = (/** @type {number} */ k) => u01(hash32(seed, i, k));
    const a = ((i + 0.3 * r(1)) / K.sheaves) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const foot = K.spreadM * (0.85 + 0.3 * r(2)), H = K.heightM * (0.9 + 0.2 * r(3));
    // Four corners of the sheaf's section at its foot, its waist (the band) and its head.
    const rings = [[foot, 0, 0.07], [foot * 0.35, H * 0.62, 0.045], [foot * 0.2, H * 0.82, 0.05], [foot * 0.42, H, 0.075]];
    const base = v.length / 9;
    rings.forEach(([d, y, w], j) => {
      const tone = j === 1 ? K.band : K.albedo.map((q, c) => q * (0.9 + 0.2 * r(10 + c)) * (j === 3 ? 1.15 : 1));
      for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put([ca * (d + t * w) - sa * s * w, y, sa * (d + t * w) + ca * s * w], tone);
    });
    for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) {
      const p = base + j * 4 + k, q = base + j * 4 + (k + 1) % 4;
      idx.push(p, q, p + 4, q, q + 4, p + 4);
    }
    idx.push(base + 12, base + 13, base + 14, base + 12, base + 14, base + 15);
  }
  return done(v, idx);
}

/** The noon light's patch on the ground: a pale oval, softening at its rim. @param {any} M stone.midsummer.mark @returns {Mesh} */
export const lightMarkMesh = (M) => dampPatch(M.radiusM, M.radiusM, { albedo: M.albedo, edgeAlbedo: M.edgeAlbedo, scale: 1 });
