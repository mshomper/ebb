// @ts-check
// The journal's almanac (docs 13, 15): today on the island in words: the date and part of the
// day, the weather and wind, the tide and when it turns, the moon, the length of the days, and what
// is flowering or resting now. Pure; reads the world state and the time shown (display time), and
// words from recipes/world/journal-island.json (island.almanac) and journal.json.

import * as tide from '../tide.js';
import { HOURS_PER_DAY } from '../../core/clock.js';
import { STAGE } from '../growth/coarse.js';
import { dateText } from './observe.js';

/** The last step of a [from, words] ladder that v has reached. @param {[number, string][]} ladder @param {number} v */
function reached(ladder, v) {
  let text = ladder[0][1];
  for (const [at, t] of ladder) if (v >= at) text = t;
  return text;
}

/**
 * The almanac's rows.
 * @param {{ state: any, tHours: number, weatherNow: { rain: number, mist: number, wind: number }, tideParams?: any, words: any, island: any }} ctx
 *   tHours: the time shown, in game hours; weatherNow: the blended weather now (world/weather.js weatherAt)
 * @returns {{ id: string, label: string, text: string }[]}
 */
export function almanac(ctx) {
  const { state, tHours, weatherNow, words, island } = ctx;
  const A = island.almanac;
  const L = A.labels;
  const hourOfDay = tHours - Math.floor(tHours / HOURS_PER_DAY) * HOURS_PER_DAY;
  const rows = [];
  rows.push({ id: 'today', label: L.today, text: `${dateText(state?.seasons, words)}, ${reached(A.dayParts, hourOfDay)}` });

  const today = state?.weather?.today;
  if (today) {
    let text = today.mood === 'rain' && today.drizzle ? A.drizzle : A.moods[today.mood] ?? today.mood;
    const wind = reached(A.wind, weatherNow.wind);
    text += `, ${wind}`;
    if (weatherNow.wind >= A.wind[1][0]) {
      // windDir is where the wind blows toward (0 = east, pi/2 = north); it comes from the opposite side.
      const from = today.windDir + Math.PI;
      const i = ((Math.round(from / (Math.PI / 4)) % 8) + 8) % 8;
      text += ` ${A.windFrom.replace('{dir}', words.compass[i])}`;
    }
    if (weatherNow.rain > 0.05) text += `; ${A.rainNow}`;
    else if (weatherNow.mist > 0.2) text += `; ${A.mistNow}`;
    rows.push({ id: 'weather', label: L.weather, text: `${text}.` });
  }

  const t = tide.state(tHours, ctx.tideParams ?? tide.DEFAULT_TIDE);
  const when = A.hourWords[Math.min(A.hourWords.length - 1, Math.round(t.nextTurnH))];
  rows.push({ id: 'tide', label: L.tide, text: `${t.rising ? A.tideIn : A.tideOut}; ${(t.rising ? A.tideHigh : A.tideLow).replace('{when}', when)}.` });

  const phase = tide.moonPhase(tHours);
  rows.push({ id: 'moon', label: L.moon, text: `${A.moon.find((/** @type {[number, string]} */ s) => phase < s[0])?.[1] ?? A.moon[0][1]}.` });
  rows.push({ id: 'daylight', label: L.daylight, text: `${reached(A.daylight, state?.seasons?.dayLengthH ?? 12)}.` });

  /** @type {Set<string>} */ const flowering = new Set();
  /** @type {Map<string, [number, number]>} */ const rest = new Map();
  for (const p of state?.growth?.plants ?? []) {
    if (!words.species[p.sp]) continue;
    if (p.stage === STAGE.flowering) flowering.add(p.sp);
    const r = rest.get(p.sp) ?? [0, 0];
    r[0]++; if (p.stage === STAGE.dormant) r[1]++;
    rest.set(p.sp, r);
  }
  const names = (/** @type {Iterable<string>} */ ids) => words.order.filter((/** @type {string} */ sp) => [...ids].includes(sp)).map((/** @type {string} */ sp) => words.species[sp].name).join(', ');
  rows.push({ id: 'flowering', label: L.flowering, text: `${flowering.size ? A.flowering.replace('{names}', names(flowering)) : A.floweringNone}.` });
  const resting = [...rest].filter(([, r]) => r[1] * 2 >= r[0] && r[1] > 0).map(([sp]) => sp);
  if (resting.length) rows.push({ id: 'resting', label: L.resting, text: `${A.resting.replace('{names}', names(resting))}.` });
  return rows;
}
