// @ts-check
// Mats pass (B3a): the meadow islet's wild thyme, red clover and bird's-foot trefoil as low living
// carpets (mat-shells.wgsl), drawn after the grass into the same HDR, normal and depth targets.
// Where they grow comes from the growth step's mat map (world/growth matTex and matBox): nothing is
// drawn while no mat grows, so the island looks as it did until the islet's clumps go in. Shells
// stand near the eye (the tier's matLayers copies, fewer with distance, one flat copy far off);
// clover's round heads stand on stalks above its mat while it flowers. Look values come from each
// mat's flora recipe (`mat`, `season`, `flowering`, `dormant`, clover's `heads`); nothing here is
// simulated.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_FLOATS = 112;
const MAX_PUSHES = 4;
const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);

/**
 * How far into a season window (season units, 0 spring .. 4) a position is, with soft edges of
 * `soft` season either side; wraps through the year. @param {number} pos @param {number[]} w @param {number} soft
 */
function windowShare(pos, w, soft) {
  let best = 0;
  for (const shift of [-4, 0, 4]) {
    const p = pos + shift;
    const up = Math.min(1, Math.max(0, (p - w[0] + soft) / (2 * soft)));
    const down = Math.min(1, Math.max(0, (w[1] + soft - p) / (2 * soft)));
    best = Math.max(best, Math.min(up, down));
  }
  return best;
}

/**
 * @param {{ growth: { matTex: GPUTexture, matIds: string[], matBox: () => ({ x0: number, z0: number, x1: number, z1: number } | null) },
 *   terrain: import('../../world/terrain/index.js').Terrain, recipes: Record<string, any>, seed: number,
 *   tier: { matLayers?: number, grassDistance: number } }} opts
 *   recipes: the mats' flora recipes by species id (growth.json `cover`)
 */
