// @ts-check
// Small assert tests for the pure core modules. Imports the real src/ files.

import { hash32, subSeed, stream, det } from '../src/core/rng.js';
import { createClock, hourIndexOf, dayFractionOf, seasonOf, MAX_REAL_DT } from '../src/core/clock.js';
import { createBus } from '../src/core/events.js';
import { createStore, initialSlices } from '../src/core/store.js';
import { initWorkers, run, poolSize, dispose } from '../src/core/workers.js';
import { CHUNK_CELLS, CHUNK_SIZE, CELL, H_MIN, H_MAX, quantize, dequantize } from '../src/world/terrain/grid.js';
import { buildBase, hashBase } from '../src/world/terrain/landform.js';
import { tilesOf, copyTiles, pasteTiles } from '../src/world/terrain/undo.js';
import { createHistory } from '../src/input/actions.js';
import { sunMoon, sunEvents } from '../src/world/sky/sun-moon.js';
import { dayRecord, moodOdds, weatherAt } from '../src/world/weather.js';
import { seasonsAt } from '../src/world/seasons.js';
import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { createLiveSim } from '../src/sim/live-sim.js';

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

// ---- terrain ----

/** @type {Promise<any> | null} */
let landPromise = null;
/** The starter island recipe, fetched once. */
function loadLand() {
  landPromise ??= fetch('../recipes/land/starter-island.json').then((r) => {
    if (!r.ok) throw new Error(`starter-island.json: HTTP ${r.status}`);
    return r.json();
  });
  return landPromise;
}
const TERRAIN_SEED = subSeed(1, 'terrain');

test('terrain', 'quantize and dequantize round trip within 0.25 mm and clamp at -4 and +12', () => {
  let worst = 0;
  for (let k = 0; k <= 16000; k++) {
    const h = H_MIN + k * 0.001;
    worst = Math.max(worst, Math.abs(dequantize(quantize(h)) - h));
  }
  assert(worst <= 0.00025, `worst error ${worst} m`);
  eq(quantize(-4), 0, 'quantize(-4)');
  eq(quantize(-9), 0, 'quantize(-9)');
  eq(quantize(12), 65535, 'quantize(12)');
  eq(quantize(30), 65535, 'quantize(30)');
  eq(dequantize(0), H_MIN, 'dequantize(0)');
  eq(dequantize(65535), H_MAX, 'dequantize(65535)');
  return `worst error ${(worst * 1000).toFixed(3)} mm`;
});

test('terrain', 'edit delta wraps around and restores every height', () => {
  const pairs = [[0, 0], [100, 40], [40, 100], [0, 65535], [65535, 0], [65535, 65535], [1, 65534], [32768, 12]];
  for (let k = 0; k < 2000; k++) pairs.push([(k * 7919) % 65536, (k * 104729) % 65536]);
  for (const [q, baseQ] of pairs) {
    const delta = (q - baseQ) & 0xFFFF;
    assert(delta >= 0 && delta <= 65535, `delta ${delta} out of range`);
    eq((baseQ + delta) & 0xFFFF, q, `restore q=${q} base=${baseQ}`);
  }
  eq((0 - 65535) & 0xFFFF, 1, 'wrap delta for q=0, base=65535');
});

test('terrain', 'buildBase is identical twice for one seed and differs for another', async () => {
  const land = await loadLand();
  const a = buildBase({ land, seed: TERRAIN_SEED, cx: 0, cz: 0 });
  const b = buildBase({ land, seed: TERRAIN_SEED, cx: 0, cz: 0 });
  const c = buildBase({ land, seed: subSeed(2, 'terrain'), cx: 0, cz: 0 });
  eq(a.heightQ.length, CHUNK_CELLS * CHUNK_CELLS, 'heightQ length');
  eq(a.material.length, CHUNK_CELLS * CHUNK_CELLS * 4, 'material length');
  for (let k = 0; k < a.heightQ.length; k++) eq(a.heightQ[k], b.heightQ[k], `height ${k}`);
  for (let k = 0; k < a.material.length; k++) eq(a.material[k], b.material[k], `material ${k}`);
  const ha = hashBase(a.heightQ, a.material), hc = hashBase(c.heightQ, c.material);
  eq(hashBase(b.heightQ, b.material), ha, 'hash of second build');
  assert(ha !== hc, 'a different seed gave the same hash');
  return `hash ${ha.toString(16).toUpperCase().padStart(8, '0')}`;
});

