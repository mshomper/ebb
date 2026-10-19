// @ts-check
// Frog habitat on the 1 m grid (docs 11, 12): the five needs, scored 0..1 per square, and the
// mood they make (a weighted geometric mean, so one missing need pulls it down hard). The habitat
// score of a square is that mood with the frogs' ideal group around it. Also the pond's edge: the
// bank squares beside still water or a damp hollow, where frogs make their homes, with how many
// meters of shore each square has. Pure and worker-safe; det math for log and exp.

import { det } from '../../core/rng.js';
import { chamfer, HABITAT_ORIGIN } from '../growth/habitat.js';
import { openBox, sat, boxSum, boxMax, plantField, smooth } from './fields.js';

/** The needs, in the order they are weighed. */
export const NEEDS = Object.freeze(['water', 'food', 'shelter', 'quiet', 'company']);

/** Square edges overcount a smooth shore by about 4 / pi. */
const FACE_M = 0.7853981633974483;

/**
 * Mood from the five need scores: exp(sum of w log max(s, 0.01)).
 * @param {Record<string, number>} s need scores 0..1 @param {any} needs the recipe's needs
 */
export function moodOf(s, needs) {
  let sum = 0;
  for (const key of NEEDS) sum += needs[key].w * det.log(Math.max(s[key], 0.01));
  return det.exp(sum);
}

/**
 * Company for a frog with `count` frogs (itself included) within reach: a lone frog scores
 * `alone`, full from n[0] to n[2], falling toward `crowded` beyond.
 * @param {number} count @param {any} C the recipe's company need
 */
export function companyOf(count, C) {
  const [lo, , hi] = C.n;
  if (count < lo) return C.alone + ((1 - C.alone) * Math.max(0, count - 1)) / Math.max(1, lo - 1);
  if (count <= hi) return 1;
  return Math.max(C.crowded, 1 - ((1 - C.crowded) * (count - hi)) / hi);
}

/**
 * Food: the midges summed over the forage square around (i, j), against what a group needs.
 * @param {Uint8Array | null} midges @param {number} n @param {number} i @param {number} j @param {any} food the recipe's food need @param {number} group
 */
export function foodAt(midges, n, i, j, food, group) {
  if (!midges) return 0;
  const r = Math.round(food.radiusM);
  let s = 0;
  for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) {
    for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) s += midges[b * n + a];
  }
  const f = s / 255 / (food.perFrog * group);
  return f > 1 ? 1 : f;
}

/**
 * Every need and the habitat score per square, and the pond's edge.
 * @param {any} hab the habitat grid @param {any} growth state.growth @param {Uint8Array | null} midges the midge field
 * @param {any} rec recipes/species/frog.json
 * @returns {{ score: Float32Array, water: Float32Array, food: Float32Array, shelter: Float32Array,
 *   edge: { cells: number[], faces: number[] } }}  edge: bank squares and how many of their sides face the water
 */
