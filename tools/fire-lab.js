// @ts-check
// tools/fire-lab.html (F1 of the volumetric campfire): Matt's fire study ported onto ebb's own GPU
// helpers. The live sim is the game's own (src/render/passes/camp-fire-sim.js and
// src/shaders/camp-fire-sim.wgsl), stepped at a fixed 60 a second; the flame's size follows the
// game's fire rules (src/world/camp/fire.js) through src/world/camp/fire-look.js; every number is
// read from recipes/world/camp.json (fire, smoke, fireSim). The camp scene is the study's own
// raymarched stand-in. The volume is drawn at the tier's resolution, then the smoke laid over the
// scene and the banded flame painted (src/shaders/lib-fire-bands.wgsl). Nothing here is saved.

import { initGpu, loadShader } from '../src/core/gpu.js';
import { loadRecipe } from '../src/core/recipes.js';
import { noFire, layFire, lightFire, feedFire, fireAt } from '../src/world/camp/fire.js';
import { gameFlame, newFireLook, feedLook, stepFireLook, simSteps } from '../src/world/camp/fire-look.js';
import { createCampFireSim, ringSpots } from '../src/render/passes/camp-fire-sim.js';
import { SCENE, VOLUME, composite } from './fire-lab-shaders.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = $('status');

/** Time of day presets, the study's: sky, ambient, stars, sun, exposure and the smoke's albedo. */
const TOD = [
  { z: [0.05, 0.07, 0.15], h: [0.13, 0.13, 0.24], amb: 0.22, stars: 1, sun: [-0.4, 0.55, -0.5], sunI: 0.12, sunCol: [0.55, 0.62, 0.85], exp: 1.15, smoke: [0.42, 0.42, 0.52] },
  { z: [0.32, 0.36, 0.58], h: [0.98, 0.62, 0.46], amb: 0.45, stars: 0, sun: [0.75, 0.16, -0.4], sunI: 0.75, sunCol: [1.0, 0.62, 0.42], exp: 1.05, smoke: [0.68, 0.62, 0.66] },
  { z: [0.42, 0.64, 0.86], h: [0.82, 0.88, 0.92], amb: 0.75, stars: 0, sun: [0.45, 0.8, 0.35], sunI: 1.55, sunCol: [1.0, 0.95, 0.86], exp: 0.95, smoke: [0.78, 0.77, 0.8] },
];
const VIEWS = [{ pitch: 0.62, dist: 3.2 }, { pitch: 0.28, dist: 1.75 }];
/** How long the sim keeps running after the flame sinks to embers, so the last smoke drifts off (s). */
const AFTER_S = 6;
/** The study's heat gain along a ray. */
const HEAT_GAIN = 5.5;

const camp = await loadRecipe('world/camp');
const F = camp.fire, S = camp.fireSim;

const canvas = /** @type {HTMLCanvasElement} */ ($('c'));
const r = await initGpu(canvas);
if (!r.ok) {
  status.textContent = r.reason === 'missing' ? 'This lab needs WebGPU: open it in a recent Chrome or Edge on desktop.' : `The GPU could not start (${r.reason}).`;
  throw new Error(r.reason);
}
const { device, context, format, features } = r.gpu;
const hasTS = features.has('timestamp-query');

// ---- the sim ----
const sim = createCampFireSim({ recipe: S, rain: { flame: F.rainFlame, smoke: camp.smoke.rainThick } });
await sim.setup(device);