test('terrain', 'material weights sum to 255 in every cell of the 9 starter chunks', async () => {
  const land = await loadLand();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const { material } = buildBase({ land, seed: TERRAIN_SEED, cx, cz });
    for (let k = 0; k < material.length; k += 4) {
      const sum = material[k] + material[k + 1] + material[k + 2] + material[k + 3];
      if (sum !== 255) throw new Error(`chunk ${cx},${cz} cell ${k / 4} sums to ${sum}`);
    }
  }
});

test('terrain', 'heights are continuous across the seam between chunks (0,0) and (1,0)', async () => {
  const land = await loadLand();
  const a = buildBase({ land, seed: TERRAIN_SEED, cx: 0, cz: 0 });
  const b = buildBase({ land, seed: TERRAIN_SEED, cx: 1, cz: 0 });
  const N = CHUNK_CELLS;
  let worst = 0;
  for (let j = 0; j < N; j++) {
    const h = (/** @type {Uint16Array} */ q, /** @type {number} */ i) => dequantize(q[j * N + i]);
    const left = h(a.heightQ, N - 1) - h(a.heightQ, N - 2);   // step just inside chunk (0,0)
    const seam = h(b.heightQ, 0) - h(a.heightQ, N - 1);       // step across the seam
    const right = h(b.heightQ, 1) - h(b.heightQ, 0);          // step just inside chunk (1,0)
    assert(Math.abs(seam) < 0.15, `row ${j}: seam step ${seam.toFixed(3)} m`);
    worst = Math.max(worst, Math.abs(seam - (left + right) / 2));
  }
  assert(worst < 0.01, `seam step differs from its neighbors by ${worst.toFixed(4)} m`);
  return `largest seam kink ${(worst * 1000).toFixed(2)} mm`;
});

test('terrain', 'cells beyond falloffEnd are exactly the seabed', async () => {
  const land = await loadLand();
  const sea = quantize(land.seabedDepth);
  let counted = 0;
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [0, -1]]) {
    const { heightQ } = buildBase({ land, seed: TERRAIN_SEED, cx, cz });
    for (let j = 0; j < CHUNK_CELLS; j++) for (let i = 0; i < CHUNK_CELLS; i++) {
      const x = CHUNK_SIZE * cx - CHUNK_SIZE / 2 + (i + 0.5) * CELL;
      const z = CHUNK_SIZE * cz - CHUNK_SIZE / 2 + (j + 0.5) * CELL;
      if (Math.sqrt(x * x + z * z) < land.falloffEnd) continue;
      counted++;
      if (heightQ[j * CHUNK_CELLS + i] !== sea) throw new Error(`chunk ${cx},${cz} cell ${i},${j} is ${heightQ[j * CHUNK_CELLS + i]}, not ${sea}`);
    }
  }
  assert(counted > 1000, `only ${counted} cells checked`);
  return `${counted} cells checked`;
});

test('terrain', 'buildBase in a worker gives the same hash as on the main thread', async () => {
  const land = await loadLand();
  initWorkers({ size: 2 });
  const job = { module: './world/terrain/landform.js', fn: 'buildBase' };
  const chunks = [[0, 0], [-1, 1]];
  const results = await timeout(Promise.all(chunks.map(([cx, cz]) => run(job, { land, seed: TERRAIN_SEED, cx, cz }))));
  for (let k = 0; k < chunks.length; k++) {
    const [cx, cz] = chunks[k];
    const w = results[k];
    assert(w.heightQ instanceof Uint16Array && w.material instanceof Uint8Array, 'worker result types');
    assert(!('__transfer' in w), '__transfer should be stripped');
    const m = buildBase({ land, seed: TERRAIN_SEED, cx, cz });
    eq(hashBase(w.heightQ, w.material), hashBase(m.heightQ, m.material), `chunk ${cx},${cz} hash`);
  }
  dispose();
});

