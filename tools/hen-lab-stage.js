// @ts-check
// The hen lab's stage (docs/future/15, slice 1): the hen on a flat test ground with a 10 cm grid,
// skinned by her bones and coloured by her model's map with the feather edges cut, as hen-draw.wgsl
// does; her wary ring and the walker (a dark disc) drawn on the ground. An orbit camera follows her.
// A workbench: its own simple light, no palette.

import { mat4, vec4 } from 'wgpu-matrix';
import { initGpu } from '../src/core/gpu.js';
import { VERTEX_BYTES } from '../src/world/creatures/bodies.js';
import { materialMaps } from '../src/render/gltf.js';
import { mapTexture } from '../src/render/passes/props.js';

const SHADER = /* wgsl */ `
struct U { viewProj: mat4x4f, eye: vec4f, sun: vec4f, place: vec4f, misc: vec4f, walker: vec4f, marks: vec4f, marks2: vec4f };
// place: x, y, z, yaw; misc: x size, y alpha cut, z ring (m, 0 none), w half the ground's size; walker: x, z, shown, sitting;
// marks: the fire ring's x, z, then a treat's x, z; marks2: a dug hole's x, z, then which are shown (bits: 1 ring, 2 treat, 4 hole)
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(2) var colourMap: texture_2d<f32>;
@group(0) @binding(3) var mapSampler: sampler;

fn finish(c: vec3f) -> vec4f {
  let t = c / (1.0 + c);
  return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0);
}

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) uv: vec2f };

@vertex fn vsBody(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec3f,
                  @location(3) j: vec4u, @location(4) w: vec4f) -> BodyOut {
  let m = bones[j.x] * w.x + bones[j.y] * w.y + bones[j.z] * w.z + bones[j.w] * w.w;
  let posed = (m * vec4f(p, 1.0)).xyz * u.misc.x;
  let pn = normalize((m * vec4f(n, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  let c = cos(u.place.w); let s = sin(u.place.w);
  let world = vec3f(c * posed.x + s * posed.z, posed.y, -s * posed.x + c * posed.z) + u.place.xyz;
  var o: BodyOut;
  o.pos = u.viewProj * vec4f(world, 1.0);
  o.n = vec3f(c * pn.x + s * pn.z, pn.y, -s * pn.x + c * pn.z);
  o.uv = a.xy;
  return o;
}

@fragment fn fsBody(i: BodyOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let tex = textureSample(colourMap, mapSampler, i.uv);
  if (tex.a < u.misc.y) { discard; }
  let n = normalize(i.n) * select(-1.0, 1.0, front);
  let l = normalize(u.sun.xyz);
  let c = tex.rgb * (max(dot(n, l), 0.0) * 2.6 + 0.55 + 0.3 * n.y);
  return finish(c * 1.1);
}

struct GroundOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

@vertex fn vsGround(@builtin(vertex_index) vi: u32) -> GroundOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  var o: GroundOut;
  let p = vec3f(q.x * u.misc.w, 0.0, q.y * u.misc.w);
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.world = p;
  return o;
}

@fragment fn fsGround(i: GroundOut) -> @location(0) vec4f {
  let g10 = i.world.xz * 10.0;
  let a = abs(fract(g10 - 0.5) - 0.5) / fwidth(g10);
  let line = 1.0 - clamp(min(a.x, a.y), 0.0, 1.0);
  let g1 = i.world.xz;
  let b = abs(fract(g1 - 0.5) - 0.5) / fwidth(g1);
  let line1 = 1.0 - clamp(min(b.x, b.y) * 0.7, 0.0, 1.0);
  var c = vec3f(0.6, 0.56, 0.46);
  c = mix(c, vec3f(0.45, 0.47, 0.38), line * 0.25);
  c = mix(c, vec3f(0.3, 0.36, 0.27), line1 * 0.55);
  // A soft shadow under her, her wary ring, and the walker.
  let d = length(i.world.xz - u.place.xz);
  c *= 1.0 - 0.4 * (1.0 - smoothstep(0.08, 0.3, d / max(u.misc.x, 0.1)));
  if (u.misc.z > 0.0) {
    let r = abs(d - u.misc.z) / fwidth(d);
    c = mix(c, vec3f(0.71, 0.39, 0.24), (1.0 - clamp(r - 1.0, 0.0, 1.0)) * 0.9);
  }
  if (u.walker.z > 0.5) {
    let dw = length(i.world.xz - u.walker.xy);
    // A sitting walker is drawn wider and lower (a ring round the dark disc).
    c = mix(c, vec3f(0.12, 0.15, 0.14), 1.0 - smoothstep(0.24, 0.27, dw));
    if (u.walker.w > 0.5) { c = mix(c, vec3f(0.12, 0.15, 0.14), (1.0 - clamp(abs(dw - 0.4) / fwidth(dw) - 1.0, 0.0, 1.0)) * 0.8); }
  }
  let bits = u32(u.marks2.w + 0.5);
  if ((bits & 1u) != 0u) {
    // The fire ring: a ring of stones round dark ashes.
    let dr = length(i.world.xz - u.marks.xy);
    c = mix(c, vec3f(0.18, 0.15, 0.13), 1.0 - smoothstep(0.24, 0.27, dr));
    c = mix(c, vec3f(0.55, 0.53, 0.5), (1.0 - smoothstep(0.04, 0.07, abs(dr - 0.33))));
  }
  if ((bits & 2u) != 0u) {
    let dt = length(i.world.xz - u.marks.zw);
    c = mix(c, vec3f(0.62, 0.32, 0.3), 1.0 - smoothstep(0.06, 0.08, dt));
  }
  if ((bits & 4u) != 0u) {
    let dh = length(i.world.xz - u.marks2.xy);
    c = mix(c, vec3f(0.3, 0.22, 0.15), 1.0 - smoothstep(0.16, 0.2, dh));
  }
  let fade = 1.0 - smoothstep(u.misc.w * 0.8, u.misc.w, max(abs(i.world.x), abs(i.world.z)));
  return finish(mix(vec3f(0.62, 0.6, 0.55), c * 1.25, fade));
}
`;

