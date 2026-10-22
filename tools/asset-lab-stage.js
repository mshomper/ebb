// @ts-check
// The asset lab's stage: one WebGPU device drawing two canvases (the original and the web copy) with
// the same camera and light. Each model is shaded with a simple physically based model: color map
// (sRGB), roughness and metal map (G, B), a tangent-space normal map on a frame built per pixel from
// screen derivatives, Lambert plus GGX from the sun, a hemisphere sky, then a filmic curve and sRGB.
// A plain ground disc carries a soft blob shadow, an orange arrow along +Z (the front) and a thin blue
// line along +X. A workbench light, not the game's palette.

import { mat4 } from 'wgpu-matrix';

const SHADER = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  eye: vec4f,     // xyz camera, w exposure
  sunDir: vec4f,  // toward the sun
  sun: vec4f,     // sun irradiance (rgb)
  sky: vec4f,     // sky ambient (rgb)
  bounce: vec4f,  // ground ambient (rgb)
  bg: vec4f,      // rgb background (display), w disc radius
  shadow: vec4f,  // xy center (x, z), zw radii
  arrow: vec4f,   // x start z, y length, z half width, w head half width
};
struct M { base: vec4f, pbr: vec4f };  // pbr: x metal, y rough, z normal scale, w has a normal map
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var<uniform> m: M;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var baseTex: texture_2d<f32>;
@group(1) @binding(3) var mrTex: texture_2d<f32>;
@group(1) @binding(4) var nTex: texture_2d<f32>;

const PI = 3.14159265;

fn toSrgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
fn finish(c: vec3f) -> vec3f {
  let x = c * u.eye.w;
  return toSrgb(clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)));
}
fn hemi(d: vec3f) -> vec3f { return mix(u.bounce.rgb, u.sky.rgb, clamp(d.y * 0.5 + 0.5, 0.0, 1.0)); }
// Karis's fit of the split-sum specular term, for the sky's share of the shine.
fn envBrdf(f0: vec3f, rough: f32, nv: f32) -> vec3f {
  let r = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a + r.zw;
  return f0 * ab.x + ab.y;
}

struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f };

@vertex fn vsModel(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.n = n;
  o.uv = uv;
  return o;
}

@fragment fn fsModel(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let base = textureSample(baseTex, samp, i.uv) * m.base;
  let mr = textureSample(mrTex, samp, i.uv);
  let nt = textureSample(nTex, samp, i.uv).xyz * 2.0 - 1.0;
  let dp1 = dpdx(i.world); let dp2 = dpdy(i.world);
  let du1 = dpdx(i.uv); let du2 = dpdy(i.uv);
  var ng = normalize(i.n);
  if (!front) { ng = -ng; }
  // The surface's own u and v directions from how position and UV change across the pixel.
  let det = du1.x * du2.y - du1.y * du2.x;
  let sgn = select(-1.0, 1.0, det >= 0.0);
  let tu = (dp1 * du2.y - dp2 * du1.y) * sgn;   // along +u
  let tv = (dp2 * du1.x - dp1 * du2.x) * sgn;   // along +v (down the image in glTF)
  var t = tu - ng * dot(ng, tu);
  var n = ng;
  if (dot(t, t) > 1e-20 && m.pbr.w > 0.5) {
    t = normalize(t);
    // Green points up the image (against +v); mirrored UVs flip it.
    let c = cross(ng, t);
    let b = c * select(1.0, -1.0, dot(c, tv) > 0.0);
    n = normalize(t * nt.x * m.pbr.z + b * nt.y * m.pbr.z + ng * max(nt.z, 0.0));
  }
  let v = normalize(u.eye.xyz - i.world);
  let l = normalize(u.sunDir.xyz);
  let h = normalize(v + l);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let rough = clamp(mr.g * m.pbr.y, 0.045, 1.0);
  let metal = clamp(mr.b * m.pbr.x, 0.0, 1.0);
  let a2 = rough * rough * rough * rough;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  let f0 = mix(vec3f(0.04), base.rgb, metal);
  let F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  let spec = D * G * F / max(4.0 * nl * nv, 1e-4);
  let diff = base.rgb * (1.0 - metal);
  let lit = smoothstep(-0.05, 0.1, dot(ng, l));  // the mesh's own side away from the sun stays dark
  var c = ((1.0 - F) * diff / PI + spec) * u.sun.rgb * nl * lit;
  c += diff * hemi(n) + envBrdf(f0, rough, nv) * hemi(reflect(-v, n));
  return vec4f(finish(c), 1.0);
}

struct GOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

