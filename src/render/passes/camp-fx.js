// @ts-check
// The camp's fire effects pass (docs/future/13 sections 3.5, C-29 to C-32, C-38; camp-fx.wgsl): the
// flame's halo, the lantern's glass, the fire steel's sparks, the smoke and the moths, after
// the sky so smoke seen against the sky is not drawn over. Depth tested, never written. The camp
// (src/world/camp/index.js) says each frame where the fire is and how it burns (set); every particle
// is placed on the GPU from its seed and the time.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const FLOATS = 60;

/**
 * @typedef {Object} CampFxFrame
 * @property {number[]} fire      the flame's foot [x, y, z] (m)
 * @property {number} flame       flame size 0..1 (0: none), for its halo (the flame itself is camp-fire.js)
 * @property {number} smoke       smoke amount 0..2
 * @property {number} embers      ember glow 0..1
 * @property {number[]} wind      the smoke's lean [x, z] (m/s)
 * @property {number} mist        0..1
 * @property {number[] | null} lantern  its glass [x, y, z] (and how lit, 0..1, as a fourth; 1 when absent), null when out
 * @property {number[]} [glassLook] its glass's [nits, metres across] (the hand lantern's, camp.json lantern, when absent)
 * @property {number[] | null} [mothsAt] where the lantern's moths circle [x, y, z] (the lantern, smoothed); the lantern when absent
 * @property {number[] | null} sparks   the steel [x, y, z, seconds since the strike (+10 per earlier strike)], or null
 * @property {boolean} moths      after dark
 * @property {number[] | null} [steam] a pot's steam on the hearth [x, y, z, amount 0..2] (P2e), or null
 * @property {number} time        real seconds
 */

/** The most placed lanterns (B2 L1) whose glass and moths are drawn. */
const MAX_EXTRA = 4;

/**
 * @param {{ recipe: any, low?: boolean }} opts recipe: recipes/world/camp.json; low: the low tier (fewer puffs and moths)
 */