// ---- drawing ----
const U_BYTES = 19 * 16;
const uBuf = device.createBuffer({ label: 'fire-lab-u', size: U_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const bandsBuf = device.createBuffer({ label: 'fire-lab-bands', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

/** @param {string} label @param {string} code */
async function module(label, code) {
  const m = device.createShaderModule({ label, code });
  for (const msg of (await m.getCompilationInfo()).messages) {
    if (msg.type === 'error') throw new Error(`${label} line ${msg.lineNum}: ${msg.message}`);
  }
  return m;
}
const [sceneMod, volMod, compMod] = await Promise.all([
  module('fire-lab-scene', SCENE), module('fire-lab-volume', VOLUME), module('fire-lab-composite', composite(await loadShader('lib-fire-bands'))),
]);
const frag = /** @type {GPUShaderStageFlags} */ (GPUShaderStage.FRAGMENT);
const unf = /** @type {GPUTextureBindingLayout} */ ({ sampleType: 'unfilterable-float' });
const volLayout = device.createBindGroupLayout({ label: 'fire-lab-volume', entries: [
  { binding: 0, visibility: frag, buffer: {} },
  { binding: 1, visibility: frag, texture: { sampleType: 'float', viewDimension: '3d' } },
  { binding: 2, visibility: frag, sampler: { type: 'filtering' } },
  { binding: 3, visibility: frag, texture: unf },
] });
const compLayout = device.createBindGroupLayout({ label: 'fire-lab-composite', entries: [
  { binding: 0, visibility: frag, buffer: {} },
  ...[1, 2, 3, 4].map((binding) => ({ binding, visibility: frag, texture: unf })),
  { binding: 5, visibility: frag, buffer: {} },
] });
const scenePipe = device.createRenderPipeline({ label: 'fire-lab-scene', layout: 'auto',
  vertex: { module: sceneMod, entryPoint: 'vs' }, fragment: { module: sceneMod, entryPoint: 'fs', targets: [{ format: 'rgba16float' }, { format: 'r32float' }] } });
const volPipe = device.createRenderPipeline({ label: 'fire-lab-volume', layout: device.createPipelineLayout({ bindGroupLayouts: [volLayout] }),
  vertex: { module: volMod, entryPoint: 'vs' }, fragment: { module: volMod, entryPoint: 'fs', targets: [{ format: 'rgba16float' }, { format: 'rg32float' }] } });
const compPipe = device.createRenderPipeline({ label: 'fire-lab-composite', layout: device.createPipelineLayout({ bindGroupLayouts: [compLayout] }),
  vertex: { module: compMod, entryPoint: 'vs' }, fragment: { module: compMod, entryPoint: 'fs', targets: [{ format }] } });
const sceneGroup = device.createBindGroup({ layout: scenePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uBuf } }] });

/** @type {Record<string, GPUTexture>} */ let rt = {};
/** @type {GPUBindGroup | null} */ let volGroup = null;
/** @type {GPUBindGroup | null} */ let compGroup = null;
let volSize = [1, 1];

const st = {
  speed: 1, rainy: false, tod: 0, view: 0, stylize: S.bands.stylize, tier: 'high', scale: 1,
  /** @type {'surge' | 'now'} */ feed: 'surge',
  yaw: 0.7, pitch: VIEWS[0].pitch, dist: VIEWS[0].dist, frame: 0, time: 0,
  hour: 0, ember: 0.6, lastLitT: 0, running: true, warm: S.warmSteps,
};
// A fresh ring, laid and lit, fed once: burning high with 6 hours of flame.
let fire = /** @type {any} */ (feedFire(/** @type {any} */ (lightFire(layFire(noFire(), 0), 0, F)), 0, F));
const look = newFireLook();
look.flame = gameFlame(fireAt(fire, 0, F), F);
const clock = { acc: 0 };

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = Math.max(2, Math.floor(innerWidth * dpr)), h = Math.max(2, Math.floor(innerHeight * dpr));
  const vw = Math.max(1, Math.round(w * st.scale)), vh = Math.max(1, Math.round(h * st.scale));
  if (canvas.width === w && canvas.height === h && vw === volSize[0] && vh === volSize[1] && volGroup) return;
  canvas.width = w; canvas.height = h; volSize = [vw, vh];
  for (const t of Object.values(rt)) t.destroy();
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  rt = {
    col: device.createTexture({ label: 'fire-lab-col', size: [w, h], format: 'rgba16float', usage }),
    depth: device.createTexture({ label: 'fire-lab-depth', size: [w, h], format: 'r32float', usage }),
    smoke: device.createTexture({ label: 'fire-lab-smoke', size: [vw, vh], format: 'rgba16float', usage }),
    heat: device.createTexture({ label: 'fire-lab-heat', size: [vw, vh], format: 'rg32float', usage }),
  };
  bindGroups();
}
function bindGroups() {
  if (!rt.col) return;
  volGroup = device.createBindGroup({ layout: volLayout, entries: [
    { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: sim.dye.createView() },
    { binding: 2, resource: samp }, { binding: 3, resource: rt.depth.createView() }] });
  compGroup = device.createBindGroup({ layout: compLayout, entries: [
    { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: rt.col.createView() }, { binding: 2, resource: rt.depth.createView() },
    { binding: 3, resource: rt.smoke.createView() }, { binding: 4, resource: rt.heat.createView() }, { binding: 5, resource: { buffer: bandsBuf } }] });
}
addEventListener('resize', resize);

