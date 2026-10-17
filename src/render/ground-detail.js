// @ts-check
// Scanned ground detail (docs/22): two 2d-array textures, one layer per material in the order
// grass, sand, rock, soil (the material weight order, doc 08).
//   Array A  rgba8unorm, sampled through an rgba8unorm-srgb view: RGB albedo, A height.
//   Array B  rgba8unorm: RG normal X,Y (OpenGL, Z rebuilt), B roughness, A cavity.
// Starts as tiny neutral placeholders so bind groups can be built at boot. load() fetches the tier's
// WebP set (three opaque RGB files per material), repacks it on the GPU, builds the mips
// (linear-light albedo, Toksvig roughness, ground-mips.wgsl), swaps the arrays in and bumps
// `version` so the terrain pass rebuilds its bind group. The detail then fades in over fadeInS.

import { makeShaderModule, makeTexture, untrack } from '../core/gpu.js';
import { emitDeferred } from '../core/events.js';

/** Array layer order. */
export const MATERIALS = /** @type {const} */ (['grass', 'sand', 'rock', 'soil']);
const FILES = /** @type {const} */ (['a', 'b', 'c']);
const REPO_ROOT = new URL('../../', import.meta.url);
const PLACEHOLDER_SIZE = 4;
/** Placeholder texel bytes. A: albedo white (linear 1), height 0.5. B: flat normal, roughness 0.85, cavity 1. */
export const PLACEHOLDER = { a: [255, 255, 255, 128], b: [128, 128, 217, 255] };
/** Ticks a replaced pair of arrays stays alive, so a bind group built on it is never used after destroy. */
const RETIRE_TICKS = 3;
const LABEL_A = 'ground-detail-a';
const LABEL_B = 'ground-detail-b';

/**
 * @typedef {Object} LoadStats
 * @property {number} fetchDecodeMs   fetch + WebP decode of all 12 files (CPU, parallel)
 * @property {number} encodeMs        CPU time to record and submit uploads, repack and mips
 * @property {number} gpuWallMs       submit to queue idle, wall clock (an upper bound on GPU time)
 * @property {number | null} packGpuMs  GPU timestamps: the four repack passes summed (image copies not included)
 * @property {number | null} mipGpuMs   GPU timestamps: the mip pass
 */

/**
 * @typedef {Object} GroundDetail
 * @property {{ a: GPUTextureView, b: GPUTextureView }} views  2d-array views; `a` is rgba8unorm-srgb
 * @property {{ a: GPUTexture, b: GPUTexture }} textures  the arrays behind `views` (for tools pages and readback)
 * @property {GPUSampler} sampler   trilinear, repeat U/V, tier anisotropy
 * @property {number} version       bumps whenever the textures are replaced
 * @property {number} fade          detail strength 0..1, advanced by tick() once ready
 * @property {boolean} ready        true once the scanned set is built
 * @property {number} mapSize       texels per side of the arrays now bound
 * @property {LoadStats | null} stats  timings of the last successful load (GPU numbers arrive a little later)
 * @property {(dt: number) => void} tick
 * @property {(baseUrl?: string) => Promise<boolean>} load  resolves true when ready, false on failure; never rejects
 * @property {() => void} dispose
 */

/** @param {number} n */
const mipCount = (n) => Math.floor(Math.log2(n)) + 1;

/**
 * @param {GPUDevice} device
 * @param {{ tier: any, recipe: any }} opts  tier = quality tier `ground` block, recipe = terrain.json `detail`
 * @returns {GroundDetail}
 */
