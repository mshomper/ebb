// @ts-check
// Starting water for the live simulation (docs/07): the sea at the current tide, plus hollows that
// would hold a pond, filled to their lip. Priority-Flood (Barnes, Lehman and Mulla 2014) from the
// rect's outer ring gives each cell the lowest level water can drain to. Visual only: the
// deterministic water summary that ecology reads arrives in S4b and will replace the pond rule here.

import { WATER_CELL, waterCellCenter } from './grid.js';
import { CELL as TERRAIN_CELL } from '../terrain/grid.js';

/**
 * Bed heights of a rect of water cells: the lowest of each cell's 2 x 2 terrain cells.
 * @param {(x: number, z: number) => number} sampleHeight  terrain height at a world point
 * @param {{ x: number, y: number, w: number, h: number }} r
 */
export function bedHeights(sampleHeight, r) {
  const bed = new Float32Array(r.w * r.h);
  const q = TERRAIN_CELL * 0.5;
  for (let j = 0; j < r.h; j++) {
    const z = waterCellCenter(r.y + j);
    for (let i = 0; i < r.w; i++) {
      const x = waterCellCenter(r.x + i);
      // Terrain cell centers sit a quarter cell either side of the water cell center.
      bed[j * r.w + i] = Math.min(
        sampleHeight(x - q, z - q), sampleHeight(x + q, z - q),
        sampleHeight(x - q, z + q), sampleHeight(x + q, z + q));
    }
  }
  return bed;
}

/** Binary min-heap of cell indices keyed by level. */
function createHeap() {
  /** @type {number[]} */ const keys = [];
  /** @type {number[]} */ const vals = [];
  return {
    get size() { return keys.length; },
    /** @param {number} k @param {number} v */
    push(k, v) {
      let i = keys.length;
      keys.push(k); vals.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= keys[i]) break;
        [keys[p], keys[i]] = [keys[i], keys[p]];
        [vals[p], vals[i]] = [vals[i], vals[p]];
        i = p;
      }
    },
    /** @returns {[number, number]} */
    pop() {
      const top = /** @type {[number, number]} */ ([keys[0], vals[0]]);
      const k = /** @type {number} */ (keys.pop());
      const v = /** @type {number} */ (vals.pop());
      if (keys.length > 0) {
        keys[0] = k; vals[0] = v;
        let i = 0;
        for (;;) {
          const a = 2 * i + 1, b = a + 1;
          let m = i;
          if (a < keys.length && keys[a] < keys[m]) m = a;
          if (b < keys.length && keys[b] < keys[m]) m = b;
          if (m === i) break;
          [keys[m], keys[i]] = [keys[i], keys[m]];
          [vals[m], vals[i]] = [vals[i], vals[m]];
          i = m;
        }
      }
      return top;
    },
  };
}

/**
 * Starting depths for a rect: sea up to `tide` where it connects to the rect's edge, and every
 * hollow at least `minDepth` deep and `minArea` square meters in size filled to its spill level.
 * @param {Float32Array} bed  from bedHeights
 * @param {{ w: number, h: number }} r
 * @param {{ tide: number, minDepth: number, minArea: number }} o
 * @returns {Float32Array} depth per cell (m)
 */
export function initialDepths(bed, r, o) {
  const { w, h } = r;
  const n = w * h;
  const level = new Float32Array(n);
  const seen = new Uint8Array(n);
  const heap = createHeap();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (i > 0 && j > 0 && i < w - 1 && j < h - 1) continue;
      const k = j * w + i;
      seen[k] = 1;
      level[k] = Math.max(bed[k], o.tide);
      heap.push(level[k], k);
    }
  }
  while (heap.size > 0) {
    const [lv, k] = heap.pop();
    const i = k % w, j = (k - i) / w;
    const nb = [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1];
    for (const q of nb) {
      if (q < 0 || seen[q]) continue;
      seen[q] = 1;
      level[q] = Math.max(bed[q], lv);
      heap.push(level[q], q);
    }
  }

  // Sea everywhere the fill level is the tide; ponds only where a hollow is big and deep enough.
  const depth = new Float32Array(n);
  const label = new Int32Array(n).fill(-1);
  const minCells = o.minArea / (WATER_CELL * WATER_CELL);
  const stack = [];
  for (let k = 0; k < n; k++) {
    const d = level[k] - bed[k];
    if (d <= 1e-4) continue;
    if (level[k] <= o.tide + 1e-4) { depth[k] = d; continue; }
    if (label[k] >= 0) continue;
    // One hollow: connected cells sharing this fill level.
    const members = [];
    let deepest = 0;
    label[k] = k;
    stack.push(k);
    while (stack.length) {
      const c = /** @type {number} */ (stack.pop());
      members.push(c);
      deepest = Math.max(deepest, level[c] - bed[c]);
      const i = c % w, j = (c - i) / w;
      const nb = [i > 0 ? c - 1 : -1, i < w - 1 ? c + 1 : -1, j > 0 ? c - w : -1, j < h - 1 ? c + w : -1];
      for (const q of nb) {
        if (q < 0 || label[q] >= 0 || level[q] - bed[q] <= 1e-4 || Math.abs(level[q] - level[k]) > 1e-5) continue;
        label[q] = k;
        stack.push(q);
      }
    }
    if (members.length >= minCells && deepest >= o.minDepth) {
      for (const c of members) depth[c] = level[c] - bed[c];
    }
  }
  return depth;
}
