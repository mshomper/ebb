// @ts-check
// The spring's cave pass (the spring-ore plan, O3; cave-draw.wgsl): the first pass of a frame while
// you are in the cave zone, so it clears the targets itself. It draws the cave's rock, the old
// keeper's pan and the rope, then copies the picture and draws the pool over it (refraction through
// the water reads the stones under it), then the beam of light down the shaft, added on. Its light
// is its own (CaveUniforms): the island's sky and shadows are not down here. The world module
// (src/world/spring/cave-live.js) gives it the meshes and, each frame, the light.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const FLOATS = 56;
/** Floats a vertex: position, normal, colour (rgb albedo, a 1 for a made thing's own). */
const VERT = 10;

/**
 * @param {{ active: () => boolean }} o active: the cave zone is the one drawn now
 */
export function createCavePass(o) {
  /** @type {GPURenderPipeline} */ let rockPipe;
  /** @type {GPURenderPipeline} */ let waterPipe;
  /** @type {GPURenderPipeline} */ let beamPipe;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** The rock's own layout, the uniforms alone (the depth is its attachment there). @type {GPUBindGroupLayout} */ let rockLayout;
  /** @type {GPUBindGroup | null} */ let rockGroup = null;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUTexture | null} */ let copy = null;
  /** @type {GPUBindGroup | null} */ let group = null;
  /** @type {GPUDevice} */ let device;
  const uniform = new Float32Array(FLOATS);
  /** Meshes by name: rock, things (pan and rope), water, beam. @type {Record<string, { vbuf: GPUBuffer, ibuf: GPUBuffer, count: number }>} */
  const meshes = {};
  /** @type {Record<string, { data: Float32Array, idx: Uint32Array }>} */ const pending = {};

  function upload(/** @type {string} */ name, /** @type {{ data: Float32Array, idx: Uint32Array }} */ m) {
    meshes[name]?.vbuf.destroy(); meshes[name]?.ibuf.destroy();
    if (!m.idx.length) { delete meshes[name]; return; }
    const vbuf = makeBuffer(device, { label: `cave-${name}-v`, size: Math.max(16, m.data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ibuf = makeBuffer(device, { label: `cave-${name}-i`, size: Math.max(16, Math.ceil(m.idx.byteLength / 4) * 4), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, m.data);
    device.queue.writeBuffer(ibuf, 0, m.idx);
    meshes[name] = { vbuf, ibuf, count: m.idx.length };
  }

  /** @param {GPURenderPassEncoder} pass @param {string} name */
  const draw = (pass, name) => {
    const m = meshes[name];
    if (!m) return;
    pass.setVertexBuffer(0, m.vbuf);
    pass.setIndexBuffer(m.ibuf, 'uint32');
    pass.drawIndexed(m.count);
  };

  return {
    name: 'cave',
    reads: [],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => o.active(),
    VERT,

    /**
     * A mesh to draw (world meters): VERT floats a vertex, and its triangles. Kept until the device
     * is up. @param {'rock' | 'things' | 'water' | 'beam'} name @param {{ data: Float32Array, idx: Uint32Array }} m
     */
    setMesh(name, m) { if (device) upload(name, m); else pending[name] = m; },
    /** Has the rock been given yet? */
    get ready() { return !!meshes.rock || !!pending.rock; },

    /**
     * This frame's light and look (src/world/spring/cave-live.js caveUniforms): FLOATS numbers in
     * CaveUniforms' order. @param {ArrayLike<number>} u
     */
    setUniforms(u) { uniform.set(u); },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      device = ctx.device;
      const module = await makeShaderModule(device, 'cave-draw');
      layout = device.createBindGroupLayout({
        label: 'group1-cave',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        ],
      });
      rockLayout = device.createBindGroupLayout({ label: 'group1-cave-rock', entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] });
      const pl = device.createPipelineLayout({ label: 'cave', bindGroupLayouts: [ctx.layouts.frame, layout] });
      const rockPl = device.createPipelineLayout({ label: 'cave-rock', bindGroupLayouts: [ctx.layouts.frame, rockLayout] });
      const vertex = (/** @type {string} */ entryPoint) => ({ module, entryPoint, buffers: [{ arrayStride: VERT * 4, attributes: [
        { shaderLocation: 0, offset: 0, format: /** @type {GPUVertexFormat} */ ('float32x3') },
        { shaderLocation: 1, offset: 12, format: /** @type {GPUVertexFormat} */ ('float32x3') },
        { shaderLocation: 2, offset: 24, format: /** @type {GPUVertexFormat} */ ('float32x4') }] }] });
      const depth = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: true, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      [rockPipe, waterPipe, beamPipe] = await Promise.all([
        device.createRenderPipelineAsync({ label: 'cave-rock', layout: rockPl, vertex: vertex('vsCave'),
          fragment: { module, entryPoint: 'fsCave', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth }),
        device.createRenderPipelineAsync({ label: 'cave-water', layout: pl, vertex: vertex('vsWater'),
          fragment: { module, entryPoint: 'fsWater', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' } }),
        device.createRenderPipelineAsync({ label: 'cave-beam', layout: pl, vertex: vertex('vsCave'),
          fragment: { module, entryPoint: 'fsBeam', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' } }),
      ]);
      ubuf = makeBuffer(device, { label: 'cave-uniforms', size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      for (const [k, m] of Object.entries(pending)) { upload(k, m); delete pending[k]; }
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      copy?.destroy();
      copy = ctx.device.createTexture({ label: 'cave-copy', size: [ctx.size[0], ctx.size[1]], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      group = null;
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!rockPipe || !copy) return;
      device.queue.writeBuffer(ubuf, 0, uniform);
      if (!group) group = device.createBindGroup({ label: 'cave', layout, entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: copy.createView() }, { binding: 2, resource: ctx.targets.depth.createView() }] });
      if (!rockGroup) rockGroup = device.createBindGroup({ label: 'cave-rock', layout: rockLayout, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
      // The rock and the made things, clearing the frame (nothing of the island is drawn down here).
      const a = encoder.beginRenderPass({
        label: 'cave-rock',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          { view: ctx.targets.normalId.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0.5, 0, 0] },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
        timestampWrites: ctx.timestampWrites('cave'),
      });
      a.setBindGroup(0, ctx.groups.frame);
      a.setBindGroup(1, rockGroup);
      a.setPipeline(rockPipe);
      draw(a, 'rock');
      draw(a, 'things');
      a.end();
      // The pool over a copy of the picture, so the stones under it show through the water.
      encoder.copyTextureToTexture({ texture: ctx.targets.hdr }, { texture: copy }, [ctx.size[0], ctx.size[1]]);
      const b = encoder.beginRenderPass({
        label: 'cave-water',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
      });
      b.setBindGroup(0, ctx.groups.frame);
      b.setBindGroup(1, group);
      b.setPipeline(waterPipe);
      draw(b, 'water');
      b.end();
    },

    /**
     * The beam, added after the walker is drawn (a second pass object in the graph, after the
     * figure). @returns {import('../frame-graph.js').Pass}
     */
    beamPass() {
      return {
        name: 'cave-beam', reads: ['depth'], writes: ['hdr'], enabled: () => o.active(),
        async setup() {}, resize() {},
        record(encoder, ctx) {
          if (!beamPipe || !group || !meshes.beam) return;
          const c = encoder.beginRenderPass({
            label: 'cave-beam',
            // No depth attachment: the beam tests the depth itself (it reads it as a texture).
            colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
            timestampWrites: ctx.timestampWrites('cave-beam'),
          });
          c.setBindGroup(0, ctx.groups.frame);
          c.setBindGroup(1, /** @type {GPUBindGroup} */ (group));
          c.setPipeline(beamPipe);
          draw(c, 'beam');
          c.end();
        },
      };
    },
  };
}
