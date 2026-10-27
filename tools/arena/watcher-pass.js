// @ts-check
// The hagstone watchers drawn on the workbench stage (H2; tools/walker-figure-stage.js): the stone from
// the orchestrator's generator with its baked albedo and fine normals, and its wrack weed, every watcher
// in one instanced draw, skinned by its bones (src/world/hollow/watcher-motion.js); the hole's light
// (src/shaders/lib-watcher.wgsl) on its walls and its rim; under each one a soft pool of its light on the
// floor and the call's ring running out over it (added light, no depth written); then its grit and
// motes of light when it breaks, as soft discs facing the eye. Lit like the stage (and the crawlers'
// pass): by the sun and sky, or in the Hollow by the lantern alone. Used by the move arena and
// tools/hollow-foes.html.

import { loadShader } from '../../src/core/gpu.js';
import { WATCHER_FLOATS, WATCHER_BONES } from '../../src/world/hollow/watcher-motion.js';
import { DUST_FLOATS } from '../../src/world/hollow/crawler-dust.js';
import { VERTEX_BYTES } from '../../src/world/creatures/bodies.js';
import { mapTexture } from '../../src/render/passes/props.js';

const SHADER = /* wgsl */ `
struct Frame { viewProj: mat4x4f, eye: vec4f, sun: vec4f, misc: vec4f, lamp: vec4f, dark: vec4f };
@group(0) @binding(0) var<uniform> f: Frame;
@group(0) @binding(1) var<uniform> look: WatcherLook;
@group(0) @binding(2) var<storage, read> watchers: array<Watcher>;
@group(0) @binding(3) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(4) var<storage, read> dust: array<vec4f>;
@group(0) @binding(5) var albedoMap: texture_2d<f32>;
@group(0) @binding(6) var normalMap: texture_2d<f32>;
@group(0) @binding(7) var samp: sampler;

fn finish(c: vec3f) -> vec4f { let t = c / (1.0 + c); return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0); }

/** The light on a point (diffuse) and how strong the main light is there (for the sheen). */
fn lightAt(world: vec3f, n: vec3f) -> vec4f {
  if (f.dark.x > 0.5) {
    let d = f.lamp.xyz - world;
    let dist = length(d);
    let fall = 1.0 - smoothstep(0.0, max(f.lamp.w, 1e-3), dist);
    let nl = 0.35 + 0.65 * max(dot(n, d / max(dist, 1e-3)), 0.0);
    return vec4f(vec3f(1.0, 0.8, 0.56) * (f.dark.z * fall * fall * nl) * 1.6 + vec3f(f.dark.y), f.dark.z * fall * fall * 1.6);
  }
  let day = 1.0 - f.misc.y;
  return vec4f(vec3f(max(dot(n, normalize(f.sun.xyz)), 0.0) * 2.8 * day + (0.55 + 0.35 * n.y) * mix(0.06, 1.0, day)), 2.8 * day);
}
/** How much an own light shows against this stage's light (full in the dark). */
fn ownLight() -> f32 { return select(mix(0.35, 1.0, f.misc.y), 1.0, f.dark.x > 0.5); }

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) world: vec3f, @location(2) rest: vec3f,
                 @location(3) slot: vec3f, @location(4) @interpolate(flat) inst: u32,
                 @location(5) m0: vec3f, @location(6) m1: vec3f, @location(7) m2: vec3f };

@vertex fn vsWatcher(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) slot: vec3f,
                     @location(3) j: vec4u, @location(4) w: vec4f, @builtin(instance_index) inst: u32) -> BodyOut {
  let c = watchers[inst];
  let b = u32(c.look.z);
  let m = bones[b + j.x] * w.x + bones[b + j.y] * w.y + bones[b + j.z] * w.z + bones[b + j.w] * w.w;
  let v = watcherPlace(p, n, m, c);
  var o: BodyOut;
  o.pos = f.viewProj * vec4f(v.world, 1.0);
  o.n = v.n; o.world = v.world; o.rest = p; o.slot = slot; o.inst = inst;
  // The skin's turn, carried into the world, for the stone's object-space normals.
  o.m0 = watcherTurn(m[0].xyz, c.at.w); o.m1 = watcherTurn(m[1].xyz, c.at.w); o.m2 = watcherTurn(m[2].xyz, c.at.w);
  return o;
}

@fragment fn fsWatcher(i: BodyOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let c = watchers[i.inst];
  let stone = i.slot.z > 1.5;
  // Sampled everywhere (uniform control flow), used on the stone only.
  let mapA = textureSample(albedoMap, samp, i.slot.xy).rgb;
  let mapN = normalize(textureSample(normalMap, samp, i.slot.xy).xyz * 2.0 - 1.0);
  let albedo = select(i.slot, mapA, stone);
  let nRest = select(normalize(i.n), mapN, stone);
  let n = select(normalize(i.n), normalize(i.m0 * mapN.x + i.m1 * mapN.y + i.m2 * mapN.z), stone);
  let v = normalize(f.eye.xyz - i.world);
  let lit = lightAt(i.world, n);
  let toL = select(normalize(f.sun.xyz), normalize(f.lamp.xyz - i.world), f.dark.x > 0.5);
  let hv = normalize(toL + v);
  let rough = select(0.45, look.misc.y, stone);
  let shine = pow(max(dot(n, hv), 0.0), mix(8.0, 80.0, 1.0 - rough)) * look.misc.z * lit.w * 0.25;
  var col = albedo * lit.rgb + vec3f(shine);
  // The hole's light: on the stone along its walls and rim; the weed near it catches a little.
  let hole = watcherHoleLight(i.rest, select(nRest, vec3f(0.0, 0.0, 0.0), !stone), look, c.look.y, c.look.w);
  col += albedo * hole * ownLight() + select(vec3f(0.0), albedo * watcherGlowColor(look, c.look.w) * c.look.y * 0.05, !stone);
  // A landed hit: a pale flash.
  col = mix(col, vec3f(1.4, 1.3, 1.15) * max(lit.rgb, vec3f(0.4)), c.look.x * look.misc.w);
  return finish(col * 1.15);
}

struct FloorOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) inst: u32, @location(2) @interpolate(flat) span: f32 };

@vertex fn vsFloor(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> FloorOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let c = watchers[inst];
  let span = max(look.floor.x * 2.2, c.floor.x + look.floor.y * 3.0);
  var o: FloorOut;
  o.pos = f.viewProj * vec4f(c.at.x + q.x * span, c.floor.w + 0.015, c.at.z + q.y * span, 1.0);
  o.q = q * span; o.inst = inst; o.span = span;
  return o;
}

@fragment fn fsFloor(i: FloorOut) -> @location(0) vec4f {
  let c = watchers[i.inst];
  let r = length(i.q);
  let pool = c.floor.z * exp(-(r / look.floor.x) * (r / look.floor.x)) * 0.35;
  let ring = c.floor.y * exp(-((r - c.floor.x) / look.floor.y) * ((r - c.floor.x) / look.floor.y));
  let edge = 1.0 - smoothstep(i.span * 0.85, i.span, r);
  let light = watcherGlowColor(look, c.look.w) * (pool + ring) * edge * ownLight();
  // Added to what the floor already shows: a soft light, tone-mapped on its own.
  return vec4f(light / (1.0 + light) * 0.6, 0.0);
}

struct HaloOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) inst: u32 };

/** The light filling the hole: a soft disc at its middle, facing the eye, hidden by the stone round it. */
@vertex fn vsHalo(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> HaloOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let c = watchers[inst];
  let toEye = normalize(f.eye.xyz - c.hole.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let world = c.hole.xyz + (right * q.x + up * q.y) * c.hole.w * look.floor.z;
  var o: HaloOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  o.q = q; o.inst = inst;
  return o;
}

@fragment fn fsHalo(i: HaloOut) -> @location(0) vec4f {
  let c = watchers[i.inst];
  let r2 = dot(i.q, i.q);
  if (r2 > 1.0) { discard; }
  // Brightest at the middle, falling off well before the disc's edge, so it reads as light, not a plate.
  let core = exp(-r2 * 5.0) * (1.0 - r2);
  // Against daylight an added light washes to a white plate, so it shows far less there.
  let light = watcherGlowColor(look, c.look.w) * c.look.y * look.floor.w * core * select(0.12, 1.0, f.dark.x > 0.5);
  return vec4f(light / (1.0 + light), 0.0);
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

/** How many watchers and bits one draw holds. */
const MAX_WATCHERS = 12, MAX_DUST = 1024;

/**
 * @param {{ device: GPUDevice, format: GPUTextureFormat }} gpu the stage's
 * @param {import('../../src/world/hollow/watcher-model.js').WatcherModel} model @param {any} S recipes/world/hollow.json foes.watcher.stone (read live)
 */
export async function createWatcherPass(gpu, model, S) {
  const { device, format } = gpu;
  const module = device.createShaderModule({ label: 'watchers', code: (await loadShader('lib-watcher')) + SHADER });
  module.getCompilationInfo().then((info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[watcher wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: {} },
    { binding: 1, visibility: V | F, buffer: {} },
    { binding: 2, visibility: V | F, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 5, visibility: F, texture: {} },
    { binding: 6, visibility: F, texture: {} },
    { binding: 7, visibility: F, sampler: {} },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const body = device.createRenderPipeline({
    label: 'watchers-body', layout: pl,
    vertex: { module, entryPoint: 'vsWatcher', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' }] }] },
    fragment: { module, entryPoint: 'fsWatcher', targets: [{ format }] },
    // The weed's two faces are their own triangles, so back faces are culled everywhere.
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil,
  });
  const add = /** @type {GPUBlendState} */ ({ color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } });
  const floor = device.createRenderPipeline({
    label: 'watchers-floor', layout: pl,
    vertex: { module, entryPoint: 'vsFloor' },
    fragment: { module, entryPoint: 'fsFloor', targets: [{ format, blend: add }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const halo = device.createRenderPipeline({
    label: 'watchers-halo', layout: pl,
    vertex: { module, entryPoint: 'vsHalo' },
    fragment: { module, entryPoint: 'fsHalo', targets: [{ format, blend: add }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const blend = /** @type {GPUBlendState} */ ({ color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } });
  const bits = device.createRenderPipeline({
    label: 'watchers-dust', layout: pl,
    vertex: { module, entryPoint: 'vsDust' },
    fragment: { module, entryPoint: 'fsDust', targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const vb = buf(model.data.byteLength, GPUBufferUsage.VERTEX), ib = buf(model.indices.byteLength, GPUBufferUsage.INDEX);
  device.queue.writeBuffer(vb, 0, model.data);
  device.queue.writeBuffer(ib, 0, model.indices);
  const albedo = await mapTexture(device, model.albedo, 'rgba8unorm-srgb', [150, 145, 135, 255], 'watcher albedo');
  const normal = await mapTexture(device, model.normal, 'rgba8unorm', [128, 128, 255, 255], 'watcher normals');
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 4 });
  const frameBuf = buf(144, GPUBufferUsage.UNIFORM), lookBuf = buf(80, GPUBufferUsage.UNIFORM);
  const instBuf = buf(MAX_WATCHERS * WATCHER_FLOATS * 4, GPUBufferUsage.STORAGE), boneBuf = buf(MAX_WATCHERS * WATCHER_BONES * 64, GPUBufferUsage.STORAGE);
  const dustBuf = buf(MAX_DUST * DUST_FLOATS * 4, GPUBufferUsage.STORAGE);
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: lookBuf } },
    { binding: 2, resource: { buffer: instBuf } }, { binding: 3, resource: { buffer: boneBuf } }, { binding: 4, resource: { buffer: dustBuf } },
    { binding: 5, resource: albedo.createView() }, { binding: 6, resource: normal.createView() }, { binding: 7, resource: samp }] });
  const frame = new Float32Array(36), lookF = new Float32Array(20);
  const inst = new Float32Array(MAX_WATCHERS * WATCHER_FLOATS), boneF = new Float32Array(MAX_WATCHERS * WATCHER_BONES * 16);
  /** The breakup's bits drawn as the crawler's are: grey grit and motes in the hole's light. */
  const dustLook = { look: { spark: [1.4, 1.2, 0.8], knob: S.look.glow, silt: S.prep.albedo.band.map((/** @type {number} */ v) => v * 0.45) }, motion: S.motion };
  let count = 0, dustCount = 0;

  return {
    /** Triangles a watcher. */
    triangles: model.triangles,
    /** How many watchers and bits were drawn last. */
    get counts() { return { watchers: count, dust: dustCount }; },
    /** This frame's watchers (their motions, watcher-motion.js). @param {ReturnType<typeof import('../../src/world/hollow/watcher-motion.js').createWatcherMotion>[]} motions */
    set(motions) {
      count = 0;
      for (const m of motions) {
        if (count >= MAX_WATCHERS) break;
        if (m.gone) continue;
        m.instance(inst, count * WATCHER_FLOATS, count * WATCHER_BONES);
        boneF.set(m.bones, count * WATCHER_BONES * 16);
        count++;
      }
      if (count) { device.queue.writeBuffer(instBuf, 0, inst, 0, count * WATCHER_FLOATS); device.queue.writeBuffer(boneBuf, 0, boneF, 0, count * WATCHER_BONES * 16); }
      dustLook.look.knob = S.look.glow;
      const parts = motions.map((m) => m.dust.out(dustLook));
      const total = Math.min(MAX_DUST, parts.reduce((n, a) => n + a.length / DUST_FLOATS, 0));
      dustCount = total;
      if (total) {
        const d = new Float32Array(total * DUST_FLOATS);
        let k = 0;
        for (const a of parts) { const n = Math.min(a.length, d.length - k); d.set(a.subarray(0, n), k); k += n; }
        device.queue.writeBuffer(dustBuf, 0, d);
      }
      const L = S.look, H = model.hole;
      lookF.set([...L.glow, L.wallM, ...L.cool, L.rimLight, H.x, H.y, H.rM, H.flareShare, H.halfDepthM, L.roughness, L.sheen, L.flash, L.floorM, S.motion.call.ringWidthM, L.haloShare, L.haloGain]);
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
        pass.setIndexBuffer(ib, 'uint32');
        pass.drawIndexed(model.indices.length, count);
        pass.setPipeline(floor);
        pass.draw(6, count);
        pass.setPipeline(halo);
        pass.draw(6, count);
      }
      if (dustCount) { pass.setPipeline(bits); pass.draw(6, dustCount); }
    },
  };
}
