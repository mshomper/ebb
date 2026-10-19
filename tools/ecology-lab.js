// @ts-check
// ebb ecology lab (S6a, docs 11, 12): the starter island and Two ponds side by side, each built
// from its recipes with no GPU (tools/ecology-world.js), then game days run fast through the real
// hourly tick. Per island: when the pond became right, the sign, settling and each frog that came
// or left, as a timeline over the days; the frogs against the room the edge has, and the midges,
// hour by hour; a map of a need (or the habitat score, or the midges) with the pond's edge and the
// frogs on it; and a second run from the same start that must end the same.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { frogNeeds } from '../src/world/ecology/habitat.js';
import { midgeArea } from '../src/world/ecology/midges.js';
import { openBox } from '../src/world/ecology/fields.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const ISLANDS = [{ id: 'starter-island', name: 'Starter island' }, { id: 'two-ponds', name: 'Two ponds' }];
const CHUNK_MS = 14;

const ICON_CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/><path d="M8 12.5l2.8 2.8 5.2-5.6" fill="none" stroke="#FBF7F0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const DOT_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#A9B3A6" stroke-width="2.4"/></svg>';

// Colors: the journal's ink for the fields, water as on the growth lab, frogs in moss green.
const INK = [184, 101, 58];
const PAPER = [233, 226, 205];
const SEA = [47, 110, 134], POND = [59, 127, 168];
const FROG = '#2F4A2C', EDGE = '#1E2624', CAPACITY = '#8C8F86', MIDGE = '#9C7B60';

/** The fields a map can show: id, button label, legend words. */
const FIELDS = [
  { id: 'score', label: 'Habitat', words: 'how well frogs would do there (all five needs)' },
  { id: 'water', label: 'Water', words: 'near still water of the right depth' },
  { id: 'food', label: 'Food', words: 'midges within reach, for a group' },
  { id: 'shelter', label: 'Shelter', words: 'reeds, rushes, iris or lilies close by' },
  { id: 'midges', label: 'Midges', words: 'how many midges gather there' },
];

/** Timeline marks: event name, words, how it is drawn. */
const MARKS = {
  'creature:habitat-right': { words: 'the pond became right', shape: 'ring' },
  'creature:arrived': { words: 'a sign at dusk (a scout came)', shape: 'dot' },
  'creature:settled': { words: 'settled', shape: 'square' },
  'creature:joined': { words: 'another frog came', shape: 'up' },
  'creature:left': { words: 'a frog moved on', shape: 'down' },
  'species:happy': { words: 'happy', shape: 'star' },
};

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const seedIn = /** @type {HTMLInputElement} */ ($('seed'));
const daysIn = /** @type {HTMLSelectElement} */ ($('days'));
const startIn = /** @type {HTMLSelectElement} */ ($('start'));
const runBtn = /** @type {HTMLButtonElement} */ ($('run'));
const status = (/** @type {string} */ icon, /** @type {string} */ text) => { $('status').innerHTML = `${icon}<span>${text}</span>`; };

/** @type {string} */ let field = 'score';
/**
 * @typedef {{ hours: number, h0: number, frogs: number[], room: number[], midges: number[], dormant: boolean[],
 *   events: { hour: number, name: string, payload: any }[], end: any, hash: number, env: any, model: any }} Run
 */
/** Per island: its panel's elements and its latest run. @type {Record<string, { el: Record<string, HTMLElement>, run: Run | null, start: any }>} */
const panels = {};

const R = await loadEcologyRecipes();
buildFieldButtons();
for (const isl of ISLANDS) buildPanel(isl);
status(DOT_WAIT, 'Building the islands');
await frame();
for (const isl of ISLANDS) {
  const w = islandWorld(R, isl.id, seed());
  panels[isl.id].start = w;
  drawMap(isl.id);
}
status(DOT_WAIT, 'Ready. Press Run both islands.');
addEventListener('resize', () => { for (const isl of ISLANDS) drawAll(isl.id); });
seedIn.addEventListener('change', async () => {
  for (const isl of ISLANDS) { panels[isl.id].run = null; panels[isl.id].start = islandWorld(R, isl.id, seed()); drawAll(isl.id); }
});
runBtn.addEventListener('click', runAll);

