// @ts-check
// Phone check (S8d-1, docs/19): the real island on this device against its tier's budgets. Live
// tiles over the last 300 frames, a 60 s run with a slow scripted orbit, a 15 minute warm run that
// plots GPU p95 per minute, per-pass bars grouped like doc 19's mobile table on low, the render
// scale from dynamic resolution, and Save result as ebb-bench-<date>-<tier>.json.
// Without timestamp-query (Safari may lack it) GPU time is the whole frame, timed from submit to
// onSubmittedWorkDone by src/render/quality-live.js, and the page says so.

import { startApp } from '../src/app.js';
import { on } from '../src/core/events.js';
import { loadRecipe } from '../src/core/recipes.js';
import { memoryReport } from '../src/core/gpu.js';
import { dispatch } from '../src/input/actions.js';
import { tierSettings } from '../src/render/quality.js';

const WINDOW = 300;
const RUN_S = 60;
const WARM_MIN = 15;
const ORBIT_DEG_PER_S = 6;   // one slow turn a minute
const FPS_PASS = 0.9;        // a run passes on frame rate at 90 % of the tier's target or more

// Drawn icons on a 24 grid, stroke 1.75, round caps (never color alone: the words say it too).
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><path d="M7.75 12.25l2.75 2.75 5.75-6"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.75l9 16H3z"/><path d="M12 10v4.25"/><path d="M12 17.25v.01"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="#4A5551" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><path d="M12 11v5.5"/><path d="M12 7.75v.01"/></svg>';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const warmCanvas = /** @type {HTMLCanvasElement} */ ($('warm'));

