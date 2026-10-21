// @ts-check
// Fungus meshes for autumn's fungi on logs (autumn.js), built from a few numbers in
// autumn-finds.json (fungi.shape) in the creature pass's vertex layout (position, normal, linear
// albedo: 9 floats), in meters at real size. Each keeps its root at the origin, where it meets the
// wood: a bracket reaches out along +z from a root line along x, a cap stands up +y from its stem's
// foot. Seeded through hash32 from the recipe's own seed, so a mesh is the same on every load.
//
// Turkey tail: a thin, wavy-rimmed shelf, thick at the root and thin at the rim, drooping a little
// and lifting at the lip, banded on top in concentric zones of brown, tan, grey and cream, with pale
// pores beneath. Sulphur tuft: a small domed cap, sulphur yellow with a tawny middle, olive gills
// beneath, on a slim pale stem that leans out from the tuft by the mesh's lean.

import { hash32 } from '../../core/rng.js';
import { builder, lathe } from './procedural.js';

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number} x */
const smooth01 = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

/**
 * One turkey tail bracket. @param {any} B fungi.shape.bracket @param {number} seed fungi.shape.seed
 * @param {number} variant @returns {Mesh}
 */
export function bracketMesh(B, seed, variant) {
  const m = builder({ keepY: true });
  const h = hash32(seed, 0xb7a, variant);
  const NR = 12, NP = 19;
  const ph = u01(hash32(h, 1)) * 6.283, ph2 = u01(hash32(h, 2)) * 6.283;
  const R = B.radiusM * (0.9 + 0.2 * u01(hash32(h, 3)));
  const [waves, waveShare] = B.wave;
  const zones = B.zoneAlbedos;
  /** The rim's reach at an angle (0 straight out), waved. @param {number} f */
  const rim = (f) => 1 + waveShare * Math.sin(waves * f + ph) + waveShare * 0.5 * Math.sin(waves * 2.3 * f + ph2);
  /** The top's height at a share s of the way out. @param {number} s */
  const top = (s) => B.thickM * 0.5 * (1 - s) + B.lipM * smooth01((s - 0.75) / 0.25) - B.droopM * s * s;
  /** Its thickness there. @param {number} s */
  const thick = (s) => B.thickM * (1 - 0.85 * s);
  /** A point at share s out, angle f. @param {number} s @param {number} f @param {number} y */
  const at = (s, f, y) => { const r = rim(f); return [R * Math.sin(f) * r * s, y, R * B.depthShare * Math.cos(f) * r * s]; };
  /** The zone colour at s, f: concentric bands, their edges wandering a little. @param {number} s @param {number} f */
  const zone = (s, f) => zones[Math.max(0, Math.min(zones.length - 1, Math.floor(s * zones.length + 0.35 * Math.sin(f * 4 + ph) - 0.1)))];
  /** @type {number[][]} */ const tops = [], bots = [];
  for (let i = 0; i <= NR; i++) {
    const s = i / NR;
    // The slope of the top, outward, for its normal.
    const ds = 1e-3, slope = (top(Math.min(1, s + ds)) - top(Math.max(0, s - ds))) / (2 * ds * R);
    /** @type {number[]} */ const tr = [], br = [];
    for (let j = 0; j < NP; j++) {
      const f = -Math.PI / 2 + (j / (NP - 1)) * Math.PI;
      const out = [Math.sin(f), 0, Math.cos(f) * B.depthShare];
      const n = [-slope * out[0], 1, -slope * out[2]];
      tr.push(m.vert(at(s, f, top(s)), n, zone(s, f)));
      br.push(m.vert(at(s, f, top(s) - thick(s)), [n[0] * 0.3, -1, n[2] * 0.3], B.poreAlbedo));
    }
    tops.push(tr); bots.push(br);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NP - 1; j++) {
    const a = tops[i][j], b = tops[i][j + 1], c = tops[i + 1][j], d = tops[i + 1][j + 1];
    m.tri(a, c, b); m.tri(b, c, d);
    const e = bots[i][j], g = bots[i][j + 1], k = bots[i + 1][j], l = bots[i + 1][j + 1];
    m.tri(e, g, k); m.tri(g, l, k);
  }
  // The rim: a thin strip between the top's edge and the pores', facing out, in the pale outer zone.
  /** @type {number[]} */ const rt = [], rb = [];
  for (let j = 0; j < NP; j++) {
    const f = -Math.PI / 2 + (j / (NP - 1)) * Math.PI;
    const n = [Math.sin(f), 0, Math.cos(f)];
    rt.push(m.vert(at(1, f, top(1)), n, zones[zones.length - 1]));
    rb.push(m.vert(at(1, f, top(1) - thick(1)), n, zones[zones.length - 1]));
  }
  for (let j = 0; j < NP - 1; j++) { m.tri(rt[j], rb[j], rt[j + 1]); m.tri(rt[j + 1], rb[j], rb[j + 1]); }
  return m.done();
}

/**
 * One sulphur tuft: a stem and a domed cap, the stem curving out by leanDeg toward +z.
 * @param {any} C fungi.shape.cap @param {number} leanDeg @returns {Mesh}
 */
export function capMesh(C, leanDeg) {
  const m = builder({ keepY: true });
  const S = C.stemM, sr = C.stemRadiusM, cr = C.capRadiusM, ch = C.capHeightM;
  // Outside and upward: the stem from just inside the wood, the gills out under the cap, the cap's
  // rim, its dome and its tawny middle.
  /** @type {[number, number, number][]} */
  const prof = [
    [sr * 1.25, -0.003, 0], [sr * 1.15, 0, 0], [sr, S * 0.5, 0], [sr * 0.85, S, 0],
    [sr * 0.85, S + ch * 0.02, 1], [cr * 0.6, S + ch * 0.1, 1], [cr * 0.96, S + ch * 0.18, 1],
    [cr, S + ch * 0.26, 2], [cr * 0.88, S + ch * 0.62, 2], [cr * 0.55, S + ch * 0.9, 3], [cr * 0.22, S + ch * 0.99, 3], [0, S + ch, 3],
  ];
  lathe(m, prof, [C.stemAlbedo, C.gillAlbedo, C.capAlbedo, C.centerAlbedo], 0, 0, 14);
  const mesh = m.done();
  // The lean: the stem curves out along +z, more toward its top, and the cap rides on it.
  const k = Math.tan((leanDeg * Math.PI) / 180), V = mesh.vertices;
  for (let i = 0; i < mesh.count; i++) {
    const y = V[i * 9 + 1], t = Math.max(0, Math.min(1, y / S));
    V[i * 9 + 2] += k * y * (0.4 + 0.6 * t);
    // Tip the normals with it, roughly.
    V[i * 9 + 5] -= k * V[i * 9 + 4] * 0.6;
    const l = Math.hypot(V[i * 9 + 3], V[i * 9 + 4], V[i * 9 + 5]) || 1;
    for (let c = 3; c < 6; c++) V[i * 9 + c] /= l;
  }
  return mesh;
}

/**
 * Every fungus mesh by name (bracket-<n>, cap-<n>), for the fungi pass. @param {any} F autumn-finds.json fungi
 * @returns {Record<string, Mesh>}
 */
export function fungusMeshes(F) {
  /** @type {Record<string, Mesh>} */ const out = {};
  const S = F.shape;
  for (let v = 0; v < S.bracket.variants; v++) out[`bracket-${v}`] = bracketMesh(S.bracket, S.seed, v);
  S.cap.leanDeg.forEach((/** @type {number} */ d, /** @type {number} */ i) => { out[`cap-${i}`] = capMesh(S.cap, d); });
  return out;
}
