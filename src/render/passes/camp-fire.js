// @ts-check
// The camp fire pass (Matt's fire study, October 29, 2026): the live fire sim (camp-fire-sim.js)
// stepped while the fire burns, then its volume drawn (camp-fire-draw.wgsl): the smoke blended into
// the HDR and a soft glow added, before the camp effects pass, and the heat into `fireHeat`, from
// which the tonemap paints the banded flame after the palette (lib-fire-bands.wgsl). The camp's
// frame (src/world/camp/frame.js) says each frame where the fire is and how it burns (set).
//
// The sim runs only while the fire is lit and afterS seconds after it sinks to embers, while its box
// is in view and the tier draws it (fireSimRuns); stopping empties it. Coming into view lit (or a
// page opening on a lit fire) warms it by warmSteps at once. Visual only: never saved, never in
// catch-up. Recipe: camp.json fireSim (its tiers), flame.nits for the glow.

import { makeBuffer, makeShaderModule, makeTexture, untrack } from '../../core/gpu.js';
import { createCampFireSim } from './camp-fire-sim.js';
import { simSteps, fireSimRuns } from '../../world/camp/fire-look.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

/**
 * @typedef {Object} CampFireFrame
 * @property {number[]} foot      the fire's foot [x, y, z] (m)
 * @property {boolean} lit        burning (not embers)
 * @property {number} level       what drives the sim (fire-look.js)
 * @property {number} flare       the surge 0..1
 * @property {number} smokePuff   a caught handful's smoke 0..1
 * @property {number[]} wind      [x, z] m/s
 * @property {boolean} rainy
 * @property {number[][]} spots   hot spots [x, y, z, share], meters from the foot
 * @property {number} time        real seconds
 */

/**
 * @param {{ recipe: any, tier: string, getViewProj: () => ArrayLike<number> | null }} opts
 *   recipe: recipes/world/camp.json; tier: the quality tier's name
 */
