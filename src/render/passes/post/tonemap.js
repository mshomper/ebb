// @ts-check
// Tonemap and present (docs/05): bloom add, Purkinje, AgX with the palette's look, the palette
// LUT crossfade, the soft outline and dither, into the canvas. Also reads back single pixels of
// the final image for the palette lab's eyedropper.

import { makeBuffer, makeShaderModule } from '../../../core/gpu.js';

/** @typedef {import('../../frame-graph.js').PassContext} PassContext */

const POST_BYTES = 128;

/**
 * @param {{ bloom: { view: () => GPUTextureView }, luts: GPUTextureView[], recipe: any }} opts
 *   recipe is recipes/world/post.json
 */
export function createTonemapPass(opts) {
  const r = opts.recipe;
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** @type {GPUSampler} */ let sampler;
  /** @type {GPUBuffer} */ let postBuffer;
  /** @type {GPUBindGroup | null} */ let group = null;
  const data = new ArrayBuffer(POST_BYTES);
  const f = new Float32Array(data);
  const u = new Uint32Array(data);
  // Per-frame values set by the app from the palette baker.
  const state = {
    lutFade: 0, lutFrom: 0, lutTo: 0,
    look: { slope: 1, power: 1, saturation: 1 },
    purkinje: 1,
    outline: { amount: 0.35, terrainAmount: 0.1, chroma: 1.1 },
    split: -1,
  };
  /** @type {{ x: number, y: number, resolve: (hex: string) => void }[]} */ let picks = [];
  /** @type {{ buffer: GPUBuffer, resolve: (hex: string) => void }[]} */ let inFlight = [];
  let swapIsBgra = false;

  return {
    name: 'tonemap',
    reads: ['hdr', 'bloom', 'normalId', 'depth'],
    writes: ['swapchain'],
    enabled: () => true,

    /** @param {Partial<typeof state>} v */
    set(v) { Object.assign(state, v); },

    /**
     * Read the final color at a canvas pixel (device pixels of the canvas). Resolves after the next frame.
     * @param {number} x @param {number} y
     * @returns {Promise<string>} '#rrggbb'
     */
    pick(x, y) {
      return new Promise((resolve) => picks.push({ x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)), resolve }));
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      swapIsBgra = ctx.format.startsWith('bgra');
      const module = await makeShaderModule(device, 'tonemap');
      const F = GPUShaderStage.FRAGMENT;
      layout = device.createBindGroupLayout({
        label: 'tonemap-input',
        entries: [
          { binding: 0, visibility: F, texture: { sampleType: 'float' } },
          { binding: 1, visibility: F, sampler: { type: 'filtering' } },
          { binding: 2, visibility: F, texture: { sampleType: 'float' } },
          { binding: 3, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
          { binding: 4, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
          { binding: 5, visibility: F, texture: { sampleType: 'float' } },
          { binding: 6, visibility: F, texture: { sampleType: 'depth' } },
          { binding: 7, visibility: F, buffer: {} },
        ],
      });
      sampler = device.createSampler({ label: 'tonemap-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
      postBuffer = makeBuffer(device, { label: 'post-uniforms', size: POST_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      pipeline = await device.createRenderPipelineAsync({
        label: 'tonemap',
        layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: ctx.format }] },
        primitive: { topology: 'triangle-list' },
      });
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      group = ctx.device.createBindGroup({
        label: 'tonemap-input',
        layout,
        entries: [
          { binding: 0, resource: ctx.targets.hdr.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: opts.bloom.view() },
          { binding: 3, resource: opts.luts[0] },
          { binding: 4, resource: opts.luts[1] },
          { binding: 5, resource: ctx.targets.normalId.createView() },
          { binding: 6, resource: ctx.targets.depth.createView() },
          { binding: 7, resource: { buffer: postBuffer } },
        ],
      });
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const height = ctx.size[1];
      f[0] = opts.bloom.mix ?? r.bloom.mix; f[1] = state.lutFade; u[2] = state.lutFrom; u[3] = state.lutTo;
      f[4] = state.look.slope; f[5] = state.look.power; f[6] = state.look.saturation; f[7] = r.purkinje.strength * state.purkinje;
      f[8] = state.outline.amount; f[9] = state.outline.terrainAmount; f[10] = state.outline.chroma;
      f[11] = Math.max(1, r.outline.widthAt1440 * height / 1440);
      f[12] = r.outline.fadeStartMeters; f[13] = r.outline.fadeEndMeters; f[14] = state.split; f[15] = r.dither.codeValues;
      f[16] = r.purkinje.fullAtNits; f[17] = r.purkinje.noneAtNits; f[18] = r.outline.creatureBoost; f[19] = 0;
      f[20] = r.outline.depthEdge[0]; f[21] = r.outline.depthEdge[1]; f[22] = r.outline.normalEdge[0]; f[23] = r.outline.normalEdge[1];
      f.set(r.purkinje.rodWeights, 24); f[27] = 0;
      f.set(r.purkinje.tint, 28); f[31] = 0;
      ctx.device.queue.writeBuffer(postBuffer, 0, data);

      const swap = ctx.context.getCurrentTexture();
      const pass = encoder.beginRenderPass({
        label: 'tonemap',
        colorAttachments: [{ view: swap.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        timestampWrites: ctx.timestampWrites('tonemap'),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, /** @type {GPUBindGroup} */ (group));
      pass.draw(3);
      pass.end();

      // Eyedropper: copy single pixels of the finished frame into small mappable buffers.
      for (const p of picks) {
        const buffer = ctx.device.createBuffer({ label: 'pick', size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        const x = Math.min(p.x, swap.width - 1);
        const y = Math.min(p.y, swap.height - 1);
        encoder.copyTextureToBuffer({ texture: swap, origin: [x, y] }, { buffer, bytesPerRow: 256 }, [1, 1]);
        inFlight.push({ buffer, resolve: p.resolve });
      }
      picks = [];
    },

    /** Call after queue.submit: finishes any eyedropper reads. */
    afterSubmit() {
      const list = inFlight;
      inFlight = [];
      for (const job of list) {
        job.buffer.mapAsync(GPUMapMode.READ).then(() => {
          const px = new Uint8Array(job.buffer.getMappedRange().slice(0, 4));
          job.buffer.destroy();
          const [rr, gg, bb] = swapIsBgra ? [px[2], px[1], px[0]] : [px[0], px[1], px[2]];
          job.resolve(`#${[rr, gg, bb].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase());
        }).catch(() => job.resolve('#000000'));
      }
    },
  };
}
