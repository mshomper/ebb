// @ts-check
// Volumetric waterfalls near the eye (M2): screen-space fluid rendering (van der Laan, Green and
// Sainz, I3D 2009; Green, "Screen Space Fluid Rendering for Games", GDC 2010). Part of the falls
// pass (falls.js). Each frame:
//   1. droplets leave each nearby lip and fall (falls-particles.wgsl, compute)
//   2. they are drawn as spheres into half-resolution depth and thickness images (falls-fluid-splat)
//   3. the depth is smoothed into one surface (falls-fluid-smooth, bilateral, across then down)
//   4. that surface is shaded as water over the HDR (falls-fluid-shade)
// Visual only, never saved. Recipe: water.json falls.fluid; tier: fallsFluid { particles, nearM }
// (0 particles: curtains only).

import { makeBuffer, makeShaderModule, makeTexture, untrack } from '../../core/gpu.js';

const SIM_BYTES = 112;
const PARTICLE_BYTES = 48;
const SMOOTH_BYTES = 32;

/**
 * @param {{ water: import('../../world/water/index.js').Water, terrain: import('../../world/terrain/index.js').Terrain,
 *   falls: any, recipe: any, absorption: number[], atmosphere: { probeView: GPUTextureView, probeSampler: GPUSampler },
 *   getEye: () => ArrayLike<number>, getProjY: () => number, tier: { fallsFluid?: { particles: number, nearM: number } },
 *   getOpaqueDepth?: () => GPUTexture | null }} opts
 *   getOpaqueDepth: the scene depth before the water was drawn (passes/water.js)
 *   falls: water.json falls; recipe: falls.fluid; absorption: water.json look.absorptionPond
 */