export function createCampFirePass(opts) {
  const R = opts.recipe, S = R.fireSim;
  const sim = createCampFireSim({ recipe: S, rain: { flame: R.fire.rainFlame, smoke: R.smoke.rainThick } });
  /** The tier's settings, or null when the tier leaves the sim out. @param {string} name */
  const tierOf = (name) => {
    const t = S.tiers[name === 'ultra' ? 'high' : name];
    return t ? { grid: S[t.grid], pressurePasses: t.pressurePasses, samples: t.samples, scale: t.scale } : null;
  };
  let tier = tierOf(opts.tier);
  if (tier) sim.setTier(tier);

  const draw = new Float32Array(24);
  const bands = new Float32Array(24);
  {
    const B = S.bands, ws = [B.edge, ...B.at];
    const hex = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    // The band colours, fixed from the recipe. Palette keys may tint them here later (spec 10.2).
    B.colors.forEach((/** @type {string} */ c, /** @type {number} */ i) => bands.set([...hex(c), ws[i]], 4 + i * 4));
    bands.set([B.stylize, B.soft[0], B.soft[1], S.halo], 20);
  }
  const clock = { acc: 0 };
  let running = false, warmNext = true, lastLitT = -1e9, steps = 0, frameNo = 0;
  let foot = [0, 0, 0], level = 0, time = 0;
  /** The box on screen as a share of the render size [x0, y0, x1, y1], or null when out of view. @type {number[] | null} */
  let rect = null;

  /** @type {GPUDevice} */ let device;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPURenderPipeline} */ let volPipe; /** @type {GPURenderPipeline} */ let compPipe;
  /** @type {GPUBindGroupLayout} */ let volLayout; /** @type {GPUBindGroupLayout} */ let compLayout;
  /** @type {GPUBindGroup | null} */ let volGroup = null; /** @type {GPUBindGroup | null} */ let compGroup = null;
  /** @type {GPUSampler} */ let sampler;
  /** @type {Record<string, GPUTexture>} */ let tex = {};
  /** @type {GPUTexture | null} */ let heatTex = null;
  let volSize = [1, 1];
  /** @type {PassContext | null} */ let lastCtx = null;

  /**
   * The box on screen, from the camera's view-projection (column-major): [x0, y0, x1, y1] as shares of
   * the screen (y down), the whole screen when the camera is inside or beside it, null when out of view.
   * @param {number[]} lo @param {number[]} size
   */
  function screenRect(lo, size) {
    const m = opts.getViewProj();
    if (!m) return [0, 0, 1, 1];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = 0;
    const out = [0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const x = lo[0] + (i & 1 ? size[0] : 0), y = lo[1] + (i & 2 ? size[1] : 0), z = lo[2] + (i & 4 ? size[2] : 0);
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cx < -w) out[0]++; if (cx > w) out[1]++; if (cy < -w) out[2]++; if (cy > w) out[3]++;
      if (w <= 1e-3) { behind++; out[4]++; continue; }
      const sx = cx / w * 0.5 + 0.5, sy = 0.5 - cy / w * 0.5;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (out.some((n) => n === 8)) return null;
    if (behind) return [0, 0, 1, 1];
    const r = [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)];
    return r[2] > r[0] && r[3] > r[1] ? r : null;
  }

  function makeTargets() {
    if (!lastCtx || !tier) return;
    const ctx = lastCtx;
    for (const [k, t] of Object.entries(tex)) { t.destroy(); untrack(`fire-${k}`); }
    heatTex?.destroy();
    const [w, h] = ctx.size;
    volSize = [Math.max(1, Math.ceil(w * tier.scale)), Math.max(1, Math.ceil(h * tier.scale))];
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    tex = {
      smoke: makeTexture(device, { label: 'fire-smoke', size: volSize, format: 'rgba16float', usage }),
      heat: makeTexture(device, { label: 'fire-heat-vol', size: volSize, format: 'rg32float', usage }),
    };
    heatTex = makeTexture(device, { label: 'fireHeat', size: [w, h], format: 'r16float', usage });
    const depth = ctx.targets.depth.createView();
    volGroup = device.createBindGroup({ label: 'fire-volume', layout: volLayout, entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: sim.dye.createView() },
      { binding: 2, resource: sampler }, { binding: 3, resource: depth }] });
    compGroup = device.createBindGroup({ label: 'fire-composite', layout: compLayout, entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 3, resource: depth },
      { binding: 4, resource: tex.smoke.createView() }, { binding: 5, resource: tex.heat.createView() }] });
  }

  /** @param {GPURenderPassEncoder} rp @param {number[]} size */
  const scissor = (rp, size) => {
    const r = /** @type {number[]} */ (rect);
    const x = Math.floor(r[0] * size[0]), y = Math.floor(r[1] * size[1]);
    rp.setScissorRect(x, y, Math.max(1, Math.min(size[0], Math.ceil(r[2] * size[0]) + 1) - x), Math.max(1, Math.min(size[1], Math.ceil(r[3] * size[1]) + 1) - y));
  };

  const pass = {
    name: 'campfire',
    reads: ['hdr', 'depth'],
    writes: ['hdr', 'fireHeat'],
    enabled: () => running && !!rect && !!volGroup,

    /** Whether the sim is running now (tools, tests). */
    get running() { return running; },

    /**
     * This frame's fire, or null when the camp is hidden or has no lit fire.
     * @param {CampFireFrame | null} f @param {number} dt real seconds
     */
    set(f, dt) {
      const lit = !!f && f.lit;
      if (f && lit) lastLitT = f.time;
      if (f) {
        foot = f.foot; level = f.level; time = f.time;
        const lo = [foot[0] + sim.bmin[0], foot[1] + sim.bmin[1], foot[2] + sim.bmin[2]];
        rect = screenRect(lo, sim.box);
      } else rect = null;
      const run = !!f && fireSimRuns({ tierOn: !!tier, inView: !!rect, lit, sinceLitS: f ? f.time - lastLitT : Infinity, afterS: S.afterS });
      if (running && !run && device) sim.clear();
      // Stopped while lit (out of view, a tier off): coming back warms it at once; stopped cold: not.
      if (!run) { warmNext = f ? lit : true; clock.acc = 0; }
      steps = 0;
      if (run && f) {
        if (!running && warmNext && lit) { steps = S.warmSteps; clock.acc = 0; } else steps = simSteps(clock, dt, S.stepS, S.maxStepsPerFrame);
        warmNext = false;
        if (device) sim.write({ time: f.time, level: f.level, flare: f.flare, smokePuff: f.smokePuff, wind: f.wind, rainy: f.rainy, spots: f.spots });
      }
      running = run;
    },

    /**
     * A new quality tier; true when the volume's resolution changed (the caller invalidates the graph).
     * @param {string} name
     */
    setTier(name) {
      const was = tier;
      tier = tierOf(name);
      if (!tier) { if (running && device) sim.clear(); running = false; return false; }
      // A new grid makes new sim textures: drawing waits for the resize the caller asks for.
      const regrid = sim.setTier(tier);
      if (regrid) volGroup = compGroup = null;
      return regrid || !was || was.scale !== tier.scale;
    },

    /** The heat target, for the tonemap pass (null before the first resize or with the tier off). */
    heatView() { return heatTex ? heatTex.createView() : null; },

    /** What the tonemap paints this frame: [on, halo strength, 0, 0], then the bands (lib-fire-bands.wgsl FireBands). */
    paint() {
      bands[0] = pass.enabled() ? 1 : 0;
      bands[1] = Math.min(level / S.levelScale * 2 + 0.2, 1);
      return bands;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      device = ctx.device;
      await sim.setup(device);
      ubuf = makeBuffer(device, { label: 'fire-draw', size: draw.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      sampler = device.createSampler({ label: 'fire-dye', magFilter: 'linear', minFilter: 'linear' });
      const module = await makeShaderModule(device, 'camp-fire-draw');
      const F = GPUShaderStage.FRAGMENT;
      volLayout = device.createBindGroupLayout({ label: 'fire-volume', entries: [
        { binding: 0, visibility: F, buffer: {} },
        { binding: 1, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 2, visibility: F, sampler: { type: 'filtering' } },
        { binding: 3, visibility: F, texture: { sampleType: 'depth' } }] });
      compLayout = device.createBindGroupLayout({ label: 'fire-composite', entries: [
        { binding: 0, visibility: F, buffer: {} },
        { binding: 3, visibility: F, texture: { sampleType: 'depth' } },
        { binding: 4, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 5, visibility: F, texture: { sampleType: 'unfilterable-float' } }] });
      const layout = (/** @type {GPUBindGroupLayout} */ l) => device.createPipelineLayout({ bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, l] });
      const over = { color: { srcFactor: /** @type {GPUBlendFactor} */ ('one'), dstFactor: /** @type {GPUBlendFactor} */ ('one-minus-src-alpha'), operation: /** @type {GPUBlendOperation} */ ('add') },
        alpha: { srcFactor: /** @type {GPUBlendFactor} */ ('zero'), dstFactor: /** @type {GPUBlendFactor} */ ('one'), operation: /** @type {GPUBlendOperation} */ ('add') } };
      [volPipe, compPipe] = await Promise.all([
        device.createRenderPipelineAsync({ label: 'fire-volume', layout: layout(volLayout), vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fsVolume', targets: [{ format: 'rgba16float' }, { format: 'rg32float' }] } }),
        device.createRenderPipelineAsync({ label: 'fire-composite', layout: layout(compLayout), vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fsComposite', targets: [{ format: 'rgba16float', blend: over }, { format: 'r16float' }] } }),
      ]);
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      lastCtx = ctx;
      if (device) makeTargets();
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!tier || !volGroup || !compGroup) return;
      // Timed from the first sim step (or the volume, with none this frame) to the composite's end.
      const tw = ctx.timestampWrites('campfire');
      sim.encode(encoder, steps, tw ? { querySet: tw.querySet, beginningOfPassWriteIndex: tw.beginningOfPassWriteIndex } : undefined);
      const volTw = tw && steps === 0 ? { querySet: tw.querySet, beginningOfPassWriteIndex: tw.beginningOfPassWriteIndex } : undefined;
      steps = 0;
      draw.set([foot[0], foot[1], foot[2], tier.samples, ...sim.box, tier.scale, ...sim.bmin, S.smokeDensity,
        ...S.detail, S.heatGain, ...R.smoke.albedo, time,
        R.flame.nits * S.glowShare, volSize[0], volSize[1], frameNo++ % 1000]);
      ctx.device.queue.writeBuffer(ubuf, 0, draw);
      const vp = encoder.beginRenderPass({ label: 'fire-volume', colorAttachments: [
        { view: tex.smoke.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        { view: tex.heat.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 1e6, 0, 0] }],
      ...(volTw ? { timestampWrites: volTw } : {}) });
      vp.setPipeline(volPipe); vp.setBindGroup(0, ctx.groups.frame); vp.setBindGroup(1, ctx.groups.lighting); vp.setBindGroup(2, volGroup);
      scissor(vp, volSize); vp.draw(3); vp.end();
      const cp = encoder.beginRenderPass({ label: 'fire-composite', colorAttachments: [
        { view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' },
        { view: /** @type {GPUTexture} */ (heatTex).createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      ...(tw ? { timestampWrites: { querySet: tw.querySet, endOfPassWriteIndex: tw.endOfPassWriteIndex } } : {}) });
      cp.setPipeline(compPipe); cp.setBindGroup(0, ctx.groups.frame); cp.setBindGroup(1, ctx.groups.lighting); cp.setBindGroup(2, compGroup);
      scissor(cp, ctx.size); cp.draw(3); cp.end();
    },
  };
  return pass;
}

/** @typedef {ReturnType<typeof createCampFirePass>} CampFirePass */
