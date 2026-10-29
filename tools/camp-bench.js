// @ts-check
// Camp bench (docs/19, keeper's camp budgets; docs/future/13 E3): what the camp costs on each
// quality tier. Runs the real app on this page's canvas just after sunset on a fresh island
// (?intro=rest: the tent up, the ring laid, the lantern lit), lights the fire, and with the low view
// down by the fire records every pass's GPU time with the camp drawn, then with it hidden. The
// difference in the whole frame is the camp's cost (its models, its effects, and its two lights in
// every lit pass). Runs chain through page reloads; results are kept in sessionStorage.

import { startApp } from '../src/app.js';
import { on, emit } from '../src/core/events.js';

const KEY = 'ebb-camp-bench';
const TIERS = ['high', 'medium', 'low'];
const SETTLE_MS = 5000;
const params = new URLSearchParams(location.search);
/** Frames measured per half; `?frames=` sets fewer for a quick check of the page itself. */
const FRAMES = Number(params.get('frames')) || 240;
/** Budgets (docs/19): the camp's whole extra GPU time, and its own two passes. */
const BUDGET = { high: 0.5, medium: 0.67, low: 0.67 };
const PASS_BUDGET = { props: { high: 0.2, medium: 0.25, low: 0.3 }, campfx: { high: 0.2, medium: 0.27, low: 0.3 } };
/** The live fire sim and its volume (Matt's fire study, October 29, 2026): the same low, half-size fire on every tier. */
const FIRE_BUDGET = 0.15;
/** The star fire's six logs (S4), their share of the models' pass (ms): less than the one wood model they replace cost. */
const STAR_BUDGET = 0.05;
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @typedef {{ tier: string, on: number[], off: number[], props: number[], fx: number[], fire?: number[], star?: number[] }} Run */

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

/** Go to run i (or back to the plain page). @param {number | null} i */
function goTo(i) {
  const keep = params.has('frames') ? { frames: String(FRAMES) } : {};
  if (i === null) { location.search = new URLSearchParams(keep).toString(); return; }
  location.search = new URLSearchParams({ intro: 'rest', tier: TIERS[i], seed: '1', run: String(i), ...keep }).toString();
}

function render() {
  const { runs } = load();
  if (!runs.length) { $('results').innerHTML = '<p class="muted">No runs yet.</p>'; return; }
  $('results').innerHTML = TIERS.map((tier) => {
    const r = runs.find((x) => x.tier === tier);
    if (!r) return '';
    const a = pct(r.off, 0.5), b = pct(r.on, 0.5), extra = b - a;
    const aim = /** @type {any} */ (BUDGET)[tier];
    const ok = extra <= aim + 0.05;
    const scale = Math.max(a, b, 1) * 1.15;
    const pp = pct(r.props, 0.5), fp = pct(r.fx, 0.5);
    const passOk = pp <= /** @type {any} */ (PASS_BUDGET.props)[tier] + 0.05 && fp <= /** @type {any} */ (PASS_BUDGET.campfx)[tier] + 0.05;
    return `<div class="row"><div class="label"><span>${ok && passOk ? ICON_OK : ICON_WARN} ${tier}: whole frame p50 ${fmt(a)} ms camp off, ${fmt(b)} ms on</span>` +
      `<span>${ok ? 'within' : 'over'} the ${aim} ms budget: ${extra >= 0 ? '+' : ''}${fmt(extra)} ms</span></div>` +
      `<div class="track"><div class="fill off" style="width:${((a / scale) * 100 || 0).toFixed(1)}%"></div>` +
      `<div class="fill on" style="width:${((b / scale) * 100 || 0).toFixed(1)}%"></div></div>` +
      `<p class="muted">The models' pass ${fmt(pp)} ms, the fire's effects ${fmt(fp)} ms (p50); p95 ${fmt(pct(r.off, 0.95))} off, ${fmt(pct(r.on, 0.95))} on.</p>` +
      // The fire sim (its steps, volume and composite), against its own budget.
      (r.fire?.length ? (() => {
        const fs = pct(r.fire, 0.5), fok = fs <= FIRE_BUDGET + 0.02;
        return `<div class="label"><span>${fok ? ICON_OK : ICON_WARN} The fire sim and its flame: ${fmt(fs)} ms (p50)</span><span>${fok ? 'within' : 'over'} ${FIRE_BUDGET} ms</span></div>`;
      })() : '') +
      // The star fire (S4): the models' pass with and without its logs; the hearth and pots stay in both.
      (r.star?.length ? (() => {
        const st = pp - pct(r.star, 0.5), sok = st <= STAR_BUDGET + 0.02;
        return `<div class="label"><span>${sok ? ICON_OK : ICON_WARN} The star fire's logs: ${st >= 0 ? '+' : ''}${fmt(st)} ms in the models' pass</span><span>${sok ? 'within' : 'over'} ${STAR_BUDGET} ms</span></div>`;
      })() : '') + '</div>';
  }).join('');
}

