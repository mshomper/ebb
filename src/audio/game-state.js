// @ts-check
// The game's sound state (doc 17 "Ambience that reacts", doc 25): turns what the game publishes in
// the store's `sound` slice (display time, season, weather, tide, camera, what is near) into the
// ambience's SoundState, adding the few things the game does not keep: the wind's gusts on a
// seeded rhythm, the frost of winter mornings, the drips after rain, and the day's sunrise and
// sunset. Pure apart from its own seeded stream (src/core/rng.js), so it runs in the tests too.
// Numbers: recipes/audio/game.json.

import { stream, hash32 } from '../core/rng.js';
import { sunDay } from './music/director.js';
import { value, blendFromPosition } from './ambience/curves.js';

const H = 3600;
const DAY = 24 * H;

/**
 * What the game publishes about ten times a second (store slice `sound`, src/app.js).
 * @typedef {Object} SoundSlice
 * @property {number} displayT     game seconds at display time (a time preview moves it)
 * @property {number} season       0 spring .. 3 winter
 * @property {number} seasonPhase  0..1
 * @property {{cloud: number, rain: number, mist: number, wind: number}} weather  0..1 each
 * @property {number} tidePhase    0..1 (0 high water, 0.5 low)
 * @property {number[]} eye        camera eye [x, y, z]
 * @property {number[]} target     camera target [x, y, z]
 * @property {import('../world/sound-near.js').SoundNear} near
 * @property {string[]} residents  settled species ids
 */

/**
 * @param {any} recipe recipes/audio/game.json
 * @param {number} seed world seed
 * @param {(t: number) => number} sunAltDeg sun height in degrees at a game time
 * @param {number} seasonEdge the ambience's season crossfade (ambience.json seasonEdge)
 */
export function createSoundState(recipe, seed, sunAltDeg, seasonEdge) {
  const G = recipe;
  const r = stream(hash32(seed >>> 0, G.seed >>> 0), 1);
  const gust = { t: 0, next: 0, until: 0, peak: 0, now: 0 };
  let lastRainT = -Infinity;
  /** @type {Map<number, {sunrise: number, sunset: number}>} */
  const days = new Map();

  /** Sunrise and sunset hours of a game day (from its midnight), cached. @param {number} day */
  function sunOf(day) {
    let d = days.get(day);
    if (!d) {
      const s = /** @type {Record<string, number>} */ (/** @type {unknown} */ (sunDay(sunAltDeg, day * DAY, [])));
      d = { sunrise: Number.isFinite(s.sunrise) ? s.sunrise : 6, sunset: Number.isFinite(s.sunset) ? s.sunset : 18 };
      days.set(day, d);
      if (days.size > 4) days.delete(/** @type {number} */ (days.keys().next().value));
    }
    return d;
  }

  /** The gusts: a seeded rhythm of swells, stronger and more often with wind. @param {number} wind @param {number} dtS */
  function gustAt(wind, dtS) {
    const U = G.gust;
    gust.t += dtS;
    if (gust.t >= gust.next) {
      gust.peak = Math.min(1, r.range(U.peak[0], U.peak[1]) * (0.4 + 0.6 * wind));
      gust.until = gust.t + r.range(U.holdS[0], U.holdS[1]);
      gust.next = gust.until + r.range(U.everyS[0], U.everyS[1]) / (U.everyWindScale + wind);
    }
    const target = gust.t < gust.until ? gust.peak * Math.min(1, wind * 2) : 0;
    gust.now += (target - gust.now) * Math.min(1, dtS * U.followPerS);
    return gust.now;
  }

  return {
    /**
     * @param {SoundSlice} s @param {number} dtS real seconds since the last call
     * @returns {import('./ambience.js').SoundState}
     */
    build(s, dtS) {
      const t = s.displayT;
      const day = Math.floor(t / DAY);
      const hour = (t - day * DAY) / H;
      const sun = sunOf(day);
      const w = s.weather;
      // Weather as a word for the parts that read one (the director, the ambience defaults).
      const weather = w.rain > 0.05 ? 'rain' : w.mist > 0.2 ? 'mist' : w.cloud > 0.6 ? 'cloud' : 'clear';
      if (w.rain > 0.05) lastRainT = t;
      // A time preview may move display time backwards; drips are only for the hours after rain.
      const sinceRainH = (t - lastRainT) / H;
      const afterRain = w.rain > 0.05 || !(sinceRainH >= 0) ? 0 : Math.max(0, 1 - sinceRainH / G.afterRainH);
      // Frost: winter mornings until the sun burns it off, less under cloud, none in rain.
      const winter = blendFromPosition(s.season + s.seasonPhase, seasonEdge)[3];
      let fromRise = hour - sun.sunrise;
      if (fromRise > 12) fromRise -= 24;
      const frostCurve = value({ in: 'x', pts: G.frost.byHourFromSunrise }, { x: fromRise }, [1, 0, 0, 0]);
      const frost = w.rain > 0.05 ? 0 : winter * frostCurve * (1 - G.frost.cloudCut * w.cloud);
      const eye = s.eye, tg = s.target;
      const fx = tg[0] - eye[0], fy = tg[1] - eye[1], fz = tg[2] - eye[2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      return {
        waterNear: s.near.waterNear,
        surfaceNear: s.near.surfaceNear,
        tidePhase: s.tidePhase,
        wind: w.wind,
        gust: gustAt(w.wind, dtS),
        hour,
        season: s.season,
        seasonPhase: s.seasonPhase,
        weather: /** @type {'clear'|'cloud'|'rain'|'mist'} */ (weather),
        rain: w.rain,
        mist: w.mist,
        afterRain,
        frost,
        camHeight: Math.max(0.3, eye[1] - tg[1]),
        life: 0,
        residents: s.residents,
        sunriseH: sun.sunrise,
        sunsetH: sun.sunset,
        listener: { x: tg[0], y: tg[1], z: tg[2] },
        eye: eye.slice(),
        forward: [fx / fl, fy / fl, fz / fl],
      };
    },
  };
}
