// @ts-check
// Sun and moon from the clock (doc 06, "Sun and moon from the clock"). Pure functions of game
// time, safe for coarse code and workers: trig comes only from `det` in core/rng.js, plus
// + - * /, Math.sqrt, Math.floor, Math.abs, Math.min and Math.max, so the ecology's daily light
// exposure is bit-identical in every browser and worker.
//
// World axes: +X east, -Z north, +Y up. Directions are unit vectors toward the body.
// Altitude and azimuth are in radians; azimuth is measured from south, west positive.
// yearFrac 0 = spring equinox; hour angle 0 at solar noon (dayFrac 0.5).
// Moon: one synodic cycle every 7 game days (two per 14-day season), new at the start of each
// season and on day 7, full on days 3.5 and 10.5.

import { det } from '../../core/rng.js';
import { dayFractionOf, yearFractionOf, moonPhaseOf, SECONDS_PER_DAY } from '../../core/clock.js';

export const DEFAULT_LATITUDE_DEG = 40;
export const DEFAULT_TILT_DEG = 18;

const PI = det.PI;
const TWO_PI = 2 * PI;
const DEG = PI / 180;
const DAWN_ALT = -6 * DEG;

/** @typedef {{latitudeDeg?: number, tiltDeg?: number}} SunMoonOpts */

/**
 * @typedef {Object} SunMoon
 * @property {[number, number, number]} sunDir  unit vector toward the sun
 * @property {number} sunAlt     radians above the horizon
 * @property {number} sunAz      radians from south, west positive
 * @property {[number, number, number]} moonDir unit vector toward the moon
 * @property {number} moonAlt
 * @property {number} moonAz
 * @property {number} moonPhase  0 new, 0.5 full (clock.moonPhaseOf)
 * @property {number} moonIllum  lit brightness relative to full, 0 at new, 1 at full (Lommel-Seeliger)
 * @property {number} dayLengthH hours the sun is above the horizon that day (declination at that day's noon)
 */

/** @param {number} x */
const clamp1 = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);
/** Deterministic asin. @param {number} x */
export function asin(x) { x = clamp1(x); return det.atan2(x, Math.sqrt(1 - x * x)); }
/** Deterministic acos. @param {number} x */
export function acos(x) { x = clamp1(x); return det.atan2(Math.sqrt(1 - x * x), x); }

/**
 * Declination and right ascension of a point on the ecliptic (no lunar inclination).
 * @param {number} lambda ecliptic longitude
 * @param {number} sinE @param {number} cosE
 */
function equatorial(lambda, sinE, cosE) {
  const sl = det.sin(lambda), cl = det.cos(lambda);
  const sinDec = sinE * sl;
  return { sinDec, cosDec: Math.sqrt(1 - sinDec * sinDec), ra: det.atan2(cosE * sl, cl) };
}

/**
 * Horizon direction from hour angle and declination.
 * @param {number} H hour angle @param {number} sinDec @param {number} cosDec
 * @param {number} sinP @param {number} cosP latitude sine and cosine
 */
function horizon(H, sinDec, cosDec, sinP, cosP) {
  const sH = det.sin(H), cH = det.cos(H);
  const up = sinP * sinDec + cosP * cosDec * cH;   // sin(alt)
  const west = cosDec * sH;                         // cos(alt) sin(az)
  const south = cH * sinP * cosDec - sinDec * cosP; // cos(alt) cos(az)
  const n = Math.sqrt(up * up + west * west + south * south);
  /** @type {[number, number, number]} */
  const dir = [-west / n, up / n, south / n];       // east = -west, south = +Z
  const alt = det.atan2(up, Math.sqrt(west * west + south * south));
  const az = det.atan2(west, south);
  return { dir, alt, az };
}

/**
 * Lommel-Seeliger disk brightness of a sphere at phase angle alpha, normalized to 1 at full:
 * 1 - sin(a/2) tan(a/2) ln(cot(a/4)).
 * @param {number} alpha radians, 0 full, pi new
 */