/** @param {number[]} arr @param {number} q */
function pct(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
/** @param {number[]} arr */
const stats = (arr) => ({ p50: round(pct(arr, 0.5)), p95: round(pct(arr, 0.95)), p99: round(pct(arr, 0.99)), n: arr.length });
/** @param {number} v */
const round = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const fmt = (/** @type {number} */ v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
/** @param {number[]} arr @param {number} v */
function push(arr, v) {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * One check line: a drawn icon, "pass" or "over" in words, and what was measured.
 * @param {boolean | null} ok null: nothing to judge against
 * @param {string} text
 */
function line(ok, text) {
  const icon = ok === null ? ICON_INFO : ok ? ICON_OK : ICON_WARN;
  const word = ok === null ? '' : `<span class="word">${ok ? 'pass' : 'over'}</span> `;
  return `<div class="line">${icon}<span>${word}${text}</span></div>`;
}

// Rolling windows (last 300 frames) for the live tiles.
/** @type {number[]} */ const frameMs = [];
/** @type {number[]} */ const cpuMs = [];
/** @type {number[]} */ const gpuMs = [];
/** @type {Map<string, number[]>} */ const passMs = new Map();
/** @type {Map<string, number[]>} */ const groupMs = new Map();

/**
 * @typedef {{ frame: number[], cpu: number[], gpu: number[] }} Series
 * @typedef {{ kind: 'run' | 'warm', start: number, frames: Series, passes: Map<string, number[]>, groups: Map<string, number[]>,
 *   scaleLow: number, scaleHigh: number, minuteStart: number, minute: Series, minutes: any[], wake: any }} Run
 */
/** @type {Run | null} */ let run = null;
/** @type {any} */ let lastRun60 = null;
/** @type {any} */ let lastWarm = null;
let stoppedNote = '';

const [app, camRecipe, qualityRecipe] = await Promise.all([startApp(canvas), loadRecipe('world/camera'), loadRecipe('quality-tiers')]);
/** @type {{ group: string, ms: number, passes: string[] }[]} */
const lowGroups = qualityRecipe.budgetGroups?.low ?? [];
const timestamps = app.ok ? app.features.includes('timestamp-query') : false;
/** @type {any} */ (window).phoneCheck = { app };   // for the browser console: phoneCheck.app.quality.set('low')
const startTier = app.ok ? app.tier : '';

if (!app.ok) {
  $('status').innerHTML = `${ICON_WARN}<span>WebGPU is not available here (${app.reason}). Open this page in Safari 26 or later, or current Chrome or Edge.</span>`;
  for (const id of ['run60', 'runWarm', 'save']) /** @type {HTMLButtonElement} */ ($(id)).disabled = true;
} else {
  const info = app.adapterInfo;
  $('device').textContent = `GPU: ${[info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'not reported'}. ` +
    `Screen ${screen.width} by ${screen.height} at ${window.devicePixelRatio || 1}x, ${navigator.hardwareConcurrency ?? '?'} CPU threads.`;
  $('measure').innerHTML = timestamps
    ? 'GPU time comes from GPU timestamps around each drawing pass, so each pass has its own bar below.'
    : '<b>This browser has no GPU timestamps (timestamp-query).</b> GPU time here is the whole frame, measured from when the frame is handed to the GPU until onSubmittedWorkDone says it is done. There are no per-pass bars.';
  if (!timestamps) $('passes').innerHTML = '<p class="muted">Per-pass times need GPU timestamps, which this browser does not offer. The whole-frame GPU time is in the tiles above.</p>';

  on('render:frame-ended', (/** @type {{ frameMs: number, cpuMs: number }} */ p) => {
    push(frameMs, p.frameMs);
    push(cpuMs, p.cpuMs);
    if (run) {
      run.frames.frame.push(p.frameMs);
      run.frames.cpu.push(p.cpuMs);
      if (run.kind === 'warm') { run.minute.frame.push(p.frameMs); run.minute.cpu.push(p.cpuMs); }
      const s = app.quality.renderScale();
      run.scaleLow = Math.min(run.scaleLow, s);
      run.scaleHigh = Math.max(run.scaleHigh, s);
    }
  });
  // Whole-frame GPU time, from timestamps or work-done round trips (src/render/quality-live.js).
  on('render:gpu-frame', (/** @type {{ ms: number }} */ p) => {
    push(gpuMs, p.ms);
    if (run) {
      run.frames.gpu.push(p.ms);
      if (run.kind === 'warm') run.minute.gpu.push(p.ms);
    }
  });
  on('render:timings', (/** @type {{ passes: { name: string, ms: number }[] }} */ p) => {
    /** @type {Map<string, number>} */ const groups = new Map();
    for (const { name, ms } of p.passes) {
      if (!passMs.has(name)) passMs.set(name, []);
      push(/** @type {number[]} */ (passMs.get(name)), ms);
      if (run) {
        if (!run.passes.has(name)) run.passes.set(name, []);
        /** @type {number[]} */ (run.passes.get(name)).push(ms);
      }
      const g = groupOf(name);
      groups.set(g, (groups.get(g) ?? 0) + ms);
    }
    for (const [g, ms] of groups) {
      if (!groupMs.has(g)) groupMs.set(g, []);
      push(/** @type {number[]} */ (groupMs.get(g)), ms);
      if (run) {
        if (!run.groups.has(g)) run.groups.set(g, []);
        /** @type {number[]} */ (run.groups.get(g)).push(ms);
      }
    }
  });

  $('run60').addEventListener('click', () => startRun('run'));
  $('runWarm').addEventListener('click', () => startRun('warm'));
  $('stop').addEventListener('click', () => stopRun('Stopped.'));
  $('save').addEventListener('click', saveResult);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && run) stopRun('The run stopped because the page went into the background. Keep the screen on and this page in front.');
    else if (!document.hidden && run?.wake === 'lost') keepAwake(run);
  });

  setInterval(updateText, 500);
  setInterval(tickRun, 250);
  requestAnimationFrame(drive);
}

/** @param {string} pass */
function groupOf(pass) {
  return lowGroups.find((g) => g.passes.includes(pass))?.group ?? 'other';
}

const budgets = () => {
  const s = tierSettings() ?? {};
  const tier = app.ok ? app.tier : '';
  return { gpu: s.gpuBudgetMs ?? 12, cpu: tier === 'low' ? 8 : 4, fps: s.targetFps ?? 60, tier };
};

// ---- live text ----

