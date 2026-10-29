// @ts-check
// The gift stone and what lies on it, made in code (B1 C1; docs/future/13 C-14): a low flat stone
// with a few shells set on its top, the small things a creature leaves there (a bundle of green
// strands, a tied bundle of reeds, a feather, else a small wrapped parcel), and the herb bed's
// edging pebbles. In the creature pass's layout (position, normal, albedo: 9 floats a vertex), at
// real size in meters, base on y = 0. Pure and seeded. Numbers: recipes/world/camp.json `giftStone`.

import { hash32 } from '../../core/rng.js';
import { pebbleMesh, stickMesh } from '../pack/pickup-meshes.js';

/** @typedef {import('../pack/pickup-meshes.js').Mesh} Mesh */

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** Meshes joined, each moved (turned about y, then shifted). @param {{ m: Mesh, yaw?: number, at?: number[], tip?: number }[]} parts @returns {Mesh} */
export function joinMeshes(parts) {
  let n = 0, ni = 0;
  for (const p of parts) { n += p.m.count; ni += p.m.indices.length; }
  const v = new Float32Array(n * 9), ix = new Uint32Array(ni);
  let base = 0, io = 0;
  for (const { m, yaw = 0, at = [0, 0, 0], tip = 0 } of parts) {
    const c = Math.cos(yaw), s = Math.sin(yaw), ct = Math.cos(tip), st = Math.sin(tip);
    for (let i = 0; i < m.count; i++) {
      const q = m.vertices.subarray(i * 9, i * 9 + 9), o = (base + i) * 9;
      // Tip about x first (a feather lying a little up the slope), then turn about y.
      const py = q[1] * ct - q[2] * st, pz = q[1] * st + q[2] * ct, ny = q[4] * ct - q[5] * st, nz = q[4] * st + q[5] * ct;
      v[o] = q[0] * c + pz * s + at[0]; v[o + 1] = py + at[1]; v[o + 2] = -q[0] * s + pz * c + at[2];
      v[o + 3] = q[3] * c + nz * s; v[o + 4] = ny; v[o + 5] = -q[3] * s + nz * c;
      v[o + 6] = q[6]; v[o + 7] = q[7]; v[o + 8] = q[8];
    }
    for (const k of m.indices) ix[io++] = k + base;
    base += m.count;
  }
  return { vertices: v, count: n, indices: ix };
}

/** The highest point of a mesh. @param {Mesh} m */
const topOf = (m) => { let t = -Infinity; for (let i = 0; i < m.count; i++) t = Math.max(t, m.vertices[i * 9 + 1]); return t; };

/**
 * A small scallop shell: a domed fan with ribs, its hinge at the origin, opening along +z.
 * @param {number} seed @param {number} r radius (m) @param {number[]} color linear albedo @returns {Mesh}
 */
export function shellMesh(seed, r, color) {
  const RIBS = 14, RINGS = 5, spread = 1.2, dome = 0.5;
  const k = 0.88 + 0.24 * u01(hash32(seed, 1));
  const col = color.map((c) => Math.min(1, c * k));
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const ix = [];
  /** Its ribs drawn in darker stripes, and darker toward the hinge. @param {number[]} p @param {number[]} n @param {number} [k] */
  const vert = (p, n, k = 1) => { v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0] * k, col[1] * k, col[2] * k); return v.length / 9 - 1; };
  const hinge = vert([0, r * 0.05, 0], [0, 1, 0], 0.7);
  for (let i = 1; i <= RINGS; i++) for (let j = 0; j <= RIBS; j++) {
    const t = i / RINGS, a = (j / RIBS - 0.5) * 2 * spread;
    const rib = 0.12 * Math.cos(j * Math.PI) * t;
    const x = Math.sin(a) * r * t, z = Math.cos(a) * r * t;
    const y = r * dome * (1 - t * t) + r * rib * 0.5 + r * 0.05;
    const nx = Math.sin(a) * t * 0.6, nz = Math.cos(a) * t * 0.6, nl = Math.hypot(nx, 1, nz);
    vert([x, y, z], [nx / nl, 1 / nl, nz / nl], (j % 2 ? 0.72 : 1) * (0.8 + 0.2 * t));
  }
  const at = (/** @type {number} */ i, /** @type {number} */ j) => 1 + (i - 1) * (RIBS + 1) + j;
  for (let j = 0; j < RIBS; j++) ix.push(hinge, at(1, j + 1), at(1, j));
  for (let i = 1; i < RINGS; i++) for (let j = 0; j < RIBS; j++) {
    ix.push(at(i, j), at(i, j + 1), at(i + 1, j));
    ix.push(at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
  }
  // The underside: the same fan, flat, facing down (a shell lying on stone shows no gap).
  const under = v.length / 9;
  for (let q = 0; q < under; q++) v.push(v[q * 9], 0.002, v[q * 9 + 2], 0, -1, 0, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8);
  const triCount = ix.length;
  for (let t = 0; t < triCount; t += 3) ix.push(ix[t] + under, ix[t + 2] + under, ix[t + 1] + under);
  return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(ix) };
}

