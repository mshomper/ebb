// @ts-check
// Live frame timing for the real island (docs/19 statistics: p50, p95, p99 over 300 frames).

import { startApp } from '../src/app.js';
import { on } from '../src/core/events.js';
import { tierSettings } from '../src/render/quality.js';

const WINDOW = 300;
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const graph = /** @type {HTMLCanvasElement} */ ($('graph'));

/** @type {number[]} */ const frameMs = [];
/** @type {number[]} */ const cpuMs = [];
/** @type {number[]} */ const gpuMs = [];
/** @type {Map<string, number[]>} */ const passMs = new Map();

/** @param {number[]} arr @param {number} v */
function push(arr, v) {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}

/** @param {number[]} arr @param {number} q */
function pct(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const fmt = (/** @type {number} */ v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

const result = await startApp(canvas);
if (!result.ok) {
  $('status').innerHTML = `${ICON_WARN}<span>WebGPU is not available here (${result.reason}). Open this page in current Chrome or Edge.</span>`;
} else {
  const info = result.adapterInfo;
  $('device').textContent =
    `Tier: ${result.tier} (${result.tierReasons.join(', ')}). ` +
    `GPU: ${[info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'not reported'}. ` +
    `Timestamps: ${result.features.includes('timestamp-query') ? 'available' : 'not available in this browser'}.`;

  on('render:frame-ended', (/** @type {any} */ p) => {
    push(frameMs, p.frameMs);
    push(cpuMs, p.cpuMs);
  });
  on('render:timings', (/** @type {any} */ p) => {
    let total = 0;
    for (const { name, ms } of p.passes) {
      if (!passMs.has(name)) passMs.set(name, []);
      push(/** @type {number[]} */ (passMs.get(name)), ms);
      total += ms;
    }
    push(gpuMs, total);
  });

  setInterval(updateText, 500);
  requestAnimationFrame(drawGraph);
}

function updateText() {
  const budget = tierSettings()?.gpuBudgetMs ?? 12;
  const p50 = pct(frameMs, 0.5);
  $('t-fps').textContent = Number.isFinite(p50) ? Math.round(1000 / p50).toString() : '-';
  $('t-gpu').textContent = fmt(pct(gpuMs, 0.95));
  $('t-cpu').textContent = fmt(pct(cpuMs, 0.95));
  $('t-frame').textContent = `${fmt(p50)} / ${fmt(pct(frameMs, 0.95))} / ${fmt(pct(frameMs, 0.99))}`;

  const gpu95 = pct(gpuMs, 0.95);
  const cpu95 = pct(cpuMs, 0.95);
  const cpuBudget = result.ok && result.tier === 'low' ? 8 : 4;
  if (!Number.isFinite(cpu95)) return;
  const gpuOk = !Number.isFinite(gpu95) || gpu95 <= budget;
  const ok = gpuOk && cpu95 <= cpuBudget;
  $('status').innerHTML = ok
    ? `${ICON_OK}<span>Within budget: GPU p95 ${fmt(gpu95)} of ${budget} ms, main thread p95 ${fmt(cpu95)} of ${cpuBudget} ms.</span>`
    : `${ICON_WARN}<span>Over budget: GPU p95 ${fmt(gpu95)} of ${budget} ms, main thread p95 ${fmt(cpu95)} of ${cpuBudget} ms.</span>`;

  if (passMs.size) {
    const rows = [...passMs.entries()].map(([name, arr]) => {
      const v = pct(arr, 0.95);
      const w = Math.min(100, (v / budget) * 100);
      return `<div class="bar"><div class="label"><span>${name}</span><span>${fmt(v)} ms</span></div>` +
        `<div class="track"><div class="fill" style="width:${w.toFixed(1)}%"></div></div></div>`;
    });
    $('passes').innerHTML = rows.join('') +
      `<p class="muted">Bars are drawn against the whole ${budget} ms GPU budget for this tier.</p>`;
  }
}

function drawGraph() {
  requestAnimationFrame(drawGraph);
  const dpr = window.devicePixelRatio || 1;
  const w = graph.clientWidth;
  const h = graph.clientHeight;
  if (graph.width !== Math.round(w * dpr) || graph.height !== Math.round(h * dpr)) {
    graph.width = Math.round(w * dpr);
    graph.height = Math.round(h * dpr);
  }
  const g = /** @type {CanvasRenderingContext2D} */ (graph.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const budget = tierSettings()?.gpuBudgetMs ?? 12;
  const maxMs = Math.max(34, pct(frameMs, 0.99) * 1.1 || 0);
  const y = (/** @type {number} */ ms) => h - 18 - (ms / maxMs) * (h - 28);

  g.font = '600 15px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  for (const [ms, color] of [[16.6, '#B8A9CC'], [budget, '#B5654A']]) {
    g.strokeStyle = /** @type {string} */ (color);
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.moveTo(0, y(/** @type {number} */ (ms)));
    g.lineTo(w, y(/** @type {number} */ (ms)));
    g.stroke();
  }
  g.setLineDash([]);
  g.fillText(`${maxMs.toFixed(0)} ms`, 4, 14);
  g.fillText('0 ms', 4, h - 2);

  /** @param {number[]} arr @param {string} color */
  const line = (arr, color) => {
    if (arr.length < 2) return;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    arr.forEach((v, i) => {
      const x = (i / (WINDOW - 1)) * w;
      if (i === 0) g.moveTo(x, y(v));
      else g.lineTo(x, y(v));
    });
    g.stroke();
  };
  line(frameMs, '#5F8196');
  line(gpuMs, '#7C9D72');
}
