// @ts-check
// ebb frog lab (S6b, docs 11, 12): the real island with frogs on it (?frogs=6 unless the address
// asks for another number), the time of day shown on demand (the clock's display override, so the
// world is untouched), the chorus call by call with the gap rule checked, hop and swim counts, and
// the cost of moving, posing and drawing the frogs.

import { startApp } from '../src/app.js';
import { on } from '../src/core/events.js';
import * as clock from '../src/core/clock.js';
import { dispatch } from '../src/input/actions.js';

const ICON_CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/><path d="M8 12.5l2.8 2.8 5.2-5.6" fill="none" stroke="#FBF7F0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const DOT_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#A9B3A6" stroke-width="2.4"/></svg>';

const params = new URLSearchParams(location.search);
if (!params.has('frogs')) {
  params.set('frogs', '6');
  location.replace(`${location.pathname}?${params}`);
}

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = (/** @type {string} */ icon, /** @type {string} */ text) => { $('status').innerHTML = `${icon}<span>${text}</span>`; };

const result = await startApp(/** @type {HTMLCanvasElement} */ ($('view')));
if (!result.ok) {
  status(ICON_WARN, `WebGPU is not available here (${result.reason}). Open this page in current Chrome or Edge.`);
} else {
  const app = /** @type {any} */ (result);
  const creatures = app.creatures;
  const gap = 0.4;
  // Time it takes to move and pose the frogs each frame (their system's tick), and the GPU pass.
  let cpuMs = 0, gpuMs = 0;
  const tick = creatures.tick.bind(creatures);
  creatures.tick = (/** @type {any} */ f) => { const t0 = performance.now(); tick(f); cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1; };
  on('render:timings', (/** @type {{ passes: { name: string, ms: number }[] }} */ p) => {
    const c = p.passes.find((x) => x.name === 'creatures');
    if (c) gpuMs = gpuMs * 0.9 + c.ms * 0.1;
  });

  // Time of day shown: a display override at that hour of today (the world clock runs on).
  $('times').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!b) return;
    if (b.id === 'look') { look(); return; }
    for (const x of $('times').querySelectorAll('[data-hour]')) x.setAttribute('aria-pressed', String(x === b));
    const h = b.dataset.hour;
    if (h === 'live') { clock.setDisplayOverride(null); return; }
    const dayStart = Math.floor(clock.worldT() / clock.SECONDS_PER_DAY) * clock.SECONDS_PER_DAY;
    const dusk = 12 + (app.world.state?.seasons?.dayLengthH ?? 12) / 2 + 1;
    const hour = h === 'dusk' ? dusk + 0.5 : Number(h);
    clock.setDisplayOverride(dayStart + hour * clock.SECONDS_PER_HOUR);
  });

  /** Glide the camera to the frogs (a tool's move, not the game's). */
  function look() {
    const list = creatures.frogs();
    if (!list.length) return;
    const x = list.reduce((s, /** @type {any} */ a) => s + a.x, 0) / list.length, z = list.reduce((s, /** @type {any} */ a) => s + a.z, 0) / list.length;
    dispatch({ type: 'camera.focus', x, z, distance: 4, pitchDeg: 30 });
  }

  const started = performance.now();
  let looked = false;
  setInterval(() => {
    const list = creatures.frogs();
    if (!list.length) { status(DOT_WAIT, 'Waiting for the frogs to come.'); return; }
    if (!looked) { looked = true; look(); }
    const modes = { rest: 0, forage: 0, call: 0, water: 0 };
    for (const a of list) {
      if (a.mode === 'swim' || a.mode === 'float') modes.water++;
      else if (a.mode in modes) modes[/** @type {'rest'} */ (a.mode)]++;
    }
    $('t-frogs').textContent = `${modes.rest} / ${modes.forage} / ${modes.call} / ${modes.water}`;
    const calls = creatures.agents.calls();
    const now = creatures.agents.now();
    const recent = calls.filter((/** @type {any} */ c) => now - c.t < 60);
    let tight = Infinity;
    for (let i = 1; i < calls.length; i++) tight = Math.min(tight, calls[i].t - calls[i - 1].t);
    $('t-calls').textContent = `${recent.length} · ${Number.isFinite(tight) ? tight.toFixed(2) + ' s' : '-'}`;
    const st = creatures.agents.stats();
    const minutes = Math.max(1 / 60, (performance.now() - started) / 60000);
    $('t-hops').textContent = `${(st.hops / minutes).toFixed(1)} · ${st.hops ? ((st.hopM / st.hops) * 100).toFixed(0) + ' cm' : '-'}`;
    $('t-cost').textContent = `${cpuMs.toFixed(2)} · ${gpuMs.toFixed(2)}`;
    const ok = !(tight < gap - 1e-6);
    status(ok ? ICON_CHECK : ICON_WARN, ok ? `${list.length} frogs. No two calls have started within ${gap} s of each other.` : `Two calls started ${tight.toFixed(3)} s apart.`);
    drawChorus(list, recent, now);
  }, 500);

  /** @param {any[]} list @param {{ id: number, t: number }[]} recent @param {number} now */
  function drawChorus(list, recent, now) {
    const c = /** @type {HTMLCanvasElement} */ ($('chorus'));
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = '600 15px Nunito, system-ui, sans-serif';
    const ids = list.map((a) => a.id).sort((a, b) => a - b);
    const x0 = 70, x1 = w - 10, row = (h - 30) / Math.max(1, ids.length);
    g.fillStyle = '#4A5551'; g.textAlign = 'right';
    ids.forEach((id, i) => g.fillText(`frog ${id}`, x0 - 8, 14 + i * row + row / 2));
    g.strokeStyle = '#E3D9C9'; g.textAlign = 'center';
    for (let s = 0; s <= 60; s += 10) {
      const x = x0 + ((60 - s) / 60) * (x1 - x0);
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - 26); g.stroke();
      g.fillText(s ? `${s} s ago` : 'now', x, h - 6);
    }
    recent.forEach((call, i) => {
      const r = ids.indexOf(call.id);
      if (r < 0) return;
      const x = x0 + (1 - (now - call.t) / 60) * (x1 - x0);
      const tooSoon = i > 0 && call.t - recent[i - 1].t < gap - 1e-6;
      g.fillStyle = tooSoon ? '#B5654A' : '#5F7F5B';
      g.fillRect(x - 2, 6 + r * row + row * 0.2, 4, row * 0.6);
    });
  }
}
