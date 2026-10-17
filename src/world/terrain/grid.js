// @ts-check
// Shared terrain grid constants and height quantization (docs/08).
// Pure: safe to import from workers, tools pages and tests.

/** Cell size in meters (4 cells per meter). */
export const CELL = 0.25;
/** Cells per chunk side. */
export const CHUNK_CELLS = 128;
/** Chunk side in meters. */
export const CHUNK_SIZE = CHUNK_CELLS * CELL;
/** Chunk index range of the fixed 6 x 6 world window. */
export const CHUNK_MIN = -2;
export const CHUNK_MAX = 3;
/** Cells per side of the whole window (768). */
export const WORLD_CELLS = (CHUNK_MAX - CHUNK_MIN + 1) * CHUNK_CELLS;
/** World x (and z) of the window's first cell edge: chunk -2 starts at 32 * -2 - 16 = -80 m. */
export const WORLD_ORIGIN = CHUNK_SIZE * CHUNK_MIN - CHUNK_SIZE / 2;
/** Height range in meters around mean sea level. */
export const H_MIN = -4;
export const H_MAX = 12;
export const H_RANGE = H_MAX - H_MIN;
/** Undo tiles are 8 m (32 cells) square. */
export const TILE_CELLS = 32;

/**
 * Height in meters to a 16-bit step: q = round((h + 4) / 16 * 65535).
 * @param {number} h
 * @returns {number}
 */
export function quantize(h) {
  const q = Math.round(((h - H_MIN) / H_RANGE) * 65535);
  return q < 0 ? 0 : q > 65535 ? 65535 : q;
}

/**
 * 16-bit step back to meters.
 * @param {number} q
 * @returns {number}
 */
export function dequantize(q) {
  return H_MIN + (q * H_RANGE) / 65535;
}

/** @param {number} cx @param {number} cz */
export const chunkKey = (cx, cz) => `${cx},${cz}`;

/**
 * Window cell index of a chunk's first cell along one axis.
 * @param {number} c chunk index
 */
export function chunkFirstCell(c) {
  return (c - CHUNK_MIN) * CHUNK_CELLS;
}

/**
 * World coordinate of the center of window cell i along one axis.
 * @param {number} i
 */
export function cellCenter(i) {
  return WORLD_ORIGIN + (i + 0.5) * CELL;
}
