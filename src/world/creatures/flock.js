// @ts-check
// Flocks on shaped ground in the hourly tick (B3: the turnstones first, the purple sandpipers next):
// species whose recipe says ecology.kind 'flock'. Their home is not a pool the needs grid finds but
// ground the player shaped (doc 13 'Shaped, not found'), measured live (src/world/ecology/shaped.js)
// and recorded on the flock's state as `home` (src/app/turnstones.js): whether it is met, how much
// of it there is (metres of wrack for the turnstones) and where. Each hour that home is handed to
// the schools' own step (swarms.js swarmStep) as their one pool, so a flock comes, settles, grows,
// grows uneasy and leaves with the same events, trust and journal notes as the minnows. Pure and
// worker-safe; nothing happens until a home has been recorded, so an island without one keeps the
// same hash.
//
// State (state.creatures[key]): swarms.js SwarmState, plus
//   home  { met: boolean, m: number, x: number, z: number }  the last measured home (absent: none yet)

import { HABITAT_CELLS, HABITAT_ORIGIN } from '../growth/habitat.js';
import { SPECIES, keyOf } from '../species.js';
import { swarmStep, initialSwarm } from './swarms.js';
import { maxTrust } from './trust.js';

/** The recipes that live as flocks on shaped ground. @param {Record<string, any> | undefined} species */
export const flockSpecies = (species) => SPECIES.map((id) => species?.[id]).filter((r) => r?.ecology?.kind === 'flock');

/** The habitat square of a world point (clamped to the grid). @param {number} x @param {number} z */
export function squareOf(x, z) {
  const n = HABITAT_CELLS;
  const i = Math.max(0, Math.min(n - 1, Math.floor(x - HABITAT_ORIGIN))), j = Math.max(0, Math.min(n - 1, Math.floor(z - HABITAT_ORIGIN)));
  return j * n + i;
}

/**
 * The home as the schools' step reads a pool: met scores 1, else 0 (a home gone, as a pool drained,
 * starts their grace); room is its amount (metres of wrack), so arrival.m2PerOne is metres a bird.
 * @param {{ met: boolean, m: number, x: number, z: number }} home @param {number[]} groups the flock's group ids
 */
export function homePool(home, groups) {
  const k = squareOf(home.x, home.z);
  return { id: 1, area: home.m, room: home.m, deepCm: 0, deepK: k, best: k, bestScore: home.met ? 1 : 0, groups, weed: 0, low: 'wrack' };
}

/**
 * Record what the live watch measured (pure: a new state, or the same one when nothing changed).
 * A flock's state is made only once a home is first met. Amounts are kept to whole metres.
 * @param {any} state @param {string} key @param {{ met: boolean, m: number, x: number, z: number }} home
 */
export function recordHome(state, key, home) {
  const prev = state?.creatures?.[key];
  if (!prev && !home.met) return state;
  const h = { met: !!home.met, m: Math.round(home.m), x: Math.round(home.x * 10) / 10, z: Math.round(home.z * 10) / 10 };
  const o = prev?.home;
  if (o && o.met === h.met && o.m === h.m && Math.hypot(o.x - h.x, o.z - h.z) < 2) return state;
  const S = prev ?? initialSwarm();
  return { ...state, creatures: { ...(state.creatures ?? {}), [key]: { ...S, home: h } } };
}

/**
 * One flock species' hour: its home as a pool, then the schools' step. A settled group stays at
 * its home's spot. @param {any} state @param {number} hourIndex @param {any} env @param {any} rec
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function flockStep(state, hourIndex, env, rec) {
  const key = keyOf(rec);
  const S = state.creatures?.[key];
  if (!S?.home) return { state, events: [] };
  const pool = homePool(S.home, (S.groups ?? []).map((/** @type {any} */ g) => g.id));
  // The pool stands in for the needs grid's answer this hour only; it is never kept.
  const eco = { score: { length: HABITAT_CELLS * HABITAT_CELLS }, pools: [pool] };
  const lent = { ...state, ecology: { ...(state.ecology ?? {}), [key]: eco } };
  const r = swarmStep(lent, hourIndex, env, rec);
  const out = { ...r.state, ecology: state.ecology };
  if (state.ecology === undefined) delete out.ecology;
  return { state: out, events: r.events };
}

/**
 * Every flock species' hour, in the species list's order.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  for (const rec of flockSpecies(env.recipes?.species)) {
    const r = flockStep(state, hourIndex, env, rec);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/**
 * A test shortcut (`?turnstones`, src/app/turnstones.js), never used by the game itself: a flock
 * of `count` comes now and is settled at (x, z), its home met. Pure; returns the tick's events.
 * @param {any} state @param {number} hourIndex @param {any} env @param {any} rec @param {number} count @param {number} x @param {number} z
 */
export function bringFlock(state, hourIndex, env, rec, count, x, z) {
  const key = keyOf(rec);
  const prev = state.creatures?.[key] ?? initialSwarm();
  const S = { ...prev, groups: prev.groups.map((/** @type {any} */ g) => ({ ...g })), home: { met: true, m: Math.max(prev.home?.m ?? 0, count * rec.ecology.arrival.m2PerOne), x, z } };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  if (!S.groups.length) {
    const id = S.nextId++;
    S.groups.push({ id, k: squareOf(x, z), x, z, count, mood: 1, low: 0, since: hourIndex });
    S.arrivals++;
    if (!S.right) { S.right = true; events.push({ name: 'creature:habitat-right', payload: { species: key, x, z } }); }
    events.push({ name: 'creature:arrived', payload: { species: key, id, x, z, scout: true, count } });
    events.push({ name: 'creature:settled', payload: { species: key, id, x, z, count } });
  }
  S.phase = 'settled';
  S.rightFor = Math.max(S.rightFor, rec.ecology.arrival.scoutAfterH);
  const P = rec.presence;
  if ((env.testTrust ?? 0) > (S.trust ?? 0) && P?.bands) S.trust = Math.min(maxTrust(P), env.testTrust);
  return { state: { ...state, creatures: { ...(state.creatures ?? {}), [key]: S } }, events };
}
