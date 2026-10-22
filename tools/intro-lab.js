// @ts-check
// The intro lab (docs/future/13 sections 2 and 13, E5): the first evening side by side with the game.
// The game runs in the frame on the right, on a test link (?seed, ?intro=<beat>, ?nointro: never
// saved); the left reads its director live (window.ebb with ?debug). Each seed's island is built from
// its land recipe on the worker pool, as the game builds it, and the camp is drawn over it: the pad,
// its lock edge and blend, the slots, the boat's stake and line, the walker's start and the spring.
// Over 60 seeds it checks that the stake is found and that the start, stepped up the beach as the
// game does, finds dry ground below the pad at the highest tide.

import { subSeed } from '../src/core/rng.js';
import { initWorkers, run, defaultPoolSize } from '../src/core/workers.js';
import { CELL, CHUNK_CELLS, CHUNK_SIZE, dequantize } from '../src/world/terrain/grid.js';
import { landmarks } from '../src/world/terrain/landform.js';
import { padOf, padToWorld, slotWorld } from '../src/world/camp/layout.js';
import { mooringOf } from '../src/world/intro/boat.js';
import { flapSpot } from '../src/world/intro/adapter.js';

const JOB = { module: './world/terrain/landform.js', fn: 'buildBase' };
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
/** @param {string} p */
const json = async (p) => (await fetch(new URL(p, import.meta.url))).json();

const params = new URLSearchParams(location.search);
const islandId = params.get('island') ?? 'starter-island-2';
const [land, intro, boatR, water] = await Promise.all([json(`../recipes/land/${islandId}.json`), json('../recipes/world/intro.json'),
  json('../recipes/world/boat.json'), json('../recipes/world/water.json')]);
const B = boatR.boat ?? boatR;
/** The highest spring tide (doc 07): amplitude times one plus the spring-neap share. */
const HIGH_TIDE = water.tide.amplitudeM * (1 + water.tide.springNeap);
const C0 = land.chunkMin ?? -1, C1 = land.chunkMax ?? 1, SIDE = C1 - C0 + 1, N = SIDE * CHUNK_CELLS;
/** World x and z of the open land's first cell edge. */
const X0 = CHUNK_SIZE * C0 - CHUNK_SIZE / 2;

initWorkers({ size: defaultPoolSize() });

// ---------------------------------------------------------------------------
// One island: heights and material over the open land, and the camp worked out from them.

/**
 * @typedef {Object} Isle
 * @property {number} seed @property {Float32Array} h  heights, N x N cells @property {Uint8Array} m  four weights a cell
 * @property {any} pad @property {any} moor @property {{ x: number, z: number } | null} spring
 * @property {{ x: number, z: number, yaw: number }} start
 * @property {{ stakeFound: boolean, outM: number, startH: number, dryAtHigh: boolean, sandy: boolean, springM: number }} check
 */

