// @ts-check
// Determinism page: builds the island's open chunks (16 on the larger starter island, 9 on the
// older one) on the main thread, on 1 worker and on the full pool, compares landform hashes, and
// draws the island from above (docs/08).

import { hash32, subSeed } from '../src/core/rng.js';
import { initWorkers, run, dispose, defaultPoolSize } from '../src/core/workers.js';
import { CHUNK_CELLS, CHUNK_MIN, WORLD_CELLS, quantize, dequantize } from '../src/world/terrain/grid.js';
import { buildBase, hashBase, landmarks } from '../src/world/terrain/landform.js';
import { waterCellOf } from '../src/world/water/grid.js';
import { buildSummary, hashSummary, WATER_CLASS } from '../src/world/water/summary.js';
import { haulsJob } from '../src/world/nets/haul.js';
import { gatherCheckJob } from '../src/world/gather/check.js';
import { campCheckJob } from '../src/world/camp/check.js';
import { digCheckJob } from '../src/world/dig/check.js';
import { treatCheckJob } from '../src/world/creatures/treat-check.js';
import { runPlanting, showPlanting } from './determinism-planting.js';

const JOB = { module: './world/terrain/landform.js', fn: 'buildBase' };
/** The island's open chunks, row by row, from its land recipe (useChunks). */
let CHUNKS = /** @type {[number, number][]} */ ([]);
/** The first open chunk on each axis, and how many chunks the open land is across. */
let C0 = -1, SIDE = 3;
/** The open land's water cells (0.5 m): two terrain cells each. */
let WATER_RECT = { x: 64, y: 64, w: 192, h: 192 };

/** @param {any} land  its chunkMin and chunkMax, else today's 3 x 3 */
function useChunks(land) {
  C0 = land.chunkMin ?? -1;
  SIDE = (land.chunkMax ?? 1) - C0 + 1;
  CHUNKS = [];
  for (let cz = C0; cz < C0 + SIDE; cz++) for (let cx = C0; cx < C0 + SIDE; cx++) CHUNKS.push([cx, cz]);
  const w = SIDE * CHUNK_CELLS / 2;
  WATER_RECT = { x: (C0 - CHUNK_MIN) * CHUNK_CELLS / 2, y: (C0 - CHUNK_MIN) * CHUNK_CELLS / 2, w, h: w };
}

/**
 * @typedef {Object} RunResult
 * @property {string} name
 * @property {number[]} hashes  one per chunk, in CHUNKS order
 * @property {number} combined
 * @property {number} ms
 * @property {{heightQ: Uint16Array, material: Uint8Array}[]} bases
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {number} h */
const hex = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
/** @param {number[]} hashes */
const combine = (hashes) => hashes.reduce((h, c) => hash32(h, c), 0x5eed);

