// @ts-check
// Small assert tests for the pure core modules. Imports the real src/ files.

import { hash32, subSeed, stream, det } from '../src/core/rng.js';
import { createClock, hourIndexOf, dayFractionOf, seasonOf, MAX_REAL_DT } from '../src/core/clock.js';
import { createBus } from '../src/core/events.js';
import { createStore, initialSlices } from '../src/core/store.js';
import { initWorkers, run, poolSize, dispose } from '../src/core/workers.js';

/** @type {{group: string, name: string, fn: () => any}[]} */
const tests = [];
/** @param {string} group @param {string} name @param {() => any} fn */
const test = (group, name, fn) => tests.push({ group, name, fn });

/** @param {any} cond @param {string} [msg] */
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
/** @param {any} a @param {any} b @param {string} [msg] */
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${String(b)}, got ${String(a)}`.trim());
}
/** @template T @param {Promise<T>} p @param {number} ms @returns {Promise<T>} */
function timeout(p, ms = 10000) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
}

// ---- rng ----

/** Independent PCG reference in BigInt, to check the Math.imul version. @param {number} v */
function refPcg(v) {
  const M = 0x100000000n;
  const state = (BigInt(v >>> 0) * 747796405n + 2891336453n) % M;
  const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n) % M;
  return Number((word >> 22n) ^ word);
}

test('rng', 'hash32 matches a BigInt reference of the PCG hash', () => {
  for (const x of [0, 1, 2, 12345, 0x7fffffff, 0x80000000, 0xffffffff, -1, -77]) eq(hash32(x), refPcg(x), `hash32(${x})`);
  eq(hash32(42, 7), refPcg((refPcg(42) ^ 7) >>> 0), 'hash32(42, 7)');
});

test('rng', 'hash32, subSeed and stream known values are stable', () => {
  eq(hash32(0), 129708002, 'hash32(0)');
  eq(hash32(1), 2831084092, 'hash32(1)');
  eq(hash32(42, 7, 1207), 2634068183, 'hash32(42,7,1207)');
  eq(hash32(0xffffffff, 123), 3149477041, 'hash32(0xffffffff,123)');
  eq(subSeed(42, 'growth'), 700129222, "subSeed(42,'growth')");
  const s = stream(42, 1, 2);
  eq(s.nextU32(), 533647707, 'stream(42,1,2) #0');
  eq(s.nextU32(), 1185724525, 'stream(42,1,2) #1');
});

test('rng', 'same seed and keys give the same sequence', () => {
  const a = stream(9001, 3, 1207), b = stream(9001, 3, 1207);
  for (let i = 0; i < 1000; i++) eq(a.nextU32(), b.nextU32(), `value ${i}`);
});

test('rng', 'different seed or keys give a different sequence', () => {
  const a = stream(1, 5), b = stream(2, 5), c = stream(1, 6);
  let sameB = 0, sameC = 0;
  for (let i = 0; i < 100; i++) {
    const x = a.nextU32();
    if (x === b.nextU32()) sameB++;
    if (x === c.nextU32()) sameC++;
  }
  assert(sameB === 0 && sameC === 0, `matches: seed ${sameB}, keys ${sameC}`);
  assert(subSeed(1, 'growth') !== subSeed(1, 'weather'), 'sub-seeds collide');
});

test('rng', 'next, range and int stay in bounds with a sensible mean', () => {
  const s = stream(77);
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const v = s.next();
    assert(v >= 0 && v < 1, `next out of range: ${v}`);
    sum += v;
    const r = s.range(-3, 5);
    assert(r >= -3 && r < 5, `range out of bounds: ${r}`);
    const n = s.int(10);
    assert(Number.isInteger(n) && n >= 0 && n < 10, `int out of bounds: ${n}`);
  }
  const mean = sum / 20000;
  assert(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
});

/**
 * @param {string} name
 * @param {(...a: number[]) => number} f
 * @param {(...a: number[]) => number} g
 * @param {number[][]} inputs
 * @param {'abs'|'rel'} mode
 * @param {number} tol
 */
function sweepCheck(name, f, g, inputs, mode, tol) {
  let worst = 0, at = '';
  for (const x of inputs) {
    const a = f(...x), b = g(...x);
    const err = mode === 'abs' ? Math.abs(a - b) : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
    if (!(err <= worst)) { worst = err; at = x.join(', '); }
  }
  assert(worst <= tol, `${name} worst error ${worst} at (${at})`);
  return worst;
}
/** @param {number} a @param {number} b @param {number} n */
const sweep = (a, b, n) => Array.from({ length: n }, (_, i) => [a + (b - a) * i / (n - 1)]);

test('rng', 'det.sin and det.cos match Math within 1e-10 over -1000..1000', () => {
  sweepCheck('sin', det.sin, Math.sin, sweep(-1000, 1000, 50001), 'abs', 1e-10);
  sweepCheck('cos', det.cos, Math.cos, sweep(-1000, 1000, 50001), 'abs', 1e-10);
});

test('rng', 'det.exp and det.log match Math within 1e-10 relative', () => {
  sweepCheck('exp', det.exp, Math.exp, sweep(-700, 700, 50001), 'rel', 1e-10);
  sweepCheck('log', det.log, Math.log, sweep(1e-6, 1e6, 50001), 'rel', 1e-10);
  eq(det.log(0), -Infinity, 'log(0)');
  assert(Number.isNaN(det.log(-1)), 'log(-1) should be NaN');
});

test('rng', 'det.pow and det.atan2 match Math', () => {
  const pw = sweep(0.01, 100, 2001).flatMap(([x]) => [[x, 2.5], [x, -1.3], [x, 0.5], [x, 7]]);
  sweepCheck('pow', det.pow, Math.pow, pw, 'rel', 1e-10);
  eq(det.pow(-2, 3), -8, 'pow(-2,3)');
  const at = Array.from({ length: 20000 }, (_, i) => [Math.sin(i * 1.7) * (1 + i % 50), Math.cos(i * 2.3) * (1 + i % 7)]);
  sweepCheck('atan2', det.atan2, Math.atan2, at, 'abs', 1e-10);
});

// ---- clock ----

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
  const s = seasonOf((28 + 7 + 3.5) * 86400);
  eq(`${s.year} ${s.index} ${s.day} ${s.phase}`, '1 1 3 0.5', 'seasonOf year index day phase');
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

// ---- events ----

test('events', 'listeners run in order and unsubscribe works', () => {
  const bus = createBus();
  /** @type {string[]} */
  const got = [];
  bus.on('a', (p) => got.push(`1:${p}`));
  const un = bus.on('a', (p) => got.push(`2:${p}`));
  const third = (/** @type {any} */ p) => got.push(`3:${p}`);
  bus.on('a', third);
  bus.emit('a', 'x');
  un();
  bus.off('a', third);
  bus.emit('a', 'y');
  eq(got.join(' '), '1:x 2:x 3:x 1:y', 'order');
});

test('events', 'deferred events wait for flush and keep their order', () => {
  const bus = createBus();
  /** @type {string[]} */
  const got = [];
  bus.on('e', (p) => {
    got.push(p);
    if (p === 'b') bus.emitDeferred('e', 'late');
  });
  bus.emitDeferred('e', 'a');
  bus.emitDeferred('e', 'b');
  eq(got.length, 0, 'before flush');
  eq(bus.flushDeferred(), 2, 'first flush count');
  eq(got.join(' '), 'a b', 'first flush');
  bus.flushDeferred();
  eq(got.join(' '), 'a b late', 'second flush');
});

// ---- store ----

test('store', 'initial slices hold meta and settings', () => {
  const st = createStore();
  eq(st.get('meta').flow, 1, 'meta.flow');
  eq(st.get('settings').palette, 'dusk', 'settings.palette');
  assert(initialSlices().meta !== initialSlices().meta, 'defaults are fresh objects');
});

test('store', 'update by mutation or by return value notifies subscribers', () => {
  const st = createStore();
  /** @type {any[]} */
  const seen = [];
  let otherCalls = 0;
  const un = st.subscribe('meta', (v) => seen.push(v.worldT));
  st.subscribe('settings', () => otherCalls++);
  st.update('meta', (m) => { m.worldT = 60; });
  st.update('meta', (m) => ({ ...m, worldT: 120 }));
  eq(st.get('meta').worldT, 120, 'worldT');
  un();
  st.update('meta', (m) => { m.worldT = 999; });
  eq(seen.join(','), '60,120', 'notifications');
  eq(otherCalls, 0, 'other slice subscriber calls');
  st.update('water', () => ({ chunks: 0 }));
  eq(st.get('water').chunks, 0, 'new slice');
});

// ---- workers ----

const SELFTEST = './core/jobs-selftest.js';

test('workers', 'pool starts and sumSquares returns the right number', async () => {
  initWorkers();
  const n = poolSize();
  assert(n >= 1 && n <= 14, `pool size ${n}`);
  const r = await timeout(run({ module: SELFTEST, fn: 'sumSquares' }, { n: 1000 }));
  eq(r, (1000 * 1001 * 2001) / 6, 'sumSquares(1000)');
  return `pool size ${n}`;
});

test('workers', 'fillBuffer twice with one seed is identical, and matches the main thread', async () => {
  const job = { module: SELFTEST, fn: 'fillBuffer' };
  const [a, b] = await timeout(Promise.all([run(job, { length: 4096, seed: 31 }), run(job, { length: 4096, seed: 31 })]));
  assert(a.buffer instanceof ArrayBuffer && a.buffer.byteLength === 4096 * 4, 'buffer size');
  assert(!('__transfer' in a), '__transfer should be stripped');
  const fa = new Float32Array(a.buffer), fb = new Float32Array(b.buffer);
  const s = stream(31, 0x5e1f);
  for (let i = 0; i < fa.length; i++) {
    eq(fa[i], fb[i], `value ${i}`);
    eq(fa[i], Math.fround(s.next()), `main-thread value ${i}`);
  }
});

test('workers', 'a newer queued job with the same key cancels the older one', async () => {
  const job = { module: SELFTEST, fn: 'sumSquares' };
  const fill = [];
  for (let i = 0; i < poolSize(); i++) fill.push(run(job, { n: 200000 }));
  const older = run(job, { n: 10 }, { key: 'k' });
  const newer = run(job, { n: 10 }, { key: 'k' });
  let name = '';
  try { await timeout(older); } catch (e) { name = /** @type {Error} */ (e).name; }
  eq(name, 'Cancelled', 'older job error name');
  eq(await timeout(newer), 385, 'newer job result');
  await timeout(Promise.all(fill));
});

test('workers', 'a missing export rejects instead of hanging', async () => {
  let failed = false;
  try { await timeout(run({ module: SELFTEST, fn: 'noSuchJob' }, {})); } catch { failed = true; }
  assert(failed, 'should reject');
});

test('workers', 'interactive jumps the queue ahead of background', async () => {
  initWorkers({ size: 1 });
  const job = { module: SELFTEST, fn: 'sumSquares' };
  /** @type {string[]} */
  const order = [];
  const busy = run(job, { n: 200000 });
  const bg = run(job, { n: 5 }, { lane: 'background' }).then(() => order.push('background'));
  const ia = run(job, { n: 5 }, { lane: 'interactive' }).then(() => order.push('interactive'));
  await timeout(Promise.all([busy, bg, ia]));
  eq(order.join(', '), 'interactive, background', 'finish order');
  dispose();
  eq(poolSize(), 0, 'pool size after dispose');
});

// ---- runner and rendering ----

const CHECK = '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>';
const WARN = '<path d="M12 3.5L2.8 19.8h18.4z"/><path d="M12 9.5v4.8"/><path d="M12 17.2v.1"/>';
/** @param {boolean} ok */
function icon(ok) {
  const color = ok ? '#5F7F5B' : '#B5654A';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ok ? CHECK : WARN}</svg>`;
}
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

async function main() {
  const list = /** @type {HTMLElement} */ (document.getElementById('results'));
  const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
  let passed = 0;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    let ok = true, detail = '';
    try {
      const r = await t.fn();
      if (typeof r === 'string') detail = r;
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`[unit-tests] ${t.group}: ${t.name}`, e);
    }
    if (ok) passed++;
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'bad';
    li.innerHTML = `${icon(ok)}<span class="text"><span class="word">${ok ? 'passed' : 'failed'}</span> ${esc(t.group)}: ${esc(t.name)}${detail ? `<span class="detail">${esc(detail)}</span>` : ''}</span>`;
    list.appendChild(li);
    summary.textContent = `Running tests: ${passed} of ${i + 1} passed so far`;
  }
  summary.textContent = `${passed} of ${tests.length} passed`;
}

main();
