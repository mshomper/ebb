// @ts-check
// The lean into starts and stops (walker gestures, part 1; October 24, 2026): setting off, the body
// tips forward as it pushes away and eases into the pace's own lean; stopping, it carries on forward
// a touch as the feet brake, then settles back just past upright and comes to rest. The standing
// lean (the pace's own) follows one soft spring, with extra pulls by how fast the speed changes: the tip (speeding up) and the carry
// (slowing down) come from the pace (tipDeg, carryDeg in recipes/world/figure.json gait paces and
// wade), so a creep barely shows it and a jog shows it clearly. Moving, the spring is near critical
// (no wobble mid-walk); once stopped it is softer, so the release swings back past upright once.
// The pace is read at the speed you were going (it falls off slowly), not the speed left in the last
// braking frame. Pure; live animation only.

/**
 * @param {any} L recipes/world/figure.json lean
 * @param {(speed: number) => { tipDeg: number, carryDeg: number }} paceOf the pace at a speed (body m/s), wading blended in
 */
export function createLean(L, paceOf) {
  let x = 0, v = 0, cruise = 0, fresh = true;
  /** The push off (0..1), held a moment after a quick start (holdS) so a snappy start still tips; and the brake now. */
  let push = 0, brake = 0;
  return {
    /** The lean now (degrees, forward). */
    get deg() { return x; },
    /** Start again from the next frame's lean, still (put down somewhere new). */
    reset() { fresh = true; v = 0; cruise = 0; push = 0; brake = 0; },
    /**
     * Step the spring toward the lean the pace asks for (base) plus the tip or the carry. Returns the
     * lean in degrees, forward. The walking lean easing off as you stop goes through the spring too,
     * so it is that release that swings back past upright.
     * @param {number} dt seconds @param {number} speed body m/s @param {number} accel body m/s2
     * @param {number} [base] the lean the pace and posture ask for now (degrees)
     */
    update(dt, speed, accel, base = 0) {
      cruise = Math.max(speed, cruise * Math.exp(-dt / L.cruiseFallS));
      const P = paceOf(cruise);
      const fade = L.holdS > 0 ? Math.exp(-dt / L.holdS) : 0;
      push = Math.max(Math.min(1, Math.max(0, accel) / L.accelRef), push * fade);
      brake = Math.min(1, Math.max(0, -accel) / L.brakeRef);
      // Setting off again cuts the carry of the stop before (and stopping, the push).
      if (accel > 0) brake = 0; else if (accel < 0) push = 0;
      const target = base + (push > brake ? P.tipDeg * push : P.carryDeg * brake);
      if (fresh) { fresh = false; x = target; v = 0; }
      const k = L.stiffness, c = 2 * Math.sqrt(k) * (speed > 0.05 ? L.damping : L.settleDamping);
      const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
      for (let i = 0; i < n; i++) {
        v += (k * (target - x) - c * v) * h;
        x += v * h;
      }
      return x;
    },
  };
}
