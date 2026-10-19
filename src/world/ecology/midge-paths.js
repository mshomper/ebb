// @ts-check
// Where midges are, as the swarm draws them (S6b-5, docs 11, 12): no flocking simulation. Swarms
// sit over the densest patches of the midge field (midges.js); each midge loops around its swarm's
// centre on a path worked out from the time and its number. src/shaders/midge-draw.wgsl draws the
// same path, so the main thread can find any midge (S6c's tongue catches) and make a dipping midge
// ring the water. Live look only: nothing here changes the world. The swarms' choice is pure.

import { hash32 } from '../../core/rng.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';

/** Float 0..1 from a hash (top 24 bits, as hashToFloat in lib-hash.wgsl). @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * The swarm centres: the densest squares of the field holding at least fromShare of a full cloud,
 * no two closer than apartM, at most `max`, densest first (ties to the lower square). Each gets
 * a seed from its square, so a swarm keeps its look while the field changes around it.
 * @param {Uint8Array | null | undefined} field state.ecology.midges @param {any} S recipes/species/midge.json swarm
 * @returns {{ x: number, z: number, share: number, seed: number }[]}
 */
export function pickSwarms(field, S) {
  if (!field) return [];
  const n = Math.round(Math.sqrt(field.length));
  const at = 255 * S.swarms.fromShare;
  /** @type {number[]} */ const cand = [];
  for (let k = 0; k < field.length; k++) if (field[k] >= at) cand.push(k);
  cand.sort((a, b) => field[b] - field[a] || a - b);
  /** @type {{ x: number, z: number, share: number, seed: number }[]} */ const out = [];
  const apart2 = S.swarms.apartM * S.swarms.apartM;
  for (const k of cand) {
    if (out.length >= S.swarms.max) break;
    const x = HABITAT_ORIGIN + (k % n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / n) + 0.5;
    if (out.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < apart2)) continue;
    out.push({ x, z, share: field[k] / 255, seed: hash32(0x3d6e, k) });
  }
  return out;
}

/**
 * How many of a full swarm are out at this hour: many at dusk (duskFromH to duskToH hours after
 * sunset), almost none at night, a few by day, easing over an hour between; fewer in wind. In
 * rain midges stop swarming and shelter in the plants: drizzle thins them (from rain.thinFrom), a
 * downpour clears them (by rain.goneAt); on the still, damp hours after rain they come out thicker
 * (afterRain 0..1, how recent the rain was, times rain.afterBoost).
 * @param {number} hourOfDay @param {number} sunsetH @param {number} dayLengthH @param {number} wind 0..1 @param {any} D swarm.density
 * @param {number} [rain] 0..1 now @param {number} [afterRain] 0..1
 */
export function swarmShareNow(hourOfDay, sunsetH, dayLengthH, wind, D, rain = 0, afterRain = 0) {
  const s = ((hourOfDay - sunsetH) % 24 + 24) % 24;   // hours after sunset, 0..24
  const night = 24 - dayLengthH;                        // sunrise, in hours after sunset
  const ease = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
  let f;
  if (s < D.duskToH) f = D.dusk;
  else if (s < D.duskToH + 1) f = ease(D.dusk, D.night, s - D.duskToH);
  else if (s < night) f = D.night;
  else if (s < night + 1) f = ease(D.night, D.day, s - night);
  else if (s < 24 + D.duskFromH - 1) f = D.day;
  else if (s < 24 + D.duskFromH) f = ease(D.day, D.dusk, s - (24 + D.duskFromH - 1));
  else f = D.dusk;
  const R = D.rain;
  let wet = 1;
  if (R) {
    const k = Math.min(1, Math.max(0, (rain - R.thinFrom) / (R.goneAt - R.thinFrom)));
    wet = (1 - k * k * (3 - 2 * k)) * (1 + R.afterBoost * Math.min(1, Math.max(0, afterRain)));
  }
  return f * (1 - D.windDamp * Math.min(1, Math.max(0, wind))) * wet;
}

/**
 * How recent the last rain was, 0..1: 1 just after it stopped, fading to 0 by afterH game hours;
 * 0 while it still rains. @param {(hoursAgo: number) => number} rainAt the rain 0..1 that long ago @param {any} R swarm.density.rain
 */
export function afterRainNow(rainAt, R) {
  if (!R || rainAt(0) > R.thinFrom) return 0;
  for (let h = 0.5; h <= R.afterH; h += 0.5) if (rainAt(h) > R.thinFrom) return 1 - (h - 0.5) / R.afterH;
  return 0;
}

/**
 * One midge's offset from its swarm's centre (m) at time t: a loop of two circles out of step and
 * a small rise and fall, its size, speed and height drawn from its swarm's seed and its number.
 * The WGSL in midge-draw.wgsl (fn orbit) is the same.
 * @param {number} seed @param {number} i @param {number} t animation seconds @param {any} S swarm
 * @returns {number[]} [x, y, z]
 */
export function orbit(seed, i, t, S) {
  const h0 = hash32(seed, i, 0), h1 = hash32(seed, i, 1), h2 = hash32(seed, i, 2), h3 = hash32(seed, i, 3);
  const r = S.radiusM[0] + (S.radiusM[1] - S.radiusM[0]) * Math.sqrt(u01(h0));
  const y = S.heightM[0] + (S.heightM[1] - S.heightM[0]) * u01(h1);
  const w = 2 * Math.PI * (S.speedHz[0] + (S.speedHz[1] - S.speedHz[0]) * u01(h2));
  const p = u01(h3) * 2 * Math.PI;
  const dir = (h0 & 1) ? 1 : -1;
  return [
    r * (Math.cos(dir * w * t + p) + 0.35 * Math.sin(w * 1.37 * t + 2.1 * p)),
    y + 0.06 * Math.sin(w * 0.71 * t + 3.3 * p),
    r * (0.8 * Math.sin(dir * w * t + p) + 0.35 * Math.cos(w * 1.61 * t + 1.3 * p)),
  ];
}

/**
 * The midge of a swarm dipping to the water now, and how far through its dip (0..1), or -1.
 * One dip every dip.everyS (by the swarm's seed), by one of its midges in turn.
 * @param {number} seed @param {number} count @param {number} t @param {any} S swarm
 * @returns {{ index: number, phase: number, k: number }}
 */
export function dipNow(seed, count, t, S) {
  const period = S.dip.everyS[0] + (S.dip.everyS[1] - S.dip.everyS[0]) * u01(hash32(seed, 0xd1));
  const tt = t + u01(hash32(seed, 0xd2)) * period;
  const k = Math.floor(tt / period);
  const into = tt - k * period;
  if (count <= 0 || into >= S.dip.s) return { index: -1, phase: -1, k };
  return { index: hash32(seed, 0xd3, k) % count, phase: into / S.dip.s, k };
}
