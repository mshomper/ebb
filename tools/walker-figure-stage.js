// @ts-check
// The walker figure page's stage (doc 23, W5): the figure on a test ground (flat, a slope, a shelf)
// with a water level, lit by a low sun and a soft sky, an orbit camera that follows it, and the
// same skinning and eyes as the game (the eyes come from src/shaders/lib-figure-eyes.wgsl). Like the
// creature studio, this is a workbench: its own simple light, no palette. A weights view colours
// each vertex by the bones it follows.

import { mat4 } from 'wgpu-matrix';
import { initGpu, loadShader } from '../src/core/gpu.js';
import { VERTEX_BYTES } from '../src/world/creatures/bodies.js';

const SHADER = /* wgsl */ `
struct U { viewProj: mat4x4f, eye: vec4f, sun: vec4f, place: vec4f, misc: vec4f, water: vec4f };
// place: x, y, z, yaw; misc: x weights view, y night, z bone count; water: x level (m, -9 none)
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(2) var<uniform> eyes: FigureEyes;

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) albedo: vec3f, @location(2) world: vec3f,
                 @location(3) rest: vec3f, @location(4) head: f32 };

fn hue(i: u32) -> vec3f {
  let h = fract(f32(i) * 0.618034);
  return clamp(abs(fract(h + vec3f(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0)) * 0.8 + 0.1;
}

@vertex fn vsBody(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec3f,
                  @location(3) j: vec4u, @location(4) w: vec4f) -> BodyOut {
  let m = bones[j.x] * w.x + bones[j.y] * w.y + bones[j.z] * w.z + bones[j.w] * w.w;
  let posed = (m * vec4f(p, 1.0)).xyz;
  let pn = normalize((m * vec4f(n, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  let c = cos(u.place.w); let s = sin(u.place.w);
  let world = vec3f(c * posed.x + s * posed.z, posed.y, -s * posed.x + c * posed.z) + u.place.xyz;
  var o: BodyOut;
  o.pos = u.viewProj * vec4f(world, 1.0);
  o.n = vec3f(c * pn.x + s * pn.z, pn.y, -s * pn.x + c * pn.z);
  o.albedo = select(a, hue(j.x) * w.x + hue(j.y) * w.y + hue(j.z) * w.z + hue(j.w) * w.w, u.misc.x > 0.5);
  o.world = world;
  o.rest = p;
  var head = 0.0;
  for (var k = 0; k < 4; k++) { if (f32(j[k]) == eyes.size.w) { head += w[k]; } }
  o.head = head;
  return o;
}

fn finish(c: vec3f) -> vec4f {
  let t = c / (1.0 + c);
  return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0);
}

@fragment fn fsBody(i: BodyOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let l = normalize(u.sun.xyz);
  let day = 1.0 - u.misc.y;
  let eye = figureEyes(i.rest, i.head, eyes);
  let albedo = mix(i.albedo, eyes.albedo.rgb, eye * step(u.misc.x, 0.5));
  let sky = (0.55 + 0.35 * n.y) * mix(0.06, 1.0, day);
  var c = albedo * (max(dot(n, l), 0.0) * 2.8 * day + sky);
  // The glow after dark, scaled to this stage's light.
  c += eye * u.misc.y * eyes.size.z * 0.12 * eyes.albedo.rgb;
  // Under the water line, a little darker and bluer.
  if (i.world.y < u.water.x) { c *= vec3f(0.62, 0.78, 0.86); }
  return finish(c * 1.15);
}

struct GroundOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f };

@vertex fn vsGround(@location(0) p: vec3f, @location(1) n: vec3f) -> GroundOut {
  var o: GroundOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.n = n;
  return o;
}

@fragment fn fsGround(i: GroundOut) -> @location(0) vec4f {
  // A 10 cm grid, every fifth line darker (half a metre), and a soft shadow under the figure.
  let g10 = i.world.xz * 10.0;
  let a = abs(fract(g10 - 0.5) - 0.5) / fwidth(g10);
  let line = 1.0 - clamp(min(a.x, a.y), 0.0, 1.0);
  let g2 = i.world.xz * 2.0;
  let b = abs(fract(g2 - 0.5) - 0.5) / fwidth(g2);
  let line2 = 1.0 - clamp(min(b.x, b.y) * 0.7, 0.0, 1.0);
  var c = vec3f(0.6, 0.55, 0.45);
  c = mix(c, vec3f(0.4, 0.45, 0.35), line * 0.35);
  c = mix(c, vec3f(0.27, 0.34, 0.25), line2 * 0.55);
  let r = length((i.world.xz - u.place.xz) / vec2f(0.34, 0.42));
  c *= 1.0 - 0.45 * (1.0 - smoothstep(0.3, 1.1, r));
  let l = normalize(u.sun.xyz);
  let day = 1.0 - u.misc.y;
  c *= max(dot(normalize(i.n), l), 0.0) * 0.9 * day + mix(0.05, 0.55, day);
  let fade = 1.0 - smoothstep(2.4, 3.0, max(abs(i.world.x), abs(i.world.z)));
  return finish(mix(vec3f(0.55, 0.52, 0.47) * mix(0.1, 1.0, day), c * 1.3, fade));
}

struct WaterOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

@vertex fn vsWater(@builtin(vertex_index) vi: u32) -> WaterOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  var o: WaterOut;
  let p = vec3f(q.x * 3.0, u.water.x, q.y * 3.0);
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.world = p;
  return o;
}

@fragment fn fsWater(i: WaterOut) -> @location(0) vec4f {
  let day = 1.0 - u.misc.y;
  return vec4f(vec3f(0.42, 0.62, 0.7) * mix(0.1, 1.0, day), 0.45);
}
`;

