// @ts-check
// Water system (docs/07): the live shallow-water simulation over the opened chunks, held at the
// analytic tide on its outer ring, fed by springs (the starter spring and up to four the player
// places) and by the pour and drain brush, and gently topped up toward the deterministic water
// summary (ponds to their lip, streams to their natural depth). The summary is what ecology reads;
// the live water is visual only and never saved. Springs are saved (store slice `water`, S7).

import { makeBuffer } from '../../core/gpu.js';
import { emitDeferred } from '../../core/events.js';
import { run } from '../../core/workers.js';
import { level, tideParams } from '../tide.js';
import { landmarks } from '../terrain/landform.js';
import { createWaterSim } from './sim.js';
import { bedHeights, initialDepths } from './init.js';
import { buildSummary, WATER_CLASS } from './summary.js';
import { WATER_CELL, WATER_ORIGIN, rectForBounds, waterCellOf, waterCellCenter } from './grid.js';

const SUMMARY_JOB = { module: './world/water/summary.js', fn: 'buildSummary' };

/** @typedef {{ id: string, x: number, z: number, rateLps: number, fixed?: boolean }} Spring */

/**
 * @param {import('../../core/gpu.js').Gpu} gpu
 * @param {{ terrain: import('../terrain/index.js').Terrain, recipe: any, land: any, terrainSeed: number,
 *   tier: string, displayHours: number, getHeightQ: () => Uint16Array | null, springs?: Spring[] }} opts
 *   recipe: recipes/world/water.json; land: the land recipe (its `spring`); terrainSeed: the seed the
 *   landform was built with; displayHours: display time at start, for the starting sea level;
 *   getHeightQ: the terrain's quantized heights (the summary's input); springs: placed springs to restore.
 */
