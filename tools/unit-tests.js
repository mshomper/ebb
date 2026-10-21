// @ts-check
// Small assert tests for the pure core modules. Imports the real src/ files.

import { hash32, subSeed, stream, det } from '../src/core/rng.js';
import { createClock, hourIndexOf, dayFractionOf, seasonOf, MAX_REAL_DT } from '../src/core/clock.js';
import { createBus } from '../src/core/events.js';
import { createStore, initialSlices } from '../src/core/store.js';
import { initWorkers, run, poolSize, dispose } from '../src/core/workers.js';
import { CHUNK_CELLS, CHUNK_SIZE, CELL, H_MIN, H_MAX, WORLD_CELLS, quantize, dequantize } from '../src/world/terrain/grid.js';
import { buildSummary, hashSummary, WATER_CLASS } from '../src/world/water/summary.js';
import { shoreZones, shoreHeightM } from '../src/world/water/shore.js';
import { strandLines } from '../src/world/water/strandline.js';
import { buildBase, hashBase } from '../src/world/terrain/landform.js';
import { tilesOf, copyTiles, pasteTiles } from '../src/world/terrain/undo.js';
import { createHistory } from '../src/input/actions.js';
import { sunMoon, sunEvents } from '../src/world/sky/sun-moon.js';
import { dayRecord, moodOdds, weatherAt } from '../src/world/weather.js';
import { seasonsAt } from '../src/world/seasons.js';
import * as tide from '../src/world/tide.js';
import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { createLiveSim } from '../src/sim/live-sim.js';
import { loadShader } from '../src/core/gpu.js';
import {
  srgbToLinear, linearToSrgb, linearToOklab, oklabToLinear, oklabToOklch, oklchToOklab,
  hexToSrgb, srgbToHex, hexToOklab, oklabToHex, gamutClipSrgb,
} from '../src/render/color/oklab.js';
import { keyWeights, blendPalette, paramsDistance, TIME_KEYS, SEASON_KEYS } from '../src/render/passes/post/palette-keys.js';
import { createPaletteBaker, bakeColor, IDENTITY_PALETTE, LUT_SIZE } from '../src/render/passes/post/lut-bake.js';
import { addGrowthTests } from './unit-tests-growth.js';
import { addJournalTests } from './unit-tests-journal.js';
import { addSpringTests } from './unit-tests-spring.js';
import { addCreatureTests } from './unit-tests-creatures.js';
import { addIslandTests } from './unit-tests-islands.js';
import { addEcologyTests } from './unit-tests-ecology.js';
import { addPondLifeTests } from './unit-tests-pondlife.js';
import { addDamselflyTests } from './unit-tests-damselflies.js';
import { addFrogTests } from './unit-tests-frogs.js';
import { addSaveTests } from './unit-tests-save.js';
import { addAwayTests } from './unit-tests-away.js';
import { addStoneTests } from './unit-tests-stone.js';
import { addCliffTests } from './unit-tests-cliff.js';
import { addFallsTests } from './unit-tests-falls.js';
import { addRevealTests } from './unit-tests-reveal.js';
import { addQualityTests } from './unit-tests-quality.js';
import { addTrustTests } from './unit-tests-trust.js';
import { addFindsTests } from './unit-tests-finds.js';
import { addNaturalistTests } from './unit-tests-naturalist.js';
import { addKeepsakeTests } from './unit-tests-keepsakes.js';
import { addPiecesTests } from './unit-tests-pieces.js';
import { addCoveTests } from './unit-tests-cove.js';
import { addKeepsakeArtifactTests } from './unit-tests-keepsake-artifacts.js';
import { addAutumnTests } from './unit-tests-autumn.js';
import { addWalkTests } from './unit-tests-walk.js';

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

// ---- tide ----

const TIDE = 'tide';

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

// ---- water summary ----

const WSUM = 'water summary';
/** @type {Promise<any> | null} */
let waterPromise = null;
/** recipes/world/water.json, fetched once. */
function loadWater() {
  waterPromise ??= fetch('../recipes/world/water.json').then((r) => {
    if (!r.ok) throw new Error(`water.json: HTTP ${r.status}`);
    return r.json();
  });
  return waterPromise;
}

/**
 * A 768 x 768 heightQ that is 1 m under the sea everywhere except the rect, where `fn` gives the
 * height (m) at each terrain cell center in rect-local water-cell coordinates.
 * @param {{x:number,y:number,w:number,h:number}} rect @param {(x: number, y: number) => number} fn
 */
function synthHeights(rect, fn) {
  const T = WORLD_CELLS, q = new Uint16Array(T * T).fill(quantize(-1));
  for (let ty = 2 * rect.y; ty < 2 * (rect.y + rect.h); ty++) {
    for (let tx = 2 * rect.x; tx < 2 * (rect.x + rect.w); tx++) q[ty * T + tx] = quantize(fn((tx + 0.5) / 2 - rect.x, (ty + 0.5) / 2 - rect.y));
  }
  return q;
}

