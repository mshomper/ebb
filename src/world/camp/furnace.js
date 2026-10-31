// @ts-check
// The clay furnace's night (the spring-ore plan, Matt, October 30, 2026): built from deep clay, sand
// and marram in its slot in the work corner, it stands one night to dry; then ore and willow charcoal
// laid in at the top burn through the night, and the metal is ready by morning. Like the fire's work
// list (work.js), nothing ticks: when a load is done is worked out from the hour it went in, so live
// play, a save and catch-up all agree. The load rides on the furnace's slot record in the camp
// section. Numbers: recipes/world/cook.json furnace. Pure.

/**
 * @typedef {{ id: string, gives: string, count: number, laidHour: number }} Load
 *   id: the make that laid it (smelt-iron, smelt-copper); gives, count: the metal it becomes
 * @typedef {{ readyHour: number, minH: number, dryMinH: number }} FurnaceRecipe
 */

/**
 * The first readyHour (hour of the game day) at least minH game hours after `from`: ore in at
 * dusk, metal by morning. @param {number} from game hour @param {number} readyHour @param {number} minH
 */
export function morningAfter(from, readyHour, minH) {
  const earliest = from + minH;
  const day = Math.floor((earliest - readyHour) / 24);
  let at = (day * 24) + readyHour;
  if (at < earliest - 1e-9) at += 24;
  return at;
}

/** A saved load made safe, or null. @param {any} v @returns {Load | null} */
export function cleanLoad(v) {
  if (!v || typeof v.id !== 'string' || typeof v.gives !== 'string' || !Number.isFinite(v.laidHour)) return null;
  return { id: v.id, gives: v.gives, count: Math.max(1, Math.round(Number.isFinite(v.count) ? v.count : 1)), laidHour: v.laidHour };
}

/** Is the furnace (its slot record) dry by `hour`? @param {{ placedHour: number }} rec @param {number} hour @param {FurnaceRecipe} F */
export const furnaceDry = (rec, hour, F) => hour >= morningAfter(rec.placedHour, F.readyHour, F.dryMinH) - 1e-9;

/** When a load is done. @param {Load} load @param {FurnaceRecipe} F */
export const loadReady = (load, F) => morningAfter(load.laidHour, F.readyHour, F.minH);

/**
 * What the furnace is doing at `hour`: drying, empty (cold and ready), burning a load, or done
 * (the metal waits behind the arch). @param {{ placedHour: number, load?: Load | null } | null} rec
 * @param {number} hour @param {FurnaceRecipe} F @returns {'none' | 'drying' | 'empty' | 'burning' | 'done'}
 */
export function furnaceState(rec, hour, F) {
  if (!rec) return 'none';
  if (!furnaceDry(rec, hour, F)) return 'drying';
  const load = rec.load ? cleanLoad(rec.load) : null;
  if (!load) return 'empty';
  return hour >= loadReady(load, F) - 1e-9 ? 'done' : 'burning';
}

/** A load laid in now. @param {string} id @param {{ gives: string, count?: number }} make @param {number} hour @returns {Load} */
export const layLoad = (id, make, hour) => ({ id, gives: make.gives, count: make.count ?? 1, laidHour: hour });