const CHECK = '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>';
const WARN = '<path d="M12 3.5L2.8 19.8h18.4z"/><path d="M12 9.5v4.8"/><path d="M12 17.2v.1"/>';
/** @param {boolean} ok */
function icon(ok) {
  const color = ok ? '#5F7F5B' : '#B5654A';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ok ? CHECK : WARN}</svg>`;
}

// ---------------------------------------------------------------------------
// The three runs

/** @param {any} land @param {number} seed @returns {Promise<RunResult>} */
async function runMain(land, seed) {
  const t0 = performance.now();
  const bases = CHUNKS.map(([cx, cz]) => buildBase({ land, seed, cx, cz }));
  const ms = performance.now() - t0;
  return finish('Main thread', bases, ms);
}

/**
 * Build on a pool of `size` workers. A warm-up job per worker loads the module first,
 * so the time shown is the build itself.
 * @param {any} land @param {number} seed @param {number} size @param {string} name
 * @returns {Promise<RunResult>}
 */
async function runPool(land, seed, size, name) {
  initWorkers({ size });
  try {
    await Promise.all(Array.from({ length: size }, () => run(JOB, { land, seed, cx: 3, cz: 3 })));
    const t0 = performance.now();
    const bases = await Promise.all(CHUNKS.map(([cx, cz]) => run(JOB, { land, seed, cx, cz })));
    const ms = performance.now() - t0;
    return finish(name, bases, ms);
  } finally {
    dispose();
  }
}

/** @param {string} name @param {{heightQ: Uint16Array, material: Uint8Array}[]} bases @param {number} ms */
function finish(name, bases, ms) {
  const hashes = bases.map((b) => hashBase(b.heightQ, b.material));
  return { name, hashes, combined: combine(hashes), ms, bases };
}

// ---------------------------------------------------------------------------
// Drawing

const COLORS = {
  grass: [127, 164, 99],
  sand: [220, 201, 160],
  rock: [154, 149, 140],
  soil: [140, 106, 72],
  shallow: [120, 186, 196],
  deep: [52, 112, 140],
};

/** Draw the open land cell by cell, shaded by slope, colored by material weights. @param {RunResult} r */
function drawMap(r) {
  const canvas = /** @type {HTMLCanvasElement} */ ($('map'));
  const N = CHUNK_CELLS * SIDE;
  canvas.width = N; canvas.height = N;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const img = ctx.createImageData(N, N);
  const H = new Float32Array(N * N);
  const M = new Uint8Array(N * N * 4);
  r.bases.forEach((b, k) => {
    const [cx, cz] = CHUNKS[k];
    for (let j = 0; j < CHUNK_CELLS; j++) for (let i = 0; i < CHUNK_CELLS; i++) {
      const g = ((cz - C0) * CHUNK_CELLS + j) * N + (cx - C0) * CHUNK_CELLS + i;
      const c = j * CHUNK_CELLS + i;
      H[g] = dequantize(b.heightQ[c]);
      for (let m = 0; m < 4; m++) M[g * 4 + m] = b.material[c * 4 + m];
    }
  });
  let peak = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = H[k];
    peak = Math.max(peak, h);
    const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)];
    const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i];
    // Light from the upper left: shade = n . l, with n from the height gradient (cells 0.25 m).
    const nx = -hx / 0.5, nz = -hz / 0.5, len = Math.sqrt(nx * nx + nz * nz + 1);
    const shade = Math.max(0.35, (nx * -0.55 + nz * -0.55 + 0.63) / len / 0.63);
    let col;
    if (h < 0) {
      const t = Math.min(1, -h / 3);
      col = COLORS.shallow.map((v, c) => v + (COLORS.deep[c] - v) * t);
    } else {
      const w = [M[k * 4], M[k * 4 + 1], M[k * 4 + 2], M[k * 4 + 3]];
      col = [0, 1, 2].map((c) => (w[0] * COLORS.grass[c] + w[1] * COLORS.sand[c] + w[2] * COLORS.rock[c] + w[3] * COLORS.soil[c]) / 255 * shade);
      const near = Math.abs(h - Math.round(h));
      if (Math.round(h) > 0 && near < 0.03) col = col.map((v) => v * 0.8);
    }
    img.data[k * 4] = col[0]; img.data[k * 4 + 1] = col[1]; img.data[k * 4 + 2] = col[2]; img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  $('mapNote').textContent = `${SIDE * 32} m across, the ${SIDE} by ${SIDE} open chunks. Highest point ${peak.toFixed(1)} m above sea level. Thin lines mark every meter of height.`;
}

// ---------------------------------------------------------------------------
// Results

/** @param {RunResult[]} runs */
function showResults(runs) {
  const ref = runs[0];
  $('runs').innerHTML = runs.map((r) => `<div class="run"><span class="name">${r.name}</span>` +
    `<b class="${r.combined === ref.combined ? 'ok' : 'bad'}">${hex(r.combined)}</b>` +
    `<span>${r.ms.toFixed(1)} ms for ${CHUNKS.length} chunks</span></div>`).join('');

  /** @param {string} label @param {number[]} hs @param {string} [cls] */
  const row = (label, hs, cls = '') => {
    const ok = hs.every((h) => h === hs[0]);
    return `<div class="row ${cls}"><span class="label">${label}</span>` +
      hs.map((h, k) => `<span class="hash">${hex(h)}<small>${runs[k].name}</small></span>`).join('') +
      `<span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  let html = row(`All ${CHUNKS.length} chunks`, runs.map((r) => r.combined), 'total');
  CHUNKS.forEach(([cx, cz], k) => { html += row(`Chunk ${cx}, ${cz}`, runs.map((r) => r.hashes[k])); });
  $('chunks').innerHTML = html;

  const allOk = runs.every((r) => r.combined === ref.combined && r.hashes.every((h, k) => h === ref.hashes[k]));
  $('verdict').className = allOk ? 'ok' : 'bad';
  $('verdict').innerHTML = `${icon(allOk)}<span>${allOk ? 'All three runs match' : 'The runs differ'}</span>`;
  $('detail').textContent = allOk
    ? 'Same seed, same island, on every thread. This combined hash should also match on another computer.'
    : 'Some chunks came out different. Something in the landform is not deterministic.';
}