function updateText() {
  if (!app.ok) return;
  const b = budgets();
  const q = app.quality.info();
  $('tier').textContent = `Tier: ${b.tier}` + (b.tier !== startTier ? ` (started on ${startTier})` : '') +
    `. Picked because: ${app.tierReasons.join(', ') || 'no reason given'}.` +
    (q.autoStep ? ` Stepped down once from ${q.autoStep.from} to ${q.autoStep.to}${q.autoOff ? ', then undone' : ''}.` : '');

  const f50 = pct(frameMs, 0.5);
  const fps = Number.isFinite(f50) ? 1000 / f50 : NaN;
  const g95 = pct(gpuMs, 0.95);
  const c95 = pct(cpuMs, 0.95);
  $('t-fps').textContent = Number.isFinite(fps) ? Math.round(fps).toString() : '-';
  $('t-fps-sub').textContent = `frames per second, target ${b.fps}`;
  $('t-gpu').textContent = fmt(g95);
  $('t-gpu-sub').textContent = `GPU ms p95, budget ${b.gpu}`;
  $('t-cpu').textContent = fmt(c95);
  $('t-cpu-sub').textContent = `main thread ms p95, budget ${b.cpu}`;
  $('t-scale').textContent = q.scale.toFixed(2);
  $('t-scale-sub').textContent = `render scale, ${q.min.toFixed(2)} to ${q.max.toFixed(2)}, ${canvas.width} by ${canvas.height} canvas`;

  if (Number.isFinite(c95)) {
    const okFps = fps >= b.fps * FPS_PASS, okGpu = Number.isFinite(g95) ? g95 <= b.gpu : null, okCpu = c95 <= b.cpu;
    const all = okFps && okGpu !== false && okCpu;
    $('status').innerHTML = `${all ? ICON_OK : ICON_WARN}<span><span class="word">${all ? 'pass' : 'over'}</span> ` +
      `${all ? 'Within budget over the last 300 frames.' : 'Over budget somewhere over the last 300 frames.'}</span>`;
    $('checks').innerHTML = [
      line(okFps, `Frame rate ${fmt(fps)} fps, target ${b.fps}.`),
      line(okGpu, Number.isFinite(g95) ? `GPU p95 ${fmt(g95)} ms of ${b.gpu} ms (${measureWords(q.measure)}).` : 'GPU time not measured yet.'),
      line(okCpu, `Main thread p95 ${fmt(c95)} ms of ${b.cpu} ms.`),
      line(null, `Render scale ${q.scale.toFixed(2)}; it has changed ${q.changes.length} time${q.changes.length === 1 ? '' : 's'} this visit.`),
    ].join('');
  }
  if (timestamps) $('passes').innerHTML = passBars(passMs, groupMs, 0.95);
}

/** @param {string} m */
function measureWords(m) {
  return m === 'timestamps' ? 'GPU timestamps' : m === 'work-done' ? 'whole frame, work-done round trips' : 'frame time, no GPU time reported';
}

/**
 * Per-pass bars. On low, grouped like doc 19's mobile table, each against its own budget with
 * pass or over; on other tiers, each pass against the whole frame budget.
 * @param {Map<string, number[]>} passes @param {Map<string, number[]>} groups @param {number} q
 */
function passBars(passes, groups, q) {
  if (!passes.size) return '<p class="muted">Waiting for GPU timestamps.</p>';
  const b = budgets();
  if (b.tier === 'low') {
    $('passes-title').textContent = 'Each budget group, GPU ms (p95)';
    const rows = lowGroups.map((g) => {
      const v = pct(groups.get(g.group) ?? [], q);
      const ok = Number.isFinite(v) ? v <= g.ms : null;
      const w = Number.isFinite(v) ? Math.min(100, (v / g.ms) * 100) : 0;
      const names = g.passes.filter((p) => passes.has(p));
      return `<div class="bar">${line(ok, `${esc(g.group)}: ${Number.isFinite(v) ? `${fmt(v)} of ${g.ms.toFixed(2)} ms` : `no pass drawn yet, budget ${g.ms.toFixed(2)} ms`}`)}` +
        `<div class="track"><div class="fill${ok === false ? ' over' : ''}" style="width:${w.toFixed(1)}%"></div></div>` +
        `<span class="passes">${names.length ? `passes: ${names.join(', ')}` : 'no pass in this group drawn'}</span></div>`;
    });
    const other = groups.get('other');
    if (other) {
      const names = [...passes.keys()].filter((p) => groupOf(p) === 'other');
      rows.push(`<div class="bar">${line(null, `other: ${fmt(pct(other, q))} ms, passes doc 19 has no line for (${esc(names.join(', '))})`)}</div>`);
    }
    return rows.join('') + '<p class="muted">Not timed as passes yet: world compute (water, foam, wetness, midges), sky LUTs, and the depth prepass.</p>';
  }
  $('passes-title').textContent = 'Each pass, GPU ms (p95)';
  return [...passes.entries()].map(([name, arr]) => {
    const v = pct(arr, q);
    const w = Math.min(100, (v / b.gpu) * 100);
    return `<div class="bar">${line(null, `${esc(name)}: ${fmt(v)} ms, ${Math.round((v / b.gpu) * 100)} % of the ${b.gpu} ms budget`)}` +
      `<div class="track"><div class="fill" style="width:${w.toFixed(1)}%"></div></div></div>`;
  }).join('') + `<p class="muted">Bars are drawn against the whole ${b.gpu} ms GPU budget for this tier.</p>`;
}