function seed() { return Math.max(0, Math.floor(Number(seedIn.value) || 0)) >>> 0; }
/** Let the page draw between chunks (a timer, not a frame, so a run goes on in a background tab). */
function frame() { return new Promise((r) => setTimeout(r, 0)); }

/** "day 3, 19:00" (days counted from 1, as the journal does). @param {number} h */
const when = (h) => `day ${Math.floor(h / 24) + 1}, ${String(h % 24).padStart(2, '0')}:00`;

function buildFieldButtons() {
  const box = $('fields');
  box.innerHTML = FIELDS.map((f) => `<button type="button" data-field="${f.id}" aria-pressed="${f.id === field}">${f.label}</button>`).join('');
  box.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!b?.dataset.field) return;
    field = b.dataset.field;
    for (const x of box.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    legendMap();
    for (const isl of ISLANDS) drawMap(isl.id);
  });
  legendMap();
}

function legendMap() {
  const f = FIELDS.find((x) => x.id === field);
  $('map-legend').innerHTML = `<span><i style="background:rgb(${INK})"></i>${f?.words}, strong to faint</span>
    <span><i style="background:rgb(${POND})"></i>pond and streams</span><span><i style="background:rgb(${SEA})"></i>sea</span>
    <span><i style="background:${EDGE}"></i>good edge (room for frogs)</span><span><i class="round" style="background:${FROG};border:2px solid #FBF7F0"></i>a frog</span>`;
}

/** @param {{ id: string, name: string }} isl */
function buildPanel(isl) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<h2>${isl.name}</h2>
    <div class="status" data-el="verdict">${DOT_WAIT}<span>Not run yet.</span></div>
    <ul class="facts" data-el="facts"></ul>
    <h3>Arrival over the days</h3>
    <canvas class="timeline" data-el="timeline" aria-label="${isl.name}: arrival timeline"></canvas>
    <div class="legend">${Object.values(MARKS).map((m) => `<span>${markSvg(m.shape)}${m.words}</span>`).join('')}<span><i style="background:#C9D3DC"></i>frogs asleep for winter</span></div>
    <h3>Frogs, hour by hour</h3>
    <canvas class="chart" data-el="frogs" aria-label="${isl.name}: frogs and room for them"></canvas>
    <div class="legend"><span><i class="line" style="background:${FROG}"></i>frogs</span><span><i class="dash"></i>room for frogs (one per 3 m of good edge)</span></div>
    <h3>Midges</h3>
    <canvas class="chart small" data-el="midges" aria-label="${isl.name}: midges"></canvas>
    <div class="legend"><span><i class="line" style="background:${MIDGE}"></i>square meters with a good cloud of midges</span></div>
    <h3>From above</h3>
    <canvas class="map" data-el="map" aria-label="${isl.name}: map"></canvas>`;
  $('islands').appendChild(card);
  /** @type {Record<string, HTMLElement>} */ const el = {};
  for (const e of card.querySelectorAll('[data-el]')) el[/** @type {HTMLElement} */ (e).dataset.el ?? ''] = /** @type {HTMLElement} */ (e);
  panels[isl.id] = { el, run: null, start: null };
}

/** A small drawn mark for the legend. @param {string} shape */
function markSvg(shape) {
  const s = { ring: '<circle cx="8" cy="8" r="5" fill="none" stroke="#4A4843" stroke-width="2"/>',
    dot: `<circle cx="8" cy="8" r="5.5" fill="rgb(${INK})"/>`,
    square: `<rect x="3" y="3" width="10" height="10" rx="1.5" fill="${FROG}"/>`,
    up: `<path d="M8 2.5L13.5 13H2.5Z" fill="${FROG}"/>`,
    down: '<path d="M8 13.5L13.5 3H2.5Z" fill="#B5654A"/>',
    star: '<path d="M8 1.8L9.8 6.2L14.5 6.4L10.9 9.4L12.1 14L8 11.4L3.9 14L5.1 9.4L1.5 6.4L6.2 6.2Z" fill="#C9A227"/>' }[shape] ?? '';
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${s}</svg>`;
}

