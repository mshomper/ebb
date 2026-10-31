// @ts-check
// What the save keeps of fishing (docs/future/17; the `fishing` section): each species sketched,
// with the seed of the very fish the page was drawn from (a redraw replaces it), the hour and
// whether it was a rarer morph; glimpses from the nets by species and hour; and the island's cast
// count, which seeds each cast's bite. Counters are of kinds, never totals (F12, October 21, 2026):
// the cast count is never shown. An older save has no section and reads as nothing sketched; a net
// fish page inked from a net release counts as sketched (sketchedOrInked). Pure.

/**
 * @typedef {{ seed: number, hour: number, morph?: string, cm?: number }} Sketch
 * @typedef {{ version: 1, sketched: Record<string, Sketch>, glimpsed: Record<string, number>, casts: number }} FishingState
 */

/** Nothing sketched yet. @returns {FishingState} */
export const emptyFishing = () => ({ version: 1, sketched: {}, glimpsed: {}, casts: 0 });

/** A saved section (or anything else) made safe. @param {any} v @returns {FishingState} */
export function cleanFishing(v) {
  if (!v || typeof v !== 'object' || v.version !== 1) return emptyFishing();
  /** @type {Record<string, Sketch>} */ const sketched = {};
  for (const [id, s] of Object.entries(v.sketched && typeof v.sketched === 'object' ? v.sketched : {})) {
    if (!s || !Number.isInteger(/** @type {any} */ (s).seed) || !Number.isFinite(/** @type {any} */ (s).hour)) continue;
    const q = /** @type {any} */ (s);
    sketched[id] = { seed: q.seed >>> 0, hour: q.hour, ...(Number.isFinite(q.cm) ? { cm: q.cm } : {}), ...(typeof q.morph === 'string' ? { morph: q.morph } : {}) };
  }
  /** @type {Record<string, number>} */ const glimpsed = {};
  for (const [id, h] of Object.entries(v.glimpsed && typeof v.glimpsed === 'object' ? v.glimpsed : {})) if (Number.isFinite(h)) glimpsed[id] = /** @type {number} */ (h);
  return { version: 1, sketched, glimpsed, casts: Number.isInteger(v.casts) && v.casts >= 0 ? v.casts : 0 };
}

/**
 * Sketch a species: the first of it, or a redraw (which replaces it). @param {FishingState} s
 * @param {string} id @param {Sketch} sk @returns {FishingState}
 */
export const sketch = (s, id, sk) => ({ ...s, sketched: { ...s.sketched, [id]: sk } });

/** A glimpse from a net: the first hour each species was glimpsed. @param {FishingState} s @param {string} id @param {number} hour */
export const glimpse = (s, id, hour) => (s.glimpsed[id] !== undefined ? s : { ...s, glimpsed: { ...s.glimpsed, [id]: hour } });

/** One more cast. @param {FishingState} s */
export const castOnce = (s) => ({ ...s, casts: s.casts + 1 });

/**
 * The species that count as sketched: sketched on the line, or a net fish whose journal page is
 * already inked from a net release (so nobody loses a page). @param {FishingState} s
 * @param {import('./roster.js').RosterFish[]} roster @param {(page: string) => boolean} inked
 * @returns {Set<string>}
 */
export function sketchedOrInked(s, roster, inked) {
  return new Set(roster.filter((f) => s.sketched[f.id] || (f.kind === 'named' && inked(f.page))).map((f) => f.id));
}

/**
 * Is a new catch finer than the sketch on its page: a rarer morph, or a good deal longer? Then the
 * tray offers to redraw. @param {Sketch | undefined} had @param {{ morphId: string | null, lengthM: number }} n
 * @param {number} finerLength how much longer counts as finer
 */
export function finer(had, n, finerLength) {
  if (!had) return false;
  if (n.morphId && !had.morph) return true;
  return !!had.cm && n.lengthM * 100 >= had.cm * finerLength;
}
