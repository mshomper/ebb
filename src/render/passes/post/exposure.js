// @ts-check
// Auto-exposure (docs/05, "Exposure"): measures the pre-exposed HDR target on the GPU, reads the
// target EV100 back a frame or two later through a small ring of mappable buffers, and adapts
// smoothly toward it on the CPU. The app feeds ev100(dt) into FrameUniforms for the next frame.
// Lower EV100 = brighter image. Numbers live in recipes/world/exposure.json.

import { makeBuffer, makeShaderModule } from '../../../core/gpu.js';

/** @typedef {import('../../frame-graph.js').PassContext} PassContext */

/**
 * @typedef {Object} ExposureRecipe
 * @property {number} minEV             clamp for the adapted EV100
 * @property {number} maxEV
 * @property {number} brightenEVperSec  exponential rate (1/s) when the image gets brighter (EV falls)
 * @property {number} darkenEVperSec    exponential rate (1/s) when the image gets darker (EV rises)
 * @property {number} lowCut            share of weight dropped at the dark end, 0..1
 * @property {number} highCut           share of weight dropped at the bright end, 0..1
 * @property {number} initialEV         EV100 before the first measurement arrives
 * @property {number} [nightKneeEV]     below this measured EV100 the exposure follows only part of the way
 * @property {number} [nightFollow]     that part, 0..1 (1 follows fully)
 * @property {number} centerWeight      weight of the screen center relative to the edges
 * @property {number} [histogramMinEV]  histogram range, default -6
 * @property {number} [histogramMaxEV]  default 18
 * @property {[number, number]} [sampleGrid]  texels read per frame, default 128 x 72 (kept, aspect follows the target)
 */

/**
 * @typedef {import('../../frame-graph.js').Pass & {
 *   afterSubmit: () => void,
 *   ev100: (dt: number) => number,
 *   setBias: (ev: number) => void,
 *   reset: (ev?: number) => void,
 *   target: () => number | null,
 * }} ExposurePass
 */

const PARAMS_BYTES = 48;
const RESULT_BYTES = 16;
const BINS = 64;
const RING = 3;
const WG_X = 16;
const WG_Y = 8;

/**
 * @param {ExposureRecipe} recipe
 * @returns {ExposurePass}
 */
