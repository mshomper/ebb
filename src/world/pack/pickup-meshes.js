// @ts-check
// Small seeded shapes for what lies on the ground to gather (docs/future/13 section 4.2), and the
// stand-in camp piles until Matt's models load (assets/models/camp/log-pile.glb, stone-pile.glb).
// Drift twigs and sticks are thin bent sticks, pebbles small rounded stones, flat stones low slabs.
// Each is built from a few vertices in the creature pass's layout (position, normal, albedo: 9
// floats a vertex) at its real size in meters, base on y = 0, lying along +z. The stand-in piles are
// a low mound of crossed sticks and a low cairn of rounded stones, at the models' footprints. Pure
// and seeded (the same seed, the same shape); drawn by draw.js. Numbers: recipes/world/pack.json
// `pickups` and `piles.look`.

import { hash32 } from '../../core/rng.js';

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** A mesh being built: vertices (9 floats each) and triangles. */
function builder() {
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const ix = [];
  return {
    /** @param {number[]} p @param {number[]} n @param {number[]} c */
    vert(p, n, c) { v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]); return v.length / 9 - 1; },
    /** @param {number} a @param {number} b @param {number} c */
    tri(a, b, c) { ix.push(a, b, c); },
    count: () => v.length / 9,
    /** Add another mesh, each vertex moved by a turn and a shift. @param {Mesh} m @param {(p: number[]) => number[]} move @param {(n: number[]) => number[]} turn */
    add(m, move, turn) {
      const base = v.length / 9;
      for (let i = 0; i < m.count; i++) {
        const s = m.vertices.subarray(i * 9, i * 9 + 9);
        const p = move([s[0], s[1], s[2]]), n = turn([s[3], s[4], s[5]]);
        v.push(p[0], p[1], p[2], n[0], n[1], n[2], s[6], s[7], s[8]);
      }
      for (const k of m.indices) ix.push(k + base);
    },
    /** @returns {Mesh} */
    done: () => ({ vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(ix) }),
  };
}

/** Area-weighted vertex normals, written into the mesh. @param {Mesh} m */
function smooth(m) {
  const n = new Float64Array(m.count * 3), V = m.vertices;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
    const ux = V[b * 9] - V[a * 9], uy = V[b * 9 + 1] - V[a * 9 + 1], uz = V[b * 9 + 2] - V[a * 9 + 2];
    const vx = V[c * 9] - V[a * 9], vy = V[c * 9 + 1] - V[a * 9 + 1], vz = V[c * 9 + 2] - V[a * 9 + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k * 3] += x; n[k * 3 + 1] += y; n[k * 3 + 2] += z; }
  }
  for (let i = 0; i < m.count; i++) {
    const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    V.set([n[i * 3] / l, n[i * 3 + 1] / l, n[i * 3 + 2] / l], i * 9 + 3);
  }
  return m;
}

/** A colour a little lighter or darker, by a hash. @param {number[]} c @param {number} h @param {number} spread */
const shade = (c, h, spread) => { const k = 1 + (u01(h) * 2 - 1) * spread; return [c[0] * k, c[1] * k, c[2] * k]; };

/**
 * A thin stick lying along z, bowed sideways and a little up, tapering to its tip, its underside on y = 0.
 * @param {number} seed @param {number} lenM @param {number} radiusM @param {number} bend sideways bow (share of its length)
 * @param {number[]} color linear albedo @returns {Mesh}
 */
