// @ts-check
// Webs pass (autumn, doc 13): the dewy orb webs in the tall grass on misty mornings, spun in the
// vertex shader from each web's seed (web-draw.wgsl: threads as thin strips, dew beads and the
// spider as small quads), blended softly into the HDR after the grass and pieces, depth tested but
// not written. Ten webs are a few tens of thousands of vertices and no textures: a tiny cost. The
// webs and their dew come from src/world/finds/autumn-live.js each frame.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';

/** @typedef {import('../frame-graph.js').PassContext} PassContext */

const DRAW_BYTES = 112;
const MAX = 16;
const WEB_BYTES = 48;

/** @param {{ recipe: any }} opts recipe: autumn-finds.json webs */
export function createWebsPass(opts) {
  const W = opts.recipe, S = W.shape, L = W.look, B = W.bead;
  const data = new Float32Array(DRAW_BYTES / 4);
  data.set([S.spokes, S.rounds, S.hubShare, S.beads, L.threadM, L.beadM, L.minPx, S.anchors,
    ...L.silkAlbedo, L.glint[0], B.reflect, B.forward, B.forwardG, B.sky,
    0, 0, W.swayM, B.twinkle, ...W.spiderAlbedo, W.spiderM, L.glint[1], 0, 0, 0]);
  // Quads a web: spokes, spiral, frame, anchors, beads, the spider.
  const quads = S.spokes * 2 + S.rounds * S.spokes + S.anchors + S.rounds * S.spokes * S.beads + 1;
  const list = new ArrayBuffer(MAX * WEB_BYTES);
  const lf = new Float32Array(list), lu = new Uint32Array(list);
  let count = 0;
  /** @type {GPURenderPipeline} */ let pipe;
  /** @type {GPUBuffer} */ let ubuf;
  /** @type {GPUBuffer} */ let sbuf;
  /** @type {GPUBindGroup} */ let group;

  return {
    name: 'webs',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => count > 0,

    /**
     * This frame's webs. @param {{ x: number, y: number, z: number, yaw: number, r: number, dew: number, seed: number }[]} webs
     *   y: the hub's height in the world @param {number} t animation seconds
     */
    set(webs, t) {
      count = 0;
      for (const w of webs) {
        if (count >= MAX || !(w.dew > 0)) continue;
        const o = count * (WEB_BYTES / 4);
        lf.set([w.x, w.y, w.z, w.yaw, w.r, w.dew, 0, 0], o);
        lu[o + 8] = w.seed >>> 0;
        count++;
      }
      data[16] = count;
      data[17] = t;
    },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'web-draw');
      const layout = device.createBindGroupLayout({
        label: 'group2-webs',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      pipe = await device.createRenderPipelineAsync({
        label: 'webs',
        layout: device.createPipelineLayout({ label: 'webs', bindGroupLayouts: [ctx.layouts.frame, ctx.layouts.lighting, layout] }),
        vertex: { module, entryPoint: 'vsWeb' },
        fragment: {
          module, entryPoint: 'fsWeb',
          targets: [{ format: 'rgba16float', blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
      });
      ubuf = makeBuffer(device, { label: 'web-draw', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      sbuf = makeBuffer(device, { label: 'web-list', size: list.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      group = device.createBindGroup({ label: 'webs', layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: sbuf } }] });
    },

    resize() {},

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!pipe || !count) return;
      ctx.device.queue.writeBuffer(ubuf, 0, data);
      ctx.device.queue.writeBuffer(sbuf, 0, list, 0, count * WEB_BYTES);
      const pass = encoder.beginRenderPass({
        label: 'webs',
        colorAttachments: [{ view: ctx.targets.hdr.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: ctx.targets.depth.createView(), depthReadOnly: true },
        timestampWrites: ctx.timestampWrites('webs'),
      });
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, ctx.groups.lighting);
      pass.setBindGroup(2, group);
      pass.setPipeline(pipe);
      pass.draw(quads * 6, count);
      pass.end();
    },

    /** Vertices one web is drawn with (tools: the cost). */
    verticesPerWeb: quads * 6,
  };
}