export function createExposurePass(recipe) {
  const minEV = recipe.minEV ?? -1;
  const maxEV = recipe.maxEV ?? 15;
  const brighten = Math.max(0, recipe.brightenEVperSec ?? 1.2);
  const darken = Math.max(0, recipe.darkenEVperSec ?? 0.8);
  const lowCut = clamp(recipe.lowCut ?? 0.4, 0, 0.95);
  const highCut = clamp(recipe.highCut ?? 0.05, 0, 0.95 - lowCut);
  const initialEV = clamp(recipe.initialEV ?? 12, minEV, maxEV);
  // Night key: below the knee the eye only partly adapts, so night stays darker than day but never black.
  const knee = recipe.nightKneeEV ?? -Infinity;
  const follow = clamp(recipe.nightFollow ?? 1, 0, 1);
  const soften = (/** @type {number} */ ev) => (ev < knee ? knee + (ev - knee) * follow : ev);
  const histMinEV = recipe.histogramMinEV ?? -6;
  const histMaxEV = recipe.histogramMaxEV ?? 18;
  const [baseGX, baseGY] = recipe.sampleGrid ?? [128, 72];
  const sampleCount = Math.max(256, baseGX * baseGY);

  /** @type {GPUComputePipeline} */ let histogramPipeline;
  /** @type {GPUComputePipeline} */ let reducePipeline;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** @type {GPUBuffer} */ let paramsBuffer;
  /** @type {GPUBuffer} */ let histogramBuffer;
  /** @type {GPUBuffer} */ let resultBuffer;
  /** @type {GPUBindGroup | null} */ let group = null;
  /** @type {[number, number]} */ let grid = [baseGX, baseGY];

  /** @type {{ buffer: GPUBuffer, busy: boolean, seq: number }[]} */
  const ring = [];
  /** @type {typeof ring[number] | null} */ let pending = null;
  let seq = 0;
  let lastSeq = -1;

  let current = initialEV;
  /** @type {number | null} */ let targetEV = null;
  let bias = 0;

  return {
    name: 'exposure',
    reads: ['hdr'],
    writes: [],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'exposure');
      layout = device.createBindGroupLayout({
        label: 'exposure-input',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ label: 'exposure', bindGroupLayouts: [ctx.layouts.frame, layout] });
      [histogramPipeline, reducePipeline] = await Promise.all([
        device.createComputePipelineAsync({ label: 'exposure-histogram', layout: pipelineLayout, compute: { module, entryPoint: 'histogramMain' } }),
        device.createComputePipelineAsync({ label: 'exposure-reduce', layout: pipelineLayout, compute: { module, entryPoint: 'reduceMain' } }),
      ]);
      paramsBuffer = makeBuffer(device, { label: 'exposure-params', size: PARAMS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      histogramBuffer = makeBuffer(device, { label: 'exposure-histogram', size: BINS * 4, usage: GPUBufferUsage.STORAGE });
      resultBuffer = makeBuffer(device, { label: 'exposure-result', size: RESULT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      for (let i = 0; i < RING; i++) {
        ring.push({
          buffer: makeBuffer(device, { label: `exposure-readback-${i}`, size: RESULT_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
          busy: false, seq: -1,
        });
      }
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      const [w, h] = ctx.size;
      // Keep about the same number of samples, shaped like the target.
      const aspect = w / Math.max(1, h);
      const gx = clamp(Math.round(Math.sqrt(sampleCount * aspect)), 1, w);
      const gy = clamp(Math.round(sampleCount / gx), 1, h);
      grid = [gx, gy];
      const data = new ArrayBuffer(PARAMS_BYTES);
      const u = new Uint32Array(data);
      const f = new Float32Array(data);
      u[0] = gx; u[1] = gy; u[2] = w; u[3] = h;
      f[4] = histMinEV; f[5] = histMaxEV;
      f[6] = recipe.centerWeight ?? 3;
      f[7] = lowCut; f[8] = highCut;
      ctx.device.queue.writeBuffer(paramsBuffer, 0, data);
      group = ctx.device.createBindGroup({
        label: 'exposure-input',
        layout,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: ctx.targets.hdr.createView() },
          { binding: 2, resource: { buffer: histogramBuffer } },
          { binding: 3, resource: { buffer: resultBuffer } },
        ],
      });
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      pending = null;
      const slot = ring.find((r) => !r.busy);
      if (!slot || !group) return; // every readback still in flight: skip this frame's measurement
      const pass = encoder.beginComputePass({
        label: 'exposure',
        timestampWrites: /** @type {GPUComputePassTimestampWrites | undefined} */ (ctx.timestampWrites('exposure')),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, group);
      pass.setPipeline(histogramPipeline);
      pass.dispatchWorkgroups(Math.ceil(grid[0] / WG_X), Math.ceil(grid[1] / WG_Y));
      pass.setPipeline(reducePipeline);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(resultBuffer, 0, slot.buffer, 0, RESULT_BYTES);
      slot.busy = true;
      slot.seq = seq++;
      pending = slot;
    },

    /** Call after queue.submit: starts mapping this frame's measurement. */
    afterSubmit() {
      const slot = pending;
      pending = null;
      if (!slot) return;
      slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
        const r = new Float32Array(slot.buffer.getMappedRange(), 0, 4);
        const ev = r[0];
        const valid = r[3] > 0.5 && Number.isFinite(ev);
        slot.buffer.unmap();
        slot.busy = false;
        if (valid && slot.seq > lastSeq) {
          // The first measurement is taken at once, so an island opening at dawn or dusk is never
          // a dark screen for the many seconds the eye would take from the day's starting key.
          const first = targetEV === null;
          lastSeq = slot.seq;
          targetEV = clamp(soften(ev), minEV, maxEV);
          if (first) current = targetEV;
        }
      }).catch(() => { slot.busy = false; });
    },

    /**
     * Adapted EV100 for the next frame. Exponential approach toward the last measured target;
     * holds the current value until the first measurement arrives.
     * @param {number} dt real seconds since the last call
     */
    ev100(dt) {
      if (targetEV !== null && dt > 0) {
        const rate = targetEV < current ? brighten : darken;
        current += (targetEV - current) * (1 - Math.exp(-Math.min(dt, 1) * rate));
      }
      current = clamp(current, minEV, maxEV);
      return current - bias;
    },

    /** Exposure compensation in EV; positive brightens (docs/05 settings, -1..+1). @param {number} ev */
    setBias(ev) { bias = Number.isFinite(ev) ? ev : 0; },

    /** Jump straight to an EV100 (or the recipe's initial value) and forget the last target. @param {number} [ev] */
    reset(ev = initialEV) {
      current = clamp(ev, minEV, maxEV);
      targetEV = null;
    },

    /** The last measured target EV100, or null before the first readback. */
    target: () => targetEV,
  };
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
