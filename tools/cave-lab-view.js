// @ts-check
// The cave lab's 3D views (H1): each floor's mesh in its own canvas, all on one WebGPU device, with
// an orbit (drag to turn, wheel to come closer) and a cut-away that takes the roof off above a
// height so you can look in from above. The rock cut open shows dark. Its own simple light: a lamp
// over the camera's shoulder and a soft sky, tinted by depth. No palette: this is a workbench.

import { mat4 } from 'wgpu-matrix';

const SHADER = /* wgsl */ `
struct U { viewProj: mat4x4f, eye: vec4f, tint: vec4f, cut: vec4f };
// eye: the camera; tint: the depth's rock colour; cut: x the roof cut height (m), y 1 to show floors lighter
@group(0) @binding(0) var<uniform> u: U;
struct O { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) w: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f) -> O {
  var o: O;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.n = n; o.w = p;
  return o;
}
@fragment fn fs(o: O, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (o.w.y > u.cut.x) { discard; }
  if (!front) { return vec4f(0.16, 0.15, 0.14, 1.0); }
  let n = normalize(o.n);
  // A fixed key light from high on one side, a softer fill from the other, and a little sky.
  let key = max(dot(n, normalize(vec3f(0.45, 0.8, 0.3))), 0.0) * 0.8;
  let fill = max(dot(n, normalize(vec3f(-0.5, 0.3, -0.6))), 0.0) * 0.22;
  let sky = 0.12 + 0.1 * n.y;
  var base = u.tint.rgb;
  if (n.y > 0.8 && u.cut.y > 0.5) { base = mix(base, vec3f(0.62, 0.56, 0.46), 0.5); }
  let c = base * (sky + key + fill);
  return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}`;

/** Depth tints (linear). */
const TINTS = { shelf: [0.36, 0.42, 0.36], drip: [0.55, 0.42, 0.3], silt: [0.3, 0.33, 0.36], glass: [0.34, 0.44, 0.62], sponge: [0.58, 0.5, 0.42] };

/** @type {Promise<{ device: GPUDevice, format: GPUTextureFormat, pipeline: GPURenderPipeline } | null> | null} */
let shared = null;

/** One device and pipeline for every view. */
async function gpu() {
  if (!shared) shared = (async () => {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({ code: SHADER });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    return { device, format, pipeline };
  })();
  return shared;
}

/**
 * A 3D view of one floor.
 * @param {HTMLCanvasElement} canvas
 * @param {{ vertices: Float32Array, indices: Uint32Array }} mesh
 * @param {{ min: number[], n: number[], cellM: number }} bounds
 * @param {string} tint depth id or 'sponge'
 * @returns {Promise<{ setCut: (y: number) => void, top: () => void, angled: () => void, low: () => void, cutRange: [number, number] } | null>}
 */
export async function createFloorView(canvas, mesh, bounds, tint) {
  const g = await gpu();
  if (!g) return null;
  const { device, format, pipeline } = g;
  const ctx = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const vb = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, mesh.vertices);
  const ib = device.createBuffer({ size: Math.max(4, mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ib, 0, mesh.indices);
  const ub = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
  /** @type {GPUTexture | null} */ let depth = null;

  const size = bounds.n.map((n) => (n - 1) * bounds.cellM);
  const centre = bounds.min.map((m, a) => m + size[a] / 2);
  const span = Math.max(size[0], size[2]);
  const cutRange = /** @type {[number, number]} */ ([bounds.min[1], bounds.min[1] + size[1]]);
  const cam = { yaw: 0.7, pitch: 0.9, dist: span * 1.05, cut: cutRange[1] };
  const t = /** @type {number[]} */ (/** @type {any} */ (TINTS)[tint] ?? TINTS.shelf);

  let queued = false;
  const draw = () => {
    queued = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h || !depth) {
      canvas.width = w; canvas.height = h;
      depth?.destroy();
      depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    const eye = [centre[0] + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist, centre[1] + Math.sin(cam.pitch) * cam.dist, centre[2] + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist];
    const view = mat4.lookAt(eye, centre, Math.abs(Math.cos(cam.pitch)) < 1e-3 ? [Math.cos(cam.yaw + Math.PI), 0, Math.sin(cam.yaw + Math.PI)] : [0, 1, 0]);
    const proj = mat4.perspective(0.75, w / h, 0.5, span * 6);
    const u = new Float32Array(28);
    u.set(mat4.multiply(proj, view), 0);
    u.set([eye[0], eye[1], eye[2], 1], 16);
    u.set([t[0], t[1], t[2], 1], 20);
    u.set([cam.cut, 1, 0, 0], 24);
    device.queue.writeBuffer(ub, 0, u);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0.93, g: 0.9, b: 0.85, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, vb);
    pass.setIndexBuffer(ib, 'uint32');
    pass.drawIndexed(mesh.indices.length);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };

  let drag = /** @type {{ x: number, y: number } | null} */ (null);
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw += (e.clientX - drag.x) * 0.008;
    cam.pitch = Math.max(0.05, Math.min(Math.PI / 2, cam.pitch + (e.clientY - drag.y) * 0.008));
    drag = { x: e.clientX, y: e.clientY };
    redraw();
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(span * 0.2, Math.min(span * 3, cam.dist * Math.exp(e.deltaY * 0.001))); redraw(); }, { passive: false });
  new ResizeObserver(redraw).observe(canvas);
  redraw();
  return {
    setCut(y) { cam.cut = y; redraw(); },
    // Straight down, turned to match the maps (x to the right, z down the page).
    top() { cam.pitch = Math.PI / 2; cam.yaw = Math.PI / 2; cam.dist = span * 1.05; redraw(); },
    angled() { cam.pitch = 0.85; cam.yaw = 0.7; cam.dist = span * 1.0; redraw(); },
    low() { cam.pitch = 0.3; cam.dist = span * 0.55; redraw(); },
    cutRange,
  };
}
