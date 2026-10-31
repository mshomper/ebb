// @ts-check
// The shore birds lab's stage (B3 R1): one WebGPU view of a strip of wet sand with a 10 cm grid (so a
// foot that slid would show against it), drawing any number of skinned meshes, each with its own
// place, size, bank and bones (a bird, a flock, the stone it turns). Each casts a soft round shadow.
// Its own simple light, as the other creature labs: a workbench, not the island, so the palette is
// not applied.

import { mat4 } from 'wgpu-matrix';
import { initGpu } from '../src/core/gpu.js';
import { VERTEX_BYTES, MAX_BONES } from '../src/world/creatures/bodies.js';

/** How many things one frame can draw, and how many shadows it casts. */
const SLOTS = 24, SHADOWS = 12;

const SHADER = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,
  sun: vec4f,
  shadows: array<vec4f, ${SHADOWS}>,  // x, z, radius, strength
};
struct Thing {
  place: vec4f,  // x, y, z, yaw
  misc: vec4f,   // x size, y bank (roll about its forward axis), z pitch
};
@group(0) @binding(0) var<uniform> f: Frame;
@group(0) @binding(1) var<uniform> th: Thing;
@group(0) @binding(2) var<storage, read> bones: array<mat4x4f>;

fn finish(c: vec3f) -> vec4f {
  let t = c / (1.0 + c);
  return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0);
}
fn orient(q: vec3f) -> vec3f {
  let cp = cos(th.misc.z); let sp = sin(th.misc.z);
  let a = vec3f(q.x, cp * q.y - sp * q.z, sp * q.y + cp * q.z);
  let cr = cos(th.misc.y); let sr = sin(th.misc.y);
  let b = vec3f(cr * a.x - sr * a.y, sr * a.x + cr * a.y, a.z);
  let c = cos(th.place.w); let s = sin(th.place.w);
  return vec3f(c * b.x + s * b.z, b.y, -s * b.x + c * b.z);
}

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) albedo: vec3f, @location(2) world: vec3f };

@vertex fn vsBody(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec3f,
                  @location(3) j: vec4u, @location(4) w: vec4f) -> BodyOut {
  let m = bones[j.x] * w.x + bones[j.y] * w.y + bones[j.z] * w.z + bones[j.w] * w.w;
  let world = orient((m * vec4f(p, 1.0)).xyz * th.misc.x) + th.place.xyz;
  var o: BodyOut;
  o.pos = f.viewProj * vec4f(world, 1.0);
  o.n = orient(normalize((m * vec4f(n, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0)));
  o.albedo = a;
  o.world = world;
  return o;
}

@fragment fn fsBody(i: BodyOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  var n = normalize(i.n);
  let v = normalize(f.eye.xyz - i.world);
  if (dot(n, v) < 0.0) { n = -n; }
  let l = normalize(f.sun.xyz);
  let sky = 0.5 + 0.35 * n.y;
  let h = normalize(l + v);
  let spec = pow(max(dot(n, h), 0.0), 24.0) * 0.06;
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;
  return finish(i.albedo * (max(dot(n, l), 0.0) * 2.6 + sky) + vec3f(spec + rim * 0.4));
}

struct FlatOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };
const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vsFloor(@builtin(vertex_index) vi: u32) -> FlatOut {
  let q = QUAD[vi] * 12.0;
  var o: FlatOut;
  o.world = vec3f(q.x + f.eye.w, 0.0, q.y + f.sun.w);
  o.pos = f.viewProj * vec4f(o.world, 1.0);
  return o;
}

fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment fn fsFloor(i: FlatOut) -> @location(0) vec4f {
  let xz = i.world.xz;
  // Wet sand toward -x, drier toward +x; a fine grain; a 10 cm grid, every metre darker.
  let wet = smoothstep(1.5, -2.5, xz.x);
  var c = mix(vec3f(0.6, 0.53, 0.42), vec3f(0.36, 0.33, 0.28), wet);
  c *= 0.93 + 0.12 * hash(floor(xz * 300.0));
  let g = xz * 10.0;
  let gl = abs(fract(g - 0.5) - 0.5) / fwidth(g);
  let line = 1.0 - clamp(min(gl.x, gl.y), 0.0, 1.0);
  let m = xz;
  let ml = abs(fract(m - 0.5) - 0.5) / fwidth(m);
  let line1 = 1.0 - clamp(min(ml.x, ml.y) * 0.6, 0.0, 1.0);
  c = mix(c, c * 0.78, line * 0.45);
  c = mix(c, c * 0.6, line1 * 0.55);
  // Soft shadows under each thing, fainter the higher it is.
  var shade = 1.0;
  for (var k = 0u; k < ${SHADOWS}u; k++) {
    let s = f.shadows[k];
    if (s.w <= 0.0) { continue; }
    let r = length(xz - s.xy) / s.z;
    shade *= 1.0 - s.w * (1.0 - smoothstep(0.3, 1.0, r));
  }
  c *= shade;
  let sun = normalize(f.sun.xyz);
  let lit = c * (sun.y * 2.6 + 0.85);
  // Fade into the distance.
  let d = length(xz - vec2f(f.eye.w, f.sun.w));
  return finish(mix(lit, vec3f(0.62, 0.62, 0.6) * 2.2, smoothstep(5.0, 11.0, d)));
}
`;

/** @param {HTMLCanvasElement} canvas */
export async function createStage(canvas) {
  const r = await initGpu(canvas);
  if (!('gpu' in r)) return { ok: /** @type {const} */ (false), reason: r.reason };
  return { ok: /** @type {const} */ (true), stage: makeStage(r.gpu, canvas) };
}

/** @param {any} gpu @param {HTMLCanvasElement} canvas */
function makeStage(gpu, canvas) {
  const { device, format } = gpu;
  const module = device.createShaderModule({ label: 'shore-birds-lab', code: SHADER });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {} },
    { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  const body = device.createRenderPipeline({ layout: pl,
    vertex: { module, entryPoint: 'vsBody', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' }] }] },
    fragment: { module, entryPoint: 'fsBody', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil });
  const floor = device.createRenderPipeline({ layout: pl, vertex: { module, entryPoint: 'vsFloor' },
    fragment: { module, entryPoint: 'fsFloor', targets: [{ format }] }, primitive: { topology: 'triangle-list' }, depthStencil });
  const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  context.configure({ device, format, alphaMode: 'opaque' });
  const frameBuf = device.createBuffer({ size: (24 + SHADOWS * 4) * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameData = new Float32Array(24 + SHADOWS * 4);
  const slots = Array.from({ length: SLOTS }, () => {
    const u = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const b = device.createBuffer({ size: MAX_BONES * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: u } }, { binding: 2, resource: { buffer: b } }] });
    return { u, b, group };
  });
  /** @type {Map<string, { v: GPUBuffer, i: GPUBuffer, n: number }>} */ const meshes = new Map();
  /** @type {GPUTexture | null} */ let depth = null;

  return {
    /** Add or replace a packed mesh by name. @param {string} name @param {{ data: ArrayBuffer, indices: Uint32Array }} m */
    setMesh(name, m) {
      const v = device.createBuffer({ size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, m.data);
      const i = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, m.indices);
      meshes.set(name, { v, i, n: m.indices.length });
    },
    /**
     * Draw a frame. @param {{ cam: { yaw: number, pitch: number, dist: number, target: number[] },
     *   things: { mesh: string, place: number[], size: number, bank?: number, pitch?: number, bones: Float32Array, shadow?: number }[] }} s
     *   place: x, y, z, yaw; shadow: the shadow's radius (m), none when left out
     */
    draw(s) {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h || !depth) {
        canvas.width = w; canvas.height = h;
        depth?.destroy();
        depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      const c = s.cam, t = c.target;
      const eye = [t[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), t[1] + c.dist * Math.sin(c.pitch), t[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
      frameData.fill(0);
      frameData.set(mat4.multiply(mat4.perspective(0.6, w / h, 0.02, 40), mat4.lookAt(eye, t, [0, 1, 0])), 0);
      frameData.set([eye[0], eye[1], eye[2], t[0]], 16);
      frameData.set([0.45, 0.8, 0.4, t[2]], 20);
      let k = 0;
      for (const x of s.things) {
        if (!x.shadow || k >= SHADOWS) continue;
        const lift = Math.max(0, x.place[1]);
        frameData.set([x.place[0], x.place[2], x.shadow * (1 + lift * 0.6), 0.5 * Math.max(0, 1 - lift / 2.5)], 24 + k * 4);
        k++;
      }
      device.queue.writeBuffer(frameBuf, 0, frameData);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0.83, g: 0.86, b: 0.86, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, slots[0].group);
      pass.setPipeline(floor); pass.draw(6);
      pass.setPipeline(body);
      s.things.slice(0, SLOTS).forEach((x, i) => {
        const mesh = meshes.get(x.mesh);
        if (!mesh) return;
        const slot = slots[i];
        device.queue.writeBuffer(slot.u, 0, new Float32Array([...x.place, x.size, x.bank ?? 0, x.pitch ?? 0, 0]));
        device.queue.writeBuffer(slot.b, 0, x.bones);
        pass.setBindGroup(0, slot.group);
        pass.setVertexBuffer(0, mesh.v); pass.setIndexBuffer(mesh.i, 'uint32'); pass.drawIndexed(mesh.n);
      });
      pass.end();
      device.queue.submit([enc.finish()]);
    },
  };
}
