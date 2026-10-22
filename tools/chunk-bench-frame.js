// @ts-check
// One island of the chunk bench (tools/chunk-bench.html), run in a frame: the real app on today's
// island or the larger one, as a new island grows it from that island's land recipe (the terrain
// recipe's islands.list overridden in memory, tools/chunk-bench-sizes.js), with every pass of the
// frame timed on the GPU. The parent page shows the results.
//
// Timing: when the device has 'timestamp-query', every compute and render pass recorded into the
// app's 'frame' command encoder gets its own begin and end stamps (this page wraps the encoder's
// beginRenderPass, beginComputePass and finish), so passes the frame graph does not time on their
// own (water sim, foam, wetness, each shadow cascade) are timed too. Without timestamps, the whole
// frame is timed from submit to queue.onSubmittedWorkDone on the CPU, and no pass is isolated.

import { SIZES, sizedTerrain, isTerrainRecipe } from './chunk-bench-sizes.js';

const params = new URLSearchParams(location.search);
const size = SIZES.find((s) => s.id === params.get('size')) ?? SIZES[0];
const FRAMES = Math.max(30, Number(params.get('frames')) || 240);
const SETTLE_MS = Math.max(500, Number(params.get('settle')) || 4000);
const $status = /** @type {HTMLElement} */ (document.getElementById('status'));

/** @param {any} msg */
const post = (msg) => parent.postMessage({ source: 'chunk-bench', size: size.id, ...msg }, location.origin);
/** @param {string} text */
const say = (text) => { $status.textContent = text; post({ type: 'progress', text }); };

// ---------------------------------------------------------------------------
// The island: the terrain recipe comes back with the starter island growing from this island's
// land, in memory only. The land recipe itself (chunk range, center, camera reach) is the real one.

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const href = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  if (!isTerrainRecipe(new URL(href, location.href).pathname)) return realFetch(input, init);
  const r = await realFetch(input, init);
  if (!r.ok) return r;
  const json = sizedTerrain(await r.json(), size);
  return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// ---------------------------------------------------------------------------
// Pass timing

const PAIRS = 128;
const SLOTS = 4;
let measuring = false;
/** @type {{ label: string, ms: number }[][]} one list of pass times per measured frame */
const frames = [];
/** @type {number[]} submit to work done, per frame (no timestamps) */
const wholeFrame = [];

/** @typedef {{ qs: GPUQuerySet, resolve: GPUBuffer, read: GPUBuffer, busy: boolean }} Slot */
/** @type {WeakMap<GPUDevice, { canTime: boolean, slots: Slot[] }>} */
const devices = new WeakMap();
/** @type {WeakMap<GPUCommandEncoder | GPUCommandBuffer, { dev: { canTime: boolean }, slot: Slot | null, labels: string[] }>} */
const tracked = new WeakMap();

