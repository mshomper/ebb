// @ts-check
// Cliff bench (docs/19, M2 Cliff tool): the extra GPU time of keeping cliff chunks at full mesh
// detail, per quality tier. Runs the real app on this page's canvas with ?cliffs=nospring, parks
// the camera just inside the tier's cliffDetailM, and records the opaque (terrain) and shadow
// passes' p50 and p95 over a window of frames. Runs chain through page reloads; results are kept
// in sessionStorage so the table builds up as the runs go.

import { startApp } from '../src/app.js';
import { on } from '../src/core/events.js';
import { dispatch } from '../src/input/actions.js';
import { tierSettings } from '../src/render/quality.js';

const KEY = 'ebb-cliff-bench';
const TIERS = ['high', 'medium', 'low'];
const SETTLE_MS = 3000;
const params0 = new URLSearchParams(location.search);
/** Frames measured per run; `?frames=` sets fewer for a quick check of the page itself. */
const FRAMES = Number(params0.get('frames')) || 240;
/** Per tier: cliff detail off and on (no spring), then the waterfalls with the spring running. */
const RUNS = TIERS.flatMap((tier) => [{ tier, detail: false, falls: false }, { tier, detail: true, falls: false }, { tier, detail: true, falls: true }]);
/** The spring needs this long to fill the upper shelf and pour over its edge. */
const FALLS_SETTLE_MS = 50000;
const FALLS_BUDGET = 0.3;
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const BUDGET = { high: 0.2, medium: 0.2, low: 0.4 };

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);

/** @typedef {{ tier: string, detail: boolean, falls?: boolean, opaque: number[], shadow: number[], fallsMs?: number[], chunks: number, distance: number }} Run */

/** @returns {{ queue: number[], runs: Run[] }} */
function load() {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '') ?? { queue: [], runs: [] }; } catch { return { queue: [], runs: [] }; }
}
/** @param {{ queue: number[], runs: Run[] }} s */
function save(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: one run at a time */ } }

