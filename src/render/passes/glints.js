// @ts-check
// Glints pass (src/world/glints.js): a brief twinkle now and then on the things worth finding on the
// shore, lit by the sun and moon in glint-draw.wgsl. One small quad a glint, added into the HDR,
// depth tested but not written; between flashes the quad folds away in the vertex shader. A few dozen
// glints at most, no textures: a tiny cost.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const MAX = 48;
/** at (x, y, z, boost), then the seed and three spare words. */
const GLINT_WORDS = 8;

/** @param {{ recipe: any, time: () => number }} opts recipe: recipes/world/glints.json; time: real seconds */
export function createGlintsPass(opts) {
  const R = opts.recipe;
  const data = new Float32Array(16);
  data.set([R.everyS[0], R.everyS[1], R.flashS, R.chance, (R.facetDeg * Math.PI) / 180, R.sharp, R.sizePx, R.strength,
    R.rangeM[0], R.rangeM[1], R.rayShare, 0, R.towardEyeM, 0, 0, 0]);
  const list = new ArrayBuffer(MAX * GLINT_WORDS * 4);
  const lf = new Float32Array(list), lu = new Uint32Array(list);
  let count = 0;
  /** @type {GPURenderPipeline} */ let pipe;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;

  return {
    name: 'glints',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => count > 0,

    /** This frame's glint points. @param {import('../../world/glints.js').Glint[]} points */
    set(points) {
      count = Math.min(MAX, points.length);
      for (let i = 0; i < count; i++) {
        const p = points[i], o = i * GLINT_WORDS;
        lf.set([p.x, p.y, p.z, p.boost], o);
        lu[o + 4] = p.seed >>> 0;
      }
    },

    /** How many are set (tools, tests). */
    count: () => count,

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'glint-draw');
      const layout = device.createBindGroupLayout({
        label: 'group2-glints',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      pipe = await device.createRenderPipelineAsync({
        label: 'glints',
        layout: device.createPipelineLayout({ label: 'glints', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vsGlint' },
        fragment: {
          module, entryPoint: 'fsGlint',
          targets: [{ format: 'rgba16float', blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
      });
      ubuf = makeBuffer(device, { label: 'glint-draw', size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      sbuf = makeBuffer(device, { label: 'glint-list', size: list.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({ label: 'glints', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }] });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!pipe || !count) return;
      data[11] = opts.time();
      ctx.device.queue.writeBuffer(ubuf, 0, data);
      ctx.device.queue.writeBuffer(sbuf, 0, list, 0, count * GLINT_WORDS * 4);
      const pass = encoder.beginRenderPass({
        label: 'glints',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthReadOnly: true },
        timestampWrites: ctx.timestampWrites('glints'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(pipe);
      pass.draw(6, count);
      pass.end();
    },
  };
}