const BOWL_RECT = { x: 100, y: 100, w: 40, h: 40 };
/** A flat 1 m island with a round bowl of radius r cells, 0.5 m deep at its center. @param {number} r */
const bowlLand = (r) => (/** @type {number} */ x, /** @type {number} */ y) => {
  if (x < 3 || y < 3 || x > 37 || y > 37) return -1;
  const d2 = (x - 20) ** 2 + (y - 20) ** 2;
  return d2 < r * r ? 1 - 0.5 * (1 - d2 / (r * r)) : 1;
};
const SLOPE_RECT = { x: 60, y: 200, w: 80, h: 24 };
/** A valley down the x axis: steep (0.21) to x 30, gentle (0.009) to x 76, then the sea. */
const slopeLand = (/** @type {number} */ x, /** @type {number} */ y) => {
  if (x < 2 || y < 2 || x > 76 || y > 21) return -1;
  const base = x < 30 ? 4 - (x - 2) * 3 / 28 : 1 - (x - 30) * 0.2 / 46;
  return base + Math.abs(y - 12.5) * 0.05;
};
const SLOPE_SPRING = [{ cellX: 70, cellY: 212, rateLps: 12 }];
/** @param {number} h */
const hex8 = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');

test(WSUM, 'a bowl fills to its lip, and is a pond only with enough catchment or a spring', async () => {
  const water = await loadWater();
  const at = 20 * BOWL_RECT.w + 20;
  const args = (/** @type {number} */ r, /** @type {any[]} */ springs) =>
    ({ heightQ: synthHeights(BOWL_RECT, bowlLand(r)), rect: BOWL_RECT, springs,
      // Thresholds pinned here, so the test checks the rule rather than the recipe's tuning.
      params: { ...water.summary, pondMinCatchmentM2: 30, pondMinDepthM: 0.15 }, tide: water.tide });
  const small = buildSummary(args(4, []));
  eq(small.cls[at], WATER_CLASS.damp, 'small dry bowl class');
  eq(small.targetMm[at], 0, 'small dry bowl depth');
  assert(small.basin[at] > 0, 'small bowl has a basin id');
  eq(small.stats.ponds, 0, 'ponds in the small dry bowl');
  const fed = buildSummary(args(4, [{ cellX: BOWL_RECT.x + 20, cellY: BOWL_RECT.y + 20, rateLps: 3 }]));
  eq(fed.cls[at], WATER_CLASS.still, 'spring-fed small bowl class');
  assert(Math.abs(fed.targetMm[at] - 500) <= 6, `spring-fed bowl center depth ${fed.targetMm[at]} mm, expected about 500 (to the lip)`);
  assert(fed.stats.streamCells > 0, 'the overflow runs on to the sea');
  const big = buildSummary(args(9, []));
  eq(big.cls[at], WATER_CLASS.still, 'large rain-fed bowl class');
  assert(Math.abs(big.targetMm[at] - 500) <= 6, `large bowl center depth ${big.targetMm[at]} mm`);
  eq(big.stats.ponds, 1, 'ponds in the large bowl');
  eq(big.cls[20 * BOWL_RECT.w + 32], WATER_CLASS.dry, 'flat ground beside the bowl');
  return `small: damp, fed: ${fed.targetMm[at]} mm still, large: ${big.targetMm[at]} mm still`;
});

test(WSUM, 'a spring on a slope runs to the sea: running on the steep part, slower on the gentle part', async () => {
  const water = await loadWater();
  const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, slopeLand), rect: SLOPE_RECT, springs: SLOPE_SPRING, params: water.summary, tide: water.tide });
  const row = (/** @type {number} */ i) => s.cls[12 * SLOPE_RECT.w + i];
  for (let i = 10; i <= 75; i++) assert(row(i) !== WATER_CLASS.dry, `cell ${i} on the route is dry`);
  for (let i = 12; i <= 26; i++) eq(row(i), WATER_CLASS.running, `steep cell ${i}`);
  for (let i = 36; i <= 70; i++) assert(row(i) === WATER_CLASS.slow || row(i) === WATER_CLASS.still, `gentle cell ${i} is class ${row(i)}`);
  eq(row(79), WATER_CLASS.sea, 'route ends in the sea');
  const steep = s.targetMm[12 * SLOPE_RECT.w + 20], gentle = s.targetMm[12 * SLOPE_RECT.w + 50];
  assert(gentle > steep, `gentle water (${gentle} mm) should be deeper than steep (${steep} mm)`);
  return `${s.stats.streamCells} stream cells, ${steep} mm on the steep part, ${gentle} mm on the gentle part`;
});

