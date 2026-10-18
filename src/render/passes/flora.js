// @ts-check
// Flora pass (docs 10, 14): the growth engine's plants as GPU geometry (flora-draw.wgsl), one
// instance per plant from its instance buffer. S5b-1 draws reed clumps (a seed as a few short
// shoots); other species draw nothing yet. Drawn after the grass and before the water, into the same HDR, normal and depth
// targets, so the water's scene copy shows the lower stems through the water. Shape, season and
// wind come from recipes/flora/reeds.json; nothing here is simulated.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 160;
/** Vertices per stem: 15 for the stem (two segments and a tip), 6 for a seed head. */
const PER_STEM = 21;
const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);

/**
 * @param {{ growth: { instances: GPUBuffer, count: () => number }, recipes: { reeds: any } }} opts
 *   growth: the plant instances (src/world/growth/index.js); recipes.reeds: recipes/flora/reeds.json
 */
export function createFloraPass(opts) {
  const { growth } = opts;
  const recipe = opts.recipes.reeds;
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUBuffer} */ let drawBuffer;
  const data = new ArrayBuffer(DRAW_BYTES);
  const f = new Float32Array(data);
  const perClump = PER_STEM * Math.ceil(recipe.shape.stemsPerClump[1]);

  // `?flora=0` turns the plants off for side-by-side checks.
  const off = new URLSearchParams(location.search).get('flora') === '0';

  {
    const S = recipe.shape;
    const L = recipe.look;
    const W = recipe.wind;
    const deg = Math.PI / 180;
    f[7] = L.wetDarken;
    f.set(recipe.season.albedo.winter, 8); f[11] = L.dormantLean;
    f.set(recipe.season.seedHead, 12); f[15] = L.headShare;
    f.set([S.stemsPerClump[0], S.stemsPerClump[1], S.clumpRadius, S.maxHeight], 16);
    f.set([S.stemWidth, S.leanDeg * deg, S.seedHead.length, S.seedHead.width], 20);
    f.set([W.stiffness, W.sway, 1 / L.gustM, L.gustSpeed], 24);
    f.set([L.heightVar, L.headGapM, L.pixelWidth, L.rootShade], 28);
    f.set([L.sinkM, L.edgeShorter, (recipe.seed >>> 0) % 100000, L.radiusMin], 32);
    f[36] = L.sproutM; f[37] = L.seedShoots;
  }

  /**
   * Season albedo blended through the year: each season's value holds at its middle and eases
   * into the next (as the grass does). @param {number} s season index plus phase (0..4)
   */
  function seasonAlbedo(s) {
    const t = s - 0.5;
    const i0 = ((Math.floor(t) % 4) + 4) % 4;
    const i1 = (i0 + 1) % 4;
    let k = t - Math.floor(t);
    k = k * k * (3 - 2 * k);
    const A = recipe.season.albedo;
    const a = A[SEASONS[i0]];
    const b = A[SEASONS[i1]];
    return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
  }

  return {
    name: 'flora',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'depth', 'normalId'],
    enabled: () => !off,

    /**
     * Each frame: the time, the wind and the season.
     * @param {{ time: number, wind: number, windDir: number, season: number }} u
     *   windDir: radians the wind blows toward (0 east, pi/2 north); season: season index plus phase (0..4)
     */
    update(u) {
      f[0] = Math.cos(u.windDir); f[1] = -Math.sin(u.windDir);
      f[2] = u.time % 3600; f[3] = Math.min(1, Math.max(0, u.wind));
      f.set(seasonAlbedo(u.season), 4);
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const layout = device.createBindGroupLayout({
        label: 'group2-flora',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      const module = await makeShaderModule(device, 'flora-draw');
      pipeline = await device.createRenderPipelineAsync({
        label: 'flora',
        layout: device.createPipelineLayout({ label: 'flora', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vsFlora' },
        fragment: { module, entryPoint: 'fsFlora', targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      drawBuffer = makeBuffer(device, { label: 'flora-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({
        label: 'flora-draw', layout,
        entries: [
          { binding: 0, resource: { buffer: drawBuffer } },
          { binding: 1, resource: { buffer: growth.instances } },
        ],
      });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      ctx.device.queue.writeBuffer(drawBuffer, 0, data);
      const pass = encoder.beginRenderPass({
        label: 'flora',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('flora'),
      });
      const count = growth.count();
      if (count > 0) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, ctx.groups.frame);
        pass.setBindGroup(1, ctx.groups.lighting);
        pass.setBindGroup(2, group);
        pass.draw(perClump, count);
      }
      pass.end();
    },
  };
}
