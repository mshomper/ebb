// @ts-check
// Stone forms for a cave's signed field (decision 0001, Matt, November 2, 2026): what makes rock read
// as stone rather than smoke, shared by the spring's cave and the stack's mouth (cave-field.js) and the
// Hollow's floors (src/world/hollow/field.js). Jittered 2D cells (flagstones, the blocks between
// joints) and stacked seeded spheres (rocky bulges that keep the field a distance, after IQ's "FBM
// detail in SDFs"). Integer hashes and + - * / sqrt only, so a field is bit-identical in every
// browser and worker. Pure.

import { hash32 } from '../../core/rng.js';

/**
 * The 2D cells round (x, z) at `size` metres (a seeded jittered grid): the nearest cell's id and
 * middle, and how far (x, z) is from the line between it and the next nearest (half the gap between
 * their distances), the joint between two cells.
 * @param {number} seed @param {number} x @param {number} z @param {number} size
 * @returns {{ id: number, cx: number, cz: number, edge: number }}
 */
export function cells2(seed, x, z, size) {
  const gx = x / size, gz = z / size, ix = Math.floor(gx), iz = Math.floor(gz);
  let d1 = Infinity, d2 = Infinity, id = 0, cx = 0, cz = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const a = ix + i, b = iz + j, h = hash32(seed, a, b);
    const px = a + 0.15 + 0.7 * ((h >>> 8) & 255) / 255, pz = b + 0.15 + 0.7 * ((h >>> 16) & 255) / 255;
    const dx = px - gx, dz = pz - gz, d = Math.sqrt(dx * dx + dz * dz);
    if (d < d1) { d2 = d1; d1 = d; id = h; cx = px * size; cz = pz * size; } else if (d < d2) d2 = d;
  }
  return { id, cx, cz, edge: ((d2 - d1) / 2) * size };
}

/**
 * Rocky bulges round a point: the distance to the nearest of the seeded spheres on the corners of a
 * size-metre grid (negative inside one). @param {number} seed @param {number} x @param {number} y @param {number} z @param {number} size
 */
export function spheres(seed, x, y, z, size) {
  const gx = x / size, gy = y / size, gz = z / size, ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  let d = Infinity;
  for (let k = 0; k <= 1; k++) for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) {
    const r = 0.5 * ((hash32(seed, ix + i, iy + j, iz + k) >>> 8) / 16777216);
    const dx = gx - ix - i, dy = gy - iy - j, dz = gz - iz - k;
    d = Math.min(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - r);
  }
  return d * size;
}