// ---------------------------------------------------------------------------
// Water summary: the same island's water, on the main thread and on a worker

const WATER_JOB = { module: './world/water/summary.js', fn: 'buildSummary' };
/** @type {Record<number, number[]>} */
const CLASS_COLORS = {
  [WATER_CLASS.sea]: [62, 127, 154],
  [WATER_CLASS.still]: [92, 160, 178],
  [WATER_CLASS.slow]: [126, 196, 206],
  [WATER_CLASS.running]: [236, 244, 240],
  [WATER_CLASS.damp]: [140, 106, 72],
};

/** The 768 x 768 heightQ: the open chunks in place, open seabed everywhere else. @param {any} land @param {RunResult} r */
function worldHeights(land, r) {
  const T = WORLD_CELLS;
  const heightQ = new Uint16Array(T * T).fill(quantize(land.seabedDepth));
  r.bases.forEach((b, k) => {
    const [cx, cz] = CHUNKS[k];
    const x0 = (cx - CHUNK_MIN) * CHUNK_CELLS, y0 = (cz - CHUNK_MIN) * CHUNK_CELLS;
    for (let j = 0; j < CHUNK_CELLS; j++) heightQ.set(b.heightQ.subarray(j * CHUNK_CELLS, (j + 1) * CHUNK_CELLS), (y0 + j) * T + x0);
  });
  return heightQ;
}

/** @param {any} land @param {number} seed @param {RunResult} r */
async function runWater(land, seed, r) {
  const water = await (await fetch('../recipes/world/water.json')).json();
  const sp = landmarks(land, seed).spring;
  const springs = sp ? [{ cellX: waterCellOf(sp.x), cellY: waterCellOf(sp.z), rateLps: sp.rateLps ?? 12 }] : [];
  const args = { heightQ: worldHeights(land, r), rect: WATER_RECT, springs, params: water.summary, tide: water.tide };
  const main = buildSummary(args);
  initWorkers({ size: 1 });
  let worker, workerMs = 0;
  try {
    await run(WATER_JOB, args); // warm-up: loads the module in the worker
    const t0 = performance.now();
    worker = await run(WATER_JOB, args);
    workerMs = performance.now() - t0;
  } finally {
    dispose();
  }
  return { main, worker, workerMs, rehash: hashSummary(worker) };
}

