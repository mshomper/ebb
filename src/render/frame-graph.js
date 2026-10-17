// @ts-check
// The frame graph: owns render targets and shared bind groups, runs passes in a fixed declared order,
// and measures each pass with GPU timestamps when available (docs/04, 19).

import { makeBuffer, makeTexture, untrack } from '../core/gpu.js';
import { emitDeferred } from '../core/events.js';
import { FRAME_UNIFORM_BYTES } from './frame-uniforms.js';

/**
 * @typedef {Object} Pass
 * @property {string} name
 * @property {string[]} reads
 * @property {string[]} writes
 * @property {(tier: string) => boolean} enabled
 * @property {(ctx: PassContext) => Promise<void>} setup
 * @property {(ctx: PassContext) => void} resize
 * @property {(encoder: GPUCommandEncoder, ctx: PassContext) => void} record
 */

/**
 * @typedef {Object} PassContext
 * @property {GPUDevice} device
 * @property {GPUCanvasContext} context
 * @property {GPUTextureFormat} format
 * @property {{ frame: GPUBindGroupLayout, lighting: GPUBindGroupLayout }} layouts
 * @property {{ frame: GPUBindGroup, lighting: GPUBindGroup }} groups
 * @property {{ hdr: GPUTexture, depth: GPUTexture, normalId: GPUTexture }} targets  normalId: oct normal RG, B water flag, A outline group (docs/04)
 * @property {[number, number]} size   internal render size in pixels
 * @property {(name: string) => GPURenderPassTimestampWrites | undefined} timestampWrites
 */

const READBACK_RING = 3;

/**
 * Group 0 layout (FrameUniforms), shared so other modules can build pipelines before the graph exists.
 * @param {GPUDevice} device
 */
export function createFrameLayout(device) {
  return device.createBindGroupLayout({
    label: 'group0-frame',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: {} }],
  });
}

/**
 * @param {import('../core/gpu.js').Gpu} gpu
 * @param {Pass[]} passes   in the order they run
 * @param {{ tier: string, lighting: { layout: GPUBindGroupLayout, group: GPUBindGroup } }} opts
 *   lighting is group 1 (src/render/lighting.js)
 */
export function createFrameGraph(gpu, passes, opts) {
  const { device, context, format } = gpu;
  const canTime = gpu.features.has('timestamp-query');

  const frameLayout = createFrameLayout(device);
  const frameBuffer = makeBuffer(device, {
    label: 'frame-uniforms', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  /** @type {PassContext} */
  const ctx = {
    device, context, format,
    layouts: { frame: frameLayout, lighting: opts.lighting.layout },
    groups: {
      frame: device.createBindGroup({ label: 'frame', layout: frameLayout, entries: [{ binding: 0, resource: { buffer: frameBuffer } }] }),
      lighting: opts.lighting.group,
    },
    targets: /** @type {any} */ ({}),
    size: [0, 0],
    timestampWrites: () => undefined,
  };

  // GPU timing: two timestamps per pass, resolved into a ring of mappable buffers.
  const active = () => passes.filter((p) => p.enabled(opts.tier));
  /** @type {GPUQuerySet | null} */ let querySet = null;
  /** @type {GPUBuffer | null} */ let resolveBuffer = null;
  /** @type {{ buffer: GPUBuffer, busy: boolean, names: string[] }[]} */ const ring = [];
  /** @type {Map<string, number>} */ const queryIndex = new Map();
  /** @type {typeof ring[number] | null} */ let pendingReadback = null;

  if (canTime) {
    const count = passes.length * 2;
    querySet = device.createQuerySet({ type: 'timestamp', count });
    resolveBuffer = makeBuffer(device, {
      label: 'timestamp-resolve', size: count * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let i = 0; i < READBACK_RING; i++) {
      ring.push({
        buffer: makeBuffer(device, { label: `timestamp-readback-${i}`, size: count * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
        busy: false, names: [],
      });
    }
    passes.forEach((p, i) => queryIndex.set(p.name, i));
    ctx.timestampWrites = (name) => {
      const i = queryIndex.get(name);
      if (i === undefined || !querySet) return undefined;
      return { querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
    };
  }

  async function setup() {
    await Promise.all(passes.map((p) => p.setup(ctx)));
  }

  /**
   * (Re)create size-dependent targets.
   * @param {number} width  internal pixels
   * @param {number} height internal pixels
   */
  function resize(width, height) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (width === ctx.size[0] && height === ctx.size[1]) return;
    ctx.targets.hdr?.destroy();
    ctx.targets.depth?.destroy();
    ctx.targets.normalId?.destroy();
    untrack('hdr');
    untrack('depth');
    untrack('normalId');
    ctx.size = [width, height];
    ctx.targets = {
      hdr: makeTexture(device, {
        label: 'hdr', size: [width, height], format: 'rgba16float',
        // COPY_SRC: the water pass copies the opaque scene for refraction (docs/04).
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      }),
      depth: makeTexture(device, {
        label: 'depth', size: [width, height], format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      }),
      normalId: makeTexture(device, {
        label: 'normalId', size: [width, height], format: 'rgb10a2unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    };
    for (const p of passes) p.resize(ctx);
    emitDeferred('render:resized', { width, height });
  }

  /** @param {ArrayBuffer} frameUniforms */
  function writeFrameUniforms(frameUniforms) {
    device.queue.writeBuffer(frameBuffer, 0, frameUniforms);
  }

  /**
   * Record every enabled pass into the encoder, in declared order.
   * @param {GPUCommandEncoder} encoder
   */
  function render(encoder) {
    const run = active();
    for (const p of run) p.record(encoder, ctx);
    pendingReadback = null;
    if (querySet && resolveBuffer) {
      const slot = ring.find((r) => !r.busy);
      if (slot) {
        encoder.resolveQuerySet(querySet, 0, passes.length * 2, resolveBuffer, 0);
        encoder.copyBufferToBuffer(resolveBuffer, 0, slot.buffer, 0, passes.length * 16);
        slot.busy = true;
        slot.names = run.map((p) => p.name);
        pendingReadback = slot;
      }
    }
  }

  /** Call after queue.submit: reads back this frame's timestamps and emits render:timings. */
  function afterSubmit() {
    const slot = pendingReadback;
    pendingReadback = null;
    if (!slot) return;
    slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigInt64Array(slot.buffer.getMappedRange());
      /** @type {{ name: string, ms: number }[]} */
      const timings = [];
      for (const name of slot.names) {
        const i = /** @type {number} */ (queryIndex.get(name));
        const ns = Number(t[i * 2 + 1] - t[i * 2]);
        timings.push({ name, ms: Math.max(0, ns) / 1e6 });
      }
      slot.buffer.unmap();
      slot.busy = false;
      emitDeferred('render:timings', { passes: timings, gpu: true });
    }).catch(() => { slot.busy = false; });
  }

  function dispose() {
    ctx.targets.hdr?.destroy();
    ctx.targets.depth?.destroy();
    ctx.targets.normalId?.destroy();
    querySet?.destroy();
  }

  return {
    setup, resize, writeFrameUniforms, render, afterSubmit, dispose,
    get size() { return ctx.size; },
    get timingSupported() { return canTime; },
    passNames: () => active().map((p) => p.name),
  };
}
