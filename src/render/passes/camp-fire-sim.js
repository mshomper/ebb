// @ts-check
// The camp fire's live fluid (Matt's fire study, October 29, 2026): smoke and heat on a small grid
// over a box standing on the ring, stepped at a fixed rate on the GPU (camp-fire-sim.wgsl). F1 uses
// it in tools/fire-lab.html; F2 wires it into the frame graph before the camp effects pass, fed from
// the camp's frame (src/world/camp/frame.js). Visual only: never saved, never in catch-up.
// Recipe: camp.json fireSim; its tiers pick the grid and the pressure passes.

import { makeBuffer, makeShaderModule, makeTexture, untrack } from '../../core/gpu.js';

const SIM_BYTES = 7 * 16 + 8 * 16;
const MAX_SPOTS = 8;
const CURL = 32;

/**
 * @typedef {{ time: number, level: number, flare: number, smokePuff: number, wind: number[],
 *   rainy?: boolean, spots: number[][] }} FireSimInput
 *   time: seconds (for the turbulence and flicker); wind: [x, z] m/s; spots: hot spots, each
 *   [x, y, z, share] in meters from the fire's foot
 */

/**
 * @param {{ recipe: any, rain?: { flame: number, smoke: number } }} opts
 *   recipe: camp.json fireSim; rain: camp.json fire.rainFlame and smoke.rainThick
 */
