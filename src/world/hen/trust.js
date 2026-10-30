// @ts-check
// The hen's trust and Fond (docs/future/15, slice 2): how well she knows the walker, saved with the
// island as state.creatures.hens, and only ever growing. It is F13's trust, as the frogs': quiet
// watching and treats earn it (one treat a game day), it shows as a word, never a number, and she
// can be named at presence.namingTrust. Her words are Wary, Tolerant, Curious and Familiar
// (presence.bands, ceiling Familiar), then a fifth, hers alone: Fond. Fond is time together, never a
// count of treats: fond.days game days at Familiar, on fond.togetherDays of them with the walker near
// her for fond.nearHours game hours or more. One morning after (fond.featherAfterDays, from
// fond.featherH) she leaves a tail feather at camp: taken up, it is the hen-feather hat band.
//
// Live play records what happened as small events (`pending`); the hourly tick applies them
// (coarseStep, after the swarms), so an hour watched, a save and a catch-up all agree. While you are
// away nothing is recorded: the days still pass, but none of them is a day together. Pure and
// worker-safe. Numbers: recipes/species/hen.json presence and fond.

import { HOURS_PER_DAY } from '../../core/clock.js';
import { trustWord, maxTrust, treatGain } from '../creatures/trust.js';

/** Her words, lowest first; recipes/world/journal.json hens.trust.words holds how each reads. */
export const HEN_WORDS = /** @type {const} */ (['wary', 'tolerant', 'curious', 'familiar', 'fond']);

/** @typedef {typeof HEN_WORDS[number]} HenWord */

/**
 * @typedef {{ kind: 'watched', minutes: number, hour: number }
 *   | { kind: 'treat', hour: number, treat: string }
 *   | { kind: 'near', h: number, hour: number }} HenEvent
 *   watched: a stretch of quiet watching (real minutes); treat: a liked treat she ate; near: game
 *   hours the walker spent near her, for Fond's days together
 */

/**
 * @typedef {{ trust: number, since: number, day: number, nearH: number, famDays: number, together: number,
 *   pending?: HenEvent[], treatDay?: number, name?: string, namedAt?: number, fond?: number,
 *   feather?: { at: number, taken?: number }, at?: number[], roost?: 'scrub'|'perch' }} HenState
 *   since: the game hour she was first out; day: the game day being counted, nearH its hours near;
 *   famDays, together: whole days at Familiar, and of those the days together; fond: the hour she
 *   became Fond; feather: the hour her tail feather was laid, and taken; at: where she was last seen [x, z];
 *   roost (slice 3): where she last roosted, 'scrub' or 'perch' (older saves have none)
 */

/**
 * Where she roosted tonight, kept so a load at night puts her back on it. Pure: a new state, or the
 * same one. @param {any} state @param {'scrub'|'perch'} where
 */
export function henRoosted(state, where) {
  const H = state?.creatures?.hens;
  if (!H || H.roost === where) return state;
  return { ...state, creatures: { ...state.creatures, hens: { ...H, roost: where } } };
}

/** Rounded to four places, so saves and catch-up compare exactly. @param {number} v */
const r4 = (v) => Math.round(v * 10000) / 10000;

/** The game day of a game hour. @param {number} hour */
export const dayOf = (hour) => Math.floor(hour / HOURS_PER_DAY);

/** A new hen's state, the hour she is first out. @param {number} hour @returns {HenState} */
export const newHen = (hour) => ({ trust: 0, since: hour, day: dayOf(hour), nearH: 0, famDays: 0, together: 0 });

/**
 * Her word now: Fond once she is, else the word her trust reaches (never past Familiar).
 * @param {HenState | undefined | null} H @param {{ bands: number[] }} P recipes/species/hen.json presence
 * @returns {HenWord}
 */
export function henWord(H, P) {
  if (H?.fond !== undefined) return 'fond';
  return /** @type {HenWord} */ (trustWord(H?.trust ?? 0, P.bands));
}

/** Her band as a number, 0 Wary to 4 Fond. @param {HenState | undefined | null} H @param {any} P */
export const henBand = (H, P) => HEN_WORDS.indexOf(henWord(H, P));

/** Is she at Familiar (or past it)? @param {HenState} H @param {any} P */
const familiar = (H, P) => (H.trust ?? 0) >= P.bands[P.bands.length - 1];

/**
 * Make sure the island keeps her (the first time she is out). Pure: a new state, or the same one.
 * @param {any} state @param {number} hour
 */
export function ensureHen(state, hour) {
  if (state?.creatures?.hens) return state;
  return { ...state, creatures: { ...(state?.creatures ?? {}), hens: newHen(hour) } };
}

/**
 * Record something for the next hourly tick to apply. Pure: a new state (she is kept from now on).
 * @param {any} state @param {HenEvent} ev
 */
export function addHenEvent(state, ev) {
  const s = ensureHen(state, ev.hour);
  const H = s.creatures.hens;
  return { ...s, creatures: { ...s.creatures, hens: { ...H, pending: [...(H.pending ?? []), ev] } } };
}

/**
 * Where she was last seen, kept for her page's Show me. Pure. @param {any} state @param {number} x @param {number} z
 */
