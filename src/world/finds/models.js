// @ts-check
// Find models (docs/future/11): small glTF meshes under assets/models/finds/, baked offline to
// vertex colors (linear COLOR_0) with no textures, skins or animation, base on y = 0 and height 1.
// This reads one into the creature pass's vertex layout (position, normal, albedo: 9 floats), at a
// real height in meters, and makes normals where the file has none. Credits are in
// assets/models/finds/CREDITS.md.

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

/**
 * @typedef {{ name: string, vertices: Float32Array, count: number, indices: Uint32Array }} Part
 */

/**
 * Load a find model: one part per glTF mesh, in file order.
 * @param {string} url the .gltf file (its buffer sits beside it) @returns {Promise<Part[]>}
 */
export async function loadFindModel(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const gltf = await r.json();
  const base = new URL('.', new URL(url, location.href));
  const buffers = await Promise.all(gltf.buffers.map(async (/** @type {any} */ b) => {
    const br = await fetch(new URL(b.uri, base));
    if (!br.ok) throw new Error(`${b.uri}: HTTP ${br.status}`);
    return br.arrayBuffer();
  }));
  /** @param {number} i */
  const read = (i) => {
    const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView];
    const n = /** @type {Record<string, number>} */ (COMPONENTS)[a.type];
    const T = /** @type {any} */ (ARRAYS)[a.componentType];
    const stride = v.byteStride ?? 0;
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (!stride || stride === n * T.BYTES_PER_ELEMENT) return { data: new T(buffers[v.buffer], off, a.count * n), n };
    const out = new T(a.count * n), src = new DataView(buffers[v.buffer]);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const at = off + k * stride + c * T.BYTES_PER_ELEMENT;
      out[k * n + c] = T === Float32Array ? src.getFloat32(at, true) : T === Uint16Array ? src.getUint16(at, true) : T === Uint32Array ? src.getUint32(at, true) : src.getUint8(at);
    }
    return { data: out, n };
  };
  return gltf.meshes.map((/** @type {any} */ m) => {
    const p = m.primitives[0];
    const pos = read(p.attributes.POSITION).data;
    const col = p.attributes.COLOR_0 !== undefined ? read(p.attributes.COLOR_0) : null;
    const count = pos.length / 3;
    const indices = p.indices !== undefined ? Uint32Array.from(read(p.indices).data) : Uint32Array.from({ length: count }, (_, i) => i);
    const nor = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL).data : smoothNormals(pos, indices);
    const vertices = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      vertices.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]], i * 9);
      vertices.set(col ? [col.data[i * col.n], col.data[i * col.n + 1], col.data[i * col.n + 2]] : [0.5, 0.5, 0.5], i * 9 + 6);
    }
    return { name: m.name ?? '', vertices, count, indices };
  });
}

/** Area-weighted vertex normals. @param {ArrayLike<number>} pos @param {Uint32Array} idx */
export function smoothNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += x; n[k + 1] += y; n[k + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/**
 * Join parts into one mesh, each moved by its own function first (positions in, positions out;
 * normals are moved by the same function's change of shape, so keep the moves gentle).
 * @param {Part[]} parts @param {number} heightM real height @param {number[]} [rotDeg] turn about x, y, z (degrees)
 * @param {(p: number[], part: number) => number[]} [move] reshape (in units of height, before scaling)
 * @param {number[][]} [tint] a linear albedo multiplier per part
 * @returns {{ vertices: Float32Array, count: number, indices: Uint32Array }}
 */
export function joinParts(parts, heightM, rotDeg = [0, 0, 0], move = (p) => p, tint = []) {
  const count = parts.reduce((s, p) => s + p.count, 0);
  const vertices = new Float32Array(count * 9);
  const indices = new Uint32Array(parts.reduce((s, p) => s + p.indices.length, 0));
  const R = rotation(rotDeg);
  const rot = (/** @type {number[]} */ v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  let v0 = 0, i0 = 0;
  parts.forEach((part, pi) => {
    const tn = tint[pi] ?? [1, 1, 1];
    for (let i = 0; i < part.count; i++) {
      const s = part.vertices.subarray(i * 9, i * 9 + 9);
      const p = rot([s[0], s[1], s[2]]), nrm = rot([s[3], s[4], s[5]]);
      const q = move(p, pi);
      // The normal follows the move by a small step along it.
      const e = 0.01, q2 = move([p[0] + nrm[0] * e, p[1] + nrm[1] * e, p[2] + nrm[2] * e], pi);
      let nx = q2[0] - q[0], ny = q2[1] - q[1], nz = q2[2] - q[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      vertices.set([q[0] * heightM, q[1] * heightM, q[2] * heightM, nx, ny, nz, s[6] * tn[0], s[7] * tn[1], s[8] * tn[2]], (v0 + i) * 9);
    }
    for (let k = 0; k < part.indices.length; k++) indices[i0 + k] = part.indices[k] + v0;
    v0 += part.count;
    i0 += part.indices.length;
  });
  // A turn can lift the base off y = 0; set it back down.
  let lo = Infinity;
  for (let i = 0; i < count; i++) lo = Math.min(lo, vertices[i * 9 + 1]);
  for (let i = 0; i < count; i++) vertices[i * 9 + 1] -= lo;
  return { vertices, count, indices };
}

/** A 3x3 rotation, row-major, turning about x, then y, then z. @param {number[]} d degrees */
function rotation(d) {
  const [a, b, c] = d.map((x) => (x * Math.PI) / 180);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const X = [1, 0, 0, 0, ca, -sa, 0, sa, ca], Y = [cb, 0, sb, 0, 1, 0, -sb, 0, cb], Z = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  const m = (/** @type {number[]} */ A, /** @type {number[]} */ B) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((col) => A[r * 3] * B[col] + A[r * 3 + 1] * B[3 + col] + A[r * 3 + 2] * B[6 + col]));
  return m(Z, m(Y, X));
}
