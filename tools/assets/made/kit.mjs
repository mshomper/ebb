// A small mesh kit for the camp pieces sessions make in code (made-pieces.mjs; docs/future/13
// section 3.12 "Models"): parts built as grids (lathed, swept along a curve, or a lumpy blob) or as
// flat outlines pushed out to a thickness, each with its own smooth normals and linear vertex
// colours, then turned and moved into place. Meters, y up. Deterministic: every bit of variation
// comes from hash01 with fixed seeds, never Math.random. Build-time only.

/** @typedef {{ P: number[], N: number[], C: number[], T: number[] }} Mesh  positions, normals, linear rgb, triangles */
/** @typedef {[number, number, number]} V3 */

export const mesh = () => /** @type {Mesh} */ ({ P: [], N: [], C: [], T: [] });

/** A small seeded hash to 0..1 (the same as obj-source.mjs). @param {number} a @param {number} b @param {number} c */
export function hash01(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}

/** Smooth value noise in 3D, 0..1, from hash01 on a lattice. @param {number} x @param {number} y @param {number} z @param {number} seed */
export function noise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (/** @type {number} */ t) => t * t * (3 - 2 * t);
  const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
  let out = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    out += w * hash01(xi + dx + seed * 131, yi + dy - seed * 71, zi + dz + seed * 37);
  }
  return out;
}

/** sRGB 0..255 to linear 0..1, for colours picked by eye from photographs. @param {number[]} c */
export const lin = (c) => /** @type {V3} */ (c.map((x) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }));
/** Mix two colours. @param {number[]} a @param {number[]} b @param {number} t */
export const mix = (a, b, t) => /** @type {V3} */ (a.map((x, i) => x + (b[i] - x) * t));
/** A colour scaled. @param {number[]} a @param {number} k */
export const shade = (a, k) => /** @type {V3} */ (a.map((x) => x * k));

