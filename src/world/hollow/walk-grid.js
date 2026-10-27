// @ts-check
// A Hollow floor's walk grid (H1, the floor maker; doc 16, How it is built): the ground the walker
// may stand on, read from the floor mesh's upward-facing surfaces. It has the island's walk grid
// interface (src/world/walk/grid.js), so the path finder (path.js), the arena and the game use it
// the same way: a height and a steep flag per cell, plus what a cave needs: which cells have a floor
// at all (under rock there is none), the water standing over each cell, and the room above it. Each
// cell stands on the lowest upward surface with headroom over it, so the top of a strut or a column
// under a high roof is never taken for the floor. Then a flood from the way in, with the path
// finder's own rules, says whether the way down is reachable. Pure and deterministic.

import { nearestOpen } from '../walk/path.js';
import { det } from '../../core/rng.js';

const SQRT2 = Math.SQRT2;
const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Surfaces kept per cell (up and down each); a cave column rarely crosses more. */
const SLOTS = 6;

/**
 * @typedef {import('../walk/grid.js').WalkGrid & { floor: Uint8Array, water: Float32Array, room: Float32Array }} HollowGrid
 *   floor: 1 where a cell has a floor; water: depth standing over it (m); room: headroom over it (m)
 */

/**
 * Build the walk grid from a floor mesh.
 * @param {{ vertices: Float32Array, indices: Uint32Array }} mesh 6 floats a vertex (position, normal)
 * @param {{ min: number[], n: number[], cellM: number }} bounds the field's sample grid
 * @param {any} dressed the dressed floor (its chambers' water) @param {any} W recipe floors.walk
 * @returns {HollowGrid}
 */
export function walkGridFromMesh(mesh, bounds, dressed, W) {
  const cellM = W.cellM;
  const minX = bounds.min[0], minZ = bounds.min[2];
  const w = Math.max(1, Math.floor(((bounds.n[0] - 1) * bounds.cellM) / cellM));
  const h = Math.max(1, Math.floor(((bounds.n[2] - 1) * bounds.cellM) / cellM));
  const N = w * h;
  const up = new Float32Array(N * SLOTS), upN = new Float32Array(N * SLOTS), upC = new Uint8Array(N);
  const dn = new Float32Array(N * SLOTS), dnC = new Uint8Array(N);
  const V = mesh.vertices, I = mesh.indices;

  // Every triangle drops its height onto the cell centres under it.
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 6, b = I[t + 1] * 6, c = I[t + 2] * 6;
    const ny = (V[a + 4] + V[b + 4] + V[c + 4]) / 3;
    const isUp = ny >= W.upY, isDown = ny <= -0.05;
    if (!isUp && !isDown) continue;
    const ax = V[a], az = V[a + 2], bx = V[b], bz = V[b + 2], cx = V[c], cz = V[c + 2];
    const area = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cellM - 0.5)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cellM - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cellM - 0.5)), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz, cz) - minZ) / cellM - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = minX + (i + 0.5) * cellM, pz = minZ + (j + 0.5) * cellM;
      const l0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / area;
      const l1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / area;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const y = l0 * V[a + 1] + l1 * V[b + 1] + l2 * V[c + 1];
      const k = j * w + i;
      if (isUp && upC[k] < SLOTS) { up[k * SLOTS + upC[k]] = y; upN[k * SLOTS + upC[k]] = ny; upC[k]++; }
      else if (isDown && dnC[k] < SLOTS) { dn[k * SLOTS + dnC[k]] = y; dnC[k]++; }
    }
  }

  // Each cell: the lowest upward surface with headroom under the rock above it.
  const height = new Float32Array(N), steep = new Uint8Array(N), floor = new Uint8Array(N), room = new Float32Array(N);
  const minNy = det.cos((W.maxSlopeDeg * det.PI) / 180);
  const faceNy = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let best = Infinity, bestN = 0, bestRoom = 0;
    for (let s = 0; s < upC[k]; s++) {
      const y = up[k * SLOTS + s];
      let roof = Infinity;
      for (let d = 0; d < dnC[k]; d++) { const r = dn[k * SLOTS + d]; if (r > y + 0.05 && r < roof) roof = r; }
      if (roof - y >= W.headroomM && y < best) { best = y; bestN = upN[k * SLOTS + s]; bestRoom = roof - y; }
    }
    if (best < Infinity) { height[k] = best; floor[k] = 1; faceNy[k] = bestN; room[k] = bestRoom; } else { steep[k] = 1; }
  }
  // Too steep: the surface itself, or the ground a cell either side (as grid.js), among floor cells.
  const maxGrad = det.sin((W.maxSlopeDeg * det.PI) / 180) / minNy;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (!floor[k]) continue;
    if (faceNy[k] < minNy) { steep[k] = 1; continue; }
    const hAt = (/** @type {number} */ ii, /** @type {number} */ jj) => {
      const q = jj * w + ii;
      return ii >= 0 && jj >= 0 && ii < w && jj < h && floor[q] && Math.abs(height[q] - height[k]) <= W.maxStepM ? height[q] : height[k];
    };
    const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cellM), gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cellM);
    if (Math.sqrt(gx * gx + gz * gz) > maxGrad) steep[k] = 1;
  }
  // Water standing in the chambers (puddles, the silt channel).
  const water = new Float32Array(N);
  for (const c of dressed.chambers) {
    if (!(c.waterY > -Infinity)) continue;
    const i0 = Math.max(0, Math.floor((c.x - c.reach - minX) / cellM)), i1 = Math.min(w - 1, Math.floor((c.x + c.reach - minX) / cellM));
    const j0 = Math.max(0, Math.floor((c.z - c.reach - minZ) / cellM)), j1 = Math.min(h - 1, Math.floor((c.z + c.reach - minZ) / cellM));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * w + i;
      if (floor[k] && height[k] < c.waterY) water[k] = Math.max(water[k], c.waterY - height[k]);
    }
  }

  return wrapGrid({ cellM, w, h, minX, minZ, height, steep, floor, water, room });
}

