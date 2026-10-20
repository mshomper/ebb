// @ts-check
// The common mussel (docs/future/11): its model is one valve (assets/models/finds/mussel-valve,
// baked by tools/bake-find-model.mjs --align valve: length along x, the hinge end at -x, the cup
// below its rim). Here it is mirrored into the other valve to make the pair, lower valve on bone 0
// and upper on bone 1, and each frame the upper one turns about the hinge so the mussel gapes a
// little under water and shuts at low tide or when you come close. Matrices are column-major 4x4,
// for the creatures pass. Pure.

/**
 * The pair from one valve (models.js joinParts layout: 9 floats a vertex, cup bottom on y = 0).
 * @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} valve
 * @returns {{ mesh: { vertices: Float32Array, count: number, indices: Uint32Array }, joints: Uint8Array, weights: Uint8Array, hinge: number[] }}
 *   hinge: the point the upper valve turns about (the axis runs along z)
 */
export function musselPair(valve) {
  const n = valve.count, V = valve.vertices;
  let rim = 0, x0 = Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    rim = Math.max(rim, V[i * 9 + 1]); x0 = Math.min(x0, V[i * 9]);
    z0 = Math.min(z0, V[i * 9 + 2]); z1 = Math.max(z1, V[i * 9 + 2]);
  }
  const vertices = new Float32Array(n * 18);
  vertices.set(V, 0);
  for (let i = 0; i < n; i++) {
    const s = V.subarray(i * 9, i * 9 + 9);
    // The upper valve: the lower one mirrored across its rim, normals with it.
    vertices.set([s[0], 2 * rim - s[1], s[2], s[3], -s[4], s[5], s[6], s[7], s[8]], (n + i) * 9);
  }
  const t = valve.indices, indices = new Uint32Array(t.length * 2);
  indices.set(t, 0);
  // A mirror turns the triangles inside out: wind them back.
  for (let k = 0; k < t.length; k += 3) indices.set([t[k] + n, t[k + 2] + n, t[k + 1] + n], t.length + k);
  const joints = new Uint8Array(n * 8), weights = new Uint8Array(n * 8);
  for (let i = 0; i < 2 * n; i++) { joints[i * 4] = i < n ? 0 : 1; weights[i * 4] = 255; }
  return { mesh: { vertices, count: 2 * n, indices }, joints, weights, hinge: [x0, rim, (z0 + z1) / 2] };
}

/**
 * The bone matrices for a gape (radians): bone 0 still, bone 1 turned about the hinge so the far
 * end of the upper valve lifts.
 * @param {number[]} hinge @param {number} gape @param {Float32Array} [out] @returns {Float32Array}
 */
export function musselBones(hinge, gape, out = new Float32Array(32)) {
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  const c = Math.cos(gape), s = Math.sin(gape), [px, py] = hinge;
  // M = T(p) Rz(gape) T(-p): x turns toward y.
  out.set([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px - (c * px - s * py), py - (s * px + c * py), 0, 1], 16);
  return out;
}
