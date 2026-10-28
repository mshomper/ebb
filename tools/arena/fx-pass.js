// @ts-check
// The Q and E move effects drawn on the workbench stage (tools/walker-figure-stage.js), from the flat
// arrays the effect engine fills each frame (src/world/hollow/fx-layout.js): moths, made in code
// (tools/arena/moth-mesh.js) and flapping in the vertex shader, shaded pale and dusty and lit like the
// stage (the lantern plus the effects' own lights, src/shaders/lib-fx-light.wgsl), with a faint light
// of their own; then threads (glowing strands) and sparks (soft glowing discs facing the eye, streaked
// along their motion), added onto what is drawn. Used by the move arena and tools/fx-pass-check.html.

import { loadShader } from '../../src/core/gpu.js';
import { MAX_SPARKS, SPARK_FLOATS, MAX_THREADS, THREAD_FLOATS, MAX_MOTHS, MOTH_FLOATS } from '../../src/world/hollow/fx-layout.js';
import { buildMothMesh, MOTH_VERTEX_FLOATS, MOTH_HINGE_Y } from './moth-mesh.js';
import { fxLightsOf } from './fx-lights.js';

const SHADER = /* wgsl */ `
struct Frame { viewProj: mat4x4f, eye: vec4f, sun: vec4f, misc: vec4f, lamp: vec4f, dark: vec4f };
// As the stage's: misc y night; lamp the lantern's x, y, z and reach; dark x 1 in the Hollow, y its own light, z the lantern's strength.
@group(0) @binding(0) var<uniform> f: Frame;
@group(0) @binding(1) var<storage, read> sparks: array<vec4f>;
@group(0) @binding(2) var<storage, read> threads: array<vec4f>;
@group(0) @binding(3) var<storage, read> moths: array<vec4f>;
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
  return vec3f(max(dot(n, normalize(f.sun.xyz)), 0.0) * 2.8 * day + (0.55 + 0.35 * n.y) * mix(0.06, 1.0, day)) + fxLight(world, n) * 1.6;
}
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

fn corner(vi: u32) -> vec2f {
  return array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
}

// ---- moths ----
struct MothOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) world: vec3f, @location(2) aux: vec3f,
                 @location(3) @interpolate(flat) part: f32, @location(4) @interpolate(flat) glow: f32, @location(5) @interpolate(flat) seed: f32 };

/** Turn p.xy by a (about z). */
fn turnZ(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
/** Turn p.yz by a (about x; +a lifts +z). */
fn turnX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y + s * p.z, -s * p.y + c * p.z); }
/** Turn by yaw about y (+z goes to (sin, 0, cos)). */
fn turnY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

@vertex fn vsMoth(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) aux: vec3f, @location(3) part: f32,
                  @builtin(instance_index) inst: u32) -> MothOut {
  let a = moths[inst * 2u]; let b = moths[inst * 2u + 1u];
  var lp = p; var ln = n;
  if (part > 0.5 && part < 2.5) {
    // The wings beat about the body's long axis: a strong downstroke, the hindwings a little behind.
    let phase = b.x - select(0.0, 0.45, part > 1.5);
    let ang = (0.15 + 1.0 * (0.5 + 0.5 * sin(phase))) * sign(p.x);
    let h = vec3f(0.0, ${MOTH_HINGE_Y}, 0.0);
    lp = turnZ(lp - h, ang) + h;
    ln = turnZ(ln, ang);
  }
  // The body rides against the beat, nose a little up, leaning into its turns, then turned to its heading.
  let bob = vec3f(0.0, -0.05 * sin(b.x), 0.0);
  let o3 = turnY(turnZ(turnX(lp + bob, 0.22), b.w), a.w);
  let on = turnY(turnZ(turnX(ln, 0.22), b.w), a.w);
  let world = a.xyz + o3 * b.y;
  var o: MothOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  o.n = on; o.world = world; o.aux = aux; o.part = part; o.glow = b.z; o.seed = f32(inst);
  return o;
}

@fragment fn fsMoth(i: MothOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let jitter = hash21(vec2f(i.seed, 3.7));
  let toEye = normalize(f.eye.xyz - i.world);
  var n = normalize(i.n);
  var albedo = mix(vec3f(0.74, 0.7, 0.6), vec3f(0.7, 0.68, 0.64), jitter);
  var thin = 0.0;
  var emit = 0.5;
  if (i.part > 2.5) {
    // An antenna: a shaft with fine combs either side, thinning to its tip.
    let across = abs(i.aux.x); let along = i.aux.y;
    let comb = step(fract(along * 16.0), 0.5) * step(across, 1.0 - along * 0.7);
    if (across > 0.28 && comb < 0.5) { discard; }
    albedo = vec3f(0.55, 0.5, 0.43);
    n = select(-n, n, front);
  } else if (i.part > 0.5) {
    // A wing: pale dust, darker toward its edge, faint veins out from the root, a soft eyespot on the forewing.
    n = select(-n, n, front);
    thin = 1.0;
    let w = i.aux.xy;
    let edge = smoothstep(0.72, 0.95, i.aux.z);
    let ang = atan2(w.y, w.x);
    let vein = smoothstep(0.86, 1.0, abs(fract(ang * 4.5 + jitter) * 2.0 - 1.0)) * smoothstep(0.15, 0.5, i.aux.z) * (1.0 - edge);
    let speck = hash21(floor(w * 140.0) + i.seed);
    albedo = albedo * (0.92 + 0.12 * speck);
    albedo = mix(albedo, vec3f(0.46, 0.42, 0.36), edge * 0.6);
    albedo = mix(albedo, albedo * 0.78, vein * 0.5);
    if (i.part < 1.5) {
      let e = length((w - vec2f(0.3, -0.05)) / vec2f(0.05, 0.045));
      let ring = smoothstep(0.55, 0.8, e) * (1.0 - smoothstep(0.85, 1.1, e));
      albedo = mix(albedo, vec3f(0.36, 0.32, 0.28), ring * 0.55);
      albedo = mix(albedo, vec3f(0.86, 0.82, 0.72), (1.0 - smoothstep(0.0, 0.5, e)) * 0.4);
    } else {
      albedo = albedo * 1.04;
    }
    emit = 1.0 - 0.6 * i.aux.z;
  } else {
    albedo = vec3f(0.62, 0.57, 0.49) * (0.95 + 0.1 * jitter);
  }
  var lit = light(i.world, n);
  // Light from behind lifts a thin wing a little.
  lit += light(i.world, -n) * 0.3 * thin;
  // Fuzz: the body and wings catch a soft rim of light at grazing angles.
  let rim = pow(1.0 - abs(dot(n, toEye)), 3.0) * select(0.15, 0.5, i.part < 0.5);
  var c = albedo * lit * (1.0 + rim);
  c += vec3f(1.0, 0.93, 0.8) * (i.glow * 0.55 * emit);
  return finish(c * 1.15);
}

// ---- sparks: soft discs facing the eye, streaked along their motion, added on ----
struct SparkOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) h: f32, @location(2) col: vec3f };

@vertex fn vsSpark(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> SparkOut {
  let q = corner(vi);
  let a = sparks[inst * 3u]; let b = sparks[inst * 3u + 1u]; let c = sparks[inst * 3u + 2u];
  let toEye = normalize(f.eye.xyz - a.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  // The motion across the view; the streak trails behind the spark.
  let vp = c.xyz - toEye * dot(c.xyz, toEye);
  let len = length(vp) * max(c.w, 0.0);
  let streak = len > a.w * 0.05;
  let axis = select(right, vp / max(length(vp), 1e-6), streak);
  let side = select(up, normalize(cross(toEye, axis)), streak);
  let L = select(0.0, len, streak);
  let hl = a.w + L * 0.5;
  let world = a.xyz - axis * (L * 0.5) + axis * (q.x * hl) + side * (q.y * a.w);
  var o: SparkOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  // In units of the round size: along (out to hl / size), across, and the streak's half length.
  o.q = vec2f(q.x * hl, q.y * a.w) / max(a.w, 1e-6);
  o.h = L * 0.5 / max(a.w, 1e-6);
  // A long streak spreads the same light thinner.
  o.col = b.rgb * b.a * mix(1.0, a.w / hl, 0.5);
  return o;
}

@fragment fn fsSpark(i: SparkOut) -> @location(0) vec4f {
  let along = max(abs(i.q.x) - i.h, 0.0);
  let r2 = along * along + i.q.y * i.q.y;
  if (r2 > 1.0) { discard; }
  let soft = (1.0 - r2) * (1.0 - r2);
  // Brightest at its head, fading down the tail.
  let head = select(1.0, 0.35 + 0.65 * clamp((i.q.x / (i.h + 1.0)) * 0.5 + 0.5, 0.0, 1.0), i.h > 0.0);
  return vec4f(finish(i.col * head).rgb * soft * 0.9, 0.0);
}

// ---- threads: glowing ribbons from a to b, facing the eye, added on ----
struct ThreadOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) col: vec3f };

@vertex fn vsThread(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> ThreadOut {
  let q = corner(vi);
  let a = threads[inst * 3u]; let b = threads[inst * 3u + 1u]; let c = threads[inst * 3u + 2u];
  let t = q.x * 0.5 + 0.5;
  let along = b.xyz - a.xyz;
  let dir = along / max(length(along), 1e-6);
  let p = mix(a.xyz, b.xyz, t) + dir * (q.x * a.w * 0.5);
  let toEye = normalize(f.eye.xyz - p);
  let s0 = cross(dir, toEye);
  let side = select(normalize(cross(vec3f(0.0, 1.0, 0.0), toEye)), normalize(s0), length(s0) > 1e-4);
  let world = p + side * (q.y * a.w * 0.5);
  var o: ThreadOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  // x: 0 at the ends' soft caps, 1 along the strand; y across.
  let lenW = max(length(along) / max(a.w, 1e-6), 1e-3);
  o.q = vec2f((t * (lenW + 1.0) - 0.5) / lenW, q.y);
  o.col = c.rgb * b.w;
  return o;
}

@fragment fn fsThread(i: ThreadOut) -> @location(0) vec4f {
  let y2 = i.q.y * i.q.y;
  let soft = (1.0 - y2) * (1.0 - y2);
  let core = exp(-y2 * 14.0);
  let ends = smoothstep(-0.02, 0.06, i.q.x) * (1.0 - smoothstep(0.94, 1.02, i.q.x));
  return vec4f(finish(i.col * (1.0 + 1.2 * core)).rgb * soft * ends * 0.85, 0.0);
}
`;

