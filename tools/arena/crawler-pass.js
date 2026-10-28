// @ts-check
// The silt crawlers drawn on the workbench stage (H2; tools/walker-figure-stage.js): Matt's crawler,
// every crawler in one instanced draw, skinned by its bones (src/world/hollow/crawler-rig.js) and its
// surfaces drawn by src/shaders/lib-crawler.wgsl, then their sparks, sand and motes of light as soft
// discs facing the eye. Lit like the stage (and the motes' pass): by the sun and sky, or in the Hollow
// by the lantern alone, with a wet sheen from the light. Used by the move arena and tools/hollow-foes.html.

import { loadShader } from '../../src/core/gpu.js';
import { CRAWLER_FLOATS, CRAWLER_BONES } from '../../src/world/hollow/crawler-motion.js';
import { DUST_FLOATS } from '../../src/world/hollow/crawler-dust.js';
import { VERTEX_BYTES } from '../../src/world/creatures/bodies.js';
import { fxLightsOf } from './fx-lights.js';

const SHADER = /* wgsl */ `
struct Frame { viewProj: mat4x4f, eye: vec4f, sun: vec4f, misc: vec4f, lamp: vec4f, dark: vec4f };
@group(0) @binding(0) var<uniform> f: Frame;
@group(0) @binding(1) var<uniform> look: CrawlerLook;
@group(0) @binding(2) var<storage, read> crawlers: array<Crawler>;
@group(0) @binding(3) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(4) var<storage, read> dust: array<vec4f>;
@group(0) @binding(5) var<uniform> fxl: FxLights;

fn finish(c: vec3f) -> vec4f { let t = c / (1.0 + c); return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0); }

/** The light on a point (diffuse) and its direction (for the sheen). */
fn lightAt(world: vec3f, n: vec3f) -> vec4f {
  if (f.dark.x > 0.5) {
    let d = f.lamp.xyz - world;
    let dist = length(d);
    let fall = 1.0 - smoothstep(0.0, max(f.lamp.w, 1e-3), dist);
    let nl = 0.35 + 0.65 * max(dot(n, d / max(dist, 1e-3)), 0.0);
    return vec4f(vec3f(1.0, 0.8, 0.56) * (f.dark.z * fall * fall * nl) * 1.6 + vec3f(f.dark.y) + fxLight(world, n) * 1.6, f.dark.z * fall * fall * 1.6);
  }
  let day = 1.0 - f.misc.y;
  return vec4f(vec3f(max(dot(n, normalize(f.sun.xyz)), 0.0) * 2.8 * day + (0.55 + 0.35 * n.y) * mix(0.06, 1.0, day)), 2.8 * day);
}

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) world: vec3f, @location(2) rest: vec3f,
                 @location(3) zones: vec3f, @location(4) @interpolate(flat) inst: u32, @location(5) shell: vec2f };

@vertex fn vsCrawler(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) zones: vec3f,
                     @location(3) j: vec4u, @location(4) w: vec4f, @location(5) shell: vec2f, @builtin(instance_index) inst: u32) -> BodyOut {
  let c = crawlers[inst];
  let b = u32(c.look.z);
  let m = bones[b + j.x] * w.x + bones[b + j.y] * w.y + bones[b + j.z] * w.z + bones[b + j.w] * w.w;
  let v = crawlerPlace(p, n, m, c);
  var o: BodyOut;
  o.pos = f.viewProj * vec4f(v.world, 1.0);
  o.n = v.n; o.world = v.world; o.rest = p; o.zones = zones; o.inst = inst; o.shell = shell;
  return o;
}

@fragment fn fsCrawler(i: BodyOut) -> @location(0) vec4f {
  let c = crawlers[i.inst];
  let s = crawlerSurface(i.rest, i.zones, i.shell, look);
  let n = normalize(i.n);
  let v = normalize(f.eye.xyz - i.world);
  let lit = lightAt(i.world, n);
  // Wet silt: a soft sheen toward the light.
  let toL = select(normalize(f.sun.xyz), normalize(f.lamp.xyz - i.world), f.dark.x > 0.5);
  let hv = normalize(toL + v);
  let shine = pow(max(dot(n, hv), 0.0), mix(8.0, 90.0, 1.0 - s.rough)) * s.sheen * lit.w * 0.25;
  var col = s.albedo * lit.rgb + vec3f(shine);
  let glow = select(f.misc.y, 1.0, f.dark.x > 0.5);
  col += s.glow * 0.12 * glow * c.look.w;
  // A landed hit: a pale flash.
  col = mix(col, vec3f(1.4, 1.3, 1.15) * max(lit.rgb, vec3f(0.4)), c.look.x * look.grain.w);
  return finish(col * 1.15);
}

struct DustOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) world: vec3f, @location(2) col: vec4f, @location(3) glow: f32 };

@vertex fn vsDust(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> DustOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let a = dust[inst * 3u]; let b = dust[inst * 3u + 1u]; let k = dust[inst * 3u + 2u];
  let toEye = normalize(f.eye.xyz - a.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let world = a.xyz + (right * q.x + up * q.y) * a.w * 0.5;
  var o: DustOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  o.q = q; o.world = world; o.col = b; o.glow = k.x;
  return o;
}

@fragment fn fsDust(i: DustOut) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  if (r2 > 1.0) { discard; }
  let soft = select((1.0 - r2) * (1.0 - r2), 1.0 - smoothstep(0.6, 1.0, r2), i.glow < 0.5);
  let c = select(i.col.rgb, i.col.rgb * lightAt(i.world, vec3f(0.0, 1.0, 0.0)).rgb, i.glow < 0.5);
  return vec4f(finish(c).rgb, i.col.a * soft);
}
`;

