// @ts-check
// The cove field (docs/future/12, keepsakes): how sheltered each cell of the shore is, 0 on an open
// coast to 255 deep in a bay or cove, so the things the sea leaves on the strandline can favour
// coves the player carved. From the water summary alone (its sea cells and its shore height), so it
// follows the land and nothing is saved.
//
// Method: from every shore cell (the tide band and the splash ground above it), cast `rays` rays
// round the compass. A ray first has to meet the sea (within `entryM` of dry shore, or it points
// inland and does not vote); then it runs over the sea for at most `reachM`. A ray that meets land
// after a run of water (at least ~1 m, so the shore's own edge does not count) is a hit, weighted
// from 1 right at the water down to `farWeight` at the edge of the reach; a ray that crosses the
// whole reach (or leaves the summary's rect, which is open sea) is open and scores 0. The cell's
// score is the weighted share of the voting rays, scaled by `gain`, and then one box smoothing pass
// over neighbouring shore cells. Integer steps and tables only (ray offsets come from `det`), so
// every device gets the same field. Pure and worker-safe.

import { WATER_CLASS } from './summary.js';
import { det } from '../../core/rng.js';

/** Cell edge in meters (the summary's grid). */
const CELL_M = 0.5;
/** A ray's water run must be at least this many cells before land counts as a hit. */
const MIN_RUN = 2;

/**
 * @typedef {Object} CoveRecipe  recipes/world/cove.json
 * @property {number} rays @property {number} reachM @property {number} entryM
 * @property {number} minSeawardRays @property {number} farWeight @property {number} gain
 * @property {number} smoothRadius
 */

/**
 * Per-ray step offsets: offset s of ray r is round(s cos a), round(s sin a) cells, for s = 1..n.
 * @param {number} rays @param {number} n
 * @returns {{ ox: Int16Array, oy: Int16Array }} rays x (n + 1), row r at r * (n + 1)
 */
function rayTables(rays, n) {
  const ox = new Int16Array(rays * (n + 1)), oy = new Int16Array(rays * (n + 1));
  for (let r = 0; r < rays; r++) {
    const a = ((r + 0.5) / rays) * 2 * det.PI, c = det.cos(a), s = det.sin(a);
    for (let k = 1; k <= n; k++) {
      ox[r * (n + 1) + k] = Math.round(k * c);
      oy[r * (n + 1) + k] = Math.round(k * s);
    }
  }
  return { ox, oy };
}

/**
 * How sheltered each shore cell is.
 * @param {{ rect: {x:number,y:number,w:number,h:number}, cls: Uint8Array, shore: Uint8Array }} summary
 *   the water summary (rect order, 0.5 m cells)
 * @param {CoveRecipe} recipe recipes/world/cove.json
 * @returns {Uint8Array} per summary cell: 0 open coast (and everywhere off the shore) .. 255 deeply sheltered
 */
export function coveField(summary, recipe) {
  const { rect, cls, shore } = summary;
  const w = rect.w, h = rect.h, n = w * h;
  const rays = Math.max(4, recipe.rays | 0);
  const reachSteps = Math.max(1, Math.round(recipe.reachM / CELL_M));
  const entrySteps = Math.max(0, Math.round(recipe.entryM / CELL_M));
  const maxS = entrySteps + reachSteps;
  const minVotes = Math.max(1, recipe.minSeawardRays | 0);
  const far = recipe.farWeight;
  const { ox, oy } = rayTables(rays, maxS);
  const stride = maxS + 1;
  const SEA = WATER_CLASS.sea;
  const scale = 255 * recipe.gain;

  // Raw scores, -1 where a cell is not scored (off the shore, or too few rays face the sea).
  const raw = new Float32Array(n).fill(-1);
  let count = 0;
  for (let k = 0; k < n; k++) if (shore[k]) count++;
  const active = new Int32Array(count);
  count = 0;
  for (let k = 0; k < n; k++) if (shore[k]) active[count++] = k;

  for (let a = 0; a < count; a++) {
    const k = active[a], i = k % w, j = (k - i) / w;
    // Cells under the sea (the band's lower part) take the nearest dry cell's score below: from
    // out in the water every ray toward the coast would count as a hit.
    if (cls[k] === SEA) continue;
    let votes = 0, sum = 0;
    for (let r = 0; r < rays; r++) {
      const base = r * stride;
      let entry = -1;
      for (let s = 1; s <= maxS; s++) {
        const x = i + ox[base + s], y = j + oy[base + s];
        if (x < 0 || y < 0 || x >= w || y >= h) { votes++; break; }   // out of the rect: open sea
        if (cls[y * w + x] === SEA) {
          if (entry < 0) entry = s;
          if (s - entry + 1 >= reachSteps) { votes++; break; }          // crossed the reach: open
        } else if (entry >= 0) {
          const run = s - entry;
          if (run >= MIN_RUN) { votes++; sum += far + (1 - far) * (1 - run / reachSteps); }
          break;
        } else if (s >= entrySteps) break;                              // points inland: no vote
      }
    }
    if (votes >= minVotes) raw[k] = sum / votes;
  }

  // One box pass over scored neighbours, then 0..255.
  const out = new Uint8Array(n);
  const R = Math.max(0, recipe.smoothRadius | 0);
  for (let a = 0; a < count; a++) {
    const k = active[a];
    if (raw[k] < 0) continue;   // under the sea, or not scored
    const i = k % w, j = (k - i) / w;
    let sum = 0, m = 0;
    if (R === 0) { sum = raw[k]; m = 1; } else {
      const j0 = Math.max(0, j - R), j1 = Math.min(h - 1, j + R), i0 = Math.max(0, i - R), i1 = Math.min(w - 1, i + R);
      for (let y = j0; y <= j1; y++) {
        for (let x = i0; x <= i1; x++) {
          const v = raw[y * w + x];
          if (v >= 0) { sum += v; m++; }
        }
      }
    }
    const v = Math.round((sum / m) * scale);
    out[k] = v > 255 ? 255 : v;
  }

  // The band's cells under the mean sea: the score of the nearest scored cell within seaFillM
  // (rings outward; the nearest in the first ring that has one, ties to the first in scan order).
  const F = Math.round((recipe.seaFillM ?? 0) / CELL_M);
  if (F > 0) {
    for (let a = 0; a < count; a++) {
      const k = active[a];
      if (cls[k] !== SEA) continue;
      const i = k % w, j = (k - i) / w;
      let best = -1, bestD = 1 << 30;
      for (let r = 1; r <= F && best < 0; r++) {
        for (let dy = -r; dy <= r; dy++) {
          const y = j + dy;
          if (y < 0 || y >= h) continue;
          const edgeRow = dy === -r || dy === r;
          for (let dx = -r; dx <= r; dx += edgeRow ? 1 : 2 * r) {
            const x = i + dx;
            if (x < 0 || x >= w) continue;
            const q = y * w + x;
            if (raw[q] < 0 || cls[q] === SEA) continue;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = q; }
          }
        }
      }
      if (best >= 0) out[k] = out[best];
    }
  }
  return out;
}
