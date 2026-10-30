// @ts-check
// The hen's eggs (docs/future/15, slice 4): she lays by day length, as real hens do. The sun model
// gives each day's length (sun-moon.js, lagDays before: layDayLength); none below eggs.dayLengthH[0], her best (one
// egg every bestEveryDays) from dayLengthH[1] up, in proportion between, so most in late spring and
// summer, a few at the edges of spring and autumn, none in winter. Each game day at eggs.layH a
// seeded roll says whether she lays; through her autumn moult (eggs.moult) she lays none and a
// moulted feather lies by her roost. Before Familiar she lays in a scrape under the scrub bush she
// roosts in; from Familiar, once the nest box stands at camp (live play records it: henBoxBuilt), in
// the box. Eggs wait there, nestMax at most, until you take them. Run in the hourly tick after her
// trust, so live play, a save and a catch-up lay the same eggs. Pure and worker-safe. Never fed to
// any creature. Numbers: recipes/species/hen.json eggs.

import { hash32, subSeed } from '../../core/rng.js';
import { sunMoon } from '../sky/sun-moon.js';
import { HOURS_PER_DAY, DAYS_PER_SEASON, SEASONS_PER_YEAR } from '../../core/clock.js';
import { scrubHome } from './life.js';
import { roostBush } from './day.js';

/**
 * @typedef {{ eggs: number, where: 'scrape'|'box', laid: number, last?: number, scrape?: number[],
 *   moult?: { from: number, at?: number[] } }} Nest
 *   eggs: waiting now; where: the scrape or the box; laid: all she has laid; last: the game day of
 *   the last; scrape: where her scrape is [x, z]; moult: the day her moult began and where its feather lies
 */

/**
 * Her laying share for a day length: 0 below dayLengthH[0], 1 from dayLengthH[1], in proportion
 * between. @param {any} E recipes/species/hen.json eggs @param {number} dayLengthH
 */
export function layingShare(E, dayLengthH) {
  const [lo, hi] = E.dayLengthH;
  return Math.max(0, Math.min(1, (dayLengthH - lo) / (hi - lo)));
}

/**
 * The day length her laying answers to on a game day: the sun's, lagDays before (a hen answers the
 * season's light some days late, so she still lays at the start of autumn and not at the end of
 * winter, though their days are as long). @param {any} E @param {number} day
 * @param {{ latitudeDeg?: number, tiltDeg?: number }} [sunOpts] as the seasons step uses (seasons.js sunOptsOf)
 */
export const layDayLength = (E, day, sunOpts) => sunMoon(((day - (E.lagDays ?? 0)) * HOURS_PER_DAY + 12) * 3600, sunOpts).dayLengthH;

/** A game day's place in the year as a season position, 0 spring .. 4. @param {number} day */
export const seasonPosOf = (day) => ((day % (DAYS_PER_SEASON * SEASONS_PER_YEAR)) + DAYS_PER_SEASON * SEASONS_PER_YEAR) % (DAYS_PER_SEASON * SEASONS_PER_YEAR) / DAYS_PER_SEASON;

/** Is she in her autumn moult on this game day? @param {any} E @param {number} day */
export const moulting = (E, day) => { const p = seasonPosOf(day); return p >= E.moult[0] && p < E.moult[1]; };

/**
 * Does she lay on this game day? The chance is her best rate times her laying share; the roll is
 * seeded by the day, so the same island lays the same eggs. @param {any} E @param {number} seed
 * @param {number} day @param {number} dayLengthH
 */
export function laysOn(E, seed, day, dayLengthH) {
  if (moulting(E, day)) return false;
  const p = layingShare(E, dayLengthH) / E.bestEveryDays;
  return p > 0 && (hash32(seed >>> 0, day >>> 0, 0xe66) / 0x100000000) < p;
}

/**
 * Where her scrape is: under the scrub bush she roosts in, scrapeM toward its edge on the side away
 * from her home's middle (or by where she was last seen, with no scrub). Pure.
 * @param {any} R recipes/species/hen.json @param {any} state
 * @returns {number[] | null} [x, z]
 */