/**
 * @typedef {{ sparks?: Float32Array, nSparks?: number, threads?: Float32Array, nThreads?: number,
 *   moths?: Float32Array, nMoths?: number }} FxFrame
 *   One frame of effects, in fx-layout.js's layouts; each count defaults to all its array holds.
 */

/**
 * @param {{ device: GPUDevice, format: GPUTextureFormat, fxLights?: GPUBuffer }} gpu the stage's
 *   (fxLights: the effects' lights, which also fall on the moths)
 */
export async function createFxPass(gpu) {
  const { device, format } = gpu;
  const module = device.createShaderModule({ label: 'fx', code: (await loadShader('lib-fx-light')) + SHADER });
  module.getCompilationInfo().then((info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[fx wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: {} },
    { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: V, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: F, buffer: {} },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const add = /** @type {GPUBlendState} */ ({ color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } });
  const mothPipe = device.createRenderPipeline({
    label: 'fx-moths', layout: pl,
    vertex: { module, entryPoint: 'vsMoth', buffers: [{ arrayStride: MOTH_VERTEX_FLOATS * 4, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'float32' }] }] },
    fragment: { module, entryPoint: 'fsMoth', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil,
  });
  /** @param {string} label @param {string} vs @param {string} fs */
  const additive = (label, vs, fs) => device.createRenderPipeline({
    label, layout: pl,
    vertex: { module, entryPoint: vs },
    fragment: { module, entryPoint: fs, targets: [{ format, blend: add }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const sparkPipe = additive('fx-sparks', 'vsSpark', 'fsSpark');
  const threadPipe = additive('fx-threads', 'vsThread', 'fsThread');

  const buf = (/** @type {number} */ size, /** @type {number} */ usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const mesh = buildMothMesh();
  const vb = buf(mesh.data.byteLength, GPUBufferUsage.VERTEX);
  device.queue.writeBuffer(vb, 0, mesh.data);
  const frameBuf = buf(144, GPUBufferUsage.UNIFORM);
  const sparkBuf = buf(MAX_SPARKS * SPARK_FLOATS * 4, GPUBufferUsage.STORAGE);
  const threadBuf = buf(MAX_THREADS * THREAD_FLOATS * 4, GPUBufferUsage.STORAGE);
  const mothBuf = buf(MAX_MOTHS * MOTH_FLOATS * 4, GPUBufferUsage.STORAGE);
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: sparkBuf } },
    { binding: 2, resource: { buffer: threadBuf } }, { binding: 3, resource: { buffer: mothBuf } },
    { binding: 4, resource: { buffer: fxLightsOf(gpu) } }] });
  const frame = new Float32Array(36);
  /** Write up to max items of `per` floats; how many went. @param {GPUBuffer} b @param {Float32Array | undefined} a @param {number | undefined} n @param {number} per @param {number} max */
  const put = (b, a, n, per, max) => {
    if (!a) return 0;
    const k = Math.max(0, Math.min(max, n ?? a.length / per, Math.floor(a.length / per)));
    if (k) device.queue.writeBuffer(b, 0, a, 0, k * per);
    return k;
  };

  return {
    /** Triangles a moth. */
    mothTriangles: mesh.vertices / 3,
    /**
     * Draw this frame's effects into the stage's pass (call it from the stage's draw extra).
     * @param {GPURenderPassEncoder} pass
     * @param {Float32Array} u the stage's uniforms (viewProj 0, eye 16, sun 20, misc 28, lamp 36, dark 40)
     * @param {FxFrame} fx
     */
    draw(pass, u, fx) {
      const nM = put(mothBuf, fx.moths, fx.nMoths, MOTH_FLOATS, MAX_MOTHS);
      const nT = put(threadBuf, fx.threads, fx.nThreads, THREAD_FLOATS, MAX_THREADS);
      const nS = put(sparkBuf, fx.sparks, fx.nSparks, SPARK_FLOATS, MAX_SPARKS);
      if (!nM && !nT && !nS) return;
      frame.set(u.subarray(0, 24), 0);
      frame.set(u.subarray(28, 32), 24);
      frame.set(u.subarray(36, 44), 28);
      device.queue.writeBuffer(frameBuf, 0, frame);
      pass.setBindGroup(0, group);
      if (nM) { pass.setPipeline(mothPipe); pass.setVertexBuffer(0, vb); pass.draw(mesh.vertices, nM); }
      if (nT) { pass.setPipeline(threadPipe); pass.draw(6, nT); }
      if (nS) { pass.setPipeline(sparkPipe); pass.draw(6, nS); }
    },
  };
}
