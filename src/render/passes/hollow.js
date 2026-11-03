// @ts-check
// The Hollow's pass (H3a; hollow-draw.wgsl): the first pass of a frame while you are down in the
// Hollow, so it clears the targets itself. It draws a floor's rock, its standing water, the way up
// and down and the lantern you carry, lit only by that lantern: its shadows are soft-traced through
// the floor's own signed field, uploaded as a 3D texture (half floats, about 3 to 6 MB a floor). A
// second pass object, the veil, runs after the walker and ghosts back the rock cut away from the view.
// The world module (src/world/hollow/zone-live.js) gives it the meshes, the field and, each frame,
// the light.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

/** HollowUniforms' floats (hollow-draw.wgsl). */
export const HOLLOW_FLOATS = 56;
/** The floats the world module sets each frame (setUniforms); the rock scan's 8 are the pass's own. */
const SET_FLOATS = 48;
/** Floats a vertex: position, normal, colour (rgb, a: 0 rock, 1 a made thing, 2 glowing glass, 3 water, 4 and 5 the carried lantern). */
const VERT = 10;

/** A float as a half float's bits (round to nearest). @param {number} v */
export function toHalf(v) {
  const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0];
  const sign = (u >>> 16) & 0x8000, e = ((u >>> 23) & 0xff) - 127 + 15, m = u & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  const h = sign | (e << 10) | (m >>> 13);
  return (m & 0x1000) ? h + 1 : h;
}

/**
 * @param {{ active: () => boolean, ground?: import('../ground-detail.js').GroundDetail,
 *   scan?: { rockTileM: number, cliffTileM: number, strength: number, normal: number, mean: number[], bumpKeep: number } }} o
 *   active: the Hollow is the zone drawn now; ground and scan: the island's scanned rock drawn on the
 *   Hollow's, triplanar, as the stack's mouth does (decision 0001)
 */