export function createGroundDetail(device, { tier, recipe }) {
  const sampler = device.createSampler({
    label: 'ground-detail',
    addressModeU: 'repeat', addressModeV: 'repeat',
    magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
    maxAnisotropy: Math.min(16, Math.max(1, Math.round(tier.anisotropy ?? 1))),
  });

  let current = createArrays(device, PLACEHOLDER_SIZE);
  fillPlaceholder(device, current);
  /** @type {{ pair: Arrays, ticks: number }[]} */
  const retired = [];
  /** @type {Promise<Pipelines> | null} */
  let pipelines = null;
  /** @type {Promise<boolean> | null} */
  let loading = null;
  let disposed = false;
  let warned = false;

  /** @type {GroundDetail} */
  const gd = {
    views: viewsOf(current),
    textures: current,
    sampler,
    version: 0,
    fade: 0,
    ready: false,
    mapSize: PLACEHOLDER_SIZE,
    stats: null,
    tick,
    load,
    dispose,
  };

  /** @param {number} dt seconds */
  function tick(dt) {
    for (let i = retired.length - 1; i >= 0; i--) {
      if (--retired[i].ticks > 0) continue;
      destroyArrays(retired[i].pair);
      retired.splice(i, 1);
    }
    if (!gd.ready || gd.fade >= 1) return;
    const s = recipe?.fadeInS ?? 0.5;
    gd.fade = s > 0 ? Math.min(1, gd.fade + dt / s) : 1;
  }

  /** @param {string} [baseUrl] */
  function load(baseUrl = 'assets/textures/ground/') {
    if (disposed) return Promise.resolve(false);
    if (!loading) loading = run(baseUrl).finally(() => { loading = null; });
    return loading;
  }

  /** @param {string} message @param {unknown} [err] */
  function warnOnce(message, err) {
    if (!warned) console.warn(`[ground-detail] ${message}; the ground stays flat.`, err ?? '');
    warned = true;
  }

  /** @param {string} baseUrl */
  async function run(baseUrl) {
    const t0 = performance.now();
    const size = tier.mapSize;
    // Relative paths resolve from the repo root, so index.html and tools/ pages load the same files.
    const root = new URL(baseUrl, REPO_ROOT);
    pipelines ??= createPipelines(device);
    pipelines.catch(() => {}); // awaited below; a failure there is reported once, not as unhandled
    /** @type {ImageBitmap[]} */
    let bitmaps = [];
    try {
      const settled = await Promise.allSettled(MATERIALS.flatMap((m) => FILES.map((f) => fetchBitmap(new URL(`${m}/${size}/${f}.webp`, root)))));
      bitmaps = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const failed = settled.find((r) => r.status === 'rejected');
      if (failed) throw /** @type {PromiseRejectedResult} */ (failed).reason;
      const n = bitmaps[0].width;
      if (bitmaps.some((b) => b.width !== n || b.height !== n) || (n & (n - 1)) !== 0) {
        throw new Error(`maps must all be the same power-of-two square (got ${bitmaps.map((b) => `${b.width}x${b.height}`).join(', ')})`);
      }
      const pipes = await pipelines;
      if (disposed) return false;
      const t1 = performance.now();

      device.pushErrorScope('out-of-memory');
      device.pushErrorScope('validation');
      const next = createArrays(device, n);
      const timing = createTiming(device);
      let thrown = null;
      try {
        encodeBuild(device, pipes, bitmaps, next, timing);
      } catch (err) {
        thrown = err;
      }
      const t2 = performance.now();
      const [validation, oom] = [await device.popErrorScope(), await device.popErrorScope()];
      if (thrown || validation || oom || disposed) {
        destroyArrays(next);
        timing?.destroy();
        if (thrown) throw thrown;
        if (!disposed) warnOnce('could not build the detail arrays', validation ?? oom);
        return false;
      }

      /** @type {LoadStats} */
      const stats = { fetchDecodeMs: t1 - t0, encodeMs: t2 - t1, gpuWallMs: NaN, packGpuMs: null, mipGpuMs: null };
      gd.stats = stats;
      device.queue.onSubmittedWorkDone().then(() => { stats.gpuWallMs = performance.now() - t1; });
      timing?.read().then((t) => { stats.packGpuMs = t.packMs; stats.mipGpuMs = t.mipMs; });

      // Queue order makes the new arrays complete before any later draw samples them.
      retired.push({ pair: current, ticks: RETIRE_TICKS });
      current = next;
      gd.views = viewsOf(current);
      gd.textures = current;
      gd.mapSize = n;
      gd.version++;
      gd.ready = true;
      emitDeferred('ground:detail-ready', { mapSize: n });
      return true;
    } catch (err) {
      pipelines = null; // a later load() retries from scratch
      warnOnce(`could not load ${size}px maps from ${root.href}`, err);
      return false;
    } finally {
      for (const b of bitmaps) b.close();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const r of retired) destroyArrays(r.pair);
    retired.length = 0;
    destroyArrays(current);
    untrack(LABEL_A);
    untrack(LABEL_B);
    gd.ready = false;
  }

  return gd;
}

