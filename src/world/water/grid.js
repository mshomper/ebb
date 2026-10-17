// @ts-check
// Water grid constants (docs/07). 0.5 m cells over the same 192 m window as the terrain, so one
// water cell covers 2 x 2 terrain cells. Mirrors src/shaders/lib-water.wgsl. Pure.

import { CELL as TERRAIN_CELL, WORLD_CELLS as TERRAIN_CELLS, WORLD_ORIGIN } from '../terrain/grid.js';

/** Meters per water cell. */
export const WATER_CELL = TERRAIN_CELL * 2;
/** Water cells per window side (384). */
export const WATER_CELLS = TERRAIN_CELLS / 2;
/** World x and z of the grid's first cell edge. */
export const WATER_ORIGIN = WORLD_ORIGIN;

/** World x or z to the index of the water cell containing it. @param {number} v */
export const waterCellOf = (v) => Math.floor((v - WATER_ORIGIN) / WATER_CELL);

/** World x or z of the center of water cell i. @param {number} i */
export const waterCellCenter = (i) => WATER_ORIGIN + (i + 0.5) * WATER_CELL;

/**
 * Simulated rect in water cells for the opened chunks' bounds (meters), clamped to the grid.
 * @param {{ openMin: number[], openMax: number[] }} b
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function rectForBounds(b) {
  const x0 = Math.max(0, waterCellOf(b.openMin[0]));
  const y0 = Math.max(0, waterCellOf(b.openMin[1]));
  const x1 = Math.min(WATER_CELLS, Math.ceil((b.openMax[0] - WATER_ORIGIN) / WATER_CELL));
  const y1 = Math.min(WATER_CELLS, Math.ceil((b.openMax[1] - WATER_ORIGIN) / WATER_CELL));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
