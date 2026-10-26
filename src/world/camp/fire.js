// @ts-check
// The camp's fire (docs/future/13 sections 3.4 to 3.6, C-27, C-28, C-31, CP-11). The fire only ever
// burns inside its ring. Its state is a few numbers saved with the camp, and what it is at any hour
// is worked out from the clock alone: a handful of fuel burns recipe.flameH game hours, then sinks
// to embers; embers (burned down, or banked by a rest) last emberH, then the ring is cold. So the
// same hours give the same fire live, after a save and in catch-up, with no hourly tick of its own.
// Rain never puts it out (the live look drops it low with a hiss). Pure.
//
// Fire-nights (P2i I1): a night the fire burned (lit, or embers banked or burned down) for at least
// night.needH hours between dusk and dawn. The state above only ever holds the burn going now, so
// before each change overwrites it (a lighting, a feed, a banking, the clock settling it) the nights
// it made are written into `nights`, the last few kept, with the hours of a night still under way
// carried over (`carry`) so a night split between two burns still adds up. The ring gives charcoal
// and ash the morning after a fire-night (src/world/gather/spots.js ringSpots).

/**
 * @typedef {'none' | 'laid' | 'lit' | 'embers' | 'cold'} FireWord
 * @typedef {{ state: FireWord, sinceHour: number, flameUntilHour: number, lightings: number, litDays: number, lastLitDay: number,
 *   nights: number[], carry: { day: number, h: number } | null, charcoal: boolean }} Fire
 *   sinceHour: when it took its state (game hours, fractional); flameUntilHour: a lit fire's flame
 *   ends then; lightings: times lit with the steel; litDays: game days it has been lit on (nettles
 *   come by a fire lit on enough days, C-25); lastLitDay: the last of them; nights: the game days of
 *   the dawns after its last fire-nights, oldest first; carry: hours already burned in the night
 *   whose dawn is `day`, by an earlier burn; charcoal: charcoal was fed to the burn going now
 * @typedef {{ flameH: number, emberH: number, ashFadeH: number, maxFuelH?: number, highH?: number,
 *   fuelK?: Record<string, number>, night?: { duskH: number, dawnH: number, needH: number, keep: number } }} FireRecipe recipes/world/camp.json fire
 *   flameH: hours of flame one handful gives; maxFuelH: the most the ring holds at once; highH: with
 *   more than this left it burns high, with less it burns low (F9); fuelK: a fuel kind's flame hours
 *   as a share of flameH (charcoal 2); night: the hours of the day dusk and dawn fall at, the hours a
 *   fire must burn between them, and how many fire-nights the fire remembers
 */

/** @returns {Fire} */
export const noFire = () => ({ state: 'none', sinceHour: 0, flameUntilHour: 0, lightings: 0, litDays: 0, lastLitDay: -1, nights: [], carry: null, charcoal: false });

const WORDS = ['none', 'laid', 'lit', 'embers', 'cold'];

/**
 * A saved fire made safe: anything missing or unreadable is no fire. @param {any} v @returns {Fire}
 */
