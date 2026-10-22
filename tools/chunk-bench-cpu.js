// @ts-check
// The CPU half of the chunk bench (tools/chunk-bench.html), with no GPU: on each island, one
// game hour broken down by tick step (src/sim/tick.js COARSE_ORDER) and the journal's look
// (src/sim/hour.js), the water summary rebuild, one 24-hour catch-up block, and the save's `world`
// section, raw and gzipped. Each island is built from its own land recipe (its chunk range and
// center) as the game builds a new one (src/world/island-model.js through tools/ecology-world.js),
// on spring day 7 as the catch-up bench does.

import { COARSE_ORDER } from '../src/sim/tick.js';
import { catchUp } from '../src/sim/catchup.js';
import { journalLook } from '../src/world/journal/look.js';
import { initialJournal } from '../src/world/journal/observe.js';
import { buildSummary } from '../src/world/water/summary.js';
import { rectForBounds, waterCellOf } from '../src/world/water/grid.js';
import { landmarks } from '../src/world/terrain/landform.js';
import { CHUNK_CELLS, CHUNK_SIZE } from '../src/world/terrain/grid.js';
import { subSeed } from '../src/core/rng.js';
import { snapshot } from '../src/save/sections.js';
import { encode, packValue } from '../src/save/world-file.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

/** Spring day 7, after the frogs' winter sleep (as tools/catchup-bench.js). */
const START_DAY = 6;
const HOURS = 24;
const pause = () => new Promise((ok) => setTimeout(ok, 0));

/** @type {Promise<{ words: any, island: any, web: any }> | null} */ let jrLoad = null;
function journalRecipes() {
  /** @param {string} p */
  const get = async (p) => {
    const r = await fetch(new URL(`../recipes/world/${p}.json`, import.meta.url));
    if (!r.ok) throw new Error(`recipes/world/${p}.json: HTTP ${r.status}`);
    return r.json();
  };
  jrLoad ??= Promise.all(['journal', 'journal-island', 'journal-web'].map(get)).then(([words, island, web]) => ({ words, island, web }));
  return jrLoad;
}

/** @param {number[]} a */
const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN);
/** @param {number[]} a */
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2;
};

/** @param {Uint8Array} bytes */
async function gzipSize(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(s).arrayBuffer()).byteLength;
}

/** @type {Map<string, Promise<any>>} */ const landLoads = new Map();
/**
 * The recipes the ecology world reads, for one island: its own land recipe added under its name
 * (loadEcologyRecipes keys lands by island id, so the larger island's land is not there).
 * @param {any} R loadEcologyRecipes() @param {import('./chunk-bench-sizes.js').BenchSize} size
 */
async function sizedRecipes(R, size) {
  if (!landLoads.has(size.land)) {
    landLoads.set(size.land, fetch(new URL(`../recipes/land/${size.land}.json`, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`recipes/land/${size.land}.json: HTTP ${r.status}`);
      return r.json();
    }));
  }
  const land = await /** @type {Promise<any>} */ (landLoads.get(size.land));
  return { R: { ...R, lands: { ...R.lands, [size.land]: land } }, island: size.land, land };
}

/**
 * @param {import('./chunk-bench-sizes.js').BenchSize} size @param {number} seed
 * @param {(text: string) => void} say
 */