@vertex fn vsGround(@builtin(vertex_index) vi: u32) -> GOut {
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  var o: GOut;
  o.world = vec3f(q.x * u.bg.w, 0.0, q.y * u.bg.w);
  o.pos = u.viewProj * vec4f(o.world, 1.0);
  return o;
}

@fragment fn fsGround(i: GOut) -> @location(0) vec4f {
  let p = i.world.xz;
  let e = max(fwidth(p.x), fwidth(p.y)) * 0.75;
  let r = length(p) / u.bg.w;
  // Soft blob shadow, nudged away from the sun.
  let q = (p - u.shadow.xy) / u.shadow.zw;
  let sh = 1.0 - 0.65 * (1.0 - smoothstep(0.45, 1.25, length(q)));
  // Arrow along +Z in front of the model: a shaft and a head.
  let az = p.y - u.arrow.x;
  let L = u.arrow.y; let H = u.arrow.w * 1.4;
  let shaft = max(abs(p.x) - u.arrow.z, max(-az, az - (L - H)));
  let head = max(max((L - H) - az, az - L), (abs(p.x) - u.arrow.w * (L - az) / H) * 0.8);
  let arrow = 1.0 - smoothstep(-e, e, min(shaft, head));
  // A thin line along +X, as long as the arrow, from the arrow's start distance.
  let xl = max(abs(p.y) - u.arrow.z * 0.45, max(u.arrow.x - p.x, p.x - (u.arrow.x + L * 0.7)));
  let xline = 1.0 - smoothstep(-e, e, xl);
  var albedo = vec3f(0.36, 0.31, 0.24);
  albedo = mix(albedo, vec3f(0.55, 0.13, 0.05), arrow);
  albedo = mix(albedo, vec3f(0.08, 0.22, 0.5), xline);
  let l = normalize(u.sunDir.xyz);
  let c = albedo * (u.sun.rgb * max(l.y, 0.0) / PI * sh + u.sky.rgb * mix(0.6, 1.0, sh));
  var o = finish(c);
  o = mix(o, u.bg.rgb, smoothstep(0.82, 1.0, r));
  if (r > 1.0) { discard; }
  return vec4f(o, 1.0);
}
`;

/** Light presets: sun direction (toward the sun), sun and sky in linear light, exposure, background. */
export const LIGHTS = {
  day: { sunDir: [-0.45, 0.78, 0.55], sun: [1.0, 0.95, 0.88], sunE: 7.5, sky: [0.5, 0.6, 0.75], skyE: 0.75, bounce: [0.33, 0.28, 0.22], bounceE: 0.35, exposure: 0.85, bg: [0.86, 0.89, 0.88] },
  dusk: { sunDir: [0.75, 0.13, 0.62], sun: [1.0, 0.52, 0.26], sunE: 5.0, sky: [0.3, 0.32, 0.55], skyE: 0.35, bounce: [0.25, 0.17, 0.13], bounceE: 0.15, exposure: 1.15, bg: [0.25, 0.24, 0.33] },
};

const SAMPLES = 4;

/**
 * @param {HTMLCanvasElement[]} canvases   [original, copy]
 * @returns {Promise<{ ok: false, reason: string } | { ok: true, stage: ReturnType<typeof makeStage> }>}
 */
export async function createStage(canvases) {
  if (!('gpu' in navigator)) return { ok: false, reason: 'This browser has no WebGPU. Open the page in Chrome or Edge.' };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { ok: false, reason: 'No graphics adapter was found for WebGPU.' };
  const device = await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: Math.min(8192, adapter.limits.maxTextureDimension2D) } });
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', /** @type {GPUUncapturedErrorEvent} */ (e).error.message));
  return { ok: true, stage: makeStage(device, canvases) };
}

/** @param {GPUDevice} device @param {HTMLCanvasElement[]} canvases */
function makeStage(device, canvases) {
  const format = navigator.gpu.getPreferredCanvasFormat();
  const module = device.createShaderModule({ label: 'asset-lab', code: SHADER });
  module.getCompilationInfo().then((info) => { for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`[asset-lab wgsl] ${m.lineNum}:${m.linePos} ${m.message}`); });
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const g0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | F, buffer: {} }] });
  const g1 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: F, buffer: {} },
    { binding: 1, visibility: F, sampler: {} },
    { binding: 2, visibility: F, texture: {} },
    { binding: 3, visibility: F, texture: {} },
    { binding: 4, visibility: F, texture: {} },
  ] });
  const depthStencil = /** @type {GPUDepthStencilState} */ ({ format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
  const multisample = { count: SAMPLES };
  const modelPipe = device.createRenderPipeline({
    label: 'asset-lab model', layout: device.createPipelineLayout({ bindGroupLayouts: [g0, g1] }),
    vertex: { module, entryPoint: 'vsModel', buffers: [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
    ] },
    fragment: { module, entryPoint: 'fsModel', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil, multisample,
  });
  const groundPipe = device.createRenderPipeline({
    label: 'asset-lab ground', layout: device.createPipelineLayout({ bindGroupLayouts: [g0] }),
    vertex: { module, entryPoint: 'vsGround' },
    fragment: { module, entryPoint: 'fsGround', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }, depthStencil, multisample,
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });

  /** A 1 x 1 texture for a missing map. @param {number[]} rgba @param {boolean} srgb */
  const plain = (rgba, srgb) => {
    const t = device.createTexture({ size: [1, 1], format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
    return t;
  };
  const fallback = { baseColor: plain([255, 255, 255, 255], true), metallicRoughness: plain([255, 255, 255, 255], false), normal: plain([128, 128, 255, 255], false) };

  const views = canvases.map((canvas, k) => {
    const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
    context.configure({ device, format, alphaMode: 'opaque' });
    const ubuf = device.createBuffer({ label: `asset-lab u${k}`, size: 16 * 4 + 8 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return {
      canvas, context, ubuf, bind: device.createBindGroup({ layout: g0, entries: [{ binding: 0, resource: { buffer: ubuf } }] }),
      /** @type {GPUTexture | null} */ depth: null, /** @type {GPUTexture | null} */ color: null,
      /** @type {null | { buffers: GPUBuffer[], textures: GPUTexture[], bind: GPUBindGroup, count: number }} */ model: null,
    };
  });

  const cam = { yaw: 0.6, pitch: 0.35, zoom: 1, target: [0, 0.3, 0], radius: 1, footprint: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } };
  let light = LIGHTS.day;

  /** Upload a map with a full mip chain, each level drawn down from the one above. @param {ImageBitmap} bitmap @param {boolean} srgb */
  async function uploadMap(bitmap, srgb) {
    const w = bitmap.width, h = bitmap.height;
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    const tex = device.createTexture({
      label: 'asset-lab map', size: [w, h], format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex, mipLevel: 0 }, [w, h]);
    let prev = bitmap;
    for (let l = 1; l < levels; l++) {
      const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l);
      const next = await createImageBitmap(prev, { resizeWidth: lw, resizeHeight: lh, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      if (prev !== bitmap) prev.close();
      device.queue.copyExternalImageToTexture({ source: next }, { texture: tex, mipLevel: l }, [lw, lh]);
      prev = next;
    }
    if (prev !== bitmap) prev.close();
    return tex;
  }

  /**
   * Put a model on one side (0 original, 1 copy), or clear it (null). Frees what was there.
   * @param {number} side
   * @param {null | { mesh: import('./asset-lab-model.js').Placed, bitmaps: Record<string, ImageBitmap | null> }} data
   */
  async function setModel(side, data) {
    const view = views[side];
    if (view.model) {
      for (const b of view.model.buffers) b.destroy();
      for (const t of view.model.textures) t.destroy();
      view.model = null;
    }
    if (!data) return;
    const { mesh, bitmaps } = data;
    /** @param {ArrayBufferView} arr @param {number} usage */
    const buf = (arr, usage) => {
      const b = device.createBuffer({ size: Math.ceil(arr.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b, 0, /** @type {any} */ (arr));
      return b;
    };
    const textures = [];
    /** @type {Record<string, GPUTexture>} */ const tex = {};
    for (const [key, srgb] of /** @type {[string, boolean][]} */ ([['baseColor', true], ['metallicRoughness', false], ['normal', false]])) {
      const bm = bitmaps[key];
      if (bm) { tex[key] = await uploadMap(bm, srgb); textures.push(tex[key]); }
      else tex[key] = /** @type {any} */ (fallback)[key];
    }
    const f = mesh.factors;
    const mbuf = buf(new Float32Array([...f.base, f.metal, f.rough, f.normalScale, bitmaps.normal ? 1 : 0]), GPUBufferUsage.UNIFORM);
    const buffers = [buf(mesh.positions, GPUBufferUsage.VERTEX), buf(mesh.normals, GPUBufferUsage.VERTEX), buf(mesh.uvs, GPUBufferUsage.VERTEX), buf(mesh.indices, GPUBufferUsage.INDEX), mbuf];
    const bind = device.createBindGroup({ layout: g1, entries: [
      { binding: 0, resource: { buffer: mbuf } }, { binding: 1, resource: sampler },
      { binding: 2, resource: tex.baseColor.createView() }, { binding: 3, resource: tex.metallicRoughness.createView() }, { binding: 4, resource: tex.normal.createView() },
    ] });
    if (view.model) { for (const b of buffers) b.destroy(); for (const t of textures) t.destroy(); return; }
    view.model = { buffers, textures, bind, count: mesh.indices.length };
  }

  /** Frame both views on these bounds (the copy's). @param {{ min: number[], max: number[] }} b */
  function frameOn(b) {
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    cam.radius = 0.5 * Math.hypot(...size);
    cam.target = [(b.min[0] + b.max[0]) / 2, b.max[1] * 0.42, (b.min[2] + b.max[2]) / 2];
    cam.footprint = b;
    cam.zoom = 1;
  }

  /** Draw both views. */
  function draw() {
    const fov = 35 * Math.PI / 180;
    const fp = cam.footprint;
    const half = [(fp.max[0] - fp.min[0]) / 2, (fp.max[2] - fp.min[2]) / 2];
    const big = Math.max(half[0], half[1], (fp.max[1] - fp.min[1]) / 2);
    const aStart = fp.max[2] + big * 0.12 + 0.02, aLen = Math.max(0.12, big * 0.7);
    const discR = Math.max(cam.radius * 2.0, aStart + aLen + big * 0.4);
    const L = light;
    const sd = L.sunDir, sl = Math.hypot(sd[0], sd[1], sd[2]);
    const sx = sd[0] / sl, sy = sd[1] / sl, sz = sd[2] / sl;
    const lift = (fp.max[1] - fp.min[1]) * 0.3 / Math.max(sy, 0.35);
    const encoder = device.createCommandEncoder();
    for (const view of views) {
      const { canvas } = view;
      if (!view.model || canvas.clientWidth === 0) continue;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h || !view.depth) {
        canvas.width = w; canvas.height = h;
        view.depth?.destroy(); view.color?.destroy();
        view.depth = device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        view.color = device.createTexture({ size: [w, h], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      const aspect = w / h;
      const fit = Math.min(1, aspect);  // narrow views back off so the model still fits across
      const dist = cam.radius / Math.sin(fov / 2) * 1.08 / fit * cam.zoom;
      const cp = Math.cos(cam.pitch);
      const eye = [cam.target[0] + dist * Math.sin(cam.yaw) * cp, cam.target[1] + dist * Math.sin(cam.pitch), cam.target[2] + dist * Math.cos(cam.yaw) * cp];
      const proj = mat4.perspective(fov, aspect, dist * 0.02, dist * 20);
      const vp = mat4.multiply(proj, mat4.lookAt(eye, cam.target, [0, 1, 0]));
      const u = new Float32Array(16 + 8 * 4);
      u.set(vp, 0);
      u.set([...eye, L.exposure], 16);
      u.set([sx, sy, sz, 0], 20);
      u.set([...L.sun.map((c) => c * L.sunE), 0], 24);
      u.set([...L.sky.map((c) => c * L.skyE), 0], 28);
      u.set([...L.bounce.map((c) => c * L.bounceE), 0], 32);
      u.set([...L.bg, discR], 36);
      u.set([(fp.min[0] + fp.max[0]) / 2 - sx * lift, (fp.min[2] + fp.max[2]) / 2 - sz * lift, half[0] * 1.05 + 0.03, half[1] * 1.05 + 0.03], 40);
      u.set([aStart, aLen, Math.max(0.006, big * 0.035), Math.max(0.018, big * 0.11)], 44);
      device.queue.writeBuffer(view.ubuf, 0, u);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: /** @type {GPUTexture} */ (view.color).createView(), resolveTarget: view.context.getCurrentTexture().createView(),
          clearValue: { r: L.bg[0], g: L.bg[1], b: L.bg[2], a: 1 }, loadOp: 'clear', storeOp: 'discard' }],
        depthStencilAttachment: { view: view.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setBindGroup(0, view.bind);
      pass.setPipeline(groundPipe);
      pass.draw(6);
      pass.setPipeline(modelPipe);
      pass.setBindGroup(1, view.model.bind);
      const [p, n, t, i] = view.model.buffers;
      pass.setVertexBuffer(0, p); pass.setVertexBuffer(1, n); pass.setVertexBuffer(2, t);
      pass.setIndexBuffer(i, 'uint32');
      pass.drawIndexed(view.model.count);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  }

  return {
    cam, setModel, frameOn, draw,
    /** @param {'day' | 'dusk'} name */ setLight(name) { light = LIGHTS[name]; },
    /** @param {number} side */ hasModel(side) { return !!views[side].model; },
  };
}
