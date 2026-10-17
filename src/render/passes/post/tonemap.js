// @ts-check
// Placeholder tonemap and present: reads the HDR target, writes the canvas.

import { makeShaderModule } from '../../../core/gpu.js';

/** @typedef {import('../../frame-graph.js').PassContext} PassContext */

export function createTonemapPass() {
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUBindGroupLayout} */ let hdrLayout;
  /** @type {GPUSampler} */ let sampler;
  /** @type {GPUBindGroup | null} */ let hdrGroup = null;

  return {
    name: 'tonemap',
    reads: ['hdr'],
    writes: ['swapchain'],
    enabled: () => true,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'tonemap');
      hdrLayout = device.createBindGroupLayout({
        label: 'tonemap-input',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
      sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      pipeline = await device.createRenderPipelineAsync({
        label: 'tonemap',
        layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, hdrLayout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: ctx.format }] },
        primitive: { topology: 'triangle-list' },
      });
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      hdrGroup = ctx.device.createBindGroup({
        layout: hdrLayout,
        entries: [
          { binding: 0, resource: ctx.targets.hdr.createView() },
          { binding: 1, resource: sampler },
        ],
      });
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const pass = encoder.beginRenderPass({
        label: 'tonemap',
        colorAttachments: [{
          view: ctx.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
        }],
        timestampWrites: ctx.timestampWrites('tonemap'),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, /** @type {GPUBindGroup} */ (hdrGroup));
      pass.draw(3);
      pass.end();
    },
  };
}
