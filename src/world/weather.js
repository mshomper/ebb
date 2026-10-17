// @ts-check
// Weather step of the hourly tick (doc 10, "Weather"). Pure and worker-safe: no GPU, DOM,
// store or events; only + - * /, Math.floor/min/max/abs and det math.
// Each game day rolls one record from stream(weatherSeed, dayIndex): a mood (clear, cloud,
// rain, mist), rain hours and amount, mist hours, wind direction and strength. Winter's rain
// share falls as cold drizzle (mood 'rain' with drizzle: true, lighter and longer); no snow.
// Leaning (-1 drier, 0, +1 wetter) scales rain and mist odds by (1 + leanStep * lean); the
// clear and cloud shares absorb the difference. A new leaning applies from the next roll.
//
// State contract: coarseStep never mutates its input. It returns a shallow copy of `state`
// with `state.weather` replaced by a fresh object (records are shared, never edited).

import { stream, det } from '../core/rng.js';
import { seasonOf, SECONDS_PER_HOUR, SECONDS_PER_DAY, HOURS_PER_DAY } from '../core/clock.js';

/** @typedef {'clear'|'cloud'|'rain'|'mist'} Mood */
const MOODS = /** @type {const} */ (['rain', 'mist', 'cloud', 'clear']); // wet first: a wetter lean only adds rain days
const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/**
 * @typedef {Object} DayRecord
 * @property {number} day          game-day index
 * @property {Mood} mood
 * @property {boolean} drizzle     rain falls as cold drizzle (winter)
 * @property {number} cloud        the day's cloud cover 0..1
 * @property {number} rainStartH   hour of day the rain starts (0 when no rain)
 * @property {number} rainHours    0 when no rain
 * @property {number} rainIntensity 0..1 while it rains
 * @property {number} rainAmount   millimetres for the day
 * @property {number} mistStartH
 * @property {number} mistHours    0 when no mist
 * @property {number} windDir      radians, direction the wind blows toward (0 = +X east, pi/2 = -Z north)
 * @property {number} windStrength 0..1 base strength (the hourly value follows a day curve)
 */

/** @typedef {{cloud: number, rain: number, mist: number, wind: number}} WeatherNow */

/**
 * @typedef {Object} WeatherState
 * @property {number} lean          -1, 0 or +1
 * @property {DayRecord|null} today
 * @property {DayRecord|null} yesterday
 * @property {WeatherNow} now       this hour's values (step, no blending)
 */

/** @typedef {{name: string, payload: any, hour?: number}} CoarseEvent */

/** @returns {WeatherState} */
export function initialWeather() {
  return { lean: 0, today: null, yesterday: null, now: { cloud: 0, rain: 0, mist: 0, wind: 0 } };
}

/** @param {number} x */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Mood odds for a season after leaning, summing to 1. Pure.
 * @param {any} weather recipe.weather
 * @param {number} seasonIndex
 * @param {number} lean
 * @returns {{clear: number, cloud: number, rain: number, mist: number}}
 */
export function moodOdds(weather, seasonIndex, lean) {
  const base = weather.seasons[SEASON_NAMES[seasonIndex]];
  const sum = base.clear + base.cloud + base.rain + base.mist;
  const k = 1 + (weather.leanStep ?? 0.25) * clamp(lean || 0, -1, 1);
  const rain = (base.rain / sum) * k, mist = (base.mist / sum) * k;
  const dryBase = (base.clear + base.cloud) / sum;
  const dry = Math.max(0, 1 - rain - mist);
  const s = dryBase > 0 ? dry / dryBase : 0;
  const clear = (base.clear / sum) * s, cloud = (base.cloud / sum) * s;
  const total = clear + cloud + rain + mist;
  return { clear: clear / total, cloud: cloud / total, rain: rain / total, mist: mist / total };
}

