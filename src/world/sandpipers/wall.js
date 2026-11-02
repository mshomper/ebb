// @ts-check
// Where the purple sandpipers feed and roost on their sea wall (B3 wave 3): spots of rock on the
// wall the S0 check found (src/world/ecology/shaped.js wallsOf), and the squares beside it, so the
// wall's top is in. A spot counts while it stands out of the water by aboveM and is not too steep
// to stand on, so the wet foot comes and goes with the tide and at high tide only the top is left
// (where the shared flock life roosts: the highest spot). Pure.

import { HABITAT_ORIGIN } from '../growth/habitat.js';

/**
 * The longest wall that meets the home's need, else the longest of all, with its cells, or null.
 * @param {any} report the shaped report (walls and _cells.walls in the same order) @param {{ need?: { lengthM?: number } }} [H]
 * @returns {{ wall: any, cells: number[] } | null}
 */
export function wallOf(report, H) {
  const walls = report?.walls ?? [], cells = report?._cells?.walls ?? [];
  if (!walls.length) return null;
  const want = H?.need?.lengthM ?? 0;
  let i = walls.findIndex((/** @type {any} */ w) => w.lengthM >= want);
  if (i < 0) i = 0;
  return { wall: walls[i], cells: cells[i] ?? [] };
}

/**
 * Spots on a wall now: perCell x perCell points in each wall square and each square beside one,
 * kept where the rock stands aboveM[0]..aboveM[1] out of the sea and slopes no more than
 * maxSlopeDeg. In a fixed order, so the same wall and tide give the same spots.
 * @param {number[]} cells habitat squares of the wall @param {number} n the habitat grid's side
 * @param {(x: number, z: number) => number} ground @param {number} tide
 * @param {{ aboveM: number[], maxSlopeDeg: number, perCell: number }} W recipe life.wall
 * @returns {{ x: number, z: number, y: number }[]}
 */
export function wallSpots(cells, n, ground, tide, W) {
  const near = new Set();
  for (const k of cells) {
    const i = k % n, j = Math.floor(k / n);
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const ii = i + a, jj = j + b;
      if (ii >= 0 && jj >= 0 && ii < n && jj < n) near.add(jj * n + ii);
    }
  }
  const maxRise = Math.tan(W.maxSlopeDeg * Math.PI / 180), e = 0.15;
  /** @type {{ x: number, z: number, y: number }[]} */ const out = [];
  for (const k of [...near].sort((a, b) => a - b)) {
    const x0 = HABITAT_ORIGIN + (k % n), z0 = HABITAT_ORIGIN + Math.floor(k / n);
    for (let v = 0; v < W.perCell; v++) for (let u = 0; u < W.perCell; u++) {
      const x = x0 + (u + 0.5) / W.perCell, z = z0 + (v + 0.5) / W.perCell;
      const y = ground(x, z), g = y - tide;
      if (g < W.aboveM[0] || g > W.aboveM[1]) continue;
      const sx = (ground(x + e, z) - ground(x - e, z)) / (2 * e), sz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
      if (Math.hypot(sx, sz) > maxRise) continue;
      out.push({ x, z, y });
    }
  }
  return out;
}