/**
 * A low flat slab: an uneven outline (a few slow lobes), a rounded edge and a gently domed, faintly
 * bumpy top, flecked with pale lichen. Base on y = 0, a share of its edge sunk below it.
 * @param {number} seed @param {any} G camp.json giftStone @returns {Mesh}
 */
export function slabMesh(seed, G) {
  const AROUND = 36, RINGS = 6, EDGE = 4;
  const [rx, ry, rz] = G.stoneRadiiM;
  const ph = [1, 2, 3, 4].map((q) => u01(hash32(seed, q)) * 2 * Math.PI);
  /** The outline's radius share at an angle. @param {number} a */
  const lobe = (a) => 1 + G.lump * (1.2 * Math.sin(2 * a + ph[0]) + 0.8 * Math.sin(3 * a + ph[1]) + 0.45 * Math.sin(5 * a + ph[2]));
  /** The top's bumps at a point. @param {number} x @param {number} z */
  const bump = (x, z) => 0.3 * ry * (Math.sin(x * 31 + ph[3]) * Math.sin(z * 27 + ph[0]) + 0.5 * Math.sin(x * 57 + z * 43));
  /** A colour at a point: the stone's, a little lighter or darker, with lichen flecks. @param {number} x @param {number} z */
  const colour = (x, z) => {
    const n = 0.5 + 0.5 * Math.sin(x * 23 + ph[1]) * Math.sin(z * 19 + ph[2]);
    const lichen = Math.max(0, Math.sin(x * 41 + ph[3]) * Math.sin(z * 37 + ph[1]) - 0.55) * 2.2;
    const k = 0.85 + 0.3 * n;
    return G.stoneColor.map((/** @type {number} */ c, /** @type {number} */ i) => c * k * (1 - lichen) + (G.lichenColor ?? [0.55, 0.55, 0.42])[i] * lichen);
  };
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const ix = [];
  const vert = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const c = colour(x, z);
    v.push(x, y, z, 0, 1, 0, c[0], c[1], c[2]);
    return v.length / 9 - 1;
  };
  // The top: rings from the middle out to where the edge begins to round over.
  const top = ry * 2 * (1 - G.sink);
  const centre = vert(0, top + bump(0, 0), 0);
  /** Rings of the top, then the rounded edge down below the ground. */
  const rows = [];
  for (let i = 1; i <= RINGS + EDGE; i++) {
    const row = [];
    for (let j = 0; j < AROUND; j++) {
      const a = (j / AROUND) * 2 * Math.PI, l = lobe(a);
      let t, y;
      if (i <= RINGS) { t = (i / RINGS) * 0.86; y = top * (1 - 0.18 * t * t) + bump(Math.cos(a) * rx * t, Math.sin(a) * rz * t) * (1 - t); }
      else { const e = (i - RINGS) / EDGE, q = (e * Math.PI) / 2; t = 0.86 + 0.14 * Math.sin(q); y = top * (1 - 0.18 * 0.74) * Math.cos(q) - ry * 2 * G.sink * e; }
      row.push(vert(Math.cos(a) * rx * l * t, y, Math.sin(a) * rz * l * t));
    }
    rows.push(row);
  }
  for (let j = 0; j < AROUND; j++) ix.push(centre, rows[0][(j + 1) % AROUND], rows[0][j]);
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < AROUND; j++) {
    const a = rows[i][j], b = rows[i][(j + 1) % AROUND], c = rows[i + 1][j], d = rows[i + 1][(j + 1) % AROUND];
    ix.push(a, b, c, b, d, c);
  }
  const m = { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(ix) };
  // Area-weighted normals.
  const n = new Float64Array(m.count * 3), V = m.vertices;
  for (let t = 0; t < ix.length; t += 3) {
    const [p, q, r] = [ix[t], ix[t + 1], ix[t + 2]];
    const ux = V[q * 9] - V[p * 9], uy = V[q * 9 + 1] - V[p * 9 + 1], uz = V[q * 9 + 2] - V[p * 9 + 2];
    const wx = V[r * 9] - V[p * 9], wy = V[r * 9 + 1] - V[p * 9 + 1], wz = V[r * 9 + 2] - V[p * 9 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const k of [p, q, r]) { n[k * 3] += nx; n[k * 3 + 1] += ny; n[k * 3 + 2] += nz; }
  }
  for (let i = 0; i < m.count; i++) {
    const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    V.set([n[i * 3] / l, n[i * 3 + 1] / l, n[i * 3 + 2] / l], i * 9 + 3);
  }
  return m;
}

