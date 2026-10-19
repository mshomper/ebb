// @ts-check
// Midges pass (S6b-5, doc 11): every midge of every swarm as one small camera-facing quad, after
// the water so a swarm over the pond is not under its surface, blended softly into the HDR. The
// swarms and their counts come from src/world/ecology/midges-live.js each frame.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 64;
const MAX_SWARMS = 32;
const SWARM_BYTES = 48;

/** @param {{ recipe: any }} opts recipe: recipes/species/midge.json */
export function createMidgePass(opts) {
  const S = opts.recipe.swarm;
  const data = new Float32Array(DRAW_BYTES / 4);
  data.set([S.radiusM[0], S.radiusM[1], S.heightM[0], S.heightM[1],
    S.speedHz[0], S.speedHz[1], S.body.scaleReal[0], S.body.scaleReal[1],
    S.body.albedo[0], S.body.albedo[1], S.body.albedo[2], S.body.glint.strength,
    S.body.glint.g, S.body.minPx, 0, 0]);
  const swarmData = new ArrayBuffer(MAX_SWARMS * SWARM_BYTES);
  const sf = new Float32Array(swarmData), su = new Uint32Array(swarmData);
  let total = 0, swarmCount = 0;
  /** @type {GPURenderPipeline} */ let pipe;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;

  return {
    name: 'midges',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => total > 0,

    /**
     * This frame's swarms.
     * @param {{ x: number, y: number, z: number, bob: number, dip: number, seed: number, count: number, dipIndex: number }[]} list
     * @param {number} t animation seconds (the paths' clock)
     */
    set(list, t) {
      swarmCount = Math.min(MAX_SWARMS, list.length);
      total = 0;
      for (let s = 0; s < swarmCount; s++) {
        const w = list[s], o = s * (SWARM_BYTES / 4);
        sf[o] = w.x; sf[o + 1] = w.y; sf[o + 2] = w.z; sf[o + 3] = w.bob;
        sf[o + 4] = w.dip; sf[o + 5] = 0; sf[o + 6] = 0; sf[o + 7] = 0;
        su[o + 8] = w.seed >>> 0; su[o + 9] = total; su[o + 10] = w.count; su[o + 11] = w.dipIndex < 0 ? 0xffffffff : w.dipIndex;
        total += w.count;
      }
      data[14] = swarmCount;
      data[15] = t;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'midge-draw');
      const layout = device.createBindGroupLayout({
        label: 'group2-midges',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      pipe = await device.createRenderPipelineAsync({
        label: 'midges',
        layout: device.createPipelineLayout({ label: 'midges', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vsMidge' },
        fragment: {
          module, entryPoint: 'fsMidge',
          targets: [{ format: 'rgba16float', blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
      });
      ubuf = makeBuffer(device, { label: 'midge-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      sbuf = makeBuffer(device, { label: 'midge-swarms', size: swarmData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({ label: 'midges', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }] });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!pipe || !total) return;
      ctx.device.queue.writeBuffer(ubuf, 0, data);
      ctx.device.queue.writeBuffer(sbuf, 0, swarmData, 0, Math.max(1, swarmCount) * SWARM_BYTES);
      const pass = encoder.beginRenderPass({
        label: 'midges',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthReadOnly: true },
        timestampWrites: ctx.timestampWrites('midges'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(pipe);
      pass.draw(6, total);
      pass.end();
    },
  };
}
