// @ts-check
// The Cliff modes of Sculpt (docs/08, M2): Terrace builds up to a level and Cut carves down to it,
// level inside the brush with a sheer drop at its rim. Pure maths shared by the CPU mirror, the
// tests and (mirrored line for line) terrain-brush.wgsl, plus the cliff chunk flags the terrain
// mesh reads to keep walls at full detail (docs/19).
// Pure: safe to import from workers, tools pages and tests.

import { CELL, CHUNK_CELLS, CHUNK_MIN, CHUNK_MAX, WORLD_CELLS as N, H_MIN, H_MAX, chunkFirstCell } from './grid.js';

/**
 * The shelf level of a stroke: the ground where it starts, plus (Terrace) or minus (Cut) the
 * Height slider, snapped to whole steps so shelves built one after another line up. With
 * `sea` (Shift on desktop) the level is mean sea level instead.
 * @param {number} h0 ground height at the stroke's start (m)
 * @param {'terrace'|'cut'} kind
 * @param {number} height the Height slider (m)
 * @param {{ snapM: number }} rc recipe.cliff
 * @param {boolean} [sea]
 */
export function cliffLevel(h0, kind, height, rc, sea = false) {
  if (sea) return 0;
  const raw = kind === 'terrace' ? h0 + height : h0 - height;
  const snapped = rc.snapM > 0 ? Math.round(raw / rc.snapM) * rc.snapM : raw;
  return Math.min(H_MAX, Math.max(H_MIN, snapped));
}

/**
 * How much of the shelf a point gets: 1 inside the brush, falling to 0 across the rim's last
 * `edgeM` meters (at least half a cell, so the drop happens within one cell).
 * @param {number} d distance from the stamp center (m) @param {number} radius @param {number} edgeM
 */
export function cliffMask(d, radius, edgeM) {
  const w = Math.max(edgeM, CELL * 0.5);
  const u = Math.min(1, Math.max(0, (d - (radius - w)) / w));
  return 1 - u * u * (3 - 2 * u);
}

/**
 * One cell of a cliff stamp: Terrace only lifts to its goal, Cut only lowers, so a stroke that runs
 * into a hill (Terrace) or out over a hollow (Cut) leaves that ground alone. The goal is the level
 * inside, falling away by the stroke's Height (`rimDropM`) across the rim's last `edgeM` (about a
 * cell, so the wall is near sheer yet its top edge is smooth where it runs across the grid), and
 * by `edgeDropM` across the soft fade before unopened land (so no wall forms at the edge of the
 * world; docs/08). The goal never depends on the ground, so a stamp is idempotent: the same
 * stroke gives the same shelf at any frame rate, and going over it again changes nothing.
 * @param {number} h ground now @param {number} level @param {number} f rim mask 0..1
 * @param {number} sign +1 Terrace, -1 Cut, times the rim drop (m): the stroke's Height
 * @param {number} [fade] edge fade 0..1 @param {number} [edgeDropM]
 */
export function cliffHeight(h, level, f, sign, fade = 1, edgeDropM = 0) {
  const fall = (1 - f) * Math.max(Math.abs(sign), CELL) + (1 - fade) * edgeDropM;
  return sign > 0 ? Math.max(h, level - fall) : Math.min(h, level + fall);
}

/**
 * Whether a cell sits on a sheer face: its steepest drop to one of its four neighbors, either
 * way, is past `faceDeg`. Cells on a face (the rim above and the foot below) are painted rock, so
 * they draw as stone and erosion holds them near the rock talus.
 * @param {Float32Array} hf @param {number} i @param {number} j @param {number} faceDeg
 */
export function onFace(hf, i, j, faceDeg) {
  const step = Math.tan((faceDeg * Math.PI) / 180) * CELL;
  const h = hf[j * N + i];
  const at = (/** @type {number} */ x, /** @type {number} */ z) => hf[Math.min(N - 1, Math.max(0, z)) * N + Math.min(N - 1, Math.max(0, x))];
  return Math.abs(h - at(i + 1, j)) > step || Math.abs(h - at(i - 1, j)) > step
    || Math.abs(h - at(i, j + 1)) > step || Math.abs(h - at(i, j - 1)) > step;
}

/**
 * Whether a chunk holds a cliff: any step between neighboring cells over `stepM`. Such chunks keep
 * full mesh detail near the camera, as drawn and as shadow caster (docs/19).
 * @param {Float32Array} hf @param {number} cx @param {number} cz @param {number} stepM
 */
export function chunkHasCliff(hf, cx, cz, stepM) {
  const x0 = chunkFirstCell(cx);
  const z0 = chunkFirstCell(cz);
  for (let j = z0; j < z0 + CHUNK_CELLS; j++) {
    const row = j * N;
    for (let i = x0; i < x0 + CHUNK_CELLS; i++) {
      const h = hf[row + i];
      if (i + 1 < N && Math.abs(h - hf[row + i + 1]) > stepM) return true;
      if (j + 1 < N && Math.abs(h - hf[row + N + i]) > stepM) return true;
    }
  }
  return false;
}

/**
 * The set of cliff chunks, kept current as strokes end. `version` counts changes so the render
 * passes repack only when it moves.
 * @param {number} stepM recipe.cliff.chunkStepM
 */
export function createCliffChunks(stepM) {
  /** @type {Set<string>} */
  const set = new Set();
  const state = {
    version: 0,
    /** @param {number} cx @param {number} cz */
    has: (cx, cz) => set.has(`${cx},${cz}`),
    /** How many chunks hold a cliff. */
    get size() { return set.size; },
    /**
     * Re-check the chunks a cell rect touches (plus a one-cell margin, since a step at a chunk's
     * edge belongs to the chunk on either side).
     * @param {Float32Array} hf @param {{x: number, y: number, w: number, h: number}} r
     */
    refresh(hf, r) {
      let changed = false;
      for (let cz = CHUNK_MIN; cz <= CHUNK_MAX; cz++) {
        for (let cx = CHUNK_MIN; cx <= CHUNK_MAX; cx++) {
          const x0 = chunkFirstCell(cx) - 1;
          const z0 = chunkFirstCell(cz) - 1;
          if (r.x >= x0 + CHUNK_CELLS + 2 || r.x + r.w <= x0 || r.y >= z0 + CHUNK_CELLS + 2 || r.y + r.h <= z0) continue;
          const key = `${cx},${cz}`;
          const cliff = chunkHasCliff(hf, cx, cz, stepM);
          if (cliff !== set.has(key)) { changed = true; if (cliff) set.add(key); else set.delete(key); }
        }
      }
      if (changed) state.version++;
      return changed;
    },
  };
  return state;
}
