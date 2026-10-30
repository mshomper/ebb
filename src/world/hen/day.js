// @ts-check
// The hen's day (docs/future/15, slice 3): which part of the day it is for her, from the sun, and
// the spots her day takes her to. At dawn she flaps down from the roost, shakes out and drinks at
// fresh water; by day she forages; at midday a dust bath on a dry, bare, sunny patch, then she
// preens; in rain she shelters fluffed at the edge of a bush; at dusk she flaps up to roost in the
// scrub, or on the camp perch once Familiar. bands.js turns these into plans, life.js walks them.
// Pure, so it is tested on its own. Numbers: recipes/species/hen.json day.

import { hash32 } from '../../core/rng.js';

/**
 * Sunrise and sunset (hours of the day) for a day length: the sun model's days are centred on noon.
 * @param {number} dayLengthH
 */
export const sunTimes = (dayLengthH) => ({ rise: 12 - dayLengthH / 2, set: 12 + dayLengthH / 2 });

/**
 * The part of her day: 'roost' from just before sunset until sunrise, 'dawn' for dawnH after
 * sunrise, 'midday' in dustH, else 'day'. @param {any} D recipes/species/hen.json day
 * @param {number} h hour of the day @param {number} dayLengthH
 * @returns {'roost'|'dawn'|'midday'|'day'}
 */
export function dayPart(D, h, dayLengthH) {
  const { rise, set } = sunTimes(dayLengthH);
  if (h < rise || h >= set - D.roostBeforeSunsetH) return 'roost';
  if (h < rise + D.dawnH) return 'dawn';
  if (h >= D.dustH[0] && h < D.dustH[1]) return 'midday';
  return 'day';
}

/** Rain enough to send her under a bush. @param {any} D @param {{ rain?: number } | null | undefined} w */
export const raining = (D, w) => (w?.rain ?? 0) > D.rainMin;

/** Weather for a dust bath: dry and sunny enough. @param {any} D @param {{ rain?: number, cloud?: number } | null | undefined} w */
export const dustWeather = (D, w) => (w?.rain ?? 0) <= 0.02 && (w?.cloud ?? 0) <= D.dustCloudMax;

/**
 * The scrub bush she roosts in: the grown one nearest her home's middle. @param {{ x: number, z: number }} home
 * @param {{ sp: string, x: number, z: number, size: number }[]} bushes @returns {{ sp: string, x: number, z: number, size: number } | null}
 */
export function roostBush(home, bushes) {
  let best = null, bd = Infinity;
  for (const b of bushes) {
    const d = (b.x - home.x) ** 2 + (b.z - home.z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/**
 * Where she roosts in a bush: its middle, roostShare of its height up (at most roostMaxM).
 * @param {any} D @param {{ sp: string, x: number, z: number, size: number }} bush
 * @returns {{ x: number, z: number, h: number }}
 */
export function bushRoost(D, bush) {
  const tall = (D.bushHeightM[bush.sp] ?? 1) * bush.size;
  return { x: bush.x, z: bush.z, h: Math.min(D.roostMaxM, tall * D.roostShare) };
}

/**
 * Her place out of the rain: the bush's edge on her side, shelterShare of its crown in from the rim.
 * @param {any} D @param {{ sp: string, x: number, z: number, size: number }} bush @param {{ x: number, z: number }} hen
 */
export function shelterSpot(D, bush, hen) {
  const crown = (D.bushCrownM[bush.sp] ?? 0.7) * bush.size;
  const dx = hen.x - bush.x, dz = hen.z - bush.z, l = Math.hypot(dx, dz);
  const r = crown * (1 - D.shelterShare);
  return l < 1e-3 ? { x: bush.x + r, z: bush.z } : { x: bush.x + (dx / l) * r, z: bush.z + (dz / l) * r };
}

/**
 * A dust-bath patch near her home: dry, bare and in sun (`ok` says which spots are), the nearest
 * found in rings a metre apart out to dustReachM (starting a turn along that `turn` gives, 0..1, so
 * it is not always the same side), or null.
 * @param {any} D @param {{ x: number, z: number }} home @param {(x: number, z: number) => boolean} ok @param {number} [turn]
 */
export function findDust(D, home, ok, turn = 0) {
  for (let r = 1; r <= D.dustReachM; r += 1) {
    const n = Math.max(8, Math.round(r * 2 * Math.PI));
    for (let i = 0; i < n; i++) {
      const a = ((i / n) + turn) * Math.PI * 2, x = home.x + Math.sin(a) * r, z = home.z + Math.cos(a) * r;
      if (ok(x, z)) return { x, z };
    }
  }
  return null;
}

/**
 * Is a spot bare enough for a dust bath: no plant within bareM? @param {any} D
 * @param {{ x: number, z: number }[]} plants @param {number} x @param {number} z
 */
export const bareAt = (D, plants, x, z) => !plants.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < D.bareM * D.bareM);

/**
 * The distant crow from the far side: on crowShare of mornings, at a seeded hour in crowH; null on
 * the others. The same for every device and every replay of a day. @param {any} D @param {number} seed @param {number} day
 * @returns {number | null} the hour of the day it sounds
 */
export function crowHour(D, seed, day) {
  const h = hash32(seed >>> 0, day >>> 0, 0xc20);
  if ((h & 0xffff) / 0x10000 >= D.crowShare) return null;
  return D.crowH[0] + ((h >>> 16) / 0x10000) * (D.crowH[1] - D.crowH[0]);
}
