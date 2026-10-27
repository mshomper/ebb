// @ts-check
// The lantern is health (doc 16, The lantern; Matt, October 27, 2026): one thing to watch, the flame
// itself. It burns down as you go, faster held up (the right mouse), and a hit costs a sip. Snuffed
// (the Snuff move) it shrinks to an ember and burns nothing. Its reach is how far its light goes;
// held up it reaches further. Pure.

/**
 * @param {{ fuel: number, burnPerS: number, raisedBurnPerS: number, sipFuel: number, reachM: number, raisedReachM: number, emberReachM: number, raiseS: number }} L
 *   recipes/world/hollow.json lantern
 */
export function createLantern(L) {
  let fuel = L.fuel, raised = false, snuffed = false, lift = 0;
  return {
    get fuel() { return fuel; },
    /** 0..1 of a full lantern. */
    get share() { return Math.max(0, fuel / L.fuel); },
    get out() { return fuel <= 0; },
    get raised() { return raised; },
    get snuffed() { return snuffed; },
    /** How far up it is, 0 hanging to 1 held up (eased over raiseS). */
    get lift() { return lift; },
    /** @param {boolean} on */
    raise(on) { raised = on; },
    /** @param {boolean} on */
    snuff(on) { snuffed = on; },
    /** How far its light reaches now (m): an ember snuffed, further held up, shrinking as it runs low. */
    reach() {
      if (fuel <= 0) return 0;
      if (snuffed) return L.emberReachM;
      const low = 0.5 + 0.5 * Math.min(1, fuel / (L.fuel * 0.25));
      return (L.reachM + (L.raisedReachM - L.reachM) * lift) * low;
    },
    /** A hit, or a move that spends fuel: n sips. Returns the fuel left. @param {number} [n] */
    sip(n = 1) { fuel = Math.max(0, fuel - L.sipFuel * n); return fuel; },
    /** Fill it again. */
    refill() { fuel = L.fuel; snuffed = false; },
    /** @param {number} dt */
    update(dt) {
      lift = Math.min(1, Math.max(0, lift + (raised && !snuffed ? 1 : -1) * dt / Math.max(1e-3, L.raiseS)));
      if (snuffed || fuel <= 0) return;
      fuel = Math.max(0, fuel - (raised ? L.raisedBurnPerS : L.burnPerS) * dt);
    },
  };
}
