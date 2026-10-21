// @ts-check
// Footprints pass (doc 23, W6): the walker's prints in sand and mud, multiplied into the ground
// after the land and before the water (footprints.wgsl). The prints themselves come from
// src/world/figure/footprints.js; this only draws them.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

/** @param {{ max: number }} opts max: how many prints at most */
export function createFootprintsPass(opts) {
  const data = new Float32Array(opts.max * 12);
  let count = 0, dirty = false;
  /** @type {GPURenderPipeline} */ let pipe;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;

  return {
    name: 'footprints',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => count > 0,
    /** How many prints are drawn now (tests and tools). */
    get count() { return count; },

    /**
     * The prints to draw this frame.
     * @param {{ x: number, z: number, yaw: number, side: number, strength: number, corners: number[] }[]} list
     * @param {number[]} sole [width, length] (m)
     */
    setPrints(list, sole) {
      count = Math.min(list.length, opts.max);
      for (let i = 0; i < count; i++) {
        const p = list[i];
        data.set([p.x, p.z, p.yaw, p.side, p.strength, sole[0], sole[1], 0, ...p.corners], i * 12);
      }
      dirty = true;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const device = ctx.device;
      const module = await makeShaderModule(device, 'footprints');
      const layout = device.createBindGroupLayout({
        label: 'group1-footprints',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
      });
      pipe = await device.createRenderPipelineAsync({
        label: 'footprints',
        layout: device.createPipelineLayout({ label: 'footprints', bindGroupLayouts: [ctx.layouts.frame, layout] }),
        vertex: { module, entryPoint: 'vsPrint' },
        fragment: {
          module, entryPoint: 'fsPrint',
          // Multiplied into the HDR colour: 1 leaves it, less darkens it.
          targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
      });
      sbuf = makeBuffer(device, { label: 'footprints', size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({ label: 'footprints', layout, entries: [{ binding: 0, resource: { buffer: sbuf } }] });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!pipe || !count) return;
      if (dirty) { ctx.device.queue.writeBuffer(sbuf, 0, data, 0, count * 12); dirty = false; }
      const pass = encoder.beginRenderPass({
        label: 'footprints',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('footprints'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, group);
      pass.setPipeline(pipe);
      pass.draw(6, count);
      pass.end();
    },
  };
}
