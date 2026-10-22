// @ts-check
// The turtle lab's stage (M2 turtle life, TL1): one small WebGPU view per motion, all sharing one
// device and the one baked, skinned turtle body (src/world/creatures/bodies.js), each with its own
// bones. A view may show a sandy floor with a 1 cm grid, a stone ledge, and a water surface with a
// ring where a turtle plopped in. Its own simple light, as the creature studio's: a workbench, not
// the island, so the palette is not applied.

import { mat4 } from 'wgpu-matrix';
import { initGpu } from '../src/core/gpu.js';
import { VERTEX_BYTES, MAX_BONES } from '../src/world/creatures/bodies.js';
import { shellBlock } from '../src/render/passes/creatures.js';

const SHADER = (/** @type {string} */ shellCode) => /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  eye: vec4f,      // camera
  sun: vec4f,
  place: vec4f,    // the turtle: x, y, z, yaw
  misc: vec4f,     // x body scale, y dry 0..1, z water height, w 1 with water
  ledge: vec4f,    // half width (x), from z, to z, top y (no ledge when half width is 0)
  ring: vec4f,     // a plop: x, z, radius, strength
  floor: vec4f,    // x floor height, y wet darken, z dry roughness share, w dry sheen share
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;
// The game's creature-draw block (only its shell and drying fields are read here).
struct CreatureDraw {
  look: vec4f, body: vec4f, glint: vec4f,
  shell: vec4f, shellC: vec4f, shellR: vec4f, oval: vec4f, scute: vec4f, dots: vec4f,
  list: array<vec4f, 3>, baseCol: vec4f, seamCol: vec4f, fleckCol: vec4f, wet: vec4f,
};
@group(0) @binding(2) var<uniform> cd: CreatureDraw;
${shellCode}

fn finish(c: vec3f) -> vec4f {
  let t = c / (1.0 + c);
  return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0);
}
fn place(p: vec3f) -> vec3f {
  let c = cos(u.place.w); let s = sin(u.place.w);
  let q = p * u.misc.x;
  return vec3f(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) + u.place.xyz;
}

struct BodyOut { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) albedo: vec3f, @location(2) world: vec3f, @location(3) rest: vec3f, @location(4) stiff: f32 };

@vertex fn vsBody(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec3f,
                  @location(3) j: vec4u, @location(4) w: vec4f) -> BodyOut {
  let m = bones[j.x] * w.x + bones[j.y] * w.y + bones[j.z] * w.z + bones[j.w] * w.w;
  let world = place((m * vec4f(p, 1.0)).xyz);
  let nl = normalize((m * vec4f(n, 0.0)).xyz + vec3f(0.0, 1e-6, 0.0));
  let c = cos(u.place.w); let s = sin(u.place.w);
  var o: BodyOut;
  o.pos = u.viewProj * vec4f(world, 1.0);
  o.n = vec3f(c * nl.x + s * nl.z, nl.y, -s * nl.x + c * nl.z);
  o.albedo = a;
  o.world = world;
  o.rest = p;
  o.stiff = select(0.0, 1.0, j.x == 0u && w.x > 0.99);
  return o;
}

@fragment fn fsBody(i: BodyOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let l = normalize(u.sun.xyz);
  let v = normalize(u.eye.xyz - i.world);
  let dry = u.misc.y;
  // The shell's plates per pixel, as the game draws them (u.eye.w 1: the baked colours instead).
  var base = i.albedo;
  var ao = 1.0;
  let s = shellLook(i.rest);
  let q = (i.rest - cd.shellC.xyz) / cd.shellR.xyz;
  let on = u.eye.w < 0.5 && cd.shell.x > 0.5 && i.stiff > 0.5 && i.rest.y > cd.shell.y + 0.0004 && abs(length(q) - 1.0) < 0.12;
  base = select(base, s.rgb, on);
  ao = select(1.0, 1.0 - cd.shell.w * s.a, on);
  // Wet skin and shell are darker and glossy; dry, paler and matte (the game's wetSpecular).
  let albedo = base * mix(u.floor.y, 1.0, dry) * ao;
  let sky = 0.55 + 0.35 * n.y;
  let h = normalize(l + v);
  let shine = mix(90.0, 10.0, dry * u.floor.z);
  let spec = pow(max(dot(n, h), 0.0), shine) * mix(0.55, 0.55 * u.floor.w, dry);
  var c = albedo * (max(dot(n, l), 0.0) * 2.6 + sky) + vec3f(spec);
  // Under the water: greener and dimmer with depth.
  if (u.misc.w > 0.5 && i.world.y < u.misc.z) {
    let d = clamp((u.misc.z - i.world.y) / 0.25, 0.0, 1.0);
    c = mix(c * vec3f(0.75, 0.9, 0.85), vec3f(0.12, 0.2, 0.18), d * 0.7);
  }
  return finish(c);
}

struct FlatOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vsFloor(@builtin(vertex_index) vi: u32) -> FlatOut {
  let q = QUAD[vi] * 0.9;
  var o: FlatOut;
  o.world = vec3f(q.x, u.floor.x, q.y);
  o.pos = u.viewProj * vec4f(o.world, 1.0);
  return o;
}

