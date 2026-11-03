// @ts-check
// Time bends for the Hollow's fight (the moves' cinematic pass, November 3, 2026; doc 16, How the
// moves look): a hit-stop on contact (the fight nearly holds still for a few frames, sized to the hit)
// and a short slow-down on a move's peak or a thing breaking, easing back to full speed. Numbers in
// recipes/world/hollow-cine.json time. Pure.
//
// WHAT IT MAY BEND (the orchestrator's guardrail, November 3, 2026; H3b, read this first): only the
// fight's own step (the walker, the Hollow's things, the moves and their effects) and what is drawn.
// Never world time: the island's clock, its hourly simulation, catch-up, growth, creatures above and
// anything seeded keep running at full speed behind the Hollow. When H3b brings this into the game,
// step() scales the Hollow zone's fight step only; the world clock is never handed this scale. No
// seeded draw reads it either, so a replay with the same steps is the same fight. The camera, the
// light curves (cine-light.js) and the HUD keep real time.

/**
 * @param {{ stopRate: number, maxStopS: number, slowOutShare: number, on?: boolean }} T recipes/world/hollow-cine.json time
 */
export function createCineTime(T) {
  /** Hit-stop left (s, real time); the slow-down: its rate, its length and how far in. */
  let stop = 0;
  /** @type {{ rate: number, s: number, t: number } | null} */
  let slow = null;
  return {
    /** Off: every step runs at full speed (the arena's switch). */
    on: T.on ?? true,
    /**
     * Hold the fight nearly still for s seconds (a contact; the longest asked for wins, up to maxStopS).
     * @param {number} s
     */
    hitStop(s) { if (s > 0) stop = Math.min(T.maxStopS, Math.max(stop, s)); },
    /**
     * Slow the fight to rate for s seconds, easing back over the last slowOutShare of it (a peak, a
     * break). A slower one already running is kept. @param {number} s @param {number} rate 0..1
     */
    slow(s, rate) {
      if (s <= 0) return;
      if (slow && slow.rate <= rate && slow.s - slow.t >= s) return;
      slow = { rate, s, t: 0 };
    },
    /** How fast the fight runs now (1 full speed). */
    get scale() {
      if (!this.on) return 1;
      if (stop > 0) return T.stopRate;
      if (!slow) return 1;
      const u = slow.t / slow.s, out = Math.max(1e-3, T.slowOutShare);
      const k = u < 1 - out ? 0 : (u - (1 - out)) / out;
      return slow.rate + (1 - slow.rate) * k * k * (3 - 2 * k);
    },
    /**
     * The fight's step this frame from the real one, and the clocks run on in real time.
     * @param {number} realDt @returns {number}
     */
    step(realDt) {
      const k = this.scale;
      if (stop > 0) stop = Math.max(0, stop - realDt);
      else if (slow && (slow.t += realDt) >= slow.s) slow = null;
      return realDt * k;
    },
    /** Everything back to full speed (a new floor). */
    clear() { stop = 0; slow = null; },
  };
}
