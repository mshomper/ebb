// @ts-check
// Frame cap (docs 04, 19): on a display faster than the tier's target (a 120 Hz phone on low at
// 30 fps), skip animation frames so the island renders at about the target rate and the phone stays
// cool. The schedule keeps whole frame periods, so 120 Hz at 30 draws every fourth frame and 144 Hz
// at 60 averages 60. On a display at or below the target every frame is drawn.
// Numbers from recipes/quality-tiers.json `frameCap`.

/** @param {{ toleranceMs: number }} recipe */
export function createFrameCap(recipe) {
  let next = -Infinity;
  return {
    /**
     * Should this animation frame be drawn?
     * @param {number} now the requestAnimationFrame time, ms
     * @param {number} targetFps the tier's target
     */
    due(now, targetFps) {
      const period = 1000 / Math.max(1, targetFps);
      if (now < next - recipe.toleranceMs) return false;
      // Keep to the schedule; start a fresh one after a stall (a hidden tab, a long frame).
      next = now - next > period ? now + period : next + period;
      return true;
    },
    /** Start the schedule again (a tier change). */
    reset() { next = -Infinity; },
  };
}