/** @typedef {{ a: GPUTexture, b: GPUTexture }} Arrays */
/** @typedef {{ pack: GPUComputePipeline, mipA: GPUComputePipeline, mipB: GPUComputePipeline }} Pipelines */

/** @param {GPUDevice} device @param {number} n */
function createArrays(device, n) {
  // COPY_SRC lets tools pages read the maps and mips back.
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
  const size = [n, n, MATERIALS.length];
  const mipLevelCount = mipCount(n);
  return {
    a: makeTexture(device, { label: LABEL_A, size, mipLevelCount, format: 'rgba8unorm', viewFormats: ['rgba8unorm-srgb'], usage }),
    b: makeTexture(device, { label: LABEL_B, size, mipLevelCount, format: 'rgba8unorm', usage }),
  };
}

/** @param {Arrays} t */
function destroyArrays(t) {
  t.a.destroy();
  t.b.destroy();
}

/** @param {Arrays} t */
function viewsOf(t) {
  return {
    // Explicit usage: the texture also has STORAGE_BINDING, which an sRGB view cannot carry.
    a: t.a.createView({ label: 'ground-detail-a-srgb', format: 'rgba8unorm-srgb', dimension: '2d-array', usage: GPUTextureUsage.TEXTURE_BINDING }),
    b: t.b.createView({ label: 'ground-detail-b', dimension: '2d-array', usage: GPUTextureUsage.TEXTURE_BINDING }),
  };
}

/** @param {GPUDevice} device @param {Arrays} t */
function fillPlaceholder(device, t) {
  const layers = MATERIALS.length;
  for (const [tex, texel] of /** @type {[GPUTexture, number[]][]} */ ([[t.a, PLACEHOLDER.a], [t.b, PLACEHOLDER.b]])) {
    for (let level = 0; level < tex.mipLevelCount; level++) {
      const s = Math.max(1, PLACEHOLDER_SIZE >> level);
      const data = new Uint8Array(s * s * layers * 4);
      for (let i = 0; i < data.length; i += 4) data.set(texel, i);
      device.queue.writeTexture({ texture: tex, mipLevel: level }, data, { bytesPerRow: s * 4, rowsPerImage: s }, [s, s, layers]);
    }
  }
}