export function frogNeeds(hab, growth, midges, rec) {
  const E = rec.ecology, N = E.needs;
  const n = hab.n;
  const box = openBox(hab, 1);
  // The pond (still fresh water standing at mean tide; a damp hollow is wet ground, not a shore),
  // and good water: still water of the right depth, or a damp hollow.
  const pond = new Uint8Array(n * n), good = new Uint8Array(n * n);
  const lo = N.water.depthM[0] * 100, hi = N.water.depthM[1] * 100;
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (!hab.open[k] || hab.sea[k] || !hab.still[k]) continue;
      const d = hab.depthCm[k];
      if (d > 0) pond[k] = 1;
      if (d === 0 || (d >= lo && d <= hi)) good[k] = 1;
    }
  }
  // A shore is the edge of a pond of some size: a spring's little pool or a puddle is water to
  // drink and hunt by, but not a shore frogs settle along.
  dropSmallBodies(pond, n, box, E.edge.minPondM2);
  const dGood = chamfer(good, n, 3 * 64);
  const cover = boxMax(plantField(hab, growth, N.shelter.cover, true), n, Math.round(N.shelter.radiusM), box);
  const M = midges ? sat(midges, n, 1 / 255) : null;
  const rf = Math.round(N.food.radiusM);
  const ideal = N.company.n[1];

  const score = new Float32Array(n * n), water = new Float32Array(n * n);
  const food = new Float32Array(n * n), shelter = new Float32Array(n * n);
  /** @type {number[]} */ const cells = [];
  /** @type {number[]} */ const faces = [];
  const shallow = E.scored.shallowCm;
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * n + i;
      if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > shallow) continue;
      const w = 1 - smooth(dGood[k] / 3, N.water.okM, N.water.maxM);
      if (w <= 0) continue;
      const f = M ? Math.min(1, boxSum(M, n, i, j, rf) / (N.food.perFrog * ideal)) : 0;
      const s = smooth(cover[k], N.shelter.from, N.shelter.full);
      water[k] = w; food[k] = f; shelter[k] = s;
      score[k] = moodOf({ water: w, food: f, shelter: s, quiet: 1, company: 1 }, N);
      // A bank square: ground with no standing water (damp counts) with the pond on one of its sides.
      if (hab.depthCm[k] > 0) continue;
      let sides = 0;
      if (i > 0 && pond[k - 1]) sides++;
      if (i < n - 1 && pond[k + 1]) sides++;
      if (j > 0 && pond[k - n]) sides++;
      if (j < n - 1 && pond[k + n]) sides++;
      if (sides) { cells.push(k); faces.push(sides); }
    }
  }
  return { score, water, food, shelter, edge: { cells, faces } };
}

/**
 * Clear the bodies of water (four-connected squares) smaller than minM2 from a pond mask.
 * @param {Uint8Array} pond 1 in the pond (changed in place) @param {number} n @param {import('./fields.js').Box} box @param {number} minM2
 */
function dropSmallBodies(pond, n, box, minM2) {
  if (!minM2) return;
  const seen = new Uint8Array(n * n);
  /** @type {number[]} */ const body = [];
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k0 = j * n + i;
      if (!pond[k0] || seen[k0]) continue;
      body.length = 0;
      const stack = [k0];
      seen[k0] = 1;
      while (stack.length) {
        const k = /** @type {number} */ (stack.pop());
        body.push(k);
        const a = k % n;
        for (const q of [a > 0 ? k - 1 : -1, a < n - 1 ? k + 1 : -1, k - n, k + n]) {
          if (q >= 0 && q < n * n && pond[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      if (body.length < minM2) for (const k of body) pond[k] = 0;
    }
  }
}

/**
 * Meters of shore a bank square stands on.
 * @param {number} sides how many of its sides face the water
 */
export const shoreM = (sides) => sides * FACE_M;

/**
 * Good edge: the bank squares scoring at least goodScore, their meters of shore, and how many
 * frogs the island holds (one per metresPerFrog of it). Also the best bank square.
 * @param {{ cells: number[], faces: number[] }} edge @param {ArrayLike<number>} score 0..255 per square
 * @param {any} E the recipe's ecology block
 */
export function goodEdge(edge, score, E) {
  const at = 255 * E.edge.goodScore;
  let metres = 0, best = -1, bestScore = -1;
  for (let e = 0; e < edge.cells.length; e++) {
    const k = edge.cells[e], s = score[k];
    if (s > bestScore || (s === bestScore && k < best)) { bestScore = s; best = k; }
    if (s >= at) metres += shoreM(edge.faces[e]);
  }
  return { metres, capacity: Math.floor(metres / E.edge.metresPerFrog), best, bestScore: bestScore < 0 ? 0 : bestScore / 255 };
}

/** World x, z at the middle of a square. @param {number} k @param {number} n */
export const cellCenter = (k, n) => [HABITAT_ORIGIN + (k % n) + 0.5, HABITAT_ORIGIN + Math.floor(k / n) + 0.5];