/** @param {number[]} arr @param {number} q */
function pct(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const fmt = (/** @type {number} */ v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

/** Go to run i of RUNS (or back to the plain page). @param {number | null} i */
function goTo(i) {
  const keep = params0.has('frames') ? { frames: String(FRAMES) } : {};
  if (i === null) { location.search = new URLSearchParams(keep).toString(); return; }
  const r = RUNS[i];
  const q = new URLSearchParams({ cliffs: r.falls ? 'spring' : 'nospring', tier: r.tier, seed: '1', run: String(i), ...keep });
  if (!r.detail) q.set('cliffdetail', '0');
  location.search = q.toString();
}

function render() {
  const { runs } = load();
  if (!runs.length) { $('results').innerHTML = '<p class="muted">No runs yet.</p>'; return; }
  const rows = TIERS.map((tier) => {
    const off = runs.find((r) => r.tier === tier && !r.detail);
    const on = runs.find((r) => r.tier === tier && r.detail && !r.falls);
    const wf = runs.find((r) => r.tier === tier && r.falls);
    const wfLine = wf
      ? `<p class="muted">Waterfalls (spring running, its sheet pouring over both faces): falls pass p50 ${fmt(pct(wf.fallsMs ?? [], 0.5))} ms, p95 ${fmt(pct(wf.fallsMs ?? [], 0.95))} ms, ${pct(wf.fallsMs ?? [], 0.5) <= FALLS_BUDGET ? 'within' : 'over'} the ${FALLS_BUDGET} ms aim.</p>`
      : '';
    if (!off && !on) return '';
    const total = (/** @type {Run | undefined} */ r, /** @type {number} */ q) => (r ? pct(r.opaque, q) + pct(r.shadow, q) : NaN);
    const a = total(off, 0.5), b = total(on, 0.5);
    const extra = b - a;
    const scale = Math.max(a, b, 0.5) * 1.15;
    const ok = !Number.isFinite(extra) || extra <= /** @type {any} */ (BUDGET)[tier] + 0.05;
    const note = Number.isFinite(extra)
      ? `${ok ? 'within' : 'over'} the ${/** @type {any} */ (BUDGET)[tier]} ms budget: ${extra >= 0 ? '+' : ''}${fmt(extra)} ms (p50)`
      : 'waiting for the other run';
    const at = (on ?? off);
    return `<div class="row"><div class="label"><span>${tier}: terrain + shadow, p50 ${fmt(a)} ms off, ${fmt(b)} ms on</span><span>${note}</span></div>` +
      `<div class="track"><div class="fill off" style="width:${((a / scale) * 100 || 0).toFixed(1)}%"></div>` +
      `<div class="fill on" style="width:${((b / scale) * 100 || 0).toFixed(1)}%"></div></div>` +
      `<p class="muted">p95 ${fmt(total(off, 0.95))} off, ${fmt(total(on, 0.95))} on. Camera ${at?.distance ?? '-'} m from the cliffs, ${at?.chunks ?? '-'} cliff chunks.</p>${wfLine}</div>`;
  });
  $('results').innerHTML = rows.join('');
}

$('run-all').addEventListener('click', () => { save({ queue: RUNS.map((_, i) => i), runs: [] }); goTo(0); });
$('clear').addEventListener('click', () => { save({ queue: [], runs: [] }); render(); });
render();

const runIndex = params.has('run') ? Number(params.get('run')) : null;
const result = await startApp(/** @type {HTMLCanvasElement} */ ($('view')));
if (!result.ok) {
  $('status').innerHTML = `${ICON_WARN}<span>WebGPU is not available here (${result.reason}). Open this page in current Chrome or Edge.</span>`;
} else {
  const info = result.adapterInfo;
  $('device').textContent = `Tier now: ${result.tier}. GPU: ${[info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'not reported'}. ` +
    `Timestamps: ${result.features.includes('timestamp-query') ? 'available' : 'not available, so this page cannot measure here'}.`;
  if (runIndex === null) {
    $('status').innerHTML = `${ICON_OK}<span>Ready. Press Measure every tier.</span>`;
  } else {
    const run = RUNS[runIndex];
    const what = run.falls ? 'waterfalls' : `cliff detail ${run.detail ? 'on' : 'off'}`;
    $('status').textContent = `Run ${runIndex + 1} of ${RUNS.length}: ${run.tier}, ${what}. Building the cliffs.`;
    /** @type {number[]} */ const opaque = [];
    /** @type {number[]} */ const shadow = [];
    /** @type {number[]} */ const fallsMs = [];
    let measuring = false;
    on('render:timings', (/** @type {any} */ p) => {
      if (!measuring) return;
      for (const { name, ms } of p.passes) {
        if (name === 'opaque') opaque.push(ms);
        if (name === 'shadow') shadow.push(ms);
        if (name === 'falls') fallsMs.push(ms);
      }
    });
    on('terrain:cliff-demo-built', (/** @type {any} */ p) => {
      // Just inside the tier's cliff distance: there, cliff chunks would draw coarse without it.
      // Waterfalls are measured close up, where the curtains fill most of the view.
      const distance = run.falls ? 14 : Math.round((tierSettings()?.cliffDetailM ?? 45) * 0.85);
      dispatch({ type: 'camera.focus', x: -12, z: -11, distance, pitchDeg: 30 });
      if (run.falls) $('status').textContent = `Run ${runIndex + 1} of ${RUNS.length}: ${run.tier}, waterfalls. Waiting for the spring to pour over the edge.`;
      setTimeout(() => {
        measuring = true;
        $('status').textContent = `Run ${runIndex + 1} of ${RUNS.length}: ${run.tier}, ${what}. Measuring.`;
        const wait = setInterval(() => {
          if (opaque.length < FRAMES) return;
          clearInterval(wait);
          const s = load();
          s.runs = s.runs.filter((r) => !(r.tier === run.tier && r.detail === run.detail && !!r.falls === run.falls));
          s.runs.push({ tier: run.tier, detail: run.detail, falls: run.falls, opaque, shadow, fallsMs, chunks: p.cliffChunks, distance });
          s.queue = s.queue.filter((i) => i !== runIndex);
          save(s);
          render();
          goTo(s.queue.length ? s.queue[0] : null);
        }, 250);
      }, run.falls ? FALLS_SETTLE_MS : SETTLE_MS);
    });
  }
}
