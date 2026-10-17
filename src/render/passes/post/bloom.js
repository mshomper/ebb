// @ts-check
// Bloom (docs/05, "Bloom"; Jimenez 2014): the pre-exposed HDR target is downsampled into a chain of
// `levels` mips starting at half the internal resolution, with the 13-tap filter (Karis average on the
// first step to tame fireflies such as the sun disk), then upsampled back to half resolution with a
// 3x3 tent, blending each level in so every level counts equally and the result stays a soft copy of
// the image with about the same energy (no threshold). The tonemap samples view() with linear filtering
// and adds bloom * mix itself; this pass never writes into the HDR target.
// Every step is a fullscreen-triangle render pass into an rgba16float attachment, which is renderable
// and filterable on every WebGPU device, phones included.

import { makeBuffer, makeShaderModule, makeTexture, untrack } from '../../../core/gpu.js';

/** @typedef {import('../../frame-graph.js').PassContext} PassContext */

/**
 * @typedef {import('../../frame-graph.js').Pass & {
 *   view: () => GPUTextureView | null,
 *   mix: number,
 *   levels: number,
 *   size: () => [number, number],
 * }} BloomPass
 */

const FORMAT = /** @type {GPUTextureFormat} */ ('rgba16float');
const PARAM_STRIDE = 256;
const MAX_LEVELS = 8;

/**
 * @param {{ levels?: number, mix?: number, radius?: number, karis?: boolean }} [opts]
 *   levels: mips in the chain, from the tier (6 / 5 / 4); mix: amount the tonemap adds (recipe, default 0.04);
 *   radius: upsample tent radius in lower-level texels (default 1);
 *   karis: Karis average on the first downsample (default true). It caps the glow of 1-2 px points
 *   (each 2x2 box contributes at most about 1 in pre-exposed units), which kills flicker but also
 *   dims the bloom of tiny emitters.
 * @returns {BloomPass}
 */