/** The band colours and widths (fixed from the recipe; spec 10.2: palette keys may tint c0..c3 here later). */
function writeBands() {
  const B = S.bands, d = new Float32Array(20);
  const hex = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const ws = [B.edge, ...B.at];
  B.colors.forEach((/** @type {string} */ c, /** @type {number} */ i) => d.set([...hex(c), ws[i]], i * 4));
  d.set([st.stylize, B.soft[0], B.soft[1], S.halo], 16);
  device.queue.writeBuffer(bandsBuf, 0, d);
}

/** @returns {{ grid: number[], pressurePasses: number, samples: number, scale: number }} */
function tierNow() {
  const t = S.tiers[st.tier];
  return { grid: S[t.grid], pressurePasses: t.pressurePasses, samples: t.samples, scale: t.scale };
}

// ---- GPU timers: sim, scene, fire volume, paint ----
const gpuT = { sim: /** @type {number | null} */ (null), scene: /** @type {number | null} */ (null), vol: /** @type {number | null} */ (null), comp: /** @type {number | null} */ (null), warm: /** @type {number | null} */ (null) };
/** @type {GPUQuerySet | null} */ let qs = null;
/** @type {GPUBuffer | null} */ let resolveBuf = null;
/** @type {GPUBuffer[]} */ const readPool = [];
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 8 });
  resolveBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  for (let i = 0; i < 3; i++) readPool.push(device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
}
const avg = (/** @type {number | null} */ old, /** @type {number} */ v) => (old == null ? v : old + (v - old) * 0.08);
/** @param {GPUBuffer} buf @param {number} steps @param {boolean} warm */
async function readTimers(buf, steps, warm) {
  try {
    await buf.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(buf.getMappedRange().slice(0));
    buf.unmap();
    const ms = (/** @type {number} */ a) => Number(t[a + 1] - t[a]) / 1e6;
    const ok = (/** @type {number} */ v) => v > 0 && v < 1000;
    if (ok(ms(2))) gpuT.scene = avg(gpuT.scene, ms(2));
    if (ok(ms(4))) gpuT.vol = avg(gpuT.vol, ms(4));
    if (ok(ms(6))) gpuT.comp = avg(gpuT.comp, ms(6));
    if (steps > 0 && ok(ms(0))) {
      if (warm) gpuT.warm = ms(0); else gpuT.sim = avg(gpuT.sim, ms(0) / steps);
    }
  } catch { /* a lost frame of timing is fine */ }
  readPool.push(buf);
}

// ---- controls ----
/** @param {string} id @param {(v: string) => void} fn */
function seg(id, fn) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    pick(el, b.dataset.v ?? '');
    fn(b.dataset.v ?? '');
  });
}
/** @param {HTMLElement} el @param {string} v */
function pick(el, v) { for (const x of el.querySelectorAll('button')) x.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (x).dataset.v === v)); }
seg('segFeed', (v) => { st.feed = /** @type {'surge' | 'now'} */ (v); });
seg('segSpeed', (v) => { st.speed = +v; });
seg('segRain', (v) => { st.rainy = v === '1'; });
seg('segTod', (v) => { st.tod = +v; });
seg('segView', (v) => { st.view = +v; st.pitch = VIEWS[st.view].pitch; st.dist = VIEWS[st.view].dist; });
seg('segTier', (v) => {
  st.tier = v;
  const t = tierNow();
  if (sim.setTier(t)) bindGroups();
  st.scale = t.scale; pick($('segScale'), String(t.scale)); resize();
});
seg('segScale', (v) => { st.scale = +v; resize(); });
$('stylize').addEventListener('input', (e) => {
  st.stylize = +(/** @type {HTMLInputElement} */ (e.target).value);
  $('stylizeNow').textContent = `${Math.round(st.stylize * 100)}%`;
});

/** Feed the fire: a burning fire or embers take a handful (fire.js); a cold ring is lit instead. */
function feed() {
  const lit = feedFire(fire, st.hour, F) ?? lightFire(fire, st.hour, F);
  if (!lit) return;
  fire = lit;
  feedLook(look, st.feed, F);
}
$('feed').addEventListener('click', feed);
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); feed(); } });
// The camp leaves the view and comes back: the fluid is emptied, then warmed by warmSteps at once.
$('away').addEventListener('click', () => { sim.clear(); st.warm = S.warmSteps; });