export function createCampFireSim(opts) {
  const R = opts.recipe;
  const rain = opts.rain ?? { flame: 1, smoke: 1 };
  const box = R.boxM, bmin = [-box[0] / 2, 0, -box[2] / 2];
  const data = new Float32Array(SIM_BYTES / 4);
  data.set([R.buoyancy, R.smokeWeight, R.cooling, R.smokeFade, R.turbulence, R.damping, R.emitHeat, R.emitSmoke], 8);
  data.set([box[0], box[1], box[2], 0, bmin[0], bmin[1], bmin[2], 1, 1, 0, 0, 0], 16);

  /** @type {GPUDevice} */ let device;
  /** @type {GPUBuffer} */ let simBuf;
  /** @type {Record<string, GPUComputePipeline>} */ let pipes = {};
  /** @type {Record<string, GPUTexture>} */ let tex = {};
  /** @type {Record<string, GPUBindGroup>} */ let groups = {};
  /** @type {GPUSampler} */ let sClamp; /** @type {GPUSampler} */ let sRep;
  let grid = [...R.grid], passes = R.pressurePasses;

  const size = () => ({ width: grid[0], height: grid[1], depthOrArrayLayers: grid[2] });
  const wg = () => /** @type {[number, number, number]} */ (grid.map((g) => Math.ceil(g / 4)));

  function makeTextures() {
    for (const [k, t] of Object.entries(tex)) { if (k === 'curl') continue; t.destroy(); untrack(`fire-sim-${k}`); }
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
    /** @param {string} k @param {GPUTextureFormat} format */
    const mk = (k, format) => makeTexture(device, { label: `fire-sim-${k}`, size: size(), dimension: '3d', format, usage });
    tex = { ...tex, velA: mk('velA', 'rgba16float'), velB: mk('velB', 'rgba16float'), dyeA: mk('dyeA', 'rgba16float'), dyeB: mk('dyeB', 'rgba16float'),
      pA: mk('pA', 'r32float'), pB: mk('pB', 'r32float'), div: mk('div', 'r32float') };
    const v = (/** @type {string} */ k) => tex[k].createView();
    /** @param {string} pipe @param {[number, GPUBindingResource][]} entries */
    const bg = (pipe, entries) => device.createBindGroup({ label: `fire-sim-${pipe}`, layout: pipes[pipe].getBindGroupLayout(0),
      entries: entries.map(([binding, resource]) => ({ binding, resource })) });
    const U = { buffer: simBuf };
    groups = {
      advectVel: bg('advectVel', [[0, U], [1, v('velA')], [2, v('dyeA')], [3, v('curl')], [4, sClamp], [5, sRep], [6, v('velB')]]),
      divergence: bg('divergence', [[1, v('velB')], [7, v('div')]]),
      jacobiAB: bg('jacobi', [[8, v('pA')], [9, v('div')], [10, v('pB')]]),
      jacobiBA: bg('jacobi', [[8, v('pB')], [9, v('div')], [10, v('pA')]]),
      project: bg('project', [[1, v('velB')], [8, v('pA')], [6, v('velA')]]),
      advectDye: bg('advectDye', [[0, U], [1, v('velA')], [2, v('dyeA')], [4, sClamp], [11, v('dyeB')]]),
    };
  }

  return {
    get grid() { return grid; },
    get pressurePasses() { return passes; },
    /** The box (m) and its corner from the fire's foot, for drawing. */
    box, bmin,
    /** Smoke (r) and heat (g), for drawing. */
    get dye() { return tex.dyeA; },

    /** @param {GPUDevice} dev */
    async setup(dev) {
      device = dev;
      simBuf = makeBuffer(device, { label: 'fire-sim', size: SIM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      sClamp = device.createSampler({ label: 'fire-sim-clamp', magFilter: 'linear', minFilter: 'linear' });
      sRep = device.createSampler({ label: 'fire-sim-repeat', magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
      const module = await makeShaderModule(device, 'camp-fire-sim');
      const names = { curl: 'csCurl', advectVel: 'csAdvectVel', divergence: 'csDivergence', jacobi: 'csJacobi', project: 'csProject', advectDye: 'csAdvectDye' };
      const made = await Promise.all(Object.entries(names).map(([k, entryPoint]) =>
        device.createComputePipelineAsync({ label: `fire-sim-${k}`, layout: 'auto', compute: { module, entryPoint } })));
      pipes = Object.fromEntries(Object.keys(names).map((k, i) => [k, made[i]]));
      tex.curl = makeTexture(device, { label: 'fire-sim-curl', size: { width: CURL, height: CURL, depthOrArrayLayers: CURL }, dimension: '3d',
        format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      const enc = device.createCommandEncoder({ label: 'fire-sim-curl' });
      const pass = enc.beginComputePass();
      pass.setPipeline(pipes.curl);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipes.curl.getBindGroupLayout(0), entries: [{ binding: 12, resource: tex.curl.createView() }] }));
      pass.dispatchWorkgroups(CURL / 4, CURL / 4, CURL / 4);
      pass.end();
      device.queue.submit([enc.finish()]);
      makeTextures();
    },

    /**
     * A tier's grid and pressure passes (camp.json fireSim tiers); a new grid starts the fluid afresh.
     * @param {{ grid: number[], pressurePasses: number }} t
     */
    setTier(t) {
      passes = t.pressurePasses + (t.pressurePasses % 2);   // even, so the pressure ends where it starts
      if (t.grid.every((g, i) => g === grid[i])) return false;
      grid = [...t.grid];
      if (device) makeTextures();
      return true;
    },

    /** Empty the fluid (the fire went out of view or cold, so a return starts clean). */
    clear() {
      for (const k of ['velA', 'velB', 'dyeA', 'dyeB', 'pA', 'pB']) {
        const bpp = k[0] === 'p' ? 4 : 8;
        device.queue.writeTexture({ texture: tex[k] }, new Uint8Array(grid[0] * bpp * grid[1] * grid[2]),
          { bytesPerRow: grid[0] * bpp, rowsPerImage: grid[1] }, size());
      }
    },

    /**
     * The inputs for this frame's steps (every step of a frame shares them).
     * @param {FireSimInput} input
     */
    write(input) {
      data.set([R.stepS, input.time, input.level, input.flare, input.wind[0], 0, input.wind[1], input.smokePuff], 0);
      const n = Math.min(MAX_SPOTS, input.spots.length);
      data[19] = n;
      data[23] = input.rainy ? rain.flame : 1;
      data[24] = input.rainy ? rain.smoke : 1;
      for (let i = 0; i < n; i++) data.set(input.spots[i], 28 + i * 4);
      device.queue.writeBuffer(simBuf, 0, data);
    },

    /**
     * Record steps of the fluid into one compute pass.
     * @param {GPUCommandEncoder} enc @param {number} steps
     * @param {GPUComputePassTimestampWrites} [timestampWrites]
     */
    encode(enc, steps, timestampWrites) {
      if (steps <= 0) return;
      const w = wg();
      for (let s = 0; s < steps; s++) {
        /** @type {GPUComputePassDescriptor} */
        const desc = { label: 'fire-sim' };
        if (timestampWrites && (s === 0 || s === steps - 1)) {
          desc.timestampWrites = { querySet: timestampWrites.querySet };
          if (s === 0) desc.timestampWrites.beginningOfPassWriteIndex = timestampWrites.beginningOfPassWriteIndex;
          if (s === steps - 1) desc.timestampWrites.endOfPassWriteIndex = timestampWrites.endOfPassWriteIndex;
        }
        const pass = enc.beginComputePass(desc);
        pass.setPipeline(pipes.advectVel); pass.setBindGroup(0, groups.advectVel); pass.dispatchWorkgroups(...w);
        pass.setPipeline(pipes.divergence); pass.setBindGroup(0, groups.divergence); pass.dispatchWorkgroups(...w);
        pass.setPipeline(pipes.jacobi);
        for (let i = 0; i < passes; i++) { pass.setBindGroup(0, i % 2 === 0 ? groups.jacobiAB : groups.jacobiBA); pass.dispatchWorkgroups(...w); }
        pass.setPipeline(pipes.project); pass.setBindGroup(0, groups.project); pass.dispatchWorkgroups(...w);
        pass.setPipeline(pipes.advectDye); pass.setBindGroup(0, groups.advectDye); pass.dispatchWorkgroups(...w);
        pass.end();
        enc.copyTextureToTexture({ texture: tex.dyeB }, { texture: tex.dyeA }, size());
      }
    },
  };
}

/**
 * The study's hot spots: spots points on a ring round the fire's foot, wider as the level rises,
 * each drifting a little in angle. F2 puts them at the star logs' burnt ends instead.
 * @param {number} count @param {number} time seconds @param {number} level
 * @returns {number[][]} [x, y, z, share] each, meters from the fire's foot
 */
export function ringSpots(count, time, level) {
  const spread = 0.03 + 0.13 * Math.min(1.2, Math.max(0, level));
  const out = [];
  for (let i = 0; i < count; i++) {
    const ang = i * (2 * Math.PI / count) + 0.35 * Math.sin(time * 0.5 + i * 1.7);
    const r = spread * (0.25 + 0.75 * fract(i * 0.618 + 0.2));
    out.push([Math.cos(ang) * r, 0.07 + 0.04 * fract(i * 0.371), Math.sin(ang) * r, 1]);
  }
  return out;
}

/** @param {number} x */
const fract = (x) => x - Math.floor(x);
