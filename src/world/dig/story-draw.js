// @ts-check
// Drawing the island's past (docs/future/13 10.6.4, 10.7.7): the marked stone over the keeper's
// cache, a flat stone baked as the loose stones are (pieces/meshes.js bakeStone) at a finer grain,
// with a sign scratched pale into its top (a line down to a short bar under a chevron: dig here);
// the few sunken, fire-cracked stones of an old hearth's broken ring (the loose stones' own meshes,
// set half into the ground); and the keeper's blade fitted to the shovel, an iron shoe over the
// wooden blade's lower edge, made in the shovel model's own frame (dig.json blade.profile). Drawing
// only: plain Math is fine here.

import { hash32 } from '../../core/rng.js';
import { bakeStone } from '../pieces/meshes.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** The sign's strokes on the stone's top, in its unit frame (x across, z along, the stone 1 long). */
const SIGN = [[[0, -0.26], [0, 0.2]], [[-0.13, 0.08], [0, 0.22]], [[0.13, 0.08], [0, 0.22]], [[-0.1, -0.28], [0.1, -0.28]]];

/** Distance from a point to a segment. @param {number} x @param {number} z @param {number[][]} s */
function segDist(x, z, s) {
  const [a, b] = s, dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/**
 * The marked stone: flat-topped, its sign scratched paler into the top. @param {any} P pieces.json
 * @param {any} R dig.json story @returns {{ mesh: import('../finds/procedural.js').Mesh, hx: number, hz: number, hy: number }}
 */
export function markedStone(P, R) {
  const T = R.stone;
  const S = { ...P.shape, seed: T.seed, cellM: T.cellM / T.sizeM, heightShare: [0.3, 0.34], widthShare: [0.75, 0.8], albedo: T.albedo,
    facets: { ...P.shape.facets, topTilt: 0.05, topShare: [0.55, 0.6] } };
  const s = bakeStone(S, 0, P.sink);
  const V = s.mesh.vertices, w = T.lineM / T.sizeM;
  let top = 0;
  for (let v = 0; v < s.mesh.count; v++) top = Math.max(top, V[v * 9 + 1]);
  for (let v = 0; v < s.mesh.count; v++) {
    const o = v * 9;
    if (V[o + 4] < 0.7 || V[o + 1] < top * 0.8) continue;
    const d = Math.min(...SIGN.map((g) => segDist(V[o], V[o + 2], g)));
    if (d < w) {
      // Scratched through the weathered skin to the paler stone beneath, a little rough.
      const k = (1 - d / w) * (0.8 + 0.2 * u01(hash32(T.seed, v)));
      for (let c = 0; c < 3; c++) V[o + 6 + c] *= 1 + (T.scratch - 1) * k;
    }
  }
  return s;
}

/**
 * The old hearth's ring as pieces-pass beings: a few small stones round its middle, sunk deep, with
 * gaps where the ring is broken. @param {{ x: number, z: number }[]} hearths
 * @param {(x: number, z: number) => number} ground @param {any} R dig.json story @param {number} shapes the loose stones' mesh count
 * @returns {import('../../render/passes/pieces.js').PieceBeing[]}
 */
export function ringBeings(hearths, ground, R, shapes) {
  const G = R.ring, out = [];
  for (const [hi, h] of hearths.entries()) {
    for (let i = 0; i < G.count; i++) {
      const r = (/** @type {number} */ k) => u01(hash32(G.seed, hi, i, k));
      if (r(9) < 0.2) continue;
      const a = ((i + r(1) * 0.5) / G.count) * Math.PI * 2, d = G.ringM * (0.85 + 0.3 * r(2));
      const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d, size = G.sizeM * (0.7 + 0.6 * r(3));
      const sink = G.sinkShare * 0.4;
      const bone = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -sink, 0, 1]);
      out.push({ x, y: ground(x, z), z, yaw: r(4) * Math.PI * 2, size, mesh: `stone-${Math.floor(r(5) * shapes) % shapes}`, bone,
        slope: [0, 0], seed: r(6) * 10, half: [0.35, 0.5] });
    }
  }
  return out;
}

/**
 * The keeper's blade on the shovel: an iron shoe round the wooden blade's lower edge, in the shovel
 * model's frame (y up the shaft from the tip, z out of its face), as the props pass's made meshes
 * take it: 8 floats a vertex (position, normal, uv). @param {any} B dig.json blade
 * @returns {{ data: Float32Array, indices: Uint32Array }}
 */
export function bladeMesh(B) {
  const rows = B.profile.map((/** @type {number[]} */ [y, hw, z0, z1]) => {
    const w = hw + B.padM, a = z0 - B.padM, b = z1 + B.padM, c = Math.min(0.012, (b - a) / 2);
    // Round the section: an octagon, its corners cut by c.
    return [[-w, a + c], [-w + c, a], [w - c, a], [w, a + c], [w, b - c], [w - c, b], [-w + c, b], [-w, b - c]].map(([x, z]) => [x, y, z]);
  });
  /** @type {number[]} */ const data = [];
  /** @type {number[]} */ const idx = [];
  const mid = (/** @type {number[][]} */ r) => r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length, s[2] + p[2] / r.length], [0, 0, 0]);
  const vert = (/** @type {number[]} */ p, /** @type {number[]} */ n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; data.push(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, 0, 0); return data.length / 8 - 1; };
  const k = rows[0].length;
  const ids = rows.map((r) => { const m = mid(r); return r.map((p) => vert(p, [p[0] - m[0], 0, p[2] - m[2]])); });
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < k; j++) {
      const a = ids[i][j], b = ids[i][(j + 1) % k], c = ids[i + 1][j], d = ids[i + 1][(j + 1) % k];
      // Faces out: (c - a) x (b - a) along the outward normal, the lathe's winding.
      idx.push(a, c, b, b, c, d);
    }
  }
  // The edge's underside, closed: a fan under the lowest row.
  const lo = rows[0], m0 = mid(lo), centre = vert(m0, [0, -1, 0]);
  const under = lo.map((p) => vert(p, [0, -1, 0]));
  for (let j = 0; j < k; j++) idx.push(centre, under[j], under[(j + 1) % k]);
  return { data: new Float32Array(data), indices: Uint32Array.from(idx) };
}
