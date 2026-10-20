// @ts-check
// The habitat grid (docs 10, 11): three numbers per square meter that plants choose their place by,
// on the 1 m world grid (192 x 192 cells from -80 m, aligned with the water summary's ecology
// aggregate). Pure and worker-safe; integers only, so it is the same on every machine.
//   depthCm   standing fresh water at mean tide (ponds and streams); 0 elsewhere
//   moisture  0..255: 255 in water and damp hollows, the tide band wet, falling away with distance
//             from fresh water (bankM), so banks are moist and dry ground is dry
//   salt      0..255: 255 in the sea, high in the tide band, falling over saltM inland
//   still     1 where the water is still (ponds, damp), 0 in streams and the sea
//   sea       1 in the sea
//   grass     0..255: the painted grass share (mean over the cell's 16 terrain texels)
//   open      1 inside the water summary's area (the opened island); nothing grows outside it
// Built from the water summary (rebuilt after every sculpt) and the terrain's painted materials.

import { WATER_CLASS } from '../water/summary.js';
import { H_MIN, H_RANGE } from '../terrain/grid.js';
import { det } from '../../core/rng.js';

/** Habitat cells per side and their size (m); cell (i, j) spans x = -80 + i .. -80 + i + 1. */
export const HABITAT_CELLS = 192;
export const HABITAT_ORIGIN = -80;

/**
 * @typedef {Object} Habitat
 * @property {number} n           cells per side
 * @property {Uint8Array} depthCm @property {Uint8Array} moisture @property {Uint8Array} salt
 * @property {Uint8Array} still   @property {Uint8Array} sea      @property {Uint8Array} grass
 * @property {Uint8Array} open
 * @property {Uint8Array} [band]  1 in the tide band (wetted between low and high tide)
 * @property {Uint8Array} [sand] @property {Uint8Array} [rock] @property {Uint8Array} [soil]  painted shares 0..255
 * @property {Uint8Array} [slopeDeg]  ground slope in degrees (0 where no heights were given)
 * @property {Int16Array} [heightDm]  ground height above mean sea level, decimeters (only where heights were given)
 * @property {Uint8Array} [shapedCm]  how far the player moved the ground there, cm, 0..255 (0 where no generated heights were given)
 * @property {number} hash        FNV-1a over the arrays (uint32), for the determinism page
 */

/**
 * Chamfer distance (3-4 weights, in thirds of a cell) from every cell to the nearest source cell,
 * two passes. Integers only. Sources have distance 0; the result is capped at `cap`. Also used by
 * the ecology step (world/ecology).
 * @param {Uint8Array} src 1 where a source @param {number} n @param {number} cap
 */
export function chamfer(src, n, cap) {
  const d = new Uint16Array(n * n);
  for (let k = 0; k < d.length; k++) d[k] = src[k] ? 0 : cap;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 3);
      if (j > 0) {
        v = Math.min(v, d[k - n] + 3);
        if (i > 0) v = Math.min(v, d[k - n - 1] + 4);
        if (i < n - 1) v = Math.min(v, d[k - n + 1] + 4);
      }
      d[k] = v;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + 3);
      if (j < n - 1) {
        v = Math.min(v, d[k + n] + 3);
        if (i < n - 1) v = Math.min(v, d[k + n + 1] + 4);
        if (i > 0) v = Math.min(v, d[k + n - 1] + 4);
      }
      d[k] = v;
    }
  }
  return d;
}

/**
 * Falloff over a distance in thirds of a cell: 255 at 0, 0 at `reachM`, smooth (integer).
 * @param {number} d @param {number} reachM
 */
function falloff(d, reachM) {
  const r = reachM * 3;
  if (d >= r) return 0;
  const t = r - d;                         // 0..r
  return Math.floor((255 * t * t) / (r * r));
}

/**
 * @param {{ eco: { x: number, y: number, w: number, h: number, depthCm: Uint8Array, cls: Uint8Array, band: Uint8Array },
 *   material: Uint8Array, materialCells: number, params: { bankM: number, saltM: number, bandMoisture: number, bandSalt: number },
 *   heightQ?: Uint16Array | null, baseQ?: Uint16Array | null }} args
 *   eco: the water summary's 1 m aggregate; material: the terrain mirror's painted weights (rgba8 per
 *   0.25 m texel, grass first) over materialCells x materialCells; params: recipes/flora/habitat in
 *   the growth recipe; heightQ: the terrain heights (same grid as material), for the slope and
 *   height axes; baseQ: the heights as the island was generated, before any edit, for shapedCm
 * @returns {Habitat}
 */