/**
 * The gift stone: a low flat stone with a few shells set on its top in a loose arc.
 * @param {number} seed @param {any} G camp.json giftStone @returns {{ mesh: Mesh, topM: number }}
 */
export function giftStoneMesh(seed, G) {
  const stone = slabMesh(hash32(seed, 1), G);
  const top = topOf(stone);
  /** @type {{ m: Mesh, yaw?: number, at?: number[] }[]} */ const parts = [{ m: stone }];
  for (let i = 0; i < G.shells; i++) {
    const u = (/** @type {number} */ q) => u01(hash32(seed, 10 + i, q));
    // Along the stone's far side, a little in from its rim.
    const a = Math.PI * (0.15 + 0.7 * (i + 0.5 * u(1)) / G.shells), d = G.shellRingShare * G.stoneRadiiM[0];
    const x = Math.cos(a) * d, z = Math.sin(a) * d * (G.stoneRadiiM[2] / G.stoneRadiiM[0]);
    const r = G.shellM[0] + (G.shellM[1] - G.shellM[0]) * u(2);
    const col = G.shellColors[Math.floor(u(3) * G.shellColors.length)];
    parts.push({ m: shellMesh(hash32(seed, 20 + i), r, col), yaw: u(4) * 2 * Math.PI, at: [x, top * 0.92, z] });
  }
  return { mesh: joinMeshes(parts), topM: top * 0.92 };
}

/**
 * A gift as it lies on the stone, by its token's shape: 'bundle' (strands or reeds tied in the
 * middle), 'feather', else a small wrapped 'parcel'. @param {number} seed @param {any} T camp.json giftStone.tokens[kind]
 * @returns {Mesh}
 */
export function giftTokenMesh(seed, T) {
  if (T.shape === 'bundle') {
    /** @type {{ m: Mesh, yaw?: number, at?: number[] }[]} */ const parts = [];
    for (let i = 0; i < T.count; i++) {
      const u = (/** @type {number} */ q) => u01(hash32(seed, i, q));
      const len = T.lenM * (0.85 + 0.3 * u(1));
      parts.push({ m: stickMesh(hash32(seed, i), len, T.radiusM, 0.08, T.color), yaw: (u(2) - 0.5) * 0.25, at: [(i - (T.count - 1) / 2) * T.radiusM * 1.6, (i % 2) * T.radiusM * 1.2, 0] });
    }
    // The tie round its middle: a short, thick, darker stick across it.
    parts.push({ m: stickMesh(hash32(seed, 99), T.count * T.radiusM * 2.2, T.radiusM * 0.9, 0, T.tieColor ?? [0.3, 0.24, 0.15]), yaw: Math.PI / 2, at: [0, T.radiusM * 0.4, 0] });
    return joinMeshes(parts);
  }
  if (T.shape === 'feather') {
    // A long flattened lumpy oval (the vane), and its quill as a thin stick along it.
    const vane = pebbleMesh(hash32(seed, 1), [T.widthM / 2, T.widthM * 0.08, T.lenM / 2], 0.05, T.color, 0);
    const quill = stickMesh(hash32(seed, 2), T.lenM * 1.15, T.widthM * 0.05, 0.02, T.quillColor ?? [0.8, 0.75, 0.62]);
    return joinMeshes([{ m: vane }, { m: quill, at: [0, T.widthM * 0.04, T.lenM * 0.05] }]);
  }
  return pebbleMesh(hash32(seed, 3), T.radiiM ?? [0.05, 0.035, 0.04], 0.1, T.color ?? [0.55, 0.5, 0.38], 0.05);
}