// ---- runs ----

/** @returns {Series} */
const series = () => ({ frame: [], cpu: [], gpu: [] });

/** @param {'run' | 'warm'} kind */
function startRun(kind) {
  if (!app.ok || run) return;
  const now = performance.now();
  const s = app.quality.renderScale();
  run = { kind, start: now, frames: series(), passes: new Map(), groups: new Map(), scaleLow: s, scaleHigh: s,
    minuteStart: now, minute: series(), minutes: [], wake: null };
  stoppedNote = '';
  if (kind === 'warm') {
    lastWarm = null;
    $('warm-card').hidden = false;
    keepAwake(run);
  }
  setButtons();
}

/**
 * Ask the screen to stay on through the warm run (Wake Lock, where the browser has it).
 * @param {Run} r
 */
async function keepAwake(r) {
  try {
    const lock = await /** @type {any} */ (navigator).wakeLock?.request('screen');
    if (!lock) return;
    r.wake = lock;
    lock.addEventListener('release', () => { if (run === r) r.wake = 'lost'; });
  } catch {
    // No wake lock here; the note on the page asks to keep the screen on.
  }
}

/** @param {string} why */
function stopRun(why) {
  if (!run) return;
  const r = run;
  run = null;
  if (r.wake && r.wake !== 'lost') r.wake.release?.().catch?.(() => {});
  stoppedNote = why;
  if (r.kind === 'warm' && r.minutes.length) finishWarm(r, false);
  setButtons();
  $('run-status').textContent = why;
}

function tickRun() {
  if (!run) return;
  const now = performance.now();
  const elapsed = (now - run.start) / 1000;
  const total = run.kind === 'run' ? RUN_S : WARM_MIN * 60;
  /** @type {HTMLElement} */ ($('progress')).style.width = `${Math.min(100, (elapsed / total) * 100).toFixed(1)}%`;
  if (run.kind === 'run') {
    $('run-status').textContent = `60 second run: ${Math.floor(elapsed)} s of ${RUN_S}.`;
    if (elapsed >= RUN_S) finishRun60(run);
    return;
  }
  if (now - run.minuteStart >= 60000) {
    const m = run.minute;
    run.minutes.push({
      minute: run.minutes.length + 1, gpu: stats(m.gpu), cpu: stats(m.cpu), frame: stats(m.frame),
      fps: round(m.frame.length ? 1000 / pct(m.frame, 0.5) : NaN), renderScale: app.ok ? app.quality.renderScale() : null,
      tier: app.ok ? app.tier : null,
    });
    run.minute = series();
    run.minuteStart = now;
    drawWarm(run.minutes);
  }
  $('run-status').textContent = `Warm run: minute ${Math.min(WARM_MIN, run.minutes.length + 1)} of ${WARM_MIN}. Keep the screen on and this page in front.`;
  if (run.minutes.length >= WARM_MIN) finishWarm(run, true);
}