/** @param {Awaited<ReturnType<typeof runWater>>} w */
function showWater(w) {
  let card = document.getElementById('waterCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'waterCard';
    /** @type {HTMLElement} */ ($('chunks').closest('.card')).after(card);
  }
  const { main, worker } = w;
  const ok = main.hash === worker.hash && w.rehash === main.hash;
  const legend = [
    ['#3E7F9A', 'Sea'], ['#5CA0B2', 'Pond (still water)'], ['#7EC4CE', 'Slow stream'], ['#ECF4F0', 'Running stream'],
    ['#8C6A48', 'Damp hollow'], ['#DCC9A0', 'Dry ground in the tide band'], ['#7FA463', 'Dry ground'],
  ].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  card.innerHTML = '<h2>Water summary</h2>' +
    `<div class="row total"><span class="label">Water, ${SIDE * 32} m</span>` +
    `<span class="hash">${hex(main.hash)}<small>Main thread, ${(main.stats.ms ?? 0).toFixed(1)} ms</small></span>` +
    `<span class="hash">${hex(worker.hash)}<small>1 worker, ${w.workerMs.toFixed(1)} ms</small></span>` +
    `<span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>` +
    `<p class="muted">${main.stats.ponds} ${main.stats.ponds === 1 ? 'pond' : 'ponds'}, ${main.stats.streamCells} stream cells of half a meter. ` +
    'The worker time includes sending the heights across.</p>' +
    `<div class="map-wrap" style="margin-top:12px"><canvas id="waterMap" width="${WATER_RECT.w}" height="${WATER_RECT.h}" ` +
    'style="width:100%;max-width:480px;aspect-ratio:1;display:block;border-radius:12px;image-rendering:pixelated" ' +
    `aria-label="Map of water classes on the starter island"></canvas><div class="legend">${legend}</div></div>`;

  const canvas = /** @type {HTMLCanvasElement} */ ($('waterMap'));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const N = WATER_RECT.w;
  const img = ctx.createImageData(N, N);
  for (let k = 0; k < N * N; k++) {
    const c = main.cls[k];
    const col = CLASS_COLORS[c] ?? (main.band[k] ? [220, 201, 160] : [127, 164, 99]);
    img.data.set([col[0], col[1], col[2], 255], k * 4);
  }
  ctx.putImageData(img, 0, 0);
}

const HAULS_JOB = { module: './world/nets/haul.js', fn: 'haulsJob' };

/**
 * The nets (docs/future/12): 200 hauls of one net, rolled on the page and in a worker. A haul is
 * rolled only when a net is lifted, so these must agree for time away to give the same catch.
 * @param {number} worldSeed
 */
async function runHauls(worldSeed) {
  const [NR, K] = await Promise.all([fetch('../recipes/world/nets.json').then((r) => r.json()), fetch('../recipes/world/keepsakes.json').then((r) => r.json())]);
  const args = { seed: subSeed(worldSeed, 'nets'), tides: 200, NR, K };
  const main = haulsJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(HAULS_JOB, args); } finally { dispose(); }
  return { main, worker };
}

/** @param {Awaited<ReturnType<typeof runHauls>>} h */
function showHauls(h) {
  let card = document.getElementById('haulCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'haulCard';
    /** @type {HTMLElement} */ (document.getElementById('waterCard') ?? $('chunks').closest('.card')).after(card);
  }
  const ok = h.main.hash === h.worker.hash;
  card.innerHTML = '<h2>Net hauls</h2>' +
    `<div class="row total"><span class="label">200 tides</span>` +
    `<span class="hash">${hex(h.main.hash)}<small>Main thread</small></span>` +
    `<span class="hash">${hex(h.worker.hash)}<small>1 worker</small></span>` +
    `<span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>` +
    `<p class="muted">${h.main.living} living catches and ${h.main.keepsakes} keepsakes over 200 hauls of one net, at every depth, tide and season.</p>`;
}

const GATHER_JOB = { module: './world/gather/check.js', fn: 'gatherCheckJob' };

/**
 * The pack and gathering (docs/future/13 section 4.5): a year of what lies on the ground, picked
 * spots kept and dropped, seeded adds and takes in the pack, and three reeds picked for their down
 * then three game days of hours, twice. On the page and in a worker.
 * @param {number} worldSeed
 */
