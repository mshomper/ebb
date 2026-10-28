// @ts-check
// The soot motes drawn on the workbench stage (H2; tools/walker-figure-stage.js): Matt's mote, every
// mote of every swarm in one instanced draw, moved and given its eyes by src/shaders/lib-mote.wgsl,
// then the smoky trail's puffs as soft dark discs facing the eye. Lit like the stage: by the sun and
// sky, or in the Hollow by the lantern alone. Used by the move arena and tools/hollow-foes.html.

import { loadShader } from '../../src/core/gpu.js';
import { MOTE_FLOATS, PUFF_FLOATS } from '../../src/world/hollow/mote-swarm.js';
import { fxLightsOf } from './fx-lights.js';

const SHADER = /* wgsl */ `
struct Frame { viewProj: mat4x4f, eye: vec4f, sun: vec4f, misc: vec4f, lamp: vec4f, dark: vec4f };
// As the stage's: misc y night; lamp the lantern's x, y, z and reach; dark x 1 in the Hollow, y its own light, z the lantern's strength.
@group(0) @binding(0) var<uniform> f: Frame;
@group(0) @binding(1) var<uniform> look: MoteLook;
@group(0) @binding(2) var<storage, read> motes: array<Mote>;
@group(0) @binding(3) var<storage, read> puffs: array<vec4f>;
@group(0) @binding(4) var<uniform> fxl: FxLights;

fn finish(c: vec3f) -> vec4f { let t = c / (1.0 + c); return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0); }

fn lampLight(world: vec3f, n: vec3f) -> vec3f {
  let d = f.lamp.xyz - world;
  let dist = length(d);
  let fall = 1.0 - smoothstep(0.0, max(f.lamp.w, 1e-3), dist);
  let nl = 0.35 + 0.65 * max(dot(n, d / max(dist, 1e-3)), 0.0);
  return vec3f(1.0, 0.8, 0.56) * (f.dark.z * fall * fall * nl) + vec3f(f.dark.y) + fxLight(world, n);
}
fn light(world: vec3f, n: vec3f) -> vec3f {
  if (f.dark.x > 0.5) { return lampLight(world, n) * 1.6; }
  let day = 1.0 - f.misc.y;
  return vec3f(max(dot(n, normalize(f.sun.xyz)), 0.0) * 2.8 * day + (0.55 + 0.35 * n.y) * mix(0.06, 1.0, day));
}

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) world: vec3f, @location(2) rest: vec3f,
                 @location(3) @interpolate(flat) inst: u32 };

@vertex fn vsMote(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) inst: u32) -> BodyOut {
  let v = moteDeform(p, n, motes[inst], look);
  var o: BodyOut;
  o.pos = f.viewProj * vec4f(v.world, 1.0);
  o.n = v.n; o.world = v.world; o.rest = p; o.inst = inst;
  return o;
}

@fragment fn fsMote(i: BodyOut) -> @location(0) vec4f {
  let m = motes[i.inst];
  let eye = moteEyes(i.rest, m, look);
  let n = normalize(i.n);
  let toEye = normalize(f.eye.xyz - i.world);
  let lit = light(i.world, n);
  // Soot: dark, with a soft fuzz at grazing angles so its edge reads against the dark.
  let rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
  var c = look.albedo.rgb * lit + vec3f(0.18) * look.albedo.w * rim * lit;
  // Its pale eyes, and their faint light in the dark.
  let glow = select(f.misc.y, 1.0, f.dark.x > 0.5) * m.eye.w;
  let eyeC = look.eyeTint.rgb * lit + look.eyeTint.rgb * look.eyeTint.w * 0.12 * glow;
  c = mix(c, eyeC, eye);
  return finish(c * 1.15);
}

struct PuffOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) world: vec3f, @location(2) alpha: f32 };

@vertex fn vsPuff(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> PuffOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let a = puffs[inst * 2u]; let b = puffs[inst * 2u + 1u];
  let toEye = normalize(f.eye.xyz - a.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let world = a.xyz + (right * q.x + up * q.y) * a.w * 0.5;
  var o: PuffOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  o.q = q; o.world = world; o.alpha = b.x;
  return o;
}

@fragment fn fsPuff(i: PuffOut) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  if (r2 > 1.0) { discard; }
  let soft = (1.0 - r2) * (1.0 - r2);
  return vec4f(finish(look.albedo.rgb * light(i.world, vec3f(0.0, 1.0, 0.0))).rgb, i.alpha * soft);
}
`;

/** How many motes and puffs one draw holds. */
const MAX_MOTES = 64, MAX_PUFFS = 512;

/**
 * @param {{ device: GPUDevice, format: GPUTextureFormat, fxLights?: GPUBuffer }} gpu the stage's (fxLights: the move effects' lights)
 * @param {import('../../src/world/hollow/mote-model.js').MoteModel} model @param {any} M recipes/world/hollow.json foes.motes.mote (read live)
 */