export function createHollowPass(o) {
  /** @type {GPURenderPipeline} */ let rockPipe;
  /** @type {GPURenderPipeline} */ let veilPipe;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** @type {GPUBindGroup | null} */ let group = null;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUTexture | null} */ let fieldTex = null;
  /** @type {GPUSampler} */ let sampler;
  /** The ground detail's version the group was made with (its maps swap in when they load). */
  let groupVersion = -1;
  /** A one-layer stand-in for the scan's maps when there is no ground detail. @type {{ a: GPUTextureView, b: GPUTextureView, sampler: GPUSampler } | null} */
  let plain = null;
  /** @type {GPUDevice} */ let device;
  const uniform = new Float32Array(HOLLOW_FLOATS);
  /** @type {Record<string, { vbuf: GPUBuffer, ibuf: GPUBuffer, count: number }>} */ const meshes = {};
  /** @type {Record<string, { data: Float32Array, idx: Uint32Array }>} */ const pending = {};
  /** @type {{ data: Uint16Array, n: number[] } | null} */ let pendingField = null;
  let fieldBytes = 0;

  function upload(/** @type {string} */ name, /** @type {{ data: Float32Array, idx: Uint32Array }} */ m) {
    meshes[name]?.vbuf.destroy(); meshes[name]?.ibuf.destroy();
    if (!m.idx.length) { delete meshes[name]; return; }
    const vbuf = makeBuffer(device, { label: `hollow-${name}-v`, size: Math.max(16, m.data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ibuf = makeBuffer(device, { label: `hollow-${name}-i`, size: Math.max(16, Math.ceil(m.idx.byteLength / 4) * 4), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, /** @type {Float32Array<ArrayBuffer>} */ (m.data));
    device.queue.writeBuffer(ibuf, 0, /** @type {Uint32Array<ArrayBuffer>} */ (m.idx));
    meshes[name] = { vbuf, ibuf, count: m.idx.length };
  }
  /** @param {Uint16Array} data @param {number[]} n */
  function uploadField(data, n) {
    fieldTex?.destroy();
    fieldTex = device.createTexture({ label: 'hollow-field', size: [n[0], n[1], n[2]], dimension: '3d', format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: fieldTex }, /** @type {Uint16Array<ArrayBuffer>} */ (data), { bytesPerRow: n[0] * 2, rowsPerImage: n[1] }, [n[0], n[1], n[2]]);
    fieldBytes = data.byteLength;
    group = null;
  }

  /** @param {GPURenderPassEncoder} pass @param {string} name */
  const draw = (pass, name) => {
    const m = meshes[name];
    if (!m) return;
    pass.setVertexBuffer(0, m.vbuf);
    pass.setIndexBuffer(m.ibuf, 'uint32');
    pass.drawIndexed(m.count);
  };
  const bind = () => {
    const G = o.ground, version = G ? G.version : 0;
    if ((!group || version !== groupVersion) && fieldTex) {
      groupVersion = version;
      const maps = G ? { a: G.views.a, b: G.views.b, sampler: G.sampler } : /** @type {NonNullable<typeof plain>} */ (plain);
      group = device.createBindGroup({ label: 'hollow', layout, entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: fieldTex.createView({ dimension: '3d' }) }, { binding: 2, resource: sampler },
        { binding: 3, resource: maps.a }, { binding: 4, resource: maps.b }, { binding: 5, resource: maps.sampler }] });
    }
    return group;
  };

  return {
    name: 'hollow',
    reads: [],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => o.active(),
    VERT,

    /** A mesh to draw (world meters; the lantern at its foot): VERT floats a vertex. @param {'rock' | 'water' | 'things' | 'lantern'} name @param {{ data: Float32Array, idx: Uint32Array }} m */
    setMesh(name, m) { if (device) upload(name, m); else pending[name] = m; },
    /**
     * The floor's signed field (positive in the air), sampled n[0] x n[1] x n[2], x fastest then y:
     * kept as half floats in a 3D texture for the shadows and occlusion. @param {Float32Array} f @param {number[]} n
     */
    setField(f, n) {
      const h = new Uint16Array(f.length);
      for (let i = 0; i < f.length; i++) h[i] = toHalf(f[i]);
      if (device) uploadField(h, n); else pendingField = { data: h, n };
    },
    /** The field texture's size (bytes), for the report. */
    get fieldBytes() { return fieldBytes; },
    /** This frame's light and look: HOLLOW_FLOATS numbers in HollowUniforms' order. @param {ArrayLike<number>} u */
    setUniforms(u) { uniform.set(Array.prototype.slice.call(u, 0, SET_FLOATS)); },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      device = ctx.device;
      const module = await makeShaderModule(device, 'hollow-draw');
      layout = device.createBindGroupLayout({ label: 'group1-hollow', entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '3d', sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
      if (!o.ground) {
        const tex = (/** @type {GPUTextureFormat} */ format, /** @type {number[]} */ px) => {
          const t = device.createTexture({ label: 'hollow-scan-plain', size: [1, 1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
          device.queue.writeTexture({ texture: t }, new Uint8Array(px), { bytesPerRow: 4 }, [1, 1, 1]);
          return t.createView({ dimension: '2d-array' });
        };
        plain = { a: tex('rgba8unorm-srgb', [255, 255, 255, 255]), b: tex('rgba8unorm', [128, 128, 128, 255]), sampler: device.createSampler() };
      }
      sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
      const pl = device.createPipelineLayout({ label: 'hollow', bindGroupLayouts: [ctx.layouts.frame, layout] });
      const vertex = { module, entryPoint: 'vsHollow', buffers: [{ arrayStride: VERT * 4, attributes: [
        { shaderLocation: 0, offset: 0, format: /** @type {GPUVertexFormat} */ ('float32x3') },
        { shaderLocation: 1, offset: 12, format: /** @type {GPUVertexFormat} */ ('float32x3') },
        { shaderLocation: 2, offset: 24, format: /** @type {GPUVertexFormat} */ ('float32x4') }] }] };
      [rockPipe, veilPipe] = await Promise.all([
        device.createRenderPipelineAsync({ label: 'hollow-rock', layout: pl, vertex,
          fragment: { module, entryPoint: 'fsHollow', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' } }),
        device.createRenderPipelineAsync({ label: 'hollow-veil', layout: pl, vertex,
          fragment: { module, entryPoint: 'fsVeil', targets: [{ format: 'rgba16float',
            blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' } }),
      ]);
      ubuf = makeBuffer(device, { label: 'hollow-uniforms', size: HOLLOW_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // Until a floor's field comes, one sample of open air.
      uploadField(pendingField?.data ?? new Uint16Array([toHalf(2)]), pendingField?.n ?? [1, 1, 1]);
      pendingField = null;
      for (const [k, m] of Object.entries(pending)) { upload(k, m); delete pending[k]; }
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!rockPipe) return;
      // The rock scan's numbers (tiles, strength faded in as the maps load, mean albedo), after the frame's own.
      const S = o.scan, G = o.ground;
      uniform.set(S && G ? [1 / S.rockTileM, 1 / S.cliffTileM, S.strength * (G.ready ? G.fade : 0), S.normal, S.mean[0], S.mean[1], S.mean[2], S.bumpKeep]
        : [1, 1, 0, 0, 1, 1, 1, 1], SET_FLOATS);
      device.queue.writeBuffer(ubuf, 0, uniform);
      const g = bind();
      const a = encoder.beginRenderPass({
        label: 'hollow-rock',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          { view: ctx.targets.normalId.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0.5, 0, 0] },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 },
        timestampWrites: ctx.timestampWrites('hollow'),
      });
      if (g) {
        a.setBindGroup(0, ctx.groups.frame);
        a.setBindGroup(1, g);
        a.setPipeline(rockPipe);
        for (const m of ['rock', 'water', 'things', 'lantern']) draw(a, m);
      }
      a.end();
    },

    /** The veil, after the walker is drawn (a second pass object in the graph). @returns {import('../frame-graph.js').Pass} */
    veilPass() {
      return {
        name: 'hollow-veil', reads: ['depth'], writes: ['hdr'], enabled: () => o.active(),
        async setup() {}, resize() {},
        record(encoder, ctx) {
          const g = bind();
          if (!veilPipe || !g || !meshes.rock) return;
          const c = encoder.beginRenderPass({
            label: 'hollow-veil',
            colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store', depthReadOnly: false },
            timestampWrites: ctx.timestampWrites('hollow-veil'),
          });
          c.setBindGroup(0, ctx.groups.frame);
          c.setBindGroup(1, g);
          c.setPipeline(veilPipe);
          draw(c, 'rock');
          c.end();
        },
      };
    },
  };
}
