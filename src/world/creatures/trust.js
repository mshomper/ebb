// @ts-check
// Trust (S6c, doc 23): how well one frog knows you, 0..1, saved with the island and only ever
// growing. Quiet watching and food it eats earn it; it shrinks the frog's comfort ring and raises its
// calm pace (agents.js), opens naming at presence.namingTrust, and shows as a word, never a number:
// Wary, Tolerant, Curious, Familiar, Bonded (bands in recipes/species/frog.json presence).
//
// Live play records what happened as small events in the frogs' state (`pending`); the hourly tick
// applies them (coarse.js), so an hour watched, a save and a catch-up all agree. While you are away
// nothing is recorded, so trust does not change. Pure and worker-safe.

import { HOURS_PER_DAY } from '../../core/clock.js';

/** Trust words, lowest first; recipes/world/journal.json holds what each one says. */
export const TRUST_WORDS = /** @type {const} */ (['wary', 'tolerant', 'curious', 'familiar', 'bonded']);

/**
 * @typedef {{ kind: 'watched', id: number, minutes: number, hour: number }
 *   | { kind: 'fed', id: number, hour: number }
 *   | { kind: 'treat', id: number, hour: number, treat: string }
 *   | { kind: 'camp', id: number, hour: number, gain: number }} TrustEvent
 *   camp: standing presence while away (docs/future/13 CP-13), stored only in catch-up
 *   treat: a liked treat eaten (P2h, docs/future/13 section 8): presence.treatFeeds meals' worth,
 *   once per creature a game day (treatGain); a second is eaten and earns nothing
 */

/**
 * What a treat earns, and the game day it marks: feedTrust times treatFeeds, nothing if the
 * creature already had one this game day. Never scaled by appetite: a treat is eaten at once.
 * @param {any} P the species' presence recipe @param {number | undefined} lastDay @param {number} hour
 */
export function treatGain(P, lastDay, hour) {
  const day = Math.floor(hour / HOURS_PER_DAY);
  return { gain: lastDay === day ? 0 : (P.feedTrust ?? 0) * (P.treatFeeds ?? 0), day };
}

/** Rounded to four places, so saves and catch-up compare exactly. @param {number} v */
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * The word for a trust value. @param {number} trust @param {number[]} bands where Tolerant,
 * Curious, Familiar and Bonded begin @returns {typeof TRUST_WORDS[number]}
 */
export function trustWord(trust, bands) {
  let i = 0;
  while (i < bands.length && trust >= bands[i]) i++;
  return TRUST_WORDS[i];
}

/**
 * The most trust a species can reach: just under the band after its ceiling word.
 * @param {{ ceiling?: string, bands: number[] }} P the species' presence recipe
 */
export function maxTrust(P) {
  const i = TRUST_WORDS.indexOf(/** @type {any} */ (P.ceiling ?? 'bonded'));
  return i < 0 || i >= P.bands.length ? 1 : r4(P.bands[i] - 0.0001);
}

/** The longest name a frog can have. */
export const NAME_MAX = 24;

/**
 * A typed name made tidy: letters, spaces, apostrophes and hyphens only, single-spaced, at most
 * NAME_MAX long. Empty if nothing usable is left. @param {string} raw
 */
export function cleanName(raw) {
  return String(raw ?? '').replace(/[^\p{L}\p{M}' -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/**
 * Give a frog a name (S6c-3). Pure: returns a new state, or the same one if the frog is not there.
 * @param {any} state @param {number} id @param {string} name already clean @param {number} hour
 */
export function nameFrog(state, id, name, hour) {
  const F = state?.creatures?.frogs;
  if (!F || !name || !F.frogs.some((/** @type {any} */ f) => f.id === id)) return state;
  const frogs = F.frogs.map((/** @type {any} */ f) => (f.id === id ? { ...f, name, namedAt: hour } : f));
  return { ...state, creatures: { ...state.creatures, frogs: { ...F, frogs } } };
}

/**
 * Record something that earns trust, for the next hourly tick to apply. Pure: returns a new state.
 * @param {any} state the world state @param {TrustEvent} ev
 */
export function addTrustEvent(state, ev) {
  const F = state?.creatures?.frogs;
  if (!F || !F.frogs.some((/** @type {any} */ f) => f.id === ev.id)) return state;
  return { ...state, creatures: { ...state.creatures, frogs: { ...F, pending: [...(F.pending ?? []), ev] } } };
}

/**
 * How hungry a frog is for food you offer, 0..1: full just after a meal, hungry again after fullH
 * game hours. @param {{ fedAt?: number }} f @param {number} hour @param {number} fullH
 */
export function appetite(f, hour, fullH) {
  if (f.fedAt === undefined) return 1;
  return Math.max(0, Math.min(1, (hour - f.fedAt) / Math.max(1e-6, fullH)));
}

/**
 * Apply the recorded events to the frogs (on a copy the tick already made), raise every frog to the
 * test link's trust (`?trust=`, testing only), and say when a frog's word moves up. A meal earns
 * less if the frog ate within `fullH` game hours (`creature:ate` for each).
 * @param {{ frogs: any[], pending?: TrustEvent[] }} fr the frogs' state, copied (changed in place)
 * @param {any} P recipes/species/frog.json presence
 * @param {number} testTrust 0 unless `?trust=` asks for more
 * @param {number} [fullH] recipes/species/frog.json feed.fullH
 * @param {number} [boost] a tea boon's multiplier on every gain (P2e; 1 without one)
 * @returns {{ name: string, payload: any }[]} `creature:ate` and `creature:trusted` events
 */
export function applyTrust(fr, P, testTrust = 0, fullH = 6, boost = 1) {
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const top = maxTrust(P);
  const before = new Map(fr.frogs.map((f) => [f.id, f.trust ?? 0]));
  for (const ev of fr.pending ?? []) {
    const f = fr.frogs.find((g) => g.id === ev.id);
    if (!f) continue;
    let gain;
    if (ev.kind === 'watched') gain = Math.min(ev.minutes, P.watch.capS / 60) * P.watch.trustPerMin;
    else if (ev.kind === 'camp') gain = ev.gain;
    else if (ev.kind === 'treat') {
      const t = treatGain(P, f.treatDay, ev.hour);
      gain = t.gain;
      f.treatDay = t.day;
      events.push({ name: 'creature:ate', payload: { species: 'frogs', id: f.id, x: f.x, z: f.z, treat: ev.treat } });
    } else {
      gain = P.feedTrust * appetite(f, ev.hour, fullH);
      f.fedAt = ev.hour;
      events.push({ name: 'creature:ate', payload: { species: 'frogs', id: f.id, x: f.x, z: f.z } });
    }
    f.trust = r4(Math.min(top, (f.trust ?? 0) + gain * (ev.kind === 'camp' ? 1 : boost)));
  }
  fr.pending = [];
  for (const f of fr.frogs) {
    if (testTrust > (f.trust ?? 0)) { f.trust = r4(Math.min(top, testTrust)); before.set(f.id, f.trust); }
    f.trust = f.trust ?? 0;
    const was = trustWord(before.get(f.id) ?? 0, P.bands), now = trustWord(f.trust, P.bands);
    if (now !== was) events.push({ name: 'creature:trusted', payload: { species: 'frogs', id: f.id, x: f.x, z: f.z, word: now } });
  }
  return events;
}
