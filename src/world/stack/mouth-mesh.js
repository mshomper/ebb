// @ts-check
// The cave mouth in the stack's foot, on the island (docs/future/19): Matt's model (November 2, 2026;
// assets/models/stack/cave-mouth.bin, made by tools/assets/build-cave-mouth.mjs: meters, y up, its
// opening toward +z, the origin at the opening's foot on its front plane) read into the two forms it
// is drawn in: the pieces pass's (with the rock scan, so it is the same stone as the cliff) and a
// cast-only props pass's (so it throws the sun's shadow into its own chamber). And the dark at the
// chamber's back, where the way on goes into the stack. Pure.

/** @typedef {import('../pack/pickup-meshes.js').Mesh} Mesh */

/**
 * The model's file: 'EBM2', vertex count, index count, then positions, each vertex's baked ambient
 * occlusion (its open sky, 0..1) and the indices.
 * @param {ArrayBuffer} buf @returns {{ pos: Float32Array, idx: Uint32Array, nrm: Float32Array, ao: Float32Array }}
 */
export function readMouth(buf) {
  const head = new Uint32Array(buf, 0, 3);
  if (head[0] !== 0x324d4245) throw new Error('cave-mouth.bin: not an EBM2 file');
  const n = head[1], pos = new Float32Array(buf, 12, n * 3), ao = new Float32Array(buf, 12 + n * 12, n), idx = new Uint32Array(buf, 12 + n * 16, head[2]);
  // Smooth normals, area-weighted.
  const nrm = new Float32Array(pos.length);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  for (let v = 0; v < nrm.length; v += 3) { const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1; nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l; }
  return { pos, idx, nrm, ao };
}

/**
 * For the pieces pass: 9 floats a vertex (position, normal, albedo), the albedo darkened by its baked
 * occlusion (its chamber and hollows go dark in any weather: the island's light does not know the
 * rock's roof), a little darker facing down and toward its foot (damp, weed-stained).
 * @param {{ pos: Float32Array, idx: Uint32Array, nrm: Float32Array, ao: Float32Array }} m @param {number[]} col
 * @param {{ floor: number, power: number }} O how dark no sky makes it, and the curve @returns {Mesh}
 */
export function mouthPieceMesh(m, col, O) {
  const n = m.pos.length / 3, v = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const ny = m.nrm[i * 3 + 1], y = m.pos[i * 3 + 1];
    const occ = O.floor + (1 - O.floor) * Math.pow(m.ao[i], O.power);
    const k = occ * (0.85 + 0.15 * Math.max(0, ny)) * (0.75 + 0.25 * Math.min(1, Math.max(0, y / 1.2)));
    v.set([m.pos[i * 3], y, m.pos[i * 3 + 2], m.nrm[i * 3], ny, m.nrm[i * 3 + 2], col[0] * k, col[1] * k, col[2] * k], i * 9);
  }
  return { vertices: v, count: n, indices: m.idx };
}

/**
 * The floor under its roof: a thin patch over the footprint's open cells that see less than full sky,
 * darkened by their baked occlusion (smoothed at the cells' corners), y just over the ground.
 * @param {any} fp the footprint (rows, floorAO) @param {number[]} col the floor's albedo
 * @param {{ floor: number, power: number }} O @param {number} y the patch's height (model frame) @returns {Mesh}
 */
export function mouthFloor(fp, col, O, y) {
  const c = fp.cellM, sky = (/** @type {number} */ i, /** @type {number} */ j) => {
    const r = fp.floorAO[Math.max(0, Math.min(fp.h - 1, j))];
    return (r.charCodeAt(Math.max(0, Math.min(fp.w - 1, i))) - 48) / 9;
  };
  const corner = (/** @type {number} */ i, /** @type {number} */ j) => (sky(i - 1, j - 1) + sky(i, j - 1) + sky(i - 1, j) + sky(i, j)) / 4;
  const v = [], idx = [];
  for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
    if (fp.rows[j][i] === '1' || sky(i, j) >= 0.85) continue;
    const base = v.length / 9;
    for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const k = O.floor + (1 - O.floor) * Math.pow(corner(i + di, j + dj), O.power);
      v.push(fp.x0 + (i + di) * c, y, fp.z0 + (j + dj) * c, 0, 1, 0, col[0] * k, col[1] * k, col[2] * k);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(idx) };
}

/**
 * For a props pass (cast only): 8 floats a vertex (position, normal, uv). @param {{ pos: Float32Array, idx: Uint32Array, nrm: Float32Array }} m
 * @returns {{ data: Float32Array, indices: Uint32Array }}
 */
export function mouthPropMesh(m) {
  const n = m.pos.length / 3, data = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) data.set([m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2], m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2], 0, 0], i * 8);
  return { data, indices: m.idx };
}

/**
 * The dark at the chamber's back: an arch-shaped black panel facing out, where the way on goes into
 * the stack (lit as anything is, it stays dark). @param {any} D stack.json mouthDark ({ z, x, halfWidthM, springM, archM }) @returns {Mesh}
 */
export function mouthDark(D) {
  const hw = D.halfWidthM, z = D.z, x0 = D.x, c = [0.004, 0.004, 0.005];
  /** @type {number[][]} */ const ring = [[hw, 0], [hw, D.springM]];
  for (let k = 1; k < 12; k++) { const th = (Math.PI * k) / 12; ring.push([hw * Math.cos(th), D.springM + (D.archM - D.springM) * Math.sin(th)]); }
  ring.push([-hw, D.springM], [-hw, 0]);
  const v = [x0, D.springM * 0.6, z, 0, 0, 1, ...c], idx = [];
  for (const [x, y] of ring) v.push(x0 + x, y, z, 0, 0, 1, ...c);
  for (let i = 1; i < ring.length; i++) idx.push(0, i, i + 1);
  return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(idx) };
}
