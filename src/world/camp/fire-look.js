// @ts-check
// The fire's look from its rules (the volumetric fire, Matt's fire study, October 29, 2026): how big
// the flame is shown, the catch-then-surge of a handful fed, what drives the fire sim, and when the
// sim runs. Pure and render-side only: never saved, never in catch-up. The fuel hours change the
// moment the player feeds, as fire.js has it; only the look waits.
//
// A handful fed takes fire.catchS to catch, the flame holding the size it had; then it surges by
// fire.flare (a share of a high fire), the surge decaying over fire.flareS and a smoke puff over
// fireSim.feed.puffS, while the shown flame eases toward the game's at feed.rise (rising) or
// feed.fall (sinking), times feed.ease.

/**
 * The flame's size the rules give, 0..1 of a high fire: lowFlame up to 1 as the fuel left climbs
 * to highH, nothing unless lit.
 * @param {{ word: string, level: number }} fireNow fireAt()
 * @param {{ lowFlame: number }} F camp.json fire
 */
export function gameFlame(fireNow, F) {
  return fireNow.word === 'lit' ? F.lowFlame + (1 - F.lowFlame) * fireNow.level : 0;
}

/** @typedef {{ flame: number, held: number, flare: number, puff: number, pending: number[] }} FireLook */

/** @param {number} [flame] the size to start at (the camp coming into view with its fire lit) @returns {FireLook} */
export function newFireLook(flame = 0) {
  return { flame, held: flame, flare: 0, puff: 0, pending: [] };
}

/** A handful fed now: it starts to catch. @param {FireLook} look */
export function feedLook(look) {
  look.held = look.flame;
  look.pending.push(0);
}

/**
 * @typedef {{ catchS: number, flare: number, flareS: number }} FeedRecipe camp.json fire
 * @typedef {{ levelScale: number, feed: { puffS: number, rise: number, fall: number, ease: number } }} LookRecipe camp.json fireSim
 */

/**
 * Step the look by dt real seconds toward the game's flame.
 * @param {FireLook} look @param {number} dt real seconds @param {number} target gameFlame() now
 * @param {FeedRecipe} F @param {LookRecipe} S
 * @returns {{ flame: number, light: number, level: number, flare: number, smokePuff: number, catching: boolean }}
 *   flame: the size shown, 0..1; light: the fire light's share, the flame plus the surge;
 *   level: what drives the sim (levelScale x light); flare, smokePuff: the surge and its smoke, 0..1
 */
export function stepFireLook(look, dt, target, F, S) {
  const E = S.feed;
  for (let i = look.pending.length - 1; i >= 0; i--) {
    look.pending[i] += dt;
    if (look.pending[i] > F.catchS) { look.pending.splice(i, 1); look.flare = 1; look.puff = 1; }
  }
  look.flare *= Math.exp(-dt / Math.max(1e-6, F.flareS));
  look.puff *= Math.exp(-dt / Math.max(1e-6, E.puffS));
  const to = look.pending.length ? look.held : target;
  const rate = to > look.flame ? E.rise : E.fall;
  look.flame += (to - look.flame) * Math.min(1, rate * dt * E.ease);
  const light = look.flame + F.flare * look.flare;
  return { flame: look.flame, light, level: S.levelScale * light, flare: look.flare, smokePuff: look.puff, catching: look.pending.length > 0 };
}

/**
 * How many fixed sim steps this frame: the accumulator gains dt (capped at maxSteps steps' worth)
 * and gives back whole steps.
 * @param {{ acc: number }} clock @param {number} dt real seconds @param {number} stepS @param {number} maxSteps
 */
export function simSteps(clock, dt, stepS, maxSteps) {
  clock.acc = Math.min(clock.acc + dt, stepS * maxSteps);
  const n = Math.floor(clock.acc / stepS + 1e-9);
  clock.acc -= n * stepS;
  return n;
}

/**
 * Whether the fire sim runs: the tier draws it, the fire's box is in view, and the fire is lit or
 * sank to embers less than afterS seconds ago (so the last smoke drifts off).
 * @param {{ tierOn: boolean, inView: boolean, lit: boolean, sinceLitS: number, afterS: number }} o
 */
export function fireSimRuns(o) {
  return o.tierOn && o.inView && (o.lit || o.sinceLitS < o.afterS);
}