/** @param {number} seed world seed @returns {Promise<Isle>} */
async function buildIsle(seed) {
  const ts = subSeed(seed, 'terrain');
  const jobs = [];
  for (let cz = C0; cz <= C1; cz++) for (let cx = C0; cx <= C1; cx++) jobs.push(run(JOB, { land, seed: ts, cx, cz }));
  const bases = await Promise.all(jobs);
  const h = new Float32Array(N * N), m = new Uint8Array(N * N * 4);
  for (const b of bases) {
    const ox = (b.cx - C0) * CHUNK_CELLS, oz = (b.cz - C0) * CHUNK_CELLS;
    for (let j = 0; j < CHUNK_CELLS; j++) for (let i = 0; i < CHUNK_CELLS; i++) {
      const k = j * CHUNK_CELLS + i, g = (oz + j) * N + ox + i;
      h[g] = dequantize(b.heightQ[k]);
      m.set(b.material.subarray(k * 4, k * 4 + 4), g * 4);
    }
  }
  const at = (/** @type {number} */ x, /** @type {number} */ z) => {
    const i = Math.min(N - 1, Math.max(0, Math.floor((x - X0) / CELL))), j = Math.min(N - 1, Math.max(0, Math.floor((z - X0) / CELL)));
    return j * N + i;
  };
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => h[at(x, z)];
  const pad = padOf(land);
  const M = { ...B.mooring, ...(pad?.camp?.mooring ?? {}) };
  const moor = mooringOf(pad, ground, M);
  // The start as the game places it: on the beach inland of the stake, stepped up the beach while
  // the sea of the moment covers it (boot.js). Here the step-up is tried at the highest tide.
  const s = moor.stand;
  let hi = s, steps = 0;
  for (; steps < 40 && ground(hi.x, hi.z) < HIGH_TIDE + 0.05; steps++) hi = { ...hi, x: hi.x - pad.fx * 0.25, z: hi.z - pad.fz * 0.25 };
  const spring = landmarks(land, ts).spring;
  const edge = [pad.x + pad.fx * pad.r, pad.z + pad.fz * pad.r];
  const outM = Math.hypot(moor.stake.x - edge[0], moor.stake.z - edge[1]);
  const highOnPad = Math.hypot(hi.x - pad.x, hi.z - pad.z) < pad.r;
  return {
    seed, h, m, pad, moor, spring, start: s,
    check: {
      stakeFound: outM < (M.searchM ?? 30) - 0.2, outM, startH: ground(s.x, s.z), highStepM: steps * 0.25,
      highOk: steps < 40 && !highOnPad, springM: spring ? Math.hypot(spring.x - s.x, spring.z - s.z) : NaN,
    },
  };
}

// ---------------------------------------------------------------------------
// Drawing

const GRASS = [127, 164, 99], SAND = [220, 201, 160], ROCK = [154, 149, 140], SOIL = [140, 106, 72];

/**
 * The island's ground into a canvas, over a square of the world. @param {HTMLCanvasElement} cv
 * @param {Isle} I @param {number} cx @param {number} cz center (m) @param {number} spanM side (m)
 */
function drawGround(cv, I, cx, cz, spanM) {
  const W = cv.width, g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = g.createImageData(W, W), d = img.data;
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const x = cx - spanM / 2 + ((px + 0.5) / W) * spanM, z = cz - spanM / 2 + ((py + 0.5) / W) * spanM;
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - X0) / CELL), o = (py * W + px) * 4;
    if (i < 0 || j < 0 || i >= N || j >= N) { d[o] = 62; d[o + 1] = 127; d[o + 2] = 154; d[o + 3] = 255; continue; }
    const k = j * N + i, hh = I.h[k];
    if (hh < 0) {
      const t = Math.min(1, -hh / 3);
      d[o] = 90 - 40 * t; d[o + 1] = 154 - 50 * t; d[o + 2] = 174 - 40 * t;
    } else {
      const w = I.m.subarray(k * 4, k * 4 + 4), s = (w[0] + w[1] + w[2] + w[3]) || 1;
      // A little shade by height, and a darker line every meter.
      const shade = 0.86 + 0.14 * Math.min(1, hh / 4), line = (hh % 1) < 0.05 ? 0.88 : 1;
      for (let c = 0; c < 3; c++) d[o + c] = ((GRASS[c] * w[0] + SAND[c] * w[1] + ROCK[c] * w[2] + SOIL[c] * w[3]) / s) * shade * line;
      // The highest tide's reach: a pale wet band.
      if (hh < HIGH_TIDE) { d[o] = d[o] * 0.85 + 30; d[o + 1] = d[o + 1] * 0.85 + 32; d[o + 2] = d[o + 2] * 0.85 + 36; }
    }
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return /** @type {(x: number, z: number) => [number, number]} */ ((x, z) => [((x - (cx - spanM / 2)) / spanM) * W, ((z - (cz - spanM / 2)) / spanM) * W]);
}

/**
 * The camp over the ground: pad, lock edge, blend, slots, boat line, start and spring.
 * @param {HTMLCanvasElement} cv @param {Isle} I @param {(x: number, z: number) => [number, number]} P @param {number} pxPerM
 * @param {boolean} detail draw the slots and labels
 */
