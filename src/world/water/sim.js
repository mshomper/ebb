// @ts-check
// GPU shallow-water simulation (docs/07): the virtual pipe model on 0.5 m cells, two compute
// dispatches per fixed step (flux, then depth and velocity), ping-ponging depth and flux.
// Visual only: real seconds, not deterministic, never saved.

import { makeBuffer, makeShaderModule, makeTexture } from '../../core/gpu.js';
import { WATER_CELLS } from './grid.js';

const SIM_BYTES = 64;
const STATS_BYTES = 16;

/**
 * @param {GPUDevice} device
 * @param {{ height: GPUTexture }} terrainTex
 */
export async function createWaterSim(device, terrainTex) {
  const N = WATER_CELLS;
  const T = GPUTextureUsage;
  const tex = (/** @type {string} */ label, /** @type {GPUTextureFormat} */ format) => makeTexture(device, {
    label, size: [N, N], format, usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_DST | T.COPY_SRC,
  });
  const depth = [tex('water-depth-a', 'r32float'), tex('water-depth-b', 'r32float')];
  const flux = [tex('water-flux-a', 'rgba32float'), tex('water-flux-b', 'rgba32float')];
  const vel = tex('water-vel', 'rg32float');
  const uniforms = makeBuffer(device, { label: 'water-sim', size: SIM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const statsBuf = makeBuffer(device, { label: 'water-stats', size: STATS_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const statsRead = makeBuffer(device, { label: 'water-stats-read', size: STATS_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const [fluxMod, depthMod, statsMod] = await Promise.all([
    makeShaderModule(device, 'water-flux'), makeShaderModule(device, 'water-depth'), makeShaderModule(device, 'water-stats'),
  ]);
  const [fluxPipe, depthPipe, statsPipe] = await Promise.all([
    device.createComputePipelineAsync({ label: 'water-flux', layout: 'auto', compute: { module: fluxMod, entryPoint: 'csFlux' } }),
    device.createComputePipelineAsync({ label: 'water-depth', layout: 'auto', compute: { module: depthMod, entryPoint: 'csDepth' } }),
    device.createComputePipelineAsync({ label: 'water-stats', layout: 'auto', compute: { module: statsMod, entryPoint: 'csStats' } }),
  ]);
  const heightView = terrainTex.height.createView();
  // Step parity p reads depth[p] and flux[p], writes flux[1-p] then depth[1-p].
  const fluxGroups = [0, 1].map((p) => device.createBindGroup({
    label: `water-flux-${p}`, layout: fluxPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: heightView },
      { binding: 2, resource: depth[p].createView() },
      { binding: 3, resource: flux[p].createView() },
      { binding: 4, resource: flux[1 - p].createView() },
    ],
  }));
  const depthGroups = [0, 1].map((p) => device.createBindGroup({
    label: `water-depth-${p}`, layout: depthPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: heightView },
      { binding: 2, resource: depth[p].createView() },
      { binding: 3, resource: flux[1 - p].createView() },
      { binding: 4, resource: depth[1 - p].createView() },
      { binding: 5, resource: vel.createView() },
    ],
  }));
  const statsGroups = [0, 1].map((p) => device.createBindGroup({
    label: `water-stats-${p}`, layout: statsPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: depth[p].createView() },
      { binding: 2, resource: vel.createView() },
      { binding: 3, resource: { buffer: statsBuf } },
    ],
  }));

  const data = new ArrayBuffer(SIM_BYTES);
  const u = new Uint32Array(data);
  const f = new Float32Array(data);
  let cur = 0;             // which depth texture holds the latest state
  let statsBusy = false;
  let statsQueued = false;
  /** @type {null | { volumeM3: number, wetCells: number, maxSpeed: number, nan: number }} */
  let lastStats = null;

  /**
   * Upload starting depths for a rect and clear its flux.
   * @param {{ x: number, y: number, w: number, h: number }} r @param {Float32Array} d
   */
  function seed(r, d) {
    for (const t of depth) device.queue.writeTexture({ texture: t, origin: [r.x, r.y] }, d, { bytesPerRow: r.w * 4, rowsPerImage: r.h }, [r.w, r.h]);
    const zero = new Float32Array(r.w * r.h * 4);
    for (const t of flux) device.queue.writeTexture({ texture: t, origin: [r.x, r.y] }, zero, { bytesPerRow: r.w * 16, rowsPerImage: r.h }, [r.w, r.h]);
    device.queue.writeTexture({ texture: vel, origin: [r.x, r.y] }, new Float32Array(r.w * r.h * 2), { bytesPerRow: r.w * 8, rowsPerImage: r.h }, [r.w, r.h]);
  }

  /**
   * Record `steps` fixed steps.
   * @param {GPUCommandEncoder} encoder
   * @param {{ rect: { x: number, y: number, w: number, h: number }, steps: number, dt: number, tide: number,
   *   spring: { cell: [number, number], rate: number }, recipe: any, stats: boolean,
   *   timestampWrites?: GPUComputePassTimestampWrites }} o  recipe: water.json `sim`
   */
  function encode(encoder, o) {
    const r = o.rect;
    if (r.w < 3 || r.h < 3) return;
    const s = o.recipe;
    u[0] = r.x; u[1] = r.y; u[2] = r.w; u[3] = r.h;
    f[4] = o.dt; f[5] = s.friction; f[6] = s.thinFriction; f[7] = s.thinDepthM;
    f[8] = s.maxSpeed; f[9] = s.dryDepthM; f[10] = o.tide; f[11] = o.spring.rate;
    u[12] = o.spring.cell[0]; u[13] = o.spring.cell[1]; f[14] = 1 / s.manningN;
    device.queue.writeBuffer(uniforms, 0, data);
    const gx = Math.ceil(r.w / 8);
    const gy = Math.ceil(r.h / 8);
    const wantStats = o.stats && !statsBusy;
    if (wantStats) encoder.clearBuffer(statsBuf);
    if (o.steps <= 0 && !wantStats) return;
    const pass = encoder.beginComputePass({ label: 'water-sim', timestampWrites: o.timestampWrites });
    for (let i = 0; i < o.steps; i++) {
      pass.setPipeline(fluxPipe);
      pass.setBindGroup(0, fluxGroups[cur]);
      pass.dispatchWorkgroups(gx, gy);
      pass.setPipeline(depthPipe);
      pass.setBindGroup(0, depthGroups[cur]);
      pass.dispatchWorkgroups(gx, gy);
      cur = 1 - cur;
    }
    if (wantStats) {
      pass.setPipeline(statsPipe);
      pass.setBindGroup(0, statsGroups[cur]);
      pass.dispatchWorkgroups(gx, gy);
    }
    pass.end();
    if (wantStats) {
      encoder.copyBufferToBuffer(statsBuf, 0, statsRead, 0, STATS_BYTES);
      statsQueued = true;
    }
  }

  /** After the frame's submit: read the health numbers if a stats pass was recorded. */
  function afterSubmit() {
    if (!statsQueued) return;
    statsQueued = false;
    statsBusy = true;
    statsRead.mapAsync(GPUMapMode.READ).then(() => {
      const a = new Uint32Array(statsRead.getMappedRange().slice(0));
      statsRead.unmap();
      lastStats = { volumeM3: a[0] * 1e-4, wetCells: a[1], maxSpeed: new Float32Array(a.buffer, 8, 1)[0], nan: a[3] };
      statsBusy = false;
    }).catch(() => { statsBusy = false; });
  }

  /**
   * Read the current depths of a rect back to the CPU (tools and checks; not per frame).
   * @param {{ x: number, y: number, w: number, h: number }} r
   * @returns {Promise<Float32Array>} row-major depths (m)
   */
  async function readDepth(r) {
    const pitch = Math.ceil((r.w * 4) / 256) * 256;
    const buf = device.createBuffer({ label: 'water-depth-read', size: pitch * r.h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder({ label: 'water-depth-read' });
    enc.copyTextureToBuffer({ texture: depth[cur], origin: [r.x, r.y] }, { buffer: buf, bytesPerRow: pitch, rowsPerImage: r.h }, [r.w, r.h]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Float32Array(buf.getMappedRange());
    const out = new Float32Array(r.w * r.h);
    for (let j = 0; j < r.h; j++) out.set(src.subarray((j * pitch) / 4, (j * pitch) / 4 + r.w), j * r.w);
    buf.destroy();
    return out;
  }

  function dispose() {
    for (const t of [...depth, ...flux, vel]) t.destroy();
    uniforms.destroy(); statsBuf.destroy(); statsRead.destroy();
  }

  return {
    seed, encode, afterSubmit, dispose, readDepth,
    /** Latest depth texture (r32float, m). */
    get depth() { return depth[cur]; },
    /** Both depth textures, so draw bind groups can be built once and picked by `current`. */
    depthTextures: depth,
    get current() { return cur; },
    /** Velocity (rg32float, m/s). */
    vel,
    get stats() { return lastStats; },
  };
}

/** @typedef {Awaited<ReturnType<typeof createWaterSim>>} WaterSim */
