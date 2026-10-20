// @ts-check
// Trust (S6c, doc 23): how well one frog knows you, 0..1, saved with the island and only ever
// growing. Quiet watching and food it eats earn it; it shrinks the frog's comfort ring and raises its
// calm pace (agents.js), opens naming at presence.namingTrust, and shows as a word, never a number:
// Wary, Tolerant, Curious, Familiar, Bonded (bands in recipes/species/frog.json presence).
//
// Live play records what happened as small events in the frogs' state (`pending`); the hourly tick
// applies them (coarse.js), so an hour watched, a save and a catch-up all agree. While you are away
// nothing is recorded, so trust does not change. Pure and worker-safe.

/** Trust words, lowest first; recipes/world/journal.json holds what each one says. */
export const TRUST_WORDS = /** @type {const} */ (['wary', 'tolerant', 'curious', 'familiar', 'bonded']);

/**
 * @typedef {{ kind: 'watched', id: number, minutes: number, hour: number }
 *   | { kind: 'fed', id: number, hour: number }} TrustEvent
 */

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
 * Apply the recorded events to the frogs (on a copy the tick already made), raise every frog to the
 * test link's trust (`?trust=`, testing only), and say when a frog's word moves up.
 * @param {{ frogs: any[], pending?: TrustEvent[] }} fr the frogs' state, copied (changed in place)
 * @param {any} P recipes/species/frog.json presence
 * @param {number} testTrust 0 unless `?trust=` asks for more
 * @returns {{ name: string, payload: any }[]} `creature:trusted` events
 */
export function applyTrust(fr, P, testTrust = 0) {
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const top = maxTrust(P);
  const before = new Map(fr.frogs.map((f) => [f.id, f.trust ?? 0]));
  for (const ev of fr.pending ?? []) {
    const f = fr.frogs.find((g) => g.id === ev.id);
    if (!f) continue;
    const gain = ev.kind === 'watched' ? Math.min(ev.minutes, P.watch.capS / 60) * P.watch.trustPerMin : P.feedTrust;
    f.trust = r4(Math.min(top, (f.trust ?? 0) + gain));
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
