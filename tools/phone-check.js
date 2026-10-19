// @ts-check
// Phone check (S8d, docs/19): the real island on this device against its tier's budgets. Live
// tiles over the last 300 frames; a 2 minute warm run (GPU p95 per 15 s) and a 15 minute one (per
// minute); a 60 s run; a resolution check that holds the render scale at the tier's top, middle and
// lowest scale to see whether the GPU cost follows the pixels; per-pass bars grouped like doc 19's
// mobile table on low; and Save result as ebb-bench-<date>-<tier>.json. Full screen, like the game,
// is the default on touch screens, so the canvas is the size the game draws.
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
const WARM = { short: { minutes: 2, bucketS: 15 }, long: { minutes: 15, bucketS: 60 } };
const SWEEP_STEP_S = 12;     // each held scale
const SWEEP_SETTLE_S = 1;    // left out after each change
const ORBIT_DEG_PER_S = 6;   // one slow turn a minute
const FPS_PASS = 0.9;        // a run passes on frame rate at 90 % of the tier's target or more

// Drawn icons on a 24 grid, stroke 1.75, round caps (never color alone: the words say it too).
const svg = (/** @type {string} */ color, /** @type {string} */ body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_OK = svg('#5F7F5B', '<circle cx="12" cy="12" r="9.25"/><path d="M7.75 12.25l2.75 2.75 5.75-6"/>');
const ICON_WARN = svg('#B5654A', '<path d="M12 3.75l9 16H3z"/><path d="M12 10v4.25"/><path d="M12 17.25v.01"/>');
const ICON_INFO = svg('#4A5551', '<circle cx="12" cy="12" r="9.25"/><path d="M12 11v5.5"/><path d="M12 7.75v.01"/>');
// The resolution verdict: a pixel grid (the cost follows the pixels) or a solid (the cost is in what is drawn).
const ICON_PIXELS = svg('#5F8196', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.33 4v16"/><path d="M14.67 4v16"/><path d="M4 9.33h16"/><path d="M4 14.67h16"/>');
const ICON_DRAWN = svg('#5F7F5B', '<path d="M12 3.5l7.5 4.25v8.5L12 20.5l-7.5-4.25v-8.5z"/><path d="M4.5 7.75L12 12l7.5-4.25"/><path d="M12 12v8.5"/>');

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
/** @param {Map<string, number[]>} m */
const statsMap = (m) => Object.fromEntries([...m].map(([k, arr]) => [k, stats(arr)]));
/** @param {number} v */
const round = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const fmt = (/** @type {number | null} */ v) => (Number.isFinite(v) ? /** @type {number} */ (v).toFixed(2) : '-');
/** @param {number[]} arr @param {number} v */
function push(arr, v) {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}
/** @param {Map<string, number[]>} m @param {string} k @param {number} v */
function add(m, k, v) {
  let a = m.get(k);
  if (!a) m.set(k, (a = []));
  a.push(v);
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
 * Every sample of a stretch of time: the whole run, one warm bucket, or one held scale.
 * @typedef {{ frame: number[], cpu: number[], gpu: number[], passes: Map<string, number[]>, groups: Map<string, number[]> }} Tally
 * @typedef {{ kind: 'run' | 'warm' | 'sweep', start: number, all: Tally, part: Tally | null, partStart: number,
 *   scaleLow: number, scaleHigh: number, wake: any, full: boolean, fullMixed: boolean,
 *   minutes: number, bucketS: number, done: any[], steps: number[], step: number, orbitDx: number }} Run
 */
/** @returns {Tally} */
const tally = () => ({ frame: [], cpu: [], gpu: [], passes: new Map(), groups: new Map() });
/** @type {Run | null} */ let run = null;
/** @type {any} */ let lastRun60 = null;
/** @type {any} */ let lastWarm = null;
/** @type {any} */ let lastSweep = null;
let stoppedNote = '';
let full = false;

// Full screen is the default on a touch screen (the game is full screen there); ?full=1 or ?full=0
// overrides. Set before the app starts, so the canvas is the game's size from the first frame.
const fullParam = new URLSearchParams(location.search).get('full');
setFull(fullParam !== null ? fullParam === '1' : matchMedia('(hover: none) and (pointer: coarse)').matches);
$('goFull').addEventListener('click', () => setFull(true));
$('back').addEventListener('click', () => setFull(false));
$('sheetToggle').addEventListener('click', () => setSheet(!document.documentElement.classList.contains('sheet-open')));

const [app, camRecipe, qualityRecipe] = await Promise.all([startApp(canvas), loadRecipe('world/camera'), loadRecipe('quality-tiers')]);
/** @type {{ group: string, ms: number, passes: string[] }[]} */
const lowGroups = qualityRecipe.budgetGroups?.low ?? [];
const timestamps = app.ok ? app.features.includes('timestamp-query') : false;
/** @type {any} */ (window).phoneCheck = { app };   // for the browser console: phoneCheck.app.quality.set('low')
const startTier = app.ok ? app.tier : '';
/** The app's quality hook: pinScale(scale) holds the render scale, pinScale(null) lets it go. */
const quality = /** @type {any} */ (app.ok ? app.quality : null);
const canPin = typeof quality?.pinScale === 'function';

if (!app.ok) {
  $('status').innerHTML = `${ICON_WARN}<span>WebGPU is not available here (${app.reason}). Open this page in Safari 26 or later, or current Chrome or Edge.</span>`;
  $('readout').textContent = 'WebGPU is not available here.';
  for (const id of ['run60', 'runShort', 'runLong', 'save']) /** @type {HTMLButtonElement} */ ($(id)).disabled = true;
} else {
  const info = app.adapterInfo;
  $('device').textContent = `GPU: ${[info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'not reported'}. ` +
    `Screen ${screen.width} by ${screen.height} at ${window.devicePixelRatio || 1}x, ${navigator.hardwareConcurrency ?? '?'} CPU threads.`;
  $('measure').innerHTML = timestamps
    ? 'GPU time comes from GPU timestamps around each drawing pass, so each pass has its own bar below.'
    : '<b>This browser has no GPU timestamps (timestamp-query).</b> GPU time here is the whole frame, measured from when the frame is handed to the GPU until onSubmittedWorkDone says it is done. There are no per-pass bars.';
  if (!timestamps) $('passes').innerHTML = '<p class="muted">Per-pass times need GPU timestamps, which this browser does not offer. The whole-frame GPU time is in the tiles above.</p>';
  $('sweep').hidden = !canPin;
  $('sweep-missing').hidden = canPin;

  on('render:frame-ended', (/** @type {{ frameMs: number, cpuMs: number }} */ p) => {
    push(frameMs, p.frameMs);
    push(cpuMs, p.cpuMs);
    if (!run) return;
    for (const t of targets()) { t.frame.push(p.frameMs); t.cpu.push(p.cpuMs); }
    const s = app.quality.renderScale();
    run.scaleLow = Math.min(run.scaleLow, s);
    run.scaleHigh = Math.max(run.scaleHigh, s);
  });
  // Whole-frame GPU time, from timestamps or work-done round trips (src/render/quality-live.js).
  on('render:gpu-frame', (/** @type {{ ms: number }} */ p) => {
    push(gpuMs, p.ms);
    for (const t of targets()) t.gpu.push(p.ms);
  });
  on('render:timings', (/** @type {{ passes: { name: string, ms: number }[] }} */ p) => {
    /** @type {Map<string, number>} */ const groups = new Map();
    const ts = targets();
    for (const { name, ms } of p.passes) {
      if (!passMs.has(name)) passMs.set(name, []);
      push(/** @type {number[]} */ (passMs.get(name)), ms);
      for (const t of ts) add(t.passes, name, ms);
      const g = groupOf(name);
      groups.set(g, (groups.get(g) ?? 0) + ms);
    }
    for (const [g, ms] of groups) {
      if (!groupMs.has(g)) groupMs.set(g, []);
      push(/** @type {number[]} */ (groupMs.get(g)), ms);
      for (const t of ts) add(t.groups, g, ms);
    }
  });

  $('runShort').addEventListener('click', () => startRun('warm', WARM.short));
  $('runLong').addEventListener('click', () => startRun('warm', WARM.long));
  $('run60').addEventListener('click', () => startRun('run'));
  $('sweep').addEventListener('click', () => startRun('sweep'));
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

/** Where a sample goes: the whole run, and the current bucket or held scale once it has settled. */
function targets() {
  if (!run) return [];
  const settled = run.kind !== 'sweep' || performance.now() - run.partStart >= SWEEP_SETTLE_S * 1000;
  return run.part && settled ? [run.all, run.part] : [run.all];
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

/**
 * The internal render size the passes draw at: the canvas at the render scale, snapped the way
 * src/render/dynamic-res.js internalSize() snaps it.
 * @returns {[number, number]}
 */
function internalSize() {
  const w = canvas.width, h = canvas.height;
  const s = app.ok ? app.quality.renderScale() : 1;
  if (s >= 1 - 1e-4) return [w, h];
  const snap = Math.max(1, qualityRecipe.dynamicRes?.snapPx ?? 1);
  return [Math.max(snap, Math.round((w * s) / snap) * snap), Math.max(snap, Math.round((h * s) / snap) * snap)];
}

/** Per-group p95 against doc 19's low budget groups. @param {Map<string, number[]>} groups */
function groupReport(groups) {
  return lowGroups.map((g) => {
    const p95 = round(pct(groups.get(g.group) ?? [], 0.95));
    return { group: g.group, budgetMs: g.ms, p95, ok: p95 === null ? null : p95 <= g.ms };
  });
}

// ---- full screen ----

/** @param {boolean} on */
function setFull(on) {
  if (run && on !== full) run.fullMixed = true;
  full = on;
  document.documentElement.classList.toggle('full', on);
  setSheet(!run);
}

/** @param {boolean} open the results sheet in full screen (in the normal layout everything shows) */
function setSheet(open) {
  document.documentElement.classList.toggle('sheet-open', open);
  $('sheetToggle').setAttribute('aria-expanded', String(open));
  $('sheetLabel').textContent = open ? 'Hide results' : 'Results';
  if (open && run?.kind === 'warm') drawWarm(run.done, run.minutes, run.bucketS);   // drawn while hidden, it had no size
}

// ---- live text ----

function updateText() {
  if (!app.ok) return;
  const b = budgets();
  const q = app.quality.info();
  const [iw, ih] = internalSize();
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
  $('t-scale-sub').textContent = `render scale, ${q.min.toFixed(2)} to ${q.max.toFixed(2)}. Drawn at ${iw} by ${ih} px of a ${canvas.width} by ${canvas.height} canvas${full ? ', full screen' : ''}.`;
  $('readout').innerHTML = `${Number.isFinite(fps) ? Math.round(fps) : '-'} fps, GPU p95 ${fmt(g95)} of ${b.gpu} ms. ` +
    `Scale ${q.scale.toFixed(2)}, ${iw} by ${ih} px.` + (run ? `<br>${esc($('run-status').textContent ?? '')}` : '');

  if (Number.isFinite(c95)) {
    const okFps = fps >= b.fps * FPS_PASS, okGpu = Number.isFinite(g95) ? g95 <= b.gpu : null, okCpu = c95 <= b.cpu;
    const all = okFps && okGpu !== false && okCpu;
    $('status').innerHTML = `${all ? ICON_OK : ICON_WARN}<span><span class="word">${all ? 'pass' : 'over'}</span> ` +
      `${all ? 'Within budget over the last 300 frames.' : 'Over budget somewhere over the last 300 frames.'}</span>`;
    $('checks').innerHTML = [
      line(okFps, `Frame rate ${fmt(fps)} fps, target ${b.fps}.`),
      line(okGpu, Number.isFinite(g95) ? `GPU p95 ${fmt(g95)} ms of ${b.gpu} ms (${measureWords(q.measure)}).` : 'GPU time not measured yet.'),
      line(okCpu, `Main thread p95 ${fmt(c95)} ms of ${b.cpu} ms.`),
      line(null, `Render scale ${q.scale.toFixed(2)} (${iw} by ${ih} px); it has changed ${q.changes.length} time${q.changes.length === 1 ? '' : 's'} this visit.`),
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

/** The scales the resolution check holds: the tier's top, about the middle, and its lowest. */
function sweepScales() {
  const q = app.quality.info();
  const mid = Math.floor(((q.max + q.min) / 2) * 100) / 100;
  return [...new Set([q.max, mid, q.min].map((v) => Math.round(v * 100) / 100))];
}

/** @param {'run' | 'warm' | 'sweep'} kind @param {{ minutes: number, bucketS: number }} [warm] */
function startRun(kind, warm = WARM.short) {
  if (!app.ok || run) return;
  const now = performance.now();
  const s = app.quality.renderScale();
  run = { kind, start: now, all: tally(), part: kind === 'run' ? null : tally(), partStart: now, scaleLow: s, scaleHigh: s,
    wake: null, full, fullMixed: false, minutes: warm.minutes, bucketS: warm.bucketS, done: [], steps: [], step: 0, orbitDx: 0 };
  stoppedNote = '';
  if (kind === 'warm') {
    lastWarm = null;
    $('warm-card').hidden = false;
    $('warm-title').textContent = `Warm run (${warm.minutes} min): GPU p95 each ${bucketWords(warm.bucketS)}`;
    $('warm-legend').textContent = `GPU p95 each ${bucketWords(warm.bucketS)}`;
    $('warm-result').innerHTML = '';
    drawWarm([], run.minutes, run.bucketS);
  }
  if (kind === 'sweep') {
    lastSweep = null;
    run.steps = sweepScales();
    quality.pinScale(run.steps[0]);
    $('sweep-card').hidden = false;
    $('sweep-result').innerHTML = '<p class="muted">Measuring.</p>';
  }
  keepAwake(run);
  if (full) setSheet(false);
  setButtons();
}

/** @param {number} s */
const bucketWords = (s) => (s >= 60 ? `${s / 60 === 1 ? '' : `${s / 60} `}minute` : `${s} s`);

/**
 * Ask the screen to stay on through a run (Wake Lock, where the browser has it).
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

/** A run ended (finished or stopped): let the scale and the screen go, and show the results. @param {Run} r */
function endRun(r) {
  if (run === r) run = null;
  if (r.kind === 'sweep' && canPin) quality.pinScale(null);
  if (r.wake && r.wake !== 'lost') r.wake.release?.().catch?.(() => {});
  setButtons();
  if (full) setSheet(true);
}

/** @param {string} why */
function stopRun(why) {
  if (!run) return;
  const r = run;
  endRun(r);
  stoppedNote = why;
  if (r.kind === 'warm' && r.done.length) finishWarm(r, false);
  if (r.kind === 'sweep') finishSweep(r, false);
  $('run-status').textContent = why;
}

function tickRun() {
  if (!run) return;
  const now = performance.now();
  const elapsed = (now - run.start) / 1000;
  const bar = /** @type {HTMLElement} */ ($('progress'));
  if (run.kind === 'run') {
    bar.style.width = `${Math.min(100, (elapsed / RUN_S) * 100).toFixed(1)}%`;
    $('run-status').textContent = `60 second run: ${Math.floor(elapsed)} s of ${RUN_S}.`;
    if (elapsed >= RUN_S) finishRun60(run);
    return;
  }
  const inPart = (now - run.partStart) / 1000;
  if (run.kind === 'sweep') {
    const n = run.steps.length;
    bar.style.width = `${Math.min(100, ((run.step + Math.min(1, inPart / SWEEP_STEP_S)) / n) * 100).toFixed(1)}%`;
    $('run-status').textContent = `Resolution check: scale ${run.steps[run.step].toFixed(2)} (${run.step + 1} of ${n}), ${Math.floor(inPart)} s of ${SWEEP_STEP_S}.`;
    if (inPart < SWEEP_STEP_S) return;
    run.done.push(stepResult(run));
    run.step++;
    if (run.step >= n) { finishSweep(run, true); return; }
    // The next scale sees the same arc of the island: turn back to where this one started.
    dispatch({ type: 'camera.orbit', dx: -run.orbitDx, dy: 0 });
    run.orbitDx = 0;
    quality.pinScale(run.steps[run.step]);
    run.part = tally();
    run.partStart = now;
    $('sweep-result').innerHTML = sweepRows(run.done);
    return;
  }
  const total = run.minutes * 60;
  bar.style.width = `${Math.min(100, (elapsed / total) * 100).toFixed(1)}%`;
  if (inPart >= run.bucketS) {
    const m = /** @type {Tally} */ (run.part);
    const [iw, ih] = internalSize();
    run.done.push({
      bucket: run.done.length + 1, endSeconds: (run.done.length + 1) * run.bucketS,
      gpu: stats(m.gpu), cpu: stats(m.cpu), frame: stats(m.frame), fps: round(m.frame.length ? 1000 / pct(m.frame, 0.5) : NaN),
      renderScale: app.quality.renderScale(), internal: [iw, ih], tier: app.tier,
    });
    run.part = tally();
    run.partStart = now;
    drawWarm(run.done, run.minutes, run.bucketS);
  }
  $('run-status').textContent = `${run.minutes} minute run: ${Math.floor(elapsed / 60)} min ${Math.floor(elapsed % 60)} s of ${run.minutes} min. Keep the screen on and this page in front.`;
  if (run.done.length >= Math.round(total / run.bucketS)) finishWarm(run, true);
}

/** What the run says about full screen: true, false, or 'mixed' if it was switched during the run. @param {Run} r */
const fullFlag = (r) => (r.fullMixed ? 'mixed' : r.full);

/** @param {Run} r */
function finishRun60(r) {
  endRun(r);
  const b = budgets();
  const q = app.ok ? app.quality.info() : null;
  const frame = stats(r.all.frame);
  lastRun60 = {
    seconds: RUN_S, frames: r.all.frame.length, fps: round(frame.p50 ? 1000 / frame.p50 : NaN),
    frame, gpu: stats(r.all.gpu), cpu: stats(r.all.cpu), passes: statsMap(r.all.passes), groups: statsMap(r.all.groups),
    lowGroups: groupReport(r.all.groups),
    renderScale: { low: r.scaleLow, high: r.scaleHigh, end: q?.scale ?? null }, internalEnd: internalSize(),
    canvas: [canvas.width, canvas.height], fullScreen: fullFlag(r), tier: b.tier, measure: q?.measure ?? null,
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
    line(null, `Render scale ${r.scaleLow.toFixed(2)} to ${r.scaleHigh.toFixed(2)} during the run, on ${b.tier}; ${sizeWords(r)}.`),
    timestamps ? `<h2 style="margin-top:8px">The run, pass by pass (p95)</h2>${passBars(r.all.passes, r.all.groups, 0.95)}` : '',
  ].join('');
  $('run-status').textContent = 'The 60 second run is done. Save result keeps it as a file.';
}

/** @param {Run} r */
function sizeWords(r) {
  const [iw, ih] = internalSize();
  const where = r.fullMixed ? 'switched between full screen and the small canvas during the run' : r.full ? 'full screen' : 'the small canvas, not full screen';
  return `${canvas.width} by ${canvas.height} canvas, drawn at ${iw} by ${ih} px at the end, ${where}`;
}

/** @param {Run} r @param {boolean} complete */
function finishWarm(r, complete) {
  endRun(r);
  const b = budgets();
  const ms = r.done;
  const first = ms[0]?.gpu.p95 ?? NaN, lastV = ms[ms.length - 1]?.gpu.p95 ?? NaN;
  const worst = Math.max(...ms.map((m) => m.gpu.p95 ?? 0));
  const rise = Number.isFinite(first) && first > 0 ? (lastV - first) / first : NaN;
  const gpu = stats(r.all.gpu), cpu = stats(r.all.cpu), frame = stats(r.all.frame);
  lastWarm = {
    lengthMinutes: r.minutes, bucketSeconds: r.bucketS, seconds: round((performance.now() - r.start) / 1000), complete,
    buckets: ms, budgetMs: b.gpu, tier: b.tier, riseFirstToLast: round(rise),
    whole: { gpu, cpu, frame, fps: round(frame.p50 ? 1000 / frame.p50 : NaN), passes: statsMap(r.all.passes), groups: statsMap(r.all.groups), lowGroups: groupReport(r.all.groups) },
    renderScale: { low: r.scaleLow, high: r.scaleHigh, end: app.quality.renderScale() }, internalEnd: internalSize(),
    canvas: [canvas.width, canvas.height], fullScreen: fullFlag(r),
  };
  drawWarm(ms, r.minutes, r.bucketS);
  const unit = bucketWords(r.bucketS);
  $('warm-result').innerHTML = [
    line(worst <= b.gpu, `Worst ${unit} GPU p95 ${fmt(worst)} ms of ${b.gpu} ms, over ${ms.length} bucket${ms.length === 1 ? '' : 's'} of ${unit}${complete ? '' : ' (stopped early)'}.`),
    line(Number.isFinite(rise) ? rise <= 0.2 : null, `GPU p95 went from ${fmt(first)} ms in the first ${unit} to ${fmt(lastV)} ms in the last (${Number.isFinite(rise) ? `${rise >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(rise * 100))} %` : 'not enough buckets'}).`),
    line(gpu.p95 === null ? null : gpu.p95 <= b.gpu, `The whole run: GPU p50 ${fmt(gpu.p50)}, p95 ${fmt(gpu.p95)} ms; ${fmt(lastWarm.whole.fps)} fps; main thread p95 ${fmt(cpu.p95)} ms.`),
    line(null, `Render scale ${r.scaleLow.toFixed(2)} to ${r.scaleHigh.toFixed(2)}; ${sizeWords(r)}.`),
    timestamps ? `<h2 style="margin-top:8px">The run, pass by pass (p95)</h2>${passBars(r.all.passes, r.all.groups, 0.95)}` : '',
  ].join('');
  if (complete) $('run-status').textContent = `The ${r.minutes} minute run is done. Save result keeps it as a file.`;
}

// ---- the resolution check ----

/** One held scale, measured. @param {Run} r */
function stepResult(r) {
  const t = /** @type {Tally} */ (r.part);
  const [iw, ih] = internalSize();
  const frame = stats(t.frame);
  return {
    scale: r.steps[r.step], heldAt: app.quality.renderScale(), canvas: [canvas.width, canvas.height], internal: [iw, ih], pixels: iw * ih,
    seconds: SWEEP_STEP_S - SWEEP_SETTLE_S, frames: t.frame.length, fps: round(frame.p50 ? 1000 / frame.p50 : NaN),
    gpu: stats(t.gpu), cpu: stats(t.cpu), frame, passes: statsMap(t.passes), groups: statsMap(t.groups), lowGroups: groupReport(t.groups), tier: app.tier,
  };
}

/** @param {any[]} steps */
function sweepRows(steps) {
  const top = Math.max(1e-6, ...steps.map((s) => s.gpu.p95 ?? 0));
  return steps.map((s) => `<div class="bar">${line(null, `Scale ${s.scale.toFixed(2)}: drawn at ${s.internal[0]} by ${s.internal[1]} px. ` +
    `GPU p50 ${fmt(s.gpu.p50)}, p95 ${fmt(s.gpu.p95)} ms; ${fmt(s.fps)} fps.` +
    (Math.abs(s.heldAt - s.scale) > 0.005 ? ` The scale did not hold: it read ${s.heldAt.toFixed(2)}.` : ''))}` +
    `<div class="track"><div class="fill blue" style="width:${(((s.gpu.p95 ?? 0) / top) * 100).toFixed(1)}%"></div></div></div>`).join('');
}

/**
 * GPU time against pixels, a straight line through the held scales: the part that stays the same
 * at any size (work per frame) and the part that follows the pixels.
 * @param {any[]} steps
 */
function fitPixels(steps) {
  const pts = steps.filter((s) => s.gpu.p50 !== null).map((s) => [s.pixels / 1e6, s.gpu.p50]);
  if (pts.length < 2) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  if (sxx <= 0) return null;
  const perMP = sxy / sxx;
  return { fixedMs: round(my - perMP * mx), msPerMegapixel: round(perMP) };
}

/** @param {Run} r @param {boolean} complete */
function finishSweep(r, complete) {
  endRun(r);
  const steps = r.done;
  const b = budgets();
  const fit = fitPixels(steps);
  /** @type {any} */ let verdict = null;
  const html = [sweepRows(steps)];
  const a = steps[0], z = steps[steps.length - 1];
  // Judged on the typical frame (p50): over 11 s a few spikes move p95 more than the pixels do.
  if (steps.length >= 2 && a.gpu.p50 !== null && z.gpu.p50 !== null && a.gpu.p50 > 0) {
    const saved = a.gpu.p50 - z.gpu.p50, frac = saved / a.gpu.p50, pixFrac = z.pixels / Math.max(1, a.pixels);
    const saved95 = a.gpu.p95 !== null && z.gpu.p95 !== null ? a.gpu.p95 - z.gpu.p95 : NaN;
    const kind = frac >= 0.2 ? 'pixels' : frac >= 0.08 ? 'some' : 'drawn';
    const cut = `Cutting the pixels to ${Math.round(pixFrac * 100)} % (scale ${a.scale.toFixed(2)} to ${z.scale.toFixed(2)})`;
    const p95Words = Number.isFinite(saved95) ? `; p95 ${saved95 >= 0 ? 'fell' : 'rose'} ${fmt(Math.abs(saved95))} ms` : '';
    const says = saved <= 0
      ? `${cut} saved nothing on a typical frame (GPU p50 ${fmt(a.gpu.p50)} then ${fmt(z.gpu.p50)} ms${p95Words}): the cost is in what is drawn, not in pixels.`
      : `${cut} saved ${fmt(saved)} ms of a typical frame (${Math.round(frac * 100)} %${p95Words}): ` +
        (kind === 'pixels' ? 'resolution matters.' : kind === 'some' ? 'resolution matters a little; most of the cost is in what is drawn.' : 'the cost is in what is drawn, not in pixels.');
    verdict = { kind, judgedOn: 'p50', savedMs: round(saved), savedFraction: round(frac), savedP95Ms: round(saved95), pixelFraction: round(pixFrac), text: says };
    html.unshift(`<div class="line verdict">${kind === 'pixels' ? ICON_PIXELS : ICON_DRAWN}<span>${says}</span></div>`);
    if (fit && fit.msPerMegapixel !== null && fit.fixedMs !== null) {
      const follows = fit.msPerMegapixel * (a.pixels / 1e6);
      html.push(fit.msPerMegapixel <= 0
        ? line(null, 'The GPU time did not fall as the pixels did.')
        : line(null, `On a typical frame about ${fmt(Math.max(0, fit.fixedMs))} ms stays the same at any size (work per frame, not per pixel), ` +
          `and about ${fmt(follows)} ms at scale ${a.scale.toFixed(2)} follows the pixels. The budget is ${b.gpu} ms at p95.`));
    }
  } else {
    html.unshift(line(null, complete ? 'Not enough GPU times to judge.' : 'Stopped before two scales were measured.'));
  }
  if (timestamps && steps.length >= 2 && Object.keys(a.passes).length) html.push(`<h2 style="margin-top:8px">Pass by pass (p50), scale ${a.scale.toFixed(2)} then ${z.scale.toFixed(2)}</h2>`, passShift(a, z));
  if (app.quality.info().measure !== 'timestamps') html.push('<p class="muted">GPU time here is whole-frame work-done round trips, which include some waiting, so this check is rougher than with timestamps.</p>');
  if (steps.some((s) => s.tier !== steps[0].tier)) html.push(line(false, 'The tier changed during the check, so the scales are not a fair comparison.'));
  $('sweep-result').innerHTML = html.join('');
  lastSweep = { complete, secondsPerScale: SWEEP_STEP_S, settleSeconds: SWEEP_SETTLE_S, fullScreen: fullFlag(r), steps, verdict, fit };
  $('run-status').textContent = complete ? 'The resolution check is done. Save result keeps it as a file.' : 'The resolution check stopped early.';
}

/** How each pass changed from the top scale to the lowest, biggest first. @param {any} a @param {any} z */
function passShift(a, z) {
  const names = Object.keys(a.passes).sort((x, y) => (a.passes[y].p50 ?? 0) - (a.passes[x].p50 ?? 0));
  return names.map((n) => {
    const v0 = a.passes[n].p50, v1 = z.passes[n]?.p50 ?? null;
    const ch = v0 && v1 !== null ? Math.round(((v0 - v1) / v0) * 100) : null;
    return line(null, `${esc(n)}: ${fmt(v0)} then ${fmt(v1)} ms${ch === null ? '' : ` (${ch >= 0 ? 'down' : 'up'} ${Math.abs(ch)} %)`}.`);
  }).join('');
}

function setButtons() {
  const busy = !!run;
  for (const id of ['run60', 'runShort', 'runLong', 'sweep']) /** @type {HTMLButtonElement} */ ($(id)).disabled = busy || !app.ok;
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
  const dx = (ORBIT_DEG_PER_S * dt) / camRecipe.orbitDegPerPx;
  run.orbitDx += dx;
  dispatch({ type: 'camera.orbit', dx, dy: 0 });
}

// ---- the warm run graph ----

/** @param {any[]} buckets @param {number} minutes @param {number} bucketS */
function drawWarm(buckets, minutes, bucketS) {
  const dpr = window.devicePixelRatio || 1;
  const w = warmCanvas.clientWidth, h = warmCanvas.clientHeight;
  if (!w || !h) return;
  warmCanvas.width = Math.round(w * dpr);
  warmCanvas.height = Math.round(h * dpr);
  const g = /** @type {CanvasRenderingContext2D} */ (warmCanvas.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const n = Math.round((minutes * 60) / bucketS);
  const budget = budgets().gpu;
  const top = Math.max(budget * 1.4, ...buckets.map((m) => (m.gpu.p95 ?? 0) * 1.1));
  const left = 8, right = w - 8, base = h - 26, ceil = 20;
  const x = (/** @type {number} */ i) => left + ((i - 1) / Math.max(1, n - 1)) * (right - left);
  const y = (/** @type {number} */ v) => base - (v / top) * (base - ceil);
  const label = (/** @type {number} */ i) => (bucketS >= 60 ? `minute ${(i * bucketS) / 60}` : `${i * bucketS} s`);
  g.font = '600 16px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  g.fillText(`${top.toFixed(0)} ms`, left, 15);
  g.fillText(label(1), left, h - 6);
  const endLabel = label(n);
  g.fillText(endLabel, right - g.measureText(endLabel).width, h - 6);
  g.strokeStyle = '#B5654A';
  g.lineWidth = 2;
  g.setLineDash([6, 5]);
  g.beginPath();
  g.moveTo(left, y(budget));
  g.lineTo(right, y(budget));
  g.stroke();
  g.setLineDash([]);
  const pts = buckets.filter((m) => m.gpu.p95 !== null);
  g.strokeStyle = '#5F8196';
  g.fillStyle = '#5F8196';
  g.lineWidth = 2.5;
  g.beginPath();
  pts.forEach((m, i) => (i ? g.lineTo(x(m.bucket), y(m.gpu.p95)) : g.moveTo(x(m.bucket), y(m.gpu.p95))));
  g.stroke();
  for (const m of pts) {
    g.beginPath();
    g.arc(x(m.bucket), y(m.gpu.p95), 4, 0, Math.PI * 2);
    g.fill();
  }
}

// ---- Save result ----

function saveResult() {
  if (!app.ok) return;
  const info = app.adapterInfo;
  const tier = app.tier;
  const q = app.quality.info();
  const out = {
    kind: 'ebb-bench', version: 2, page: 'tools/phone-check.html', savedAt: new Date().toISOString(),
    device: {
      userAgent: navigator.userAgent,
      adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
      screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio || 1 },
      viewport: { width: innerWidth, height: innerHeight },
      canvas: { width: canvas.width, height: canvas.height },
      cpuThreads: navigator.hardwareConcurrency ?? null,
      memoryGB: /** @type {any} */ (navigator).deviceMemory ?? null,
      features: app.features, timestamps, gpuMemoryMB: round(memoryReport().totalBytes / 1048576),
    },
    fullScreen: full,
    renderSize: { scale: q.scale, canvas: [canvas.width, canvas.height], internal: internalSize() },
    tier, startTier, tierReasons: app.tierReasons, settings: tierSettings(),
    dynamicRes: { scale: q.scale, min: q.min, max: q.max, measure: q.measure, changes: q.changes, autoStep: q.autoStep, autoUndone: q.autoOff },
    live300: { frame: stats(frameMs), gpu: stats(gpuMs), cpu: stats(cpuMs), passes: statsMap(passMs), lowGroups: groupReport(groupMs) },
    run60: lastRun60,
    warmRun: lastWarm,
    scaleSweep: lastSweep,
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