export function scrapeSpot(R, state) {
  const home = scrubHome(state?.growth?.plants ?? [], R.home);
  if (home) {
    const b = roostBush(home, home.list);
    if (b) {
      const dx = b.x - home.x, dz = b.z - home.z, l = Math.hypot(dx, dz);
      const ux = l > 1e-3 ? dx / l : 1, uz = l > 1e-3 ? dz / l : 0;
      return [Math.round((b.x + ux * R.eggs.scrapeM) * 100) / 100, Math.round((b.z + uz * R.eggs.scrapeM) * 100) / 100];
    }
  }
  const at = state?.creatures?.hens?.at;
  return at ? [Math.round((at[0] + R.eggs.scrapeM) * 100) / 100, at[1]] : null;
}

/**
 * Her hour of eggs, on the hen state the tick copied (changed in place): at layH on a laying day an
 * egg in the scrape (before Familiar, or with no nest box) or the box; the moult's start and end.
 * Says what happened: `hen:laid` { where, eggs }, `hen:moult` { at } the day her moult begins.
 * @param {any} H changed in place @param {any} R recipes/species/hen.json @param {number} hour
 * @param {any} state the world state (growth, her sightings) @param {number} seed the world seed
 * @param {{ latitudeDeg?: number, tiltDeg?: number }} [sunOpts] the seasons step's sun options
 * @returns {{ name: string, payload: any }[]}
 */
export function applyEggs(H, R, hour, state, seed, sunOpts) {
  const E = R.eggs;
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  if (!E) return events;
  const day = Math.floor(hour / HOURS_PER_DAY), h = hour - day * HOURS_PER_DAY;
  const fam = (H.trust ?? 0) >= R.presence.bands[R.presence.bands.length - 1] || H.fond !== undefined;
  /** @type {Nest} */ const N = { eggs: 0, where: 'scrape', laid: 0, ...(H.nest ?? {}) };
  // Her moult: its feather by the roost for the moult's days, then gone.
  if (moulting(E, day)) {
    if (!N.moult || day - N.moult.from > DAYS_PER_SEASON) {
      const at = scrapeSpot(R, state);
      N.moult = { from: day, ...(at ? { at } : {}) };
      events.push({ name: 'hen:moult', payload: { species: 'hens', hour } });
    }
  } else if (N.moult && h >= E.layH) delete N.moult;
  if (h === E.layH && N.last !== day && laysOn(E, subSeed(seed, 'hen-eggs'), day, layDayLength(E, day, sunOpts))) {
    // The box once she is Familiar and it stands; else her scrape. Eggs left in the scrape stay there.
    const where = fam && H.box ? 'box' : 'scrape';
    if (where !== N.where && N.eggs === 0) N.where = where;
    if (where === N.where && N.eggs < E.nestMax) {
      if (where === 'scrape' && !N.scrape) { const at = scrapeSpot(R, state); if (at) N.scrape = at; }
      N.eggs += 1; N.laid += 1; N.last = day;
      events.push({ name: 'hen:laid', payload: { species: 'hens', where, eggs: N.eggs, hour } });
    }
  }
  H.nest = N;
  return events;
}

/**
 * The nest box stands at camp (live play, camp:placed): kept with her, so the tick knows. Pure: a
 * new state, or the same one (before she is out, or already kept). @param {any} state
 */
export function henBoxBuilt(state) {
  const H = state?.creatures?.hens;
  if (!H || H.box) return state;
  return { ...state, creatures: { ...state.creatures, hens: { ...H, box: true } } };
}

/**
 * An egg taken from her nest (its card's Take an egg). Pure: a new state, or the same one when there
 * is none. @param {any} state
 */
export function takeEgg(state) {
  const H = state?.creatures?.hens;
  if (!H?.nest || (H.nest.eggs ?? 0) <= 0) return state;
  return { ...state, creatures: { ...state.creatures, hens: { ...H, nest: { ...H.nest, eggs: H.nest.eggs - 1 } } } };
}

/** Her nest now (eggs waiting, where), or null before she has one. @param {any} H */
export const nestOf = (H) => (H?.nest ? /** @type {Nest} */ (H.nest) : null);