function drawCamp(cv, I, P, pxPerM, detail) {
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const pad = I.pad, [px, py] = P(pad.x, pad.z);
  g.save();
  g.lineWidth = Math.max(1, pxPerM * 0.06);
  // The blend back to natural ground, then the lock edge (dashed), then the pad.
  g.strokeStyle = 'rgba(244, 238, 228, 0.35)';
  g.beginPath(); g.arc(px, py, (pad.r + (pad.blend ?? 0)) * pxPerM, 0, Math.PI * 2); g.stroke();
  g.setLineDash([pxPerM * 0.35, pxPerM * 0.25]);
  g.strokeStyle = 'rgba(244, 238, 228, 0.95)';
  g.beginPath(); g.arc(px, py, (pad.r + (pad.lockFadeM ?? 1)) * pxPerM, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(244, 238, 228, 0.45)';
  g.beginPath(); g.arc(px, py, pad.r * pxPerM, 0, Math.PI * 2); g.fill();
  // Seaward.
  const [ax, ay] = P(pad.x + pad.fx * pad.r * 0.8, pad.z + pad.fz * pad.r * 0.8);
  g.strokeStyle = '#1E2624'; g.beginPath(); g.moveTo(px, py); g.lineTo(ax, ay); g.stroke();
  if (detail) {
    for (const s of pad.camp.slots) {
      const w = slotWorld(pad, s);
      const [sx, sy] = P(w.x, w.z);
      g.fillStyle = s.id === 'tent' || s.id === 'ring' ? 'rgba(224, 168, 90, 0.95)' : 'rgba(224, 168, 90, 0.5)';
      if (s.w && s.d) {
        // A footprint: w along the slot's yaw (seaward, or along v), d across it.
        const along = s.yaw === 'alongV' ? [pad.fz, -pad.fx] : [pad.fx, pad.fz];
        const across = [along[1], -along[0]];
        const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => P(w.x + along[0] * a * s.w / 2 + across[0] * b * s.d / 2, w.z + along[1] * a * s.w / 2 + across[1] * b * s.d / 2));
        g.beginPath(); g.moveTo(c[0][0], c[0][1]); for (const q of c.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); g.fill();
      } else {
        g.beginPath(); g.arc(sx, sy, Math.max(2, (s.r ?? 0.2) * pxPerM), 0, Math.PI * 2); g.fill();
      }
    }
    // The flap, where Skip leaves you.
    const f = flapSpot(pad), [fx, fy] = P(f.x, f.z);
    g.strokeStyle = '#D24B3C'; g.lineWidth = 2; g.beginPath(); g.arc(fx, fy, 5, 0, Math.PI * 2); g.stroke();
    g.font = '800 15px Nunito, sans-serif'; g.fillStyle = '#1E2624';
    for (const id of ['tent', 'ring']) {
      const s = pad.camp.slots.find((/** @type {any} */ x) => x.id === id), w = slotWorld(pad, s), [lx, ly] = P(w.x, w.z);
      g.fillText(id, lx + 8, ly - 8);
    }
  }
  // The boat line: pad edge, stake, boat.
  const m = I.moor, [ex, ey] = P(pad.x + pad.fx * pad.r, pad.z + pad.fz * pad.r), [kx, ky] = P(m.stake.x, m.stake.z), [bx, by] = P(m.boat.x, m.boat.z);
  g.strokeStyle = '#6B4A2F'; g.lineWidth = Math.max(1.5, pxPerM * 0.05); g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(ex, ey); g.lineTo(kx, ky); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#6B4A2F';
  g.beginPath(); g.arc(kx, ky, Math.max(2.5, pxPerM * 0.15), 0, Math.PI * 2); g.fill();
  // The boat: its length along its yaw (bow toward the stake), its beam across.
  const L = B.hull.lengthM / 2, Bm = B.hull.beamM / 2, ux = Math.sin(m.boat.yaw), uz = Math.cos(m.boat.yaw);
  const hull = [[L, 0], [L * 0.3, Bm], [-L, Bm * 0.7], [-L, -Bm * 0.7], [L * 0.3, -Bm]].map(([a, b]) => P(m.boat.x + ux * a + uz * b, m.boat.z + uz * a - ux * b));
  g.beginPath(); g.moveTo(hull[0][0], hull[0][1]); for (const q of hull.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); g.fill();
  // The walker's start and the spring.
  const [wx, wy] = P(I.start.x, I.start.z);
  g.fillStyle = '#D24B3C'; g.beginPath(); g.arc(wx, wy, Math.max(3, pxPerM * 0.25), 0, Math.PI * 2); g.fill();
  if (I.spring) {
    const [qx, qy] = P(I.spring.x, I.spring.z);
    g.fillStyle = '#2F6BB0'; g.beginPath(); g.arc(qx, qy, Math.max(3, pxPerM * 0.4), 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** Words for a seed's checks. @param {Isle} I */
function problems(I) {
  const c = I.check, out = [];
  if (!c.stakeFound) out.push('no stake ground');
  if (!c.highOk) out.push('no dry beach at high tide');
  return out;
}

// ---------------------------------------------------------------------------
// This seed

let seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
$('seed').value = String(seed);
$('from').value = String(seed);

async function showSeed() {
  $('seedNote').textContent = 'Building';
  const I = await buildIsle(seed);
  const span = SIDE * CHUNK_SIZE, mid = X0 + span / 2;
  const Pi = drawGround($('island'), I, mid, mid, span);
  drawCamp($('island'), I, Pi, $('island').width / span, false);
  // The close view: the pad and the boat, with a little room.
  const cx = (I.pad.x + I.moor.boat.x) / 2, cz = (I.pad.z + I.moor.boat.z) / 2;
  const cspan = Math.max(16, Math.hypot(I.moor.boat.x - I.pad.x, I.moor.boat.z - I.pad.z) + I.pad.r * 2 + 6);
  const Pc = drawGround($('camp'), I, cx, cz, cspan);
  drawCamp($('camp'), I, Pc, $('camp').width / cspan, true);
  const c = I.check, bad = problems(I);
  $('seedNote').innerHTML = `Pad at (${I.pad.x.toFixed(1)}, ${I.pad.z.toFixed(1)}). The stake is ${c.outM.toFixed(1)} m out from the pad's edge; `
    + `the walker starts ${c.startH.toFixed(2)} m up, ${c.springM.toFixed(0)} m from the spring. `
    + (c.highStepM > 0 ? `At the highest tide (${HIGH_TIDE.toFixed(2)} m) the start steps ${c.highStepM.toFixed(2)} m up the beach to stay dry. ` : '')
    + (bad.length ? `<span class="bad">${bad.join(', ')}</span>` : '<span class="ok">All good.</span>');
}

// ---------------------------------------------------------------------------
// The game in the frame, and its director read live

/** @param {Record<string, string>} q */
function openGame(q) {
  const u = new URLSearchParams({ seed: String(seed), ...q, debug: '' });
  if (islandId !== 'starter-island-2') u.set('island', islandId);
  const url = `../?${u.toString().replace(/=(&|$)/g, '$1')}`;
  $('frame').src = url;
  $('gameUrl').textContent = url.replace('../', '');
  $('openTab').href = url;
  for (const b of document.querySelectorAll('[data-beat]')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.beat === (q.intro ?? '')));
}

const NAMES = /** @type {Record<string, string>} */ ({
  landfall: 'Landfall', spring: 'The spring', page: 'The first page', pitch: 'Pitch the tent', gather: 'Gather',
  ring: 'Lay the ring', shape: 'Go up and shape', dusk: 'Dusk at the fire', rest: 'Rest',
});
$('beats').innerHTML = intro.beats.map((/** @type {any} */ b, /** @type {number} */ i) =>
  `<button type="button" data-beat="${b.id}">${NAMES[b.id] ?? b.id}<small>beat ${i}</small></button>`).join('');
$('beats').addEventListener('click', (/** @type {MouseEvent} */ e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-beat]'));
  if (b?.dataset.beat) openGame({ intro: b.dataset.beat === 'landfall' ? '' : b.dataset.beat });
});
$('replay').addEventListener('click', () => openGame({ intro: '' }));
$('skipped').addEventListener('click', () => openGame({ nointro: '' }));
$('newSeed').addEventListener('click', () => {
  seed = (Math.random() * 0xffffffff) >>> 0;
  $('seed').value = String(seed);
  showSeed();
  openGame({ intro: '' });
});
$('seed').addEventListener('change', () => { seed = Number.parseInt($('seed').value, 10) >>> 0; showSeed(); openGame({ intro: '' }); });
// Skip to dusk in the running game: the clock runs on to a little before today's sunset (never
// back, and never a year on: once it is evening already, nothing happens).
$('duskNow').addEventListener('click', async () => {
  const w = /** @type {any} */ ($('frame').contentWindow);
  if (!w?.ebb?.debug || !w.ebb.intro?.hours) return;
  const sky = await json('../recipes/world/sky.json');
  const { sunMoon } = await import('../src/world/sky/sun-moon.js');
  const now = w.ebb.intro.hours(), day = Math.floor(now / 24);
  let hr = 12;
  while (hr < 23 && sunMoon((day * 24 + hr) * 3600, sky.orbit).sunAlt >= 0) hr += 1 / 60;
  if (now % 24 < hr - 0.15) w.ebb.debug.skipTo(day, hr - 0.15);
});

/** What the director in the frame is doing now, a few times a second. */
function readGame() {
  /** @type {any} */ let w = null;
  try { w = $('frame').contentWindow; } catch { /* not loaded */ }
  const live = w?.ebb?.intro?.live, cur = live?.intro?.current;
  const hint = w?.document?.querySelector('.ebb-notes__hint.is-shown .ebb-notes__hint-text')?.textContent ?? '';
  const rows = [
    ['Beat', cur ? `${NAMES[cur.id] ?? cur.id}${cur.started ? '' : ' (waiting to start)'}${cur.acting ? `, playing ${cur.acting}` : ''}` : live ? 'The evening is done' : 'Loading'],
    ['Hint', hint ? `<span class="hint">${hint.replace(/</g, '&lt;')}</span>` : 'None showing'],
    ['Below', w?.ebb?.walk ? (w.ebb.walk.below ? 'Yes, on foot' : 'No, above') : ''],
  ];
  $('now').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}
setInterval(readGame, 400);

// ---------------------------------------------------------------------------
// 60 seeds

async function buildGrid() {
  const from = Number.parseInt($('from').value, 10) >>> 0;
  const grid = $('grid');
  grid.innerHTML = '';
  $('build').disabled = true;
  let good = 0, done = 0;
  const outs = /** @type {number[]} */ ([]);
  for (let s = from; s < from + 60; s++) {
    const I = await buildIsle(s);
    const bad = problems(I);
    if (!bad.length) good++;
    outs.push(I.check.outM);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `seed${bad.length ? ' warn' : ''}`;
    b.title = `Seed ${s}: open it`;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const cx = (I.pad.x + I.moor.boat.x) / 2, cz = (I.pad.z + I.moor.boat.z) / 2;
    const P = drawGround(cv, I, cx, cz, 40);
    drawCamp(cv, I, P, 128 / 40, false);
    b.append(cv);
    const t = document.createElement('span');
    t.textContent = `${s}: ${bad.length ? bad[0] : `stake ${I.check.outM.toFixed(1)} m`}`;
    b.append(t);
    b.addEventListener('click', () => { seed = s; $('seed').value = String(s); showSeed(); openGame({ intro: '' }); });
    grid.append(b);
    done++;
    $('gridNote').textContent = `${done} of 60 built. ${good} of ${done} have the stake found and dry beach below the pad at the highest tide.`;
  }
  outs.sort((a, b) => a - b);
  $('gridNote').textContent = `${good} of 60 seeds have the stake found and dry beach below the pad at the highest tide. `
    + `The stake lies ${outs[0].toFixed(1)} to ${outs[59].toFixed(1)} m out from the pad's edge (middle ${outs[30].toFixed(1)} m). Click a seed to open it.`;
  $('build').disabled = false;
}
$('build').addEventListener('click', buildGrid);

openGame({ intro: params.get('beat') ?? '' });
await showSeed();
buildGrid();