async function runAll() {
  runBtn.disabled = true;
  const days = Number(daysIn.value), startDay = Number(startIn.value), s = seed();
  const t0 = performance.now();
  for (const isl of ISLANDS) {
    const p = panels[isl.id];
    p.run = null;
    p.el.verdict.innerHTML = `${DOT_WAIT}<span>Running.</span>`;
    drawAll(isl.id);
  }
  for (const isl of ISLANDS) {
    const p = panels[isl.id];
    const a = await runIsland(isl, s, days, startDay, 'first run');
    p.run = a;
    drawAll(isl.id);
    const b = await runIsland(isl, s, days, startDay, 'second run');
    const same = a.hash === b.hash && eventsText(a) === eventsText(b);
    p.el.verdict.innerHTML = same
      ? `${ICON_CHECK}<span>Both runs ended the same (world ${hex(a.hash)}).</span>`
      : `${ICON_WARN}<span>The two runs ended differently: ${hex(a.hash)} and ${hex(b.hash)}.</span>`;
  }
  status(ICON_CHECK, `Done: ${days} game days on both islands, twice each, in ${((performance.now() - t0) / 1000).toFixed(1)} seconds.`);
  runBtn.disabled = false;
}

/** @param {number} h */
const hex = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
/** @param {Run} r */
const eventsText = (r) => r.events.map((e) => `${e.hour}:${e.name}:${e.payload?.id ?? ''}`).join(' ');

/**
 * Run one island for `days` game days from a new world, a few hours per frame.
 * @param {{ id: string, name: string }} isl @param {number} s @param {number} days @param {number} startDay @param {string} which
 * @returns {Promise<Run>}
 */
async function runIsland(isl, s, days, startDay, which) {
  const w = islandWorld(R, isl.id, s, startDay);
  let state = w.state;
  const hours = days * 24;
  /** @type {Run} */ const run = { hours, h0: w.h0, frogs: [], room: [], midges: [], dormant: [], events: [], end: null, hash: 0, env: w.env, model: w.model };
  let h = 0;
  while (h < hours) {
    const t = performance.now();
    while (h < hours && performance.now() - t < CHUNK_MS) {
      const hour = w.h0 + 1 + h;
      const r = runHour(state, hour, w.env);
      state = r.state;
      for (const e of r.events) if (MARKS[/** @type {keyof typeof MARKS} */ (e.name)]) run.events.push({ hour, name: e.name, payload: e.payload });
      const F = state.creatures?.frogs;
      run.frogs.push(F?.frogs.length ?? 0);
      run.room.push(F?.edge.capacity ?? 0);
      run.midges.push(midgeArea(state.ecology?.midges, 0.25));
      run.dormant.push(!!F?.dormant);
      h++;
    }
    status(DOT_WAIT, `${isl.name}, ${which}: day ${Math.floor(h / 24)} of ${days}`);
    await frame();
  }
  run.end = state;
  run.hash = hashWorldState(state);
  return run;
}

/** @param {string} id */
function drawAll(id) {
  drawFacts(id);
  drawTimeline(id);
  drawChart(id, 'frogs');
  drawChart(id, 'midges');
  drawMap(id);
}

