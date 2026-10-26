// @ts-check
// Creatures pass (doc 11): baked creature bodies skinned by their bones, after the plants and before
// the water, so the water's scene copy shows a body half under the surface. A soft contact shadow
// is multiplied in under each one first. Bodies come as several meshes (a species' seeded variants
// at a few levels of detail); each individual names the mesh it wears and brings its bone
// matrices. The frog size preview (?frogscale) uses it too, with one unskinned mesh.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { packMesh, VERTEX_BYTES, MAX_BONES } from '../../world/creatures/bodies.js';
import { liftAt, liftLook, liftLookVersion, liftVersion } from '../lift.js';
import { materialMaps } from '../gltf.js';
import { mapTexture } from './props.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 48;
const MAX = 128;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Floats after the usual 12 in creature-draw.wgsl: a turtle's shell plates and its drying. */
const SHELL_FLOATS = 52;
/** Then the lift's look (src/render/lift.js liftLook): tint and rim. */
const LIFT_FLOATS = 8;

/**
 * The shell and drying block for creature-draw.wgsl (all zero for a body with neither): the shell
 * piece's scutes (body.prims[].scutes, as body-bake.js bakes them) and wetSpecular's dry look.
 * @param {any} body a species recipe's body @returns {Float32Array}
 */
export function shellBlock(body) {
  const out = new Float32Array(SHELL_FLOATS);
  const q = body.prims?.find((/** @type {any} */ p) => p.scutes);
  const A = body.albedo ?? {};
  if (q) {
    const S = q.scutes, list = [...S.vertebral, ...S.costal].slice(0, 12);
    out.set([1, q.cutY ?? -1, S.seamW, S.grooveDark ?? 0.35,
      q.c[0], q.c[1], q.c[2], S.streakShare ?? 0,
      q.r[0], q.r[1], q.r[2], S.streakFrom ?? 0,
      S.c[0], S.c[1], S.rx, S.rz,
      S.costalU, S.marginalR, S.marginals, S.streaks ?? 0,
      S.streakW ?? 0, S.dotScale ?? 0, S.dotCut ?? 1, S.vertebral.length], 0);
    out.set(list, 24);
    out.set([...(A.shell ?? A.back), Math.min(S.costal.length, 12 - S.vertebral.length)], 36);
    out.set([...(A.seam ?? A.back), 0, ...(A.fleck ?? A.back), 0], 40);
  }
  const W = body.wetSpecular ?? {};
  if (W.wetDarken) out.set([W.dryRoughness ?? W.roughness, W.dryStrength ?? W.strength, W.wetDarken, 0], 48);
  return out;
}

/**
 * @typedef {{ x: number, y: number, z: number, yaw: number, size: number, mesh?: string, bones?: Float32Array | null, dry?: number }} Being
 *   mesh: which mesh it wears (setMesh's key; the first mesh when left out); bones: its bone
 *   matrices, 16 floats a bone (none: the body as baked); dry: 0 wet .. 1 dry (a basking turtle).
 *   Its lift (F5, hovered or chosen) is not set here: the pass reads it each frame from
 *   src/render/lift.js liftAt(its lift group, x, z), so every list of beings gets it alike.
 */

/**
 * @param {{ recipe: any, mesh?: { vertices: Float32Array, indices: Uint32Array, count: number }, eyeBones?: number[], maxBones?: number,
 *   name?: string, shader?: string, extraFloats?: number, liftGroup?: import('../lift.js').LiftGroup, maps?: boolean }} opts
 *   recipe: the species recipe (recipes/species/<id>.json); mesh: one unskinned mesh to start with (the size preview);
 *   eyeBones: the two bones the eyes follow, for their wet glint (body.eyeGlint); shader: another draw shader with the
 *   same bindings (the walker's figure-draw); extraFloats: more uniform floats after the usual 12, set by setExtra;
 *   liftGroup: what its beings are for the lift ('beings' unless said: the camp's piles and pickups say theirs);
 *   maps: the shader reads baked colour and normal maps (bindings 3 to 5; setMaps gives them)
 */
