// @ts-check
// The creature studio's stage (S6 creature studio plan): one baked, skinned body on a cream floor with
// a 1 cm grid, lit by a low sun and a soft sky, with an orbit camera and set views. It draws the same
// packed mesh the game draws (src/world/creatures/bodies.js: 44 bytes a vertex, four bones each) and
// poses it with the same bone matrices, but with its own simple light: this is a workbench, not the
// island, so the palette is not applied (albedo shows as it is, gently tonemapped).

import { mat4 } from 'wgpu-matrix';
import { initGpu } from '../src/core/gpu.js';
import { VERTEX_BYTES, MAX_BONES } from '../src/world/creatures/bodies.js';

const SHADER = /* wgsl */ `
struct U { viewProj: mat4x4f, eye: vec4f, sun: vec4f, misc: vec4f, shade: vec4f };   // misc.x body scale, misc.y lift (m); shade: shadow radii x, z (m) and strength
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) albedo: vec3f, @location(2) world: vec3f };

@vertex fn vsBody(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec3f,
                  @location(3) j: vec4u, @location(4) w: vec4f) -> BodyOut {
  let m = bones[j.x] * w.x + bones[j.y] * w.y + bones[j.z] * w.z + bones[j.w] * w.w;
  let world = ((m * vec4f(p, 1.0)).xyz + vec3f(0.0, u.misc.y, 0.0)) * u.misc.x;
  var o: BodyOut;
  o.pos = u.viewProj * vec4f(world, 1.0);
  o.n = normalize((m * vec4f(n, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  o.albedo = a;
  o.world = world;
  return o;
}

fn finish(c: vec3f) -> vec4f {
  let t = c / (1.0 + c);
  return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0);
}

@fragment fn fsBody(i: BodyOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let l = normalize(u.sun.xyz);
  let v = normalize(u.eye.xyz - i.world);
  let sky = 0.55 + 0.35 * n.y;
  let h = normalize(l + v);
  // A wet sheen, as the game's frogs have.
  let spec = pow(max(dot(n, h), 0.0), 48.0) * 0.35;
  return finish(i.albedo * (max(dot(n, l), 0.0) * 2.6 + sky) + vec3f(spec));
}

struct FloorOut { @builtin(position) pos: vec4f, @location(0) xz: vec2f };

@vertex fn vsFloor(@builtin(vertex_index) vi: u32) -> FloorOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let xz = q * 0.25;
  var o: FloorOut;
  o.pos = u.viewProj * vec4f(xz.x, 0.0, xz.y, 1.0);
  o.xz = xz;
  return o;
}

@fragment fn fsFloor(i: FloorOut) -> @location(0) vec4f {
  // A 1 cm grid, every fifth line darker (5 cm), and a soft shadow under the body.
  let cm = i.xz * 100.0;
  let g = abs(fract(cm - 0.5) - 0.5) / fwidth(cm);
  let line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  let cm5 = cm / 5.0;
  let g5 = abs(fract(cm5 - 0.5) - 0.5) / fwidth(cm5);
  let line5 = 1.0 - clamp(min(g5.x, g5.y) * 0.7, 0.0, 1.0);
  var c = vec3f(0.62, 0.57, 0.48);
  c = mix(c, vec3f(0.36, 0.42, 0.33), line * 0.45);
  c = mix(c, vec3f(0.24, 0.32, 0.23), line5 * 0.6);
  let r = length(i.xz / u.shade.xy / u.misc.x);
  c *= 1.0 - u.shade.z * (1.0 - smoothstep(0.4, 1.1, r));
  let fade = 1.0 - smoothstep(0.15, 0.25, max(abs(i.xz.x), abs(i.xz.y)));
  return finish(mix(vec3f(0.58, 0.55, 0.49), c, fade) * 1.25);
}
`;

