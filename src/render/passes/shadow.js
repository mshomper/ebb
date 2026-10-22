// @ts-check
// Cascaded shadow maps from the sun, or the moon at night (docs/06, Shadows): practical splits,
// one bounding sphere per split so the cascade size never changes as the camera turns, and the
// light-space origin snapped to whole texels, so shadows do not shimmer while orbiting.

import { mat4, vec3 } from 'wgpu-matrix';
import { makeBuffer, makeShaderModule, makeTexture, untrack } from '../../core/gpu.js';
import { CHUNK_MIN, CHUNK_SIZE } from '../../world/terrain/grid.js';
import { LODS, MAX_CHUNKS, createIndexBuffers, packChunks } from '../terrain-mesh.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const MAX_CASCADES = 3;
const CASCADE_STRIDE = 256;
const TAPS = { pcss: 16, '9tap': 9, '4tap': 4 };

/**
 * @param {{ terrain: import('../../world/terrain/index.js').Terrain, recipe: any, terrainRecipe: any,
 *   tierShadows: { cascades: number, size: number, filter: string }, worldRadius: number,
 *   getEye?: () => ArrayLike<number>, cliffDetailM?: number }} opts
 */
export function createShadowPass(opts) {
  const { terrain, recipe } = opts;
  let cascades = Math.max(1, Math.min(MAX_CASCADES, opts.tierShadows.cascades));
  let size = opts.tierShadows.size;
  /** @type {GPUTexture | null} */ let map = null;
  /** @type {GPUSampler} */ let sampler;
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUBuffer} */ let cascadeBuffer;
  /** @type {{ buffer: GPUBuffer, count: number }[]} */ let indexBuffers = [];
  /** @type {GPUTextureView[]} */ const layerViews = [];
  const chunkData = new Float32Array(MAX_CHUNKS * 4);
  /** @type {{ lod: number, first: number, count: number }[]} */ let draws = [];
  const lodIndex = Math.max(0, LODS.indexOf(recipe.shadowLod));
  /** @type {GPUBuffer | null} */ let shadowChunks = null;
  /** Cliff chunks closer than this (m) cast at full detail, matching the wall as drawn (docs/19). */
  let cliffDetailM = new URLSearchParams(location.search).get('cliffdetail') === '0' ? 0 : opts.cliffDetailM ?? 45;
  /** What the chunk records were last packed for, so they repack only when it changes. */
  let packedKey = '';
  /** Casters beside the terrain (the camp's props): each draws itself into a cascade. @type {ShadowCaster[]} */
  const extra = [];

  /**
   * Every open chunk at the shadow LOD, except cliff chunks near the eye at full detail, so the
   * shadow a wall casts matches the wall as drawn and does not self-shadow in stripes.
   * @param {GPUDevice} device
   */
  function packCasters(device) {
    const eye = opts.getEye?.() ?? [0, 0, 0];
    /** @type {number[][]} */ const byLod = [[], [], []];
    let key = '';
    for (let cz = CHUNK_MIN; cz < CHUNK_MIN + 6; cz++) {
      for (let cx = CHUNK_MIN; cx < CHUNK_MIN + 6; cx++) {
        if (terrain.chunkState(cx, cz) !== 'open') continue;
        const d = Math.hypot(eye[0] - cx * CHUNK_SIZE, eye[1] - 2, eye[2] - cz * CHUNK_SIZE) - CHUNK_SIZE * 0.5;
        const lod = d < cliffDetailM && terrain.cliffs.has(cx, cz) ? 0 : lodIndex;
        byLod[lod].push(cx, cz);
        key += lod;
      }
    }
    if (key === packedKey || !shadowChunks) return;
    packedKey = key;
    draws = packChunks(chunkData, byLod);
    device.queue.writeBuffer(shadowChunks, 0, chunkData);
  }

  // Results of the last update(), read by the lighting uniforms.
  const state = {
    viewProj: [mat4.identity(), mat4.identity(), mat4.identity()],
    splits: [0, 0, 0],
    texel: [0, 0, 0],
    dir: vec3.fromValues(0, 1, 0),
    strength: 0,
    count: cascades,
    taps: TAPS[/** @type {'pcss'} */ (opts.tierShadows.filter)] ?? 9,
    /** Extra normal offset (texels) on upright faces, so cliff walls never self-shadow in stripes. */
    cliffOffset: recipe.cliffNormalOffsetTexels ?? 0,
  };

  /**
   * Fit the cascades to the camera and the light.
   * @param {{ eye: Float32Array, view: Float32Array, proj: Float32Array, near: number, targetDistance: number }} cam
   * @param {ArrayLike<number>} dir  unit vector toward the caster
   * @param {number} strength 0..1
   */
  function update(cam, dir, strength) {
    vec3.copy(/** @type {any} */ (dir), state.dir);
    state.strength = strength;
    const reach = opts.worldRadius * recipe.worldRadiusFactor;
    const near = Math.max(cam.near, cam.targetDistance - reach);
    const far = Math.max(near + recipe.minDistance, cam.targetDistance + reach);
    const tanY = 1 / cam.proj[5];
    const tanX = 1 / cam.proj[0];
    const invView = mat4.inverse(cam.view);
    let prev = near;
    for (let c = 0; c < cascades; c++) {
      const i = (c + 1) / cascades;
      const logSplit = near * Math.pow(far / near, i);
      const linSplit = near + (far - near) * i;
      const split = recipe.splitLambda * logSplit + (1 - recipe.splitLambda) * linSplit;
      state.splits[c] = split;
      fitCascade(c, prev, split, tanX, tanY, invView, dir);
      prev = split;
    }
  }

  /**
   * @param {number} c @param {number} d0 @param {number} d1 @param {number} tanX @param {number} tanY
   * @param {Float32Array} invView @param {ArrayLike<number>} dir
   */
  function fitCascade(c, d0, d1, tanX, tanY, invView, dir) {
    // Bounding sphere of the frustum slice: its size depends only on the split, never on camera turn.
    const corners = [];
    for (const d of [d0, d1]) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push(vec3.transformMat4([sx * tanX * d, sy * tanY * d, -d], invView));
    }
    const center = vec3.create();
    for (const p of corners) vec3.add(center, p, center);
    vec3.scale(center, 1 / corners.length, center);
    let radius = 0;
    for (const p of corners) radius = Math.max(radius, vec3.distance(p, center));
    radius = Math.ceil(radius * 8) / 8;

    const up = Math.abs(dir[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const back = radius + recipe.lightPullBack;
    const eye = [center[0] + dir[0] * back, center[1] + dir[1] * back, center[2] + dir[2] * back];
    const view = mat4.lookAt(eye, center, up);
    const proj = mat4.ortho(-radius, radius, -radius, radius, 0.1, back + radius + recipe.lightPullBack);
    const vp = mat4.multiply(proj, view);
    // Snap the world origin to a whole shadow texel so the map slides in texel steps only.
    const o = vec3.transformMat4([0, 0, 0], vp);
    const half = size / 2;
    const dx = (Math.round(o[0] * half) - o[0] * half) / half;
    const dy = (Math.round(o[1] * half) - o[1] * half) / half;
    const snap = mat4.translation([dx, dy, 0]);
    mat4.multiply(snap, vp, state.viewProj[c]);
    state.texel[c] = (2 * radius) / size;
  }

  return {
    name: 'shadow',
    reads: [],
    writes: ['shadow'],
    enabled: () => true,
    state,
    update,
    /** Another caster (props): it prepares once a frame with the cascades, then draws into each. @param {ShadowCaster} k */
    addCaster(k) { extra.push(k); },
    /** The depth bias the terrain casts with, for other casters' pipelines. */
    get bias() { return { depthBias: recipe.depthBias, depthBiasSlopeScale: recipe.depthBiasSlopeScale }; },

    /** The shadow map and its comparison sampler, created on first call (lighting binds them). @param {GPUDevice} device */
    resources(device) {
      if (!map) {
        const made = makeTexture(device, {
          label: 'shadow-map', size: [size, size, MAX_CASCADES], format: 'depth32float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        map = made;
        sampler ??= device.createSampler({ label: 'shadow-compare', compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
        layerViews.length = 0;
        for (let i = 0; i < MAX_CASCADES; i++) layerViews.push(made.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
      }
      return { view: map.createView({ dimension: '2d-array' }), sampler };
    },

    /**
     * Follow a new quality tier live (S8d-1): the cascade count and filter taps are plain numbers,
     * read every frame. A texture's size cannot change after it is made, so a new map size makes a
     * new shadow map; the old one is destroyed (frames already submitted finish with it first), and
     * the caller must hand resources() to the lighting group again. Returns true when it did.
     * @param {{ cascades: number, size: number, filter: string }} tierShadows
     * @param {GPUDevice} device
     * @param {number} [cliffM] the tier's cliffDetailM
     */
    setTier(tierShadows, device, cliffM) {
      if (cliffM !== undefined && new URLSearchParams(location.search).get('cliffdetail') !== '0') cliffDetailM = cliffM;
      cascades = Math.max(1, Math.min(MAX_CASCADES, tierShadows.cascades));
      state.count = cascades;
      state.taps = TAPS[/** @type {'pcss'} */ (tierShadows.filter)] ?? 9;
      if (tierShadows.size === size && map) return false;
      size = tierShadows.size;
      map?.destroy();
      untrack('shadow-map');
      map = null;
      this.resources(device);
      return true;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      this.resources(device);
      const module = await makeShaderModule(device, 'shadow');
      const layout = device.createBindGroupLayout({
        label: 'shadow',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { hasDynamicOffset: true, minBindingSize: 64 } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {} },
          { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {} },
        ],
      });
      pipeline = await device.createRenderPipelineAsync({
        label: 'shadow',
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vsTerrain' },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less',
          depthBias: recipe.depthBias, depthBiasSlopeScale: recipe.depthBiasSlopeScale,
        },
      });
      cascadeBuffer = makeBuffer(device, { label: 'shadow-cascades', size: CASCADE_STRIDE * MAX_CASCADES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const chunkBuffer = makeBuffer(device, { label: 'shadow-chunks', size: MAX_CHUNKS * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const skirtBuffer = makeBuffer(device, { label: 'shadow-skirt', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(skirtBuffer, 0, new Float32Array([opts.terrainRecipe.render.skirtDepth, 0, 0, 0]));
      indexBuffers = createIndexBuffers(device);
      shadowChunks = chunkBuffer;
      group = device.createBindGroup({
        label: 'shadow',
        layout,
        entries: [
          { binding: 0, resource: { buffer: cascadeBuffer, size: 64 } },
          { binding: 1, resource: { buffer: chunkBuffer } },
          { binding: 2, resource: terrain.gpu.height.createView() },
          { binding: 3, resource: { buffer: skirtBuffer } },
        ],
      });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      packCasters(ctx.device);
      const data = new Float32Array((CASCADE_STRIDE / 4) * MAX_CASCADES);
      for (let c = 0; c < cascades; c++) data.set(state.viewProj[c], (c * CASCADE_STRIDE) / 4);
      ctx.device.queue.writeBuffer(cascadeBuffer, 0, data);
      const casting = state.strength > 0 ? extra.filter((k) => k.prepare(ctx.device, data, CASCADE_STRIDE)) : [];
      // One timing for all cascades: start stamp on the first pass, end stamp on the last.
      const ts = ctx.timestampWrites('shadow');
      for (let c = 0; c < cascades; c++) {
        /** @type {GPURenderPassTimestampWrites | undefined} */
        let stamp;
        if (ts && (c === 0 || c === cascades - 1)) {
          stamp = { querySet: ts.querySet };
          if (c === 0) stamp.beginningOfPassWriteIndex = ts.beginningOfPassWriteIndex;
          if (c === cascades - 1) stamp.endOfPassWriteIndex = ts.endOfPassWriteIndex;
        }
        const pass = encoder.beginRenderPass({
          label: `shadow-${c}`,
          colorAttachments: [],
          depthStencilAttachment: { view: layerViews[c], depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
          timestampWrites: stamp,
        });
        if (state.strength > 0) {
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group, [c * CASCADE_STRIDE]);
          for (const d of draws) {
            const ib = indexBuffers[d.lod];
            pass.setIndexBuffer(ib.buffer, 'uint16');
            pass.drawIndexed(ib.count, d.count, 0, 0, d.first);
          }
          for (const k of casting) k.cast(pass, c * CASCADE_STRIDE);
        }
        pass.end();
      }
    },
  };
}

/** @typedef {ReturnType<typeof createShadowPass>} ShadowPass */
/**
 * @typedef {{ prepare: (device: GPUDevice, cascades: Float32Array, stride: number) => boolean,
 *   cast: (pass: GPURenderPassEncoder, offset: number) => void }} ShadowCaster
 *   prepare: once a frame, with every cascade's view-projection at stride bytes apart; false casts nothing.
 *   cast: draw into the cascade whose matrix sits at offset (bytes) in what prepare was given.
 */