export function cleanFire(v) {
  if (!v || typeof v !== 'object' || !WORDS.includes(v.state)) return noFire();
  const n = (/** @type {any} */ x, /** @type {number} */ d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const nights = Array.isArray(v.nights) ? [...new Set(v.nights.filter(Number.isInteger))].sort((a, b) => a - b) : [];
  const c = v.carry;
  const carry = c && Number.isInteger(c.day) && Number.isFinite(c.h) && c.h > 0 ? { day: c.day, h: c.h } : null;
  return { state: v.state, sinceHour: n(v.sinceHour, 0), flameUntilHour: n(v.flameUntilHour, 0),
    lightings: Math.max(0, Math.round(n(v.lightings, 0))), litDays: Math.max(0, Math.round(n(v.litDays, 0))), lastLitDay: Math.round(n(v.lastLitDay, -1)),
    nights, carry, charcoal: v.charcoal === true };
}

// ---- fire-nights ----

/** The default night: dusk at 20:00, dawn at 04:00, 3 hours of fire between, the last 3 kept. */
const NIGHT = { duskH: 20, dawnH: 4, needH: 3, keep: 3 };

/**
 * The hours the burn going now spans, lit or embers: [from, to), or null (no ring, laid, cold).
 * @param {Fire} f @param {FireRecipe} F @returns {number[] | null}
 */
function burnSpan(f, F) {
  if (f.state === 'lit') return [f.sinceHour, f.flameUntilHour + F.emberH];
  if (f.state === 'embers') return [f.sinceHour, f.sinceHour + F.emberH];
  return null;
}

/**
 * The hours of fire (lit or embers) the burn going now gives between two hours: what the camp's
 * overnight work counts (work.js). @param {Fire} f @param {number} from @param {number} to @param {FireRecipe} F
 */
export function hotHours(f, from, to, F) {
  const span = burnSpan(f, F);
  return span ? Math.max(0, Math.min(to, span[1]) - Math.max(from, span[0])) : 0;
}

/** The night whose dawn falls on game day d: [dusk the evening before, dawn]. @param {number} d @param {any} N */
const nightOf = (d, N) => [24 * (d - 1) + N.duskH, 24 * d + N.dawnH];

/**
 * The hours of each night a burn [a, b) covers, cut at `upTo`, as [dawn day, hours] pairs, with
 * the carried hours added to their night. @param {number[]} span @param {number} upTo
 * @param {{ day: number, h: number } | null} carry @param {any} N
 */
function nightHours(span, upTo, carry, N) {
  const a = span[0], b = Math.min(span[1], upTo);
  /** @type {Map<number, number>} */ const by = new Map(carry ? [[carry.day, carry.h]] : []);
  // From the first night whose dawn comes after the burn began.
  for (let d = Math.floor((a - N.dawnH) / 24) + 1; b > a && nightOf(d, N)[0] < b; d++) {
    const [s, e] = nightOf(d, N);
    const h = Math.max(0, Math.min(b, e) - Math.max(a, s));
    if (h > 0) by.set(d, (by.get(d) ?? 0) + h);
  }
  return [...by.entries()].sort((p, q) => p[0] - q[0]);
}

/**
 * The dawn days of the fire's fire-nights by `hour`, oldest first: the ones it wrote down and any
 * the burn going now has made. A night counts once it has had needH hours of fire, so its morning's
 * charcoal is there from dawn. @param {Fire} f @param {number} hour @param {FireRecipe} F @returns {number[]}
 */
export function fireNights(f, hour, F) {
  const N = F.night ?? NIGHT;
  const span = burnSpan(f, F);
  const now = span ? nightHours(span, hour, f.carry, N).filter(([, h]) => h >= N.needH - 1e-9).map(([d]) => d) : [];
  return [...new Set([...(f.nights ?? []), ...now])].sort((a, b) => a - b).slice(-(N.keep ?? 3));
}

/**
 * The burn going now written down up to `hour`, before a change overwrites it: its fire-nights
 * into `nights`, and the hours of the night under way at `hour` carried. The burn itself is left
 * as it is. @param {Fire} f @param {number} hour @param {FireRecipe} F @returns {Fire}
 */
function writeNights(f, hour, F) {
  const N = F.night ?? NIGHT;
  const span = burnSpan(f, F);
  if (!span) return f;
  const hours = nightHours(span, hour, f.carry, N);
  // The night under way at the cut (its dusk passed, its dawn not yet) carries its hours on.
  const open = hours.find(([d]) => { const [s, e] = nightOf(d, N); return hour > s && hour < e; });
  return { ...f, nights: fireNights(f, hour, F), carry: open && open[1] < N.needH ? { day: open[0], h: open[1] } : null };
}

/**
 * What the fire is at a game hour, from its saved state and the clock.
 * @param {Fire} f @param {number} hour game hours (fractional) @param {FireRecipe} F
 * @returns {{ word: FireWord, since: number, flameLeftH: number, ash: number, high: boolean, level: number }}
 *   since: when it became what it is; flameLeftH: hours of flame left (lit only); ash: the cold
 *   ring's ash, 1 just gone cold, fading to 0 over ashFadeH; high: burning high (more than highH of
 *   fuel left); level: the flame's fuel 0..1 of what makes it burn high (1 at highH or more)
 */
export function fireAt(f, hour, F) {
  if (f.state === 'none' || f.state === 'laid') return { word: f.state, since: f.sinceHour, flameLeftH: 0, ash: 0, high: false, level: 0 };
  let word = f.state, since = f.sinceHour;
  if (word === 'lit' && hour >= f.flameUntilHour) { word = 'embers'; since = f.flameUntilHour; }
  if (word === 'embers' && hour >= since + F.emberH) { word = 'cold'; since += F.emberH; }
  const flameLeftH = word === 'lit' ? f.flameUntilHour - hour : 0;
  const ash = word === 'cold' ? Math.max(0, 1 - (hour - since) / Math.max(1e-6, F.ashFadeH)) : word === 'embers' ? 1 : 0;
  const highH = F.highH ?? F.flameH / 2;
  return { word, since, flameLeftH, ash, high: flameLeftH > highH, level: word === 'lit' ? Math.min(1, flameLeftH / Math.max(1e-6, highH)) : 0 };
}

/** The game day of an hour. @param {number} hour */
const dayOf = (hour) => Math.floor(hour / 24);

/**
 * Lay the ring: stones round, fuel inside, cold (camp:ring-laid). @param {Fire} f @param {number} hour @returns {Fire}
 */
export const layFire = (f, hour) => ({ ...f, state: 'laid', sinceHour: hour, flameUntilHour: 0 });

/**
 * The flame hours a handful of a fuel kind gives: flameH, times its fuelK (charcoal burns twice as
 * long). @param {FireRecipe} F @param {string} [kind]
 */
export const flameOf = (F, kind) => F.flameH * (kind ? F.fuelK?.[kind] ?? 1 : 1);

/**
 * Light it with the steel (a laid ring, or a cold one with a fresh handful): flameH hours of flame
 * (the fresh handful's own, by its kind). Null when there is nothing to light (no ring, or already
 * burning). @param {Fire} f @param {number} hour @param {FireRecipe} F @param {string} [kind]
 * @returns {Fire | null}
 */
export function lightFire(f, hour, F, kind) {
  const w = fireAt(f, hour, F).word;
  if (w !== 'laid' && w !== 'cold') return null;
  return burn({ ...writeNights(f, hour, F), lightings: f.lightings + 1 }, hour, F, kind);
}

/**
 * Feed it a handful (Feed the fire): embers come back to flame with no steel; a burning fire gets
 * that handful's flame hours more. Null when there are no embers or flame to feed. @param {Fire} f
 * @param {number} hour @param {FireRecipe} F @param {string} [kind] the fuel fed @returns {Fire | null}
 */
export function feedFire(f, hour, F, kind) {
  const at = fireAt(f, hour, F);
  if (at.word === 'embers') return burn(writeNights(f, hour, F), hour, F, kind);
  // More wood on a burning fire: its flame hours more, up to what the ring holds.
  if (at.word === 'lit') return { ...f, flameUntilHour: Math.min(hour + (F.maxFuelH ?? Infinity), f.flameUntilHour + flameOf(F, kind)), charcoal: f.charcoal || kind === 'charcoal' };
  return null;
}

/** @param {Fire} f @param {number} hour @param {FireRecipe} F @param {string} [kind] @returns {Fire} */
function burn(f, hour, F, kind) {
  const day = dayOf(hour);
  return { ...f, state: 'lit', sinceHour: hour, flameUntilHour: hour + flameOf(F, kind),
    litDays: f.litDays + (day !== f.lastLitDay ? 1 : 0), lastLitDay: day, charcoal: kind === 'charcoal' };
}

/**
 * Bank it for the night (a rest with the fire burning, camp:banked): embers under ash from now.
 * The same fire when there is no flame. @param {Fire} f @param {number} hour @param {FireRecipe} F @returns {Fire}
 */
export function bankFire(f, hour, F) {
  return fireAt(f, hour, F).word === 'lit' ? { ...writeNights(f, hour, F), state: 'embers', sinceHour: hour, flameUntilHour: hour } : f;
}

/**
 * The fire with what the clock has done written in (embers, then cold), so the saved numbers stay
 * small and a later step reads plainly. Same answers from fireAt before and after. @param {Fire} f
 * @param {number} hour @param {FireRecipe} F @returns {Fire}
 */
export function settleFire(f, hour, F) {
  const at = fireAt(f, hour, F);
  if (at.word === f.state) return f;
  // The burn written down up to the change, which settling would otherwise lose.
  const w = writeNights(f, at.since, F);
  return { ...w, state: at.word, sinceHour: at.since, flameUntilHour: at.word === 'embers' ? at.since : f.flameUntilHour };
}