export function buildHabitat(args) {
  const N = HABITAT_CELLS;
  const { eco, params } = args;
  const depthCm = new Uint8Array(N * N);
  const moisture = new Uint8Array(N * N);
  const salt = new Uint8Array(N * N);
  const still = new Uint8Array(N * N);
  const sea = new Uint8Array(N * N);
  const grass = new Uint8Array(N * N);
  const open = new Uint8Array(N * N);
  const fresh = new Uint8Array(N * N);   // fresh water or damp: the bank's source
  const salty = new Uint8Array(N * N);   // sea or tide band
  const band = new Uint8Array(N * N);

  for (let b = 0; b < eco.h; b++) {
    for (let a = 0; a < eco.w; a++) {
      const i = eco.x + a, j = eco.y + b;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const e = b * eco.w + a, k = j * N + i;
      open[k] = 1;
      const c = eco.cls[e];
      if (c === WATER_CLASS.sea) { sea[k] = 1; salty[k] = 1; }
      else if (c === WATER_CLASS.still || c === WATER_CLASS.slow || c === WATER_CLASS.running) {
        fresh[k] = 1; depthCm[k] = eco.depthCm[e];
        if (c === WATER_CLASS.still) still[k] = 1;
      } else if (c === WATER_CLASS.damp) { fresh[k] = 1; still[k] = 1; }
      if (eco.band[e]) { band[k] = 1; salty[k] = 1; }
    }
  }

  const dFresh = chamfer(fresh, N, 3 * 64);
  const dSalt = chamfer(salty, N, 3 * 64);
  for (let k = 0; k < N * N; k++) {
    let m = falloff(dFresh[k], params.bankM);
    if (band[k]) m = Math.max(m, params.bandMoisture);
    if (sea[k]) m = 255;
    moisture[k] = m;
    let s = falloff(dSalt[k], params.saltM);
    if (band[k]) s = Math.max(s, params.bandSalt);
    if (sea[k]) s = 255;
    salt[k] = s;
  }

  // Painted ground: the mean of the cell's 4 x 4 terrain texels (0.25 m) for each of grass, sand,
  // rock and soil. Sand, rock and soil serve the ground-type axes (docs/future/10).
  const M = args.materialCells;
  const per = Math.floor(M / N);
  const sand = new Uint8Array(N * N), rock = new Uint8Array(N * N), soil = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let g = 0, sa = 0, ro = 0, so = 0;
      for (let v = 0; v < per; v++) {
        const row = (j * per + v) * M;
        for (let u = 0; u < per; u++) {
          const t = (row + i * per + u) * 4;
          g += args.material[t]; sa += args.material[t + 1]; ro += args.material[t + 2]; so += args.material[t + 3];
        }
      }
      const k = j * N + i, n = per * per;
      grass[k] = Math.floor(g / n); sand[k] = Math.floor(sa / n); rock[k] = Math.floor(ro / n); soil[k] = Math.floor(so / n);
    }
  }

  // Slope (degrees, 0..90) from the terrain heights, over the cell's 1 m: the steeper of the two
  // central differences of the cell means either side. Only when heights are given. The same cell
  // means give the height above mean sea level (decimeters, -40..120), for the height axis.
  const slopeDeg = new Uint8Array(N * N);
  const heightDm = new Int16Array(N * N);
  if (args.heightQ) {
    const mean = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0;
      for (let v = 0; v < per; v++) { const row = (j * per + v) * M; for (let u = 0; u < per; u++) s += args.heightQ[row + i * per + u]; }
      mean[j * N + i] = (s / (per * per)) * (H_RANGE / 65535);
      heightDm[j * N + i] = Math.round((H_MIN + (s * H_RANGE) / (per * per * 65535)) * 10);
    }
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      const gx = (mean[k + 1] - mean[k - 1]) / 2, gz = (mean[k + N] - mean[k - N]) / 2;
      // det.atan2 and sqrt only, so every device and worker gets the same slope.
      slopeDeg[k] = Math.min(90, Math.round((det.atan2(Math.sqrt(gx * gx + gz * gz), 1) * 180) / det.PI));
    }
  }

  // How much the player has shaped each square (M2, dragonflies want a pond the player made): the
  // largest change of the ground from the island as it was generated, in centimeters (0..255).
  // Only when the generated heights are given (terrain/index.js keeps them).
  const shapedCm = new Uint8Array(N * N);
  if (args.heightQ && args.baseQ) {
    const cmPerStep = (H_RANGE * 100) / 65535;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let most = 0;
      for (let v = 0; v < per; v++) {
        const row = (j * per + v) * M;
        for (let u = 0; u < per; u++) { const d = Math.abs(args.heightQ[row + i * per + u] - args.baseQ[row + i * per + u]); if (d > most) most = d; }
      }
      shapedCm[j * N + i] = Math.min(255, Math.round(most * cmPerStep));
    }
  }

  // FNV-1a over everything, so two machines can compare.
  let h = 0x811c9dc5;
  for (const arr of [depthCm, moisture, salt, still, sea, grass, open]) {
    for (let k = 0; k < arr.length; k++) h = Math.imul(h ^ arr[k], 0x01000193) >>> 0;
  }
  // band (the tide band, for the journal's ground words) is derived from the summary like the rest
  // and left out of the hash, which keeps its S5 meaning.
  // The ground-type, slope and height axes are left out of the hash too: they only matter to plants
  // that ask for them, and the S5 hash keeps its meaning.
  // shapedCm is left out of the hash as well: it only says which squares the player shaped.
  return { n: N, depthCm, moisture, salt, still, sea, grass, open, band, sand, rock, soil, slopeDeg,
    heightDm: args.heightQ ? heightDm : undefined, shapedCm, hash: h >>> 0 };
}

/**
 * The habitat cell under a world point, or -1 outside the grid.
 * @param {number} x @param {number} z
 */
export function habitatCell(x, z) {
  const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
  if (i < 0 || j < 0 || i >= HABITAT_CELLS || j >= HABITAT_CELLS) return -1;
  return j * HABITAT_CELLS + i;
}
