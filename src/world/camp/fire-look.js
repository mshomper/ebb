// @ts-check
// The fire's look from its rules (the volumetric fire, Matt's fire study, October 29, 2026): how big
// the flame is shown and what drives the fire sim, from the fire worked out from the clock (fire.js).
// Pure and render-side only: never saved, never in catch-up. The fuel hours change the moment the
// player feeds, as fire.js has it; only the look waits.
//
// Two feeds:
//   'now'   as the game does today (frame.js): the flame jumps to the game's size at once and flares
//           by fire.flare, falling back over fire.flareS seconds.
//   'surge' the study's catch-then-surge (spec section 5, pending Matt): a handful takes
//           fireSim.feed.catchS to catch, holding the size it had; then it surges by flareAdd, the
//           surge and a smoke puff decaying over feed.flareS and feed.puffS, while the shown flame
//           eases toward the game's at feed.rise (rising) or feed.fall (sinking), times feed.ease.

/**
 * The flame's size the rules give, 0..1 of a high fire: lowFlame up to 1 as the fuel left climbs
 * to highH, nothing unless lit.
 * @param {{ word: string, level: number }} fireNow fireAt()
 * @param {{ lowFlame: number }} F camp.json fire
 */
export function gameFlame(fireNow, F) {
  return fireNow.word === 'lit' ? F.lowFlame + (1 - F.lowFlame) * fireNow.level : 0;
}

/** @typedef {{ flame: number, held: number, flare: number, puff: number, pending: number[], flareT: number }} FireLook */

/** @returns {FireLook} */
export function newFireLook() {
  return { flame: 0, held: 0, flare: 0, puff: 0, pending: [], flareT: 0 };
}

/**
 * A handful fed now.
 * @param {FireLook} look @param {'now' | 'surge'} mode @param {{ flareS: number }} F camp.json fire
 */
export function feedLook(look, mode, F) {
  if (mode === 'surge') { look.held = look.flame; look.pending.push(0); } else look.flareT = F.flareS;
}

/**
 * Step the look by dt real seconds toward the game's flame.
 * @param {FireLook} look
 * @param {number} dt real seconds
 * @param {number} target gameFlame() now
 * @param {'now' | 'surge'} mode
 * @param {{ flare: number, flareS: number }} F camp.json fire
 * @param {{ levelScale: number, flareAdd: number, feed: { catchS: number, flareS: number, puffS: number, rise: number, fall: number, ease: number } }} S camp.json fireSim
 * @returns {{ flame: number, level: number, flare: number, smokePuff: number, catching: boolean }}
 *   flame: the size shown (0..1, and above 1 while the 'now' flare lasts); level: what drives the
 *   sim (levelScale x flame + flareAdd x flare); flare, smokePuff: the surge and its smoke, 0..1
 */
export function stepFireLook(look, dt, target, mode, F, S) {
  if (mode === 'now') {
    look.pending.length = 0; look.flare = 0; look.puff = 0;
    look.flareT = Math.max(0, look.flareT - dt);
    look.flame = target;
    const shown = target * (1 + (F.flare - 1) * look.flareT / Math.max(1e-6, F.flareS));
    return { flame: shown, level: S.levelScale * shown, flare: 0, smokePuff: 0, catching: false };
  }
  const E = S.feed;
  for (let i = look.pending.length - 1; i >= 0; i--) {
    look.pending[i] += dt;
    if (look.pending[i] > E.catchS) { look.pending.splice(i, 1); look.flare = 1; look.puff = 1; }
  }
  look.flare *= Math.exp(-dt / E.flareS);
  look.puff *= Math.exp(-dt / E.puffS);
  const to = look.pending.length ? look.held : target;
  const rate = to > look.flame ? E.rise : E.fall;
  look.flame += (to - look.flame) * Math.min(1, rate * dt * E.ease);
  return { flame: look.flame, level: S.levelScale * look.flame + S.flareAdd * look.flare, flare: look.flare, smokePuff: look.puff, catching: look.pending.length > 0 };
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
