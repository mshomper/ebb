// @ts-check
// Props pass (docs/future/13 section 3.4): Matt's made models drawn with their own paint maps
// (base colour, roughness, normal) instead of vertex colour: the camp's tent, fire ring, fire wood
// and lantern now, E2's piles later. Each model loads from a .glb (src/render/gltf.js, the web
// copies in assets/models/camp/: meters, Y up, origin at the base centre, front +Z); each prop names
// the model it wears and where it stands. A soft contact shadow goes under each one first, and the
// props cast into the sun's shadow map (the shadow pass's addCaster). Lit by prop-draw.wgsl.

import { makeBuffer, makeShaderModule, makeTexture } from '../../core/gpu.js';
import { readGlb, meshesByName, materialMaps } from '../gltf.js';
import { liftAt, liftLook, liftLookVersion, liftVersion } from '../lift.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const MAX = 64;
// at, more, look, shade, tilt (a held prop's pitch and roll), then burn (a star fire's log, raw clay).
const PROP_FLOATS = 24;
// position, normal, uv, then a vertex colour (a model made in code, painted in COLOR_0; white otherwise).
const VERTEX_BYTES = 44;

/**
 * @typedef {Object} Prop
 * @property {string} key       the model (loadModel's key)
 * @property {number} x @property {number} y @property {number} z   its origin (the ground under it)
 * @property {number} yaw       radians; 0 leaves its +z facing +z (piece-draw.wgsl turn)
 * @property {number} [scale]   1 as made
 * @property {number} [char]    0..1 how burnt (a fire's wood)
 * @property {number} [glow]    0..1 its embers' glow
 * @property {number} [squash]  its height as a share of the model's (1 as made)
 * @property {number[]} [shade] contact shadow: half sizes along its own x and z (m), darkness 0..1
 * @property {number} [dry]     0..1 how dried a plant is (a herb bunch on the rack): its green goes to straw
 * @property {number} [pitch] @property {number} [roll]  tipped before its yaw (radians)
 * @property {number} [stretch] its length along its own x as a share of the model's (a log burnt shorter)
 * @property {number} [endChar] 0..1 how far along its own x, from its -x end, it is burnt (a star fire's
 *   log: the end in the fire); with it, char and glow sit at that end instead of rising from the bottom
 * @property {number} [halfX]   the model's half length along its own x (m), for endChar
 * @property {number} [raw]     0..1 unfired clay: pale, dry and matte (a shaped piece waiting to be fired)
 */

/**
 * @typedef {{ albedo?: number, rough?: number, normal?: number, normalY?: number, roughness?: number }} PropLook
 *   albedo: base colour scale; rough: roughness scale; normal: normal map strength; normalY: the
 *   normal map's green sign (-1 when read with derivative tangents, as three.js does for glTF);
 *   roughness: a model painted in vertex colours with no maps (a piece made in code), its roughness
 */

/**
 * One paint map as a mipmapped texture: each level a resized copy of the image (high quality).
 * @param {GPUDevice} device @param {{ bytes: Uint8Array, mimeType: string } | null} img
 * @param {GPUTextureFormat} format @param {number[]} fallback rgba 0..255 for a missing map
 * @param {string} label
 */