// ---- undo ----

test('undo', 'tiles copied before an edit restore the mirror exactly', () => {
  const N = 768;
  const mirror = { heightQ: new Uint16Array(N * N), heightF: new Float32Array(N * N), material: new Uint8Array(N * N * 4) };
  for (let k = 0; k < N * N; k++) { mirror.heightQ[k] = hash32(k) & 0xffff; mirror.material[k * 4] = k & 255; }
  const rect = { x: 300, y: 310, w: 50, h: 20 };
  const ids = tilesOf(rect);
  eq(ids.length, 4, 'a 50 x 20 rect at (300, 310) overlaps 2 x 2 tiles of 32 cells');
  const before = copyTiles(mirror, ids);
  const orig = mirror.heightQ.slice();
  const origM = mirror.material.slice();
  for (let j = rect.y; j < rect.y + rect.h; j++) for (let i = rect.x; i < rect.x + rect.w; i++) { mirror.heightQ[j * N + i] = 7; mirror.material[(j * N + i) * 4 + 2] = 99; }
  const after = copyTiles(mirror, ids);
  pasteTiles(mirror, before);
  for (let k = 0; k < N * N; k++) if (mirror.heightQ[k] !== orig[k]) throw new Error(`height differs at cell ${k}`);
  for (let k = 0; k < N * N * 4; k++) if (mirror.material[k] !== origM[k]) throw new Error(`material differs at byte ${k}`);
  pasteTiles(mirror, after);
  eq(mirror.heightQ[(rect.y + 5) * N + rect.x + 5], 7, 'redo puts the edit back');
});

test('undo', 'history steps back and forth, clears redo on a new edit and drops the oldest past its budget', () => {
  const h = createHistory({ budgetBytes: 1000 });
  /** @type {string[]} */
  const log = [];
  h.setApplier('t', (cmd, dir) => { log.push(`${dir}:${cmd.id}`); return true; });
  h.push({ kind: 't', bytes: 400, id: 1 });
  h.push({ kind: 't', bytes: 400, id: 2 });
  assert(h.undo() && h.undo(), 'two undos');
  eq(h.canUndo(), false, 'nothing left to undo');
  assert(h.redo(), 'redo');
  h.push({ kind: 't', bytes: 400, id: 3 });
  eq(h.canRedo(), false, 'a new edit clears redo');
  h.push({ kind: 't', bytes: 400, id: 4 });
  eq(h.depth().undo, 2, 'budget of 1000 bytes keeps the newest two 400-byte steps');
  eq(log.join(' '), 'undo:2 undo:1 redo:1', 'applier calls');
  const busy = createHistory({ budgetBytes: 1000 });
  busy.setApplier('t', () => false);
  busy.push({ kind: 't', bytes: 1 });
  eq(busy.undo(), false, 'a busy owner refuses');
  eq(busy.canUndo(), true, 'and the step stays on the stack');
});

// ---- sky and seasons ----

const SKY = 'sky and seasons';
const DAY_S = 86400;
const RAD = Math.PI / 180;
/** @type {Promise<any> | null} */
let seasonsPromise = null;
/** recipes/world/seasons.json, fetched once. */
function loadSeasons() {
  seasonsPromise ??= fetch('../recipes/world/seasons.json').then((r) => {
    if (!r.ok) throw new Error(`seasons.json: HTTP ${r.status}`);
    return r.json();
  });
  return seasonsPromise;
}
/** @param {number} hours */
const fmtH = (hours) => `${hours.toFixed(2)} h`;