export function lommelSeeliger(alpha) {
  if (alpha < 1e-6) return 1;
  if (alpha > PI - 1e-6) return 0;
  const s = det.sin(alpha / 2), c = det.cos(alpha / 2);
  const q = alpha / 4;
  const f = 1 - (s * s / c) * det.log(det.cos(q) / det.sin(q));
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Hours the sun is above the horizon for a declination and latitude, clamped 0..24.
 * @param {number} sinDec @param {number} cosDec @param {number} sinP @param {number} cosP
 */
function dayLength(sinDec, cosDec, sinP, cosP) {
  const den = cosP * cosDec;
  if (den <= 1e-12) return sinP * sinDec > 0 ? 24 : 0;
  const cosH0 = -(sinP * sinDec) / den;
  if (cosH0 <= -1) return 24;
  if (cosH0 >= 1) return 0;
  return (24 * acos(cosH0)) / PI;
}

/**
 * Sun and moon for a game time.
 * @param {number} t game seconds (display time for drawing, world time inside coarse steps)
 * @param {SunMoonOpts} [opts] defaults: latitude 40, tilt 18
 * @returns {SunMoon}
 */
export function sunMoon(t, opts = {}) {
  const phi = (opts.latitudeDeg ?? DEFAULT_LATITUDE_DEG) * DEG;
  const eps = (opts.tiltDeg ?? DEFAULT_TILT_DEG) * DEG;
  const sinP = det.sin(phi), cosP = det.cos(phi);
  const sinE = det.sin(eps), cosE = det.cos(eps);

  const lambda = TWO_PI * yearFractionOf(t);
  const H = TWO_PI * (dayFractionOf(t) - 0.5);
  const sun = equatorial(lambda, sinE, cosE);
  const sh = horizon(H, sun.sinDec, sun.cosDec, sinP, cosP);

  const moonPhase = moonPhaseOf(t);
  const moon = equatorial(lambda + TWO_PI * moonPhase, sinE, cosE);
  const mh = horizon(H - (moon.ra - sun.ra), moon.sinDec, moon.cosDec, sinP, cosP);

  // Elongation on the ecliptic is 2 pi phase; phase angle is pi minus it (folded to 0..pi).
  const alpha = Math.abs(PI - TWO_PI * moonPhase);
  const moonIllum = lommelSeeliger(alpha);

  // Day length uses the declination at this day's solar noon, so it is constant through a day.
  const noonT = Math.floor(t / SECONDS_PER_DAY) * SECONDS_PER_DAY + SECONDS_PER_DAY / 2;
  const noon = equatorial(TWO_PI * yearFractionOf(noonT), sinE, cosE);
  const dayLengthH = dayLength(noon.sinDec, noon.cosDec, sinP, cosP);

  return {
    sunDir: sh.dir, sunAlt: sh.alt, sunAz: sh.az,
    moonDir: mh.dir, moonAlt: mh.alt, moonAz: mh.az,
    moonPhase, moonIllum, dayLengthH,
  };
}

/** @typedef {'dawn'|'sunrise'|'sunset'|'dusk'} SunEvent */

/**
 * Sun-altitude crossings between two samples: dawn (-6 deg rising), sunrise (0 rising),
 * sunset (0 falling), dusk (-6 deg falling). Listed in the order they happen.
 * @param {number} prevAltRad
 * @param {number} altRad
 * @returns {SunEvent[]}
 */
export function sunEvents(prevAltRad, altRad) {
  /** @type {SunEvent[]} */
  const out = [];
  if (altRad > prevAltRad) {
    if (prevAltRad < DAWN_ALT && altRad >= DAWN_ALT) out.push('dawn');
    if (prevAltRad < 0 && altRad >= 0) out.push('sunrise');
  } else if (altRad < prevAltRad) {
    if (prevAltRad >= 0 && altRad < 0) out.push('sunset');
    if (prevAltRad >= DAWN_ALT && altRad < DAWN_ALT) out.push('dusk');
  }
  return out;
}