$('run-all').addEventListener('click', () => { save({ queue: TIERS.map((_, i) => i), runs: [] }); goTo(0); });
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
    const tier = TIERS[runIndex];
    const camp = /** @type {any} */ (result).camp;
    // The director is not running on this page: lay the camp ready, as Skip does, then light it.
    emit('intro:camp-ready', { tent: true, ring: true });
    // Down by the fire, at the tent's flap, the view from beside you over the ring (as on waking).
    const app = /** @type {any} */ (result), flap = camp.flap();
    if (flap && app.walk.placeAt(flap.x, flap.z, flap.yaw, 'stand')) {
      app.walk.downHere();
      const pose = app.camera.pose();
      app.camera.setPose({ ...pose, target: [flap.x, pose.target[1], flap.z], yaw: flap.yaw + Math.PI + 1.25 });
    }
    $('status').textContent = `Run ${runIndex + 1} of ${TIERS.length}: ${tier}. Lighting the fire.`;
    /** @type {Run} */ const run = { tier, on: [], off: [], props: [], fx: [], fire: [], star: [] };
    /** @type {'wait' | 'on' | 'nostar' | 'off' | 'done'} */ let half = 'wait';
    on('render:timings', (/** @type {any} */ p) => {
      // The star fire (S4): the models' pass again with the star's logs left out.
      if (half === 'nostar') { for (const { name, ms } of p.passes) if (name === 'props') run.star?.push(ms); return; }
      if (half !== 'on' && half !== 'off') return;
      let total = 0;
      for (const { name, ms } of p.passes) {
        total += ms;
        if (half === 'on' && name === 'props') run.props.push(ms);
        if (half === 'on' && name === 'campfx') run.fx.push(ms);
        if (half === 'on' && name === 'campfire') run.fire?.push(ms);
      }
      run[half].push(total);
    });
    setTimeout(() => {
      camp.debug.lightNow();
      // The hearth stones, the pots and the cup in their places, as a camp in its first season stands.
      camp.hearth.debug.setUp();
      setTimeout(() => {
        half = 'on';
        $('status').textContent = `Run ${runIndex + 1} of ${TIERS.length}: ${tier}. Measuring with the camp.`;
        const wait = setInterval(() => {
          if (half === 'on' && run.on.length >= FRAMES) {
            half = 'nostar';
            camp.debug.hideStar(true);
          } else if (half === 'nostar' && (run.star?.length ?? 0) >= FRAMES / 2) {
            half = 'wait';
            camp.debug.hideStar(false);
            camp.debug.hide(true);
            setTimeout(() => { half = 'off'; $('status').textContent = `Run ${runIndex + 1} of ${TIERS.length}: ${tier}. Measuring without it.`; }, 1000);
          } else if (half === 'off' && run.off.length >= FRAMES) {
            half = 'done';
            clearInterval(wait);
            const s = load();
            s.runs = s.runs.filter((r) => r.tier !== tier);
            s.runs.push(run);
            s.queue = s.queue.filter((i) => i !== runIndex);
            save(s);
            render();
            goTo(s.queue.length ? s.queue[0] : null);
          }
        }, 250);
      }, 1500);
    }, SETTLE_MS);
  }
}
