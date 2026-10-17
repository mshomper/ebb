// @ts-check
// Plain sky pass for M0: fills every pixel the opaque pass left at the far plane.

import { makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

export function createSkyPlainPass() {
  /** @type {GPURenderPipeline} */ let pipeline;

  return {
    name: 'sky',
    reads: ['depth'],
    writes: ['hdr'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'sky-plain');
      pipeline = await device.createRenderPipelineAsync({
        label: 'sky',
        layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
      });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const pass = encoder.beginRenderPass({
        label: 'sky',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.targets.depth.createView(), depthReadOnly: true,
        },
        timestampWrites: ctx.timestampWrites('sky'),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.draw(3);
      pass.end();
    },
  };
}