async function runGather(worldSeed) {
  const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
  const growth = await get('world/growth');
  const flora = Object.fromEntries(await Promise.all(growth.species.map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
  const covers = Object.fromEntries(await Promise.all((growth.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
  const args = { worldSeed, gather: await get('world/gather'), pack: await get('world/pack'), seasons: await get('world/seasons'), growth, flora, covers };
  const main = gatherCheckJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(GATHER_JOB, args); } finally { dispose(); }
  return { main, worker };
}

/** @param {Awaited<ReturnType<typeof runGather>>} g */
function showGather(g) {
  let card = document.getElementById('gatherCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'gatherCard';
    /** @type {HTMLElement} */ (document.getElementById('haulCard') ?? document.getElementById('waterCard') ?? $('chunks').closest('.card')).after(card);
  }
  const { main, worker } = g;
  /** @param {string} label @param {number} a @param {number} b @param {string} [an] @param {string} [bn] */
  const row = (label, a, b, an = 'Main thread', bn = '1 worker') => {
    const ok = a === b;
    return `<div class="row total"><span class="label">${label}</span><span class="hash">${hex(a)}<small>${an}</small></span>` +
      `<span class="hash">${hex(b)}<small>${bn}</small></span><span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  card.innerHTML = '<h2>The pack and gathering</h2>' +
    row('A year of spots', main.shares, worker.shares) +
    row('Picked spots', main.events, worker.events) +
    row('The pack', main.pack, worker.pack) +
    row('Picked and buried reeds, 3 days', main.regrowth, worker.regrowth) +
    row('The same, run again', main.regrowth, main.regrowthAgain, 'First run', 'Second run') +
    `<p class="muted">${main.handfuls} handfuls lay on 480 spots over the year; ${main.picked} picked spots are still remembered at its end. ` +
    `Three reeds were picked, then a raise buried two and its undo brought one back; the ${main.sizes.length} still standing grew back to ${main.sizes.map((s) => s.toFixed(3)).join(', ')} of their size in three days.</p>`;
}

const CAMP_JOB = { module: './world/camp/check.js', fn: 'campCheckJob' };

/**
 * The camp's fire (docs/future/13 CP-11): a seeded month of lighting, feeding and banking, watched
 * hour by hour and read only from its saved numbers after the fact, on the page and in a worker.
 * @param {number} worldSeed
 */
async function runCamp(worldSeed) {
  const args = { worldSeed, camp: await fetch('../recipes/world/camp.json').then((r) => r.json()), pack: await fetch('../recipes/world/pack.json').then((r) => r.json()) };
  const main = campCheckJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(CAMP_JOB, args); } finally { dispose(); }
  return { main, worker };
}

/** @param {Awaited<ReturnType<typeof runCamp>>} g */
function showCamp(g) {
  let card = document.getElementById('campCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'campCard';
    /** @type {HTMLElement} */ (document.getElementById('gatherCard') ?? $('chunks').closest('.card')).after(card);
  }
  const { main, worker } = g;
  /** @param {string} label @param {number} a @param {number} b @param {string} [an] @param {string} [bn] */
  const row = (label, a, b, an = 'Main thread', bn = '1 worker') => {
    const ok = a === b;
    return `<div class="row total"><span class="label">${label}</span><span class="hash">${hex(a)}<small>${an}</small></span>` +
      `<span class="hash">${hex(b)}<small>${bn}</small></span><span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  card.innerHTML = '<h2>The camp fire</h2>' +
    row('A month, hour by hour', main.timeline, worker.timeline) +
    row('Watched against read later', main.timeline, main.read, 'Each hourly tick', 'From the save') +
    row('The fire at the end', main.ticked, worker.ticked) +
    `<p class="muted">Lit with the steel ${main.lightings} times over ${main.hours / 24} game days, burning on ${main.litDays} of them.</p>` +
    // The keeps (S2, P2j): the drying rack and the hamper.
    row('The rack drying, hour by hour', main.rack ?? 0, worker.rack ?? 0) +
    row('Rack watched against read later', main.rack ?? 0, main.rackRead ?? 0, 'Each hour', 'From the save') +
    row('The hamper at the end', main.hamper ?? 0, worker.hamper ?? 0) +
    `<p class="muted">${main.bunches ?? 0} bunches on the rack and ${main.kinds ?? 0} hamper slots in use at the month's end.</p>` +
    // Fire products (P2i): the mornings with charcoal and ash, and willow charcoal's done hours.
    row('Charcoal mornings, a month', main.nights ?? 0, worker.nights ?? 0) +
    row('Charcoal mornings, watched against catch-up', main.nights ?? 0, main.nightsRead ?? 0, 'Each hourly tick', 'No ticks between') +
    row('Willow charcoal done, watched against catch-up', main.work ?? 0, main.workRead ?? 0, 'Each hourly tick', 'No ticks between') +
    `<p class="muted">${main.fireNights ?? 0} mornings left charcoal and ash; ${main.workDone ?? 0} pouches of charcoal sticks were done by morning.</p>` +
    // Clay firing and the star fire (S4, S5): each piece's done hour, where they stand at the end, the logs burnt.
    row('Clay fired, a month', main.clay ?? 0, worker.clay ?? 0) +
    row('Clay fired, watched against catch-up', main.clay ?? 0, main.clayRead ?? 0, 'Each hourly tick', 'No ticks between') +
    row('The pots in their places at the end', main.clayEnd ?? 0, main.clayEndRead ?? 0, 'Each hourly tick', 'No ticks between') +
    row('The star fire burning down', main.star ?? 0, main.starRead ?? 0, 'Each hourly tick', 'No ticks between') +
    `<p class="muted">${main.clayDone ?? 0} clay pieces fired: the cooking pot, the tea pot, the cup and a bowl.</p>`;
}

const DIG_JOB = { module: './world/dig/check.js', fn: 'digCheckJob' };

/**
 * Digging (docs/future/13 10.10.8, P2c): a season of ten digs a day, saved and read back, and every
 * hole's stage three game days later, run twice, on the page and in a worker. @param {number} worldSeed
 */
async function runDig(worldSeed) {
  const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
  const args = { worldSeed, dig: await get('world/dig'), keepsakes: await get('world/keepsakes') };
  const main = digCheckJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(DIG_JOB, args); } finally { dispose(); }
  return { main, worker };
}

/** @param {Awaited<ReturnType<typeof runDig>>} g */
function showDig(g) {
  let card = document.getElementById('digCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'digCard';
    /** @type {HTMLElement} */ (document.getElementById('campCard') ?? document.getElementById('gatherCard') ?? $('chunks').closest('.card')).after(card);
  }
  const { main, worker } = g;
  /** @param {string} label @param {number} a @param {number} b @param {string} [an] @param {string} [bn] */
  const row = (label, a, b, an = 'Main thread', bn = '1 worker') => {
    const ok = a === b;
    return `<div class="row total"><span class="label">${label}</span><span class="hash">${hex(a)}<small>${an}</small></span>` +
      `<span class="hash">${hex(b)}<small>${bn}</small></span><span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  card.innerHTML = '<h2>Digging</h2>' +
    row('What each dig gave', main.finds, worker.finds) +
    row('Dug events, saved and read back', main.events, worker.events) +
    row('Holes three days on', main.holes, worker.holes) +
    row('The same season, run again', main.first, main.again, 'First run', 'Second run') +
    `<p class="muted">Over 14 game days of ten digs a day: ${main.worms} worms, ${main.clay} handfuls of clay and ${main.keepsakes} keepsakes (the island's budget holds them to about one a day).</p>`;
}

const TREAT_JOB = { module: './world/creatures/treat-check.js', fn: 'treatCheckJob' };

/**
 * Trust with treats (P2h): a seeded month of watching, meals and treats for three frogs and a
 * school, applied hour by hour and all at once, and treats set out and fading, on the page and in a
 * worker. @param {number} worldSeed
 */
async function runTreats(worldSeed) {
  const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
  const args = { worldSeed, frog: await get('species/frog'), minnow: await get('species/minnow'), turtle: await get('species/turtle'), treats: await get('world/treats') };
  const main = treatCheckJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(TREAT_JOB, args); } finally { dispose(); }
  return { main, worker };
}

/** @param {Awaited<ReturnType<typeof runTreats>>} g */
function showTreats(g) {
  let card = document.getElementById('treatCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'treatCard';
    /** @type {HTMLElement} */ (document.getElementById('digCard') ?? document.getElementById('campCard') ?? $('chunks').closest('.card')).after(card);
  }
  const { main, worker } = g;
  /** @param {string} label @param {number} a @param {number} b @param {string} [an] @param {string} [bn] */
  const row = (label, a, b, an = 'Main thread', bn = '1 worker') => {
    const ok = a === b;
    return `<div class="row total"><span class="label">${label}</span><span class="hash">${hex(a)}<small>${an}</small></span>` +
      `<span class="hash">${hex(b)}<small>${bn}</small></span><span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  card.innerHTML = '<h2>Trust with treats</h2>' +
    row('A month of trust, hour by hour', main.timeline, worker.timeline) +
    row('Frogs: each hour against one late tick', main.frogsEach, main.once, 'Each hourly tick', 'All at once') +
    row('Trust at the month\'s end', main.each, worker.each) +
    row('Treats lying and fading, watched against read later', main.watched, main.read, 'Each hour', 'From the save') +
    row('Turtles: the group and each one\'s own trust, hour by hour', main.turtles, worker.turtles) +
    `<p class="muted">After 30 game days the frogs know you ${main.trust.map((/** @type {number} */ t) => t.toFixed(3)).join(', ')} and the school ${main.school.toFixed(3)}; ${main.set} treats were set out.</p>`;
}

async function build() {
  const button = /** @type {HTMLButtonElement} */ ($('go'));
  const input = /** @type {HTMLInputElement} */ ($('seed'));
  button.disabled = true;
  const worldSeed = Math.floor(Math.abs(Number(input.value) || 0)) >>> 0;
  input.value = String(worldSeed);
  $('verdict').className = '';
  $('verdict').textContent = 'Building';
  $('detail').textContent = '';
  try {
    // The land a new starter island grows from; `?island=starter-island` checks the older island's
    // land, `?island=two-ponds` another (recipes/land/<id>.json).
    const islandId = (new URLSearchParams(location.search).get('island') ?? 'starter-island-2').replace(/[^a-z0-9-]/g, '');
    const land = await (await fetch(`../recipes/land/${islandId}.json`)).json();
    useChunks(land);
    const seed = subSeed(worldSeed, 'terrain');
    const pool = defaultPoolSize();
    const runs = [
      await runMain(land, seed),
      await runPool(land, seed, 1, '1 worker'),
      await runPool(land, seed, pool, `${pool} workers`),
    ];
    showResults(runs);
    drawMap(runs[0]);
    try {
      showWater(await runWater(land, seed, runs[0]));
    } catch (e) {
      console.error('[determinism] water summary', e);
      $('detail').textContent += ` The water summary failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      showHauls(await runHauls(worldSeed));
    } catch (e) {
      console.error('[determinism] net hauls', e);
      $('detail').textContent += ` The net hauls failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      showGather(await runGather(worldSeed));
    } catch (e) {
      console.error('[determinism] pack and gathering', e);
      $('detail').textContent += ` The pack and gathering check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      showCamp(await runCamp(worldSeed));
    } catch (e) {
      console.error('[determinism] camp fire', e);
      $('detail').textContent += ` The camp fire check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      showDig(await runDig(worldSeed));
    } catch (e) {
      console.error('[determinism] digging', e);
      $('detail').textContent += ` The digging check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      showTreats(await runTreats(worldSeed));
    } catch (e) {
      console.error('[determinism] trust with treats', e);
      $('detail').textContent += ` The trust with treats check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      showPlanting(await runPlanting(worldSeed), /** @type {HTMLElement} */ (document.getElementById('treatCard') ?? $('chunks').closest('.card')), hex, icon);
    } catch (e) {
      console.error('[determinism] planting', e);
      $('detail').textContent += ` The planting check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  } catch (e) {
    console.error('[determinism]', e);
    $('verdict').className = 'bad';
    $('verdict').innerHTML = `${icon(false)}<span>Could not build the island</span>`;
    $('detail').textContent = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } finally {
    button.disabled = false;
  }
}

$('go').addEventListener('click', build);
$('seed').addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') build(); });
build();