/**
 * The grid's interface round its arrays (a worker posts the arrays back; this restores the rest).
 * @param {{ cellM: number, w: number, h: number, minX: number, minZ: number, height: Float32Array, steep: Uint8Array,
 *   floor: Uint8Array, water: Float32Array, room: Float32Array, blocked?: Uint8Array }} a
 * @returns {HollowGrid}
 */
export function wrapGrid(a) {
  const { cellM, w, h, minX, minZ } = a;
  /** @param {number} k @returns {[number, number]} */
  const center = (k) => [minX + ((k % w) + 0.5) * cellM, minZ + (Math.floor(k / w) + 0.5) * cellM];
  return {
    cellM, w, h, minX, minZ, height: a.height, steep: a.steep, blocked: a.blocked ?? new Uint8Array(w * h), center, floor: a.floor, water: a.water, room: a.room,
    cellAt(x, z) {
      const i = Math.floor((x - minX) / cellM), j = Math.floor((z - minZ) / cellM);
      return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i;
    },
    // A floor never changes once made.
    refresh() {},
  };
}

/** The path finder's rules on a Hollow grid. @param {HollowGrid} g @param {any} W recipe floors.walk */
export function hollowRules(g, W) {
  return { depth: (/** @type {number} */ k) => g.water[k], wadeM: W.wadeM, wadeCost: 2, maxStepM: W.maxStepM, snapM: 3 };
}

/**
 * Can the walker get from the way in to the way down? A flood from the way in over open cells, by
 * the path finder's rules (steps no higher than maxStepM, no cut corners).
 * @param {HollowGrid} g @param {any} plan @param {any} W recipe floors.walk
 * @returns {{ ok: boolean, from: number, to: number, reached: Uint8Array, reachedShare: number, reason: string }}
 */
export function checkWalkable(g, plan, W) {
  const r = hollowRules(g, W);
  const open = (/** @type {number} */ k) => k >= 0 && !g.steep[k] && !g.blocked[k] && r.depth(k) < r.wadeM;
  const wayIn = plan.chambers[0], wayDown = plan.chambers.find((/** @type {any} */ c) => c.kind === 'down');
  const from = nearestOpen(g, r, wayIn.x, wayIn.z, r.snapM), to = nearestOpen(g, r, wayDown.x, wayDown.z, r.snapM);
  const reached = new Uint8Array(g.w * g.h);
  if (from < 0 || to < 0) return { ok: false, from, to, reached, reachedShare: 0, reason: from < 0 ? 'no floor at the way in' : 'no floor at the way down' };
  const queue = new Int32Array(g.w * g.h);
  let head = 0, tail = 0;
  queue[tail++] = from; reached[from] = 1;
  while (head < tail) {
    const k = queue[head++], i = k % g.w, j = Math.floor(k / g.w);
    for (const [di, dj] of NEIGH) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
      const nk = nj * g.w + ni;
      if (reached[nk] || !open(nk)) continue;
      const diag = di !== 0 && dj !== 0;
      if (diag && (!open(j * g.w + ni) || !open(nj * g.w + i))) continue;
      if (Math.abs(g.height[nk] - g.height[k]) > r.maxStepM * (diag ? SQRT2 : 1)) continue;
      reached[nk] = 1; queue[tail++] = nk;
    }
  }
  let openCount = 0;
  for (let k = 0; k < g.w * g.h; k++) if (open(k)) openCount++;
  const ok = reached[to] === 1;
  return { ok, from, to, reached, reachedShare: openCount ? tail / openCount : 0, reason: ok ? '' : 'the way down is cut off' };
}
