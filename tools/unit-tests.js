// @ts-check
// The unit test page. It runs every test file in tools/unit-tests-index.js (written by
// `node tools/index-tests.mjs`), most of them over several workers, and the few tests that need
// the page itself: the worker pool and the palette's WebGPU bake below, and the files whose NEEDS
// is webgpu or web-audio, on the main thread. Node runs the rest as well: node tools/run-tests.mjs.

import { stream } from '../src/core/rng.js';
import { initWorkers, run, poolSize, dispose } from '../src/core/workers.js';
import { loadShader } from '../src/core/gpu.js';
import {
  srgbToLinear, linearToSrgb, linearToOklab, oklabToLinear, oklabToOklch, oklchToOklab,
  hexToSrgb, srgbToHex, hexToOklab, oklabToHex, gamutClipSrgb,
} from '../src/render/color/oklab.js';
import { keyWeights, blendPalette, paramsDistance, TIME_KEYS, SEASON_KEYS } from '../src/render/passes/post/palette-keys.js';
import { createPaletteBaker, bakeColor, IDENTITY_PALETTE, LUT_SIZE } from '../src/render/passes/post/lut-bake.js';
import { timeout } from './unit-tests-fixtures.js';
import { TEST_FILES, CORE, loadTestFile, groupId, assert, eq, runOne } from './unit-tests-parallel.js';

/** @type {{group: string, name: string, fn: () => any, unit: string}[]} */
const tests = [];
/** A group's name as a page link slug ('sky and seasons' is sky-and-seasons; tools/affected-tests.mjs). @param {string} s */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The group the tests being added belong to for ?groups= (a main-thread file's key, else the test's own group). */
let unitNow = '';
/** @param {string} group @param {string} name @param {() => any} fn */
const test = (group, name, fn) => tests.push({ group, name, fn, unit: unitNow || slug(group) });


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

/** @param {number} ms */
const timeText = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

// ?only=pond runs just the tests whose group or name holds "pond"; ?serial runs every
// test on the page one after another, as the page did before the workers.
const params = new URLSearchParams(location.search);
const only = (params.get('only') ?? '').trim().toLowerCase();
const serial = params.has('serial');
// ?workers=4 sets how many workers share the long runs.
const WORKERS_MAX = 8;
/** @param {string} group @param {string} name */
const picked = (group, name) => !only || `${group}: ${name}`.toLowerCase().includes(only);
// ?groups=pack,gather runs only those groups and the CORE (what tools/affected-tests.mjs prints);
// ?core runs the core alone. A group is a test file's key (its name, tools/unit-tests-<key>.js),
// or one of this page's own groups (workers, palette). No parameter: the full suite.
const asked = params.has('groups') || params.has('core')
  ? new Set([...CORE, ...(params.get('groups') ?? '').split(',').map((g) => g.trim()).filter(Boolean)])
  : null;
const askedIds = asked && new Set([...asked].map(groupId));
/** Does a group run? @param {string} unit */
const runs = (unit) => !askedIds || askedIds.has(groupId(unit));
/** Files that run in the workers, and files that run on this page's main thread. */
const workerKeys = Object.keys(TEST_FILES).filter((k) => !TEST_FILES[k]);
const pageKeys = Object.keys(TEST_FILES).filter((k) => TEST_FILES[k]);

