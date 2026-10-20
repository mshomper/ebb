// @ts-check
// What is close to the camera, for the island's sound (doc 17 "Ambience that reacts", doc 25
// "Rain on surfaces"): how much pond, stream and sea water, lily pads, reeds and grass lie within a
// few meters of the view's center. Read from the water summary and the growth state, the same data
// ecology reads, cell by cell across the circle and weighted toward the middle. Pure: the game
// calls it a couple of times a second and puts the answer in the store's `sound` slice.
// Numbers: recipes/audio/game.json `near`.
//
// Ponds, sea, plants and grass count by their share of the circle. Streams are thin, often a
// single half-meter cell wide, so they count by how close the nearest running water is instead.

import { WATER_CLASS } from './water/summary.js';
import { waterCellOf, waterCellCenter, WATER_CELL } from './water/grid.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from './growth/habitat.js';

/**
 * @typedef {Object} SoundNear
 * @property {{still: number, slow: number, running: number}} waterNear  0..1 pond, slow stream, running stream
 * @property {{water: number, pads: number, reeds: number, grass: number}} surfaceNear  0..1 (water includes the sea)
 * @property {import('./falls-near.js').FallNear[]} falls  waterfalls near, nearest first (src/world/falls-near.js; the game fills it)
 */

/** Nothing near: before the first water summary. @returns {SoundNear} */
export function nothingNear() {
  return { waterNear: { still: 0, slow: 0, running: 0 }, surfaceNear: { water: 0, pads: 0, reeds: 0, grass: 0 }, falls: [] };
}

/**
 * @param {{ summary: any, growth: any, rushId?: string | null, x: number, z: number, recipe: any }} o
 *   summary: the water summary (water.getSummary()); growth: world.state.growth; recipe: game.json `near`
 * @returns {SoundNear}
 */
export function soundNear(o) {
  const N = o.recipe;
  const out = nothingNear();
  const R = N.radiusM;
  /** Closer counts more: 1 at the middle down to `falloff` at the edge, 0 outside. @param {number} d */
  const weight = (d) => (d > R ? 0 : 1 - (1 - N.falloff) * (d / R));
  /** Closeness of a thin feature at distance d: 1 within streamFullM, 0 at the edge. @param {number} d */
  const closeness = (d) => {
    const k = Math.min(1, Math.max(0, (d - N.streamFullM) / Math.max(1e-6, R - N.streamFullM)));
    return 1 - k * k * (3 - 2 * k);
  };

  // Water, at the summary's own half-meter cells.
  const s = o.summary;
  if (s) {
    let total = 0, still = 0, water = 0, slowD = Infinity, runD = Infinity;
    const i0 = Math.max(0, waterCellOf(o.x - R) - s.rect.x), i1 = Math.min(s.rect.w - 1, waterCellOf(o.x + R) - s.rect.x);
    const j0 = Math.max(0, waterCellOf(o.z - R) - s.rect.y), j1 = Math.min(s.rect.h - 1, waterCellOf(o.z + R) - s.rect.y);
    // Cells outside the summary's rect are open sea far from the island: count them as sea.
    const span = Math.ceil((2 * R) / WATER_CELL);
    for (let jj = 0; jj <= span; jj++) {
      for (let ii = 0; ii <= span; ii++) {
        const gi = waterCellOf(o.x - R) + ii, gj = waterCellOf(o.z - R) + jj;
        const cx = waterCellCenter(gi), cz = waterCellCenter(gj);
        const d = Math.hypot(cx - o.x, cz - o.z);
        const w = weight(d);
        if (!w) continue;
        total += w;
        const i = gi - s.rect.x, j = gj - s.rect.y;
        const inside = i >= i0 && i <= i1 && j >= j0 && j <= j1;
        const c = inside ? s.cls[j * s.rect.w + i] : WATER_CLASS.sea;
        if (c === WATER_CLASS.still) still += w;
        else if (c === WATER_CLASS.slow) slowD = Math.min(slowD, d);
        else if (c === WATER_CLASS.running) runD = Math.min(runD, d);
        if (c === WATER_CLASS.sea || c === WATER_CLASS.still || c === WATER_CLASS.slow || c === WATER_CLASS.running) water += w;
      }
    }
    const share = (/** @type {number} */ v) => (total > 0 ? Math.min(1, v / total / N.fullAt) : 0);
    out.waterNear = { still: share(still), slow: Number.isFinite(slowD) ? closeness(slowD) : 0, running: Number.isFinite(runD) ? closeness(runD) : 0 };
    out.surfaceNear.water = share(water);
  }

  // Plants and cover, at the growth grid's one-meter cells.
  const g = o.growth;
  if (g) {
    const reach2 = N.plantReachM * N.plantReachM;
    /** @type {{x: number, z: number, pad: number, reed: number}[]} */
    const plants = [];
    for (const p of g.plants ?? []) {
      if (p.gone) continue;
      const pad = N.pads?.[p.sp] ?? 0, reed = N.reeds?.[p.sp] ?? 0;
      if (!pad && !reed) continue;
      if (Math.abs(p.x - o.x) > R + N.plantReachM || Math.abs(p.z - o.z) > R + N.plantReachM) continue;
      plants.push({ x: p.x, z: p.z, pad, reed });
    }
    const rush = o.rushId ? g.cover?.[o.rushId] ?? null : null;
    let total = 0, pads = 0, reeds = 0, grass = 0;
    const h0x = Math.floor(o.x - R - HABITAT_ORIGIN), h0z = Math.floor(o.z - R - HABITAT_ORIGIN);
    for (let hz = h0z; hz <= h0z + 2 * R + 1; hz++) {
      for (let hx = h0x; hx <= h0x + 2 * R + 1; hx++) {
        const cx = HABITAT_ORIGIN + hx + 0.5, cz = HABITAT_ORIGIN + hz + 0.5;
        const w = weight(Math.hypot(cx - o.x, cz - o.z));
        if (!w) continue;
        total += w;
        if (hx >= 0 && hz >= 0 && hx < HABITAT_CELLS && hz < HABITAT_CELLS) {
          const k = hz * HABITAT_CELLS + hx;
          if (g.grass) grass += w * Math.min(1, g.grass[k] / N.grassFull);
          if (rush) reeds += w * N.rushWeight * Math.min(1, rush[k] / 255);
        }
        let pad = 0, reed = 0;
        for (const p of plants) {
          if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > reach2) continue;
          pad = Math.max(pad, p.pad);
          reed = Math.max(reed, p.reed);
        }
        pads += w * pad;
        reeds += w * reed;
      }
    }
    const share = (/** @type {number} */ v) => (total > 0 ? Math.min(1, v / total / N.fullAt) : 0);
    out.surfaceNear.pads = share(pads);
    out.surfaceNear.reeds = share(reeds);
    out.surfaceNear.grass = share(grass);
  }
  return out;
}