@fragment fn fsFloor(i: FlatOut) -> @location(0) vec4f {
  // A 1 cm grid, every fifth line darker (5 cm).
  let cm = i.world.xz * 100.0;
  let g = abs(fract(cm - 0.5) - 0.5) / fwidth(cm);
  let line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  let cm5 = cm / 5.0;
  let g5 = abs(fract(cm5 - 0.5) - 0.5) / fwidth(cm5);
  let line5 = 1.0 - clamp(min(g5.x, g5.y) * 0.7, 0.0, 1.0);
  var c = vec3f(0.62, 0.57, 0.48);
  c = mix(c, vec3f(0.36, 0.42, 0.33), line * 0.35);
  c = mix(c, vec3f(0.24, 0.32, 0.23), line5 * 0.5);
  // A soft shadow under the turtle.
  let r = length((i.world.xz - u.place.xz) / vec2f(0.07, 0.09) / u.misc.x);
  let lift = clamp((u.place.y - u.floor.x) / 0.15, 0.0, 1.0);
  c *= 1.0 - 0.45 * (1.0 - lift) * (1.0 - smoothstep(0.4, 1.1, r));
  let fade = 1.0 - smoothstep(0.6, 0.9, max(abs(i.world.x), abs(i.world.z)));
  var col = mix(vec3f(0.58, 0.55, 0.49), c, fade) * 1.2;
  if (u.misc.w > 0.5 && i.world.y < u.misc.z) { col = mix(col * vec3f(0.7, 0.85, 0.8), vec3f(0.12, 0.2, 0.18), 0.45); }
  return finish(col);
}

@vertex fn vsLedge(@builtin(vertex_index) vi: u32) -> FlatOut {
  // A box: six faces of two triangles, from the floor to the ledge's top.
  let face = vi / 6u;
  let q = QUAD[vi % 6u];
  var p: vec3f;
  switch face {
    case 0u: { p = vec3f(q.x, 1.0, -q.y); }
    case 1u: { p = vec3f(q.x, -1.0, q.y); }
    case 2u: { p = vec3f(q.x, q.y, 1.0); }
    case 3u: { p = vec3f(-q.x, q.y, -1.0); }
    case 4u: { p = vec3f(1.0, q.y, -q.x); }
    default: { p = vec3f(-1.0, q.y, q.x); }
  }
  let lo = u.floor.x; let hi = u.ledge.w;
  let world = vec3f(p.x * u.ledge.x, mix(lo, hi, p.y * 0.5 + 0.5), mix(u.ledge.y, u.ledge.z, p.z * 0.5 + 0.5));
  var o: FlatOut;
  o.world = world;
  o.pos = u.viewProj * vec4f(world, 1.0);
  return o;
}