/** @param {string} id */
function drawFacts(id) {
  const p = panels[id], r = p.run;
  if (!r) { p.el.facts.innerHTML = ''; return; }
  const first = (/** @type {string} */ name) => r.events.find((e) => e.name === name);
  const F = r.end.creatures?.frogs;
  const rows = [
    ['Pond right', first('creature:habitat-right') ? when(first('creature:habitat-right').hour) : 'not yet'],
    ['Sign at dusk', first('creature:arrived') ? when(first('creature:arrived').hour) : 'not yet'],
    ['Settled', first('creature:settled') ? when(first('creature:settled').hour) : 'not yet'],
    ['At the end', `${F?.frogs.length ?? 0} frogs, room for ${F?.edge.capacity ?? 0} along ${F?.edge.metres ?? 0} m of good edge`],
    ['Came, left', `${r.events.filter((e) => e.name === 'creature:arrived' || e.name === 'creature:joined').length} came, ${r.events.filter((e) => e.name === 'creature:left').length} moved on`],
  ];
  p.el.facts.innerHTML = rows.map(([a, b]) => `<li><span>${a}</span><span>${b}</span></li>`).join('');
}

/** A canvas sized to its box at the device's pixel ratio; returns its context and CSS size. @param {HTMLElement} el */
function canvasOf(el) {
  const c = /** @type {HTMLCanvasElement} */ (el);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = "600 15px Nunito, system-ui, sans-serif";
  return { g, w, h };
}

/** Day ticks and labels along the bottom of a chart. @param {CanvasRenderingContext2D} g @param {number} x0 @param {number} x1 @param {number} y @param {number} hours @param {number} h0 */
function dayAxis(g, x0, x1, y, hours, h0) {
  const days = hours / 24;
  const step = days <= 14 ? 1 : days <= 28 ? 7 : 14;
  g.fillStyle = '#4A5551'; g.strokeStyle = '#E3D9C9'; g.lineWidth = 1;
  g.textAlign = 'center';
  const d0 = Math.floor((h0 + 1) / 24);
  for (let d = Math.ceil((h0 + 1) / 24); d <= d0 + days; d++) {
    const x = x0 + ((d * 24 - h0 - 1) / hours) * (x1 - x0);
    g.beginPath(); g.moveTo(x, 4); g.lineTo(x, y); g.stroke();
    if ((d - d0) % step === 0 && x - x0 > 12 && x1 - x > 12) g.fillText(`day ${d + 1}`, x, y + 18);
  }
}

/** @param {string} id */
function drawTimeline(id) {
  const p = panels[id], r = p.run;
  const { g, w, h } = canvasOf(p.el.timeline);
  if (!r) return;
  const x0 = 10, x1 = w - 10, base = h - 30;
  const xOf = (/** @type {number} */ hour) => x0 + ((hour - r.h0 - 1 + 0.5) / r.hours) * (x1 - x0);
  // Winter sleep as a pale band.
  g.fillStyle = '#C9D3DC';
  for (let i = 0; i < r.hours; i++) if (r.dormant[i]) g.fillRect(xOf(r.h0 + 1 + i) - 0.5, 8, (x1 - x0) / r.hours + 1, base - 8);
  dayAxis(g, x0, x1, base, r.hours, r.h0);
  // Marks in rows so they do not hide each other: right, sign and settled up top, comings and goings below.
  for (const e of r.events) {
    const m = MARKS[/** @type {keyof typeof MARKS} */ (e.name)];
    const x = xOf(e.hour), y = m.shape === 'up' || m.shape === 'down' ? base - 22 : base - 52;
    drawMark(g, m.shape, x, y);
  }
}

/** @param {CanvasRenderingContext2D} g @param {string} shape @param {number} x @param {number} y */
function drawMark(g, shape, x, y) {
  g.lineWidth = 2;
  g.beginPath();
  if (shape === 'ring') { g.strokeStyle = '#4A4843'; g.arc(x, y, 6, 0, Math.PI * 2); g.stroke(); return; }
  if (shape === 'dot') { g.fillStyle = `rgb(${INK})`; g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); return; }
  if (shape === 'square') { g.fillStyle = FROG; g.fillRect(x - 6, y - 6, 12, 12); return; }
  if (shape === 'up') { g.fillStyle = FROG; g.moveTo(x, y - 7); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.fill(); return; }
  if (shape === 'down') { g.fillStyle = '#B5654A'; g.moveTo(x, y + 7); g.lineTo(x + 6, y - 5); g.lineTo(x - 6, y - 5); g.fill(); return; }
  g.fillStyle = '#C9A227';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 3.5 : 8;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}