const sub = (/** @type {number[]} */ a, /** @type {number[]} */ b) => /** @type {V3} */ ([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
const cross = (/** @type {number[]} */ a, /** @type {number[]} */ b) => /** @type {V3} */ ([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (/** @type {number[]} */ a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return /** @type {V3} */ ([a[0] / l, a[1] / l, a[2] / l]); };

/** Area-weighted smooth normals for the vertices from `v0` on (one part). @param {Mesh} m @param {number} v0 @param {number} t0 */
function partNormals(m, v0, t0) {
  const n = m.P.length / 3;
  for (let v = v0; v < n; v++) m.N.push(0, 0, 0);
  for (let t = t0; t < m.T.length; t += 3) {
    const [a, b, c] = [m.T[t], m.T[t + 1], m.T[t + 2]];
    const pa = m.P.slice(a * 3, a * 3 + 3), pb = m.P.slice(b * 3, b * 3 + 3), pc = m.P.slice(c * 3, c * 3 + 3);
    const f = cross(sub(pb, pa), sub(pc, pa));
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) m.N[v * 3 + k] += f[k];
  }
  for (let v = v0; v < n; v++) {
    const q = norm(m.N.slice(v * 3, v * 3 + 3));
    m.N[v * 3] = q[0]; m.N[v * 3 + 1] = q[1]; m.N[v * 3 + 2] = q[2];
  }
}

/**
 * A grid part: nu columns by nv + 1 rows of vertices from at(u, v) (u, v in 0..1), joined round in u
 * when wrap. Smooth normals across the part. Returns the first vertex index, for place().
 * @param {Mesh} m @param {number} nu @param {number} nv
 * @param {(u: number, v: number) => { p: number[], c: number[] }} at @param {boolean} [wrap]
 */
export function grid(m, nu, nv, at, wrap = true) {
  const v0 = m.P.length / 3, t0 = m.T.length, cols = wrap ? nu : nu + 1;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
    const q = at(i / nu, j / nv);
    m.P.push(q.p[0], q.p[1], q.p[2]);
    m.C.push(q.c[0], q.c[1], q.c[2]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = wrap ? (i + 1) % nu : i + 1;
    const a = v0 + j * cols + i, b = v0 + j * cols + i1, c = v0 + (j + 1) * cols + i, d = v0 + (j + 1) * cols + i1;
    m.T.push(a, c, b, b, c, d);
  }
  partNormals(m, v0, t0);
  return v0;
}

/**
 * A lathed part round +y: profile(v) gives [radius, y] down its length, shape(u) the cross-section's
 * unit outline ([x, z]; a circle by default), color(u, v, p) its colour; bump(u, v) adds to the
 * radius (weave, grain). Ends closed by a radius of 0 in the profile.
 * @param {Mesh} m @param {number} nu @param {number} nv @param {(v: number) => number[]} profile
 * @param {(u: number, v: number, p: number[]) => number[]} color
 * @param {{ shape?: (u: number) => number[], bump?: (u: number, v: number) => number }} [o]
 */
export function lathe(m, nu, nv, profile, color, o = {}) {
  const shape = o.shape ?? ((u) => [Math.cos(u * 2 * Math.PI), Math.sin(u * 2 * Math.PI)]);
  return grid(m, nu, nv, (u, v) => {
    const [r, y] = profile(v), s = shape(u), rr = r + (r > 0 ? (o.bump?.(u, v) ?? 0) : 0);
    const p = [s[0] * rr, y, s[1] * rr];
    return { p, c: color(u, v, p) };
  });
}

/**
 * A round-ish super-ellipse outline, |x/a|^n + |z/b|^n = 1, as a lathe shape (a hamper's rounded
 * oblong). @param {number} a @param {number} b @param {number} n
 */
export const superShape = (a, b, n) => (/** @type {number} */ u) => {
  const t = u * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)];
};

/**
 * A part swept along a curve: path(t) its middle line, radius(t, a) its section (a the angle round
 * it), color(t, a). Frames are carried along the curve so it never twists. Its ends round off over
 * `endRound` of its length (0 leaves them open; a cut stick end uses a flat cap instead).
 * @param {Mesh} m @param {number} na @param {number} nt @param {(t: number) => number[]} path
 * @param {(t: number, a: number) => number} radius @param {(t: number, a: number) => number[]} color
 * @param {{ endRound?: number, flatEnds?: boolean }} [o]
 */
export function sweep(m, na, nt, path, radius, color, o = {}) {
  const pts = Array.from({ length: nt + 1 }, (_, j) => path(j / nt));
  const tan = pts.map((p, j) => norm(sub(pts[Math.min(nt, j + 1)], pts[Math.max(0, j - 1)])));
  // Parallel transport: start from any normal square to the first tangent, then carry it.
  let nrm = norm(cross(tan[0], Math.abs(tan[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const frames = tan.map((t) => {
    nrm = norm(sub(nrm, t.map((x) => x * dot(nrm, t))));
    // n1, n2 = n1 x t: round the section from n1 to n2, the grid's faces look outward.
    return [nrm, cross(nrm, t)];
  });
  const er = o.endRound ?? 0;
  const v0 = grid(m, na, nt, (u, v) => {
    const j = Math.round(v * nt), a = u * 2 * Math.PI;
    let k = 1;
    if (er > 0) { const e = Math.min(v, 1 - v) / er; if (e < 1) k = Math.sqrt(Math.max(0, 1 - (1 - e) * (1 - e))); }
    const r = radius(v, a) * k, [n1, n2] = frames[j];
    const p = [0, 1, 2].map((i) => pts[j][i] + (n1[i] * Math.cos(a) + n2[i] * Math.sin(a)) * r);
    return { p, c: color(v, a) };
  });
  if (o.flatEnds) for (const end of [0, 1]) {
    const j = end * nt, c0 = m.P.length / 3;
    const [n1, n2] = frames[j], t = tan[j].map((x) => (end ? x : -x));
    m.P.push(...pts[j]); m.C.push(...color(end, 0).map((x) => x * 1.25)); m.N.push(...t);
    for (let i = 0; i < na; i++) {
      const a = (i / na) * 2 * Math.PI, r = radius(end, a);
      m.P.push(...[0, 1, 2].map((q) => pts[j][q] + (n1[q] * Math.cos(a) + n2[q] * Math.sin(a)) * r));
      // End grain: paler rings toward the middle.
      m.C.push(...color(end, a).map((x) => x * 1.35)); m.N.push(...t);
    }
    for (let i = 0; i < na; i++) {
      const a = c0 + 1 + i, b = c0 + 1 + ((i + 1) % na);
      if (end) m.T.push(c0, b, a); else m.T.push(c0, a, b);
    }
  }
  return v0;
}

/**
 * A lumpy blob (a stone): a sphere of radii r, pushed in and out by noise, its top pressed flat
 * above flatTop (a share of the height, 1 for none) and its underside a little flat too.
 * @param {Mesh} m @param {number[]} r @param {number} seed @param {(p: number[], up: number) => number[]} color
 * @param {{ flatTop?: number, lump?: number, nu?: number, nv?: number }} [o]
 */
export function blob(m, r, seed, color, o = {}) {
  const flat = o.flatTop ?? 1, lump = o.lump ?? 0.12;
  return grid(m, o.nu ?? 40, o.nv ?? 22, (u, v) => {
    const th = u * 2 * Math.PI, ph = v * Math.PI;
    const d = [Math.sin(ph) * Math.cos(th), -Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    const k = 1 + lump * (noise3(d[0] * 1.6, d[1] * 1.6, d[2] * 1.6, seed) - 0.5) * 2 + 0.04 * (noise3(d[0] * 5, d[1] * 5, d[2] * 5, seed + 9) - 0.5);
    const p = [d[0] * r[0] * k, d[1] * r[1] * k, d[2] * r[2] * k];
    // Pressed flat: softly squash what rises above the flat line, and the underside below -0.7.
    const top = r[1] * flat;
    if (p[1] > top) p[1] = top + (p[1] - top) * 0.12;
    if (p[1] < -r[1] * 0.7) p[1] = -r[1] * 0.7 + (p[1] + r[1] * 0.7) * 0.25;
    return { p, c: color(p, d[1]) };
  });
}

/**
 * A flat outline pushed out to a thickness along z (a blade, a board): front and back faces fanned
 * from the outline's middle (keep it star-shaped about there), sides as flat strips. The outline
 * runs anticlockwise seen from +z. Each face has its own normals (crisp edges).
 * @param {Mesh} m @param {number[][]} outline [x, y] @param {number} depth @param {(x: number, y: number, side: number) => number[]} color
 * @param {{ bevel?: number }} [o] bevel thins the faces' rim toward the edge (a blade's edge)
 */
export function slab(m, outline, depth, color, o = {}) {
  const v0 = m.P.length / 3, n = outline.length;
  const mid = outline.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  for (const side of [1, -1]) {
    const c0 = m.P.length / 3, z = (side * depth) / 2;
    m.P.push(mid[0], mid[1], z); m.N.push(0, 0, side); m.C.push(...color(mid[0], mid[1], side));
    for (const p of outline) {
      m.P.push(p[0], p[1], z * (1 - (o.bevel ?? 0))); m.N.push(0, 0, side); m.C.push(...color(p[0], p[1], side));
    }
    for (let i = 0; i < n; i++) {
      const a = c0 + 1 + i, b = c0 + 1 + ((i + 1) % n);
      if (side > 0) m.T.push(c0, a, b); else m.T.push(c0, b, a);
    }
  }
  const zf = (depth / 2) * (1 - (o.bevel ?? 0));
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    const nn = norm([b[1] - a[1], -(b[0] - a[0]), 0]), c0 = m.P.length / 3;
    for (const [p, z] of [[a, zf], [b, zf], [a, -zf], [b, -zf]]) {
      m.P.push(/** @type {number[]} */ (p)[0], /** @type {number[]} */ (p)[1], /** @type {number} */ (z)); m.N.push(...nn); m.C.push(...color(/** @type {number[]} */ (p)[0], /** @type {number[]} */ (p)[1], 0));
    }
    m.T.push(c0, c0 + 2, c0 + 1, c0 + 1, c0 + 2, c0 + 3);
  }
  return v0;
}

/** A box with its own flat faces, centered at the origin. @param {Mesh} m @param {number[]} s sizes @param {(p: number[]) => number[]} color */
export function box(m, s, color) {
  const v0 = m.P.length / 3, h = s.map((x) => x / 2);
  for (const [ax, sg] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    const u = (ax + 1) % 3, w = (ax + 2) % 3, c0 = m.P.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = [0, 0, 0]; p[ax] = sg * h[ax]; p[u] = a * h[u]; p[w] = b * h[w];
      const nn = [0, 0, 0]; nn[ax] = sg;
      m.P.push(...p); m.N.push(...nn); m.C.push(...color(p));
    }
    if (sg > 0) m.T.push(c0, c0 + 1, c0 + 2, c0 + 1, c0 + 3, c0 + 2); else m.T.push(c0, c0 + 2, c0 + 1, c0 + 1, c0 + 2, c0 + 3);
  }
  return v0;
}

/** Turn about x, y or z, in radians, as a 3 x 3 (rows). @param {'x' | 'y' | 'z'} axis @param {number} a */
export function rot(axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
/** Rotations applied right to left (the last given turns first). @param {number[][][]} rs */
export function chain(...rs) {
  let o = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const r of rs) o = o.map((row) => [0, 1, 2].map((j) => row[0] * r[0][j] + row[1] * r[1][j] + row[2] * r[2][j]));
  return o;
}

/**
 * Turn and move the vertices from v0 on (a part, or several): p' = R p + t. Normals turn too.
 * @param {Mesh} m @param {number} v0 @param {number[][]} R @param {number[]} [t]
 */
export function place(m, v0, R, t = [0, 0, 0]) {
  const n = m.P.length / 3;
  for (let v = v0; v < n; v++) for (const [arr, move] of /** @type {[number[], boolean][]} */ ([[m.P, true], [m.N, false]])) {
    const p = arr.slice(v * 3, v * 3 + 3);
    for (let i = 0; i < 3; i++) arr[v * 3 + i] = R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2] + (move ? t[i] : 0);
  }
}

/** The number of vertices so far (the start of the next part). @param {Mesh} m */
export const mark = (m) => m.P.length / 3;
