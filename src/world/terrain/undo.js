// @ts-check
// Undo tiles for terrain strokes (docs/08, Undo and redo). Before a stroke first touches an
// 8 m tile, its quantized heights and materials are copied from the CPU mirror; after the
// stroke settles, the same tiles are copied again for redo. The mirror is exact between
// strokes, so CPU copies are enough and the GPU never stalls.

import { WORLD_CELLS as N, TILE_CELLS as T } from './grid.js';

/** Tiles per window side (24). */
export const TILES = N / T;

/**
 * @typedef {Object} Tile
 * @property {number} tx
 * @property {number} tz
 * @property {Uint16Array} h   T*T quantized heights
 * @property {Uint8Array} m    T*T*4 material weights
 */

/** Bytes held by one tile copy. */
export const TILE_BYTES = T * T * 2 + T * T * 4;

/** @param {number} tx @param {number} tz */
export const tileId = (tx, tz) => tz * TILES + tx;

/**
 * Ids of every tile that a cell rect overlaps.
 * @param {import('./heightfield.js').CellRect} r
 * @returns {number[]}
 */
export function tilesOf(r) {
  const ids = [];
  const x0 = Math.floor(r.x / T);
  const z0 = Math.floor(r.y / T);
  const x1 = Math.floor((r.x + r.w - 1) / T);
  const z1 = Math.floor((r.y + r.h - 1) / T);
  for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) ids.push(tileId(tx, tz));
  return ids;
}

/**
 * Copy tiles out of the mirror.
 * @param {import('./heightfield.js').Mirror} mirror
 * @param {number[]} ids
 * @returns {Tile[]}
 */
export function copyTiles(mirror, ids) {
  return ids.map((id) => {
    const tx = id % TILES;
    const tz = Math.floor(id / TILES);
    const h = new Uint16Array(T * T);
    const m = new Uint8Array(T * T * 4);
    for (let j = 0; j < T; j++) {
      const k = (tz * T + j) * N + tx * T;
      h.set(mirror.heightQ.subarray(k, k + T), j * T);
      m.set(mirror.material.subarray(k * 4, (k + T) * 4), j * T * 4);
    }
    return { tx, tz, h, m };
  });
}

/**
 * Write tiles back into the mirror's quantized heights and materials.
 * @param {import('./heightfield.js').Mirror} mirror
 * @param {Tile[]} tiles
 * @returns {import('./heightfield.js').CellRect} bounding rect of the tiles
 */
export function pasteTiles(mirror, tiles) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const t of tiles) {
    for (let j = 0; j < T; j++) {
      const k = (t.tz * T + j) * N + t.tx * T;
      mirror.heightQ.set(t.h.subarray(j * T, j * T + T), k);
      mirror.material.set(t.m.subarray(j * T * 4, (j * T + T) * 4), k * 4);
    }
    x0 = Math.min(x0, t.tx * T);
    z0 = Math.min(z0, t.tz * T);
    x1 = Math.max(x1, t.tx * T + T);
    z1 = Math.max(z1, t.tz * T + T);
  }
  return tiles.length ? { x: x0, y: z0, w: x1 - x0, h: z1 - z0 } : { x: 0, y: 0, w: 0, h: 0 };
}
