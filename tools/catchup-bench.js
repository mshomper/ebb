// @ts-check
// Catch-up bench (docs 02, 18): time away must give the same island as time watched, in pieces or
// at once, in a worker or on the page, and through a save and load. Also times 7 game days (the cap) hour by
// hour against the laptop budget (doc 19). Runs on Matt's machine; nothing here touches the game's save.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { hourStep } from '../src/sim/hour.js';
import { catchUp, CAP_HOURS } from '../src/sim/catchup.js';
import { journalLook } from '../src/world/journal/look.js';
import { initialJournal } from '../src/world/journal/observe.js';
import { plantSeed } from '../src/world/growth/coarse.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { snapshot, restore } from '../src/save/sections.js';
import { encode, decode } from '../src/save/world-file.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

/** Spring day 7: after the frogs' winter sleep (they wake 0.3 into spring, day 5 of 14). */
const START_DAY = 6;
const WATCHED_HOURS = 48, FIRST_PIECE = 100, LONG = CAP_HOURS;
const BUDGET_MS = 25;
const GREEN = '#5F7F5B', RUST = '#B5654A';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {number} h */
const hex = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
const pause = () => new Promise((ok) => setTimeout(ok, 0));
/** @param {string} text */
const progress = (text) => { $('detail').textContent = text; };

const CHECK = '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>';
const WARN = '<path d="M12 3.5L2.8 19.8h18.4z"/><path d="M12 9.5v4.8"/><path d="M12 17.2v.1"/>';
/** @param {boolean} ok */
function icon(ok) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${ok ? GREEN : RUST}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ok ? CHECK : WARN}</svg>`;
}

// catchUp quietly runs on the page if a worker fails; notice that, so "worker or page" stays honest.
let workerFailed = false;
const warn = console.warn.bind(console);
console.warn = (...a) => { if (String(a[0]).startsWith('catch-up in a worker failed')) workerFailed = true; warn(...a); };

/** @type {Promise<{ words: any, island: any, web: any }> | null} */ let jrLoad = null;
function journalRecipes() {
  /** @param {string} p */
  const get = async (p) => {
    const r = await fetch(`../recipes/world/${p}.json`);
    if (!r.ok) throw new Error(`recipes/world/${p}.json: HTTP ${r.status}`);
    return r.json();
  };
  jrLoad ??= Promise.all(['journal', 'journal-island', 'journal-web'].map(get)).then(([words, island, web]) => ({ words, island, web }));
  return jrLoad;
}

/**
 * The scripted edit: reeds on the first 4 damp, dry-footed cells by fresh water, row by row.
 * @param {any} state @param {any} env @returns {{ state: any, planted: number }}
 */
function plantReeds(state, env) {
  const hab = env.habitat();
  let planted = 0, tried = 0;
  for (let k = 0; k < hab.n * hab.n && tried < 4; k++) {
    if (hab.moisture[k] <= 200 || hab.depthCm[k] !== 0 || hab.sea[k]) continue;
    tried++;
    const x = HABITAT_ORIGIN + (k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5;
    const r = plantSeed(state, 'reeds', x, z, env);
    if (r.ok) { state = r.state; planted++; }
  }
  return { state, planted };
}

/**
 * A save and load, as the game does it: snapshot, encode to .ebb bytes, decode, restore.
 * @param {any} world @param {any} journal @param {number} hour @param {string} island @param {number} seed
 */
async function saveAndLoad(world, journal, hour, island, seed) {
  const { header, sections } = snapshot({
    build: 'catchup-bench', seed, island, worldT: hour * 3600, flow: /** @type {1} */ (1),
    world, journal, water: { springs: [], version: 1 }, unlocks: {}, view: null, looks: {},
    chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0,
  });
  const bytes = await encode(header, sections);
  const d = await decode(bytes);
  const r = restore(d.sections);
  return { world: r.world, journal: r.journal, size: bytes.length, fileOk: d.fileOk && d.bad.length === 0 };
}

/**
 * @typedef {{ what: string, a: number, b: number, aName: string, bName: string }} Pair
 * @typedef {{ name: string, pairs: Pair[], note?: string, fail?: boolean }} Check
 */
/** @param {Check} c */
const passes = (c) => !c.fail && c.pairs.every((p) => p.a === p.b);

/** @param {Check[]} checks */
function showChecks(checks) {
  $('checks').innerHTML = checks.map((c) => {
    const ok = passes(c);
    const cells = c.pairs.map((p) => `<span class="hash">${hex(p.a)}<small>${p.what}, ${p.aName}</small></span>` +
      `<span class="hash ${p.a === p.b ? '' : 'bad'}">${hex(p.b)}<small>${p.what}, ${p.bName}</small></span>`).join('');
    return `<div class="check"><div class="head"><span class="label">${c.name}</span>` +
      `<span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'matching' : 'not matching'}</span></div>` +
      `<div class="pairs">${cells}</div>${c.note ? `<p class="muted note">${c.note}</p>` : ''}</div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// The timing chart

