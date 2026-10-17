// @ts-check
// Heightfield storage (docs/08): the three window-sized GPU textures, scratch twins for
// ping-pong compute, and the CPU mirror (quantized heights are the truth; a float copy is
// used for sampling and is nudged approximately during a stroke).

import { makeTexture } from '../../core/gpu.js';
import { CELL, WORLD_CELLS as N, WORLD_ORIGIN, H_MIN, H_MAX, dequantize } from './grid.js';

/**
 * @typedef {Object} Mirror
 * @property {Uint16Array} heightQ   quantized heights, N*N, row-major (x fastest)
 * @property {Float32Array} heightF  meters; equals dequantize(heightQ) outside a live stroke
 * @property {Uint8Array} material   grass, sand, rock, soil weights per cell, N*N*4
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} CellRect */

/** @returns {Mirror} */
export function createMirror() {
  return {
    heightQ: new Uint16Array(N * N),
    heightF: new Float32Array(N * N),
    material: new Uint8Array(N * N * 4),
  };
}

/** @param {GPUDevice} device */
export function createTextures(device) {
  const size = [N, N];
  const T = GPUTextureUsage;
  return {
    // Height and its scratch twin are both sampled and written, so erosion can ping-pong without copies.
    height: makeTexture(device, { label: 'terrain-height', size, format: 'r32float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_DST | T.COPY_SRC }),
    heightScratch: makeTexture(device, { label: 'terrain-height-scratch', size, format: 'r32float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_SRC | T.COPY_DST }),
    material: makeTexture(device, { label: 'terrain-material', size, format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST | T.COPY_SRC }),
    materialScratch: makeTexture(device, { label: 'terrain-material-scratch', size, format: 'rgba8unorm', usage: T.STORAGE_BINDING | T.COPY_SRC }),
    // r visual wetness, g damp paint, b moss mask, a path wear: filled by later steps (S4, M3, M4).
    ground: makeTexture(device, { label: 'terrain-ground', size, format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST }),
  };
}

/** @typedef {ReturnType<typeof createTextures>} TerrainTextures */

/**
 * Upload a cell rect of the CPU mirror (float heights and materials) to the GPU.
 * @param {GPUDevice} device @param {TerrainTextures} tex @param {Mirror} m @param {CellRect} r
 */
export function uploadRect(device, tex, m, r) {
  if (r.w <= 0 || r.h <= 0) return;
  const offset = r.y * N + r.x;
  device.queue.writeTexture({ texture: tex.height, origin: [r.x, r.y] }, m.heightF.buffer,
    { offset: m.heightF.byteOffset + offset * 4, bytesPerRow: N * 4, rowsPerImage: r.h }, [r.w, r.h]);
  device.queue.writeTexture({ texture: tex.material, origin: [r.x, r.y] }, m.material.buffer,
    { offset: m.material.byteOffset + offset * 4, bytesPerRow: N * 4, rowsPerImage: r.h }, [r.w, r.h]);
}

/**
 * Refresh float heights from quantized heights over a rect.
 * @param {Mirror} m @param {CellRect} r
 */
export function syncFloat(m, r) {
  for (let j = r.y; j < r.y + r.h; j++) {
    for (let i = r.x, k = j * N + r.x; i < r.x + r.w; i++, k++) m.heightF[k] = dequantize(m.heightQ[k]);
  }
}

/** World x or z to continuous cell coordinate (cell centers at integers). @param {number} v */
export const toCell = (v) => (v - WORLD_ORIGIN) / CELL - 0.5;

/**
 * Bilinear height in meters at world (x, z), clamped to the window.
 * @param {Float32Array} hf @param {number} x @param {number} z
 */
export function sampleHeight(hf, x, z) {
  let u = toCell(x);
  let v = toCell(z);
  u = u < 0 ? 0 : u > N - 1.001 ? N - 1.001 : u;
  v = v < 0 ? 0 : v > N - 1.001 ? N - 1.001 : v;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const k = j * N + i;
  const a = hf[k] + (hf[k + 1] - hf[k]) * fu;
  const b = hf[k + N] + (hf[k + N + 1] - hf[k + N]) * fu;
  return a + (b - a) * fv;
}

/**
 * Surface normal from central differences of the bilinear height.
 * @param {Float32Array} hf @param {number} x @param {number} z @param {Float32Array|number[]} out
 */
export function sampleNormal(hf, x, z, out) {
  const e = CELL;
  const dx = sampleHeight(hf, x + e, z) - sampleHeight(hf, x - e, z);
  const dz = sampleHeight(hf, x, z + e) - sampleHeight(hf, x, z - e);
  const nx = -dx;
  const ny = 2 * e;
  const nz = -dz;
  const l = Math.hypot(nx, ny, nz);
  out[0] = nx / l;
  out[1] = ny / l;
  out[2] = nz / l;
  return out;
}

/**
 * Material weights (0..1) at world (x, z), nearest cell.
 * @param {Uint8Array} mat @param {number} x @param {number} z
 */
export function sampleMaterial(mat, x, z) {
  const i = Math.min(N - 1, Math.max(0, Math.round(toCell(x))));
  const j = Math.min(N - 1, Math.max(0, Math.round(toCell(z))));
  const k = (j * N + i) * 4;
  return { grass: mat[k] / 255, sand: mat[k + 1] / 255, rock: mat[k + 2] / 255, soil: mat[k + 3] / 255 };
}

/**
 * Ray against the heightfield: march in quarter-cell steps inside the height slab, then bisect.
 * (A simpler cousin of the DDA in docs/08; the world is small enough that marching is cheap.)
 * @param {Float32Array} hf
 * @param {ArrayLike<number>} o origin
 * @param {ArrayLike<number>} d unit direction
 * @returns {{ hit: boolean, point: number[], t: number }}
 */
export function raycast(hf, o, d) {
  // Clip the ray to the slab between the lowest and highest possible ground.
  let t0 = 0;
  let t1 = 2000;
  if (Math.abs(d[1]) > 1e-6) {
    const ta = (H_MAX - o[1]) / d[1];
    const tb = (H_MIN - o[1]) / d[1];
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (o[1] > H_MAX || o[1] < H_MIN) {
    return { hit: false, point: [0, 0, 0], t: 0 };
  }
  // Clip to the window box in x and z.
  const lo = WORLD_ORIGIN;
  const hi = WORLD_ORIGIN + N * CELL;
  for (const ax of [0, 2]) {
    if (Math.abs(d[ax]) < 1e-9) {
      if (o[ax] < lo || o[ax] > hi) return { hit: false, point: [0, 0, 0], t: 0 };
      continue;
    }
    const ta = (lo - o[ax]) / d[ax];
    const tb = (hi - o[ax]) / d[ax];
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t0 >= t1) return { hit: false, point: [0, 0, 0], t: 0 };

  const horiz = Math.hypot(d[0], d[2]);
  const step = Math.min(0.5, (CELL * 0.5) / Math.max(horiz, 1e-3));
  const above = (/** @type {number} */ t) => o[1] + d[1] * t - sampleHeight(hf, o[0] + d[0] * t, o[2] + d[2] * t);
  let prevT = t0;
  let prevA = above(t0);
  if (prevA < 0) return { hit: true, point: [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0], t: t0 };
  for (let t = t0 + step; t <= t1 + step; t += step) {
    const tc = Math.min(t, t1);
    const a = above(tc);
    if (a <= 0) {
      let lo2 = prevT;
      let hi2 = tc;
      for (let i = 0; i < 16; i++) {
        const mid = (lo2 + hi2) / 2;
        if (above(mid) > 0) lo2 = mid; else hi2 = mid;
      }
      const th = (lo2 + hi2) / 2;
      return { hit: true, point: [o[0] + d[0] * th, o[1] + d[1] * th, o[2] + d[2] * th], t: th };
    }
    prevT = tc;
    prevA = a;
    if (tc >= t1) break;
  }
  return { hit: false, point: [0, 0, 0], t: 0 };
}
