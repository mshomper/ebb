// @ts-check
// The sky and seasons: sun and moon, weather, seasons and the shared hourly tick (doc 06). Moved
// from the test page on October 31, 2026, so it runs in workers and in Node
// (tools/run-tests.mjs).

import { subSeed } from '../src/core/rng.js';
import { seasonOf } from '../src/core/clock.js';
import { sunMoon, sunEvents } from '../src/world/sky/sun-moon.js';
import { dayRecord, moodOdds, weatherAt } from '../src/world/weather.js';
import { seasonsAt } from '../src/world/seasons.js';
import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { createLiveSim } from '../src/sim/live-sim.js';
import { loadSeasons } from './unit-tests-fixtures.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addSkyTests(test, assert, eq) {
  const SKY = 'sky and seasons';
  const DAY_S = 86400;
  const RAD = Math.PI / 180;
  /** @param {number} hours */
  const fmtH = (hours) => `${hours.toFixed(2)} h`;

  test(SKY, 'noon altitude is 90 - latitude + declination; with tilt 0 the equinox noon sun is at 50 deg', () => {
    const flat = sunMoon(0.5 * DAY_S, { latitudeDeg: 40, tiltDeg: 0 });
    assert(Math.abs(flat.sunAlt / RAD - 50) < 0.01, `tilt 0 noon altitude ${flat.sunAlt / RAD}`);
    let worst = 0;
    for (let d = 0; d < 56; d++) {
      const t = (d + 0.5) * DAY_S;
      const decl = Math.asin(Math.sin(18 * RAD) * Math.sin(2 * Math.PI * (t / (56 * DAY_S))));
      worst = Math.max(worst, Math.abs(sunMoon(t).sunAlt - (50 * RAD + decl)) / RAD);
    }
    assert(worst < 0.01, `noon altitude off by ${worst} deg`);
    return `day 0 noon (0.99 deg past the equinox): ${(sunMoon(0.5 * DAY_S).sunAlt / RAD).toFixed(2)} deg`;
  });

  test(SKY, 'day length: solstice 14.1 h and 9.9 h at tilt 18 (doc 06 14.5 / 9.5 needs tilt 21), matching a sampled day', () => {
    const summer = sunMoon(14 * DAY_S).dayLengthH, winter = sunMoon(42 * DAY_S).dayLengthH;
    assert(Math.abs(summer - 14.09) < 0.05 && Math.abs(winter - 9.91) < 0.05, `tilt 18: ${fmtH(summer)} / ${fmtH(winter)}`);
    const s21 = sunMoon(14 * DAY_S, { tiltDeg: 21 }).dayLengthH, w21 = sunMoon(42 * DAY_S, { tiltDeg: 21 }).dayLengthH;
    assert(Math.abs(s21 - 14.5) < 0.3 && Math.abs(w21 - 9.5) < 0.3, `tilt 21: ${fmtH(s21)} / ${fmtH(w21)}`);
    // count the minutes above the horizon on day 13 (the day before the solstice boundary)
    let up = 0;
    for (let m = 0; m < 1440; m++) if (sunMoon(13 * DAY_S + (m + 0.5) * 60).sunAlt > 0) up++;
    const sampled = up / 60, analytic = sunMoon(13.5 * DAY_S).dayLengthH;
    assert(Math.abs(sampled - analytic) < 0.1, `sampled ${fmtH(sampled)} vs ${fmtH(analytic)}`);
    return `tilt 18: ${fmtH(summer)} / ${fmtH(winter)}; tilt 21: ${fmtH(s21)} / ${fmtH(w21)}`;
  });

  test(SKY, 'solar noon is due south and the morning sun is in the east', () => {
    const noon = sunMoon(3.5 * DAY_S);
    assert(Math.abs(noon.sunAz) < 1e-9, `noon azimuth ${noon.sunAz}`);
    assert(Math.abs(noon.sunDir[0]) < 1e-9 && noon.sunDir[2] > 0, `noon dir ${noon.sunDir.join(', ')}`);
    const morning = sunMoon(3.3 * DAY_S), evening = sunMoon(3.7 * DAY_S);
    assert(morning.sunDir[0] > 0 && morning.sunAz < 0, `morning dir x ${morning.sunDir[0]}, az ${morning.sunAz}`);
    assert(evening.sunDir[0] < 0 && evening.sunAz > 0, `evening dir x ${evening.sunDir[0]}`);
    const len = Math.hypot(...morning.sunDir);
    assert(Math.abs(len - 1) < 1e-12, `sunDir length ${len}`);
  });

  test(SKY, 'moon is new at each season start and day 7, full at days 3.5 and 10.5, and rises later each day', () => {
    for (const d of [0, 7, 14, 21, 28, 70]) {
      const m = sunMoon(d * DAY_S);
      assert(m.moonPhase === 0 && m.moonIllum === 0, `day ${d}: phase ${m.moonPhase}, illum ${m.moonIllum}`);
    }
    for (const d of [3.5, 10.5, 17.5]) {
      const full = sunMoon(d * DAY_S);
      assert(Math.abs(full.moonPhase - 0.5) < 1e-12 && Math.abs(full.moonIllum - 1) < 1e-9, `day ${d} illum ${full.moonIllum}`);
    }
    const quarter = sunMoon(1.75 * DAY_S).moonIllum;
    assert(quarter > 0.2 && quarter < 0.5, `first quarter illum ${quarter}`);
    /** @param {number} t0 */
    const rise = (t0) => {
      let p = sunMoon(t0).moonAlt;
      for (let t = t0 + 60; t < t0 + 3 * DAY_S; t += 60) {
        const a = sunMoon(t).moonAlt;
        if (p < 0 && a >= 0) return t;
        p = a;
      }
      throw new Error('no moonrise found');
    };
    const r1 = rise(1 * DAY_S), r2 = rise(r1 + 12 * 3600), r3 = rise(r2 + 12 * 3600);
    const lag1 = (r2 - r1) / 3600 - 24, lag2 = (r3 - r2) / 3600 - 24;
    assert(lag1 > 2 && lag1 < 7 && lag2 > 2 && lag2 < 7, `moonrise lags ${lag1}, ${lag2} h`);
    return `moonrise ${lag1.toFixed(1)} h then ${lag2.toFixed(1)} h later each day; first quarter ${quarter.toFixed(2)} of full`;
  });

  test(SKY, 'sunEvents reports dawn, sunrise, sunset and dusk once each over a day', () => {
    /** @type {string[]} */
    const got = [];
    let p = sunMoon(4 * DAY_S).sunAlt;
    for (let m = 1; m <= 1440; m++) {
      const a = sunMoon(4 * DAY_S + m * 60).sunAlt;
      for (const e of sunEvents(p, a)) got.push(e);
      p = a;
    }
    eq(got.join(' '), 'dawn sunrise sunset dusk', 'events');
    eq(sunEvents(-10 * RAD, 5 * RAD).join(' '), 'dawn sunrise', 'big rising jump');
    eq(sunEvents(5 * RAD, -10 * RAD).join(' '), 'sunset dusk', 'big falling jump');
    eq(sunEvents(-0.2, -0.3).length, 0, 'no crossing');
  });

  test(SKY, 'weather rolls are identical for the same seed and day and differ across days', async () => {
    const w = (await loadSeasons()).weather;
    const seed = subSeed(7, 'weather');
    eq(JSON.stringify(dayRecord(seed, 12, 0, w)), JSON.stringify(dayRecord(seed, 12, 0, w)), 'same day');
    const distinct = new Set();
    const moods = new Set();
    for (let d = 0; d < 30; d++) { const r = dayRecord(seed, d, 0, w); distinct.add(JSON.stringify(r)); moods.add(r.mood); }
    eq(distinct.size, 30, 'distinct records in 30 days');
    assert(moods.size === 4, `moods seen in 30 days: ${[...moods].join(', ')}`);
    assert(JSON.stringify(dayRecord(seed, 12, 0, w)) !== JSON.stringify(dayRecord(subSeed(8, 'weather'), 12, 0, w)), 'another seed gave the same day');
  });

  test(SKY, 'leaning +1 raises rain days by about 25 percent and never more in the odds', async () => {
    const w = (await loadSeasons()).weather;
    for (let s = 0; s < 4; s++) {
      const a = moodOdds(w, s, 0), b = moodOdds(w, s, 1), c = moodOdds(w, s, -1);
      assert(b.rain / a.rain <= 1.25 + 1e-12 && b.rain / a.rain > 1.2499, `season ${s} rain ratio ${b.rain / a.rain}`);
      assert(Math.abs(c.mist / a.mist - 0.75) < 1e-9, `season ${s} drier mist ratio ${c.mist / a.mist}`);
      assert(Math.abs(b.clear + b.cloud + b.rain + b.mist - 1) < 1e-12, 'odds sum to 1');
    }
    const seed = subSeed(3, 'weather');
    let r0 = 0, r1 = 0, lost = 0;
    for (let d = 0; d < 2000; d++) {
      const a = dayRecord(seed, d, 0, w).mood === 'rain', b = dayRecord(seed, d, 1, w).mood === 'rain';
      if (a) r0++;
      if (b) r1++;
      if (a && !b) lost++;
    }
    const ratio = r1 / r0;
    assert(ratio > 1.15 && ratio < 1.35, `rain-day ratio ${ratio}`);
    eq(lost, 0, 'rain days lost by leaning wetter');
    return `rain days ${r0} -> ${r1} over 2,000 days (x${ratio.toFixed(3)})`;
  });

  test(SKY, 'winter rain is always cold drizzle, other seasons never, and winter is mistier than summer', async () => {
    const w = (await loadSeasons()).weather;
    const seed = subSeed(11, 'weather');
    let winterRain = 0, winterMist = 0, summerMist = 0, n = 0;
    for (let d = 0; d < 2800; d++) {
      const r = dayRecord(seed, d, 0, w);
      const s = seasonOf(d * DAY_S).index;
      if (s === 3) {
        n++;
        if (r.mood === 'rain') { winterRain++; assert(r.drizzle && r.rainIntensity <= w.rainKinds.drizzle.intensity[1], `day ${d} winter rain not drizzle`); }
        if (r.mood === 'mist') winterMist++;
      } else {
        assert(!r.drizzle, `day ${d} season ${s} rolled drizzle`);
        if (s === 1 && r.mood === 'mist') summerMist++;
      }
      assert(r.rainStartH + r.rainHours <= 24, `day ${d} rain runs past midnight`);
    }
    assert(winterRain > 0, 'no winter drizzle days');
    assert(winterMist > summerMist * 2, `winter mist ${winterMist}, summer ${summerMist}`);
    return `${winterRain} drizzle and ${winterMist} mist days in ${n} winter days`;
  });

  test(SKY, 'weatherAt blends over 20 minutes and matches the hourly value mid-hour', async () => {
    const recipe = await loadSeasons();
    const seed = subSeed(5, 'weather');
    let d = 1;
    while (dayRecord(seed, d, 0, recipe.weather).mood !== 'rain') d++;
    const env = makeEnv(5, { seasons: recipe });
    let st = initialWorldState(5);
    for (let h = (d - 1) * 24; h <= d * 24 + 23; h++) {
      st = runHour(st, h, env).state;
      const mid = weatherAt(st.weather, (h + 0.5) * 3600, recipe);
      for (const k of /** @type {const} */ (['cloud', 'rain', 'mist', 'wind'])) {
        if (Math.abs(mid[k] - st.weather.now[k]) > 1e-12) throw new Error(`hour ${h} ${k}: ${mid[k]} vs ${st.weather.now[k]}`);
      }
    }
    const rec = st.weather.today;
    const tStart = (d * 24 + rec.rainStartH) * 3600;
    const before = weatherAt(st.weather, tStart - 11 * 60, recipe).rain, at = weatherAt(st.weather, tStart, recipe).rain;
    const after = weatherAt(st.weather, tStart + 11 * 60, recipe).rain;
    eq(before, 0, 'rain 11 minutes before it starts');
    assert(Math.abs(at - rec.rainIntensity / 2) < 1e-12, `rain at the start ${at}`);
    eq(after, rec.rainIntensity, 'rain 11 minutes after it starts');
    let jump = 0;
    for (let m = 1; m < 1440; m++) {
      const a = weatherAt(st.weather, d * DAY_S + (m - 1) * 60, recipe), b = weatherAt(st.weather, d * DAY_S + m * 60, recipe);
      jump = Math.max(jump, Math.abs(b.rain - a.rain), Math.abs(b.cloud - a.cloud), Math.abs(b.wind - a.wind));
    }
    assert(jump < 0.1, `largest one-minute jump ${jump}`);
  });

  test(SKY, '336 hourly ticks are identical twice and split runs match one run', async () => {
    const recipe = await loadSeasons();
    const env = makeEnv(424242, { seasons: recipe });
    /** @param {any} st @param {number} from @param {number} to */
    const runRange = (st, from, to) => { for (let h = from; h <= to; h++) st = runHour(st, h, env).state; return st; };
    const a = hashWorldState(runRange(initialWorldState(424242), 0, 335));
    const b = hashWorldState(runRange(initialWorldState(424242), 0, 335));
    const c = hashWorldState(runRange(runRange(initialWorldState(424242), 0, 167), 168, 335));
    eq(b, a, 'second run');
    eq(c, a, 'split run');
    const env99 = makeEnv(99, { seasons: recipe });
    let s2 = initialWorldState(99);
    for (let h = 0; h <= 335; h++) s2 = runHour(s2, h, env99).state;
    assert(hashWorldState(s2) !== a, 'another seed gave the same world');
    return `hash ${a.toString(16).toUpperCase().padStart(8, '0')}`;
  });

  test(SKY, 'season:changed fires at hours 336 and 672 (14-day seasons), and dormancy follows the recipe windows', async () => {
    const recipe = await loadSeasons();
    const env = makeEnv(1, { seasons: recipe });
    let st = initialWorldState(1);
    /** @type {string[]} */
    const got = [];
    for (let h = 0; h <= 672; h++) {
      const r = runHour(st, h, env);
      st = r.state;
      for (const e of r.events) if (e.name === 'season:changed') got.push(`${e.hour}:${e.payload.index}`);
    }
    eq(got.join(' '), '336:1 672:2', 'season changes over hours 0..672');
    const at = (/** @type {number} */ seasonPos) => seasonsAt(seasonPos * 14 * DAY_S, recipe).dormant;
    assert(at(0.1).frogs && !at(0.1).reeds, 'early spring: frogs asleep, reeds awake');
    assert(!at(1.5).frogs && !at(1.5).reeds, 'midsummer: all awake');
    assert(at(2.8).frogs && !at(2.8).reeds, 'late autumn: frogs asleep');
    assert(at(3.5).frogs && at(3.5).reeds, 'winter: both asleep');
  });

  test(SKY, 'live-sim hourlyTick runs the shared tick and is a no-op without a world', async () => {
    const recipe = await loadSeasons();
    eq(createLiveSim().hourlyTick(5).length, 0, 'no world');
    const world = { state: initialWorldState(3), env: makeEnv(3, { seasons: recipe }) };
    const sim = createLiveSim({ world });
    let ref = initialWorldState(3);
    for (let h = 0; h < 48; h++) { sim.hourlyTick(h); ref = runHour(ref, h, world.env).state; }
    eq(hashWorldState(sim.worldState()), hashWorldState(ref), 'live state matches runHour');
    eq(world.state, sim.worldState(), 'world.state is kept current');
  });

  test(SKY, 'coarse files use no Math transcendental functions or Math.random', async () => {
    const files = ['world/sky/sun-moon.js', 'world/seasons.js', 'world/weather.js', 'world/tide.js', 'sim/tick.js', 'world/water/summary.js'];
    for (const f of files) {
      const r = await fetch(`../src/${f}`);
      const src = (await r.text()).replace(/\/\/.*$/gm, '');
      const bad = src.match(/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot|cbrt|random|sinh|cosh|tanh|expm1|log1p|log2|log10)\b/);
      assert(!bad, `${f} uses ${bad?.[0]}`);
    }
  });
}