export function createMatsPass(opts) {
  const { growth, terrain } = opts;
  /** @type {GPURenderPipeline} */ let shellPipe;
  /** @type {GPURenderPipeline} */ let headPipe;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUBuffer} */ let drawBuffer;
  const f = new Float32Array(DRAW_FLOATS);
  const mats = growth.matIds.map((sp) => opts.recipes[sp]);
  const cloverAt = growth.matIds.findIndex((sp) => opts.recipes[sp]?.heads);
  const clover = cloverAt >= 0 ? mats[cloverAt] : null;
  let shellVerts = 0, layers = 1, headsPerSide = 0;
  // `?mats=0` turns the mats off for side-by-side checks.
  const off = new URLSearchParams(location.search).get('mats') === '0';

  /** Copies near the eye and how far they reach: from the tier. @param {{ matLayers?: number, grassDistance: number }} t */
  function setTier(t) {
    layers = Math.max(1, Math.round(t.matLayers ?? 6));
    f[5] = layers;
    f[6] = Math.min(16, t.grassDistance * 0.4); f[7] = Math.min(40, t.grassDistance);
    f[111] = Math.min(30, t.grassDistance * 0.6);
  }
  setTier(opts.tier);
  f[4] = 0.25;   // cell size (m): the terrain's own, so the copies follow the ground closely
  f[15] = (opts.seed >>> 0) % 100000;
  if (clover) {
    const H = clover.heads;
    f.set([1 / Math.sqrt(H.perM2), H.stalkM[0], H.stalkM[1], H.headR], 80);
    f[91] = cloverAt;
  }

  /** Season values blended through the year, as the grass does. @param {any} rec @param {number} s */
  function seasonAlbedo(rec, s) {
    const t = s - 0.5;
    const i0 = ((Math.floor(t) % 4) + 4) % 4, i1 = (i0 + 1) % 4;
    let k = t - Math.floor(t);
    k = k * k * (3 - 2 * k);
    const a = rec.season.albedo[SEASONS[i0]], b = rec.season.albedo[SEASONS[i1]];
    return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
  }

  return {
    name: 'mats',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => !off,
    setTier,

    /** Where the walker presses the mats (as the grass). @param {{ x: number, z: number, r: number, k: number }[]} list */
    setPushes(list) {
      for (let i = 0; i < MAX_PUSHES; i++) {
        const p = list[i];
        f.set(p ? [p.x, p.z, p.r, p.k] : [0, 0, 0, 0], 92 + i * 4);
      }
    },

    /**
     * Each frame: the mats' box, the time, the wind and the season.
     * @param {{ time: number, wind: number, windDir: number, season: number, seaLevel?: number, eye: ArrayLike<number> }} u
     *   season: season index plus phase (0..4); eye: the camera's position [x, y, z]
     */
    update(u) {
      const box = growth.matBox();
      shellVerts = 0; headsPerSide = 0;
      if (!box) return;
      const s = f[4];
      const across = Math.ceil((box.x1 - box.x0) / s), down = Math.ceil((box.z1 - box.z0) / s);
      f.set([box.x0, box.z0, across, down], 0);
      shellVerts = across * down * 6;
      f[8] = u.time % 3600; f[9] = Math.min(1, Math.max(0, u.wind)); f[10] = (u.seaLevel ?? -100) + 0.1;
      f[12] = Math.cos(u.windDir); f[13] = -Math.sin(u.windDir);
      mats.forEach((rec, c) => {
        if (!rec?.mat) return;
        const o = 16 + c * 16;
        const rest = windowShare(u.season, rec.dormant ?? [0, 0], 0.1);
        const albedo = seasonAlbedo(rec, u.season);
        f.set([...albedo, rec.mat.heightM * (1 - 0.45 * rest)], o);
        const bloom = windowShare(u.season, rec.flowering ?? [0, 0], 0.08);
        f.set([...rec.season.flower, bloom], o + 4);
        f.set([rec.mat.leafM, rec.mat.flowerM, rec.mat.flowerShare, rec.mat.edgeM], o + 8);
        // Far off, the flowers tint the flat copy by farTint of their color while in flower.
        f[o + 12] = 1; f[o + 13] = (rec.mat.farTint ?? 0) * bloom;
      });
      if (clover) {
        f.set(clover.season.flower, 84); f[87] = windowShare(u.season, clover.flowering, 0.08);
        f.set(clover.season.stalk ?? [0.08, 0.11, 0.05], 88);
        // Heads in a square around the eye, clipped to the mats' box, on a world-anchored grid.
        const sp = f[80], reach = f[111];
        const x0 = Math.max(box.x0, u.eye[0] - reach), z0 = Math.max(box.z0, u.eye[2] - reach);
        const x1 = Math.min(box.x1, u.eye[0] + reach), z1 = Math.min(box.z1, u.eye[2] + reach);
        if (f[87] > 0 && x1 > x0 && z1 > z0) {
          const gx = Math.floor(x0 / sp) * sp, gz = Math.floor(z0 / sp) * sp;
          headsPerSide = Math.ceil(Math.max(x1 - gx, z1 - gz) / sp) + 1;
          f.set([gx, gz, headsPerSide], 108);
        }
      }
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const layout = device.createBindGroupLayout({
        label: 'group2-mats',
        entries: [
          { binding: 0, visibility: VF, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: VF, texture: { sampleType: 'float' } },
          { binding: 3, visibility: VF, sampler: { type: 'filtering' } },
        ],
      });
      const module = await makeShaderModule(device, 'mat-shells');
      const pipeLayout = device.createPipelineLayout({ label: 'mats', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const common = {
        layout: pipeLayout,
        primitive: { topology: /** @type {GPUPrimitiveTopology} */ ('triangle-list'), cullMode: /** @type {GPUCullMode} */ ('none') },
        depthStencil: { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: true, depthCompare: /** @type {GPUCompareFunction} */ ('greater') },
      };
      const targets = [{ format: /** @type {GPUTextureFormat} */ ('rgba16float') }, { format: /** @type {GPUTextureFormat} */ ('rgb10a2unorm') }];
      [shellPipe, headPipe] = await Promise.all([
        device.createRenderPipelineAsync({ label: 'mat-shells', ...common, vertex: { module, entryPoint: 'vsShell' }, fragment: { module, entryPoint: 'fsShell', targets } }),
        device.createRenderPipelineAsync({ label: 'mat-heads', ...common, vertex: { module, entryPoint: 'vsHead' }, fragment: { module, entryPoint: 'fsHead', targets } }),
      ]);
      drawBuffer = makeBuffer(device, { label: 'mats-draw', size: DRAW_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const sampler = device.createSampler({ label: 'mats-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      group = device.createBindGroup({
        label: 'mats-draw', layout,
        entries: [
          { binding: 0, resource: { buffer: drawBuffer } },
          { binding: 1, resource: terrain.gpu.height.createView() },
          { binding: 2, resource: growth.matTex.createView() },
          { binding: 3, resource: sampler },
        ],
      });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!shellVerts) return;
      ctx.device.queue.writeBuffer(drawBuffer, 0, f);
      const pass = encoder.beginRenderPass({
        label: 'mats',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('mats'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(shellPipe);
      pass.draw(shellVerts, layers);
      if (headsPerSide > 0) {
        pass.setPipeline(headPipe);
        pass.draw(12 * headsPerSide * headsPerSide);
      }
      pass.end();
    },
  };
}