export async function cpuBench(size, seed, say) {
  const [R0, jr] = await Promise.all([loadEcologyRecipes(), journalRecipes()]);
  const { R, island, land } = await sizedRecipes(R0, size);
  const who = size.title;
  say(`${who}: building it without the GPU`);
  await pause();
  const b0 = performance.now();
  const w = islandWorld(R, island, seed, START_DAY);
  const buildMs = performance.now() - b0;
  const habitat = w.model.habitat, material = w.model.material;
  const from = w.h0 + 1;

  // One hour, step by step, as hourStep runs it: the tick in COARSE_ORDER, then the journal.
  /** @param {boolean} keep */
  const runHours = (keep) => {
    /** @type {Record<string, number[]>} */ const steps = Object.fromEntries(COARSE_ORDER.map((s) => [s.id, []]));
    /** @type {number[]} */ const journal = [], total = [];
    let state = w.state, jl = initialJournal(w.h0);
    for (let h = from; h < from + HOURS; h++) {
      const t0 = performance.now();
      /** @type {any[]} */ const events = [];
      for (const sys of COARSE_ORDER) {
        const a = performance.now();
        const r = sys.coarseStep(state, h, w.env);
        if (keep) steps[sys.id].push(performance.now() - a);
        state = r.state;
        for (const e of r.events) events.push({ ...e, hour: h });
      }
      const a = performance.now();
      jl = journalLook(jl, { material, ...jr, state, events, hour: h, habitat: w.env.habitat?.() ?? null }).journal;
      if (keep) { journal.push(performance.now() - a); total.push(performance.now() - t0); }
    }
    return { steps, journal, total, plants: state.growth?.plants?.length ?? 0 };
  };
  say(`${who}: warming up the hourly tick`);
  await pause();
  runHours(false);
  say(`${who}: timing ${HOURS} hours step by step`);
  await pause();
  const hours = runHours(true);
  const tick = {
    steps: Object.fromEntries(Object.entries(hours.steps).map(([id, a]) => [id, { mean: mean(a), max: Math.max(...a) }])),
    journal: { mean: mean(hours.journal), max: Math.max(...hours.journal) },
    hour: { mean: mean(hours.total), median: median(hours.total), max: Math.max(...hours.total) },
    plants: hours.plants,
  };

  // The water summary rebuild, as the game builds it (src/world/water/index.js, island-model.js).
  say(`${who}: rebuilding the water summary`);
  await pause();
  // The island's own chunk range (as src/world/island-model.js and src/world/terrain/index.js read it).
  const S = { chunkMin: land.chunkMin ?? R.terrain.starter.chunkMin, chunkMax: land.chunkMax ?? R.terrain.starter.chunkMax }, half = CHUNK_SIZE / 2;
  const rect = rectForBounds({ openMin: [CHUNK_SIZE * S.chunkMin - half, CHUNK_SIZE * S.chunkMin - half], openMax: [CHUNK_SIZE * S.chunkMax + half, CHUNK_SIZE * S.chunkMax + half] });
  const springs = landmarks(land, subSeed(seed >>> 0, 'terrain')).springs.map((s) => ({ cellX: waterCellOf(s.x), cellY: waterCellOf(s.z), rateLps: s.rateLps }));
  const args = { heightQ: w.model.heightQ, rect, springs, params: { ...R.water.summary, manningN: R.water.sim.manningN }, tide: R.water.tide };
  /** @type {number[]} */ const summaryMs = [];
  for (let i = 0; i < 4; i++) {
    const a = performance.now();
    buildSummary(args);
    if (i) summaryMs.push(performance.now() - a);   // the first is a warm-up
    await pause();
  }

  // One 24-hour catch-up block, on the page and in a worker (the game uses the worker).
  const base = { seed, recipes: w.env.recipes, habitat, material, jr, state: w.state, journal: initialJournal(w.h0), fromHour: from, hours: HOURS };
  say(`${who}: one ${HOURS}-hour catch-up block on the page`);
  await pause();
  let a = performance.now();
  const away = await catchUp({ ...base, worker: false });
  const pageMs = performance.now() - a;
  say(`${who}: the same block in a worker`);
  let workerOk = true;
  const warn = console.warn;
  console.warn = (...m) => { if (String(m[0]).startsWith('catch-up in a worker failed')) workerOk = false; warn(...m); };
  a = performance.now();
  try { await catchUp({ ...base, worker: true }); } finally { console.warn = warn; }
  const workerMs = performance.now() - a;

  // The save's world section after that day, and the whole file.
  say(`${who}: packing the save`);
  await pause();
  const worldBytes = packValue(structuredClone(away.state));
  const worldGz = await gzipSize(worldBytes);
  const opened = (S.chunkMax - S.chunkMin + 1) ** 2;
  /** @type {Record<string, any>} */ const chunks = {};
  for (let cz = S.chunkMin; cz <= S.chunkMax; cz++) for (let cx = S.chunkMin; cx <= S.chunkMax; cx++) chunks[`${cx},${cz}`] = { state: 'open', land: `land/${island}`, edited: false };
  const { header, sections } = snapshot({
    build: 'chunk-bench', seed, island: 'starter-island', worldT: (from + HOURS) * 3600, flow: 1, world: away.state, journal: away.journal,
    water: { springs: [], version: 1 }, unlocks: {}, view: null, looks: {}, chunks, mirror: null, savedAt: 0, wallHighWater: 0,
  });
  const file = await encode(header, sections);

  return {
    buildMs, tick, summaryMs: { mean: mean(summaryMs), min: Math.min(...summaryMs) },
    catchUp: { pageMs, workerMs: workerOk ? workerMs : NaN },
    save: { worldRaw: worldBytes.length, worldGz, fileBytes: file.length, chunks: opened, editedChunkRaw: CHUNK_CELLS * CHUNK_CELLS * 6 },
    rect: { w: rect.w, h: rect.h },
  };
}