test(SKY, 'noon altitude is 90 - latitude + declination; with tilt 0 the equinox noon sun is at 50 deg', () => {
  const flat = sunMoon(0.5 * DAY_S, { latitudeDeg: 40, tiltDeg: 0 });
  assert(Math.abs(flat.sunAlt / RAD - 50) < 0.01, `tilt 0 noon altitude ${flat.sunAlt / RAD}`);
  let worst = 0;
  for (let d = 0; d < 28; d++) {
    const t = (d + 0.5) * DAY_S;
    const decl = Math.asin(Math.sin(18 * RAD) * Math.sin(2 * Math.PI * (t / (28 * DAY_S))));
    worst = Math.max(worst, Math.abs(sunMoon(t).sunAlt - (50 * RAD + decl)) / RAD);
  }
  assert(worst < 0.01, `noon altitude off by ${worst} deg`);
  return `day 0 noon (1.98 deg past the equinox): ${(sunMoon(0.5 * DAY_S).sunAlt / RAD).toFixed(2)} deg`;
});

test(SKY, 'day length: solstice 14.1 h and 9.9 h at tilt 18 (doc 06 14.5 / 9.5 needs tilt 21), matching a sampled day', () => {
  const summer = sunMoon(7 * DAY_S).dayLengthH, winter = sunMoon(21 * DAY_S).dayLengthH;
  assert(Math.abs(summer - 14.09) < 0.05 && Math.abs(winter - 9.91) < 0.05, `tilt 18: ${fmtH(summer)} / ${fmtH(winter)}`);
  const s21 = sunMoon(7 * DAY_S, { tiltDeg: 21 }).dayLengthH, w21 = sunMoon(21 * DAY_S, { tiltDeg: 21 }).dayLengthH;
  assert(Math.abs(s21 - 14.5) < 0.3 && Math.abs(w21 - 9.5) < 0.3, `tilt 21: ${fmtH(s21)} / ${fmtH(w21)}`);
  // count the minutes above the horizon on day 6 (the day before the solstice boundary)
  let up = 0;
  for (let m = 0; m < 1440; m++) if (sunMoon(6 * DAY_S + (m + 0.5) * 60).sunAlt > 0) up++;
  const sampled = up / 60, analytic = sunMoon(6.5 * DAY_S).dayLengthH;
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

test(SKY, 'moon is new at each season start, full at day 3.5, and rises later each day', () => {
  for (const s of [0, 1, 2, 5]) {
    const m = sunMoon(s * 7 * DAY_S);
    assert(m.moonPhase === 0 && m.moonIllum === 0, `season ${s}: phase ${m.moonPhase}, illum ${m.moonIllum}`);
  }
  const full = sunMoon(3.5 * DAY_S);
  assert(Math.abs(full.moonPhase - 0.5) < 1e-12 && Math.abs(full.moonIllum - 1) < 1e-9, `day 3.5 illum ${full.moonIllum}`);
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

test(SKY, 'season:changed fires at hours 168 and 336, and dormancy follows the recipe windows', async () => {
  const recipe = await loadSeasons();
  const env = makeEnv(1, { seasons: recipe });
  let st = initialWorldState(1);
  /** @type {string[]} */
  const got = [];
  for (let h = 0; h <= 336; h++) {
    const r = runHour(st, h, env);
    st = r.state;
    for (const e of r.events) if (e.name === 'season:changed') got.push(`${e.hour}:${e.payload.index}`);
  }
  eq(got.join(' '), '168:1 336:2', 'season changes over hours 0..336');
  const at = (/** @type {number} */ seasonPos) => seasonsAt(seasonPos * 7 * DAY_S, recipe).dormant;
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
  const files = ['world/sky/sun-moon.js', 'world/seasons.js', 'world/weather.js', 'sim/tick.js'];
  for (const f of files) {
    const r = await fetch(`../src/${f}`);
    const src = (await r.text()).replace(/\/\/.*$/gm, '');
    const bad = src.match(/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot|cbrt|random|sinh|cosh|tanh|expm1|log1p|log2|log10)\b/);
    assert(!bad, `${f} uses ${bad?.[0]}`);
  }
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