export function createCreaturePass(opts) {
  const { recipe } = opts;
  const liftGroup = opts.liftGroup ?? 'beings';
  const W = recipe.body.wetSpecular;
  const bodyLength = recipe.body.scaleReal[0] + (recipe.body.scaleReal[1] - recipe.body.scaleReal[0]) / 2;
  // The game's own draw shader carries a turtle's shell plates and drying after the usual 12 floats.
  const extra = opts.extraFloats ?? (opts.shader ? 0 : SHELL_FLOATS + LIFT_FLOATS);
  const drawBytes = Math.ceil((DRAW_BYTES + extra * 4) / 16) * 16;
  const data = new Float32Array(drawBytes / 4);
  let uniformDirty = false;
  // Wet eyes: the skin that follows these two bones (none for the unskinned size preview).
  const G = recipe.body.eyeGlint, eyes = opts.eyeBones ?? [-1, -1];
  // A body that swims or flies casts no contact shadow (body.contactShadow 0: minnows, dragonflies).
  const contact = recipe.body.contactShadow ?? 0.55;
  data.set([W.roughness, W.strength, contact, 0.62, bodyLength, 0, 0, 0,
    eyes[0], eyes[1], G?.roughness ?? 0.1, G ? G.strength : 0]);
  if (!opts.shader) data.set(shellBlock(recipe.body), DRAW_BYTES / 4);
  const beings = new Float32Array(MAX * 8);
  // Bones per individual: the frogs' rig by default; a pass may ask for more (the hermit crab's).
  const boneCap = opts.maxBones ?? MAX_BONES;
  const bones = new Float32Array(MAX * boneCap * 16);
  /** Meshes by key, on the CPU until the GPU has them. @type {Map<string, { data: ArrayBuffer, indices: Uint32Array, vbuf?: GPUBuffer, ibuf?: GPUBuffer }>} */
  const meshes = new Map();
  /** Draw groups this frame: a mesh and the run of individuals that wear it. @type {{ key: string, first: number, count: number }[]} */
  let groups = [];
  let count = 0, dirty = true, liftSeen = -1, lookSeen = -1;
  /** @type {GPUDevice | null} */ let device = null;
  /** @type {GPURenderPipeline} */ let bodyPipe;
  /** @type {GPURenderPipeline} */ let shadowPipe;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBuffer} */ let bbuf;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUBindGroupLayout} */ let groupLayout;
  // Baked maps (opts.maps: the walker's figure): its colour and normal textures, and their sampler.
  /** @type {GPUTexture[] | null} */ let maps = null;
  /** @type {GPUSampler | null} */ let mapSampler = null;
  /** @type {import('../gltf.js').Glb | null} */ let pendingMaps = null;
  /** The pass's bind group, with the maps if it has them. */
  function bindGroup() {
    if (!device) return;
    group = device.createBindGroup({ label: 'creatures', layout: groupLayout, entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }, { binding: 2, resource: { buffer: bbuf } },
      ...(maps && mapSampler ? [{ binding: 3, resource: maps[0].createView() }, { binding: 4, resource: maps[1].createView() }, { binding: 5, resource: mapSampler }] : [])] });
  }

  /** Put a mesh on the GPU once there is a device. @param {string} key */
  function upload(key) {
    const m = meshes.get(key);
    if (!device || !m || m.vbuf) return;
    m.vbuf = makeBuffer(device, { label: `creature-vertices-${key}`, size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(m.vbuf, 0, m.data);
    m.ibuf = makeBuffer(device, { label: `creature-indices-${key}`, size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(m.ibuf, 0, m.indices);
  }

  const pass = {
    name: opts.name ?? 'creatures',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => count > 0,

    /**
     * Add or replace a mesh: packed vertices (VERTEX_BYTES each, from bodies.js) and indices.
     * @param {string} key @param {{ data: ArrayBuffer, indices: Uint32Array }} mesh
     */
    setMesh(key, mesh) {
      const old = meshes.get(key);
      old?.vbuf?.destroy(); old?.ibuf?.destroy();
      meshes.set(key, { data: mesh.data, indices: mesh.indices });
      upload(key);
      dirty = true;
    },

    /** Is this mesh ready to draw? @param {string} key */
    hasMesh: (key) => meshes.has(key),

    /** The extra uniform floats (after the usual 12), written before the next draw. @param {ArrayLike<number>} values */
    setExtra(values) {
      data.set(values, DRAW_BYTES / 4);
      uniformDirty = true;
    },

    /**
     * Where the individuals are and how they are posed this frame.
     * @param {Being[]} list
     */
    setBeings(list) {
      const keys = [...meshes.keys()];
      const fallback = keys[0];
      // Grouped by mesh, so each mesh draws its individuals in one call.
      const rows = list.slice(0, MAX).map((b) => ({ b, key: b.mesh && meshes.has(b.mesh) ? b.mesh : fallback })).filter((r) => r.key !== undefined);
      rows.sort((a, c) => (a.key < c.key ? -1 : a.key > c.key ? 1 : 0));
      count = rows.length;
      groups = [];
      beings.fill(0);
      rows.forEach((r, i) => {
        const b = r.b;
        beings.set([b.x, b.y, b.z, b.yaw, b.size, i * boneCap, b.dry ?? 0, 0], i * 8);
        if (b.bones) bones.set(b.bones.subarray(0, boneCap * 16), i * boneCap * 16);
        else for (let k = 0; k < boneCap; k++) bones.set(IDENTITY, (i * boneCap + k) * 16);
        const last = groups[groups.length - 1];
        if (last && last.key === r.key) last.count++;
        else groups.push({ key: /** @type {string} */ (r.key), first: i, count: 1 });
      });
      dirty = true;
      liftSeen = -1;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      device = ctx.device;
      const module = await makeShaderModule(device, opts.shader ?? 'creature-draw');
      const layout = device.createBindGroupLayout({
        label: 'group2-creatures',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          // A body with baked maps (the walker's figure): colour, normal and their sampler.
          ...(opts.maps ? [
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          ] : []),
        ],
      });
      groupLayout = layout;
      const pipelineLayout = device.createPipelineLayout({ label: 'creatures', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const depthStencil = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: true, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      bodyPipe = await device.createRenderPipelineAsync({
        label: 'creature-body',
        layout: pipelineLayout,
        vertex: {
          module, entryPoint: 'vsBody',
          buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
            { shaderLocation: 3, offset: 36, format: 'uint8x4' },
            { shaderLocation: 4, offset: 40, format: 'unorm8x4' },
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
      ubuf = makeBuffer(device, { label: opts.shader ? `${pass.name}-draw` : 'creature-draw', size: drawBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ubuf, 0, data);
      sbuf = makeBuffer(device, { label: 'creature-beings', size: beings.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      bbuf = makeBuffer(device, { label: 'creature-bones', size: bones.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      if (opts.maps) {
        mapSampler = device.createSampler({ label: `${pass.name}-maps`, magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
          addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
        // Plain stand-ins until the baked maps are made.
        maps = await Promise.all([mapTexture(device, null, 'rgba8unorm-srgb', [128, 128, 128, 255], `${pass.name}-colour`),
          mapTexture(device, null, 'rgba8unorm', [128, 255, 128, 255], `${pass.name}-normal`)]);
      }
      bindGroup();
      if (pendingMaps) await pass.setMaps(pendingMaps);
      for (const key of meshes.keys()) upload(key);
    },

    /**
     * The body's baked maps (a pass made with maps: true), from a GLB's material: colour (sRGB) and
     * normal, mipmapped. Before the pass is set up they wait for it. @param {import('../gltf.js').Glb} glb
     */
    async setMaps(glb) {
      if (!opts.maps) return;
      if (!device) { pendingMaps = glb; return; }
      pendingMaps = null;
      const m = materialMaps(glb);
      const made = await Promise.all([mapTexture(device, m.baseColor, 'rgba8unorm-srgb', [128, 128, 128, 255], `${pass.name}-colour`),
        mapTexture(device, m.normal, 'rgba8unorm', [128, 255, 128, 255], `${pass.name}-normal`)]);
      maps?.forEach((t) => t.destroy());
      maps = made;
      bindGroup();
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!bodyPipe || !count) return;
      // The lift (F5): each body's from where it stands, rewritten only when a lift may have changed.
      if (liftSeen !== liftVersion()) {
        liftSeen = liftVersion();
        for (let i = 0; i < count; i++) {
          const v = liftAt(liftGroup, beings[i * 8], beings[i * 8 + 2]);
          if (beings[i * 8 + 7] !== v) { beings[i * 8 + 7] = v; dirty = true; }
        }
      }
      if (!opts.shader && lookSeen !== liftLookVersion()) {
        lookSeen = liftLookVersion();
        data.set(liftLook, DRAW_BYTES / 4 + SHELL_FLOATS);
        uniformDirty = true;
      }
      if (dirty) {
        ctx.device.queue.writeBuffer(sbuf, 0, beings, 0, count * 8);
        ctx.device.queue.writeBuffer(bbuf, 0, bones, 0, count * boneCap * 16);
        dirty = false;
      }
      if (uniformDirty) {
        ctx.device.queue.writeBuffer(ubuf, 0, data);
        uniformDirty = false;
      }
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
      if (contact > 0) {
        pass.setPipeline(shadowPipe);
        pass.draw(6, count);
      }
      pass.setPipeline(bodyPipe);
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
  if (opts.mesh) pass.setMesh('plain', { data: packMesh(opts.mesh), indices: opts.mesh.indices });
  return pass;
}
