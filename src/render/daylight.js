// @ts-check
// Per-frame daylight (docs/06): where the sun and moon are at display time, the weather to draw,
// how much of each light survives the air and the clouds, which one casts shadows, and the
// sunrise/sunset crossings. Pure CPU; feeds FrameUniforms, the atmosphere and the shadow pass.
// Reads the pure sun-moon and weatherAt functions, which are display-side by design (doc 06).

import { sunMoon, sunEvents } from '../world/sky/sun-moon.js';
import { weatherAt } from '../world/weather.js';
import { transmittanceToLight } from './sky/atmosphere-cpu.js';

const DEG = Math.PI / 180;

/** @param {number} a @param {number} b @param {number} x */
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Fixed weather numbers for a previewed mood (sky lab), taken from the seasons recipe.
 * @param {'clear'|'cloud'|'rain'|'mist'} mood @param {any} w recipe.weather
 */
function moodValues(mood, w) {
  const mid = (/** @type {number[]} */ r) => (r[0] + r[1]) / 2;
  if (mood === 'rain') return { cloud: w.rainKinds.rain.cloud, rain: mid(w.rainKinds.rain.intensity), mist: 0, wind: mid(w.moods.rain?.wind ?? [0.4, 0.6]) };
  if (mood === 'mist') return { cloud: mid(w.moods.mist.cloud), rain: 0, mist: w.mist.peak, wind: mid(w.moods.mist.wind) };
  return { cloud: mid(w.moods[mood].cloud), rain: 0, mist: 0, wind: mid(w.moods[mood].wind) };
}

/**
 * @param {{ sky: any, seasons: any, shadows: any }} recipes
 */
export function createDaylight(recipes) {
  const { sky, seasons, shadows } = recipes;
  const moonSinRadius = Math.sin((sky.moon.angularDiameterDeg / 2) * DEG);
  let wet = 0;
  /** @type {number | null} */ let prevT = null;
  /** @type {number | null} */ let prevSunAlt = null;

  /**
   * @param {number} displayT game seconds
   * @param {any} worldState coarse world state ({ weather, seasons })
   * @param {null | 'clear'|'cloud'|'rain'|'mist'} previewMood
   * @param {number} aerosolScale  the atmosphere's current ground-aerosol multiplier
   */
  function update(displayT, worldState, previewMood, aerosolScale) {
    const sm = sunMoon(displayT, sky.orbit);
    const w = previewMood ? moodValues(previewMood, seasons.weather) : weatherAt(worldState?.weather, displayT, seasons);

    // Ground wetness for the look: soaks in within ~20 game minutes of rain, dries over ~3 game hours.
    const dt = prevT === null ? 0 : Math.min(3600, Math.max(0, displayT - prevT));
    prevT = displayT;
    const goal = w.rain > 0.02 ? 1 : 0;
    const rate = goal > wet ? 1 / 1200 : 1 / 10800;
    wet = previewMood ? goal : wet + (goal - wet) * Math.min(1, dt * rate);

    const cloudDim = 1 - shadows.cloudSoftening * w.cloud;
    const tSun = transmittanceToLight(sky, sm.sunDir[1], { aerosolScale });
    const tMoon = transmittanceToLight(sky, sm.moonDir[1], { aerosolScale, sinRadius: moonSinRadius });
    const sunTOA = sky.sun.illuminanceTOA;
    const moonLux = sky.moon.illuminanceFull * sm.moonIllum;
    const moonTOA = [moonLux, moonLux, moonLux];
    const sunIlluminance = [0, 1, 2].map((i) => sunTOA[i] * tSun[i] * cloudDim);
    const moonIlluminance = [0, 1, 2].map((i) => moonTOA[i] * tMoon[i] * cloudDim);

    // Shadow caster: the sun until it sinks below -4 degrees, then the moon, fading through twilight.
    const sunAltDeg = sm.sunAlt / DEG;
    const sunShare = smoothstep(shadows.sunFadeDeg[0], shadows.sunFadeDeg[1], sunAltDeg);
    let shadowDir = sm.sunDir;
    let shadowStrength = sunShare;
    if (sunShare < 0.01) {
      shadowDir = sm.moonDir;
      shadowStrength = smoothstep(shadows.moonFadeDeg[0], shadows.moonFadeDeg[1], sm.moonAlt / DEG)
        * Math.min(1, sm.moonIllum / shadows.moonFullForShadow);
    }
    shadowStrength *= cloudDim;

    const events = prevSunAlt === null ? [] : sunEvents(prevSunAlt, sm.sunAlt);
    prevSunAlt = sm.sunAlt;

    return {
      sm, weather: { cloud: w.cloud, rain: w.rain, mist: w.mist, wet },
      sunIlluminance, moonIlluminance, sunTOA, moonTOA,
      shadowDir, shadowStrength, events,
    };
  }

  return { update };
}