/** @param {URL} url */
async function fetchBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname} (${res.status})`);
  // Raw bytes: no premultiply, no color management. Normals, roughness and height are data.
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** @param {GPUDevice} device @returns {Promise<Pipelines>} */
async function createPipelines(device) {
  const [packModule, mipModule] = await Promise.all([makeShaderModule(device, 'ground-pack'), makeShaderModule(device, 'ground-mips')]);
  const [pack, mipA, mipB] = await Promise.all([
    device.createComputePipelineAsync({ label: 'ground-pack', layout: 'auto', compute: { module: packModule, entryPoint: 'csPack' } }),
    device.createComputePipelineAsync({ label: 'ground-mip-a', layout: 'auto', compute: { module: mipModule, entryPoint: 'csMipA' } }),
    device.createComputePipelineAsync({ label: 'ground-mip-b', layout: 'auto', compute: { module: mipModule, entryPoint: 'csMipB' } }),
  ]);
  return { pack, mipA, mipB };
}

/**
 * Upload, repack and build the mips. One small staging set is reused for each material: queue
 * order runs each layer's copies and repack before the next layer's copies overwrite it.
 * @param {GPUDevice} device
 * @param {Pipelines} pipes
 * @param {ImageBitmap[]} bitmaps  material-major, files a, b, c
 * @param {Arrays} dst
 * @param {Timing | null} timing
 */
function encodeBuild(device, pipes, bitmaps, dst, timing) {
  const n = dst.a.width;
  const layers = MATERIALS.length;
  const staging = FILES.map((f) => device.createTexture({
    label: `ground-detail-staging-${f}`, size: [n, n], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  const stagingViews = staging.map((t) => t.createView());
  const groups = n / 8;

  for (let layer = 0; layer < layers; layer++) {
    for (let f = 0; f < FILES.length; f++) {
      device.queue.copyExternalImageToTexture({ source: bitmaps[layer * FILES.length + f] }, { texture: staging[f] }, [n, n]);
    }
    /** @param {GPUTexture} t */
    const layerView = (t) => t.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1, usage: GPUTextureUsage.STORAGE_BINDING });
    const bind = device.createBindGroup({
      label: 'ground-pack',
      layout: pipes.pack.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: stagingViews[0] },
        { binding: 1, resource: stagingViews[1] },
        { binding: 2, resource: stagingViews[2] },
        { binding: 3, resource: layerView(dst.a) },
        { binding: 4, resource: layerView(dst.b) },
      ],
    });
    const encoder = device.createCommandEncoder({ label: 'ground-pack' });
    const pass = encoder.beginComputePass({ label: 'ground-pack', timestampWrites: timing?.packWrites(layer) });
    pass.setPipeline(pipes.pack);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(groups), Math.ceil(groups));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  const encoder = device.createCommandEncoder({ label: 'ground-mips' });
  const pass = encoder.beginComputePass({ label: 'ground-mips', timestampWrites: timing?.mipWrites });
  /**
   * @param {GPUTexture} t @param {number} level @param {GPUTextureFormat} format @param {number} usage
   */
  const levelView = (t, level, format, usage) => t.createView({ format, dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1, usage });
  for (let level = 0; level + 1 < dst.a.mipLevelCount; level++) {
    const s = Math.max(1, n >> (level + 1));
    const wg = Math.ceil(s / 8);
    for (const [pipe, tex, readFormat, base] of /** @type {[GPUComputePipeline, GPUTexture, GPUTextureFormat, number][]} */ ([
      [pipes.mipA, dst.a, 'rgba8unorm-srgb', 0],
      [pipes.mipB, dst.b, 'rgba8unorm', 2],
    ])) {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, device.createBindGroup({
        label: pipe.label,
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: base, resource: levelView(tex, level, readFormat, GPUTextureUsage.TEXTURE_BINDING) },
          { binding: base + 1, resource: levelView(tex, level + 1, 'rgba8unorm', GPUTextureUsage.STORAGE_BINDING) },
        ],
      }));
      pass.dispatchWorkgroups(wg, wg, layers);
    }
  }
  pass.end();
  timing?.resolve(encoder);
  device.queue.submit([encoder.finish()]);
  for (const t of staging) t.destroy(); // freed once the queued work that uses it completes
}

/**
 * @typedef {Object} Timing
 * @property {(layer: number) => GPUComputePassTimestampWrites} packWrites
 * @property {GPUComputePassTimestampWrites} mipWrites
 * @property {(encoder: GPUCommandEncoder) => void} resolve
 * @property {() => Promise<{ packMs: number, mipMs: number }>} read
 * @property {() => void} destroy
 */

/**
 * GPU timestamps around each repack pass (one per layer) and the mip pass, when the device has
 * timestamp-query. Query pairs: 0..layers-1 repack, layers = mips.
 * @param {GPUDevice} device @returns {Timing | null}
 */
function createTiming(device) {
  if (!device.features.has('timestamp-query')) return null;
  const pairs = MATERIALS.length + 1;
  const bytes = pairs * 16;
  const querySet = device.createQuerySet({ label: 'ground-detail-time', type: 'timestamp', count: pairs * 2 });
  const resolveBuf = device.createBuffer({ label: 'ground-detail-time', size: bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ label: 'ground-detail-time-read', size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const destroy = () => { querySet.destroy(); resolveBuf.destroy(); readBuf.destroy(); };
  /** @param {number} i */
  const pair = (i) => ({ querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 });
  return {
    packWrites: (layer) => pair(layer),
    mipWrites: pair(MATERIALS.length),
    resolve(encoder) {
      encoder.resolveQuerySet(querySet, 0, pairs * 2, resolveBuf, 0);
      encoder.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, bytes);
    },
    async read() {
      try {
        await readBuf.mapAsync(GPUMapMode.READ);
        const t = new BigInt64Array(readBuf.getMappedRange().slice(0));
        const span = (/** @type {number} */ i) => Number(t[i * 2 + 1] - t[i * 2]) / 1e6;
        let packMs = 0;
        for (let i = 0; i < MATERIALS.length; i++) packMs += span(i);
        return { packMs, mipMs: span(MATERIALS.length) };
      } finally {
        destroy();
      }
    },
    destroy,
  };
}