/** Integer in [lo, hi] inclusive. @param {number} u 0..1 @param {number[]} r */
const intIn = (u, r) => r[0] + Math.min(r[1] - r[0], Math.floor(u * (r[1] - r[0] + 1)));
/** Float in [lo, hi). @param {number} u @param {number[]} r */
const lerpIn = (u, r) => r[0] + (r[1] - r[0]) * u;

/**
 * The record for one game day. Pure: same seed, day and lean give the same record.
 * Draws a fixed set of values in a fixed order, whatever the mood.
 * @param {number} weatherSeed
 * @param {number} dayIndex
 * @param {number} lean
 * @param {any} weather recipe.weather
 * @returns {DayRecord}
 */
export function dayRecord(weatherSeed, dayIndex, lean, weather) {
  const s = stream(weatherSeed, dayIndex);
  const u = [];
  for (let i = 0; i < 8; i++) u.push(s.next());
  const seasonIndex = seasonOf(dayIndex * SECONDS_PER_DAY).index;
  const odds = moodOdds(weather, seasonIndex, lean);

  /** @type {Mood} */
  let mood = 'clear';
  let acc = 0;
  for (const m of MOODS) {
    acc += odds[m];
    if (u[0] < acc) { mood = m; break; }
  }

  const moodR = weather.moods[mood];
  const kindName = weather.seasons[SEASON_NAMES[seasonIndex]].rainKind ?? 'rain';
  const kind = weather.rainKinds[kindName];
  const mist = weather.mist;
  const wind = weather.wind;

  let cloud = 0, rainStartH = 0, rainHours = 0, rainIntensity = 0, rainAmount = 0, mistHours = 0;
  const drizzle = mood === 'rain' && kindName === 'drizzle';
  if (mood === 'rain') {
    cloud = kind.cloud;
    rainHours = intIn(u[2], kind.hours);
    rainHours = Math.min(rainHours, HOURS_PER_DAY);
    const latest = Math.max(kind.startH[0], Math.min(kind.startH[1], HOURS_PER_DAY - rainHours));
    rainStartH = intIn(u[3], [kind.startH[0], latest]);
    rainIntensity = lerpIn(u[4], kind.intensity);
    rainAmount = rainIntensity * rainHours * weather.mmPerHourAtFull;
  } else {
    cloud = lerpIn(u[1], moodR.cloud);
  }
  if (mood === 'mist') mistHours = intIn(u[5], mist.hours);

  let windDir = wind.prevailingDir + (u[6] * 2 - 1) * wind.dirSpread;
  const TWO_PI = 2 * det.PI;
  windDir -= Math.floor(windDir / TWO_PI) * TWO_PI;
  const windStrength = lerpIn(u[7], moodR.wind);

  return {
    day: dayIndex, mood, drizzle, cloud, rainStartH, rainHours, rainIntensity, rainAmount,
    mistStartH: mist.startH, mistHours, windDir, windStrength,
  };
}

/**
 * Step values for one hour of a day record (no blending). Pure.
 * @param {DayRecord} rec
 * @param {number} h hour of day 0..23
 * @param {any} weather recipe.weather
 * @returns {WeatherNow}
 */
export function hourValues(rec, h, weather) {
  const rain = rec.rainHours > 0 && h >= rec.rainStartH && h < rec.rainStartH + rec.rainHours ? rec.rainIntensity : 0;
  let mist = 0;
  if (rec.mistHours > 0) {
    const m = weather.mist, c = h + 0.5;
    const up = clamp01((c - rec.mistStartH) / m.formHours);
    const down = clamp01((rec.mistStartH + rec.mistHours - c) / m.fadeHours);
    mist = m.peak * Math.min(up, down);
  }
  const w = weather.wind;
  const curve = 0.5 + 0.5 * det.cos((2 * det.PI * (h + 0.5 - w.peakH)) / HOURS_PER_DAY);
  const wind = clamp01(rec.windStrength * (1 - w.diurnalAmount + w.diurnalAmount * curve));
  return { cloud: rec.cloud, rain, mist, wind };
}

