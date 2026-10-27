// @ts-check
// A small view of its own for the Walker page's portrait (K3): the walker's figure, skinned, and the
// carrier worn, drawn into the page's canvas with the game's GPU device (portrait-draw.wgsl). It
// draws only when asked (the page asks each animation frame while it is open), at the canvas's size
// (a few hundred pixels), four samples a pixel. Nothing here touches the island's frame.

import { mat4 } from 'wgpu-matrix';
import { makeShaderModule, makeBuffer } from '../core/gpu.js';
import { VERTEX_BYTES } from '../world/creatures/bodies.js';
import { mapTexture } from './passes/props.js';
import { materialMaps } from './gltf.js';

/** The figure's bones, then one for the carrier. */
export const PORTRAIT_BONES = 21;
const UNIFORM_FLOATS = 16 + 4 * 4 + 20;

/**
 * @param {{ device: GPUDevice, canvas: HTMLCanvasElement }} o
 */
export async function createPortraitRenderer(o) {
  const { device, canvas } = o;
  const ctx = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  const module = await makeShaderModule(device, 'portrait-draw');
  const layout = device.createBindGroupLayout({ label: 'portrait', entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ] });
  const pipe = await device.createRenderPipelineAsync({
    label: 'portrait', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vsMain', buffers: [{ arrayStride: VERTEX_BYTES, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'uint8x4' },
      { shaderLocation: 4, offset: 40, format: 'unorm8x4' }] }] },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: 4 },
  });
  const ubuf = makeBuffer(device, { label: 'portrait-uniforms', size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bbuf = makeBuffer(device, { label: 'portrait-bones', size: PORTRAIT_BONES * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const plain = (/** @type {number[]} */ c, /** @type {GPUTextureFormat} */ f, /** @type {string} */ label) => mapTexture(device, null, f, c, label);
  let figureMap = await plain([128, 128, 128, 255], 'rgba8unorm-srgb', 'portrait-figure');
  let figureNormal = await plain([128, 255, 128, 255], 'rgba8unorm', 'portrait-normal');
  let propMap = await plain([180, 160, 120, 255], 'rgba8unorm-srgb', 'portrait-prop');
  /** @type {GPUBindGroup} */ let group;
  const bind = () => { group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: bbuf } },
    { binding: 2, resource: figureMap.createView() }, { binding: 3, resource: figureNormal.createView() },
    { binding: 4, resource: propMap.createView() }, { binding: 5, resource: sampler }] }); };
  bind();
  /** @type {Map<string, { vbuf: GPUBuffer, ibuf: GPUBuffer, count: number }>} */ const meshes = new Map();
  /** @type {GPUTexture | null} */ let msaa = null, depth = null;
  const uniforms = new Float32Array(UNIFORM_FLOATS);

  /** @param {string} key @param {{ data: ArrayBuffer, indices: Uint32Array }} m */
  function setMesh(key, m) {
    const old = meshes.get(key);
    old?.vbuf.destroy(); old?.ibuf.destroy();
    const vbuf = makeBuffer(device, { label: `portrait-${key}-v`, size: m.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, m.data);
    const ibuf = makeBuffer(device, { label: `portrait-${key}-i`, size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibuf, 0, m.indices);
    meshes.set(key, { vbuf, ibuf, count: m.indices.length });
  }

  return {
    setMesh,
    /** The figure's colour and normal maps from its model. @param {import('./gltf.js').Glb} glb */
    async setFigureMaps(glb) {
      const m = materialMaps(glb);
      const [c, n] = await Promise.all([mapTexture(device, m.baseColor, 'rgba8unorm-srgb', [128, 128, 128, 255], 'portrait-figure'),
        mapTexture(device, m.normal, 'rgba8unorm', [128, 255, 128, 255], 'portrait-normal')]);
      figureMap.destroy(); figureNormal.destroy();
      figureMap = c; figureNormal = n;
      bind();
    },
    /** The carrier's colour map from its model. @param {import('./gltf.js').Glb} glb */
    async setPropMap(glb) {
      const t = await mapTexture(device, materialMaps(glb).baseColor, 'rgba8unorm-srgb', [180, 160, 120, 255], 'portrait-prop');
      propMap.destroy();
      propMap = t;
      bind();
    },
    /**
     * Draw one frame. @param {{ bones: Float32Array, draw: string[], yaw: number, R: any, eyes: Float32Array, scale: number }} f
     *   bones: PORTRAIT_BONES matrices (body m); draw: the meshes to draw; yaw: the turn (radians); R: kit.json portrait;
     *   eyes: the figure's eye uniforms (20 floats); scale: the figure's display scale
     */
    draw(f) {
      const w = canvas.width, h = canvas.height;
      if (w < 2 || h < 2) return;
      if (!msaa || msaa.width !== w || msaa.height !== h) {
        msaa?.destroy(); depth?.destroy();
        msaa = device.createTexture({ size: [w, h], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        depth = device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      const C = f.R.camera, L = f.R.light, k = 1 / Math.max(0.01, f.scale);
      // The camera orbits the figure as it turns (body meters: the recipe's world meters over the display scale).
      const d = C.distanceM * k, eye = [Math.sin(f.yaw) * d, C.heightM * k, Math.cos(f.yaw) * d];
      const view = mat4.lookAt(eye, [0, C.aimM * k, 0], [0, 1, 0]);
      const proj = mat4.perspective(C.fovDeg * Math.PI / 180, w / h, 0.05, 50);
      uniforms.set(mat4.multiply(proj, view), 0);
      // The light turns with the camera, so the walker is always lit from the viewer's side.
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw), [lx, ly, lz] = L.dir;
      uniforms.set([eye[0], eye[1], eye[2], 1, c * lx + s * lz, ly, -s * lx + c * lz, L.lux, ...L.rgb, L.rim, ...L.sky, f.R.exposure], 16);
      uniforms.set(f.eyes, 32);
      device.queue.writeBuffer(ubuf, 0, uniforms);
      device.queue.writeBuffer(bbuf, 0, f.bones);
      const enc = device.createCommandEncoder({ label: 'portrait' });
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: msaa.createView(), resolveTarget: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'discard' }],
        depthStencilAttachment: { view: /** @type {GPUTexture} */ (depth).createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' },
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      for (const key of f.draw) {
        const m = meshes.get(key);
        if (!m) continue;
        pass.setVertexBuffer(0, m.vbuf);
        pass.setIndexBuffer(m.ibuf, 'uint32');
        pass.drawIndexed(m.count);
      }
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    /** Let go of the GPU memory (the page is gone). */
    dispose() {
      for (const m of meshes.values()) { m.vbuf.destroy(); m.ibuf.destroy(); }
      meshes.clear();
      msaa?.destroy(); depth?.destroy(); ubuf.destroy(); bbuf.destroy();
      figureMap.destroy(); figureNormal.destroy(); propMap.destroy();
      ctx.unconfigure();
    },
  };
}