export function createCampFxPass(opts) {
  const R = opts.recipe, F = R.flame, S = R.smoke, M = R.moths, K = R.steel, ST = R.steam;
  const puffs = opts.low ? S.lowCount : S.count, moths = opts.low ? M.lowCount : M.count;
  const wisps = ST ? (opts.low ? ST.lowCount : ST.count) : 0;
  const data = new Float32Array(FLOATS);
  // The steam (P2e) is drawn by the smoke's own pipeline from a copy of the uniforms with its own
  // place, look and count.
  const steamData = new Float32Array(FLOATS);
  let on = false;
  /** @type {GPURenderPipeline} */ let glowPipe;
  /** @type {GPURenderPipeline} */ let smokePipe;
  /** @type {GPURenderPipeline} */ let mothPipe;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBindGroup} */ let group;
  /** @type {GPUBuffer} */ let steamBuf;
  /** @type {GPUBindGroup} */ let steamGroup;
  let smokeOn = false, flameOn = false, mothsOn = false, steamOn = false;
  // The placed lanterns (B2 L1): each drawn by the glow and moth pipelines from its own copy of the
  // uniforms, its glass where the hand lantern's would be and no fire.
  const extraData = Array.from({ length: MAX_EXTRA }, () => new Float32Array(FLOATS));
  /** @type {GPUBuffer[]} */ const extraBufs = [];
  /** @type {GPUBindGroup[]} */ const extraGroups = [];
  let extraN = 0, extraMoths = false;

  /** One frame's uniforms. @param {Float32Array} out @param {CampFxFrame} f */
  function fill(out, f) {
    const L = f.lantern, G = f.glassLook ?? [R.lantern.glassNits, R.lantern.glassM];
    const sp = f.sparks;
    out.set([
      f.fire[0], f.fire[1], f.fire[2], f.flame,
      f.smoke, S.opacity, f.time, f.embers,
      f.wind[0], S.riseMps, f.wind[1], f.mist,
      L ? L[0] : 0, L ? L[1] : 0, L ? L[2] : 0, L ? L[3] ?? 1 : 0,
      F.heightM, 0, 0, 0,
      F.glowNits, F.glowM, G[0], G[1],
      S.lifeS, S.sizeM[0], S.sizeM[1], S.spreadM,
      S.albedo[0], S.albedo[1], S.albedo[2], S.nearFadeM[0],
      S.nearFadeM[1], puffs, F.minPx, 0,
      moths, M.orbitM[0], M.orbitM[1], M.wingM,
      M.heightM[0], M.heightM[1], M.speed[0], M.speed[1],
      M.albedo[0], M.albedo[1], M.albedo[2], M.flapHz,
      sp ? sp[0] : 0, sp ? sp[1] : 0, sp ? sp[2] : 0, sp ? sp[3] : -1,
      K.sparks, K.sparkS, K.sparkNits, f.moths ? 1 : 0,
    ]);
    const at = f.mothsAt ?? L;
    out.set([at ? at[0] : 0, at ? at[1] : 0, at ? at[2] : 0, 0], 56);
  }

  const pass = {
    name: 'campfx',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => on || extraN > 0,

    /** This frame's fire, or null when there is nothing to draw. @param {CampFxFrame | null} f */
    set(f) {
      on = !!f && (f.flame > 0 || f.smoke > 0 || f.embers > 0 || !!f.lantern || !!f.sparks || (!!f.steam && f.steam[3] > 0 && wisps > 0));
      if (!f || !on) return;
      const L = f.lantern;
      smokeOn = f.smoke > 0;
      flameOn = f.flame > 0 || f.embers > 0 || !!L || !!f.sparks;
      mothsOn = f.moths && (f.flame > 0 || !!L);
      fill(data, f);
      const st = f.steam;
      steamOn = !!st && st[3] > 0 && wisps > 0;
      if (steamOn && st) {
        steamData.set(data);
        steamData.set([st[0], st[1], st[2]], 0);
        steamData.set([st[3], ST.opacity], 4);
        steamData[9] = ST.riseMps;
        // Rising from the pot's top itself: no flame height under it.
        steamData[16] = 0;
        steamData.set([ST.lifeS, ST.sizeM[0], ST.sizeM[1], ST.spreadM, ST.albedo[0], ST.albedo[1], ST.albedo[2], ST.nearFadeM[0], ST.nearFadeM[1], wisps], 24);
      }
    },

    /**
     * The placed lanterns lit now (B2 L1): each one's glass [x, y, z, how lit 0..1] and its glass's
     * [nits, metres across]; whether moths are out (after dark), the time (real seconds) and the mist.
     * Moths circle each, half close in and half wider round its post.
     * @param {{ glass: number[], look: number[] }[]} list @param {boolean} mothsOut @param {number} time @param {number} mist
     */
    setLanterns(list, mothsOut, time, mist) {
      extraN = Math.min(MAX_EXTRA, list.length);
      extraMoths = mothsOut;
      for (let i = 0; i < extraN; i++) {
        const g = list[i].glass;
        fill(extraData[i], { fire: [g[0], g[1] - 0.75, g[2]], flame: 0, smoke: 0, embers: 0, wind: [0, 0], mist, lantern: g, glassLook: list[i].look,
          mothsAt: g, sparks: null, moths: mothsOut, time });
      }
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const d = ctx.device;
      const module = await makeShaderModule(d, 'camp-fx');
      const layout = d.createBindGroupLayout({ label: 'group2-campfx', entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] });
      const pl = d.createPipelineLayout({ label: 'campfx', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      const depthStencil = { format: /** @type {GPUTextureFormat} */ ('depth32float'), depthWriteEnabled: false, depthCompare: /** @type {GPUCompareFunction} */ ('greater') };
      const prim = { topology: /** @type {GPUPrimitiveTopology} */ ('triangle-list'), cullMode: /** @type {GPUCullMode} */ ('none') };
      const add = { color: { srcFactor: /** @type {GPUBlendFactor} */ ('one'), dstFactor: /** @type {GPUBlendFactor} */ ('one'), operation: /** @type {GPUBlendOperation} */ ('add') },
        alpha: { srcFactor: /** @type {GPUBlendFactor} */ ('zero'), dstFactor: /** @type {GPUBlendFactor} */ ('one'), operation: /** @type {GPUBlendOperation} */ ('add') } };
      const over = { color: { srcFactor: /** @type {GPUBlendFactor} */ ('one'), dstFactor: /** @type {GPUBlendFactor} */ ('one-minus-src-alpha'), operation: /** @type {GPUBlendOperation} */ ('add') },
        alpha: { srcFactor: /** @type {GPUBlendFactor} */ ('zero'), dstFactor: /** @type {GPUBlendFactor} */ ('one'), operation: /** @type {GPUBlendOperation} */ ('add') } };
      [glowPipe, smokePipe, mothPipe] = await Promise.all([
        d.createRenderPipelineAsync({ label: 'campfx-glow', layout: pl, vertex: { module, entryPoint: 'vsGlow' },
          fragment: { module, entryPoint: 'fsGlow', targets: [{ format: 'rgba16float', blend: add }] }, primitive: prim, depthStencil }),
        d.createRenderPipelineAsync({ label: 'campfx-smoke', layout: pl, vertex: { module, entryPoint: 'vsSmoke' },
          fragment: { module, entryPoint: 'fsSmoke', targets: [{ format: 'rgba16float', blend: over }] }, primitive: prim, depthStencil }),
        d.createRenderPipelineAsync({ label: 'campfx-moths', layout: pl, vertex: { module, entryPoint: 'vsMoth' },
          fragment: { module, entryPoint: 'fsMoth', targets: [{ format: 'rgba16float' }] }, primitive: prim, depthStencil }),
      ]);
      ubuf = makeBuffer(d, { label: 'campfx', size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      group = d.createBindGroup({ label: 'campfx', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
      steamBuf = makeBuffer(d, { label: 'campfx-steam', size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      steamGroup = d.createBindGroup({ label: 'campfx-steam', layout, entries: [{ binding: 0, resource: { buffer: steamBuf } }] });
      for (let i = 0; i < MAX_EXTRA; i++) {
        extraBufs.push(makeBuffer(d, { label: 'campfx-lantern', size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        extraGroups.push(d.createBindGroup({ label: 'campfx-lantern', layout, entries: [{ binding: 0, resource: { buffer: extraBufs[i] } }] }));
      }
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!glowPipe || (!on && !extraN)) return;
      if (on) ctx.device.queue.writeBuffer(ubuf, 0, data);
      if (on && steamOn) ctx.device.queue.writeBuffer(steamBuf, 0, steamData);
      for (let i = 0; i < extraN; i++) ctx.device.queue.writeBuffer(extraBufs[i], 0, extraData[i]);
      const rp = encoder.beginRenderPass({
        label: 'campfx',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthReadOnly: true },
        timestampWrites: ctx.timestampWrites('campfx'),
      });
      rp.setBindGroup(0, ctx.groups.frame);
      rp.setBindGroup(1, ctx.groups.lighting);
      // The placed lanterns: their moths, then their glass (the halo and spark instances draw nothing).
      for (let i = 0; i < extraN; i++) {
        rp.setBindGroup(2, extraGroups[i]);
        if (extraMoths) { rp.setPipeline(mothPipe); rp.draw(12, moths); }
        rp.setPipeline(glowPipe); rp.draw(6, 2);
      }
      if (on) {
        rp.setBindGroup(2, group);
        // Moths first (opaque wings), then the smoke over them, then the halo, glass and sparks added on top.
        if (mothsOn) { rp.setPipeline(mothPipe); rp.draw(12, moths); }
        if (smokeOn) { rp.setPipeline(smokePipe); rp.draw(6, puffs); }
        if (steamOn) { rp.setPipeline(smokePipe); rp.setBindGroup(2, steamGroup); rp.draw(6, wisps); rp.setBindGroup(2, group); }
        if (flameOn) { rp.setPipeline(glowPipe); rp.draw(6, 2 + K.sparks); }
      }
      rp.end();
    },
  };
  return pass;
}

/** @typedef {ReturnType<typeof createCampFxPass>} CampFxPass */