const ADD = /^export (?:async )?function add\w*Tests\(/m;
/**
 * Whether tools/unit-tests-index.js lists every test file, asked of the local server (tools/serve.ps1
 * lists tools/ at /__list/tools; GitHub Pages cannot, and then this says nothing).
 * @returns {Promise<string>} what is out of date, or '' when it is up to date or cannot be told
 */
async function staleIndex() {
  /** @type {string[]} */
  let names;
  try {
    const r = await fetch('/__list/tools', { cache: 'no-store' });
    if (!r.ok) return '';
    names = await r.json();
  } catch { return ''; }
  const onDisk = new Set(names.map((n) => /^unit-tests-([a-z0-9-]+)\.js$/.exec(n)?.[1]).filter((k) => !!k));
  const gone = Object.keys(TEST_FILES).filter((k) => !onDisk.has(k));
  /** @type {string[]} */
  const missing = [];
  await Promise.all([...onDisk].filter((k) => !(k in TEST_FILES)).map(async (k) => {
    const src = await fetch(`./unit-tests-${k}.js`, { cache: 'no-store' }).then((r) => r.text()).catch(() => '');
    if (ADD.test(src)) missing.push(k);
  }));
  if (!gone.length && !missing.length) return '';
  return `tools/unit-tests-index.js is out of date (${[missing.length ? `not listed: ${missing.sort().join(', ')}` : '', gone.length ? `listed but gone: ${gone.join(', ')}` : ''].filter(Boolean).join('; ')}). `
    + 'Run: node tools/index-tests.mjs';
}

// Each test's last time, so the longest start first and the cores finish together.
const MS_KEY = 'ebb-unit-test-ms';
/** @returns {Record<string, number>} */
function lastTimes() {
  try { return JSON.parse(localStorage.getItem(MS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
/** @param {Record<string, number>} times */
function saveTimes(times) {
  try { localStorage.setItem(MS_KEY, JSON.stringify(times)); } catch { /* private window */ }
}

/** @typedef {{group: string, name: string, ok: boolean, detail: string, ms: number}} Result */

/**
 * Runs the worker-safe test files over several workers, longest tests first.
 * @param {Record<string, number>} last @param {(r: Result) => void} show
 */
async function runInWorkers(last, show) {
  const keys = workerKeys.filter(runs);
  if (!keys.length) return 0;
  const asked = Number(params.get('workers'));
  const n = asked >= 1 ? Math.min(16, Math.floor(asked)) : Math.max(2, Math.min(WORKERS_MAX, (navigator.hardwareConcurrency || 4) - 1));
  /** @type {Map<number, (data: any) => void>} */
  const waiting = new Map();
  let nextId = 0;
  const workers = Array.from({ length: n }, () => {
    const w = new Worker(new URL('./unit-tests-worker.js', import.meta.url), { type: 'module' });
    /** @type {number | null} */
    let current = null;
    w.onmessage = (ev) => { const done = waiting.get(ev.data.id); waiting.delete(ev.data.id); current = null; done?.(ev.data); };
    // An error no test caught (a stray timer, a module that will not load) fails the test in hand.
    w.onerror = (ev) => {
      ev.preventDefault();
      if (current === null) return;
      const done = waiting.get(current); waiting.delete(current); current = null;
      done?.({ error: `worker error: ${ev.message}` });
    };
    /** @param {{key: string, index: number}} msg @returns {Promise<any>} */
    const ask = (msg) => new Promise((resolve) => { const id = nextId++; current = id; waiting.set(id, resolve); w.postMessage({ id, ...msg }); });
    return { w, ask };
  });
  /** @type {{key: string, index: number, group: string, name: string}[]} */
  const jobs = [];
  let k = 0;
  await Promise.all(workers.map(async ({ ask }) => {
    while (k < keys.length) {
      const key = keys[k++];
      const r = await ask({ key, index: -1 });
      if (r.error) { show({ group: key, name: 'the test file loads in a worker', ok: false, detail: r.error, ms: 0 }); continue; }
      r.names.forEach((/** @type {[string, string]} */ [group, name], /** @type {number} */ index) => {
        if (picked(group, name)) jobs.push({ key, index, group, name });
      });
    }
  }));
  jobs.sort((a, b) => (last[`${b.group}: ${b.name}`] ?? 0) - (last[`${a.group}: ${a.name}`] ?? 0));
  let next = 0;
  await Promise.all(workers.map(async ({ ask }) => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await ask({ key: j.key, index: j.index });
      show({ group: j.group, name: j.name, ok: !r.error && r.ok === true, detail: String(r.error ?? r.detail ?? ''), ms: r.ms ?? 0 });
    }
  }));
  for (const { w } of workers) w.terminate();
  return n;
}

async function main() {
  const t0 = performance.now();
  const list = /** @type {HTMLElement} */ (document.getElementById('results'));
  const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
  const slowest = /** @type {HTMLElement} */ (document.getElementById('slowest'));
  const last = lastTimes();
  /** @type {Result[]} */
  const results = [];
  let passed = 0;
  /** @param {Result} r */
  const show = (r) => {
    results.push(r);
    if (r.ok) passed++;
    else console.error(`[unit-tests] ${r.group}: ${r.name}`, r.detail);
    const li = document.createElement('li');
    li.className = r.ok ? 'ok' : 'bad';
    li.innerHTML = `${icon(r.ok)}<span class="text"><span class="word">${r.ok ? 'passed' : 'failed'}</span> ${esc(r.group)}: ${esc(r.name)}`
      + `${r.detail ? `<span class="detail">${esc(r.detail)}</span>` : ''}<span class="ms">${timeText(r.ms)}</span></span>`;
    // Failures go to the top, so they are seen without scrolling.
    if (r.ok) list.appendChild(li); else list.prepend(li);
    summary.textContent = `Running tests: ${passed} of ${results.length} passed so far`;
  };

  // A partial run says so at the top, with the groups it ran.
  if (asked) {
    const known = new Set([...Object.keys(TEST_FILES), ...tests.map((t) => t.unit)]);
    const knownIds = new Set([...known].map(groupId));
    const unknown = [...asked].filter((g) => !knownIds.has(groupId(g)));
    const banner = document.createElement('p');
    banner.className = 'partial';
    banner.textContent = `Partial run: ${asked.size} of ${known.size} groups (the core: ${CORE.join(', ')}`
      + `${asked.size > CORE.length ? `; and ${[...asked].filter((g) => !CORE.includes(g)).join(', ')}` : ''}). `
      + `${unknown.length ? `No such group: ${unknown.join(', ')}. ` : ''}The full suite (no parameters) runs once on the combined tip in the merge queue.`;
    summary.before(banner);
  }
  // A stale test list fails first, at the top.
  const stale = await staleIndex();
  if (stale) show({ group: 'test list', name: 'tools/unit-tests-index.js lists every test file', ok: false, detail: stale, ms: 0 });
  // The files that need this page's main thread (WebGPU, Web Audio); with ?serial, every file.
  /** Tests Node cannot run: this page's own groups and the WebGPU files. */
  const browserOnly = new Set(['workers', 'palette', ...pageKeys.filter((k) => TEST_FILES[k] === 'webgpu')]);
  for (const key of serial ? Object.keys(TEST_FILES) : pageKeys) {
    if (!runs(key)) continue;
    unitNow = key;
    try { (await loadTestFile(key))(test, assert, eq); } catch (e) {
      show({ group: key, name: 'the test file loads on the page', ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: 0 });
    }
  }
  unitNow = '';
  let browserOnlyRan = 0;
  const onPage = (async () => {
    for (const t of tests) {
      if (!runs(t.unit) || !picked(t.group, t.name)) continue;
      if (browserOnly.has(t.unit)) browserOnlyRan++;
      show({ group: t.group, name: t.name, ...(await runOne(t.fn)) });
    }
  })();
  const workerCount = serial ? 0 : await runInWorkers(last, show);
  await onPage;

  for (const r of results) last[`${r.group}: ${r.name}`] = r.ms;
  saveTimes(last);
  const failed = results.length - passed;
  const how = serial ? 'one after another on the page' : `on the page and ${workerCount} workers`;
  summary.textContent = `${passed} of ${results.length} passed${failed ? ` (${failed} failed, shown first)` : ''} in ${timeText(performance.now() - t0)}, ${how}`
    + (only ? `, only tests matching "${only}"` : '') + (asked ? ', a partial run' : '')
    + (browserOnlyRan ? `. Node (node tools/run-tests.mjs) runs all but the ${browserOnlyRan} that need a browser (${[...browserOnly].filter(runs).join(', ')})` : '. Node (node tools/run-tests.mjs) runs all of these too') + '.';
  const top = [...results].sort((a, b) => b.ms - a.ms).slice(0, 8);
  slowest.innerHTML = `<h2>Slowest tests</h2><ol>${top.map((r) => `<li>${timeText(r.ms)}: ${esc(r.group)}: ${esc(r.name)}</li>`).join('')}</ol>`;
}

main();