export function stickMesh(seed, lenM, radiusM, bend, color) {
  const b = builder(), SEG = 6, RING = 5;
  const side = u01(hash32(seed, 1)) < 0.5 ? -1 : 1;
  const col = shade(color, hash32(seed, 2), 0.12);
  /** @param {number} t 0..1 along */
  const mid = (t) => { const s = 2 * t - 1; return [side * bend * lenM * 0.5 * (1 - s * s), 0, (t - 0.5) * lenM]; };
  /** @param {number} t */
  const rad = (t) => radiusM * (1 - 0.35 * t);
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, c = mid(t), r = rad(t);
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * 2 * Math.PI, nx = Math.cos(a), ny = Math.sin(a);
      b.vert([c[0] + nx * r, radiusM + ny * r, c[2]], [nx, ny, 0], col);
    }
  }
  for (let i = 0; i < SEG; i++) for (let k = 0; k < RING; k++) {
    const a = i * RING + k, c = i * RING + ((k + 1) % RING);
    b.tri(a, c, a + RING); b.tri(c, c + RING, a + RING);
  }
  // Both ends closed.
  for (const [i, dz] of /** @type {[number, number][]} */ ([[0, -1], [SEG, 1]])) {
    const c = mid(i / SEG), at = b.vert([c[0], radiusM, c[2]], [0, 0, dz], col);
    for (let k = 0; k < RING; k++) b.tri(at, i * RING + k, i * RING + ((k + 1) % RING));
  }
  return b.done();
}

/**
 * A small rounded stone: a lumpy, flattened ball, sunk a little into the ground.
 * @param {number} seed @param {number[]} radii [x, y, z] in meters @param {number} lump how lumpy (share of the radius)
 * @param {number[]} color linear albedo @param {number} [sink] share of its height below y = 0 @returns {Mesh}
 */
export function pebbleMesh(seed, radii, lump, color, sink = 0.15) {
  const b = builder(), LAT = 6, LON = 10;
  const col = shade(color, hash32(seed, 3), 0.15);
  const p1 = u01(hash32(seed, 4)) * 6.283, p2 = u01(hash32(seed, 5)) * 6.283, p3 = u01(hash32(seed, 6)) * 6.283;
  /** @param {number} th 0 top .. pi bottom @param {number} ph */
  const at = (th, ph) => {
    const st = Math.sin(th);
    const k = 1 + lump * (0.6 * Math.sin(2 * ph + p1) * st + 0.4 * Math.cos(3 * ph + p2) * st * st + 0.3 * Math.sin(2 * th + p3));
    return [radii[0] * st * Math.cos(ph) * k, radii[1] * Math.cos(th) * k, radii[2] * st * Math.sin(ph) * k];
  };
  const top = b.vert(at(0, 0), [0, 1, 0], col);
  for (let i = 1; i < LAT; i++) for (let k = 0; k < LON; k++) b.vert(at((i / LAT) * Math.PI, (k / LON) * 2 * Math.PI), [0, 1, 0], col);
  const bottom = b.vert(at(Math.PI, 0), [0, -1, 0], col);
  const ring = (/** @type {number} */ i, /** @type {number} */ k) => 1 + (i - 1) * LON + (k % LON);
  for (let k = 0; k < LON; k++) b.tri(top, ring(1, k + 1), ring(1, k));
  for (let i = 1; i < LAT - 1; i++) for (let k = 0; k < LON; k++) {
    b.tri(ring(i, k), ring(i, k + 1), ring(i + 1, k));
    b.tri(ring(i, k + 1), ring(i + 1, k + 1), ring(i + 1, k));
  }
  for (let k = 0; k < LON; k++) b.tri(bottom, ring(LAT - 1, k), ring(LAT - 1, k + 1));
  const m = smooth(b.done());
  // Base on the ground, a share of it sunk in.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.count; i++) { lo = Math.min(lo, m.vertices[i * 9 + 1]); hi = Math.max(hi, m.vertices[i * 9 + 1]); }
  for (let i = 0; i < m.count; i++) m.vertices[i * 9 + 1] -= lo + (hi - lo) * sink;
  return m;
}

/**
 * One shape of a ground pickup kind, seeded: drift twigs and sticks are sticks, pebbles small
 * stones, flat stones low slabs. Sizes and colours from the recipe's pickups block.
 * @param {string} kind @param {number} seed @param {any} P pack.json pickups[kind] @returns {Mesh}
 */
