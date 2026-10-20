// @ts-check
// Group 1 for every lit pipeline (docs/04, 06): the LightUniforms buffer, the atmosphere's
// transmittance and aerial-perspective LUTs, the sky SH, and the shadow map. Mirrors
// src/shaders/lighting-bindings.wgsl and LightUniforms in src/shaders/common.wgsl.

import { makeBuffer } from '../core/gpu.js';

export const LIGHT_UNIFORM_BYTES = 272;

/** @param {GPUDevice} device */
export function createLightingLayout(device) {
  const all = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
  const fc = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
  return device.createBindGroupLayout({
    label: 'group1-lighting',
    entries: [
      { binding: 0, visibility: all, buffer: {} },
      { binding: 1, visibility: fc, texture: { sampleType: 'float' } },
      { binding: 2, visibility: fc, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: fc, sampler: { type: 'filtering' } },
      { binding: 4, visibility: fc, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });
}

/**
 * @param {GPUDevice} device
 * @param {{ transmittance: GPUTexture, aerial: GPUTexture, sh: GPUBuffer }} atmosphere
 * @param {{ view: GPUTextureView, sampler: GPUSampler }} shadow
 */
export function createLighting(device, atmosphere, shadow) {
  const layout = createLightingLayout(device);
  const buffer = makeBuffer(device, { label: 'light-uniforms', size: LIGHT_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const lutSampler = device.createSampler({ label: 'lut-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  /** @param {{ view: GPUTextureView, sampler: GPUSampler }} s */
  const makeGroup = (s) => device.createBindGroup({
    label: 'group1-lighting',
    layout,
    entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: atmosphere.transmittance.createView() },
      { binding: 2, resource: atmosphere.aerial.createView({ dimension: '3d' }) },
      { binding: 3, resource: lutSampler },
      { binding: 4, resource: { buffer: atmosphere.sh } },
      { binding: 5, resource: s.view },
      { binding: 6, resource: s.sampler },
    ],
  });
  let group = makeGroup(shadow);
  const data = new Float32Array(LIGHT_UNIFORM_BYTES / 4);

  /**
   * @param {{ shadow: import('./passes/shadow.js').ShadowPass['state'],
   *   weather: { cloud: number, rain: number, mist: number, wet: number },
   *   aerial: { maxDistance: number, slices: number } }} v
   */
  function write(v) {
    for (let c = 0; c < 3; c++) data.set(v.shadow.viewProj[c], c * 16);
    data[48] = v.shadow.splits[0]; data[49] = v.shadow.splits[1]; data[50] = v.shadow.splits[2]; data[51] = v.shadow.count;
    data[52] = v.shadow.dir[0]; data[53] = v.shadow.dir[1]; data[54] = v.shadow.dir[2]; data[55] = v.shadow.strength;
    data[56] = v.shadow.texel[0]; data[57] = v.shadow.texel[1]; data[58] = v.shadow.texel[2]; data[59] = v.shadow.taps;
    data[60] = v.weather.cloud; data[61] = v.weather.rain; data[62] = v.weather.mist; data[63] = v.weather.wet;
    data[64] = v.aerial.maxDistance; data[65] = v.aerial.slices; data[66] = v.shadow.cliffOffset ?? 0; data[67] = 0;
    device.queue.writeBuffer(buffer, 0, data);
  }

  return {
    layout, write,
    /** The bind group; the frame graph reads it each frame, so a new shadow map takes effect at once. */
    get group() { return group; },
    /** A new shadow map (a quality tier with another map size, S8d-1). @param {{ view: GPUTextureView, sampler: GPUSampler }} s */
    setShadow(s) { group = makeGroup(s); },
  };
}

/** @typedef {ReturnType<typeof createLighting>} Lighting */