/** @param {Run} r */
function finishRun60(r) {
  run = null;
  setButtons();
  const b = budgets();
  const q = app.ok ? app.quality.info() : null;
  /** @type {Record<string, any>} */ const passes = {};
  for (const [name, arr] of r.passes) passes[name] = stats(arr);
  /** @type {Record<string, any>} */ const groups = {};
  for (const [name, arr] of r.groups) groups[name] = stats(arr);
  const frame = stats(r.frames.frame);
  lastRun60 = {
    seconds: RUN_S, frames: r.frames.frame.length, fps: round(frame.p50 ? 1000 / frame.p50 : NaN),
    frame, gpu: stats(r.frames.gpu), cpu: stats(r.frames.cpu), passes, groups,
    renderScale: { low: r.scaleLow, high: r.scaleHigh, end: q?.scale ?? null }, tier: b.tier, measure: q?.measure ?? null,
    budgets: { gpuMs: b.gpu, cpuMs: b.cpu, targetFps: b.fps },
  };
  const okFps = (lastRun60.fps ?? 0) >= b.fps * FPS_PASS;
  const okGpu = lastRun60.gpu.p95 === null ? null : lastRun60.gpu.p95 <= b.gpu;
  const okCpu = lastRun60.cpu.p95 === null ? null : lastRun60.cpu.p95 <= b.cpu;
  $('run-card').hidden = false;
  $('run-result').innerHTML = [
    line(okFps, `Frame rate ${fmt(lastRun60.fps)} fps over ${lastRun60.frames} frames, target ${b.fps}.`),
    line(okGpu, `GPU p95 ${fmt(lastRun60.gpu.p95)} ms of ${b.gpu} ms (p50 ${fmt(lastRun60.gpu.p50)}, p99 ${fmt(lastRun60.gpu.p99)}).`),
    line(okCpu, `Main thread p95 ${fmt(lastRun60.cpu.p95)} ms of ${b.cpu} ms (p50 ${fmt(lastRun60.cpu.p50)}, p99 ${fmt(lastRun60.cpu.p99)}).`),
    line(null, `Frame time p50 ${fmt(frame.p50)}, p95 ${fmt(frame.p95)}, p99 ${fmt(frame.p99)} ms.`),
    line(null, `Render scale ${r.scaleLow.toFixed(2)} to ${r.scaleHigh.toFixed(2)} during the run, on ${b.tier}.`),
    timestamps ? `<h2 style="margin-top:8px">The run, pass by pass (p95)</h2>${passBars(r.passes, r.groups, 0.95)}` : '',
  ].join('');
  $('run-status').textContent = 'The 60 second run is done. Save result keeps it as a file.';
}

/** @param {Run} r @param {boolean} complete */
function finishWarm(r, complete) {
  if (run === r) run = null;
  if (r.wake && r.wake !== 'lost') r.wake.release?.().catch?.(() => {});
  setButtons();
  const b = budgets();
  const ms = r.minutes;
  const first = ms[0]?.gpu.p95 ?? NaN, lastV = ms[ms.length - 1]?.gpu.p95 ?? NaN;
  const worst = Math.max(...ms.map((m) => m.gpu.p95 ?? 0));
  const rise = Number.isFinite(first) && first > 0 ? (lastV - first) / first : NaN;
  lastWarm = { minutes: ms, complete, budgetMs: b.gpu, tier: b.tier, riseFirstToLast: round(rise) };
  drawWarm(ms);
  $('warm-result').innerHTML = [
    line(worst <= b.gpu, `Worst minute GPU p95 ${fmt(worst)} ms of ${b.gpu} ms, over ${ms.length} minute${ms.length === 1 ? '' : 's'}${complete ? '' : ' (stopped early)'}.`),
    line(Number.isFinite(rise) ? rise <= 0.2 : null, `GPU p95 went from ${fmt(first)} ms in the first minute to ${fmt(lastV)} ms in the last (${Number.isFinite(rise) ? `${rise >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(rise * 100))} %` : 'not enough minutes'}).`),
    line(null, `Render scale at the end: ${app.ok ? app.quality.renderScale().toFixed(2) : '-'}.`),
  ].join('');
  if (complete) $('run-status').textContent = 'The warm run is done. Save result keeps it as a file.';
}

function setButtons() {
  const busy = !!run;
  /** @type {HTMLButtonElement} */ ($('run60')).disabled = busy || !app.ok;
  /** @type {HTMLButtonElement} */ ($('runWarm')).disabled = busy || !app.ok;
  /** @type {HTMLButtonElement} */ ($('stop')).disabled = !busy;
  if (!busy) /** @type {HTMLElement} */ ($('progress')).style.width = '0%';
}

