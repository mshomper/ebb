// @ts-check
// The shaper's trail (doc 13 "Trails"): which kinds of place the island has now, read only from what
// the game already computes, so looking costs almost nothing. Each kind found is written down once
// as a first (src/world/trails.js) and never taken back, even if the place is later filled in. The
// checks (recipes/world/shaper.json `check`) are pure; createShaperWatch looks again when the water
// settles after an edit and once a game hour, and after catch-up, so time away is noticed too.

import { HABITAT_ORIGIN } from './growth/habitat.js';
import { STAGE } from './growth/coarse.js';
import { WATER_CLASS } from './water/summary.js';
import { waterCellCenter } from './water/grid.js';
import { coveField } from './water/cove.js';

/** Plants that make a pond's reed margin. */
const MARGIN_PLANTS = ['reeds', 'iris'];

/**
 * The kinds of place the island has now. Pure.
 * @param {{ summary?: any, cove?: Uint8Array | null, falls?: { heightM: number }[], pools?: { fit?: boolean }[],
 *   plants?: { sp: string, x: number, z: number, stage: number }[], hab?: any, rushes?: Uint8Array | null }} inp
 *   summary: the water summary; cove: the cove field (per summary cell); falls: waterfalls (falls-near.js);
 *   pools: the dragonflies' pools (state.ecology.dragonflies.pools); plants: state.growth.plants;
 *   hab: the habitat; rushes: the rushes' cover per habitat square
 * @param {any} C recipes/world/shaper.json check
 * @returns {Set<string>}
 */
export function placesNow(inp, C) {
  /** @type {Set<string>} */ const out = new Set();
  const s = inp.summary, hab = inp.hab;
  // Only what the player made counts where the island could have it already (a brook, a natural
  // cove): ground moved C.shapedCm or more from the island as generated (the habitat's shapedCm).
  const shapedAt = (/** @type {number} */ k) => {
    if (!hab?.shapedCm || !s) return false;
    const i = Math.floor(waterCellCenter(s.rect.x + (k % s.rect.w)) - HABITAT_ORIGIN), j = Math.floor(waterCellCenter(s.rect.y + Math.floor(k / s.rect.w)) - HABITAT_ORIGIN);
    return i >= 0 && j >= 0 && i < hab.n && j < hab.n && hab.shapedCm[j * hab.n + i] >= C.shapedCm;
  };
  if (s) {
    let deepest = 0, running = 0, cove = 0;
    for (let k = 0; k < s.targetMm.length; k++) {
      if (s.targetMm[k] > deepest) deepest = s.targetMm[k];
      if (s.cls[k] === WATER_CLASS.running && shapedAt(k)) running++;
      if (inp.cove && inp.cove[k] >= C.coveScore && shapedAt(k)) cove++;
    }
    if (deepest >= C.deepPoolMm) out.add('deepPool');
    if (running >= C.streamCells) out.add('stream');
    if (cove >= C.coveCells) out.add('cove');
  }
  if ((inp.falls ?? []).some((f) => f.heightM >= C.fallM)) out.add('fall');
  // A pond of your own with no fish: the dragonflies' own test (a shaped, covered margin; no fish).
  if ((inp.pools ?? []).some((p) => p.fit)) out.add('fishFreePond');
  const flowering = new Set((inp.plants ?? []).filter((p) => p.stage === STAGE.flowering).map((p) => p.sp));
  if (flowering.size >= C.flowerKinds) out.add('flowers');
  if (inp.hab && reedMargin(inp.hab, inp.plants ?? [], inp.rushes ?? null, C)) out.add('reedMargin');
  return out;
}

/**
 * Has some pond (still fresh water of reedPondM2 or more) reeds, rushes or iris along reedShare of
 * its edge (the land squares beside its water, a plant counting within one square)? Pure.
 * @param {any} hab @param {{ sp: string, x: number, z: number }[]} plants @param {Uint8Array | null} rushes @param {any} C
 */
export function reedMargin(hab, plants, rushes, C) {
  const n = hab.n, N = n * n;
  const water = (/** @type {number} */ k) => hab.open[k] && !hab.sea[k] && hab.depthCm[k] > 0 && hab.still[k];
  // Squares a margin plant reaches (its own and the eight around it).
  const near = new Uint8Array(N);
  const mark = (/** @type {number} */ i, /** @type {number} */ j) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n) near[b * n + a] = 1;
    }
  };
  for (const p of plants) if (MARGIN_PLANTS.includes(p.sp)) mark(Math.floor(p.x - HABITAT_ORIGIN), Math.floor(p.z - HABITAT_ORIGIN));
  if (rushes) for (let k = 0; k < N; k++) if (rushes[k] > 38) mark(k % n, Math.floor(k / n));
  // Each pond in turn: its squares, then its edge.
  const seen = new Uint8Array(N);
  for (let k0 = 0; k0 < N; k0++) {
    if (seen[k0] || !water(k0)) continue;
    const pond = [k0];
    seen[k0] = 1;
    for (let q = 0; q < pond.length; q++) {
      const k = pond[q], i = k % n, j = Math.floor(k / n);
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const kk = b * n + a;
        if (!seen[kk] && water(kk)) { seen[kk] = 1; pond.push(kk); }
      }
    }
    if (pond.length < C.reedPondM2) continue;
    /** @type {Set<number>} */ const edge = new Set();
    for (const k of pond) {
      const i = k % n, j = Math.floor(k / n);
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const kk = b * n + a;
        if (!water(kk) && hab.open[kk] && !hab.sea[kk]) edge.add(kk);
      }
    }
    if (!edge.size) continue;
    let lined = 0;
    for (const k of edge) if (near[k]) lined++;
    if (lined / edge.size >= C.reedShare) return true;
  }
  return false;
}

/**
 * Live: looks for new kinds of place when the water settles and once a game hour, and writes each
 * new one down (note). @param {{ world: { state: any, env: any }, water: any, recipe: any, coveRecipe: any,
 *   falls: () => { heightM: number }[], has: () => Set<string>, note: (id: string) => void }} o
 *   recipe: shaper.json; has: the places already noticed; note: write one down (app.js)
 */
export function createShaperWatch(o) {
  /** @type {any} */ let coveFor = null;
  /** @type {Uint8Array | null} */ let cove = null;
  return {
    /** Look now. */
    look() {
      const summary = o.water.getSummary?.();
      if (summary && summary !== coveFor && o.coveRecipe) { coveFor = summary; cove = coveField(summary, o.coveRecipe); }
      const st = o.world.state;
      const now = placesNow({ summary, cove, falls: o.falls(), pools: st?.ecology?.dragonflies?.pools ?? [],
        plants: st?.growth?.plants ?? [], hab: o.world.env.habitat?.() ?? null, rushes: st?.growth?.cover?.rushes ?? null }, o.recipe.check);
      const had = o.has();
      for (const s of o.recipe.stops) if (now.has(s.need.place) && !had.has(s.need.place)) o.note(s.need.place);
    },
  };
}
