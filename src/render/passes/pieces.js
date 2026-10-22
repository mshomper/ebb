// @ts-check
// Pieces pass (doc 09, docs/future/10): loose stones and driftwood logs, after the creatures and before the water, so
// the water's scene copy shows a stone at a pond's edge. Each stone is a baked mesh (meshes.js) drawn
// with the island's own scanned rock, triplanar in its own frame (piece-draw.wgsl), posed by one
// bone; a soft damp ring is multiplied into the ground under each stone first. The damp patch a
// lifted stone shows is drawn by the same pipeline, as plain earth.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { VERTEX_BYTES } from '../../world/creatures/bodies.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 96;
/** Floats per piece: at, more, extra (4 each), then its bone (16). */
const PIECE_FLOATS = 28;
// Loose stones and logs, pond stones, and the slabs on every flight of Steps' treads.
const MAX = 512;

/**
 * @typedef {{ x: number, y: number, z: number, yaw: number, size: number, mesh: string, bone: Float32Array,
 *   slope: number[], seed: number, half: number[], plain?: boolean, aspect?: number, moss?: number }} PieceBeing
 *   slope: the ground's rise along the piece's own x and z; half: footprint half width and length
 *   (mesh units); plain: earth, not stone (no rock scan); aspect: a driftwood log's thickness over
 *   its length (its mesh is 1 thick, squeezed by its bone; drawn as wood, not stone); moss: a slab's
 *   moss 0..1 (pond stones and Steps' treads, grown with age)
 */

/**
 * @param {{ ground: import('../ground-detail.js').GroundDetail, recipe: any, terrainRecipe: any }} opts
 *   ground: the scanned ground detail (its rock and rock-face layers); recipe: pieces.json;
 *   terrainRecipe: terrain.json (the rock scans' tiles, roughness and mean albedo)
 */