// The slow scripted orbit while a run is on: the same camera action a drag makes.
let lastDrive = -1;
/** @param {number} t */
function drive(t) {
  requestAnimationFrame(drive);
  const dt = lastDrive < 0 ? 0 : Math.min(0.1, (t - lastDrive) / 1000);
  lastDrive = t;
  if (!run || !dt) return;
  dispatch({ type: 'camera.orbit', dx: (ORBIT_DEG_PER_S * dt) / camRecipe.orbitDegPerPx, dy: 0 });
}

// ---- the warm run graph ----

/** @param {any[]} minutes */
function drawWarm(minutes) {
  const dpr = window.devicePixelRatio || 1;
  const w = warmCanvas.clientWidth, h = warmCanvas.clientHeight;
  if (!w || !h) return;
  warmCanvas.width = Math.round(w * dpr);
  warmCanvas.height = Math.round(h * dpr);
  const g = /** @type {CanvasRenderingContext2D} */ (warmCanvas.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const budget = budgets().gpu;
  const top = Math.max(budget * 1.4, ...minutes.map((m) => (m.gpu.p95 ?? 0) * 1.1));
  const left = 8, right = w - 8, base = h - 26, ceil = 20;
  const x = (/** @type {number} */ i) => left + ((i - 1) / Math.max(1, WARM_MIN - 1)) * (right - left);
  const y = (/** @type {number} */ v) => base - (v / top) * (base - ceil);
  g.font = '600 16px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  g.fillText(`${top.toFixed(0)} ms`, left, 15);
  g.fillText('minute 1', left, h - 6);
  const endLabel = `minute ${WARM_MIN}`;
  g.fillText(endLabel, right - g.measureText(endLabel).width, h - 6);
  g.strokeStyle = '#B5654A';
  g.lineWidth = 2;
  g.setLineDash([6, 5]);
  g.beginPath();
  g.moveTo(left, y(budget));
  g.lineTo(right, y(budget));
  g.stroke();
  g.setLineDash([]);
  const pts = minutes.filter((m) => m.gpu.p95 !== null);
  g.strokeStyle = '#5F8196';
  g.fillStyle = '#5F8196';
  g.lineWidth = 2.5;
  g.beginPath();
  pts.forEach((m, i) => (i ? g.lineTo(x(m.minute), y(m.gpu.p95)) : g.moveTo(x(m.minute), y(m.gpu.p95))));
  g.stroke();
  for (const m of pts) {
    g.beginPath();
    g.arc(x(m.minute), y(m.gpu.p95), 4, 0, Math.PI * 2);
    g.fill();
  }
}

// ---- Save result ----

function saveResult() {
  if (!app.ok) return;
  const info = app.adapterInfo;
  const tier = app.tier;
  const q = app.quality.info();
  /** @type {Record<string, any>} */ const livePasses = {};
  for (const [name, arr] of passMs) livePasses[name] = stats(arr);
  const out = {
    kind: 'ebb-bench', version: 1, page: 'tools/phone-check.html', savedAt: new Date().toISOString(),
    device: {
      userAgent: navigator.userAgent,
      adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
      screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio || 1 },
      canvas: { width: canvas.width, height: canvas.height },
      cpuThreads: navigator.hardwareConcurrency ?? null,
      memoryGB: /** @type {any} */ (navigator).deviceMemory ?? null,
      features: app.features, timestamps, gpuMemoryMB: round(memoryReport().totalBytes / 1048576),
    },
    tier, startTier, tierReasons: app.tierReasons, settings: tierSettings(),
    dynamicRes: { scale: q.scale, min: q.min, max: q.max, measure: q.measure, changes: q.changes, autoStep: q.autoStep, autoUndone: q.autoOff },
    live300: { frame: stats(frameMs), gpu: stats(gpuMs), cpu: stats(cpuMs), passes: livePasses },
    run60: lastRun60,
    warmRun: lastWarm,
    note: stoppedNote || null,
  };
  const date = new Date();
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ebb-bench-${day}-${tier}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
