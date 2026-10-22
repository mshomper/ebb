// @ts-check
// The camp ground stays clear of placed pieces (docs/future/13 section 3.1, CP-01): pond stones, a
// flight of Steps, a reed raft, a carried stone or log set down, and the loose stones that come by
// themselves. Each check takes the live pad (the store's `campPad`, src/world/camp/layout.js), or
// null where there is none yet. Pure.

/**
 * A round piece of the given reach (its half width, m) at (x, z) would rest on the pad.
 * @param {{ x: number, z: number, r: number } | null} pad @param {number} x @param {number} z @param {number} [reach]
 */
export function onCampGround(pad, x, z, reach = 0) {
  if (!pad) return false;
  const r = pad.r + reach;
  return (x - pad.x) ** 2 + (z - pad.z) ** 2 < r * r;
}

/**
 * A straight run from a to b, half wide across, would cross the pad: a flight of Steps may not
 * start, end or pass over it.
 * @param {{ x: number, z: number, r: number } | null} pad
 * @param {ArrayLike<number>} a @param {ArrayLike<number>} b  [x, z] @param {number} half
 */
export function crossesCampGround(pad, a, b, half) {
  if (!pad) return false;
  const vx = b[0] - a[0], vz = b[1] - a[1], len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((pad.x - a[0]) * vx + (pad.z - a[1]) * vz) / len2)) : 0;
  return onCampGround(pad, a[0] + vx * t, a[1] + vz * t, half);
}

/**
 * The pieces that may stay, leaving out any that would rest on the pad (the handful of loose
 * stones that arrive by themselves). @template {{ x: number, z: number, size?: number }} P
 * @param {{ x: number, z: number, r: number } | null} pad @param {P[]} list @returns {P[]}
 */
export function offCampGround(pad, list) {
  return pad ? list.filter((p) => !onCampGround(pad, p.x, p.z, (p.size ?? 0) * 0.7)) : list;
}