/** @type {number[]} */ let hourMs = [];

function drawChart() {
  const canvas = /** @type {HTMLCanvasElement} */ ($('chart'));
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!hourMs.length) return;
  const left = 46, right = 8, top = 12, bottom = 30;
  const w = cssW - left - right, h = cssH - top - bottom;
  const peak = Math.max(BUDGET_MS * 1.5, ...hourMs) * 1.08;
  const y = (/** @type {number} */ ms) => top + h - (ms / peak) * h;
  const step = peak > 60 ? 20 : peak > 24 ? 8 : 4;
  ctx.font = '600 16px Nunito, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.strokeStyle = 'rgba(30, 38, 36, 0.12)';
  ctx.fillStyle = '#4A5551';
  ctx.lineWidth = 1;
  for (let v = 0; v <= peak; v += step) {
    ctx.beginPath(); ctx.moveTo(left, Math.round(y(v)) + 0.5); ctx.lineTo(left + w, Math.round(y(v)) + 0.5); ctx.stroke();
    ctx.fillText(String(v), left - 8, y(v));
  }
  const bw = w / hourMs.length;
  hourMs.forEach((ms, i) => {
    ctx.fillStyle = ms > BUDGET_MS ? RUST : GREEN;
    const top2 = y(ms);
    ctx.fillRect(left + i * bw, top2, Math.max(bw * 0.8, 0.6), top + h - top2);
  });
  ctx.strokeStyle = 'rgba(181, 101, 74, 0.6)';
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(left, Math.round(y(BUDGET_MS)) + 0.5); ctx.lineTo(left + w, Math.round(y(BUDGET_MS)) + 0.5); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = RUST;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`laptop budget ${BUDGET_MS} ms`, left + w, y(BUDGET_MS) - 3);
  ctx.fillStyle = '#4A5551';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('ms per game hour', left, cssH - bottom + 6);
  ctx.textAlign = 'right';
  ctx.fillText(`${hourMs.length} hours`, left + w, cssH - bottom + 6);
}
window.addEventListener('resize', drawChart);

/** @param {{ label: string, value: string }[]} items */
function showStats(items) {
  $('stats').innerHTML = items.map((s) => `<div><b>${s.value}</b><span>${s.label}</span></div>`).join('');
}

// ---------------------------------------------------------------------------
// The run