/** @param {GPUDevice} device */
function deviceState(device) {
  let d = devices.get(device);
  if (!d) {
    const canTime = device.features.has('timestamp-query');
    /** @type {Slot[]} */ const slots = [];
    if (canTime) {
      for (let i = 0; i < SLOTS; i++) {
        slots.push({
          qs: device.createQuerySet({ label: `chunk-bench-time-${i}`, type: 'timestamp', count: PAIRS * 2 }),
          resolve: device.createBuffer({ label: `chunk-bench-resolve-${i}`, size: PAIRS * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
          read: device.createBuffer({ label: `chunk-bench-read-${i}`, size: PAIRS * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
          busy: false,
        });
      }
    }
    d = { canTime, slots };
    devices.set(device, d);
  }
  return d;
}

const createEncoder = GPUDevice.prototype.createCommandEncoder;
GPUDevice.prototype.createCommandEncoder = function (desc) {
  const enc = createEncoder.call(this, desc);
  if (desc?.label === 'frame') {
    const dev = deviceState(this);
    const slot = measuring ? dev.slots.find((s) => !s.busy) ?? null : null;
    if (slot) slot.busy = true;
    tracked.set(enc, { dev, slot, labels: [] });
  }
  return enc;
};

for (const name of /** @type {const} */ (['beginRenderPass', 'beginComputePass'])) {
  const begin = /** @type {any} */ (GPUCommandEncoder.prototype)[name];
  /** @type {any} */ (GPUCommandEncoder.prototype)[name] = function (/** @type {any} */ desc = {}) {
    const t = tracked.get(this);
    if (t?.slot && t.labels.length < PAIRS) {
      const i = t.labels.length;
      t.labels.push(desc.label ?? name);
      desc = { ...desc, timestampWrites: { querySet: t.slot.qs, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } };
    }
    return begin.call(this, desc);
  };
}

const finish = GPUCommandEncoder.prototype.finish;
GPUCommandEncoder.prototype.finish = function (desc) {
  const t = tracked.get(this);
  if (t?.slot) {
    if (t.labels.length) {
      const n = t.labels.length * 2;
      this.resolveQuerySet(t.slot.qs, 0, n, t.slot.resolve, 0);
      this.copyBufferToBuffer(t.slot.resolve, 0, t.slot.read, 0, n * 8);
    } else {
      t.slot.busy = false;
      t.slot = null;
    }
  }
  const cb = finish.call(this, desc);
  if (t) tracked.set(cb, t);
  return cb;
};

const submit = GPUQueue.prototype.submit;
GPUQueue.prototype.submit = function (buffers) {
  const t0 = performance.now();
  submit.call(this, buffers);
  for (const cb of buffers) {
    const t = tracked.get(cb);
    if (!t) continue;
    const slot = t.slot, labels = t.labels;
    if (slot) {
      slot.read.mapAsync(GPUMapMode.READ, 0, labels.length * 16).then(() => {
        const stamps = new BigInt64Array(slot.read.getMappedRange(0, labels.length * 16));
        const out = labels.map((label, i) => ({ label, ms: Math.max(0, Number(stamps[2 * i + 1] - stamps[2 * i])) / 1e6 }));
        slot.read.unmap();
        slot.busy = false;
        if (measuring) frames.push(out);
      }).catch(() => { slot.busy = false; });
    } else if (!t.dev.canTime && measuring) {
      this.onSubmittedWorkDone().then(() => { if (measuring) wholeFrame.push(performance.now() - t0); });
    }
  }
};

// ---------------------------------------------------------------------------
// Statistics

/** Mean of the middle 90 percent (drops the slowest and fastest 5 percent). @param {number[]} a */
function trimmedMean(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const cut = Math.floor(s.length * 0.05);
  const mid = s.slice(cut, s.length - cut);
  return (mid.length ? mid : s).reduce((p, q) => p + q, 0) / (mid.length || s.length);
}
/** @param {number[]} a @param {number} q */
function pct(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * Per pass label: its time in the frames it ran in (summed when a label runs more than once in a
 * frame), and the share of frames it ran in.
 */
function summarize() {
  /** @type {Map<string, number[]>} */ const per = new Map();
  /** @type {number[]} */ const totals = [];
  for (const f of frames) {
    /** @type {Map<string, number>} */ const sum = new Map();
    let total = 0;
    for (const { label, ms } of f) { sum.set(label, (sum.get(label) ?? 0) + ms); total += ms; }
    for (const [label, ms] of sum) { if (!per.has(label)) per.set(label, []); /** @type {number[]} */ (per.get(label)).push(ms); }
    totals.push(total);
  }
  /** @type {Record<string, { perRun: number, share: number, perFrame: number }>} */ const passes = {};
  for (const [label, arr] of per) {
    const perRun = trimmedMean(arr), share = arr.length / Math.max(1, frames.length);
    passes[label] = { perRun, share, perFrame: perRun * share };
  }
  return { passes, total: trimmedMean(totals), p50: pct(totals, 0.5), p95: pct(totals, 0.95), frames: frames.length };
}

// ---------------------------------------------------------------------------
// The run

async function main() {
  say(`Building ${size.title.toLowerCase()}`);
  const { startApp } = await import('../src/app.js');
  const { on } = await import('../src/core/events.js');
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const result = await startApp(canvas);
  if (!result.ok) {
    post({ type: 'error', message: `The island did not start here (${result.reason}). Open this page in current Chrome or Edge on the desktop.` });
    $status.textContent = 'The island did not start';
    return;
  }
  // Fixed render size for a fair comparison: no dynamic resolution.
  result.quality.pinScale(1);
  /** @type {[number, number]} */ let renderSize = [0, 0];
  on('render:resized', (/** @type {{ width: number, height: number }} */ p) => { renderSize = [p.width, p.height]; });
  /** @type {number[]} */ const cpuMs = [];
  /** @type {number[]} */ const frameMs = [];
  on('render:frame-ended', (/** @type {{ cpuMs: number, frameMs: number }} */ p) => {
    if (!measuring) return;
    cpuMs.push(p.cpuMs);
    frameMs.push(p.frameMs);
  });
  const dev = /** @type {any} */ (result).features.includes('timestamp-query');
  say(`${size.title}: settling for ${(SETTLE_MS / 1000).toFixed(0)} s`);
  await new Promise((ok) => setTimeout(ok, SETTLE_MS));
  measuring = true;
  say(`${size.title}: measuring ${FRAMES} frames`);
  const started = performance.now();
  await new Promise((ok) => {
    const wait = setInterval(() => {
      const n = dev ? frames.length : wholeFrame.length;
      if (n >= FRAMES || performance.now() - started > 60000) { clearInterval(wait); ok(undefined); }
    }, 100);
  });
  measuring = false;
  const ob = result.terrain.openBounds();
  const info = result.adapterInfo;
  const gpu = dev ? summarize() : { passes: {}, total: trimmedMean(wholeFrame), p50: pct(wholeFrame, 0.5), p95: pct(wholeFrame, 0.95), frames: wholeFrame.length };
  post({
    type: 'result',
    timestamps: dev,
    tier: result.tier,
    adapter: [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'not reported',
    renderSize: renderSize[0] ? renderSize : [canvas.width, canvas.height],
    open: { min: ob.openMin, max: ob.openMax },
    waterRect: { w: result.water.rect.w, h: result.water.rect.h },
    gpu,
    cpuFrame: { mean: trimmedMean(cpuMs), p50: pct(cpuMs, 0.5), p95: pct(cpuMs, 0.95) },
    frameMs: { p50: pct(frameMs, 0.5) },
  });
  say(`${size.title}: done`);
  result.stop();
}

main().catch((e) => {
  console.error('[chunk-bench-frame]', e);
  post({ type: 'error', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
});
