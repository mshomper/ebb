// @ts-check
// The camp's fire (docs/future/13 sections 3.4 to 3.6, C-27, C-28, C-31, CP-11). The fire only ever
// burns inside its ring. Its state is a few numbers saved with the camp, and what it is at any hour
// is worked out from the clock alone: a handful of fuel burns recipe.flameH game hours, then sinks
// to embers; embers (burned down, or banked by a rest) last emberH, then the ring is cold. So the
// same hours give the same fire live, after a save and in catch-up, with no hourly tick of its own.
// Rain never puts it out (the live look drops it low with a hiss). Pure.

/**
 * @typedef {'none' | 'laid' | 'lit' | 'embers' | 'cold'} FireWord
 * @typedef {{ state: FireWord, sinceHour: number, flameUntilHour: number, lightings: number, litDays: number, lastLitDay: number }} Fire
 *   sinceHour: when it took its state (game hours, fractional); flameUntilHour: a lit fire's flame
 *   ends then; lightings: times lit with the steel; litDays: game days it has been lit on (nettles
 *   come by a fire lit on enough days, C-25); lastLitDay: the last of them
 * @typedef {{ flameH: number, emberH: number, ashFadeH: number }} FireRecipe recipes/world/camp.json fire
 */

/** @returns {Fire} */
export const noFire = () => ({ state: 'none', sinceHour: 0, flameUntilHour: 0, lightings: 0, litDays: 0, lastLitDay: -1 });

const WORDS = ['none', 'laid', 'lit', 'embers', 'cold'];

/**
 * A saved fire made safe: anything missing or unreadable is no fire. @param {any} v @returns {Fire}
 */
export function cleanFire(v) {
  if (!v || typeof v !== 'object' || !WORDS.includes(v.state)) return noFire();
  const n = (/** @type {any} */ x, /** @type {number} */ d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return { state: v.state, sinceHour: n(v.sinceHour, 0), flameUntilHour: n(v.flameUntilHour, 0),
    lightings: Math.max(0, Math.round(n(v.lightings, 0))), litDays: Math.max(0, Math.round(n(v.litDays, 0))), lastLitDay: Math.round(n(v.lastLitDay, -1)) };
}

/**
 * What the fire is at a game hour, from its saved state and the clock.
 * @param {Fire} f @param {number} hour game hours (fractional) @param {FireRecipe} F
 * @returns {{ word: FireWord, since: number, flameLeftH: number, ash: number }}
 *   since: when it became what it is; flameLeftH: hours of flame left (lit only); ash: the cold
 *   ring's ash, 1 just gone cold, fading to 0 over ashFadeH
 */
export function fireAt(f, hour, F) {
  if (f.state === 'none' || f.state === 'laid') return { word: f.state, since: f.sinceHour, flameLeftH: 0, ash: 0 };
  let word = f.state, since = f.sinceHour;
  if (word === 'lit' && hour >= f.flameUntilHour) { word = 'embers'; since = f.flameUntilHour; }
  if (word === 'embers' && hour >= since + F.emberH) { word = 'cold'; since += F.emberH; }
  const flameLeftH = word === 'lit' ? f.flameUntilHour - hour : 0;
  const ash = word === 'cold' ? Math.max(0, 1 - (hour - since) / Math.max(1e-6, F.ashFadeH)) : word === 'embers' ? 1 : 0;
  return { word, since, flameLeftH, ash };
}

/** The game day of an hour. @param {number} hour */
const dayOf = (hour) => Math.floor(hour / 24);

/**
 * Lay the ring: stones round, fuel inside, cold (camp:ring-laid). @param {Fire} f @param {number} hour @returns {Fire}
 */
export const layFire = (f, hour) => ({ ...f, state: 'laid', sinceHour: hour, flameUntilHour: 0 });

/**
 * Light it with the steel (a laid ring, or a cold one with a fresh handful): flameH hours of flame.
 * Null when there is nothing to light (no ring, or already burning). @param {Fire} f @param {number} hour
 * @param {FireRecipe} F @returns {Fire | null}
 */
export function lightFire(f, hour, F) {
  const w = fireAt(f, hour, F).word;
  if (w !== 'laid' && w !== 'cold') return null;
  return burn({ ...f, lightings: f.lightings + 1 }, hour, F);
}

/**
 * Feed it a handful (Feed the fire): embers come back to flame with no steel; a burning fire gets
 * flameH more hours. Null when there are no embers or flame to feed. @param {Fire} f @param {number} hour
 * @param {FireRecipe} F @returns {Fire | null}
 */
export function feedFire(f, hour, F) {
  const at = fireAt(f, hour, F);
  if (at.word === 'embers') return burn(f, hour, F);
  if (at.word === 'lit') return { ...f, flameUntilHour: f.flameUntilHour + F.flameH };
  return null;
}

/** @param {Fire} f @param {number} hour @param {FireRecipe} F @returns {Fire} */
function burn(f, hour, F) {
  const day = dayOf(hour);
  return { ...f, state: 'lit', sinceHour: hour, flameUntilHour: hour + F.flameH,
    litDays: f.litDays + (day !== f.lastLitDay ? 1 : 0), lastLitDay: day };
}

/**
 * Bank it for the night (a rest with the fire burning, camp:banked): embers under ash from now.
 * The same fire when there is no flame. @param {Fire} f @param {number} hour @param {FireRecipe} F @returns {Fire}
 */
export function bankFire(f, hour, F) {
  return fireAt(f, hour, F).word === 'lit' ? { ...f, state: 'embers', sinceHour: hour, flameUntilHour: hour } : f;
}

/**
 * The fire with what the clock has done written in (embers, then cold), so the saved numbers stay
 * small and a later step reads plainly. Same answers from fireAt before and after. @param {Fire} f
 * @param {number} hour @param {FireRecipe} F @returns {Fire}
 */
export function settleFire(f, hour, F) {
  const at = fireAt(f, hour, F);
  if (at.word === f.state) return f;
  return { ...f, state: at.word, sinceHour: at.since, flameUntilHour: at.word === 'embers' ? at.since : f.flameUntilHour };
}
