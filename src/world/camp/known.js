// @ts-check
// A known place (docs/future/13 C-36; B1 C1): over the seasons, creatures near camp let you a little
// closer. `known` (0..1) grows by perSeason for each season in which you rested at camp at least
// restsPerSeason times, and never falls. Within reachM of the pad's center every creature's comfort
// ring is multiplied by 1 - (1 - ringAtFull) * known (src/world/creatures/presence.js ringScale reads
// it through the walker's presence source). Saved in the camp section as `known`. Pure.
// Numbers: recipes/world/camp.json `known`.

/**
 * @typedef {{ level: number, season: number, rests: number, counted: boolean }} Known
 *   level: 0..1; season: the season the rests are counted in (year * 4 + index, -1 before the first);
 *   rests: rests at camp in it so far; counted: whether that season already raised the level
 * @typedef {{ x: number, z: number, r: number, k: number }} KnownRing
 *   within r of (x, z), comfort rings are multiplied by k
 */

/** @returns {Known} */
export const noKnown = () => ({ level: 0, season: -1, rests: 0, counted: false });

/** A saved (or missing) known record made safe. @param {any} v @returns {Known} */
export function cleanKnown(v) {
  if (!v || typeof v !== 'object') return noKnown();
  const level = Number.isFinite(v.level) ? Math.min(1, Math.max(0, v.level)) : 0;
  return { level, season: Number.isInteger(v.season) ? v.season : -1, rests: Number.isInteger(v.rests) && v.rests > 0 ? v.rests : 0, counted: !!v.counted };
}

/** The season's key: year * 4 + index. @param {{ year?: number, index?: number } | null | undefined} s */
export const seasonKey = (s) => (s ? (s.year ?? 0) * 4 + (s.index ?? 0) : 0);

/**
 * A rest at camp counted. The first restsPerSeason-th rest of a season raises the level by perSeason,
 * up to 1; later rests that season change nothing more. A new season starts its count again.
 * @param {Known} k @param {number} season seasonKey @param {{ perSeason: number, restsPerSeason: number }} R
 * @returns {{ known: Known, rose: boolean }} rose: the level went up with this rest
 */
export function noteRest(k, season, R) {
  const fresh = season !== k.season;
  const rests = (fresh ? 0 : k.rests) + 1, counted = fresh ? false : k.counted;
  if (!counted && rests >= R.restsPerSeason && k.level < 1) {
    return { known: { level: Math.min(1, k.level + R.perSeason), season, rests, counted: true }, rose: true };
  }
  return { known: { level: k.level, season, rests, counted: counted || rests >= R.restsPerSeason }, rose: false };
}

/** The share a comfort ring is multiplied by at this level. @param {number} level @param {{ ringAtFull: number }} R */
export const ringShare = (level, R) => 1 - (1 - R.ringAtFull) * Math.min(1, Math.max(0, level));

/**
 * The known place's ring for presence, or null (no pad, or nothing known yet).
 * @param {{ x: number, z: number } | null} pad @param {Known} k @param {{ reachM: number, ringAtFull: number }} R
 * @returns {KnownRing | null}
 */
export function knownRing(pad, k, R) {
  if (!pad || !(k.level > 0)) return null;
  return { x: pad.x, z: pad.z, r: R.reachM, k: ringShare(k.level, R) };
}