test(WSUM, 'the outer ring below sea level is sea, and the shore is in the tide band', async () => {
  const water = await loadWater();
  const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, slopeLand), rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
  const { w, h } = SLOPE_RECT;
  for (let i = 0; i < w; i++) for (const j of [0, h - 1]) eq(s.cls[j * w + i], WATER_CLASS.sea, `ring cell ${i},${j}`);
  for (let j = 0; j < h; j++) for (const i of [0, w - 1]) eq(s.cls[j * w + i], WATER_CLASS.sea, `ring cell ${i},${j}`);
  // A beach rising 0.05 m per cell from -1 m: the band is the bed within 1.15 x 0.6 m of sea level.
  const beach = buildSummary({
    heightQ: synthHeights(SLOPE_RECT, (x, y) => (y < 2 || y > 21 || x > 76) ? -1 : -1 + x * 0.05),
    rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
  const at = (/** @type {number} */ i) => 12 * w + i;
  eq(beach.cls[at(10)], WATER_CLASS.sea, 'beach cell at -0.5 m is sea');
  eq(beach.band[at(10)], 1, 'beach cell at -0.5 m is in the tide band');
  eq(beach.band[at(28)], 1, 'beach cell at +0.4 m is in the tide band');
  eq(beach.band[at(4)], 0, 'beach cell at -0.8 m is below the band');
  eq(beach.band[at(40)], 0, 'beach cell at +1 m is above the band');
  eq(beach.cls[at(40)], WATER_CLASS.dry, 'beach cell at +1 m is dry');
});

/** The beach above: bed of water cell i is -1 + 0.05 (i + 0.25) m (the lower of its terrain cells). */
const beachLand = (/** @type {number} */ x, /** @type {number} */ y) => ((y < 2 || y > 21 || x > 76) ? -1 : -1 + x * 0.05);
const beachBed = (/** @type {number} */ i) => -1 + 0.05 * (i + 0.25);

test(WSUM, 'shore height grades the band and the splash ground above it, and reads back as the bed', async () => {
  const water = await loadWater();
  const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, beachLand), rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
  const at = (/** @type {number} */ i) => 12 * SLOPE_RECT.w + i;
  const A0 = water.tide.amplitudeM;
  assert(Math.abs(s.shoreRange.loM + 1.15 * A0) < 1e-3 && Math.abs(s.shoreRange.hiM - 1.75 * A0) < 1e-3, `range ${s.shoreRange.loM} .. ${s.shoreRange.hiM}`);
  eq(s.shore[at(4)], 0, 'below the band (-0.79 m)');
  assert(s.shore[at(38)] > 0, 'splash ground (+0.91 m) is shore');
  eq(s.shore[at(45)], 0, 'above the splash top (+1.26 m)');
  let prev = 0;
  for (let i = 6; i <= 40; i++) {
    const v = s.shore[at(i)];
    assert(v > prev, `shore height should rise along the beach: ${prev} then ${v} at cell ${i}`);
    const m = shoreHeightM(v, s.shoreRange);
    assert(Math.abs(m - beachBed(i)) < 0.01, `cell ${i}: reads ${m.toFixed(3)} m, bed ${beachBed(i).toFixed(3)} m`);
    prev = v;
  }
  return `shore ${s.shore[at(6)]} at ${beachBed(6).toFixed(2)} m to ${s.shore[at(40)]} at ${beachBed(40).toFixed(2)} m`;
});

test(WSUM, 'strandlines: the newest high tide always lies, a higher later tide sweeps older lines up', async () => {
  const water = await loadWater();
  const R = (await (await fetch('../recipes/world/shore.json')).json()).look.strandline;
  const p = tide.tideParams(water.tide);
  // Day 0 is a spring tide (new moon): the first high water is the highest, nothing older shows.
  eq(strandLines(10, p, R).levels.length, 1, 'one line just after a spring high');
  // Falling toward the neap (day 1.75), every high is lower than the one before: they all lie.
  const falling = strandLines(39, p, R);
  assert(falling.levels.length >= 3, `lines while the tides fall: ${falling.levels.length}`);
  for (let i = 1; i < falling.levels.length; i++) {
    assert(falling.levels[i] > falling.levels[i - 1], `older lines lie higher: ${falling.levels.join(', ')}`);
    assert(falling.strengths[i] < falling.strengths[i - 1], 'older lines are fainter');
  }
  assert(falling.levels.length <= R.maxLines, 'at most maxLines');
  eq(JSON.stringify(strandLines(39, p, R)), JSON.stringify(falling), 'the same every time');
  return `hour 39: ${falling.levels.map((v) => v.toFixed(2)).join(', ')} m`;
});