export async function createMotePass(gpu, model, M) {
  const { device, format } = gpu;
  const module = device.createShaderModule({ label: 'motes', code: (await loadShader('lib-mote')) + (await loadShader('lib-fx-light')) + SHADER });
  module.getCompilationInfo().then((info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[mote wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: {} },
    { binding: 1, visibility: V | F, buffer: {} },
    { binding: 2, visibility: V | F, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: F, buffer: {} },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const body = device.createRenderPipeline({
    label: 'motes-body', layout: pl,
    vertex: { module, entryPoint: 'vsMote', buffers: [{ arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] },
    fragment: { module, entryPoint: 'fsMote', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil,
  });
  const blend = /** @type {GPUBlendState} */ ({ color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } });
  const trail = device.createRenderPipeline({
    label: 'motes-trail', layout: pl,
    vertex: { module, entryPoint: 'vsPuff' },
    fragment: { module, entryPoint: 'fsPuff', targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const vb = buf(model.data.byteLength, GPUBufferUsage.VERTEX), ib = buf(model.indices.byteLength, GPUBufferUsage.INDEX);
  device.queue.writeBuffer(vb, 0, model.data);
  device.queue.writeBuffer(ib, 0, model.indices);
  const frameBuf = buf(144, GPUBufferUsage.UNIFORM), lookBuf = buf(128, GPUBufferUsage.UNIFORM);
  const moteBuf = buf(MAX_MOTES * MOTE_FLOATS * 4, GPUBufferUsage.STORAGE), puffBuf = buf(MAX_PUFFS * PUFF_FLOATS * 4, GPUBufferUsage.STORAGE);
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: lookBuf } },
    { binding: 2, resource: { buffer: moteBuf } }, { binding: 3, resource: { buffer: puffBuf } },
    { binding: 4, resource: { buffer: fxLightsOf(gpu) } }] });
  const frame = new Float32Array(36), lookF = new Float32Array(32);
  const [eL, eR] = model.eyes;
  let motes = 0, puffCount = 0;

  return {
    /** Triangles a mote. */
    triangles: model.triangles,
    /**
     * This frame's motes and puffs. @param {{ instances: (clock: number) => Float32Array, puffs: () => Float32Array }[]} swarms
     * @param {number} clock seconds (the shader's drift)
     */
    set(swarms, clock) {
      const all = swarms.map((s) => s.instances(clock)), ps = swarms.map((s) => s.puffs());
      motes = Math.min(MAX_MOTES, all.reduce((n, a) => n + a.length / MOTE_FLOATS, 0));
      puffCount = Math.min(MAX_PUFFS, ps.reduce((n, a) => n + a.length / PUFF_FLOATS, 0));
      const m = new Float32Array(Math.max(1, motes) * MOTE_FLOATS), p = new Float32Array(Math.max(1, puffCount) * PUFF_FLOATS);
      let k = 0;
      for (const a of all) { if (k + a.length > m.length) break; m.set(a, k); k += a.length; }
      k = 0;
      for (const a of ps) { const n = Math.min(a.length, p.length - k); p.set(a.subarray(0, n), k); k += n; }
      device.queue.writeBuffer(moteBuf, 0, m);
      device.queue.writeBuffer(puffBuf, 0, p);
      const D = M.drift, E = M.eyes;
      lookF.set([D.bobM, D.bobHz, D.turnDeg * Math.PI / 180, D.turnHz, D.breath, D.breathHz, M.tell.quiverHz, clock,
        ...M.albedo, M.fuzz, ...E.albedo, E.glowNits,
        ...eL.centre, eL.radiusM, ...eL.axis, E.widen, ...eR.centre, eR.radiusM, ...eR.axis, E.squint]);
      device.queue.writeBuffer(lookBuf, 0, lookF);
    },
    /**
     * Draw into the stage's pass (its draw calls this with its frame's numbers). @param {GPURenderPassEncoder} pass
     * @param {Float32Array} u the stage's uniforms (viewProj 0, eye 16, sun 20, misc 28, lamp 36, dark 40)
     */
    draw(pass, u) {
      if (!motes) return;
      frame.set(u.subarray(0, 24), 0);
      frame.set(u.subarray(28, 32), 24);
      frame.set(u.subarray(36, 44), 28);
      device.queue.writeBuffer(frameBuf, 0, frame);
      pass.setBindGroup(0, group);
      pass.setPipeline(body);
      pass.setVertexBuffer(0, vb);
      pass.setIndexBuffer(ib, 'uint32');
      pass.drawIndexed(model.indices.length, motes);
      if (puffCount) { pass.setPipeline(trail); pass.draw(6, puffCount); }
    },
  };
}