export function henSeenAt(state, x, z) {
  const H = state?.creatures?.hens;
  if (!H) return state;
  const at = [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  if (H.at && H.at[0] === at[0] && H.at[1] === at[1]) return state;
  return { ...state, creatures: { ...state.creatures, hens: { ...H, at } } };
}

/**
 * Close the days up to `day`: each whole day at Familiar counts toward Fond, and a day together is
 * one with fond.nearHours or more near her. Days with nothing recorded (away, or apart) still pass.
 * Changes H in place. @param {HenState} H @param {any} P @param {any} F recipes/species/hen.json fond @param {number} day
 */
function rollDays(H, P, F, day) {
  if (day <= H.day) return;
  if (familiar(H, P)) {
    H.famDays += day - H.day;
    if (H.nearH >= F.nearHours) H.together += 1;
  }
  H.day = day;
  H.nearH = 0;
}

/**
 * Apply the recorded events (on a copy the tick made), raise her to a test link's trust (`&trust=`)
 * or make her Fond (`&fond`), and say what changed: `creature:ate` for a treat, `creature:trusted`
 * when her word moves up, `creature:fond` the hour she becomes Fond, `hen:feather` the morning her
 * feather is laid.
 * @param {HenState} H changed in place @param {any} R recipes/species/hen.json @param {number} hour the game hour now
 * @param {{ testTrust?: number, testFond?: boolean, boost?: number }} [t] boost: a tea boon's multiplier (P2e)
 * @returns {{ name: string, payload: any }[]}
 */
export function applyHen(H, R, hour, t = {}) {
  const P = R.presence, F = R.fond, boost = t.boost ?? 1;
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const top = maxTrust(P);
  const was = henWord(H, P);
  for (const ev of H.pending ?? []) {
    rollDays(H, P, F, dayOf(ev.hour));
    if (ev.kind === 'watched') H.trust = r4(Math.min(top, H.trust + Math.min(ev.minutes, P.watch.capS / 60) * P.watch.trustPerMin * boost));
    else if (ev.kind === 'treat') {
      const g = treatGain(P, H.treatDay, ev.hour, ev.treat);
      H.trust = r4(Math.min(top, H.trust + g.gain * boost));
      H.treatDay = g.day;
      events.push({ name: 'creature:ate', payload: { species: 'hens', treat: ev.treat } });
    } else if (ev.kind === 'near' && dayOf(ev.hour) === H.day) H.nearH = r4(H.nearH + Math.max(0, ev.h));
  }
  H.pending = [];
  rollDays(H, P, F, dayOf(hour));
  if ((t.testTrust ?? 0) > H.trust) H.trust = r4(Math.min(top, /** @type {number} */ (t.testTrust)));
  if (H.fond === undefined && (t.testFond || (H.famDays >= F.days && H.together >= F.togetherDays))) {
    H.trust = top;
    H.fond = hour;
    events.push({ name: 'creature:fond', payload: { species: 'hens' } });
  }
  // Her tail feather: laid at dawn, fond.featherAfterDays mornings after she became Fond (at once
  // with the test link). It lies by the fire ring until you take it up.
  if (H.fond !== undefined && !H.feather) {
    const day = dayOf(hour), h = hour - day * HOURS_PER_DAY;
    if (t.testFond || (day >= dayOf(H.fond) + F.featherAfterDays && h >= F.featherH)) {
      H.feather = { at: hour };
      events.push({ name: 'hen:feather', payload: { species: 'hens', hour } });
    }
  }
  const now = henWord(H, P);
  if (now !== was) events.push({ name: 'creature:trusted', payload: { species: 'hens', word: now } });
  return events;
}

/**
 * Her hour in the shared tick: apply what live play recorded. Skips until she has been out.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  const R = env?.recipes?.species?.hen;
  const H0 = state?.creatures?.hens;
  if (!H0 || !R?.presence || !R.fond) return { state, events: [] };
  /** @type {HenState} */ const H = { ...H0, pending: [...(H0.pending ?? [])] };
  const events = applyHen(H, R, hourIndex, { testTrust: env.testTrust ?? 0, testFond: !!env.testFond, boost: env.trustBoost ?? 1 });
  return { state: { ...state, creatures: { ...state.creatures, hens: H } }, events };
}

/**
 * Give her a name, once she knows you well enough (presence.namingTrust). Pure: a new state, or the
 * same one if she cannot be named (not out, already named, not trusting enough).
 * @param {any} state @param {string} name already clean @param {number} hour @param {any} P recipes/species/hen.json presence
 */
export function nameHen(state, name, hour, P) {
  const H = state?.creatures?.hens;
  if (!H || !name || H.name || (H.trust ?? 0) < P.namingTrust) return state;
  return { ...state, creatures: { ...state.creatures, hens: { ...H, name, namedAt: hour } } };
}

/**
 * The feather taken up (its card's Take up): kept as taken. Pure: a new state, or the same one if
 * there is no feather lying. @param {any} state @param {number} hour
 */
export function takeFeather(state, hour) {
  const H = state?.creatures?.hens;
  if (!H?.feather || H.feather.taken !== undefined) return state;
  return { ...state, creatures: { ...state.creatures, hens: { ...H, feather: { ...H.feather, taken: hour } } } };
}

/** Is her feather lying at camp now? @param {HenState | undefined | null} H */
export const featherLying = (H) => !!H?.feather && H.feather.taken === undefined;

/**
 * Fond's progress, for her card's tools and the tests: days at Familiar, days together, and what
 * Fond asks for. @param {HenState | undefined | null} H @param {any} F recipes/species/hen.json fond
 */
export const fondProgress = (H, F) => ({ famDays: H?.famDays ?? 0, together: H?.together ?? 0, days: F.days, togetherDays: F.togetherDays, fond: H?.fond !== undefined });
