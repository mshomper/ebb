// @ts-check
// The marker stone (F20; recipes/land/meadow-islet.json stone): where it stands on the islet, its
// lean, the notch's point in the world, the midsummer spot the noon sun throws through the notch,
// when that spot's light shows, and how the stone reads the season by its noon shadow. Pure: no
// store, no GPU. The spot uses the game's own sun (src/world/sky/sun-moon.js), so it is the same
// every year and on every machine.

import { stream } from '../../core/rng.js';
import { sunMoon } from '../sky/sun-moon.js';
import { SECONDS_PER_HOUR, HOURS_PER_DAY, DAYS_PER_SEASON, SEASONS_PER_YEAR } from '../../core/clock.js';

const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR;
const HOURS_PER_YEAR = DAYS_PER_YEAR * HOURS_PER_DAY;

/**
 * Where the stone stands: of S.tries seeded spots within S.spotShare of the islet's half length and
 * width, the one scoring best on height plus grassBias times the grass share of its final ground.
 * @param {{ x: number, z: number, A: number, B: number, tx: number, tz: number, ux: number, uz: number }} L the islet's layout
 * @param {{ heightAt: (x: number, z: number) => number, paintAt: (x: number, z: number, h: number) => number[] }} shape its final shape
 * @param {any} S meadow-islet.json stone @param {number} seed the islet's seed
 * @returns {{ x: number, z: number, yaw: number, lean: number }} yaw: the turn of its frame (its lean runs along its own +z)
 */
export function stoneSpot(L, shape, S, seed) {
  const r = stream(seed, S.seed, 1);
  let best = { x: L.x, z: L.z, score: -Infinity };
  for (let t = 0; t < S.tries; t++) {
    const a = r.range(-1, 1) * S.spotShare * L.A, b = r.range(-1, 1) * S.spotShare * L.B;
    const x = L.x + a * L.tx + b * L.ux, z = L.z + a * L.tz + b * L.uz;
    const h = shape.heightAt(x, z), w = shape.paintAt(x, z, h);
    const total = w[0] + w[1] + w[2] + w[3] || 1;
    const score = h + S.grassBias * (w[0] + w[3]) / total;
    if (score > best.score) best = { x, z, score };
  }
  // Leaning toward leanTowardDeg from north: north is -z, so the frame turns by pi minus it.
  const yaw = Math.PI - (S.leanTowardDeg * Math.PI) / 180;
  return { x: best.x, z: best.z, yaw, lean: (S.leanDeg * Math.PI) / 180 };
}

/**
 * The stone's bone for the pieces pass: leaned along its own +z, set sinkM into the ground.
 * @param {number} lean radians @param {number} sinkM @returns {Float32Array}
 */
export function stoneBone(lean, sinkM) {
  const c = Math.cos(lean), s = Math.sin(lean);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, -sinkM, 0, 1]);
}

/**
 * A point in the stone's own frame (meters, base at 0) carried into the world, as the pieces pass
 * draws it (bone, then the yaw turn, then its place). @param {{ x: number, z: number, yaw: number, lean: number }} st
 * @param {number} groundY @param {number} sinkM @param {number[]} p
 */
export function stoneToWorld(st, groundY, sinkM, p) {
  const c = Math.cos(st.lean), s = Math.sin(st.lean);
  const bx = p[0], by = p[1] * c - p[2] * s - sinkM, bz = p[1] * s + p[2] * c;
  const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
  return [cy * bx + sy * bz + st.x, by + groundY, -sy * bx + cy * bz + st.z];
}

/** The game second of noon on midsummer (summer day 0) in the year that holds hour h. @param {number} h @param {any} M stone.midsummer */
export const midsummerNoonH = (h, M) => Math.floor(h / HOURS_PER_YEAR) * HOURS_PER_YEAR + M.day * HOURS_PER_DAY + M.noonHour;

/**
 * Where the noon sun through the notch lands: the ray from the notch away from the sun, met with
 * the ground (a few steps, the ground read live). @param {number[]} notch world point
 * @param {(x: number, z: number) => number} ground @param {any} M stone.midsummer @param {any} [sunOpts] latitude and tilt
 * @returns {{ x: number, z: number }}
 */
export function midsummerSpot(notch, ground, M, sunOpts = {}) {
  const d = sunMoon(midsummerNoonH(0, M) * SECONDS_PER_HOUR, sunOpts).sunDir;
  const up = Math.max(0.05, d[1]);
  let t = (notch[1] - ground(notch[0], notch[2])) / up;
  for (let i = 0; i < 4; i++) {
    const x = notch[0] - d[0] * t, z = notch[2] - d[2] * t;
    t = Math.max(0, (notch[1] - ground(x, z)) / up);
  }
  return { x: notch[0] - d[0] * t, z: notch[2] - d[2] * t };
}

/**
 * Does the midsummer light show now? From noon on summer day 0 until untilHour the next morning,
 * in a year whose midsummer noon came after the islet first stood above the tide (risenH).
 * @param {number} h game hours now @param {number | null} risenH @param {any} M stone.midsummer
 */
export function lightShows(h, risenH, M) {
  if (risenH === null) return false;
  const noon = midsummerNoonH(h, M);
  return noon >= risenH && h >= noon && h < noon + (HOURS_PER_DAY - M.noonHour) + M.untilHour;
}

/**
 * The stone's season line by its noon shadow (the third of the year, twelve from early spring).
 * @param {number} h game hours @param {string[]} lines meadowWords.shadow
 */
export function shadowLine(h, lines) {
  const y = ((h % HOURS_PER_YEAR) + HOURS_PER_YEAR) % HOURS_PER_YEAR;
  return lines[Math.min(11, Math.floor((y / HOURS_PER_YEAR) * 12))] ?? '';
}
