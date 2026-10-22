// @ts-check
// The walk grid (doc 23, the walker; W1): the ground the walker may stand on, in cells of
// grid.cellM meters over the open land. Each cell keeps its ground height and whether it is too
// steep to stand on (slope past maxSlopeDeg). Water is not stored: the tide and the ponds change
// all the time, so the path finder asks how deep the water is right now (path.js). Rebuilt for a
// rectangle after a stroke. Stepping stones and Steps' slabs (src/world/pieces) are footing: a
// cell stands on their tops, never steep. Pure: safe to import from tools pages and tests.

/**
 * @typedef {Object} WalkGrid
 * @property {number} cellM
 * @property {number} w cells across (x)
 * @property {number} h cells down (z)
 * @property {number} minX world x of the first cell's edge
 * @property {number} minZ world z of the first cell's edge
 * @property {Float32Array} height ground at each cell's center (m)
 * @property {Uint8Array} steep 1 where the ground is too steep to stand on
 * @property {(x: number, z: number) => number} cellAt index of the cell under a point, or -1 off the grid
 * @property {(k: number) => [number, number]} center world x, z of a cell's center
 * @property {(x0: number, z0: number, x1: number, z1: number) => void} refresh re-read the ground in a rectangle
 */

/**
 * @param {{ ground: (x: number, z: number) => number, minX: number, minZ: number, maxX: number, maxZ: number,
 *   cellM: number, maxSlopeDeg: number, footing?: (x: number, z: number) => number }} o
 *   ground: the height of the land (m); the rectangle is the open land, in world meters;
 *   footing: the top of a stone or slab there (m), -Infinity where there is none
 * @returns {WalkGrid}
 */
export function createWalkGrid(o) {
  const { cellM } = o;
  const w = Math.max(1, Math.round((o.maxX - o.minX) / cellM));
  const h = Math.max(1, Math.round((o.maxZ - o.minZ) / cellM));
  const height = new Float32Array(w * h);
  const steep = new Uint8Array(w * h);
  /** 1 where a stone or slab stands over the ground: it sits level while the bed drops away. */
  const onFooting = new Uint8Array(w * h);
  const maxGrad = Math.tan((o.maxSlopeDeg * Math.PI) / 180);

  /** @param {number} k @returns {[number, number]} */
  const center = (k) => [o.minX + ((k % w) + 0.5) * cellM, o.minZ + (Math.floor(k / w) + 0.5) * cellM];

  /** @param {number} i0 @param {number} j0 @param {number} i1 @param {number} j1 inclusive cell bounds */
  function read(i0, j0, i1, j1) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [x, z] = center(j * w + i);
      const g = o.ground(x, z), f = o.footing ? o.footing(x, z) : -Infinity;
      height[j * w + i] = Math.max(g, f);
      onFooting[j * w + i] = f > g + 0.01 ? 1 : 0;
    }
    // Slope from the ground a cell either side (one more ring, so edges see their new neighbours).
    for (let j = Math.max(0, j0 - 1); j <= Math.min(h - 1, j1 + 1); j++) for (let i = Math.max(0, i0 - 1); i <= Math.min(w - 1, i1 + 1); i++) {
      const k = j * w + i;
      const hx0 = height[j * w + Math.max(0, i - 1)], hx1 = height[j * w + Math.min(w - 1, i + 1)];
      const hz0 = height[Math.max(0, j - 1) * w + i], hz1 = height[Math.min(h - 1, j + 1) * w + i];
      const gx = (hx1 - hx0) / (cellM * ((i > 0 ? 1 : 0) + (i < w - 1 ? 1 : 0) || 1));
      const gz = (hz1 - hz0) / (cellM * ((j > 0 ? 1 : 0) + (j < h - 1 ? 1 : 0) || 1));
      steep[k] = !onFooting[k] && Math.hypot(gx, gz) > maxGrad ? 1 : 0;
    }
  }
  read(0, 0, w - 1, h - 1);

  return {
    cellM, w, h, minX: o.minX, minZ: o.minZ, height, steep, center,
    cellAt(x, z) {
      const i = Math.floor((x - o.minX) / cellM), j = Math.floor((z - o.minZ) / cellM);
      return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i;
    },
    refresh(x0, z0, x1, z1) {
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - o.minX) / cellM) - 1);
      const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - o.minZ) / cellM) - 1);
      const i1 = Math.min(w - 1, Math.floor((Math.max(x0, x1) - o.minX) / cellM) + 1);
      const j1 = Math.min(h - 1, Math.floor((Math.max(z0, z1) - o.minZ) / cellM) + 1);
      if (i0 <= i1 && j0 <= j1) read(i0, j0, i1, j1);
    },
  };
}