/** Set views: yaw from the front (the body faces +z), pitch up from level. */
export const VIEWS = {
  'three-quarter': { yaw: 0.8, pitch: 0.32 },
  front: { yaw: 0, pitch: 0.18 },
  side: { yaw: Math.PI / 2, pitch: 0.12 },
  behind: { yaw: Math.PI, pitch: 0.3 },
  top: { yaw: 0.3, pitch: 1.45 },
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
  const module = device.createShaderModule({ label: 'studio', code: SHADER });
  const layout = device.createBindGroupLayout({
    label: 'studio',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  const body = device.createRenderPipeline({
    label: 'studio-body', layout: pl,
    vertex: { module, entryPoint: 'vsBody', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' },
      { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' },
    ] }] },
    fragment: { module, entryPoint: 'fsBody', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil,
  });
  const floor = device.createRenderPipeline({
    label: 'studio-floor', layout: pl,
    vertex: { module, entryPoint: 'vsFloor' },
    fragment: { module, entryPoint: 'fsFloor', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil,
  });
  const ubuf = device.createBuffer({ label: 'studio-u', size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bbuf = device.createBuffer({ label: 'studio-bones', size: MAX_BONES * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: bbuf } }] });
  const u = new Float32Array(32);
  // How this species sits on the stage: what the camera looks at and from how far, how high the
  // body is held over the floor (a fish or a dragonfly has its origin in its middle), its shadow.
  let framing = { target: [0, 0.018, 0.002], dist: 0.17, liftM: 0, shadow: [0.032, 0.042, 0.45] };
  /** @type {{ v: GPUBuffer, i: GPUBuffer, n: number } | null} */ let mesh = null;
  /** @type {GPUTexture | null} */ let depth = null;

  // Orbit camera about the body's middle.
  const cam = { yaw: VIEWS['three-quarter'].yaw, pitch: VIEWS['three-quarter'].pitch, dist: 0.17, goal: { ...VIEWS['three-quarter'] } };
  let scale = 1;
  // One finger or the mouse turns the creature; two fingers pinch to come closer; the wheel too.
  /** @type {Map<number, { x: number, y: number }>} */ const down = new Map();
  let pinch = 0;
  const zoomBy = (/** @type {number} */ k) => { cam.dist = Math.min(0.6, Math.max(0.08, cam.dist * k)); };
  canvas.addEventListener('pointerdown', (e) => { down.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointermove', (e) => {
    const was = down.get(e.pointerId);
    if (!was) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (down.size === 2) {
      const [a, b] = [...down.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomBy(pinch / d);
      pinch = d;
      return;
    }
    cam.goal.yaw -= (e.clientX - was.x) * 0.008;
    cam.goal.pitch = Math.min(1.5, Math.max(-0.05, cam.goal.pitch + (e.clientY - was.y) * 0.006));
  });
  const up = (/** @type {PointerEvent} */ e) => { down.delete(e.pointerId); pinch = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.001)); }, { passive: false });

  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h || !depth) {
      canvas.width = w; canvas.height = h;
      depth?.destroy();
      depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    // Ease toward the chosen view (yaw the short way round).
    let dy = cam.goal.yaw - cam.yaw;
    dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
    cam.yaw += dy * 0.15;
    cam.pitch += (cam.goal.pitch - cam.pitch) * 0.15;
    const target = framing.target.map((v) => v * scale);
    const d = cam.dist * scale;
    const eye = [target[0] + d * Math.cos(cam.pitch) * Math.sin(cam.yaw), target[1] + d * Math.sin(cam.pitch), target[2] + d * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
    const proj = mat4.perspective(0.6, w / h, 0.005, 5);
    const view = mat4.lookAt(eye, target, [0, 1, 0]);
    u.set(mat4.multiply(proj, view), 0);
    u.set([eye[0], eye[1], eye[2], 0], 16);
    u.set([0.45, 0.8, 0.55, 0], 20);
    u[24] = scale;
    u[25] = framing.liftM;
    u.set(framing.shadow, 28);
    device.queue.writeBuffer(ubuf, 0, u);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0.93, g: 0.9, b: 0.84, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setBindGroup(0, group);
    pass.setPipeline(floor);
    pass.draw(6);
    if (mesh) {
      pass.setPipeline(body);
      pass.setVertexBuffer(0, mesh.v);
      pass.setIndexBuffer(mesh.i, 'uint32');
      pass.drawIndexed(mesh.n);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  return {
    /** Show a baked mesh (packed vertices and indices from bakeVariant). @param {{ data: ArrayBuffer, indices: Uint32Array }} m */
    setMesh(m) {
      mesh?.v.destroy(); mesh?.i.destroy();
      const v = device.createBuffer({ label: 'studio-v', size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, m.data);
      const i = device.createBuffer({ label: 'studio-i', size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, m.indices);
      mesh = { v, i, n: m.indices.length };
    },
    /** The bone matrices this frame (16 floats a bone, MAX_BONES). @param {Float32Array} mats */
    setBones(mats) { device.queue.writeBuffer(bbuf, 0, mats); },
    /** Go to a set view. @param {keyof typeof VIEWS} name */
    view(name) { cam.goal = { ...VIEWS[name] }; },
    /** Draw the body this many times its real size (the grid stays real). @param {number} s */
    setScale(s) { scale = s; },
    /**
     * Frame a species: the camera's target (body m) and distance, the lift over the floor, and the
     * shadow's radii and strength. @param {{ target: number[], dist: number, liftM: number, shadow: number[] }} f
     */
    setFraming(f) { framing = f; cam.dist = f.dist; },
    /** Drop the body (a new species is on its way). */
    clear() { mesh?.v.destroy(); mesh?.i.destroy(); mesh = null; },
    draw,
  };
}