/** Camera views: yaw about her, pitch, distance (m). */
export const VIEWS = {
  side: { yaw: Math.PI / 2, pitch: 0.12, dist: 1.6 },
  'three-quarter': { yaw: 0.8, pitch: 0.3, dist: 1.8 },
  front: { yaw: 0, pitch: 0.12, dist: 1.6 },
  above: { yaw: 0.4, pitch: 1.1, dist: 7 },
  wide: { yaw: 0.6, pitch: 0.7, dist: 14 },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{ ok: false, reason: string } | { ok: true, stage: ReturnType<typeof makeStage> }>}
 */
export async function createStage(canvas) {
  const r = await initGpu(canvas);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, stage: makeStage(canvas, r.gpu) };
}

/** @param {HTMLCanvasElement} canvas @param {any} gpu */
function makeStage(canvas, gpu) {
  const { device, context, format } = gpu;
  const module = device.createShaderModule({ label: 'hen-stage', code: SHADER });
  module.getCompilationInfo().then((/** @type {any} */ info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[hen stage wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const body = device.createRenderPipeline({ label: 'hen-stage-body', layout: pl,
    vertex: { module, entryPoint: 'vsBody', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' }] }] },
    fragment: { module, entryPoint: 'fsBody', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil });
  const ground = device.createRenderPipeline({ label: 'hen-stage-ground', layout: pl,
    vertex: { module, entryPoint: 'vsGround' }, fragment: { module, entryPoint: 'fsGround', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }, depthStencil });
  const ubuf = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bbuf = device.createBuffer({ size: 32 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
  const plain = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: plain }, new Uint8Array([150, 120, 90, 255]), { bytesPerRow: 4 }, [1, 1]);
  /** @param {GPUTexture} t */
  const bind = (t) => device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: bbuf } },
    { binding: 2, resource: t.createView() }, { binding: 3, resource: sampler }] });
  let group = bind(plain);
  const u = new Float32Array(44);
  /** @type {{ v: GPUBuffer, i: GPUBuffer, n: number } | null} */ let mesh = null;
  /** @type {GPUTexture | null} */ let depth = null;
  let view = /** @type {any} */ (null);
  const cam = { ...VIEWS['three-quarter'], goal: { ...VIEWS['three-quarter'] }, at: [0, 0.25, 0] };
  /** @type {{ x: number, y: number } | null} */ let drag = null;
  let moved = 0;
  /** @type {((x: number, z: number) => void) | null} */ let onGround = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    cam.goal.yaw -= dx * 0.008; cam.goal.pitch = Math.min(1.45, Math.max(0.02, cam.goal.pitch + dy * 0.006));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    drag = null;
    if (moved > 6 || !onGround || !view) return;
    // A click on the ground: where it lands on y = 0.
    const rect = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const inv = mat4.inverse(view);
    const p0 = vec4.transformMat4([nx, ny, 0, 1], inv), p1 = vec4.transformMat4([nx, ny, 1, 1], inv);
    const a = [p0[0] / p0[3], p0[1] / p0[3], p0[2] / p0[3]], b = [p1[0] / p1[3], p1[1] / p1[3], p1[2] / p1[3]];
    if (Math.abs(b[1] - a[1]) < 1e-6) return;
    const t = -a[1] / (b[1] - a[1]);
    if (t > 0) onGround(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t);
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.goal.dist = Math.min(30, Math.max(0.6, cam.goal.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

  return {
    /** The hen's mesh and colour map. @param {{ data: ArrayBuffer, indices: Uint32Array }} m @param {any} glb */
    async setHen(m, glb) {
      const v = device.createBuffer({ size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, m.data);
      const i = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, m.indices);
      mesh = { v, i, n: m.indices.length };
      group = bind(await mapTexture(device, materialMaps(glb).baseColor, 'rgba8unorm-srgb', [150, 120, 90, 255], 'hen-colour'));
    },
    /** @param {keyof typeof VIEWS} name */
    setView(name) { Object.assign(cam.goal, VIEWS[name]); },
    /** Called with the ground point a click lands on. @param {(x: number, z: number) => void} fn */
    onGroundClick(fn) { onGround = fn; },
    /**
     * Draw a frame. @param {number} dt
     * @param {{ x: number, z: number, yaw: number, size: number, cut: number, bones: Float32Array, ringM: number, walker: { x: number, z: number, sit?: boolean } | null, groundHalf: number, follow?: boolean,
     *   fire?: { x: number, z: number } | null, treat?: { x: number, z: number } | null, hole?: { x: number, z: number } | null }} s
     */
    draw(dt, s) {
      const w = canvas.clientWidth * devicePixelRatio | 0, h = canvas.clientHeight * devicePixelRatio | 0;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; depth?.destroy(); depth = null; }
      if (!depth) depth = device.createTexture({ size: [canvas.width, canvas.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const ease = Math.min(1, dt * 6);
      for (const k of /** @type {const} */ (['yaw', 'pitch', 'dist'])) cam[k] += (cam.goal[k] - cam[k]) * ease;
      cam.at[0] += (s.x - cam.at[0]) * ease; cam.at[2] += (s.z - cam.at[2]) * ease;
      // Following her heading (the clips), a side view stays side on as she walks round.
      const yaw = cam.yaw + (s.follow ? s.yaw : 0);
      const eye = [cam.at[0] + Math.sin(yaw) * Math.cos(cam.pitch) * cam.dist, cam.at[1] + Math.sin(cam.pitch) * cam.dist,
        cam.at[2] + Math.cos(yaw) * Math.cos(cam.pitch) * cam.dist];
      const proj = mat4.perspective(0.7, canvas.width / Math.max(1, canvas.height), 0.05, 200);
      view = mat4.multiply(proj, mat4.lookAt(eye, cam.at, [0, 1, 0]));
      u.set(view, 0);
      u.set([...eye, 1, 0.5, 0.9, 0.4, 0, s.x, 0, s.z, s.yaw, s.size, s.cut, s.ringM, s.groundHalf,
        s.walker?.x ?? 0, s.walker?.z ?? 0, s.walker ? 1 : 0, s.walker?.sit ? 1 : 0,
        s.fire?.x ?? 0, s.fire?.z ?? 0, s.treat?.x ?? 0, s.treat?.z ?? 0, s.hole?.x ?? 0, s.hole?.z ?? 0, 0, (s.fire ? 1 : 0) + (s.treat ? 2 : 0) + (s.hole ? 4 : 0)], 16);
      device.queue.writeBuffer(ubuf, 0, u);
      device.queue.writeBuffer(bbuf, 0, s.bones);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.83, g: 0.8, b: 0.74, a: 1 } }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, group);
      pass.setPipeline(ground);
      pass.draw(6);
      if (mesh) {
        pass.setPipeline(body);
        pass.setVertexBuffer(0, mesh.v);
        pass.setIndexBuffer(mesh.i, 'uint32');
        pass.drawIndexed(mesh.n);
      }
      pass.end();
      device.queue.submit([enc.finish()]);
    },
  };
}
