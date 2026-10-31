// @ts-check
// GPU shallow-water simulation (docs/07): the virtual pipe model on 0.5 m cells, two compute
// dispatches per fixed step (flux, then depth and velocity), ping-ponging depth and flux.
// Visual only: real seconds, not deterministic, never saved.

import { makeBuffer, makeShaderModule, makeTexture } from '../../core/gpu.js';
import { WATER_CELLS } from './grid.js';

const SIM_BYTES = 160;
/** Most sources at once: the starter spring, up to four placed springs, the pour or drain brush. */
export const MAX_SOURCES = 6;
const READ_RING = 3;
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
  // Summary target depth (m) for the refill nudge; written from the CPU when a summary arrives.
  const target = makeTexture(device, { label: 'water-target', size: [N, N], format: 'r32float', usage: T.TEXTURE_BINDING | T.COPY_DST });
  // The summary's damp hollows (r, 1 = damp), for the terrain's damp look, and where a drying margin
  // may crack (g, F13: the bare edge of a pond the season has lowered); filterable, so edges blur.
  const damp = makeTexture(device, { label: 'water-damp', size: [N, N], format: 'rg8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST });
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
      { binding: 6, resource: target.createView() },
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
   * Set the summary's target depths (m) for a rect; the nudge tops live water up toward them.
   * @param {{ x: number, y: number, w: number, h: number }} r @param {Float32Array} d
   */
  function setTarget(r, d) {
    device.queue.writeTexture({ texture: target, origin: [r.x, r.y] }, d, { bytesPerRow: r.w * 4, rowsPerImage: r.h }, [r.w, r.h]);
  }

  /**
   * Set the summary's damp hollows and where a drying margin may crack, for a rect: two bytes per
   * cell (damp, crack), each 0 or 255.
   * @param {{ x: number, y: number, w: number, h: number }} r @param {Uint8Array} m
   */
  function setDamp(r, m) {
    device.queue.writeTexture({ texture: damp, origin: [r.x, r.y] }, m, { bytesPerRow: r.w * 2, rowsPerImage: r.h }, [r.w, r.h]);
  }

  /**
   * @typedef {{ cell: [number, number], rateM3s: number, radius: number }} Source
   *   rateM3s negative drains (the drain mode); radius in cells, 0 for a single cell
   */

  /**
   * Record `steps` fixed steps.
   * @param {GPUCommandEncoder} encoder
   * @param {{ rect: { x: number, y: number, w: number, h: number }, steps: number, dt: number, tide: number,
   *   sources: Source[], nudgeK: number, evaporateK?: number, recipe: any, stats: boolean,
   *   timestampWrites?: GPUComputePassTimestampWrites }} o  recipe: water.json `sim`
   */
  function encode(encoder, o) {
    const r = o.rect;
    if (r.w < 3 || r.h < 3) return;
    const s = o.recipe;
    u[0] = r.x; u[1] = r.y; u[2] = r.w; u[3] = r.h;
    f[4] = o.dt; f[5] = s.friction; f[6] = s.thinFriction; f[7] = s.thinDepthM;
    f[8] = s.maxSpeed; f[9] = s.dryDepthM; f[10] = o.tide; f[11] = o.nudgeK;
    const n = Math.min(o.sources.length, MAX_SOURCES);
    u[12] = n; f[13] = 1 / s.manningN; f[14] = o.evaporateK ?? 0;
    for (let i = 0; i < n; i++) {
      const src = o.sources[i];
      f.set([src.cell[0], src.cell[1], src.rateM3s, src.radius], 16 + i * 4);
    }
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

  // Live readback for creatures (docs/07): depth and velocity of the rect, copied into a ring of
  // three mappable buffers a few times a second, so a read never stalls the GPU.
  /** @type {{ buffer: GPUBuffer, busy: boolean, rect: any, pitchD: number, pitchV: number }[]} */
  const ring = [];
  /** @type {typeof ring[number] | null} */ let readQueued = null;
  /** @type {null | { rect: { x: number, y: number, w: number, h: number }, depth: Float32Array, vel: Float32Array, at: number }} */
  let live = null;

  /**
   * Record a copy of the rect's depth and velocity for the CPU, if a ring slot is free.
   * @param {GPUCommandEncoder} encoder @param {{ x: number, y: number, w: number, h: number }} r
   */
  function encodeReadback(encoder, r) {
    let slot = ring.find((x) => !x.busy);
    const pitchD = Math.ceil((r.w * 4) / 256) * 256;
    const pitchV = Math.ceil((r.w * 8) / 256) * 256;
    const size = (pitchD + pitchV) * r.h;
    if (!slot && ring.length < READ_RING) {
      slot = { buffer: makeBuffer(device, { label: `water-live-read-${ring.length}`, size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false, rect: r, pitchD, pitchV };
      ring.push(slot);
    }
    if (!slot) return;
    // The rect grew (new land risen, src/world/islet): this slot's copy is too small, so it grows.
    if (slot.buffer.size < size) { slot.buffer.destroy(); slot.buffer = makeBuffer(device, { label: 'water-live-read-grown', size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); }
    slot.rect = { ...r }; slot.pitchD = pitchD; slot.pitchV = pitchV;
    encoder.copyTextureToBuffer({ texture: depth[cur], origin: [r.x, r.y] }, { buffer: slot.buffer, bytesPerRow: pitchD, rowsPerImage: r.h }, [r.w, r.h]);
    encoder.copyTextureToBuffer({ texture: vel, origin: [r.x, r.y] }, { buffer: slot.buffer, offset: pitchD * r.h, bytesPerRow: pitchV, rowsPerImage: r.h }, [r.w, r.h]);
    slot.busy = true;
    readQueued = slot;
  }

  function mapReadback() {
    const slot = readQueued;
    readQueued = null;
    if (!slot) return;
    slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const r = slot.rect;
      const all = new Float32Array(slot.buffer.getMappedRange());
      const d = new Float32Array(r.w * r.h);
      const v = new Float32Array(r.w * r.h * 2);
      for (let j = 0; j < r.h; j++) {
        d.set(all.subarray((j * slot.pitchD) / 4, (j * slot.pitchD) / 4 + r.w), j * r.w);
        const o = (slot.pitchD * r.h + j * slot.pitchV) / 4;
        v.set(all.subarray(o, o + r.w * 2), j * r.w * 2);
      }
      slot.buffer.unmap();
      slot.busy = false;
      live = { rect: r, depth: d, vel: v, at: performance.now() };
    }).catch(() => { slot.busy = false; });
  }

  /** After the frame's submit: read the health numbers if a stats pass was recorded. */
  function afterSubmit() {
    mapReadback();
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
    for (const t of [...depth, ...flux, vel, target, damp]) t.destroy();
    for (const s of ring) s.buffer.destroy();
    uniforms.destroy(); statsBuf.destroy(); statsRead.destroy();
  }

  return {
    seed, encode, afterSubmit, dispose, readDepth, setTarget, setDamp, encodeReadback,
    /** The summary's damp hollows (r8unorm, 0.5 m), for the terrain. */
    damp,
    /** Latest CPU copy of depth and velocity (a few times a second), or null. */
    get live() { return live; },
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