async function runChecks() {
  const button = /** @type {HTMLButtonElement} */ ($('go'));
  const seedInput = /** @type {HTMLInputElement} */ ($('seed'));
  const island = /** @type {HTMLSelectElement} */ ($('island')).value;
  const seed = Math.floor(Math.abs(Number(seedInput.value) || 0)) >>> 0;
  seedInput.value = String(seed);
  button.disabled = true;
  $('verdict').className = '';
  $('verdict').textContent = 'Running';
  progress('Loading the recipes and building the island');
  workerFailed = false;
  try {
    const [R, jr] = await Promise.all([loadEcologyRecipes(), journalRecipes()]);
    await pause();
    const w = islandWorld(R, island, seed, START_DAY);
    const habitat = w.model.habitat, material = w.model.material;
    const edit = plantReeds(w.state, w.env);
    const from = w.h0 + 1;
    const base = { seed, recipes: w.env.recipes, habitat, material, jr, state: edit.state, journal: initialJournal(w.h0), fromHour: from };
    /** @param {string} what */
    const onProgress = (what) => (/** @type {number} */ done, /** @type {number} */ of) => progress(`${what}: hour ${done} of ${of}`);

    // A: watched, hour by hour as live play runs it, against away.
    let state = base.state, journal = base.journal;
    for (let h = from; h < from + WATCHED_HOURS; h++) {
      const t = runHour(state, h, w.env);
      journal = journalLook(journal, { state: t.state, events: t.events, hour: h, habitat, material, ...jr }).journal;
      state = t.state;
      if ((h - from) % 12 === 11) { progress(`Watched: hour ${h - from + 1} of ${WATCHED_HOURS}`); await pause(); }
    }
    const away48 = await catchUp({ ...base, hours: WATCHED_HOURS, worker: true, onProgress: onProgress('Away') });

    // C: a worker against the page, 7 game days.
    const t0 = performance.now();
    const inWorker = await catchUp({ ...base, hours: LONG, worker: true, onProgress: onProgress('In a worker') });
    const workerS = (performance.now() - t0) / 1000;
    const workerRan = !workerFailed;
    const onPage = await catchUp({ ...base, hours: LONG, worker: false, onProgress: onProgress('On the page') });

    // B: 100 hours, a save and load, then the rest, against all 168 at once (the worker run above).
    const first = await catchUp({ ...base, hours: FIRST_PIECE, worker: true, onProgress: onProgress('First piece') });
    progress('Saving and loading between the pieces');
    const mid = await saveAndLoad(first.state, first.journal, from + FIRST_PIECE - 1, island, seed);
    const rest = await catchUp({ ...base, state: mid.world, journal: mid.journal, fromHour: from + FIRST_PIECE,
      hours: LONG - FIRST_PIECE, worker: true, onProgress: onProgress('Second piece') });

    // D: the 7-day island through a save and load.
    progress('Saving and loading the 7-day island');
    const loaded = await saveAndLoad(inWorker.state, inWorker.journal, from + LONG - 1, island, seed);

    /** @type {Check[]} */
    const checks = [
      { name: `Watched or away, ${WATCHED_HOURS} game hours`, pairs: [
        { what: 'World', a: hashWorldState(state), b: hashWorldState(away48.state), aName: 'watched', bName: 'away' },
        { what: 'Journal', a: hashWorldState(journal), b: hashWorldState(away48.journal), aName: 'watched', bName: 'away' }] },
      { name: `In pieces or at once, ${LONG} hours`, note: `${FIRST_PIECE} hours, a save and load, then ${LONG - FIRST_PIECE} more${mid.fileOk ? '' : ', but the save did not read back whole'}.`, pairs: [
        { what: 'World', a: hashWorldState(rest.state), b: hashWorldState(inWorker.state), aName: 'in pieces', bName: 'at once' },
        { what: 'Journal', a: hashWorldState(rest.journal), b: hashWorldState(inWorker.journal), aName: 'in pieces', bName: 'at once' }],
        fail: !mid.fileOk },
      { name: `Worker or page, ${LONG} hours`, pairs: [
        { what: 'World', a: hashWorldState(inWorker.state), b: hashWorldState(onPage.state), aName: 'worker', bName: 'page' }],
        fail: !workerRan, note: workerRan ? '' : 'The worker did not start, so both runs were on the page. Open the page through the local server.' },
      { name: 'Save and load', note: `Saved size ${(loaded.size / 1024).toFixed(0)} KB${loaded.fileOk ? '' : ', and the file did not read back whole'}.`, pairs: [
        { what: 'World', a: hashWorldState(inWorker.state), b: hashWorldState(loaded.world), aName: 'before', bName: 'after' },
        { what: 'Journal', a: hashWorldState(inWorker.journal), b: hashWorldState(loaded.journal), aName: 'before', bName: 'after' }],
        fail: !loaded.fileOk },
    ];
    showChecks(checks);
    const bad = checks.filter((c) => !passes(c)).length;
    $('verdict').className = bad ? 'bad' : 'ok';
    $('verdict').innerHTML = `${icon(!bad)}<span>${bad ? `${bad} ${bad === 1 ? 'check does' : 'checks do'} not match` : 'Every check matches'}</span>`;

    // Timing: 7 game days one hour at a time on the page, each hour timed.
    const jc = { material, ...jr };
    let s = base.state, j = base.journal, notes = 0;
    hourMs = [];
    for (let h = from; h < from + LONG; h++) {
      const a = performance.now();
      const r = hourStep(s, j, h, w.env, jc);
      hourMs.push(performance.now() - a);
      s = r.state; j = r.journal; notes += r.notes.length;
      if ((h - from) % 24 === 23) { progress(`Timing: hour ${h - from + 1} of ${LONG}`); await pause(); }
    }
    const sorted = hourMs.slice().sort((p, q) => p - q);
    const median = (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
    const total = hourMs.reduce((p, q) => p + q, 0);
    showStats([
      { value: `${(total / 1000).toFixed(2)} s`, label: `for ${LONG} hours on the page` },
      { value: `${median.toFixed(2)} ms`, label: 'median per hour' },
      { value: `${sorted[sorted.length - 1].toFixed(1)} ms`, label: 'slowest hour' },
      { value: String(notes), label: 'journal notes written' },
      { value: `${workerS.toFixed(2)} s`, label: workerRan ? `in a worker, the same ${LONG} hours` : 'the worker did not start, so this ran on the page' },
    ]);
    drawChart();
    const over = hourMs.filter((ms) => ms > BUDGET_MS).length;
    progress(`${R.terrain.islands.list.find((/** @type {any} */ i) => i.id === island)?.name ?? island}, seed ${seed}. ` +
      `${edit.planted} of 4 reed seeds took. ${over ? `${over} of ${LONG} hours went over the ${BUDGET_MS} ms laptop budget.` : `Every hour stayed under the ${BUDGET_MS} ms laptop budget.`}`);
  } catch (e) {
    console.error('[catchup-bench]', e);
    $('verdict').className = 'bad';
    $('verdict').innerHTML = `${icon(false)}<span>The checks could not finish</span>`;
    $('detail').textContent = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } finally {
    button.disabled = false;
  }
}

$('go').addEventListener('click', runChecks);
$('seed').addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') runChecks(); });
runChecks();
