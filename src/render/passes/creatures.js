// @ts-check
// Creatures pass (doc 11): baked creature bodies, one draw per species over its individuals, after
// the plants and before the water, so the water's scene copy shows a body half under the surface.
// A soft contact shadow is multiplied in under each one first. For now it draws the frog size
// preview (?frogscale); S6b feeds it the live frogs.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 32;
const MAX = 64;

/**
 * @param {{ mesh: { vertices: Float32Array, indices: Uint32Array }, recipe: any }} opts
 *   mesh: bakeBody() of the species body; recipe: the species recipe (recipes/species/<id>.json)
 */
export function createCreaturePass(opts) {
  const { mesh, recipe } = opts;
  const W = recipe.body.wetSpecular;
  const bodyLength = recipe.body.scaleReal[0] + (recipe.body.scaleReal[1] - recipe.body.scaleReal[0]) / 2;
  const data = new Float32Array(DRAW_BYTES / 4);
  data.set([W.roughness, W.strength, 0.55, 0.62, bodyLength, 0, 0, 0]);
  const beings = new Float32Array(MAX * 8);
  let count = 0, dirty = true;
  /** @type {GPURenderPipeline} */ let bodyPipe;
  /** @type {GPURenderPipeline} */ let shadowPipe;
  /** @type {GPUBuffer} */ let vbuf;
  /** @type {GPUBuffer} */ let ibuf;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;

  return {
    name: 'creatures',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => count > 0,

    /**
     * Where the individuals are: world position, yaw (radians, 0 faces +z) and size (times real).
     * @param {{ x: number, y: number, z: number, yaw: number, size: number }[]} list
     */
    setBeings(list) {
      count = Math.min(MAX, list.length);
      beings.fill(0);
      list.slice(0, count).forEach((b, i) => beings.set([b.x, b.y, b.z, b.yaw, b.size, 0, 0, 0], i * 8));
      dirty = true;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'creature-draw');
      const layout = device.createBindGroupLayout({
        label: 'group2-creatures',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ label: 'creatures', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const depthStencil = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: true, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      bodyPipe = await device.createRenderPipelineAsync({
        label: 'creature-body',
        layout: pipelineLayout,
        vertex: {
          module, entryPoint: 'vsBody',
          buffers: [{ arrayStride: 36, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
          ] }],
        },
        fragment: { module, entryPoint: 'fsBody', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil,
      });
      shadowPipe = await device.createRenderPipelineAsync({
        label: 'creature-contact-shadow',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsShadow' },
        fragment: {
          module, entryPoint: 'fsShadow',
          targets: [
            { format: 'rgba16float', blend: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } },
            { format: 'rgb10a2unorm', writeMask: 0 },
          ],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthStencil, depthWriteEnabled: false },
      });
      vbuf = makeBuffer(device, { label: 'creature-vertices', size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(vbuf, 0, mesh.vertices);
      ibuf = makeBuffer(device, { label: 'creature-indices', size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ibuf, 0, mesh.indices);
      ubuf = makeBuffer(device, { label: 'creature-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ubuf, 0, data);
      sbuf = makeBuffer(device, { label: 'creature-beings', size: beings.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({ label: 'creatures', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }] });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!bodyPipe || !count) return;
      if (dirty) { ctx.device.queue.writeBuffer(sbuf, 0, beings); dirty = false; }
      const pass = encoder.beginRenderPass({
        label: 'creatures',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('creatures'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(shadowPipe);
      pass.draw(6, count);
      pass.setPipeline(bodyPipe);
      pass.setVertexBuffer(0, vbuf);
      pass.setIndexBuffer(ibuf, 'uint32');
      pass.drawIndexed(mesh.indices.length, count);
      pass.end();
    },
  };
}
