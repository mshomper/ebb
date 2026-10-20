// @ts-check
// Flora pass (docs 10, 14): the growth engine's plants as GPU geometry with no mesh, one draw per
// species, each with its own shader (flora-kinds.js: reeds flora-draw.wgsl, then flora-lilies,
// flora-iris and flora-thrift) over that species' range of the shared instance buffer. Drawn
// after the grass and before the water, into the same HDR, normal and depth targets, so the
// water's scene copy shows the lower stems through the water; lily pads float a little above the
// water simulation's surface, which they read from its depth texture. Shape, season and wind come
// from recipes/flora/<species>.json; nothing here is simulated.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { FLORA_KINDS } from './flora-kinds.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 256;

/**
 * @param {{ growth: { instances: GPUBuffer, range: (index: number) => number[] },
 *   terrain: import('../../world/terrain/index.js').Terrain,
 *   water: { depthTextures: GPUTexture[], current: () => number }, recipes: Record<string, any> }} opts
 *   growth: the plant instances (src/world/growth/index.js); recipes: the flora recipes by species id
 */
export function createFloraPass(opts) {
  const { growth } = opts;
  // `?flora=0` turns the plants off for side-by-side checks.
  const off = new URLSearchParams(location.search).get('flora') === '0';

  /**
   * One per species drawn: its recipe, kind, draw buffer contents, and (after setup) its pipeline,
   * uniform buffer and one bind group per water depth texture.
   * @type {{ recipe: any, kind: import('./flora-kinds.js').FloraKind, data: ArrayBuffer, f: Float32Array, vertices: number,
   *   pipeline?: GPURenderPipeline, buffer?: GPUBuffer, groups: GPUBindGroup[] }[]}
   */
  // A recipe may draw with another species' shader (`draw`, e.g. marsh marigold with the iris), its
  // own values packed into its own uniform.
  const draws = Object.entries(opts.recipes)
    .filter(([sp, recipe]) => FLORA_KINDS[recipe.draw ?? sp])
    .map(([sp, recipe]) => {
      const kind = FLORA_KINDS[recipe.draw ?? sp];
      const data = new ArrayBuffer(DRAW_BYTES);
      const f = new Float32Array(data);
      kind.pack(recipe, f);
      return { recipe, kind, data, f, vertices: kind.vertices(recipe), groups: [] };
    });

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
      for (const d of draws) d.kind.frame(d.recipe, d.f, u);
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      // One layout for every species; a shader uses the entries it needs (lilies read the ground
      // height and the water depth to float on the water).
      const layout = device.createBindGroupLayout({
        label: 'group2-flora',
        entries: [
          { binding: 0, visibility: VF, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ label: 'flora', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const heightView = opts.terrain.gpu.height.createView();
      const depthViews = opts.water.depthTextures.map((t) => t.createView());
      await Promise.all(draws.map(async (d) => {
        const module = await makeShaderModule(device, d.kind.shader);
        d.pipeline = await device.createRenderPipelineAsync({
          label: `flora-${d.recipe.id}`,
          layout: pipelineLayout,
          vertex: { module, entryPoint: d.kind.vs },
          fragment: { module, entryPoint: d.kind.fs, targets: [{ format: 'rgba16float' }, { format: 'rgb10a2unorm' }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
        });
        const buffer = makeBuffer(device, { label: `flora-${d.recipe.id}`, size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        d.buffer = buffer;
        d.groups = depthViews.map((depth) => device.createBindGroup({
          label: `flora-${d.recipe.id}`, layout,
          entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: { buffer: growth.instances } },
            { binding: 2, resource: heightView },
            { binding: 3, resource: depth },
          ],
        }));
      }));
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const pass = encoder.beginRenderPass({
        label: 'flora',
        colorAttachments: [
          { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
          { view: ctx.targets.normalId.createView(), loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
        timestampWrites: ctx.timestampWrites('flora'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      const w = opts.water.current();
      for (const d of draws) {
        const [first, count] = growth.range(d.recipe.index);
        if (count <= 0 || !d.pipeline || !d.buffer) continue;
        ctx.device.queue.writeBuffer(d.buffer, 0, d.data);
        pass.setPipeline(d.pipeline);
        pass.setBindGroup(2, d.groups[w]);
        pass.draw(d.vertices, count, 0, first);
      }
      pass.end();
    },
  };
}
