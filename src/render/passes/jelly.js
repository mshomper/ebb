// @ts-check
// Jellyfish pass (doc 13, summer): the moon jellyfish stranded on the strandline, after the opaque
// finds and pieces and before the water, so the water's scene copy shows them too. Translucent and
// premultiplied (jelly-draw.wgsl): each draws over what lies behind it and writes no depth, and a
// soft wet patch darkens the sand under it first. Meshes come from src/world/finds/jelly.js; each
// jellyfish names the mesh it wears (a few seeded variants).

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { JELLY_FLOATS } from '../../world/finds/jelly.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 32;
const MAX = 32;

/**
 * @param {{ look: { roughness: number, specular: number, wetSand: number, wetRadius: number, wrap: number, minNv: number } }} opts
 *   look: finds.json kinds.moonjelly.look
 */
export function createJellyPass(opts) {
  const L = opts.look;
  const data = new Float32Array(DRAW_BYTES / 4);
  data.set([L.roughness, L.specular, L.wetSand, L.wetRadius, L.wrap, L.minNv, 0, 0]);
  const beings = new Float32Array(MAX * 8);
  /** @type {Map<string, { vertices: Float32Array, indices: Uint32Array, vbuf?: GPUBuffer, ibuf?: GPUBuffer }>} */
  const meshes = new Map();
  /** @type {{ key: string, first: number, count: number }[]} */ let groups = [];
  let count = 0, dirty = true;
  /** @type {GPUDevice | null} */ let device = null;
  /** @type {GPURenderPipeline} */ let jellyPipe;
  /** @type {GPURenderPipeline} */ let wetPipe;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;

  /** @param {string} key */
  function upload(key) {
    const m = meshes.get(key);
    if (!device || !m || m.vbuf) return;
    m.vbuf = makeBuffer(device, { label: `jelly-vertices-${key}`, size: m.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(m.vbuf, 0, m.vertices);
    m.ibuf = makeBuffer(device, { label: `jelly-indices-${key}`, size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(m.ibuf, 0, m.indices);
  }

  return {
    name: 'jelly',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => count > 0,

    /** @param {string} key @param {{ vertices: Float32Array, indices: Uint32Array }} mesh */
    setMesh(key, mesh) {
      const old = meshes.get(key);
      old?.vbuf?.destroy(); old?.ibuf?.destroy();
      meshes.set(key, { vertices: mesh.vertices, indices: mesh.indices });
      upload(key);
    },

    /** @param {{ x: number, y: number, z: number, yaw: number, size: number, mesh: string }[]} list */
    setBeings(list) {
      const rows = list.filter((b) => meshes.has(b.mesh)).slice(0, MAX);
      rows.sort((a, c) => (a.mesh < c.mesh ? -1 : a.mesh > c.mesh ? 1 : 0));
      count = rows.length;
      groups = [];
      beings.fill(0);
      rows.forEach((b, i) => {
        beings.set([b.x, b.y, b.z, b.yaw, b.size, 0, 0, 0], i * 8);
        const last = groups[groups.length - 1];
        if (last && last.key === b.mesh) last.count++;
        else groups.push({ key: b.mesh, first: i, count: 1 });
      });
      dirty = true;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      device = ctx.device;
      const module = await makeShaderModule(device, 'jelly-draw');
      const layout = device.createBindGroupLayout({
        label: 'group2-jelly',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ label: 'jelly', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const depthStencil = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: false, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      jellyPipe = await device.createRenderPipelineAsync({
        label: 'jelly-body',
        layout: pipelineLayout,
        vertex: {
          module, entryPoint: 'vsJelly',
          buffers: [{ arrayStride: JELLY_FLOATS * 4, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
            { shaderLocation: 3, offset: 36, format: 'float32' },
          ] }],
        },
        fragment: { module, entryPoint: 'fsJelly', targets: [{ format: 'rgba16float',
          blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil,
      });
      wetPipe = await device.createRenderPipelineAsync({
        label: 'jelly-wet-sand',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsWet' },
        fragment: { module, entryPoint: 'fsWet', targets: [{ format: 'rgba16float',
          blend: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil,
      });
      ubuf = makeBuffer(device, { label: 'jelly-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ubuf, 0, data);
      sbuf = makeBuffer(device, { label: 'jelly-beings', size: beings.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({ label: 'jelly', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }] });
      for (const key of meshes.keys()) upload(key);
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!jellyPipe || !count) return;
      if (dirty) { ctx.device.queue.writeBuffer(sbuf, 0, beings, 0, count * 8); dirty = false; }
      const pass = encoder.beginRenderPass({
        label: 'jelly',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('jelly'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(wetPipe);
      pass.draw(6, count);
      pass.setPipeline(jellyPipe);
      for (const g of groups) {
        const m = meshes.get(g.key);
        if (!m?.vbuf || !m.ibuf) continue;
        pass.setVertexBuffer(0, m.vbuf);
        pass.setIndexBuffer(m.ibuf, 'uint32');
        pass.drawIndexed(m.indices.length, g.count, 0, 0, g.first);
      }
      pass.end();
    },
  };
}
