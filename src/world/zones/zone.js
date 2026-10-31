// @ts-check
// Zones, pure (docs/26-zones.md): a place you go to from the island and come back from (the spring's
// cave first; the sea cave, doc 16, and the Hollow later). Going is a fade to black, a swap while
// the screen is dark, and a fade back in; coming back is the same the other way. This file is the
// fade's clock and the store slice's shape; src/world/zones/live.js runs it. Numbers:
// recipes/world/zones.json.

/**
 * @typedef {'idle' | 'out' | 'hold' | 'in'} Phase
 * @typedef {{ phase: Phase, t: number, to: string | null, from: string | null }} Fade
 *   to: the zone being entered (null: back to the island); from: the zone being left
 */

/** No fade going. @returns {Fade} */
export const idleFade = () => ({ phase: 'idle', t: 0, to: null, from: null });

/**
 * The fade a step later: out to black over fadeS, held black holdS (the swap happens as the hold
 * begins), in over fadeS. Returns the next fade and whether the swap is due this step.
 * @param {Fade} f @param {number} dt real seconds @param {{ fadeS: number, holdS: number }} R
 * @returns {{ fade: Fade, swap: boolean, done: boolean }}
 */
export function stepFade(f, dt, R) {
  if (f.phase === 'idle') return { fade: f, swap: false, done: false };
  const t = f.t + dt;
  if (f.phase === 'out') return t >= R.fadeS ? { fade: { ...f, phase: 'hold', t: 0 }, swap: true, done: false } : { fade: { ...f, t }, swap: false, done: false };
  if (f.phase === 'hold') return t >= R.holdS ? { fade: { ...f, phase: 'in', t: 0 }, swap: false, done: false } : { fade: { ...f, t }, swap: false, done: false };
  return t >= R.fadeS ? { fade: idleFade(), swap: false, done: true } : { fade: { ...f, t }, swap: false, done: false };
}

/** How dark the screen is (0 clear, 1 black), eased. @param {Fade} f @param {{ fadeS: number }} R */
export function darkness(f, R) {
  const k = Math.min(1, f.t / Math.max(1e-3, R.fadeS)), e = k * k * (3 - 2 * k);
  return f.phase === 'out' ? e : f.phase === 'hold' ? 1 : f.phase === 'in' ? 1 - e : 0;
}

/**
 * Start a fade toward a zone (or back to the island with `to` null), unless one is going already.
 * @param {Fade} f @param {string | null} to @param {string | null} current the zone you are in now
 * @returns {Fade}
 */
export function startFade(f, to, current) {
  if (f.phase !== 'idle' || to === current) return f;
  return { phase: 'out', t: 0, to, from: current };
}
