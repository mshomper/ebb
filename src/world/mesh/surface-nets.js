// @ts-check
// Surface nets on a regular grid of signed distances (negative inside the solid): one vertex per
// cell the surface crosses, at the mean of its edge crossings, and a quad across every grid edge the
// surface crosses, wound so it faces out of the solid. Shared by the creature bodies (body-bake.js)
// and the Hollow's floors (src/world/hollow/floor.js). Pure and deterministic: only + - * / on the
// samples, so the same field gives the same mesh in every browser and worker.

/** The twelve cell edges as corner pairs (corner c is i + (c & 1), j + (c >> 1 & 1), k + (c >> 2 & 1)). */
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/**
 * Mesh a sampled field.
 * @param {Float32Array} field samples, index (k * n[1] + j) * n[0] + i
 * @param {number[]} n samples along x, y, z
 * @param {number[]} min world position of sample (0, 0, 0)
 * @param {number} cellM spacing between samples (m)
 * @returns {{ pos: Float64Array, idx: Uint32Array, count: number }} vertex positions (3 a vertex) and triangles
 */
export function surfaceNets(field, n, min, cellM) {
  const [nx, ny, nz] = n;
  const sx = 1, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const off = [0, sx, sy, sx + sy, sz, sx + sz, sy + sz, sx + sy + sz];
  const v = new Float64Array(8);
  let pos = new Float64Array(1 << 16), count = 0;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const base = k * sz + j * sy + i;
    let inside = 0;
    for (let c = 0; c < 8; c++) { v[c] = field[base + off[c]]; if (v[c] <= 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let px = 0, py = 0, pz = 0, m = 0;
    for (let e = 0; e < 12; e++) {
      const a = EDGES[e][0], b = EDGES[e][1];
      if ((v[a] > 0) === (v[b] > 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      px += (a & 1) + ((b & 1) - (a & 1)) * t;
      py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      m++;
    }
    if (count * 3 + 3 > pos.length) { const grown = new Float64Array(pos.length * 2); grown.set(pos); pos = grown; }
    cellVert[(k * cy + j) * cx + i] = count;
    pos[count * 3] = min[0] + (i + px / m) * cellM;
    pos[count * 3 + 1] = min[1] + (j + py / m) * cellM;
    pos[count * 3 + 2] = min[2] + (k + pz / m) * cellM;
    count++;
  }

  let idx = new Uint32Array(1 << 16), ni = 0;
  const cAt = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => cellVert[(k * cy + j) * cx + i];
  const q = [0, 0, 0, 0];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s = k * sz + j * sy + i;
    const d0 = field[s];
    for (let axis = 0; axis < 3; axis++) {
      const d1 = field[s + (axis === 0 ? sx : axis === 1 ? sy : sz)];
      if ((d0 > 0) === (d1 > 0)) continue;
      // The four cells around this edge.
      if (axis === 0) { q[0] = cAt(i, j - 1, k - 1); q[1] = cAt(i, j, k - 1); q[2] = cAt(i, j, k); q[3] = cAt(i, j - 1, k); }
      else if (axis === 1) { q[0] = cAt(i - 1, j, k - 1); q[1] = cAt(i - 1, j, k); q[2] = cAt(i, j, k); q[3] = cAt(i, j, k - 1); }
      else { q[0] = cAt(i - 1, j - 1, k); q[1] = cAt(i, j - 1, k); q[2] = cAt(i, j, k); q[3] = cAt(i - 1, j, k); }
      if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[3] < 0) continue;
      if (ni + 6 > idx.length) { const grown = new Uint32Array(idx.length * 2); grown.set(idx); idx = grown; }
      if (d0 <= 0) { idx[ni++] = q[0]; idx[ni++] = q[1]; idx[ni++] = q[2]; idx[ni++] = q[0]; idx[ni++] = q[2]; idx[ni++] = q[3]; }
      else { idx[ni++] = q[0]; idx[ni++] = q[2]; idx[ni++] = q[1]; idx[ni++] = q[0]; idx[ni++] = q[3]; idx[ni++] = q[2]; }
    }
  }
  return { pos: pos.slice(0, count * 3), idx: idx.slice(0, ni), count };
}

/**
 * Normals from the sampled field's gradient, trilinearly blended at each vertex (pointing out of the
 * solid, toward rising values). Cheap: no extra field evaluations.
 * @param {Float32Array} field @param {number[]} n @param {number[]} min @param {number} cellM
 * @param {Float64Array} pos @param {number} count
 * @returns {Float32Array} 3 a vertex
 */
export function gridNormals(field, n, min, cellM, pos, count) {
  const [nx, ny, nz] = n;
  const sy = nx, sz = nx * ny;
  const out = new Float32Array(count * 3);
  /** Central difference along one axis at a sample, one-sided at the edges. */
  const grad = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k, /** @type {number} */ axis) => {
    const c = [i, j, k], lim = [nx, ny, nz][axis], st = [1, sy, sz][axis];
    const s = k * sz + j * sy + i;
    const lo = c[axis] > 0 ? s - st : s, hi = c[axis] < lim - 1 ? s + st : s;
    return field[hi] - field[lo];
  };
  for (let v = 0; v < count; v++) {
    const fx = (pos[v * 3] - min[0]) / cellM, fy = (pos[v * 3 + 1] - min[1]) / cellM, fz = (pos[v * 3 + 2] - min[2]) / cellM;
    const i0 = Math.min(nx - 2, Math.max(0, Math.floor(fx))), j0 = Math.min(ny - 2, Math.max(0, Math.floor(fy))), k0 = Math.min(nz - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    let gx = 0, gy = 0, gz = 0;
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
      const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
      gx += w * grad(i0 + di, j0 + dj, k0 + dk, 0);
      gy += w * grad(i0 + di, j0 + dj, k0 + dk, 1);
      gz += w * grad(i0 + di, j0 + dj, k0 + dk, 2);
    }
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[v * 3] = gx / l; out[v * 3 + 1] = gy / l; out[v * 3 + 2] = gz / l;
  }
  return out;
}