let drag = /** @type {{ x: number, y: number } | null} */ (null);
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  st.yaw += (e.clientX - drag.x) * 0.006;
  st.pitch = Math.min(1.35, Math.max(0.08, st.pitch + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); st.dist = Math.min(7, Math.max(1.1, st.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

$('meterHigh').style.left = `${(F.highH / F.maxFuelH) * 100}%`;
resize();
writeBands();
status.textContent = hasTS ? 'Running.' : 'Running. This browser gives no GPU timers, so the costs below are missing.';

// ---- the frame ----
/** Smooth 1D noise for the wind and flicker (the study's). @param {number} x */
function n1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (/** @type {number} */ k) => { const s = Math.sin(k * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  return h(i) * (1 - u) + h(i + 1) * u;
}
const sub = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (/** @type {number[]} */ a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const hm = (/** @type {number} */ h) => { const m = Math.max(0, Math.round(h * 60)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`; };

const u = new Float32Array(U_BYTES / 4);
let last = performance.now(), msAvg = 16;

/** @param {number} now */
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  msAvg += (dt * 1000 - msAvg) * 0.05;
  st.time += dt;
  const t = st.time;

  // The fire by the game's rules, then its look.
  st.hour += (dt * st.speed) / 60;
  const at = fireAt(fire, st.hour, F);
  // Rain lowers the flame in the sim (heat x rainFlame) and its light, as the game's flame does.
  const shown = stepFireLook(look, dt, gameFlame(at, F), st.feed, F, S);
  const L = shown.level;
  const emberTo = at.word === 'embers' ? 1 : at.word === 'lit' ? 0.6 : 0;
  st.ember += (emberTo - st.ember) * Math.min(1, dt * (at.word === 'cold' ? 0.3 : 1.5));

  // Readouts.
  const left = at.word === 'lit' ? at.flameLeftH : 0;
  $('meterFill').style.width = `${Math.min(100, (left / F.maxFuelH) * 100)}%`;
  $('lvlName').textContent = shown.catching ? 'Catching' : at.word === 'lit' ? (at.high ? 'Burning high' : 'Low flames') : at.word === 'embers' ? 'Embers' : 'Cold';
  $('lvlFuel').textContent = at.word === 'lit' ? `${hm(left)} of flame left` : at.word === 'embers' ? `embers for ${hm(at.since + F.emberH - st.hour)}` : 'feed to light';
  $('feed').textContent = at.word === 'cold' ? 'Light the fire' : 'Feed the fire';

  const wind = [(n1(t * 0.13) - 0.5) * 0.7, (n1(t * 0.11 + 40) - 0.5) * 0.7];
  const flick = 0.82 + 0.12 * n1(t * 0.9) + 0.08 * n1(t * 13.0 + 7);
  const sway = [(n1(t * 3.1) - 0.5) * 0.05 + wind[0] * 0.08, (n1(t * 2.7 + 9) - 0.5) * 0.05 + wind[1] * 0.08];

  // The sim runs while lit and AFTER_S seconds after; then it is emptied and stops.
  const enc = device.createCommandEncoder();
  const timed = hasTS && readPool.length > 0 && qs;
  if (at.word === 'lit') st.lastLitT = t;
  const wasRunning = st.running;
  st.running = at.word === 'lit' || t - st.lastLitT < AFTER_S;
  if (wasRunning && !st.running) sim.clear();
  let steps = 0, warm = false;
  if (st.running) {
    if (st.warm > 0) { steps = st.warm; st.warm = 0; warm = true; clock.acc = 0; } else steps = simSteps(clock, dt, S.stepS, S.maxStepsPerFrame);
    if (steps > 0) {
      sim.write({ time: t, level: L, flare: shown.flare, smokePuff: shown.smokePuff, wind, rainy: st.rainy, spots: ringSpots(S.spots, t, L) });
      sim.encode(enc, steps, timed ? { querySet: /** @type {GPUQuerySet} */ (qs), beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined);
    }
  } else clock.acc = 0;

  // Camera and uniforms.
  const tgt = [0, 0.32, 0];
  const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  const cam = [tgt[0] + Math.cos(st.yaw) * cp * st.dist, tgt[1] + sp * st.dist, tgt[2] + Math.sin(st.yaw) * cp * st.dist];
  const f = norm(sub(tgt, cam)), rt_ = norm(cross(f, [0, 1, 0])), up = cross(rt_, f);
  const T = TOD[st.tod];
  const lightI = 2.1 * Math.pow(Math.max(L * (st.rainy ? F.rainFlame : 1), 0), 0.85) * flick + 0.35 * st.ember;
  const warmth = Math.min(1, L);
  const tier = tierNow();
  u.set([
    ...cam, t, ...f, canvas.width / canvas.height, ...rt_, Math.tan((38 * Math.PI) / 180 / 2), ...up, 0,
    L, shown.flare, st.stylize, st.ember,
    sway[0], 0.34 + 0.3 * Math.min(L, 1.2), sway[1], lightI,
    1.0, 0.42 + 0.22 * warmth, 0.16 + 0.12 * warmth, flick,
    ...T.z, T.amb, ...T.h, T.stars, ...norm(T.sun), T.sunI, ...T.sunCol, T.exp,
    canvas.width, canvas.height, st.frame % 1000, shown.smokePuff,
    wind[0], 0, wind[1], 0, ...T.smoke, 0,
    tier.samples, st.scale, S.smokeDensity, HEAT_GAIN,
    ...S.detail, 0, ...sim.bmin, 0, ...sim.box, 0, volSize[0], volSize[1], 0, 0,
  ]);
  device.queue.writeBuffer(uBuf, 0, u);
  writeBands();

  /** @param {number} i */
  const tw = (i) => (timed ? { timestampWrites: { querySet: /** @type {GPUQuerySet} */ (qs), beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 } } : {});
  let pass = enc.beginRenderPass({ label: 'fire-lab-scene', ...tw(2), colorAttachments: [
    { view: rt.col.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    { view: rt.depth.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1e6, 0, 0, 0] }] });
  pass.setPipeline(scenePipe); pass.setBindGroup(0, sceneGroup); pass.draw(3); pass.end();
  pass = enc.beginRenderPass({ label: 'fire-lab-volume', ...tw(4), colorAttachments: [
    { view: rt.smoke.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    { view: rt.heat.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 1e6, 0, 0] }] });
  pass.setPipeline(volPipe); pass.setBindGroup(0, volGroup); pass.draw(3); pass.end();
  pass = enc.beginRenderPass({ label: 'fire-lab-composite', ...tw(6), colorAttachments: [
    { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  pass.setPipeline(compPipe); pass.setBindGroup(0, compGroup); pass.draw(3); pass.end();

  let rbuf = null;
  if (timed && resolveBuf) {
    rbuf = /** @type {GPUBuffer} */ (readPool.pop());
    // Without sim steps this frame, its two stamps are stale: readTimers skips them.
    enc.resolveQuerySet(/** @type {GPUQuerySet} */ (qs), 0, 8, resolveBuf, 0);
    enc.copyBufferToBuffer(resolveBuf, 0, rbuf, 0, 64);
  }
  device.queue.submit([enc.finish()]);
  if (rbuf) readTimers(rbuf, steps, warm);

  if (st.frame % 10 === 0) {
    const ms = (/** @type {number | null} */ v) => (v == null ? '…' : v.toFixed(2));
    const fireMs = gpuT.vol == null || gpuT.comp == null ? null : gpuT.vol + gpuT.comp;
    $('stats').innerHTML =
      `<b>${(1000 / msAvg).toFixed(0)}</b> fps, <b>${msAvg.toFixed(1)}</b> ms a frame<br>` +
      `screen ${canvas.width} × ${canvas.height}, flame ${volSize[0]} × ${volSize[1]}<br>` +
      (hasTS
        ? `GPU sim <b>${ms(gpuT.sim)}</b> ms a step, 60 a second${st.running ? '' : ' (stopped)'}<br>` +
          `GPU flame and smoke <b>${ms(fireMs)}</b> ms a frame<br>` +
          `GPU camp scene (lab only) ${ms(gpuT.scene)} ms<br>` +
          (gpuT.warm != null ? `last warm-up ${S.warmSteps} steps: ${gpuT.warm.toFixed(1)} ms<br>` : '')
        : 'no GPU timers in this browser<br>') +
      `grid ${sim.grid.join(' × ')}, ${sim.pressurePasses} pressure passes, ${tier.samples} samples`;
  }
  st.frame++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