test(WSUM, 'shore zones follow height and paint: kelp, wrack and wet sand where they belong, the same every time', async () => {
  const water = await loadWater();
  const recipe = await (await fetch('../recipes/world/shore.json')).json();
  const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, beachLand), rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
  // Rock painted on the lower beach (cells below 25), sand above.
  const T = WORLD_CELLS, material = new Uint8Array(T * T * 4);
  for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
    const i = Math.floor(tx / 2) - SLOPE_RECT.x;
    material[(ty * T + tx) * 4 + (i < 25 ? 2 : 1)] = 255;
  }
  const z = shoreZones({ summary: s, material, recipe, amplitudeM: water.tide.amplitudeM });
  const id = (/** @type {number} */ i) => { const v = z.zone[12 * SLOPE_RECT.w + i]; return v ? z.ids[v - 1] : 'none'; };
  eq(id(8), 'kelp', 'rock at -0.59 m');
  eq(id(16), 'wrack', 'rock at -0.19 m');
  eq(id(22), 'wrack', 'rock at +0.11 m');
  eq(id(28), 'wetSand', 'sand at +0.41 m');
  eq(id(36), 'none', 'sand at +0.81 m, above the wet sand');
  eq(id(45), 'none', 'above the shore');
  const again = shoreZones({ summary: s, material, recipe, amplitudeM: water.tide.amplitudeM });
  eq(again.zone.join(','), z.zone.join(','), 'second run');
  return z.ids.map((n, i) => `${n} ${z.cells[i]}`).join(', ');
});

test(WSUM, '1 m cells follow their four 0.5 m cells: fastest wet class, mean wet depth, any band', async () => {
  const water = await loadWater();
  const rect = { x: SLOPE_RECT.x + 1, y: SLOPE_RECT.y + 1, w: SLOPE_RECT.w - 1, h: SLOPE_RECT.h - 1 };
  const land = (/** @type {number} */ x, /** @type {number} */ y) => slopeLand(x + 1, y + 1);
  const s = buildSummary({ heightQ: synthHeights(rect, land), rect, springs: SLOPE_SPRING, params: water.summary, tide: water.tide });
  const e = s.eco;
  eq(e.x, Math.floor(rect.x / 2), 'eco.x'); eq(e.y, Math.floor(rect.y / 2), 'eco.y');
  eq(e.w, Math.ceil((rect.x + rect.w) / 2) - e.x, 'eco.w'); eq(e.h, Math.ceil((rect.y + rect.h) / 2) - e.y, 'eco.h');
  let wetCells = 0;
  for (let b = 0; b < e.h; b++) for (let a = 0; a < e.w; a++) {
    let fast = 0, damp = 0, band = 0, wet = 0;
    for (let sub = 0; sub < 4; sub++) {
      const i = 2 * (e.x + a) + (sub & 1) - rect.x, j = 2 * (e.y + b) + (sub >> 1) - rect.y;
      if (i < 0 || j < 0 || i >= rect.w || j >= rect.h) continue;
      const c = s.cls[j * rect.w + i];
      band |= s.band[j * rect.w + i];
      if (c === WATER_CLASS.damp) damp = 1;
      else if (c !== WATER_CLASS.dry) { wet++; fast = Math.max(fast, c); }
    }
    const k = b * e.w + a;
    eq(e.cls[k], wet ? fast : damp ? WATER_CLASS.damp : WATER_CLASS.dry, `eco class at ${a},${b}`);
    eq(e.band[k], band, `eco band at ${a},${b}`);
    if (wet && fast !== WATER_CLASS.sea) wetCells++;
    if (!wet) eq(e.depthCm[k], 0, `dry eco depth at ${a},${b}`);
  }
  assert(wetCells > 20, `only ${wetCells} stream eco cells`);
  return `${e.w} x ${e.h} eco cells, ${wetCells} with stream water`;
});

test(WSUM, 'buildSummary twice gives the same hash, and a different spring changes it', async () => {
  const water = await loadWater();
  const heightQ = synthHeights(SLOPE_RECT, slopeLand);
  const args = { heightQ, rect: SLOPE_RECT, springs: SLOPE_SPRING, params: water.summary, tide: water.tide };
  const a = buildSummary(args), b = buildSummary(args);
  eq(b.hash, a.hash, 'second build');
  eq(hashSummary(a), a.hash, 'hashSummary of the result');
  const c = buildSummary({ ...args, springs: [{ ...SLOPE_SPRING[0], rateLps: 30 }] });
  assert(c.hash !== a.hash, 'a stronger spring gave the same hash');
  return `hash ${hex8(a.hash)}, ${a.stats.ms?.toFixed(1)} ms`;
});

test(WSUM, 'buildSummary in a worker gives the same hash as on the main thread', async () => {
  const water = await loadWater();
  initWorkers({ size: 1 });
  try {
    const heightQ = synthHeights(BOWL_RECT, bowlLand(4));
    const args = { heightQ, rect: BOWL_RECT, springs: [{ cellX: 120, cellY: 120, rateLps: 3 }], params: water.summary, tide: water.tide };
    const m = buildSummary(args);
    const wr = await timeout(run({ module: './world/water/summary.js', fn: 'buildSummary' }, args));
    assert(wr.targetMm instanceof Uint16Array && wr.eco.cls instanceof Uint8Array, 'worker result types');
    assert(!('__transfer' in wr), '__transfer should be stripped');
    eq(wr.hash, m.hash, 'worker hash');
    eq(hashSummary(wr), m.hash, 'hash of the arrays that came back');
    return `hash ${hex8(m.hash)}`;
  } finally {
    dispose();
  }
});

// ---- palette ----