export function createPiecesPass(opts) {
  const { ground, recipe } = opts;
  const D = opts.terrainRecipe.detail;
  const L = D.layers;
  const data = new Float32Array(DRAW_BYTES / 4);
  data.set([recipe.ring.darkness, recipe.ring.scale, D.f0, 0], 0);
  data.set([...opts.terrainRecipe.materials.albedoRock, recipe.look.normalStrength], 4);
  data.set([L.rock.roughness[0], L.rock.roughness[1], L.cliff.roughness[0], L.cliff.roughness[1]], 8);
  data.set([1 / L.rock.tileMeters, 1 / L.cliff.tileMeters, D.sunTerminator[0], D.sunTerminator[1]], 12);
  const W = recipe.driftwood.look;
  data.set([W.roughness, W.bumpM, W.grainAcross, W.crackDarkness], 16);
  const M = recipe.stepping.moss;
  data.set([...M.albedo, M.band], 20);
  const list = new Float32Array(MAX * PIECE_FLOATS);
  /** @type {Map<string, { data: ArrayBuffer, indices: Uint32Array, vbuf?: GPUBuffer, ibuf?: GPUBuffer }>} */
  const meshes = new Map();
  /** @type {{ key: string, first: number, count: number }[]} */ let groups = [];
  let count = 0, stones = 0, dirty = true;
  /** @type {GPUDevice | null} */ let device = null;
  /** @type {GPURenderPipeline} */ let bodyPipe;
  /** @type {GPURenderPipeline} */ let ringPipe;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup | null} */ let group = null;
  let groupVersion = -1;

  /** @param {string} key */
  function upload(key) {
    const m = meshes.get(key);
    if (!device || !m || m.vbuf) return;
    m.vbuf = makeBuffer(device, { label: `piece-vertices-${key}`, size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(m.vbuf, 0, m.data);
    m.ibuf = makeBuffer(device, { label: `piece-indices-${key}`, size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(m.ibuf, 0, m.indices);
  }

  /** The bind group, rebuilt when the ground detail's arrays are replaced (their maps loading). */
  function bindGroup() {
    if (!device || (group && groupVersion === ground.version)) return group;
    groupVersion = ground.version;
    group = device.createBindGroup({ label: 'pieces', layout, entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } },
      { binding: 2, resource: ground.views.a }, { binding: 3, resource: ground.views.b }, { binding: 4, resource: ground.sampler }] });
    return group;
  }

  return {
    name: 'pieces',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => count > 0,

    /** Add or replace a mesh (bodies.js packMesh layout). @param {string} key @param {{ data: ArrayBuffer, indices: Uint32Array }} mesh */
    setMesh(key, mesh) {
      const old = meshes.get(key);
      old?.vbuf?.destroy(); old?.ibuf?.destroy();
      meshes.set(key, { data: mesh.data, indices: mesh.indices });
      upload(key);
    },

    /** The pieces this frame: stones first (each gets a damp ring), then any damp patches. @param {PieceBeing[]} all */
    setPieces(all) {
      const rows = all.filter((b) => meshes.has(b.mesh)).slice(0, MAX);
      rows.sort((a, b) => Number(!!a.plain) - Number(!!b.plain) || (a.mesh < b.mesh ? -1 : a.mesh > b.mesh ? 1 : 0));
      count = rows.length;
      stones = rows.filter((b) => !b.plain).length;
      groups = [];
      rows.forEach((b, i) => {
        list.set([b.x, b.y, b.z, b.yaw, b.size, b.slope[0], b.slope[1], b.seed, b.half[0], b.half[1], b.plain ? 1 : -(b.moss ?? 0), b.aspect ?? 0], i * PIECE_FLOATS);
        list.set(b.bone, i * PIECE_FLOATS + 12);
        const last = groups[groups.length - 1];
        if (last && last.key === b.mesh) last.count++;
        else groups.push({ key: b.mesh, first: i, count: 1 });
      });
      dirty = true;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      device = ctx.device;
      const module = await makeShaderModule(device, 'piece-draw');
      layout = device.createBindGroupLayout({
        label: 'group2-pieces',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ label: 'pieces', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const depthStencil = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: true, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      bodyPipe = await device.createRenderPipelineAsync({
        label: 'piece-body',
        layout: pipelineLayout,
        vertex: {
          module, entryPoint: 'vsPiece',
          buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
          ] }],
        },
        fragment: { module, entryPoint: 'fsPiece', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil,
      });
      ringPipe = await device.createRenderPipelineAsync({
        label: 'piece-damp-ring',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsRing' },
        fragment: {
          module, entryPoint: 'fsRing',
          targets: [
            { format: 'rgba16float', blend: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } },
            { format: 'rgb10a2unorm', writeMask: 0 },
          ],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthStencil, depthWriteEnabled: false },
      });
      ubuf = makeBuffer(device, { label: 'piece-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      sbuf = makeBuffer(device, { label: 'piece-list', size: list.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      for (const key of meshes.keys()) upload(key);
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const g = bindGroup();
      if (!bodyPipe || !count || !g) return;
      // The rock scan fades in with the ground's own (0 until the maps load).
      data[3] = ground.ready ? ground.fade : 0;
      ctx.device.queue.writeBuffer(ubuf, 0, data);
      if (dirty) { ctx.device.queue.writeBuffer(sbuf, 0, list, 0, count * PIECE_FLOATS); dirty = false; }
      const pass = encoder.beginRenderPass({
        label: 'pieces',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('pieces'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, g);
      if (stones) { pass.setPipeline(ringPipe); pass.draw(6, stones); }
      pass.setPipeline(bodyPipe);
      for (const gr of groups) {
        const m = meshes.get(gr.key);
        if (!m?.vbuf || !m.ibuf) continue;
        pass.setVertexBuffer(0, m.vbuf);
        pass.setIndexBuffer(m.ibuf, 'uint32');
        pass.drawIndexed(m.indices.length, gr.count, 0, 0, gr.first);
      }
      pass.end();
    },
  };
}