/** Set views: yaw from the front (the figure faces +z), pitch up from level, distance. */
export const VIEWS = {
  'three-quarter': { yaw: 0.75, pitch: 0.22, dist: 4.4 },
  front: { yaw: 0, pitch: 0.1, dist: 4.2 },
  side: { yaw: Math.PI / 2, pitch: 0.08, dist: 4.2 },
  back: { yaw: Math.PI, pitch: 0.15, dist: 4.2 },
  face: { yaw: 0.2, pitch: 0.05, dist: 1.4 },
  top: { yaw: 0.3, pitch: 1.35, dist: 6 },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{ ok: false, reason: string } | { ok: true, stage: ReturnType<typeof makeStage> }>}
 */
export async function createStage(canvas) {
  const r = await initGpu(canvas);
  if (!r.ok) return { ok: false, reason: r.reason };
  const lib = await loadShader('lib-figure-eyes');
  return { ok: true, stage: makeStage(canvas, r.gpu, lib) };
}

/** @param {HTMLCanvasElement} canvas @param {any} gpu @param {string} lib */
function makeStage(canvas, gpu, lib) {
  const { device, context, format } = gpu;
  const module = device.createShaderModule({ label: 'figure-stage', code: lib + SHADER });
  module.getCompilationInfo().then((info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[stage wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const body = device.createRenderPipeline({
    label: 'figure-stage-body', layout: pl,
    vertex: { module, entryPoint: 'vsBody', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' },
    ] }] },
    fragment: { module, entryPoint: 'fsBody', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil,
  });
  const ground = device.createRenderPipeline({
    label: 'figure-stage-ground', layout: pl,
    vertex: { module, entryPoint: 'vsGround', buffers: [{ arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] },
    fragment: { module, entryPoint: 'fsGround', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil,
  });
  const water = device.createRenderPipeline({
    label: 'figure-stage-water', layout: pl,
    vertex: { module, entryPoint: 'vsWater' },
    fragment: { module, entryPoint: 'fsWater', targets: [{ format, blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const ubuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bbuf = device.createBuffer({ size: 32 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const ebuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: bbuf } }, { binding: 2, resource: { buffer: ebuf } }] });
  const u = new Float32Array(40);
  /** @type {{ v: GPUBuffer, i: GPUBuffer, n: number } | null} */ let mesh = null;
  /** @type {{ v: GPUBuffer, i: GPUBuffer, n: number } | null} */ let groundMesh = null;
  /** @type {GPUTexture | null} */ let depth = null;

  const cam = { ...VIEWS['three-quarter'], goal: { ...VIEWS['three-quarter'] }, spin: false };
  let facing = 0, snapNext = false;
  /** @type {Map<number, { x: number, y: number }>} */ const down = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { down.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointermove', (e) => {
    const was = down.get(e.pointerId);
    if (!was) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size === 2) {
      const [a, b] = [...down.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) cam.goal.dist = Math.min(12, Math.max(1, cam.goal.dist * (pinch / d)));
      pinch = d;
      return;
    }
    cam.goal.yaw -= (e.clientX - was.x) * 0.008;
    cam.goal.pitch = Math.min(1.5, Math.max(-0.1, cam.goal.pitch + (e.clientY - was.y) * 0.006));
  });
  const up = (/** @type {PointerEvent} */ e) => { down.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.goal.dist = Math.min(12, Math.max(1, cam.goal.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

  return {
    /** @param {{ data: ArrayBuffer, indices: Uint32Array }} m */
    setMesh(m) {
      mesh?.v.destroy(); mesh?.i.destroy();
      const v = device.createBuffer({ size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, m.data);
      const i = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, m.indices);
      mesh = { v, i, n: m.indices.length };
    },
    /** A ground of height h(x, z) over 6 m by 6 m. @param {(x: number, z: number) => number} h */
    setGround(h) {
      groundMesh?.v.destroy(); groundMesh?.i.destroy();
      const N = 150, size = 6, step = size / N;
      const vtx = new Float32Array((N + 1) * (N + 1) * 6), idx = new Uint32Array(N * N * 6);
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const x = -size / 2 + i * step, z = -size / 2 + j * step, e = 0.01;
        const nx = h(x - e, z) - h(x + e, z), nz = h(x, z - e) - h(x, z + e);
        const l = Math.hypot(nx, 2 * e, nz);
        vtx.set([x, h(x, z), z, nx / l, (2 * e) / l, nz / l], (j * (N + 1) + i) * 6);
      }
      let k = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        idx.set([a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2], k); k += 6;
      }
      const v = device.createBuffer({ size: vtx.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, vtx);
      const i = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, idx);
      groundMesh = { v, i, n: idx.length };
    },
    /** A set view by name, or one of your own ({ yaw, pitch, dist }). @param {keyof typeof VIEWS | { yaw: number, pitch: number, dist: number }} name */
    view(name) { cam.goal = typeof name === 'string' ? { ...VIEWS[name] } : { ...name }; },
    /** @param {boolean} on */
    spin(on) { cam.spin = on; },
    /** The next draw puts the camera straight at its view, with no easing (frame strips). */
    snap() { snapNext = true; },
    /**
     * Where a world point (body m) fell in the last frame drawn, as shares of the canvas [0..1, 0..1]
     * from its top left (frame strips draw a held tool over the figure). @param {number[]} p
     */
    project(p) {
      const m = u;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [(x / w) * 0.5 + 0.5, 0.5 - (y / w) * 0.5];
    },
    /**
     * @param {{ bones: Float32Array, eyes: Float32Array, place: number[], weights: boolean, night: boolean, water: number, follow: number[], dt: number }} f
     */
    draw(f) {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h || !depth) {
        canvas.width = w; canvas.height = h;
        depth?.destroy();
        depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      if (cam.spin) cam.goal.yaw += f.dt * 0.5;
      if (snapNext) {
        snapNext = false;
        facing = f.place[3];
        Object.assign(cam, { yaw: cam.goal.yaw + facing, pitch: cam.goal.pitch, dist: cam.goal.dist });
      }
      // Views are about the figure: front always sees its face (its facing eases in, so turns are calm).
      let df = f.place[3] - facing;
      df -= Math.round(df / (2 * Math.PI)) * 2 * Math.PI;
      facing += df * (1 - Math.exp(-f.dt * 2));
      let dy = cam.goal.yaw + facing - cam.yaw;
      dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
      const k = 1 - Math.exp(-f.dt * 8);
      cam.yaw += dy * k; cam.pitch += (cam.goal.pitch - cam.pitch) * k; cam.dist += (cam.goal.dist - cam.dist) * k;
      const lookH = cam.dist < 2 ? 1.38 : 0.95;
      const target = [f.follow[0], f.follow[1] + lookH, f.follow[2]];
      const eye = [target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
      u.set(mat4.multiply(mat4.perspective(0.6, w / h, 0.05, 50), mat4.lookAt(eye, target, [0, 1, 0])), 0);
      u.set([eye[0], eye[1], eye[2], 0], 16);
      u.set([0.5, 0.75, 0.6, 0], 20);
      u.set(f.place, 24);
      u.set([f.weights ? 1 : 0, f.night ? 1 : 0, 0, 0], 28);
      u.set([f.water, 0, 0, 0], 32);
      device.queue.writeBuffer(ubuf, 0, u);
      device.queue.writeBuffer(bbuf, 0, f.bones);
      device.queue.writeBuffer(ebuf, 0, f.eyes);
      const enc = device.createCommandEncoder();
      const night = f.night;
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: night ? { r: 0.07, g: 0.08, b: 0.12, a: 1 } : { r: 0.93, g: 0.9, b: 0.84, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, group);
      if (groundMesh) { pass.setPipeline(ground); pass.setVertexBuffer(0, groundMesh.v); pass.setIndexBuffer(groundMesh.i, 'uint32'); pass.drawIndexed(groundMesh.n); }
      if (mesh) { pass.setPipeline(body); pass.setVertexBuffer(0, mesh.v); pass.setIndexBuffer(mesh.i, 'uint32'); pass.drawIndexed(mesh.n); }
      if (f.water > -5) { pass.setPipeline(water); pass.draw(6); }
      pass.end();
      device.queue.submit([enc.finish()]);
    },
  };
}