export async function createWater(gpu, opts) {
  const { device } = gpu;
  const { terrain, recipe } = opts;
  const simRecipe = recipe.sim;
  const tideP = tideParams(recipe.tide);
  const stepS = simRecipe.stepS[opts.tier] ?? simRecipe.stepS.high;
  const nudgeK = 1 - Math.exp(-stepS / recipe.nudge.tauS);
  const sim = await createWaterSim(device, terrain.gpu);
  const rect = rectForBounds(terrain.openBounds());

  // Springs: the island's own from the land recipe (fixed; the first keeps the id 'starter'), then
  // any the player placed.
  /** @type {Spring[]} */
  const springs = landmarks(opts.land, opts.terrainSeed).springs.map((lm, i) => (
    { id: i ? `starter-${i + 1}` : 'starter', x: lm.x, z: lm.z, rateLps: lm.rateLps, fixed: true }));
  for (const s of opts.springs ?? []) springs.push({ ...s });
  /** @type {null | { x: number, z: number, radiusM: number, rateLps: number }} */
  let brush = null;

  /** Springs as the summary wants them. */
  const summarySprings = () => springs.map((s) => ({ cellX: waterCellOf(s.x), cellY: waterCellOf(s.z), rateLps: s.rateLps }));

  /** @type {any} */ let summary = null;
  /** @param {any} s */
  function applySummary(s) {
    summary = s;
    const t = new Float32Array(s.targetMm.length);
    for (let i = 0; i < t.length; i++) t[i] = s.targetMm[i] * 0.001;
    sim.setTarget(s.rect, t);
    // Damp hollows for the look: only ones big enough to read (a dip of a cell or two is noise).
    /** @type {Map<number, number>} */ const size = new Map();
    for (let i = 0; i < s.cls.length; i++) if (s.cls[i] === WATER_CLASS.damp) size.set(s.basin[i], (size.get(s.basin[i]) ?? 0) + 1);
    const minCells = recipe.look.dampHollowMinM2 / (WATER_CELL * WATER_CELL);
    const damp = new Uint8Array(s.cls.length);
    for (let i = 0; i < damp.length; i++) damp[i] = s.cls[i] === WATER_CLASS.damp && (size.get(s.basin[i]) ?? 0) >= minCells ? 255 : 0;
    sim.setDamp(s.rect, damp);
    emitDeferred('water:summary-updated', { rect: s.rect, hash: s.hash });
  }

  let tide = level(opts.displayHours, tideP);
  {
    // Start from the summary: the sea at the current tide, ponds full, streams running.
    const heightQ = opts.getHeightQ();
    const bed = bedHeights((x, z) => terrain.sampleHeight(x, z), rect);
    const depth = initialDepths(bed, rect, { tide, minDepth: Infinity, minArea: Infinity });
    if (heightQ) {
      const s = buildSummary({ heightQ, rect, springs: summarySprings(), params: { ...recipe.summary, manningN: simRecipe.manningN }, tide: recipe.tide });
      for (let i = 0; i < depth.length; i++) depth[i] = Math.max(depth[i], s.targetMm[i] * 0.001);
      applySummary(s);
    }
    sim.seed(rect, depth);
  }

  // Summary rebuilds in a worker, debounced after strokes and spring changes. A newer request
  // replaces a queued one; a result for an outdated request is dropped.
  let summaryTimer = 0;
  let summaryVersion = 0;
  function requestSummary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      const heightQ = opts.getHeightQ();
      if (!heightQ) return;
      const v = ++summaryVersion;
      run(SUMMARY_JOB, { heightQ, rect, springs: summarySprings(), params: { ...recipe.summary, manningN: simRecipe.manningN }, tide: recipe.tide },
        { lane: 'background', key: 'water-summary' })
        .then((s) => { if (v === summaryVersion) applySummary(s); })
        .catch((err) => { if (err?.name !== 'Cancelled') console.warn('water summary failed', err); });
    }, recipe.summary.debounceS * 1000);
  }

  // Optional GPU timing and health numbers for tools/water-lab.html.
  const canTime = gpu.features.has('timestamp-query');
  const querySet = canTime ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const resolveBuf = canTime ? makeBuffer(device, { label: 'water-time-resolve', size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const timeRead = canTime ? makeBuffer(device, { label: 'water-time-read', size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  let statsOn = false;
  let statsClock = 0;
  let wantStats = false;
  let timeQueued = false;
  let timeBusy = false;
  let simMs = 0;
  let readClock = 0;
  let wantRead = false;

  let acc = 0;
  let steps = 0;

  /** Sources for this frame: every spring, plus the brush while it is held. */
  function sources() {
    const out = springs.map((s) => ({ cell: /** @type {[number, number]} */ ([waterCellOf(s.x), waterCellOf(s.z)]), rateM3s: s.rateLps / 1000, radius: 0 }));
    if (brush) {
      out.push({
        cell: [(brush.x - WATER_ORIGIN) / WATER_CELL - 0.5, (brush.z - WATER_ORIGIN) / WATER_CELL - 0.5],
        rateM3s: brush.rateLps / 1000, radius: Math.max(1, brush.radiusM / WATER_CELL),
      });
    }
    return out;
  }

  /** @param {string} id */
  const findSpring = (id) => springs.find((s) => s.id === id) ?? null;
  let nextId = 1;

  return {
    id: 'water',

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      tide = level(f.displayT / 3600, tideP);
      acc += f.realDt;
      steps = Math.min(simRecipe.maxSteps, Math.floor(acc / stepS));
      acc -= steps * stepS;
      if (acc > stepS) acc = 0; // a slow frame drops time rather than piling up steps
      statsClock += f.realDt;
      wantStats = statsOn && statsClock >= 0.25;
      if (wantStats) statsClock = 0;
      readClock += f.realDt;
      wantRead = readClock >= 0.25;
      if (wantRead) readClock = 0;
    },

    /** @param {GPUCommandEncoder} encoder */
    encode(encoder) {
      const timed = wantStats && querySet && !timeBusy && steps > 0;
      sim.encode(encoder, {
        rect, steps, dt: stepS, tide, recipe: simRecipe, stats: wantStats, sources: sources(), nudgeK,
        timestampWrites: timed && querySet ? { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined,
      });
      if (timed && querySet && resolveBuf && timeRead) {
        encoder.resolveQuerySet(querySet, 0, 2, resolveBuf, 0);
        encoder.copyBufferToBuffer(resolveBuf, 0, timeRead, 0, 16);
        timeQueued = true;
      }
      if (wantRead) sim.encodeReadback(encoder, rect);
    },

    afterSubmit() {
      sim.afterSubmit();
      if (!timeQueued || !timeRead) return;
      timeQueued = false;
      timeBusy = true;
      timeRead.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(timeRead.getMappedRange().slice(0));
        timeRead.unmap();
        simMs = Math.max(0, Number(t[1] - t[0])) / 1e6;
        timeBusy = false;
      }).catch(() => { timeBusy = false; });
    },

    dispose() {
      clearTimeout(summaryTimer);
      sim.dispose();
      querySet?.destroy();
    },

    /** Sea level now (m), at display time. */
    get tide() { return tide; },
    /** The simulated rect in water cells. */
    rect,
    /** Live fields for drawing: depth ping-pong pair, which one is current, velocity. */
    sim,

    // ---- springs ----
    /** Copies of every spring, the starter first. @returns {Spring[]} */
    springs: () => springs.map((s) => ({ ...s })),
    /** The springs the player placed (what the save keeps). @returns {Spring[]} */
    placedSprings: () => springs.filter((s) => !s.fixed).map((s) => ({ ...s })),
    /** World xz of the starter spring. */
    get spring() { const s = springs[0]; return s ? { x: s.x, z: s.z, cell: [waterCellOf(s.x), waterCellOf(s.z)] } : null; },
    /**
     * Place a spring (no checks against the cap; the app enforces it). Returns the spring.
     * @param {{ x: number, z: number, rateLps: number, id?: string }} s
     */
    addSpring(s) {
      const sp = { id: s.id ?? `s${Date.now().toString(36)}${nextId++}`, x: s.x, z: s.z, rateLps: s.rateLps };
      springs.push(sp);
      requestSummary();
      emitDeferred('water:spring-added', { id: sp.id });
      return { ...sp };
    },
    /** @param {string} id @returns {Spring | null} the removed spring */
    removeSpring(id) {
      const i = springs.findIndex((s) => s.id === id && !s.fixed);
      if (i < 0) return null;
      const [s] = springs.splice(i, 1);
      requestSummary();
      emitDeferred('water:spring-removed', { id });
      return { ...s };
    },
    /** @param {string} id @param {number} rateLps */
    setSpringRate(id, rateLps) {
      const s = findSpring(id);
      if (!s || s.fixed) return false;
      s.rateLps = rateLps;
      requestSummary();
      return true;
    },
    /**
     * The placed spring nearest to a world point within `radiusM`, or null.
     * @param {number} x @param {number} z @param {number} radiusM
     */
    springAt(x, z, radiusM) {
      let best = null;
      let bestD = radiusM;
      for (const s of springs) {
        if (s.fixed) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d <= bestD) { bestD = d; best = s.id; }
      }
      return best;
    },

    // ---- pour and drain ----
    /** The pour (positive) or drain (negative) brush for this frame, or null. @param {typeof brush} b */
    setBrush(b) { brush = b; },

    // ---- summary ----
    /** Rebuild the summary soon (after a stroke, on undo). */
    requestSummary,
    /** The latest water summary (docs/07): what ecology reads. */
    getSummary: () => summary,

    // ---- live readback ----
    /**
     * Live water at a world point, from the copy made a few times a second (docs/07, "How creatures
     * read water"): depth (m), surface height (m), velocity (m/s), and whether the copy is fresh.
     * @param {number} x @param {number} z
     */
    sampleLive(x, z) {
      const L = sim.live;
      if (!L) return { depth: 0, surface: terrain.sampleHeight(x, z), vx: 0, vz: 0, fresh: false };
      const i = Math.min(L.rect.w - 1, Math.max(0, waterCellOf(x) - L.rect.x));
      const j = Math.min(L.rect.h - 1, Math.max(0, waterCellOf(z) - L.rect.y));
      const k = j * L.rect.w + i;
      const depth = L.depth[k];
      return { depth, surface: terrain.sampleHeight(x, z) + depth, vx: L.vel[k * 2], vz: L.vel[k * 2 + 1], fresh: performance.now() - L.at < 600 };
    },

    /** Turn the health numbers on (water lab). @param {boolean} on */
    setStats(on) { statsOn = on; },
    /** Latest health numbers, with the simulation's GPU time and steps in the last frame. */
    stats() { return sim.stats ? { ...sim.stats, simMs, steps, tide } : null; },
    /** Center of a water cell (for tools). */
    cellCenter: waterCellCenter,
  };
}

/** @typedef {Awaited<ReturnType<typeof createWater>>} Water */