export function createBloomPass(opts = {}) {
  const wanted = Math.max(1, Math.min(MAX_LEVELS, Math.round(opts.levels ?? 6)));
  const radius = opts.radius ?? 1;
  const useKaris = opts.karis ?? true;
  let mix = Number.isFinite(opts.mix) ? /** @type {number} */ (opts.mix) : 0.04;

  /** @type {GPURenderPipeline} */ let downKaris;
  /** @type {GPURenderPipeline} */ let down;
  /** @type {GPURenderPipeline} */ let up;
  /** @type {GPUBindGroupLayout} */ let downLayout;
  /** @type {GPUBindGroupLayout} */ let upLayout;
  /** @type {GPUSampler} */ let sampler;
  /** @type {GPUBuffer} */ let paramsBuffer;

  /** @type {GPUTexture | null} */ let downTex = null;
  /** @type {GPUTexture | null} */ let upTex = null;
  /** @type {{ target: GPUTextureView, group: GPUBindGroup, pipeline: GPURenderPipeline, label: string }[]} */
  let steps = [];
  /** @type {GPUTextureView | null} */ let output = null;
  let levels = wanted;
  /** @type {[number, number]} */ let halfSize = [0, 0];

  function destroyTargets() {
    downTex?.destroy();
    upTex?.destroy();
    downTex = upTex = null;
    untrack('bloom-down');
    untrack('bloom-up');
    steps = [];
    output = null;
  }

  return {
    name: 'bloom',
    reads: ['hdr'],
    writes: ['bloom'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'bloom');
      sampler = device.createSampler({
        label: 'bloom-linear', magFilter: 'linear', minFilter: 'linear',
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      });
      downLayout = device.createBindGroupLayout({
        label: 'bloom-down',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
      upLayout = device.createBindGroupLayout({
        label: 'bloom-up',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 16 } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      });
      /** @param {string} label @param {GPUBindGroupLayout} layout @param {string} entryPoint @param {Record<string, number>} [constants] */
      const make = (label, layout, entryPoint, constants) => device.createRenderPipelineAsync({
        label,
        layout: device.createPipelineLayout({ label, bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint, constants, targets: [{ format: FORMAT }] },
        primitive: { topology: 'triangle-list' },
      });
      [downKaris, down, up] = await Promise.all([
        make('bloom-down-first', downLayout, 'fsDown', { karis: useKaris ? 1 : 0 }),
        make('bloom-down', downLayout, 'fsDown', { karis: 0 }),
        make('bloom-up', upLayout, 'fsUp'),
      ]);
      // One 16-byte block per upsample step; weights depend only on the level count, written in resize.
      paramsBuffer = makeBuffer(device, {
        label: 'bloom-params', size: PARAM_STRIDE * MAX_LEVELS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      const { device } = ctx;
      destroyTargets();
      const w = Math.max(1, Math.floor(ctx.size[0] / 2));
      const h = Math.max(1, Math.floor(ctx.size[1] / 2));
      halfSize = [w, h];
      levels = Math.min(wanted, Math.floor(Math.log2(Math.max(w, h))) + 1);

      downTex = makeTexture(device, {
        label: 'bloom-down', size: [w, h], format: FORMAT, mipLevelCount: levels,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      /** @param {GPUTexture} tex @param {number} mip */
      const mipView = (tex, mip) => tex.createView({ baseMipLevel: mip, mipLevelCount: 1 });
      const downViews = Array.from({ length: levels }, (_, i) => mipView(/** @type {GPUTexture} */ (downTex), i));

      // Downsample: HDR -> down[0] (Karis), down[i-1] -> down[i].
      const hdrView = ctx.targets.hdr.createView();
      for (let i = 0; i < levels; i++) {
        steps.push({
          label: `bloom-down-${i}`,
          target: downViews[i],
          pipeline: i === 0 ? downKaris : down,
          group: device.createBindGroup({
            label: `bloom-down-${i}`, layout: downLayout,
            entries: [{ binding: 0, resource: i === 0 ? hdrView : downViews[i - 1] }, { binding: 1, resource: sampler }],
          }),
        });
      }

      if (levels === 1) {
        output = downViews[0];
        return;
      }

      // Upsample: up[i] = mix(down[i], tent(up[i+1]), weight), with up[levels-1] = down[levels-1].
      // weight = (n-1-i)/(n-i) makes up[0] the plain average of every level's blur.
      upTex = makeTexture(device, {
        label: 'bloom-up', size: [w, h], format: FORMAT, mipLevelCount: levels - 1,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const upViews = Array.from({ length: levels - 1 }, (_, i) => mipView(/** @type {GPUTexture} */ (upTex), i));
      const params = new Float32Array((PARAM_STRIDE / 4) * MAX_LEVELS);
      for (let i = levels - 2; i >= 0; i--) {
        params[(i * PARAM_STRIDE) / 4] = (levels - 1 - i) / (levels - i);
        params[(i * PARAM_STRIDE) / 4 + 1] = radius;
        steps.push({
          label: `bloom-up-${i}`,
          target: upViews[i],
          pipeline: up,
          group: device.createBindGroup({
            label: `bloom-up-${i}`, layout: upLayout,
            entries: [
              { binding: 0, resource: i === levels - 2 ? downViews[levels - 1] : upViews[i + 1] },
              { binding: 1, resource: sampler },
              { binding: 2, resource: { buffer: paramsBuffer, offset: i * PARAM_STRIDE, size: 16 } },
              { binding: 3, resource: downViews[i] },
            ],
          }),
        });
      }
      device.queue.writeBuffer(paramsBuffer, 0, params);
      output = upViews[0];
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!steps.length) return;
      // One timing for the whole chain: start stamp on the first pass, end stamp on the last.
      const ts = ctx.timestampWrites('bloom');
      const last = steps.length - 1;
      steps.forEach((s, n) => {
        /** @type {GPURenderPassTimestampWrites | undefined} */
        let stamp;
        if (ts && (n === 0 || n === last)) {
          stamp = { querySet: ts.querySet };
          if (n === 0) stamp.beginningOfPassWriteIndex = ts.beginningOfPassWriteIndex;
          if (n === last) stamp.endOfPassWriteIndex = ts.endOfPassWriteIndex;
        }
        const pass = encoder.beginRenderPass({
          label: s.label,
          colorAttachments: [{ view: s.target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
          timestampWrites: stamp,
        });
        pass.setPipeline(s.pipeline);
        pass.setBindGroup(0, s.group);
        pass.draw(3);
        pass.end();
      });
    },

    /** The final upsampled bloom at half the internal resolution (rgba16float), or null before resize. */
    view: () => output,

    /** Amount the tonemap adds: hdr + bloom * mix. Tunable at runtime. */
    get mix() { return mix; },
    set mix(v) { if (Number.isFinite(v)) mix = Math.max(0, v); },

    /** Levels actually in use (the tier count, capped by the half-res size). */
    get levels() { return levels; },

    /** Size of view() in pixels. @returns {[number, number]} */
    size: () => halfSize,
  };
}