/**
 * One hour of the weather step. Rolls the day's record at hour 0 of each day, or whenever the
 * stored record is missing or for another day. Emits `weather:changed {mood}` when the new
 * day's mood differs from the previous record's (the very first roll emits nothing).
 * @param {any} state world state
 * @param {number} hourIndex
 * @param {{weatherSeed: number, recipes: any}} env
 * @returns {{state: any, events: CoarseEvent[]}}
 */
export function coarseStep(state, hourIndex, env) {
  const weather = env.recipes?.seasons?.weather;
  if (!weather) throw new Error('weather: env.recipes.seasons.weather is missing (recipes/world/seasons.json)');
  const prev = /** @type {WeatherState} */ (state.weather ?? initialWeather());
  const dayIndex = Math.floor(hourIndex / HOURS_PER_DAY);
  const h = hourIndex - dayIndex * HOURS_PER_DAY;
  /** @type {CoarseEvent[]} */
  const events = [];
  let today = prev.today, yesterday = prev.yesterday ?? null;
  if (!today || today.day !== dayIndex) {
    const rec = dayRecord(env.weatherSeed, dayIndex, prev.lean ?? 0, weather);
    if (today && today.mood !== rec.mood) events.push({ name: 'weather:changed', payload: { mood: rec.mood } });
    yesterday = today ?? null;
    today = rec;
  }
  const now = hourValues(today, h, weather);
  return { state: { ...state, weather: { lean: prev.lean ?? 0, today, yesterday, now } }, events };
}

/** @param {number} x */
const smooth = (x) => x * x * (3 - 2 * x);

/**
 * Smoothly blended weather for drawing at time t (display time). Each hour holds its step
 * value; across every hour boundary (including rain start and end) the value eases from the
 * previous hour's over `blendMinutes` centred on the boundary. Days other than today and
 * yesterday fall back to today's record. Pure.
 * @param {WeatherState} weatherState
 * @param {number} t game seconds
 * @param {any} recipe parsed recipes/world/seasons.json (or its .weather)
 * @returns {WeatherNow}
 */
export function weatherAt(weatherState, t, recipe) {
  const weather = recipe?.weather ?? recipe;
  const today = weatherState?.today;
  if (!today) return weatherState?.now ?? { cloud: 0, rain: 0, mist: 0, wind: 0 };
  const yest = weatherState.yesterday;
  const dayIndex = Math.floor(t / SECONDS_PER_DAY);
  const rec = today.day === dayIndex ? today : yest && yest.day === dayIndex ? yest : today;
  const x = (t - dayIndex * SECONDS_PER_DAY) / SECONDS_PER_HOUR; // hour of day, float
  /** @param {number} hh */
  const at = (hh) => {
    if (hh < 0) {
      const prior = rec === today && yest && yest.day === today.day - 1 ? yest : rec;
      return hourValues(prior, prior === rec ? 0 : HOURS_PER_DAY - 1, weather);
    }
    if (hh >= HOURS_PER_DAY) {
      const after = rec === yest && today.day === rec.day + 1 ? today : rec;
      return hourValues(after, after === rec ? HOURS_PER_DAY - 1 : 0, weather);
    }
    return hourValues(rec, hh, weather);
  };
  const b = (weather.blendMinutes ?? 20) / 60;
  const k = Math.floor(x + 0.5);
  const d = x - k;
  if (Math.abs(d) >= b / 2) return at(Math.floor(x));
  const w = smooth((d + b / 2) / b);
  const a = at(k - 1), c = at(k);
  return {
    cloud: a.cloud + (c.cloud - a.cloud) * w,
    rain: a.rain + (c.rain - a.rain) * w,
    mist: a.mist + (c.mist - a.mist) * w,
    wind: a.wind + (c.wind - a.wind) * w,
  };
}
