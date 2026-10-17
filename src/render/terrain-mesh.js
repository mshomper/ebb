// @ts-check
// Shared terrain mesh pieces (docs/04): index buffers for the chunk grid LODs, and packing of
// per-chunk draw records. Used by the opaque terrain pass and the shadow pass, so both draw the
// same surface. Vertex positions come from lib-terrain.wgsl terrainMeshVertex().

import { makeBuffer } from '../core/gpu.js';
import { CHUNK_CELLS, CHUNK_MIN } from '../world/terrain/grid.js';

/** Quads per chunk side for each LOD. */
export const LODS = [128, 64, 32];
export const MAX_CHUNKS = 36;

/**
 * Index list for one chunk grid of n quads a side, plus skirts on all four edges.
 * Vertex ids follow terrainMeshVertex: grid vertices first (row-major), then four edges of skirt vertices.
 * @param {number} n
 */
export function buildIndices(n) {
  const row = n + 1;
  const grid = (/** @type {number} */ i, /** @type {number} */ j) => j * row + i;
  const edgeVertex = [
    (/** @type {number} */ t) => grid(t, 0),
    (/** @type {number} */ t) => grid(n, t),
    (/** @type {number} */ t) => grid(t, n),
    (/** @type {number} */ t) => grid(0, t),
  ];
  const out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = grid(i, j), b = grid(i + 1, j), c = grid(i, j + 1), d = grid(i + 1, j + 1);
      out.push(a, c, b, b, c, d);
    }
  }
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < n; t++) {
      const a = edgeVertex[e](t), b = edgeVertex[e](t + 1);
      const sa = row * row + e * row + t, sb = sa + 1;
      out.push(a, sa, b, b, sa, sb);
    }
  }
  return new Uint16Array(out);
}

/**
 * One index buffer per LOD.
 * @param {GPUDevice} device
 * @returns {{ buffer: GPUBuffer, count: number }[]}
 */
export function createIndexBuffers(device) {
  return LODS.map((n) => {
    const idx = buildIndices(n);
    // 6n^2 + 24n indices is always even, so the byte length is a multiple of 4 as writeBuffer needs.
    const buffer = makeBuffer(device, { label: `terrain-index-${n}`, size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, idx);
    return { buffer, count: idx.length };
  });
}

/**
 * Pack chunk records grouped by LOD, so each LOD is one instanced draw.
 * @param {Float32Array} out  MAX_CHUNKS * 4 floats
 * @param {number[][]} byLod  per LOD, a flat list cx0, cz0, cx1, cz1 ...
 * @returns {{ lod: number, first: number, count: number }[]}
 */
export function packChunks(out, byLod) {
  let k = 0;
  /** @type {{ lod: number, first: number, count: number }[]} */
  const draws = [];
  byLod.forEach((list, lod) => {
    const first = k;
    for (let i = 0; i < list.length; i += 2) {
      out[k * 4] = (list[i] - CHUNK_MIN) * CHUNK_CELLS;
      out[k * 4 + 1] = (list[i + 1] - CHUNK_MIN) * CHUNK_CELLS;
      out[k * 4 + 2] = CHUNK_CELLS / LODS[lod];
      out[k * 4 + 3] = LODS[lod];
      k++;
    }
    if (k > first) draws.push({ lod, first, count: k - first });
  });
  return draws;
}