export function createFallsFluid(opts) {
  const { water, falls: F, recipe: R } = opts;
  /** The largest particle count any tier asks for: the buffer is made once. */
  const MAX_PARTICLES = 65536;
  let cap = 0, nearM = 0, scale = 0.5;
  /** @param {{ fallsFluid?: { particles: number, nearM: number, scale?: number } }} t */
  const applyTier = (t) => {
    cap = Math.min(MAX_PARTICLES, t.fallsFluid?.particles ?? 0);
    nearM = cap > 0 ? t.fallsFluid?.nearM ?? 0 : 0;
    scale = Math.min(1, Math.max(0.25, t.fallsFluid?.scale ?? 0.5));
  };
  applyTier(opts.tier);

  const sim = new ArrayBuffer(SIM_BYTES), sf = new Float32Array(sim), su = new Uint32Array(sim);
  sf[10] = R.fadeM; sf[11] = R.ratePerLipS;
  sf[12] = R.radiusM; sf[13] = R.lifeS; sf[14] = R.turbulence; sf[15] = R.drag;
  sf[19] = F.minDropM; sf[20] = F.offsetM; sf[21] = F.thicknessM[0]; sf[22] = F.thicknessM[1];
  sf[23] = F.qThreadsM2s; sf[24] = F.qSheetM2s; sf[25] = F.minDepthM; sf[26] = R.threadShare; sf[27] = R.maxLeanMs;  const draw = new Float32Array(8);
  draw[0] = R.radiusM; draw[1] = R.bulk; draw[2] = R.aerateS; draw[3] = R.density;
  const shade = new Float32Array(20);
  shade.set(opts.absorption, 0); shade[3] = R.shade.refraction;
  shade[4] = R.shade.whiteAlbedo; shade[5] = R.shade.whiteThicknessM; shade[6] = R.shade.edgeThicknessM; shade[7] = R.shade.roughness;
  shade[12] = 1 / R.shade.rippleM; shade[13] = R.shade.rippleSpeedMs; shade[14] = R.shade.rippleTilt;
  shade[16] = R.shade.sheen; shade[17] = R.shade.glintRoughness;
  let frameNo = 0;

  /** @type {GPUBuffer} */ let simBuf; /** @type {GPUBuffer} */ let particles; /** @type {GPUBuffer} */ let head;
  /** @type {GPUBuffer} */ let drawBuf; /** @type {GPUBuffer} */ let shadeBuf; /** @type {GPUBuffer[]} */ let smoothBufs = [];
  /** @type {GPUComputePipeline} */ let emitPipe; /** @type {GPUComputePipeline} */ let updatePipe; /** @type {GPUComputePipeline} */ let smoothPipe;
  /** @type {GPURenderPipeline} */ let depthPipe; /** @type {GPURenderPipeline} */ let thickPipe; /** @type {GPURenderPipeline} */ let shadePipe;
  /** @type {GPUBindGroupLayout} */ let splatLayout; /** @type {GPUBindGroupLayout} */ let shadeLayout;
  /** @type {GPUBindGroup[]} */ let simGroups = [];
  /** @type {GPUBindGroup | null} */ let splatGroup = null; /** @type {GPUBindGroup | null} */ let shadeGroup = null;
  /** @type {GPUBindGroup[]} */ let smoothGroups = [];
  /** @type {Record<string, GPUTexture>} */ let tex = {};
  let half = [1, 1];

  return {
    get on() { return nearM > 0; },
    /** Lips nearer than this (m) are drawn as droplet water, further ones as curtains (0: curtains only). */
    get nearM() { return nearM; },
    /**
     * A new tier; a new resolution share takes effect at the next resize (the caller invalidates).
     * @param {{ fallsFluid?: { particles: number, nearM: number, scale?: number } }} t
     */
    setTier(t) { const was = scale; applyTier(t); return scale !== was; },

    /**
     * @param {import('../frame-graph.js').PassContext} ctx
     * @param {{ lips: GPUBuffer, counter: GPUBuffer }} shared the lips water-falls.wgsl finds
     */
    async setup(ctx, shared) {
      const { device } = ctx;
      simBuf = makeBuffer(device, { label: 'falls-fluid-sim', size: SIM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      particles = makeBuffer(device, { label: 'falls-particles', size: MAX_PARTICLES * PARTICLE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      head = makeBuffer(device, { label: 'falls-particle-head', size: 16, usage: GPUBufferUsage.STORAGE });
      drawBuf = makeBuffer(device, { label: 'falls-fluid-draw', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      shadeBuf = makeBuffer(device, { label: 'falls-fluid-shade', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      smoothBufs = [0, 1].map((i) => makeBuffer(device, { label: `falls-fluid-smooth-${i}`, size: SMOOTH_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const [pMod, splatMod, smoothMod, shadeMod] = await Promise.all(
        ['falls-particles', 'falls-fluid-splat', 'falls-fluid-smooth', 'falls-fluid-shade'].map((n) => makeShaderModule(device, n)));
      [emitPipe, updatePipe, smoothPipe] = await Promise.all([
        device.createComputePipelineAsync({ label: 'falls-emit', layout: 'auto', compute: { module: pMod, entryPoint: 'csEmit' } }),
        device.createComputePipelineAsync({ label: 'falls-update', layout: 'auto', compute: { module: pMod, entryPoint: 'csUpdate' } }),
        device.createComputePipelineAsync({ label: 'falls-smooth', layout: 'auto', compute: { module: smoothMod, entryPoint: 'csSmooth' } }),
      ]);
      const heightView = opts.terrain.gpu.height.createView();
      // One group serves both entry points; each 'auto' layout keeps only the bindings it uses.
      /** @param {GPUComputePipeline} pipe @param {GPUTextureView} depthView */
      const simGroup = (pipe, depthView) => device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: pipe === emitPipe
          ? [{ binding: 0, resource: { buffer: simBuf } }, { binding: 3, resource: { buffer: shared.lips } },
            { binding: 4, resource: { buffer: shared.counter } }, { binding: 5, resource: { buffer: particles } }, { binding: 6, resource: { buffer: head } }]
          : [{ binding: 0, resource: { buffer: simBuf } }, { binding: 1, resource: heightView }, { binding: 2, resource: depthView },
            { binding: 5, resource: { buffer: particles } }],
      });
      simGroups = water.sim.depthTextures.flatMap((t) => { const v = t.createView(); return [simGroup(emitPipe, v), simGroup(updatePipe, v)]; });

      splatLayout = device.createBindGroupLayout({
        label: 'falls-fluid-splat',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        ],
      });
      const splatPipeLayout = device.createPipelineLayout({ label: 'falls-fluid-splat', bindGroupLayouts: [ctx.layouts.frame, splatLayout] });
      depthPipe = await device.createRenderPipelineAsync({
        label: 'falls-fluid-depth', layout: splatPipeLayout,
        vertex: { module: splatMod, entryPoint: 'vsSplat' },
        fragment: { module: splatMod, entryPoint: 'fsDepth', targets: [{ format: 'r32float' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      });
      thickPipe = await device.createRenderPipelineAsync({
        label: 'falls-fluid-thick', layout: splatPipeLayout,
        vertex: { module: splatMod, entryPoint: 'vsSplat' },
        fragment: { module: splatMod, entryPoint: 'fsThick', targets: [{ format: 'rgba16float', blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      });
      shadeLayout = device.createBindGroupLayout({
        label: 'falls-fluid-shade',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
          { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        ],
      });
      shadePipe = await device.createRenderPipelineAsync({
        label: 'falls-fluid-shade',
        layout: device.createPipelineLayout({ label: 'falls-fluid-shade', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, shadeLayout] }),
        vertex: { module: shadeMod, entryPoint: 'vsShade' },
        fragment: { module: shadeMod, entryPoint: 'fsShade', targets: [{ format: 'rgba16float', blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list' },
      });
      this.sampler = device.createSampler({ label: 'falls-fluid-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    },
    /** @type {GPUSampler | null} */
    sampler: null,

    /** Half-resolution targets and the scene copy follow the render size. @param {import('../frame-graph.js').PassContext} ctx */
    resize(ctx) {
      const { device } = ctx;
      for (const [k, t] of Object.entries(tex)) { t.destroy(); untrack(`falls-fluid-${k}`); }
      // The fluid images at the tier's share of the render size (finer silhouettes on high tiers).
      half = [Math.max(1, Math.ceil(ctx.size[0] * scale)), Math.max(1, Math.ceil(ctx.size[1] * scale))];
      const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      tex = {
        depthA: makeTexture(device, { label: 'falls-fluid-depthA', size: half, format: 'r32float', usage: RT | GPUTextureUsage.STORAGE_BINDING }),
        depthB: makeTexture(device, { label: 'falls-fluid-depthB', size: half, format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }),
        thick: makeTexture(device, { label: 'falls-fluid-thick', size: half, format: 'rgba16float', usage: RT }),
        zbuf: makeTexture(device, { label: 'falls-fluid-zbuf', size: half, format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT }),
        scene: makeTexture(device, { label: 'falls-fluid-scene', size: [ctx.size[0], ctx.size[1]], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }),
      };
      // Land and rocks only: the water mesh's own depth (its sloped film down a wall) must not hide the fall.
      const sceneDepthView = (opts.getOpaqueDepth?.() ?? ctx.targets.depth).createView();
      splatGroup = device.createBindGroup({ layout: splatLayout, entries: [
        { binding: 0, resource: { buffer: drawBuf } }, { binding: 1, resource: { buffer: particles } }, { binding: 2, resource: sceneDepthView }] });
      shadeGroup = device.createBindGroup({ layout: shadeLayout, entries: [
        { binding: 0, resource: { buffer: shadeBuf } }, { binding: 1, resource: tex.depthA.createView() },
        { binding: 2, resource: tex.thick.createView() }, { binding: 3, resource: tex.scene.createView() },
        { binding: 4, resource: sceneDepthView }, { binding: 5, resource: /** @type {GPUSampler} */ (this.sampler) },
        { binding: 6, resource: opts.atmosphere.probeView }, { binding: 7, resource: opts.atmosphere.probeSampler }] });
      // Across: A into B; down: B into A.
      smoothGroups = [[tex.depthA, tex.depthB], [tex.depthB, tex.depthA]].map(([from, to], i) => device.createBindGroup({
        layout: smoothPipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: smoothBufs[i] } }, { binding: 1, resource: from.createView() }, { binding: 2, resource: to.createView() }] }));
      draw[4] = ctx.size[0] / half[0]; draw[5] = ctx.size[1] / half[1]; draw[6] = half[0]; draw[7] = half[1];
      shade[8] = half[0] / ctx.size[0]; shade[9] = half[1] / ctx.size[1]; shade[10] = half[0]; shade[11] = half[1];
      device.queue.writeBuffer(drawBuf, 0, draw);
      device.queue.writeBuffer(shadeBuf, 0, shade);
    },

    /**
     * Droplets: emit from the lips found this frame, then fall. Call after the lip finder.
     * @param {GPUCommandEncoder} encoder @param {GPUDevice} device @param {number} dt real seconds
     * @param {number} time @param {number} lipCap
     */
    encodeSim(encoder, device, dt, time, lipCap) {
      if (!nearM || !emitPipe) return;
      const r = water.rect, eye = opts.getEye();
      su[0] = r.x; su[1] = r.y; su[2] = r.w; su[3] = r.h;
      sf[4] = eye[0]; sf[5] = eye[1]; sf[6] = eye[2]; sf[7] = Math.min(dt, 0.05);
      sf[8] = time; sf[9] = nearM; su[16] = cap; su[17] = lipCap; su[18] = frameNo++;
      device.queue.writeBuffer(simBuf, 0, sim);
      const k = water.sim.current * 2;
      const pass = encoder.beginComputePass({ label: 'falls-droplets' });
      pass.setPipeline(emitPipe);
      pass.setBindGroup(0, simGroups[k]);
      pass.dispatchWorkgroups(Math.ceil(lipCap / 64));
      pass.setPipeline(updatePipe);
      pass.setBindGroup(0, simGroups[k + 1]);
      pass.dispatchWorkgroups(Math.ceil(cap / 64));
      pass.end();
    },

    /**
     * The water surface: splat, smooth, shade over the HDR.
     * @param {GPUCommandEncoder} encoder @param {import('../frame-graph.js').PassContext} ctx
     * @param {GPURenderPassTimestampWrites | undefined} [endStamp] the falls pass timing's end, written as the shading ends
     */
    encodeDraw(encoder, ctx, endStamp) {
      if (!nearM || !splatGroup || !shadeGroup) return;
      const zView = tex.zbuf.createView();
      const p1 = encoder.beginRenderPass({
        label: 'falls-fluid-depth',
        colorAttachments: [{ view: tex.depthA.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: { view: zView, depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 0 },
      });
      p1.setBindGroup(0, ctx.groups.frame);
      p1.setBindGroup(1, splatGroup);
      p1.setPipeline(depthPipe);
      p1.draw(6, cap);
      p1.end();
      const p2 = encoder.beginRenderPass({
        label: 'falls-fluid-thick',
        colorAttachments: [{ view: tex.thick.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      p2.setBindGroup(0, ctx.groups.frame);
      p2.setBindGroup(1, splatGroup);
      p2.setPipeline(thickPipe);
      p2.draw(6, cap);
      p2.end();
      // Smoothing spans about the same width in meters at any distance.
      const pxPerM = opts.getProjY() * half[1] * 0.5;
      const S = R.smooth;
      [[1, 0], [0, 1]].forEach(([x, y], i) => {
        const b = new ArrayBuffer(SMOOTH_BYTES), bi = new Int32Array(b), bu = new Uint32Array(b), bf = new Float32Array(b);
        bi[0] = x; bi[1] = y; bu[2] = half[0]; bu[3] = half[1];
        bf[4] = pxPerM; bf[5] = S.widthM; bf[6] = S.depthSigmaM; bf[7] = S.maxPx;
        ctx.device.queue.writeBuffer(smoothBufs[i], 0, b);
      });
      const cp = encoder.beginComputePass({ label: 'falls-fluid-smooth' });
      cp.setPipeline(smoothPipe);
      // Across then down, `iterations` times: repeated, the bilateral blur rounds the droplets into
      // one surface without spreading past the silhouette.
      for (let n = 0; n < (S.iterations ?? 1); n++) {
        for (let i = 0; i < 2; i++) {
          cp.setBindGroup(0, smoothGroups[i]);
          cp.dispatchWorkgroups(Math.ceil(half[0] / 8), Math.ceil(half[1] / 8));
        }
      }
      cp.end();
      encoder.copyTextureToTexture({ texture: ctx.targets.hdr }, { texture: tex.scene }, [ctx.size[0], ctx.size[1]]);
      const p3 = encoder.beginRenderPass({
        label: 'falls-fluid-shade',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        timestampWrites: endStamp,
      });
      p3.setBindGroup(0, ctx.groups.frame);
      p3.setBindGroup(1, ctx.groups.lighting);
      p3.setBindGroup(2, shadeGroup);
      p3.setPipeline(shadePipe);
      p3.draw(3);
      p3.end();
    },
  };
}
