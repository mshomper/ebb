// @ts-check
// The staff's swing (doc 16, What the keys do: left click swings; H0, October 27, 2026): each hit of a
// swing clip sweeps an arc on the floor in front of the walker, reachM out and arcDeg wide, and lands
// on whatever stands in it. Where the hits fall in a clip is a recipe value (recipes/world/hollow.json
// swing.clips: shares of the clip's length). Pure.

/**
 * The things a hit lands on: within reachM (plus each one's own size) and within arcDeg / 2 of the
 * walker's facing. @template {{ x: number, z: number, broken?: boolean }} T
 * @param {number} x @param {number} z @param {number} yaw the walker @param {T[]} things
 * @param {number} reachM @param {number} arcDeg @param {(t: T) => number} [sizeOf] each thing's own radius (m)
 * @returns {T[]}
 */
export function arcHits(x, z, yaw, things, reachM, arcDeg, sizeOf = () => 0.3) {
  const half = (arcDeg / 2) * Math.PI / 180;
  return things.filter((t) => {
    if (t.broken) return false;
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz);
    if (d > reachM + sizeOf(t)) return false;
    if (d < 0.3) return true;
    const a = Math.atan2(dx, dz) - yaw;
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half + Math.atan2(sizeOf(t), d);
  });
}

/**
 * The hits due between two moments of a swing, as indices into its hits list (shares of its length).
 * @param {number[]} hits shares 0..1 @param {number} lenS the clip's length @param {number} t0 @param {number} t1 seconds into it
 */
export function hitsDue(hits, lenS, t0, t1) {
  /** @type {number[]} */ const out = [];
  hits.forEach((h, i) => { const at = h * lenS; if (at > t0 && at <= t1) out.push(i); });
  return out;
}
