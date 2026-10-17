// @ts-check
// Water system (docs/07), S4a: the live shallow-water simulation over the opened chunks, held at
// the analytic tide on its outer ring and fed by the starter spring. Runs on real seconds at a
// fixed step (visual only, never saved). The water summary for ecology, the pond nudge, pour and
// soak and the readback for creatures arrive in S4b.

import { makeBuffer } from '../../core/gpu.js';
import { level, tideParams } from '../tide.js';
import { landmarks } from '../terrain/landform.js';
import { createWaterSim } from './sim.js';
import { bedHeights, initialDepths } from './init.js';
import { WATER_CELL, rectForBounds, waterCellOf, waterCellCenter } from './grid.js';

/**
 * @param {import('../../core/gpu.js').Gpu} gpu
 * @param {{ terrain: import('../terrain/index.js').Terrain, recipe: any, land: any, terrainSeed: number,
 *   tier: string, displayHours: number }} opts
 *   recipe: recipes/world/water.json; land: the land recipe (its `spring`); terrainSeed: the seed the
 *   landform was built with; displayHours: display time at start, for the starting sea level.
 */
export async function createWater(gpu, opts) {
  const { device } = gpu;
  const { terrain, recipe } = opts;
  const simRecipe = recipe.sim;
  const tideP = tideParams(recipe.tide);
  const stepS = simRecipe.stepS[opts.tier] ?? simRecipe.stepS.high;
  const sim = await createWaterSim(device, terrain.gpu);
  const rect = rectForBounds(terrain.openBounds());

  // The starter spring sits on the rise's flank, at the head of its channel to the pond (land recipe).
  const sp = landmarks(opts.land, opts.terrainSeed).spring ?? { x: 0, z: 0, rateLps: 0 };
  const springCell = /** @type {[number, number]} */ ([waterCellOf(sp.x), waterCellOf(sp.z)]);
  // Liters per second over one cell, as depth per second.
  const springRate = (sp.rateLps / 1000) / (WATER_CELL * WATER_CELL);

  let tide = level(opts.displayHours, tideP);
  {
    const bed = bedHeights((x, z) => terrain.sampleHeight(x, z), rect);
    sim.seed(rect, initialDepths(bed, rect, { tide, minDepth: simRecipe.prefillMinDepthM, minArea: simRecipe.prefillMinAreaM2 }));
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

  let acc = 0;
  let steps = 0;

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
    },

    /** @param {GPUCommandEncoder} encoder */
    encode(encoder) {
      const timed = wantStats && querySet && !timeBusy && steps > 0;
      sim.encode(encoder, {
        rect, steps, dt: stepS, tide, recipe: simRecipe, stats: wantStats,
        spring: { cell: springCell, rate: springRate },
        timestampWrites: timed && querySet ? { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined,
      });
      if (timed && querySet && resolveBuf && timeRead) {
        encoder.resolveQuerySet(querySet, 0, 2, resolveBuf, 0);
        encoder.copyBufferToBuffer(resolveBuf, 0, timeRead, 0, 16);
        timeQueued = true;
      }
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
      sim.dispose();
      querySet?.destroy();
    },

    /** Sea level now (m), at display time. */
    get tide() { return tide; },
    /** The simulated rect in water cells. */
    rect,
    /** Live fields for drawing: depth ping-pong pair, which one is current, velocity. */
    sim,
    /** World xz of the starter spring. */
    spring: { x: waterCellCenter(springCell[0]), z: waterCellCenter(springCell[1]), cell: springCell },
    /** Turn the health numbers on (water lab). @param {boolean} on */
    setStats(on) { statsOn = on; },
    /** Latest health numbers, with the simulation's GPU time and steps in the last frame. */
    stats() { return sim.stats ? { ...sim.stats, simMs, steps, tide } : null; },
  };
}

/** @typedef {Awaited<ReturnType<typeof createWater>>} Water */
