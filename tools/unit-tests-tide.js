// @ts-check
// The tide (src/world/tide.js): its period, springs and neaps, state and turns. Moved from the
// test page on October 31, 2026, so it runs in workers and in Node (tools/run-tests.mjs).

import { sunMoon } from '../src/world/sky/sun-moon.js';
import * as tide from '../src/world/tide.js';
import { makeEnv, hashWorldState } from '../src/sim/tick.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addTideTests(test, assert, eq) {
  const TIDE = 'tide';
  const DAY_S = 86400;

  test(TIDE, 'period is 12 h: level repeats every 12 h at a fixed moon, high at 0 and low at 6', () => {
    eq(tide.TIDE_PERIOD_H, 12, 'TIDE_PERIOD_H');
    const flat = { ...tide.DEFAULT_TIDE, springNeap: 0 };
    for (const t of [0, 1.25, 3.5, 7, 9.75, 100.3]) {
      const d = Math.abs(tide.level(t, flat) - tide.level(t + 12, flat));
      assert(d < 1e-12, `level(${t}) vs level(${t + 12}) differ by ${d}`);
    }
    assert(Math.abs(tide.level(0) - 0.6 * 1.15) < 1e-12, `level(0) = ${tide.level(0)}, expected A0 (1 + springNeap) = 0.69 (high water at new moon)`);
    assert(Math.abs(tide.level(6) + tide.amplitude(6)) < 1e-12, `level(6) = ${tide.level(6)}, expected -amp`);
    assert(Math.abs(tide.level(3, flat)) < 1e-12, `level(3) with no swing = ${tide.level(3, flat)}`);
    return `level(0) ${tide.level(0).toFixed(4)} m, level(6) ${tide.level(6).toFixed(4)} m`;
  });

  test(TIDE, 'level stays within A0 (1 + springNeap) over two moons', () => {
    const p = tide.DEFAULT_TIDE, cap = p.amplitudeM * (1 + p.springNeap) + 1e-12;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 336 * 20; i++) {
      const l = tide.level(i / 20);
      lo = Math.min(lo, l); hi = Math.max(hi, l);
    }
    assert(hi <= cap && lo >= -cap, `range ${lo} .. ${hi}, cap ${cap}`);
    return `range ${lo.toFixed(4)} .. ${hi.toFixed(4)} m`;
  });

  test(TIDE, 'spring tides at new and full moon are larger than neaps at the quarters', () => {
    const at = (/** @type {number} */ day) => tide.amplitude(day * 24);
    const newA = at(0), fullA = at(3.5), q1 = at(1.75), q3 = at(5.25);
    assert(newA > q1 && newA > q3 && fullA > q1 && fullA > q3, `new ${newA}, full ${fullA}, quarters ${q1}, ${q3}`);
    assert(Math.abs(newA - 0.69) < 1e-12 && Math.abs(fullA - 0.69) < 1e-12, `spring ${newA}, ${fullA}`);
    assert(Math.abs(q1 - 0.51) < 1e-12 && Math.abs(q3 - 0.51) < 1e-12, `neap ${q1}, ${q3}`);
    // Four spring tides a 14-day season: the second moon repeats the first.
    for (const d of [7, 10.5]) assert(Math.abs(at(d) - 0.69) < 1e-12, `spring on day ${d}: ${at(d)}`);
    const sm = sunMoon(3.5 * DAY_S);
    assert(Math.abs(sm.moonPhase - tide.moonPhase(3.5 * 24)) < 1e-12, 'tide moon phase matches sun-moon.js');
    return `spring ${newA.toFixed(3)} m, neap ${q1.toFixed(3)} m`;
  });

  test(TIDE, 'state: rising, phase and nextTurnH agree with level', () => {
    const s0 = tide.state(1);
    assert(!s0.rising && Math.abs(s0.nextTurnH - 5) < 1e-12, `t=1: rising ${s0.rising}, next ${s0.nextTurnH}`);
    const s1 = tide.state(8.5);
    assert(s1.rising && Math.abs(s1.nextTurnH - 3.5) < 1e-12, `t=8.5: rising ${s1.rising}, next ${s1.nextTurnH}`);
    for (const t of [0.5, 2, 5.9, 6.1, 11, 30.2]) {
      const s = tide.state(t);
      eq(s.level, tide.level(t), `state(${t}).level`);
      eq(s.rising, tide.level(t + 0.01) > tide.level(t), `state(${t}).rising`);
    }
  });

  test(TIDE, 'tide:turned fires twice per 12 h over four days and alternates high and low', () => {
    const env = makeEnv(11, { seasons: null });
    let st = { tide: tide.initialTide() };
    /** @type {string[]} */
    const got = [];
    for (let h = 0; h <= 96; h++) {
      const r = tide.coarseStep(st, h, env);
      st = r.state;
      for (const e of r.events) if (e.name === 'tide:turned') got.push(`${h}:${e.payload.kind}`);
    }
    eq(got.length, 16, `turns over hours 0..96 (${got.join(' ')})`);
    for (let i = 0; i < got.length; i++) {
      eq(got[i].split(':')[1], i % 2 === 0 ? 'low' : 'high', `turn ${i}`);
      eq(Number(got[i].split(':')[0]), 6 + 6 * i, `turn ${i} hour`);
    }
    const f = st.tide.exposedBandFrac;
    assert(f >= 0 && f <= 1, `exposedBandFrac ${f}`);
    return got.slice(0, 4).join(' ');
  });

  test(TIDE, 'exposedBandFrac is 0 at the band top, 1 at the bottom, and larger at low water', () => {
    const top = 1.15 * 0.6;
    eq(tide.exposedBandFrac(top), 0, 'top');
    eq(tide.exposedBandFrac(-top), 1, 'bottom');
    eq(tide.exposedBandFrac(0), 0.5, 'mean sea level');
    assert(tide.tideAtHour(6).exposedBandFrac > tide.tideAtHour(0).exposedBandFrac, 'low water uncovers more');
  });

  test(TIDE, 'coarseStep is deterministic, keeps its input and reads the water recipe', () => {
    const env = makeEnv(7, { seasons: null });
    /** @param {any} e */
    const run = (e) => { let st = { tide: tide.initialTide() }; for (let h = 0; h < 336; h++) st = tide.coarseStep(st, h, e).state; return st; };
    const a = hashWorldState(run(env)), b = hashWorldState(run(env));
    eq(b, a, 'second run');
    const input = { tide: tide.initialTide() };
    const before = JSON.stringify(input);
    const out = tide.coarseStep(input, 6, env).state;
    eq(JSON.stringify(input), before, 'input unchanged');
    assert(out !== input && out.tide !== input.tide, 'returns fresh objects');
    const strong = makeEnv(7, { seasons: null, water: { tide: { amplitudeM: 1.2 } } });
    assert(Math.abs(tide.coarseStep(input, 0, strong).state.tide.level - 2 * tide.tideAtHour(0).level) < 1e-12, 'recipe amplitude is used');
    return `hash ${a.toString(16).toUpperCase().padStart(8, '0')}`;
  });
}
