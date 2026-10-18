// @ts-check
// Grass pass (docs 10, 04): the meadow as GPU blades (grass-blades.wgsl), drawn after the terrain
// into the same HDR, normal and depth targets, so the water's scene copy, the outline and the
// exposure all see it. Two draws: a dense near ring and a sparser far ring around the view's focus,
// sized from the tier's grassDensity and grassDistance. Season, wind and the blade look come from
// recipes/flora/grass.json; nothing here is simulated.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 160;
const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);

/**
 * @param {{ terrain: import('../../world/terrain/index.js').Terrain, recipe: any, terrainRecipe: any, seed: number,
 *   water: { depthTextures: GPUTexture[], current: () => number }, cover: GPUTexture,
 *   tier: { grassDensity: number, grassDistance: number } }} opts  recipe: recipes/flora/grass.json;
 *   terrainRecipe: recipes/world/terrain.json (its beach band and steep-rock angles);
 *   cover: the growth step's grass cover (world/growth coverTex), 1 m world grid
 */
export function createGrassPass(opts) {
  const { terrain, recipe } = opts;
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUBindGroup[]} */ let groups = [];
  /** @type {GPUBuffer} */ let drawBuffer;
  const data = new ArrayBuffer(DRAW_BYTES);
  const f = new Float32Array(data);
  /** Blades per side of the near and far rings. */
  const perSide = [0, 0];

  // `?grass=0` turns the meadow off for side-by-side checks.
  const off = new URLSearchParams(location.search).get('grass') === '0';

  /** Ring sizes for a tier: spacing from the density, extents from the distance. @param {{ grassDensity: number, grassDistance: number }} t */
  function setTier(t) {
    const D = recipe.density;
    const reach = t.grassDistance;
    const near = D.perM2 * t.grassDensity;
    const far = near * D.farShare;
    const s0 = 1 / Math.sqrt(near);
    const s1 = 1 / Math.sqrt(far);
    const half0 = reach * D.nearShare;
    perSide[0] = 2 * Math.ceil(half0 / s0);
    perSide[1] = 2 * Math.ceil(reach / s1);
    f.set([s0, perSide[0], 0, 1], 12);
    // The far ring leaves the near ring's square (less half a spacing, so no gap opens at the seam).
    f.set([s1, perSide[1], half0 - s0 * 0.5, 1], 16);
    f[24] = reach * (1 - D.fadeShare); f[25] = reach;
    // Far blades are fewer: widen them part of the way toward covering the same ground.
    f[31] = 1 + (Math.sqrt(1 / D.farShare) - 1) * D.farWiden;
  }

  {
    const B = recipe.blades;
    f[7] = B.width; f[11] = B.rootShade;
    f.set([B.heightVar, B.widthVar, B.lean, recipe.wind.sway], 20);
    f[26] = 1 / recipe.wind.gustM; f[27] = recipe.wind.gustSpeed;
    f[28] = recipe.wetDarken; f[29] = (opts.seed >>> 0) % 100000; f[30] = 1.2;
    f[32] = B.tuftM; f[33] = B.tuftDensity; f[34] = B.tuftHeight;
    // The terrain's derived layers (terrain.json): no blades on the beach band or steep rock.
    const T = opts.terrainRecipe;
    f[36] = T.beachBand[1];
    f[37] = Math.cos((T.steepRockDeg - T.steepRockSoftDeg) * Math.PI / 180); f[38] = Math.cos((T.steepRockDeg + T.steepRockSoftDeg) * Math.PI / 180);
    setTier(opts.tier);
  }

  /**
   * Season values blended through the year: each season's value holds at its middle and eases
   * into the next. @param {number} s season index plus phase (0..4)
   */
  function seasonBlend(s) {
    const t = s - 0.5;
    const i0 = ((Math.floor(t) % 4) + 4) % 4;
    const i1 = (i0 + 1) % 4;
    let k = t - Math.floor(t);
    k = k * k * (3 - 2 * k);
    const S = recipe.season;
    const a = SEASONS[i0];
    const b = SEASONS[i1];
    return {
      height: S.height[a] + (S.height[b] - S.height[a]) * k,
      albedo: [0, 1, 2].map((i) => S.albedo[a][i] + (S.albedo[b][i] - S.albedo[a][i]) * k),
    };
  }

  return {
    name: 'grass',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => !off,
    setTier,

    /**
     * Each frame: where the view looks, the time, the wind and the season.
     * @param {{ focus: ArrayLike<number>, time: number, wind: number, windDir: number, season: number }} u
     *   focus: the camera's orbit target [x, y, z]; windDir: radians the wind blows toward (0 east,
     *   pi/2 north); season: season index plus phase (0..4)
     */
    update(u) {
      f[0] = u.focus[0]; f[1] = u.focus[2]; f[2] = u.time % 3600; f[3] = Math.min(1, Math.max(0, u.wind));
      f[4] = Math.cos(u.windDir); f[5] = -Math.sin(u.windDir);
      const s = seasonBlend(u.season);
      f[6] = recipe.blades.height * s.height;
      f.set(s.albedo, 8);
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const layout = device.createBindGroupLayout({
        label: 'group2-grass',
        entries: [
          { binding: 0, visibility: VF, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'float' } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, sampler: { type: 'filtering' } },
          { binding: 4, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
          { binding: 5, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'float' } },
        ],
      });
      const module = await makeShaderModule(device, 'grass-blades');
      pipeline = await device.createRenderPipelineAsync({
        label: 'grass',
        layout: device.createPipelineLayout({ label: 'grass', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vsBlade' },
        fragment: { module, entryPoint: 'fsBlade', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      drawBuffer = makeBuffer(device, { label: 'grass-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const sampler = device.createSampler({ label: 'grass-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      const heightView = terrain.gpu.height.createView();
      const materialView = terrain.gpu.material.createView();
      // One group per water depth texture (the simulation ping-pongs them).
      groups = opts.water.depthTextures.map((t) => device.createBindGroup({
        label: 'grass-draw', layout,
        entries: [
          { binding: 0, resource: { buffer: drawBuffer } },
          { binding: 1, resource: heightView },
          { binding: 2, resource: materialView },
          { binding: 3, resource: sampler },
          { binding: 4, resource: t.createView() },
          { binding: 5, resource: opts.cover.createView() },
        ],
      }));
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      ctx.device.queue.writeBuffer(drawBuffer, 0, data);
      const pass = encoder.beginRenderPass({
        label: 'grass',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('grass'),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, groups[opts.water.current()]);
      for (let ring = 0; ring < 2; ring++) {
        if (f[6] > 0.001) pass.draw((ring === 0 ? 9 : 3) * perSide[ring] * perSide[ring], 1, 0, ring);
      }
      pass.end();
    },
  };
}