const PAL = 'palette';
/** @type {Map<string, Promise<any>>} */
const paletteFiles = new Map();
/** recipes/palettes/<id>.json, fetched once. @param {string} id */
function loadPaletteFile(id) {
  let p = paletteFiles.get(id);
  if (!p) {
    p = fetch(`../recipes/palettes/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`${id}.json: HTTP ${r.status}`);
      return r.json();
    });
    paletteFiles.set(id, p);
  }
  return p;
}
/** @type {Promise<GPUDevice | null> | null} */
let testDevicePromise = null;
/** A WebGPU device for the palette tests, or null when WebGPU is unavailable. */
function testDevice() {
  testDevicePromise ??= (async () => {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (e) => console.error('[unit-tests] WebGPU:', /** @type {GPUUncapturedErrorEvent} */ (e).error.message));
    return device;
  })().catch(() => null);
  return testDevicePromise;
}
const NO_GPU = 'skipped: WebGPU is not available in this browser';

/** Half float bits -> number. @param {number} h */
function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/**
 * Read a 32^3 rgba16float LUT back to the CPU as rgb floats (x fastest, then y, then z).
 * @param {GPUDevice} device @param {GPUTexture} tex
 */
async function readLut(device, tex) {
  const N = LUT_SIZE, bytesPerRow = N * 8;
  const buf = device.createBuffer({ size: bytesPerRow * N * N, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow, rowsPerImage: N }, [N, N, N]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const h = new Uint16Array(buf.getMappedRange().slice(0));
  buf.unmap();
  buf.destroy();
  const out = new Float32Array(N * N * N * 3);
  for (let t = 0; t < N * N * N; t++) for (let c = 0; c < 3; c++) out[t * 3 + c] = halfToFloat(h[t * 4 + c]);
  return out;
}

/** Bake on the GPU with fadeS 0 and return the active LUT's contents. @param {GPUDevice} device @param {any} palette */
async function bakeAndRead(device, palette, keys = { sunAltDeg: 40, seasonPhase: 1.5 }) {
  const baker = await createPaletteBaker(device);
  baker.setPalette(palette, { fadeS: 0 });
  const frame = baker.update(0, keys);
  const enc = device.createCommandEncoder();
  baker.encode(enc);
  device.queue.submit([enc.finish()]);
  const data = await readLut(device, baker.luts[frame.to]);
  return { baker, frame, data };
}

/** Deterministic test colors. @param {number} n @param {number} seed @returns {[number, number, number][]} */
function testColors(n, seed) {
  const s = stream(seed);
  return Array.from({ length: n }, () => /** @type {[number, number, number]} */ ([s.next(), s.next(), s.next()]));
}

test(PAL, 'OKLab round trip for 1,000 random sRGB colors stays within 1e-6', () => {
  let worst = 0;
  for (const c of testColors(1000, 501)) {
    const back = linearToSrgb(oklabToLinear(linearToOklab(srgbToLinear(c))));
    const lch = oklabToOklch(linearToOklab(srgbToLinear(c)));
    const back2 = linearToSrgb(oklabToLinear(oklchToOklab(lch)));
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(back[k] - c[k]), Math.abs(back2[k] - c[k]));
  }
  assert(worst <= 1e-6, `worst error ${worst}`);
  eq(srgbToHex(hexToSrgb('#5F7F3D')), '#5F7F3D', 'hex round trip');
  const white = linearToOklab([1, 1, 1]);
  assert(Math.abs(white[0] - 1) < 1e-6 && Math.hypot(white[1], white[2]) < 1e-6, `white is ${white.join(', ')}`);
  return `worst error ${worst.toExponential(1)}`;
});

test(PAL, 'gamutClipSrgb keeps L and hue within 1e-3 and lands inside 0..1', () => {
  const s = stream(502);
  let worstL = 0, worstH = 0, clipped = 0;
  for (let i = 0; i < 2000; i++) {
    /** @type {[number, number, number]} */
    const lab = [s.range(0.02, 0.98), s.range(-0.4, 0.4), s.range(-0.4, 0.4)];
    const rgb = gamutClipSrgb(oklabToLinear(lab));
    for (const v of rgb) assert(v >= 0 && v <= 1, `component ${v} out of range for ${lab.join(', ')}`);
    const back = linearToOklab(rgb);
    worstL = Math.max(worstL, Math.abs(back[0] - lab[0]));
    if (Math.hypot(back[1], back[2]) > 1e-4) {
      const dh = Math.atan2(back[2], back[1]) - Math.atan2(lab[2], lab[1]);
      worstH = Math.max(worstH, Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))));
    }
    if (Math.hypot(back[1], back[2]) < Math.hypot(lab[1], lab[2]) - 1e-9) clipped++;
  }
  assert(worstL <= 1e-3 && worstH <= 1e-3, `L error ${worstL}, hue error ${worstH} rad`);
  assert(clipped > 500, `only ${clipped} of 2000 needed clipping`);
  return `${clipped} of 2,000 clipped; L error ${worstL.toExponential(1)}, hue error ${worstH.toExponential(1)} rad`;
});

test(PAL, 'keyWeights sum to 1 for time and season keys and never jump', () => {
  let sumErr = 0, jumpT = 0, jumpS = 0;
  let prev = keyWeights({ sunAltDeg: -90, seasonPhase: 0 });
  for (let a = -90; a <= 90.0001; a += 0.1) {
    const w = keyWeights({ sunAltDeg: a, seasonPhase: 0 });
    sumErr = Math.max(sumErr, Math.abs(TIME_KEYS.reduce((t, k) => t + w[k], 0) - 1));
    for (const k of TIME_KEYS) { assert(w[k] >= 0, `${k} negative at ${a}`); jumpT = Math.max(jumpT, Math.abs(w[k] - prev[k])); }
    prev = w;
  }
  prev = keyWeights({ sunAltDeg: 30, seasonPhase: 0 });
  for (let p = 0; p <= 8.0001; p += 0.001) {
    const w = keyWeights({ sunAltDeg: 30, seasonPhase: p });
    sumErr = Math.max(sumErr, Math.abs(SEASON_KEYS.reduce((t, k) => t + w[k], 0) - 1));
    for (const k of SEASON_KEYS) jumpS = Math.max(jumpS, Math.abs(w[k] - prev[k]));
    prev = w;
  }
  assert(sumErr < 1e-9, `weights sum off by ${sumErr}`);
  assert(jumpT <= 0.05, `time weight jumped ${jumpT} over 0.1 deg`);
  assert(jumpS <= 0.01, `season weight jumped ${jumpS} over 0.001 season`);
  const at = (/** @type {number} */ alt) => Object.entries(keyWeights({ sunAltDeg: alt, seasonPhase: 0 })).filter(([k, v]) => TIME_KEYS.includes(/** @type {any} */ (k)) && v > 0.99).map(([k]) => k).join('');
  eq([-30, -8, 1, 13, 45].map(at).join(' '), 'night blue-hour golden morning day', 'keys at band centers');
  eq(keyWeights({ sunAltDeg: 0, seasonPhase: 3.5 }).winter, 1, 'mid winter');
  const wrap = keyWeights({ sunAltDeg: 0, seasonPhase: 4 });
  assert(Math.abs(wrap.winter - 0.5) < 1e-12 && Math.abs(wrap.spring - 0.5) < 1e-12, 'winter blends into spring');
  return `largest step: time ${jumpT.toFixed(4)} per 0.1 deg, season ${jumpS.toFixed(4)} per 0.001`;
});

test(PAL, 'blendPalette with all weight on night returns the night grade', async () => {
  const dusk = await loadPaletteFile('dusk');
  const n = dusk.keys.night.grade;
  for (const w of [{ night: 1 }, keyWeights({ sunAltDeg: -40, seasonPhase: 1.5 })]) {
    const r = blendPalette(dusk, w);
    assert(Math.abs(r.grade.chroma - n.chroma) < 1e-12, `chroma ${r.grade.chroma}`);
    assert(Math.abs(r.grade.shadowAmt - n.shadowAmt) < 1e-12, `shadowAmt ${r.grade.shadowAmt}`);
    eq(oklabToHex(r.grade.shadowTint), n.shadowTint.toUpperCase(), 'shadow tint');
    eq(oklabToHex(r.grade.highlightTint), dusk.grade.highlightTint.toUpperCase(), 'highlight tint inherits the base');
    eq(r.anchors.length, 12, 'anchors');
  }
  const winterNight = blendPalette(dusk, { night: 1, winter: 1 });
  assert(Math.abs(winterNight.grade.chroma - (n.chroma + dusk.keys.winter.grade.chroma - dusk.grade.chroma)) < 1e-12, 'winter mutes the night further');
  const overcast = blendPalette(dusk, { day: 1, summer: 1, overcast: 1 });
  assert(Math.abs(overcast.grade.chroma - dusk.grade.chroma * 0.8) < 1e-12, `overcast chroma ${overcast.grade.chroma}`);
  const day = blendPalette(dusk, { day: 1, summer: 1 });
  assert(paramsDistance(day, blendPalette(dusk, { day: 1, summer: 1 })) === 0, 'distance to itself');
  assert(paramsDistance(day, overcast) > 0.1, 'overcast moves the params');
});

test(PAL, 'Dusk moves a leaf-mid color about a third of the way toward its target, keeping its lightness', async () => {
  const dusk = await loadPaletteFile('dusk');
  const leaf = dusk.anchors.find((/** @type {any} */ a) => a.role === 'leaf-mid');
  const from = hexToOklab(leaf.from), to = hexToOklab(leaf.to);
  const neutral = { lift: 0, gamma: 1, gain: 1, chroma: 1, shadowAmt: 0, highlightAmt: 0 };
  // Calibrated "from" colors sit close to their targets in hue and chroma and differ mostly in
  // lightness, which keepLuminance keeps, so measure the whole OKLab move, not the a/b plane alone.
  const span = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  /** @param {any} pal */
  const pull = (pal) => {
    const out = linearToOklab(srgbToLinear(bakeColor(blendPalette(pal, { day: 1, summer: 1 }), hexToSrgb(leaf.from))));
    const along = ((out[0] - from[0]) * (to[0] - from[0]) + (out[1] - from[1]) * (to[1] - from[1]) + (out[2] - from[2]) * (to[2] - from[2])) / (span * span);
    return { along, dL: out[0] - from[0], hex: oklabToHex(out) };
  };
  const anchorsOnly = pull({ ...dusk, keys: {}, grade: neutral });
  assert(anchorsOnly.along > 0.01 && anchorsOnly.along < 0.5, `anchor pull moved ${anchorsOnly.along.toFixed(3)} of the way`);
  assert(Math.abs(anchorsOnly.dL) <= (1 - dusk.keepLuminance) * Math.abs(to[0] - from[0]) + 0.02, `lightness moved ${anchorsOnly.dL}`);
  const full = pull(dusk);
  assert(full.along > 0 && full.along < 0.9, `full Dusk moved ${full.along.toFixed(3)} of the way`);
  return `anchor pull ${(anchorsOnly.along * 100).toFixed(0)}% of the way (${leaf.from} to ${anchorsOnly.hex}, target ${leaf.to}); with the Dusk grade ${(full.along * 100).toFixed(0)}% (${full.hex})`;
});

test(PAL, 'WGSL lib-oklab matches oklab.js within 1e-4', async () => {
  const device = await testDevice();
  if (!device) return NO_GPU;
  const lib = await loadShader('lib-oklab');
  const code = `${lib}
@group(0) @binding(0) var<storage, read> src: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= arrayLength(&src) / 2u) { return; }
  let c = src[2u * i].rgb;
  let lab = linearToOklab(srgbToLinear3(c));
  dst[2u * i] = vec4f(lab, 0.0);
  dst[2u * i + 1u] = vec4f(linearToSrgb3(oklabToLinear(oklchToOklab(oklabToOklch(lab)))), 0.0);
}`;
  const colors = testColors(1024, 503);
  const n = colors.length;
  const input = new Float32Array(n * 8);
  colors.forEach((c, i) => input.set(c, i * 8));
  const srcBuf = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const dstBuf = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(srcBuf, 0, input);
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: srcBuf } }, { binding: 1, resource: { buffer: dstBuf } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(n / 64));
  pass.end();
  enc.copyBufferToBuffer(dstBuf, 0, readBuf, 0, input.byteLength);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  for (const b of [srcBuf, dstBuf, readBuf]) b.destroy();
  let worst = 0;
  colors.forEach((c, i) => {
    const lab = linearToOklab(srgbToLinear(c));
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(out[i * 8 + k] - lab[k]), Math.abs(out[i * 8 + 4 + k] - c[k]));
  });
  assert(worst <= 1e-4, `worst difference ${worst}`);
  return `worst difference ${worst.toExponential(1)} over ${n} colors`;
});

test(PAL, 'the identity palette bakes to an identity LUT on the GPU within 1/1024', async () => {
  const device = await testDevice();
  if (!device) return NO_GPU;
  const { baker, data } = await bakeAndRead(device, IDENTITY_PALETTE);
  const N = LUT_SIZE;
  let worst = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = ((z * N + y) * N + x) * 3;
    worst = Math.max(worst, Math.abs(data[t] - x / 31), Math.abs(data[t + 1] - y / 31), Math.abs(data[t + 2] - z / 31));
  }
  baker.destroy();
  assert(worst <= 1 / 1024, `worst error ${worst}`);
  return `worst error ${worst.toExponential(2)} (limit ${(1 / 1024).toExponential(2)})`;
});

test(PAL, 'a Dusk bake on the GPU matches the CPU reference, and a bake takes well under a millisecond', async () => {
  const device = await testDevice();
  if (!device) return NO_GPU;
  const dusk = await loadPaletteFile('dusk');
  const { baker, data } = await bakeAndRead(device, dusk);
  const r = baker.resolved();
  const N = LUT_SIZE;
  let worst = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = bakeColor(r, [x / 31, y / 31, z / 31]);
    const t = ((z * N + y) * N + x) * 3;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(data[t + k] - c[k]));
  }
  assert(worst <= 2e-3, `GPU and CPU differ by ${worst}`);

  // Timing: many bakes in one submit, wall time per bake (an upper bound on GPU time).
  const runs = 200;
  await device.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  const enc = device.createCommandEncoder();
  for (let i = 0; i < runs; i++) { baker.bakeNow(); baker.encode(enc); }
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  const ms = (performance.now() - t0) / runs;
  baker.destroy();
  assert(ms < 1, `${ms.toFixed(3)} ms per bake`);
  return `GPU vs CPU worst ${worst.toExponential(1)}; about ${ms.toFixed(3)} ms per bake (wall time over ${runs} bakes)`;
});

test(PAL, 'setPalette crossfades over fadeS, and fadeS 0 swaps at once', async () => {
  const device = await testDevice();
  if (!device) return NO_GPU;
  const [dusk, meadow] = await Promise.all([loadPaletteFile('dusk'), loadPaletteFile('meadow-morning')]);
  const baker = await createPaletteBaker(device);
  const keys = { sunAltDeg: 40, seasonPhase: 1.5, weather: { cloud: 0, rain: 0, mist: 0 } };
  baker.setPalette(dusk, { fadeS: 0 });
  let f = baker.update(1 / 60, keys);
  eq(f.from, f.to, 'no fade after a fadeS 0 swap');
  eq(baker.id(), 'dusk', 'id');
  const duskLook = f.look.power;
  baker.setPalette(meadow, { fadeS: 0.6 });
  f = baker.update(0.3, keys);
  assert(f.from !== f.to && f.fade > 0.3 && f.fade < 0.7, `mid fade: from ${f.from} to ${f.to} fade ${f.fade}`);
  const lo = Math.min(duskLook, meadow.look.power), hi = Math.max(duskLook, meadow.look.power);
  assert(f.look.power > lo && f.look.power < hi, `look mid fade ${f.look.power} should sit between ${lo} and ${hi}`);
  eq(baker.current(), meadow, 'current() is the new palette');
  f = baker.update(0.31, keys);
  eq(f.from, f.to, 'fade finished');
  eq(f.look.power, meadow.look.power, 'look after the fade');
  // A setting sun rebakes the active LUT, but no more than 4 times a second.
  let enc = device.createCommandEncoder();
  baker.encode(enc);
  device.queue.submit([enc.finish()]);
  /** @type {number[]} */
  const bakeFrames = [];
  for (let i = 0; i < 60; i++) {
    baker.update(1 / 60, { ...keys, sunAltDeg: 25 - i * 0.75 });
    enc = device.createCommandEncoder();
    if (baker.encode(enc)) bakeFrames.push(i);
    device.queue.submit([enc.finish()]);
  }
  const gaps = bakeFrames.slice(1).map((v, k) => v - bakeFrames[k]);
  assert(bakeFrames.length >= 2 && bakeFrames.length <= 4, `${bakeFrames.length} rebakes in one second of a setting sun`);
  assert(gaps.every((g) => g >= 15), `rebakes at frames ${bakeFrames.join(', ')}`);
  baker.update(1, keys);
  enc = device.createCommandEncoder();
  const settled = baker.encode(enc);
  device.queue.submit([enc.finish()]);
  baker.update(1, keys);
  enc = device.createCommandEncoder();
  eq(baker.encode(enc), false, `a still sun does not rebake (first settle bake ${settled})`);
  device.queue.submit([enc.finish()]);
  baker.destroy();
  return `${bakeFrames.length} rebakes (frames ${bakeFrames.join(', ')}) in one second while the sun fell from 25 to -19 deg`;
});

// ---- growth (tools/unit-tests-growth.js) ----

addGrowthTests(test, assert, eq);

// ---- journal (tools/unit-tests-journal.js) ----

addJournalTests(test, assert, eq);

// ---- spring (tools/unit-tests-spring.js) ----

addSpringTests(test, assert, eq);

// ---- creatures (tools/unit-tests-creatures.js) ----

addCreatureTests(test, assert, eq);

// ---- islands (tools/unit-tests-islands.js) ----

addIslandTests(test, assert, eq);

// ---- ecology (tools/unit-tests-ecology.js) ----

addEcologyTests(test, assert, eq);

// ---- live frogs (tools/unit-tests-frogs.js) ----

addFrogTests(test, assert, eq);

// ---- saving (tools/unit-tests-save.js) ----

addSaveTests(test, assert, eq);

// ---- time away (tools/unit-tests-away.js) ----

addAwayTests(test, assert, eq);
addStoneTests(test, assert, eq);
addCliffTests(test, assert, eq);
addFallsTests(test, assert, eq);

// ---- the reveal (tools/unit-tests-reveal.js) ----

addRevealTests(test, assert, eq);

// ---- quality: dynamic resolution and the frame cap (tools/unit-tests-quality.js) ----

addQualityTests(test, assert, eq);
addTrustTests(test, assert, eq);
addFindsTests(test, assert, eq);
addNaturalistTests(test, assert, eq);
addKeepsakeTests(test, assert, eq);
addPondLifeTests(test, assert, eq);
addDamselflyTests(test, assert, eq);

// ---- placed pieces: loose stones (tools/unit-tests-pieces.js) ----

addPiecesTests(test, assert, eq);
addCoveTests(test, assert, eq);

// ---- keepsake artifact models (tools/unit-tests-keepsake-artifacts.js) ----

addKeepsakeArtifactTests(test, assert, eq);

// ---- autumn's season markers: fungi on logs, dewy webs (tools/unit-tests-autumn.js) ----

addAutumnTests(test, assert, eq);

// ---- the walker: walk grid, paths, the sandbar (tools/unit-tests-walk.js) ----

addWalkTests(test, assert, eq);

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