export async function mapTexture(device, img, format, fallback, label) {
  if (!img || typeof createImageBitmap !== 'function') {
    const t = makeTexture(device, { label, size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(fallback), { bytesPerRow: 4 }, [1, 1]);
    return t;
  }
  const raw = format.endsWith('srgb') ? {} : { colorSpaceConversion: /** @type {ColorSpaceConversion} */ ('none') };
  const bmp = await createImageBitmap(new Blob([/** @type {BlobPart} */ (img.bytes)], { type: img.mimeType }), { premultiplyAlpha: 'none', ...raw });
  const levels = Math.floor(Math.log2(Math.max(bmp.width, bmp.height))) + 1;
  const t = makeTexture(device, { label, size: [bmp.width, bmp.height], format, mipLevelCount: levels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  for (let l = 0; l < levels; l++) {
    const w = Math.max(1, bmp.width >> l), h = Math.max(1, bmp.height >> l);
    const src = l === 0 ? bmp : await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none', ...raw });
    device.queue.copyExternalImageToTexture({ source: src }, { texture: t, mipLevel: l }, [w, h]);
    if (src !== bmp) src.close();
  }
  bmp.close();
  return t;
}

/** Floats a vertex: position, normal, uv, colour. */
const VF = VERTEX_BYTES / 4;

/**
 * A model's meshes joined into one, packed for the pass: position, normal, uv and a vertex colour
 * (11 floats a vertex). The colour is the model's own COLOR_0 (a piece made in code, its paint in
 * linear vertex colours), else white, so the paint map alone gives its colour. Pure.
 * @param {ArrayBuffer} buffer @returns {{ data: Float32Array, indices: Uint32Array, maps: ReturnType<typeof materialMaps>, bounds: number[], painted: boolean }}
 *   bounds: [minX, minY, minZ, maxX, maxY, maxZ]; painted: it carries vertex colours
 */
export function packModel(buffer) {
  const glb = readGlb(buffer);
  const parts = [...meshesByName(glb).values()];
  if (!parts.length) throw new Error('no meshes');
  const count = parts.reduce((s, p) => s + p.attributes.POSITION.length / 3, 0);
  const data = new Float32Array(count * VF);
  const indices = new Uint32Array(parts.reduce((s, p) => s + p.indices.length, 0));
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let v0 = 0, i0 = 0, painted = false;
  for (const p of parts) {
    const pos = p.attributes.POSITION, nor = p.attributes.NORMAL, uv = p.attributes.TEXCOORD_0, col = p.attributes.COLOR_0;
    const n = pos.length / 3;
    // A colour is 3 or 4 numbers a vertex, as floats or normalized integers.
    const cn = col ? col.length / n : 0, norm = col instanceof Uint8Array ? 255 : col instanceof Uint16Array ? 65535 : 1;
    if (col) painted = true;
    for (let i = 0; i < n; i++) {
      const o = (v0 + i) * VF;
      for (let k = 0; k < 3; k++) {
        data[o + k] = pos[i * 3 + k];
        bounds[k] = Math.min(bounds[k], pos[i * 3 + k]);
        bounds[k + 3] = Math.max(bounds[k + 3], pos[i * 3 + k]);
      }
      data[o + 3] = nor ? nor[i * 3] : 0; data[o + 4] = nor ? nor[i * 3 + 1] : 1; data[o + 5] = nor ? nor[i * 3 + 2] : 0;
      data[o + 6] = uv ? uv[i * 2] : 0; data[o + 7] = uv ? uv[i * 2 + 1] : 0;
      for (let k = 0; k < 3; k++) data[o + 8 + k] = col ? col[i * cn + k] / norm : 1;
    }
    for (let k = 0; k < p.indices.length; k++) indices[i0 + k] = p.indices[k] + v0;
    v0 += n;
    i0 += p.indices.length;
  }
  return { data, indices, maps: materialMaps(glb), bounds, painted };
}

/**
 * @param {{ name?: string, recipe: { ember: number[], emberNits: number, emberHz: number, charAlbedo: number[], dryTint?: number[], dryMix?: number, rawAlbedo?: number[], rawKeep?: number },
 *   bias?: { depthBias: number, depthBiasSlopeScale: number } }} opts
 *   recipe: recipes/world/camp.json props (the embers' glow and the charcoal's albedo); bias: the
 *   shadow pass's, so the props' shadows match the terrain's
 */
export function createPropsPass(opts) {
  const R = opts.recipe;
  /** @type {GPUDevice | null} */ let device = null;
  /** @type {Map<string, { pack: { data: Float32Array, indices: Uint32Array, maps: ReturnType<typeof materialMaps>, bounds: number[] }, look: PropLook,
   *   color?: number[], roughByte?: number, vbuf?: GPUBuffer, ibuf?: GPUBuffer, group?: GPUBindGroup, loading?: boolean }>} */
  const models = new Map();
  const inst = new Float32Array(MAX * PROP_FLOATS);
  /** @type {{ key: string, first: number, count: number }[]} */ let groups = [];
  let count = 0, dirty = true, liftSeen = -1, lookSeen = -1;
  /** The draw uniform: ember glow, charcoal, the lift's tint and rim (src/render/lift.js liftLook), a dried plant's tint, then raw clay's. */
  const uniform = new Float32Array(24);
  /** @type {GPURenderPipeline} */ let drawPipe;
  /** @type {GPURenderPipeline} */ let shadePipe;
  /** @type {GPURenderPipeline | null} */ let castPipe = null;
  /** @type {GPUBindGroupLayout} */ let mapLayout;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUSampler} */ let sampler;
  /** @type {GPUBuffer | null} */ let castBuf = null;
  /** @type {GPUBindGroup | null} */ let castGroup = null;
  const castBias = opts.bias ?? null;

  /** Put a model on the GPU once there is a device and its maps are read. @param {string} key */
  async function upload(key) {
    const m = models.get(key);
    if (!device || !m || m.vbuf || m.loading) return;
    m.loading = true;
    const d = device;
    const [base, rough, normal] = await Promise.all([
      mapTexture(d, m.pack.maps.baseColor, 'rgba8unorm-srgb', m.color ?? [180, 180, 180, 255], `prop-${key}-base`),
      mapTexture(d, m.pack.maps.metallicRoughness, 'rgba8unorm', [0, m.roughByte ?? 200, 0, 255], `prop-${key}-rough`),
      mapTexture(d, m.pack.maps.normal, 'rgba8unorm', [128, 128, 255, 255], `prop-${key}-normal`),
    ]);
    m.group = d.createBindGroup({ label: `prop-${key}`, layout: mapLayout, entries: [
      { binding: 0, resource: base.createView() }, { binding: 1, resource: rough.createView() },
      { binding: 2, resource: normal.createView() }, { binding: 3, resource: sampler }] });
    const vbuf = makeBuffer(d, { label: `prop-${key}-vertices`, size: m.pack.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, m.pack.data);
    const ibuf = makeBuffer(d, { label: `prop-${key}-indices`, size: m.pack.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, m.pack.indices);
    m.vbuf = vbuf; m.ibuf = ibuf;
    m.loading = false;
  }

  const vertexLayout = /** @type {GPUVertexBufferLayout[]} */ ([{ arrayStride: VERTEX_BYTES, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' },
    { shaderLocation: 3, offset: 32, format: 'float32x3' },
  ] }]);
  const castLayout = /** @type {GPUVertexBufferLayout[]} */ ([{ arrayStride: VERTEX_BYTES, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]);

  /** Draw every group's props, the vertex buffers bound per model. @param {GPURenderPassEncoder} pass @param {boolean} maps */
  function drawGroups(pass, maps) {
    for (const g of groups) {
      const m = models.get(g.key);
      if (!m?.vbuf || !m.ibuf || !m.group) continue;
      if (maps) pass.setBindGroup(3, m.group);
      pass.setVertexBuffer(0, m.vbuf);
      pass.setIndexBuffer(m.ibuf, 'uint32');
      pass.drawIndexed(m.pack.indices.length, g.count, 0, 0, g.first);
    }
  }

  /** The props' records to the GPU when they changed (the shadow pass reads them first). @param {GPUDevice} d */
  function flush(d) {
    if (!sbuf) return;
    if (lookSeen !== liftLookVersion() && ubuf) { lookSeen = liftLookVersion(); uniform.set(liftLook, 8); d.queue.writeBuffer(ubuf, 0, uniform); }
    // The lift (F5): each prop's from where it stands, rewritten only when a lift may have changed.
    if (liftSeen !== liftVersion() || dirty) {
      liftSeen = liftVersion();
      for (let i = 0; i < count; i++) {
        const k = i * PROP_FLOATS, v = liftAt('props', inst[k], inst[k + 2]);
        if (inst[k + 15] !== v) { inst[k + 15] = v; dirty = true; }
      }
    }
    if (dirty) { d.queue.writeBuffer(sbuf, 0, inst, 0, count * PROP_FLOATS); dirty = false; }
  }

  /** @type {import('./shadow.js').ShadowCaster} */
  const caster = {
    prepare(d, cascades) {
      if (!castPipe || !count || !castBuf) return false;
      flush(d);
      d.queue.writeBuffer(castBuf, 0, cascades);
      return true;
    },
    cast(pass, offset) {
      if (!castPipe || !castGroup) return;
      pass.setPipeline(castPipe);
      pass.setBindGroup(0, castGroup, [offset]);
      drawGroups(pass, false);
    },
  };

  const pass = {
    name: opts.name ?? 'props',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => count > 0,
    caster,

    /**
     * Load a model from a .glb file; its props draw once it is on the GPU. @param {string} key
     * @param {string | URL} url @param {PropLook} [look] @returns {Promise<number[]>} its bounds
     */
    async loadModel(key, url, look = {}) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pack = packModel(await r.arrayBuffer());
      // A model painted in vertex colours with no paint map: its colour is all in the vertices.
      models.set(key, { pack, look, ...(pack.painted && !pack.maps.baseColor ? { color: [255, 255, 255, 255], roughByte: Math.round((look.roughness ?? 0.85) * 255) } : {}) });
      await upload(key);
      dirty = true;
      return pack.bounds;
    },

    /**
     * A small made mesh with no paint maps (the fire steel and its flint): one colour and roughness.
     * @param {string} key @param {{ data: Float32Array, indices: Uint32Array }} mesh 8 floats a vertex
     * @param {number[]} srgb its colour (sRGB 0..255) @param {number} roughness 0..1 @param {PropLook} [look]
     */
    addMesh(key, mesh, srgb, roughness, look = {}) {
      const maps = { baseColor: null, metallicRoughness: null, normal: null };
      // Into the pass's layout: its 8 floats a vertex, then a white vertex colour.
      const n = mesh.data.length / 8, data = new Float32Array(n * VF);
      for (let i = 0; i < n; i++) { data.set(mesh.data.subarray(i * 8, i * 8 + 8), i * VF); data.fill(1, i * VF + 8, i * VF + 11); }
      models.set(key, { pack: { data, indices: mesh.indices, maps, bounds: [], painted: false }, look, color: [...srgb, 255], roughByte: Math.round(roughness * 255) });
      upload(key);
      dirty = true;
    },

    /** Is this model ready to draw? @param {string} key */
    ready: (key) => !!models.get(key)?.vbuf,

    /** The props this frame. @param {Prop[]} list */
    setProps(list) {
      const rows = list.filter((p) => models.has(p.key)).slice(0, MAX);
      rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      count = rows.length;
      groups = [];
      inst.fill(0);
      rows.forEach((p, i) => {
        const L = /** @type {any} */ (models.get(p.key)).look;
        const sh = p.shade ?? [0, 0, 0];
        inst.set([p.x, p.y, p.z, p.yaw, p.scale ?? 1, p.char ?? 0, p.glow ?? 0, p.squash ?? 1,
          L.albedo ?? 1, L.rough ?? 1, L.normal ?? 1, L.normalY ?? -1, sh[0], sh[1], sh[2], 0, p.pitch ?? 0, p.roll ?? 0, p.dry ?? 0, 0,
          p.stretch ?? 1, p.endChar ?? 0, p.halfX ?? 0.2, p.raw ?? 0], i * PROP_FLOATS);
        const last = groups[groups.length - 1];
        if (last && last.key === p.key) last.count++;
        else groups.push({ key: p.key, first: i, count: 1 });
      });
      dirty = true;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      // The device is kept only once the layouts and sampler exist, so a model that loads meanwhile waits.
      const d = ctx.device;
      const module = await makeShaderModule(d, 'prop-draw');
      const layout = d.createBindGroupLayout({ label: 'group2-props', entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ] });
      mapLayout = d.createBindGroupLayout({ label: 'group3-prop-maps', entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ] });
      sampler = d.createSampler({ label: 'prop-maps', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
        addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });
      const pl = d.createPipelineLayout({ label: 'props', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout, mapLayout] });
      const depthStencil = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: true, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      drawPipe = await d.createRenderPipelineAsync({
        label: 'prop-draw', layout: pl,
        vertex: { module, entryPoint: 'vsProp', buffers: vertexLayout },
        fragment: { module, entryPoint: 'fsProp', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil,
      });
      const shadeLayout = d.createPipelineLayout({ label: 'prop-shade', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      shadePipe = await d.createRenderPipelineAsync({
        label: 'prop-contact-shadow', layout: shadeLayout,
        vertex: { module, entryPoint: 'vsShade' },
        fragment: { module, entryPoint: 'fsShade', targets: [
          { format: 'rgba16float', blend: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } },
          { format: 'rgb10a2unorm', writeMask: 0 }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthStencil, depthWriteEnabled: false },
      });
      ubuf = makeBuffer(d, { label: 'prop-draw', size: uniform.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const e = R.ember, k = R.emberNits;
      uniform.set([e[0] * k, e[1] * k, e[2] * k, R.emberHz, ...R.charAlbedo, 0]);
      uniform.set([...(R.dryTint ?? [1, 1, 1]), R.dryMix ?? 0], 16);
      uniform.set([...(R.rawAlbedo ?? [0.5, 0.45, 0.37]), R.rawKeep ?? 0.3], 20);
      lookSeen = -1;
      sbuf = makeBuffer(d, { label: 'prop-instances', size: inst.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = d.createBindGroup({ label: 'props', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }] });

      // Into the shadow map: depth only, with the terrain's bias.
      const castModule = await makeShaderModule(d, 'prop-cast');
      const castBind = d.createBindGroupLayout({ label: 'prop-cast', entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { hasDynamicOffset: true, minBindingSize: 64 } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ] });
      castPipe = await d.createRenderPipelineAsync({
        label: 'prop-cast', layout: d.createPipelineLayout({ bindGroupLayouts: [castBind] }),
        vertex: { module: castModule, entryPoint: 'vsCast', buffers: castLayout },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', ...(castBias ?? {}) },
      });
      castBuf = makeBuffer(d, { label: 'prop-cascades', size: 256 * 3, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      castGroup = d.createBindGroup({ label: 'prop-cast', layout: castBind, entries: [
        { binding: 0, resource: { buffer: castBuf, size: 64 } }, { binding: 1, resource: { buffer: sbuf } }] });
      device = d;
      // Models that loaded meanwhile go up in the background: the first frame never waits on their maps.
      for (const key of models.keys()) upload(key);
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!drawPipe || !count) return;
      flush(ctx.device);
      const rp = encoder.beginRenderPass({
        label: 'props',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites(pass.name),
      });
      rp.setBindGroup(0, ctx.groups.frame);
      rp.setBindGroup(1, ctx.groups.lighting);
      rp.setBindGroup(2, group);
      rp.setPipeline(shadePipe);
      rp.draw(6, count);
      rp.setPipeline(drawPipe);
      drawGroups(rp, true);
      rp.end();
    },
  };
  return pass;
}

/** @typedef {ReturnType<typeof createPropsPass>} PropsPass */
