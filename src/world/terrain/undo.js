// @ts-check
// Undo tiles for terrain strokes (docs/08, Undo and redo). Before a stroke first touches an
// 8 m tile, its quantized heights and materials are copied from the CPU mirror; after the
// stroke settles, the same tiles are copied again for redo. The mirror is exact between
// strokes, so CPU copies are enough and the GPU never stalls.

import { WORLD_CELLS as N, TILE_CELLS as T, WORLD_ORIGIN, CELL, dequantize } from './grid.js';

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
 * A ground height sampler (m) over a set of tiles (a stroke's before or after copies): the height
 * of the 0.25 m cell under a point, read from the tile that holds it, or `fallback` where no tile
 * does (ground the stroke never touched). docs/future/13 5.7: burying reads a stroke's raise.
 * @param {Tile[]} tiles @param {(x: number, z: number) => number} fallback
 * @returns {(x: number, z: number) => number}
 */
export function heightFromTiles(tiles, fallback) {
  /** @type {Map<number, Tile>} */ const byId = new Map(tiles.map((t) => [tileId(t.tx, t.tz), t]));
  return (x, z) => {
    const i = Math.floor((x - WORLD_ORIGIN) / CELL), j = Math.floor((z - WORLD_ORIGIN) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return fallback(x, z);
    const t = byId.get(tileId(Math.floor(i / T), Math.floor(j / T)));
    if (!t) return fallback(x, z);
    return dequantize(t.h[(j % T) * T + (i % T)]);
  };
}

/** The world rect (m) a set of tiles covers. @param {Tile[]} tiles */
export function tilesArea(tiles) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const t of tiles) {
    x0 = Math.min(x0, WORLD_ORIGIN + t.tx * T * CELL); x1 = Math.max(x1, WORLD_ORIGIN + (t.tx + 1) * T * CELL);
    z0 = Math.min(z0, WORLD_ORIGIN + t.tz * T * CELL); z1 = Math.max(z1, WORLD_ORIGIN + (t.tz + 1) * T * CELL);
  }
  return { x0, z0, x1, z1 };
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