/** How many crawlers and bits one draw holds. */
const MAX_CRAWLERS = 24, MAX_DUST = 2048;

/**
 * @param {{ device: GPUDevice, format: GPUTextureFormat, fxLights?: GPUBuffer }} gpu the stage's (fxLights: the move effects' lights)
 * @param {import('../../src/world/hollow/crawler-model.js').CrawlerModel} model @param {any} C recipes/world/hollow.json foes.lunger.crawler (read live)
 */
export async function createCrawlerPass(gpu, model, C) {
  const { device, format } = gpu;
  const module = device.createShaderModule({ label: 'crawlers', code: (await loadShader('lib-crawler')) + (await loadShader('lib-fx-light')) + SHADER });
  module.getCompilationInfo().then((info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[crawler wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: {} },
    { binding: 1, visibility: V | F, buffer: {} },
    { binding: 2, visibility: V | F, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 5, visibility: F, buffer: {} },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const body = device.createRenderPipeline({
    label: 'crawlers-body', layout: pl,
    vertex: { module, entryPoint: 'vsCrawler', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x2' }] }] },
    fragment: { module, entryPoint: 'fsCrawler', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil,
  });
  const blend = /** @type {GPUBlendState} */ ({ color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } });
  const bits = device.createRenderPipeline({
    label: 'crawlers-dust', layout: pl,
    vertex: { module, entryPoint: 'vsDust' },
    fragment: { module, entryPoint: 'fsDust', targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const vb = buf(model.data.byteLength, GPUBufferUsage.VERTEX), ib = buf(model.indices.byteLength, GPUBufferUsage.INDEX);
  const sb = buf(model.surface.byteLength, GPUBufferUsage.VERTEX);
  device.queue.writeBuffer(vb, 0, model.data);
  device.queue.writeBuffer(sb, 0, model.surface);
  device.queue.writeBuffer(ib, 0, model.indices);
  const frameBuf = buf(144, GPUBufferUsage.UNIFORM), lookBuf = buf(96, GPUBufferUsage.UNIFORM);
  const instBuf = buf(MAX_CRAWLERS * CRAWLER_FLOATS * 4, GPUBufferUsage.STORAGE), boneBuf = buf(MAX_CRAWLERS * CRAWLER_BONES * 64, GPUBufferUsage.STORAGE);
  const dustBuf = buf(MAX_DUST * DUST_FLOATS * 4, GPUBufferUsage.STORAGE);
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: lookBuf } },
    { binding: 2, resource: { buffer: instBuf } }, { binding: 3, resource: { buffer: boneBuf } }, { binding: 4, resource: { buffer: dustBuf } },
    { binding: 5, resource: { buffer: fxLightsOf(gpu) } }] });
  const frame = new Float32Array(36), lookF = new Float32Array(24);
  const inst = new Float32Array(MAX_CRAWLERS * CRAWLER_FLOATS), boneF = new Float32Array(MAX_CRAWLERS * CRAWLER_BONES * 16);
  let count = 0, dustCount = 0;

  return {
    /** Triangles a crawler. */
    triangles: model.triangles,
    /** How many crawlers and bits were drawn last. */
    get counts() { return { crawlers: count, dust: dustCount }; },
    /** This frame's crawlers (their motions, crawler-motion.js). @param {ReturnType<typeof import('../../src/world/hollow/crawler-motion.js').createCrawlerMotion>[]} motions */
    set(motions) {
      count = 0;
      for (const m of motions) {
        if (count >= MAX_CRAWLERS) break;
        if (m.gone) continue;
        m.instance(inst, count * CRAWLER_FLOATS, count * CRAWLER_BONES);
        boneF.set(m.bones, count * CRAWLER_BONES * 16);
        count++;
      }
      if (count) { device.queue.writeBuffer(instBuf, 0, inst, 0, count * CRAWLER_FLOATS); device.queue.writeBuffer(boneBuf, 0, boneF, 0, count * CRAWLER_BONES * 16); }
      const parts = motions.map((m) => m.dust.out(C));
      const total = Math.min(MAX_DUST, parts.reduce((n, a) => n + a.length / DUST_FLOATS, 0));
      dustCount = total;
      if (total) {
        const d = new Float32Array(total * DUST_FLOATS);
        let k = 0;
        for (const a of parts) { const n = Math.min(a.length, d.length - k); d.set(a.subarray(0, n), k); k += n; }
        device.queue.writeBuffer(dustBuf, 0, d);
      }
      const L = C.look;
      lookF.set([...L.silt, L.grainShare, L.grainM, L.wetRoughness, L.wetSheen, L.flash, ...L.shell, 0, L.shadeJitter, L.seamShare, 0, 0, ...L.belly, 0, ...L.knob, L.glowNits]);
      device.queue.writeBuffer(lookBuf, 0, lookF);
    },
    /**
     * Draw into the stage's pass. @param {GPURenderPassEncoder} pass
     * @param {Float32Array} u the stage's uniforms (viewProj 0, eye 16, sun 20, misc 28, lamp 36, dark 40)
     */
    draw(pass, u) {
      if (!count && !dustCount) return;
      frame.set(u.subarray(0, 24), 0);
      frame.set(u.subarray(28, 32), 24);
      frame.set(u.subarray(36, 44), 28);
      device.queue.writeBuffer(frameBuf, 0, frame);
      pass.setBindGroup(0, group);
      if (count) {
        pass.setPipeline(body);
        pass.setVertexBuffer(0, vb);
        pass.setVertexBuffer(1, sb);
        pass.setIndexBuffer(ib, 'uint32');
        pass.drawIndexed(model.indices.length, count);
      }
      if (dustCount) { pass.setPipeline(bits); pass.draw(6, dustCount); }
    },
  };
}