export function pickupMesh(kind, seed, P) {
  const u = (/** @type {number} */ k) => u01(hash32(seed, k, 0x71c));
  const lerp = (/** @type {number[]} */ r, /** @type {number} */ t) => r[0] + (r[1] - r[0]) * t;
  if (P.shape === 'stick') {
    const len = lerp(P.lenM, u(1));
    return stickMesh(seed, len, lerp(P.radiusM, u(2)), lerp(P.bend, u(3)), P.color);
  }
  const r = lerp(P.sizeM, u(1)) / 2;
  const flat = P.shape === 'flat';
  const radii = [r, r * lerp(P.heightShare, u(2)), r * (flat ? lerp([0.55, 0.85], u(3)) : lerp([0.75, 1], u(3)))];
  return pebbleMesh(seed, radii, P.lump ?? 0.12, P.color, P.sink ?? 0.15);
}

/** Turn about y by a, then tip about x by b. @param {number} a @param {number} b */
function turner(a, b) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return (/** @type {number[]} */ p) => {
    const y = p[1] * cb - p[2] * sb, z = p[1] * sb + p[2] * cb;
    return [ca * p[0] + sa * z, y, -sa * p[0] + ca * z];
  };
}

/**
 * The stand-in stick pile: a low mound of crossed sticks, footprintM across (before scaling).
 * @param {number} seed @param {any} S pack.json piles.look.standIn.stick @param {number} footprintM @returns {Mesh}
 */
export function stickPileMesh(seed, S, footprintM) {
  const b = builder(), R = footprintM / 2;
  for (let i = 0; i < S.count; i++) {
    const u = (/** @type {number} */ k) => u01(hash32(seed, i, k));
    const len = footprintM * (S.lenShare[0] + (S.lenShare[1] - S.lenShare[0]) * u(1));
    const stick = stickMesh(hash32(seed, i), len, S.radiusM[0] + (S.radiusM[1] - S.radiusM[0]) * u(2), 0.08, S.color);
    // Crossed: each at its own turn, laid higher toward the middle of the mound.
    const d = R * 0.45 * Math.sqrt(u(3)), a = u(4) * 2 * Math.PI;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const y = S.heightM * (1 - (d / R) * (d / R)) * (i / S.count);
    const turn = turner(u(5) * Math.PI, (u(6) - 0.5) * 0.3);
    b.add(stick, (p) => { const q = turn(p); return [q[0] + x, q[1] + y, q[2] + z]; }, turn);
  }
  return b.done();
}

/**
 * The stand-in stone pile: a low cairn of rounded stones, footprintM across (before scaling).
 * @param {number} seed @param {any} S pack.json piles.look.standIn.stone @param {number} footprintM @returns {Mesh}
 */
export function stonePileMesh(seed, S, footprintM) {
  const b = builder(), R = footprintM / 2;
  const id = (/** @type {number[]} */ n) => n;
  let i = 0;
  // Rings of stones, smaller and higher toward the top.
  for (const [n, ring, lift] of /** @type {[number, number, number][]} */ (S.rings)) {
    for (let k = 0; k < n; k++, i++) {
      const u = (/** @type {number} */ q) => u01(hash32(seed, i, q));
      const r = R * (S.stoneShare[0] + (S.stoneShare[1] - S.stoneShare[0]) * u(1)) * (1 - lift * 0.5);
      const stone = pebbleMesh(hash32(seed, i), [r, r * 0.6, r * 0.8], 0.12, S.color, 0.1);
      const a = ((k + u(2) * 0.5) / n) * 2 * Math.PI, d = R * ring;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, y = S.heightM * lift;
      const turn = turner(u(3) * 2 * Math.PI, 0);
      b.add(stone, (p) => { const q = turn(p); return [q[0] + x, q[1] + y, q[2] + z]; }, (n2) => id(turn(n2)));
    }
  }
  return b.done();
}