/** @param {string} id @param {'frogs'|'midges'} which */
function drawChart(id, which) {
  const p = panels[id], r = p.run;
  const { g, w, h } = canvasOf(p.el[which]);
  if (!r) return;
  const x0 = 44, x1 = w - 10, y0 = 10, y1 = h - 30;
  const series = which === 'frogs' ? [r.frogs, r.room] : [r.midges];
  let top = 1;
  for (const s of series) for (const v of s) top = Math.max(top, v);
  top = niceTop(top);
  g.fillStyle = '#4A5551'; g.textAlign = 'right'; g.strokeStyle = '#E3D9C9'; g.lineWidth = 1;
  for (const v of [0, top / 2, top]) {
    const y = y1 - (v / top) * (y1 - y0);
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    g.fillText(String(v), x0 - 6, y + 5);
  }
  dayAxis(g, x0, x1, y1, r.hours, r.h0);
  const line = (/** @type {number[]} */ s, /** @type {string} */ color, /** @type {boolean} */ dash) => {
    g.strokeStyle = color; g.lineWidth = 2.5; g.setLineDash(dash ? [6, 4] : []);
    g.beginPath();
    s.forEach((v, i) => {
      const x = x0 + ((i + 0.5) / s.length) * (x1 - x0), y = y1 - (v / top) * (y1 - y0);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke(); g.setLineDash([]);
  };
  if (which === 'frogs') { line(r.room, CAPACITY, true); line(r.frogs, FROG, false); } else line(r.midges, MIDGE, false);
}

/** A round number at or above v for an axis top. @param {number} v */
function niceTop(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** @param {string} id */
function drawMap(id) {
  const p = panels[id];
  const c = /** @type {HTMLCanvasElement} */ (p.el.map);
  const state = p.run?.end ?? p.start?.state;
  const model = p.run?.model ?? p.start?.model;
  if (!state || !model) return;
  const hab = model.habitat, n = hab.n;
  const box = openBox(hab);
  const W = box.i1 - box.i0 + 1, H = box.j1 - box.j0 + 1;
  const S = 4;
  c.width = W * S; c.height = H * S;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const img = g.createImageData(W * S, H * S);
  // Before a run there are no midges yet, so food and the habitat score read empty.
  const needs = field === 'midges' ? null : frogNeeds(hab, state.growth, state.ecology?.midges ?? null, R.species.frog);
  const values = field === 'midges' ? state.ecology?.midges : needs?.[/** @type {'score'} */ (field)];
  const scale = field === 'midges' ? 1 / 255 : 1;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = (box.j0 + j) * n + box.i0 + i;
      const v = values ? Math.min(1, values[k] * scale) : 0;
      const base = hab.depthCm[k] > 0 ? POND : PAPER;
      const rgb = !hab.open[k] || hab.sea[k] ? SEA : base.map((b, q) => Math.round(b + (INK[q] - b) * v));
      for (let b = 0; b < S; b++) {
        for (let a = 0; a < S; a++) {
          const o = ((j * S + b) * W * S + i * S + a) * 4;
          img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  // The good edge, and the frogs.
  const eco = state.ecology?.frogs;
  if (eco) {
    g.fillStyle = EDGE;
    const at = 255 * R.species.frog.ecology.edge.goodScore;
    for (const k of eco.edge.cells) {
      if (eco.score[k] < at) continue;
      g.fillRect(((k % n) - box.i0) * S + 1, (Math.floor(k / n) - box.j0) * S + 1, S - 2, S - 2);
    }
  }
  for (const f of state.creatures?.frogs?.frogs ?? []) {
    const x = (f.x - HABITAT_ORIGIN - box.i0) * S, y = (f.z - HABITAT_ORIGIN - box.j0) * S;
    g.beginPath(); g.arc(x, y, S * 1.3, 0, Math.PI * 2);
    g.fillStyle = FROG; g.fill(); g.lineWidth = 2; g.strokeStyle = '#FBF7F0'; g.stroke();
  }
}
