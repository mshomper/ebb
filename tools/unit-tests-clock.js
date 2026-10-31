// @ts-check
// The game clock (src/core/clock.js): game hours from real seconds, flow, clamping and the
// display override. Moved from the test page on October 31, 2026, so it runs in workers and in
// Node (tools/run-tests.mjs).

import { createClock, hourIndexOf, dayFractionOf, seasonOf, MAX_REAL_DT } from '../src/core/clock.js';
import { createBus } from '../src/core/events.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addClockTests(test, assert, eq) {
  test('clock', '60 real seconds at 1x cross exactly one game hour', () => {
    const c = createClock();
    c.reset(1800);
    /** @type {number[]} */
    const crossed = [];
    for (let i = 0; i < 240; i++) crossed.push(...c.advance(0.25).hoursCrossed);
    eq(crossed.join(','), '1', 'hours crossed');
    eq(c.worldT(), 1800 + 3600, 'worldT');
    eq(c.hourIndex(), 1, 'hourIndex');
  });

  test('clock', 'flow 0 freezes world time while animation time runs', () => {
    const c = createClock();
    c.reset(500);
    c.setFlow(0);
    let tick;
    for (let i = 0; i < 40; i++) tick = c.advance(0.25);
    eq(c.worldT(), 500, 'worldT');
    eq(c.animT(), 10, 'animT');
    eq(tick?.hoursCrossed.length, 0, 'hours crossed');
  });

  test('clock', '4x crosses four game hours per real minute', () => {
    const c = createClock();
    c.reset(1800);
    c.setFlow(4);
    /** @type {number[]} */
    const crossed = [];
    for (let i = 0; i < 240; i++) crossed.push(...c.advance(0.25).hoursCrossed);
    eq(crossed.join(','), '1,2,3,4', 'hours crossed');
  });

  test('clock', 'a long frame is clamped and bad flows are refused', () => {
    const c = createClock();
    const t = c.advance(30);
    eq(t.dt, MAX_REAL_DT, 'dt');
    eq(c.worldT(), MAX_REAL_DT * 60, 'worldT');
    let threw = false;
    try { c.setFlow(/** @type {any} */ (3)); } catch { threw = true; }
    assert(threw, 'setFlow(3) should throw');
  });

  test('clock', 'display override moves display time only', () => {
    const c = createClock();
    c.reset(7200);
    c.setDisplayOverride(43200);
    eq(c.display(), 43200, 'display');
    const t = c.advance(1 / 64);
    eq(t.displayT, 43200, 'displayT');
    eq(t.worldT, 7200 + 60 / 64, 'worldT');
    c.setDisplayOverride(null);
    eq(c.display(), c.worldT(), 'display after clearing');
  });

  test('clock', 'pure time math: hour, day fraction, season', () => {
    eq(hourIndexOf(3599.99), 0, 'hourIndexOf');
    eq(hourIndexOf(3600), 1, 'hourIndexOf');
    eq(dayFractionOf(6 * 3600), 0.25, 'dayFractionOf');
    const s = seasonOf((56 + 14 + 7) * 86400);
    eq(`${s.year} ${s.index} ${s.day} ${s.phase}`, '1 1 7 0.5', 'seasonOf year index day phase');
  });

  test('clock', 'clock:hour and clock:day arrive on the bus after flush', () => {
    const bus = createBus();
    /** @type {string[]} */
    const got = [];
    bus.on('clock:hour', (p) => got.push(`hour ${p.hour}`));
    bus.on('clock:day', (p) => got.push(`day ${p.day}`));
    const c = createClock({ bus });
    c.reset(23.99 * 3600);
    for (let i = 0; i < 4; i++) c.advance(0.25);
    eq(got.length, 0, 'delivered before flush');
    bus.flushDeferred();
    eq(got.join(', '), 'hour 24, day 1', 'events');
  });
}