@fragment fn fsLedge(i: FlatOut) -> @location(0) vec4f {
  let n = normalize(cross(dpdx(i.world), dpdy(i.world)));
  let nn = select(n, -n, dot(n, u.eye.xyz - i.world) < 0.0);
  let l = normalize(u.sun.xyz);
  let grain = fract(sin(dot(floor(i.world * 120.0), vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
  var c = vec3f(0.32, 0.3, 0.27) * (0.9 + 0.2 * grain) * (max(dot(nn, l), 0.0) * 2.2 + 0.5 + 0.3 * nn.y);
  if (u.misc.w > 0.5 && i.world.y < u.misc.z) { c = mix(c * vec3f(0.7, 0.85, 0.8), vec3f(0.12, 0.2, 0.18), 0.5); }
  return finish(c);
}

@vertex fn vsWater(@builtin(vertex_index) vi: u32) -> FlatOut {
  let q = QUAD[vi] * 0.9;
  var o: FlatOut;
  o.world = vec3f(q.x, u.misc.z, q.y);
  o.pos = u.viewProj * vec4f(o.world, 1.0);
  return o;
}

@fragment fn fsWater(i: FlatOut) -> @location(0) vec4f {
  let v = normalize(u.eye.xyz - i.world);
  let fres = 0.08 + 0.6 * pow(1.0 - max(v.y, 0.0), 4.0);
  var c = mix(vec3f(0.2, 0.36, 0.34), vec3f(0.75, 0.82, 0.85), fres);
  // A ring spreading where one plopped in.
  let d = length(i.world.xz - u.ring.xy);
  let band = exp(-pow((d - u.ring.z) / 0.012, 2.0)) * u.ring.w;
  c += vec3f(0.5) * band;
  let fade = 1.0 - smoothstep(0.6, 0.9, max(abs(i.world.x), abs(i.world.z)));
  return vec4f(pow(c / (1.0 + c), vec3f(1.0 / 2.2)), (0.5 + 0.3 * fres + band * 0.3) * fade);
}
`;

/** Set views: yaw from the turtle's left side round to its front, pitch up from level. */
export const VIEWS = {
  side: { yaw: Math.PI / 2, pitch: 0.16 },
  'three-quarter': { yaw: 0.85, pitch: 0.38 },
  front: { yaw: 0.05, pitch: 0.2 },
  top: { yaw: Math.PI / 2, pitch: 1.35 },
  // Close on the head (the turtle lab follows it): blinks, the yawn, the jaw.
  head: { yaw: 0.75, pitch: 0.22, close: true },
};

/** @param {HTMLCanvasElement} probe a canvas to start the device with @param {any} body the turtle recipe's body */
export async function createStage(probe, body) {
  const r = await initGpu(probe);
  if (!r.ok) return { ok: /** @type {const} */ (false), reason: r.reason };
  // The game shader's own shell plates (creature-draw.wgsl, between its shell heading and the fragment).
  const src = await fetch('../src/shaders/creature-draw.wgsl').then((x) => x.text());
  const shellCode = src.slice(src.indexOf('// ---- a turtle'), src.indexOf('@fragment'));
  return { ok: /** @type {const} */ (true), stage: makeStage(r.gpu, shellCode, body) };
}

/** @param {any} gpu @param {string} shellCode @param {any} turtleBody the turtle recipe's body */
function makeStage(gpu, shellCode, turtleBody) {
  const { device, format } = gpu;
  const module = device.createShaderModule({ label: 'turtle-lab', code: SHADER(shellCode) });
  const cdBuf = device.createBuffer({ size: 64 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cdData = new Float32Array(64);
  cdData.set(shellBlock(turtleBody), 12);
  device.queue.writeBuffer(cdBuf, 0, cdData);
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  const pipe = (/** @type {string} */ vs, /** @type {string} */ fs, /** @type {any} */ extra = {}) => device.createRenderPipeline({
    layout: pl, vertex: { module, entryPoint: vs, buffers: extra.buffers ?? [] },
    fragment: { module, entryPoint: fs, targets: [{ format, blend: extra.blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: extra.depth ?? depthStencil,
  });
  const body = pipe('vsBody', 'fsBody', { buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
    { shaderLocation: 4, offset: 40, format: 'unorm8x4' }] }] });
  const floor = pipe('vsFloor', 'fsFloor');
  const ledge = pipe('vsLedge', 'fsLedge');
  const water = pipe('vsWater', 'fsWater', {
    blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
    depth: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  });
  /** @type {{ v: GPUBuffer, i: GPUBuffer, n: number } | null} */ let mesh = null;

  /**
   * One view on a canvas of its own.
   * @param {HTMLCanvasElement} canvas
   */
  function view(canvas) {
    const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
    context.configure({ device, format, alphaMode: 'opaque' });
    const ubuf = device.createBuffer({ size: 44 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bbuf = device.createBuffer({ size: MAX_BONES * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: bbuf } }, { binding: 2, resource: { buffer: cdBuf } }] });
    const u = new Float32Array(44);
    /** @type {GPUTexture | null} */ let depth = null;
    return {
      /**
       * Draw it. @param {{ cam: { yaw: number, pitch: number, dist: number, target: number[] }, place: number[], scale: number, dry: number,
       *   water: number | null, floorY: number, ledge: number[] | null, ring: number[], bones: Float32Array, look: number[], baked?: boolean }} s
       *   look: wet darken, dry roughness share, dry sheen share
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
        u.set(mat4.multiply(mat4.perspective(0.55, w / h, 0.01, 6), mat4.lookAt(eye, t, [0, 1, 0])), 0);
        u.set([eye[0], eye[1], eye[2], s.baked ? 1 : 0], 16);
        u.set([0.45, 0.8, 0.55, 0], 20);
        u.set(s.place, 24);
        u.set([s.scale, s.dry, s.water ?? -9, s.water === null ? 0 : 1], 28);
        u.set(s.ledge ?? [0, 0, 0, 0], 32);
        u.set(s.ring, 36);
        u.set([s.floorY, s.look[0], s.look[1], s.look[2]], 40);
        device.queue.writeBuffer(ubuf, 0, u);
        device.queue.writeBuffer(bbuf, 0, s.bones);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0.93, g: 0.9, b: 0.84, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        pass.setBindGroup(0, group);
        pass.setPipeline(floor); pass.draw(6);
        if (s.ledge) { pass.setPipeline(ledge); pass.draw(36); }
        if (mesh) { pass.setPipeline(body); pass.setVertexBuffer(0, mesh.v); pass.setIndexBuffer(mesh.i, 'uint32'); pass.drawIndexed(mesh.n); }
        if (s.water !== null) { pass.setPipeline(water); pass.draw(6); }
        pass.end();
        device.queue.submit([enc.finish()]);
      },
    };
  }

  return {
    view,
    /** Show a baked mesh (packed vertices and indices from bakeVariant). @param {{ data: ArrayBuffer, indices: Uint32Array }} m */
    setMesh(m) {
      const v = device.createBuffer({ size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(v, 0, m.data);
      const i = device.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(i, 0, m.indices);
      mesh = { v, i, n: m.indices.length };
    },
  };
}
