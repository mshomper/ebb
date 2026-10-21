// @ts-check
// The walker's eyes (doc 23, W5): two cream ovals the shader draws on the head. Here is only their
// state: a blink every few seconds (from a hash of the beat, never random, so the tools page plays
// the same every time), and an expression that eases in over a fifth of a second, holds, and eases
// back to open: happy (soft upturned arcs), curious (one eye a touch taller), sleepy (half lids),
// surprised (rounder). Pure; live animation only.

import { hash32 } from '../../core/rng.js';

/** @typedef {'open' | 'happy' | 'curious' | 'sleepy' | 'surprised'} Expression */

const unit = (/** @type {number} */ h) => (h >>> 8) / 16777216;

/**
 * How closed the eyes are from blinking at time t (0 open, 1 shut): blinks every everyS[0] to
 * everyS[1] seconds, each lasting s.
 * @param {number} t seconds @param {{ everyS: number[], s: number }} B @param {number} [seed]
 */
export function blinkAt(t, B, seed = 7) {
  // Time in beats of the mean gap; each beat holds one blink at a hashed spot, kept far enough from
  // the beat's edges that blinks stay between everyS[0] and everyS[1] apart.
  const mean = (B.everyS[0] + B.everyS[1]) / 2, spread = (B.everyS[1] - B.everyS[0]) / 2;
  const k = Math.floor(t / mean);
  for (const j of [k - 1, k]) {
    const start = j * mean + (mean - spread) / 2 + spread * unit(hash32(seed, j));
    const u = (t - start) / B.s;
    if (u >= 0 && u <= 1) return Math.sin(Math.PI * u);
  }
  return 0;
}

/**
 * @param {any} E recipes/world/figure.json eyes
 */
export function createEyes(E) {
  let t = 0;
  /** @type {Expression} */ let want = 'open';
  let holdUntil = Infinity;
  // Each expression's share now, eased toward 1 for the one wanted and 0 for the rest.
  const share = { happy: 0, curious: 0, sleepy: 0, surprised: 0 };
  return {
    /**
     * Show an expression: held for holdS (from the recipe) and then back to open, or for as long as
     * `forS` says (Infinity: until another is asked). @param {Expression} e @param {number} [forS]
     */
    show(e, forS) {
      want = e;
      holdUntil = e === 'open' ? Infinity : t + (forS ?? E.holdS?.[e] ?? 2);
    },
    get expression() { return want; },
    /**
     * Step time, and the shader's numbers: [lid left, lid right, happy, round, size left, size right].
     * @param {number} dt @param {{ sleepy?: boolean }} [o] sleepy: hold half lids (sitting at night)
     */
    update(dt, o = {}) {
      t += dt;
      if (t > holdUntil) { want = 'open'; holdUntil = Infinity; }
      const rate = dt / Math.max(E.expressionS, 1e-3);
      for (const k of /** @type {(keyof typeof share)[]} */ (Object.keys(share))) {
        const goal = k === want || (k === 'sleepy' && o.sleepy && want === 'open') ? 1 : 0;
        share[k] += Math.max(-rate, Math.min(rate, goal - share[k]));
      }
      // No blinking while the arcs show (they are closed eyes already).
      const blink = blinkAt(t, E.blink) * (1 - share.happy);
      const lid = Math.max(blink, 0.45 * share.sleepy);
      return [lid, lid, share.happy, share.surprised, 1 + 0.14 * share.curious, 1 - 0.06 * share.curious];
    },
  };
}
