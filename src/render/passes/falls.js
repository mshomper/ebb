// @ts-check
// Waterfalls pass (M2 Cliff tool; docs/07, 08). Visual only. Each frame, after the water is drawn:
// a compute pass finds the lips where live water runs over a drop (water-falls.wgsl), then each lip
// is drawn as a curtain along a gravity arc, with soft spray where strong falls land
// (water-falls-draw.wgsl), blended into the HDR and depth tested. Draw counts come from the GPU
// (indirect draws), capped per quality tier, so the CPU never waits on the count.
// Recipe: water.json `falls`; tier: fallsMax, fallsRows. `?falls=0` turns it off.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const FALLS_BYTES = 112;
const LIP_BYTES = 48;
/** Room for the largest tier's cap (ultra). */
const MAX_LIPS = 4096;

/**
 * @param {{ water: import('../../world/water/index.js').Water, terrain: import('../../world/terrain/index.js').Terrain,
 *   recipe: any, getTime: () => number, tier: { fallsMax?: number, fallsRows?: number } }} opts
 *   recipe: water.json `falls`; getTime: real seconds
 */
export function createFallsPass(opts) {
  const { water, recipe: R } = opts;
  const off = new URLSearchParams(location.search).get('falls') === '0';
  const data = new ArrayBuffer(FALLS_BYTES);
  const f = new Float32Array(data);
  const u = new Uint32Array(data);
  f[4] = R.minDropM; f[5] = R.minDepthM; f[6] = R.minSpeedMs;
  f[10] = R.offsetM; f[11] = R.widthScale;
  f[12] = R.qThreadsM2s; f[13] = R.qSheetM2s; f[14] = R.streakM; f[15] = R.streakRateHz;
  f[16] = R.albedo; f[17] = R.opacity; f[18] = R.sprayFromM2s; f[19] = R.sprayM;
  f[20] = R.sprayOpacity; f[21] = R.lipStepM; f[22] = R.lipReachM; u[23] = R.sprayPuffs;
  f[24] = R.thicknessM[0]; f[25] = R.thicknessM[1]; f[26] = R.bulkM;
  /** @param {{ fallsMax?: number, fallsRows?: number }} t */
  const applyTier = (t) => { u[7] = Math.min(MAX_LIPS, t.fallsMax ?? 1024); u[8] = Math.max(2, t.fallsRows ?? 8); };
  applyTier(opts.tier);

  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let lipBuf;
  /** @type {GPUBuffer} */ let counter;
  /** @type {GPUBuffer} */ let argBuf;
  /** @type {GPUComputePipeline} */ let detectPipe;
  /** @type {GPUComputePipeline} */ let argsPipe;
  /** @type {GPURenderPipeline} */ let curtainPipe;
  /** @type {GPURenderPipeline} */ let sprayPipe;
  /** @type {GPUBindGroup[]} */ let detectGroups = [];
  /** @type {GPUBindGroup} */ let argsGroup;
  /** @type {GPUBindGroup} */ let drawGroup;
  const zero = new Uint32Array(4);

  return {
    name: 'falls',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => !off,

    /** Follow a new quality tier. @param {{ fallsMax?: number, fallsRows?: number }} t */
    setTier(t) { applyTier(t); },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      ubuf = makeBuffer(device, { label: 'falls', size: FALLS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      lipBuf = makeBuffer(device, { label: 'falls-lips', size: MAX_LIPS * LIP_BYTES, usage: GPUBufferUsage.STORAGE });
      counter = makeBuffer(device, { label: 'falls-count', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      argBuf = makeBuffer(device, { label: 'falls-args', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT });
      const [cModule, dModule] = await Promise.all([makeShaderModule(device, 'water-falls'), makeShaderModule(device, 'water-falls-draw')]);
      [detectPipe, argsPipe] = await Promise.all([
        device.createComputePipelineAsync({ label: 'falls-detect', layout: 'auto', compute: { module: cModule, entryPoint: 'csDetect' } }),
        device.createComputePipelineAsync({ label: 'falls-args', layout: 'auto', compute: { module: cModule, entryPoint: 'csArgs' } }),
      ]);
      const heightView = opts.terrain.gpu.height.createView();
      const velView = water.sim.vel.createView();
      detectGroups = water.sim.depthTextures.map((t, i) => device.createBindGroup({
        label: `falls-detect-${i}`, layout: detectPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ubuf } },
          { binding: 1, resource: heightView },
          { binding: 2, resource: t.createView() },
          { binding: 3, resource: velView },
          { binding: 4, resource: { buffer: lipBuf } },
          { binding: 5, resource: { buffer: counter } },
        ],
      }));
      argsGroup = device.createBindGroup({
        label: 'falls-args', layout: argsPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ubuf } },
          { binding: 5, resource: { buffer: counter } },
          { binding: 6, resource: { buffer: argBuf } },
        ],
      });
      const layout = device.createBindGroupLayout({
        label: 'group2-falls',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      drawGroup = device.createBindGroup({ label: 'falls-draw', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: lipBuf } }] });
      const pipeLayout = device.createPipelineLayout({ label: 'falls', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] });
      /** @param {string} vs @param {string} fs */
      const make = (vs, fs) => device.createRenderPipelineAsync({
        label: `falls-${vs}`,
        layout: pipeLayout,
        vertex: { module: dModule, entryPoint: vs },
        fragment: {
          module: dModule, entryPoint: fs,
          targets: [{ format: 'rgba16float', blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
      });
      [curtainPipe, sprayPipe] = await Promise.all([make('vsCurtain', 'fsCurtain'), make('vsSpray', 'fsSpray')]);
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      const r = water.rect;
      if (!curtainPipe || r.w < 4 || r.h < 4) return;
      u[0] = r.x; u[1] = r.y; u[2] = r.w; u[3] = r.h;
      f[9] = opts.getTime() % 3600;
      ctx.device.queue.writeBuffer(ubuf, 0, data);
      ctx.device.queue.writeBuffer(counter, 0, zero);
      const cp = encoder.beginComputePass({ label: 'falls-detect' });
      cp.setPipeline(detectPipe);
      cp.setBindGroup(0, detectGroups[water.sim.current]);
      cp.dispatchWorkgroups(Math.ceil(r.w / 8), Math.ceil(r.h / 8));
      cp.setPipeline(argsPipe);
      cp.setBindGroup(0, argsGroup);
      cp.dispatchWorkgroups(1);
      cp.end();
      const pass = encoder.beginRenderPass({
        label: 'falls',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthReadOnly: true },
        timestampWrites: ctx.timestampWrites('falls'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, drawGroup);
      pass.setPipeline(curtainPipe);
      pass.drawIndirect(argBuf, 0);
      pass.setPipeline(sprayPipe);
      pass.drawIndirect(argBuf, 16);
      pass.end();
    },
  };
}

/** @typedef {ReturnType<typeof createFallsPass>} FallsPass */
