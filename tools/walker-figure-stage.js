// @ts-check
// The walker figure page's stage (doc 23, W5): the figure on a test ground (flat, a slope, a shelf)
// with a water level, lit by a low sun and a soft sky, an orbit camera that follows it, and the
// same skinning and eyes as the game (the eyes come from src/shaders/lib-figure-eyes.wgsl). Like the
// creature studio, this is a workbench: its own simple light, no palette. A weights view colours
// each vertex by the bones it follows.

import { mat4 } from 'wgpu-matrix';
import { initGpu, loadShader } from '../src/core/gpu.js';
import { VERTEX_BYTES } from '../src/world/creatures/bodies.js';
import { materialMaps } from '../src/render/gltf.js';
import { mapTexture } from '../src/render/passes/props.js';

const SHADER = /* wgsl */ `
struct U { viewProj: mat4x4f, eye: vec4f, sun: vec4f, place: vec4f, misc: vec4f, water: vec4f, lamp: vec4f, dark: vec4f, fade: vec4f };
// place: x, y, z, yaw; misc: x weights view, y night, z bone count, w the figure's scale (0: 1); water: x level (m, -9 none), y the ground's half size (m)
// The Hollow (the move arena, H0): lamp: the lantern's x, y, z and reach (m); dark: x 1 when dim and lit by the
// lantern alone, y the chamber's own light, z the lantern's strength; fade: x a faded wall's fill, y its outline.
@group(0) @binding(0) var<uniform> u: U;

// The light on a point in the dark: the chamber's own, plus the lantern's warm light falling off to its reach.
fn lampLight(world: vec3f, n: vec3f) -> vec3f {
  let d = u.lamp.xyz - world;
  let dist = length(d);
  let fall = 1.0 - smoothstep(0.0, max(u.lamp.w, 1e-3), dist);
  let nl = 0.35 + 0.65 * max(dot(n, d / max(dist, 1e-3)), 0.0);
  return vec3f(1.0, 0.8, 0.56) * (u.dark.z * fall * fall * nl) + vec3f(u.dark.y);
}
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(2) var<uniform> eyes: FigureEyes;
// The baked maps (a vertex whose colour slot is (u, v, 2) reads them): colour, and the normal in the
// rest pose's own space, turned by the skin like the vertex normal.
@group(0) @binding(3) var colourMap: texture_2d<f32>;
@group(0) @binding(4) var normalMap: texture_2d<f32>;
@group(0) @binding(5) var mapSampler: sampler;

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) albedo: vec3f, @location(2) world: vec3f,
                 @location(3) rest: vec3f, @location(4) head: f32,
                 @location(5) rx: vec3f, @location(6) ry: vec3f, @location(7) rz: vec3f };

fn hue(i: u32) -> vec3f {
  let h = fract(f32(i) * 0.618034);
  return clamp(abs(fract(h + vec3f(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0)) * 0.8 + 0.1;
}

@vertex fn vsBody(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec3f,
                  @location(3) j: vec4u, @location(4) w: vec4f) -> BodyOut {
  let m = bones[j.x] * w.x + bones[j.y] * w.y + bones[j.z] * w.z + bones[j.w] * w.w;
  let posed = (m * vec4f(p, 1.0)).xyz * select(1.0, u.misc.w, u.misc.w > 0.0);
  let pn = normalize((m * vec4f(n, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  let c = cos(u.place.w); let s = sin(u.place.w);
  let world = vec3f(c * posed.x + s * posed.z, posed.y, -s * posed.x + c * posed.z) + u.place.xyz;
  var o: BodyOut;
  o.pos = u.viewProj * vec4f(world, 1.0);
  o.n = vec3f(c * pn.x + s * pn.z, pn.y, -s * pn.x + c * pn.z);
  let yaw = mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
  o.rx = yaw * m[0].xyz; o.ry = yaw * m[1].xyz; o.rz = yaw * m[2].xyz;
  o.albedo = select(a, hue(j.x) * w.x + hue(j.y) * w.y + hue(j.z) * w.z + hue(j.w) * w.w, u.misc.x > 0.5);  o.world = world;
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
  let mapped = i.albedo.z > 1.5;
  let tc = textureSample(colourMap, mapSampler, i.albedo.xy).rgb;
  let tn = textureSample(normalMap, mapSampler, i.albedo.xy).xyz * 2.0 - 1.0;
  let n = select(normalize(i.n), normalize(mat3x3f(i.rx, i.ry, i.rz) * tn), mapped);
  let l = normalize(u.sun.xyz);
  let day = 1.0 - u.misc.y;
  let eye = figureEyes(i.rest, i.head, eyes);
  let albedo = mix(select(i.albedo, tc, mapped), eyes.albedo.rgb, eye * step(u.misc.x, 0.5));
  let sky = (0.55 + 0.35 * n.y) * mix(0.06, 1.0, day);
  var c = albedo * (max(dot(n, l), 0.0) * 2.8 * day + sky);
  if (u.dark.x > 0.5) { c = albedo * lampLight(i.world, n) * 1.6; }
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
  if (u.dark.x > 0.5) {
    // The cave floor: dimmer rock, its grid faint, lit by the lantern.
    let rock = mix(vec3f(0.36, 0.33, 0.3), vec3f(0.3, 0.29, 0.27), line2 * 0.5);
    return finish(rock * (1.0 - 0.45 * (1.0 - smoothstep(0.3, 1.1, r))) * lampLight(i.world, normalize(i.n)) * 1.4);
  }
  c *= max(dot(normalize(i.n), l), 0.0) * 0.9 * day + mix(0.05, 0.55, day);
  let fade = 1.0 - smoothstep(u.water.y * 0.8, u.water.y, max(abs(i.world.x), abs(i.world.z)));
  return finish(mix(vec3f(0.55, 0.52, 0.47) * mix(0.1, 1.0, day), c * 1.3, fade));
}

struct WaterOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

@vertex fn vsWater(@builtin(vertex_index) vi: u32) -> WaterOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  var o: WaterOut;
  let p = vec3f(q.x * u.water.y, u.water.x, q.y * u.water.y);
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.world = p;
  return o;
}

struct PropOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) c: vec3f, @location(2) world: vec3f };

@vertex fn vsProp(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f) -> PropOut {
  var o: PropOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.n = n;
  o.c = c;
  o.world = p;
  return o;
}

// A shape's colour lit: by the sun, or in the dark by the lantern. A negative colour is light of its own
// (marks on the floor, a watcher's glowing hole), drawn as it is.
fn propColour(i: PropOut) -> vec3f {
  if (i.c.x < 0.0) { return -i.c; }
  if (u.dark.x > 0.5) { return i.c * lampLight(i.world, normalize(i.n)) * 1.5; }
  let day = 1.0 - u.misc.y;
  let l = normalize(u.sun.xyz);
  return i.c * (max(dot(normalize(i.n), l), 0.0) * 2.2 * day + (0.55 + 0.35 * normalize(i.n).y) * mix(0.06, 1.0, day));
}

@fragment fn fsProp(i: PropOut) -> @location(0) vec4f { return finish(propColour(i)); }

// A wall in the way, faded (the Hollow camera): a faint fill, and its edges as a soft pale outline.
@fragment fn fsPropFaded(i: PropOut) -> @location(0) vec4f { return vec4f(finish(propColour(i)).rgb, u.fade.x); }
@fragment fn fsPropLine(i: PropOut) -> @location(0) vec4f { return vec4f(0.86, 0.82, 0.74, u.fade.y); }

@fragment fn fsWater(i: WaterOut) -> @location(0) vec4f {
  if (u.dark.x > 0.5) { return vec4f(vec3f(0.3, 0.42, 0.48) * lampLight(i.world, vec3f(0.0, 1.0, 0.0)), 0.55); }
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
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
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
  // Simple coloured shapes (the movement arena's walls, pillars and stand-ins): position, normal, colour.
  const props = device.createRenderPipeline({
    label: 'figure-stage-props', layout: pl,
    vertex: { module, entryPoint: 'vsProp', buffers: [{ arrayStride: 36, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }] }] },
    fragment: { module, entryPoint: 'fsProp', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil,
  });
  // Walls in the way, faded (the Hollow camera, H0): a see-through fill and an outline of their edges.
  const blend = /** @type {GPUBlendState} */ ({ color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } });
  const propBuffers = /** @type {GPUVertexBufferLayout[]} */ ([{ arrayStride: 36, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x3' }] }]);
  const faded = device.createRenderPipeline({
    label: 'figure-stage-faded', layout: pl,
    vertex: { module, entryPoint: 'vsProp', buffers: propBuffers },
    fragment: { module, entryPoint: 'fsPropFaded', targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  const outline = device.createRenderPipeline({
    label: 'figure-stage-outline', layout: pl,
    vertex: { module, entryPoint: 'vsProp', buffers: propBuffers },
    fragment: { module, entryPoint: 'fsPropLine', targets: [{ format, blend }] },
    primitive: { topology: 'line-list' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  });
  /** @type {{ v: GPUBuffer, n: number } | null} */ let propMesh = null;
  /** @type {{ v: GPUBuffer, n: number } | null} */ let fadedMesh = null;
  /** @type {{ v: GPUBuffer, n: number } | null} */ let lineMesh = null;
  /** @param {Float32Array | null | undefined} f */
  const vbuf = (f) => {
    if (!f || !f.length) return null;
    const v = device.createBuffer({ size: f.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(v, 0, f);
    return { v, n: f.length / 9 };
  };
  /** The ground's half size (m). */
  let groundHalf = 3;
  const ubuf = device.createBuffer({ size: 224, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bbuf = device.createBuffer({ size: 32 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const ebuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
  /** A 1 by 1 stand-in until the baked maps come. @param {number[]} rgba */
  const plain = (rgba) => {
    const t = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
    return t;
  };
  /** @param {GPUTexture} colour @param {GPUTexture} normal */
  const bind = (colour, normal) => device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: bbuf } }, { binding: 2, resource: { buffer: ebuf } },
    { binding: 3, resource: colour.createView() }, { binding: 4, resource: normal.createView() }, { binding: 5, resource: sampler }] });
  let group = bind(plain([128, 128, 128, 255]), plain([128, 255, 128, 255]));
  const u = new Float32Array(56);
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
    /**
     * The figure's baked maps, from its GLB (mipmapped; colour read as sRGB). @param {import('../src/render/gltf.js').Glb} glb
     */
    async setMaps(glb) {
      const maps = materialMaps(glb);
      if (!maps.baseColor || !maps.normal) return false;
      group = bind(await mapTexture(device, maps.baseColor, 'rgba8unorm-srgb', [128, 128, 128, 255], 'figure-colour'),
        await mapTexture(device, maps.normal, 'rgba8unorm', [128, 255, 128, 255], 'figure-normal'));
      return true;
    },
    /** @param {{ data: ArrayBuffer, indices: Uint32Array }} m */
    setMesh(m) {
      mesh?.v.destroy(); mesh?.i.destroy();
      const v = device.createBuffer({ size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, m.data);
      const i = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, m.indices);
      mesh = { v, i, n: m.indices.length };
    },
    /**
     * A ground of height h(x, z) over size by size meters (6 by 6 unless given), in N by N quads.
     * @param {(x: number, z: number) => number} h @param {number} [size] @param {number} [N]
     */
    setGround(h, size = 6, N = 150) {
      groundMesh?.v.destroy(); groundMesh?.i.destroy();
      groundHalf = size / 2;
      const step = size / N;
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
    /**
     * Coloured shapes in world meters, as triangles: 9 floats a vertex (position, normal, colour).
     * Null clears them. A negative colour is drawn unlit, as light of its own. faded: shapes drawn
     * see-through (fill, triangles) with their edges as an outline (lines, line pairs), as walls in the way.
     * @param {Float32Array | null} tris @param {{ fill: Float32Array, lines: Float32Array } | null} [fadedShapes]
     */
    setProps(tris, fadedShapes = null) {
      for (const m of [propMesh, fadedMesh, lineMesh]) m?.v.destroy();
      propMesh = vbuf(tris);
      fadedMesh = vbuf(fadedShapes?.fill);
      lineMesh = vbuf(fadedShapes?.lines);
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
     * camera: an outside camera's eye and target (the arena runs the game's own); else the stage's orbit.
     * @param {{ bones: Float32Array, eyes: Float32Array, place: number[], weights: boolean, night: boolean, water: number, follow: number[], dt: number,
     *   camera?: { eye: ArrayLike<number>, target: ArrayLike<number> }, scale?: number,
     *   lamp?: { at: number[], reachM: number, ambient: number, strength: number }, fade?: number[] }} f
     *   lamp: dim, lit by the lantern alone (the Hollow); fade: a faded wall's fill and outline opacity
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
      const target = f.camera ? [...f.camera.target] : [f.follow[0], f.follow[1] + lookH, f.follow[2]];
      const eye = f.camera ? [...f.camera.eye] : [target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
      u.set(mat4.multiply(mat4.perspective(f.camera ? 40 * Math.PI / 180 : 0.6, w / h, 0.05, 200), mat4.lookAt(eye, target, [0, 1, 0])), 0);
      u.set([eye[0], eye[1], eye[2], 0], 16);
      u.set([0.5, 0.75, 0.6, 0], 20);
      u.set(f.place, 24);
      u.set([f.weights ? 1 : 0, f.night ? 1 : 0, 0, f.scale ?? 0], 28);
      u.set([f.water, groundHalf, 0, 0], 32);
      u.set(f.lamp ? [...f.lamp.at, f.lamp.reachM] : [0, 0, 0, 0], 36);
      u.set(f.lamp ? [1, f.lamp.ambient, f.lamp.strength, 0] : [0, 0, 0, 0], 40);
      u.set([f.fade?.[0] ?? 0.15, f.fade?.[1] ?? 0.5, 0, 0], 44);
      device.queue.writeBuffer(ubuf, 0, u);
      device.queue.writeBuffer(bbuf, 0, f.bones);
      device.queue.writeBuffer(ebuf, 0, f.eyes);
      const enc = device.createCommandEncoder();
      const night = f.night;
      const clear = f.lamp ? { r: 0.025, g: 0.025, b: 0.03, a: 1 } : night ? { r: 0.07, g: 0.08, b: 0.12, a: 1 } : { r: 0.93, g: 0.9, b: 0.84, a: 1 };
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: clear, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, group);
      if (groundMesh) { pass.setPipeline(ground); pass.setVertexBuffer(0, groundMesh.v); pass.setIndexBuffer(groundMesh.i, 'uint32'); pass.drawIndexed(groundMesh.n); }
      if (propMesh) { pass.setPipeline(props); pass.setVertexBuffer(0, propMesh.v); pass.draw(propMesh.n); }
      if (mesh) { pass.setPipeline(body); pass.setVertexBuffer(0, mesh.v); pass.setIndexBuffer(mesh.i, 'uint32'); pass.drawIndexed(mesh.n); }
      if (f.water > -5) { pass.setPipeline(water); pass.draw(6); }
      if (fadedMesh) { pass.setPipeline(faded); pass.setVertexBuffer(0, fadedMesh.v); pass.draw(fadedMesh.n); }
      if (lineMesh) { pass.setPipeline(outline); pass.setVertexBuffer(0, lineMesh.v); pass.draw(lineMesh.n); }
      pass.end();
      device.queue.submit([enc.finish()]);
    },
  };
}
