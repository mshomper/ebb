// @ts-check
// The move effects' lights on the GPU (src/world/hollow/fx-layout.js; src/shaders/lib-fx-light.wgsl):
// one small uniform buffer the workbench stage owns and writes, bound by every pass drawn in its pass
// (the ground, props, figure and water, the Hollow's foes, the effects), so one write lights them all.

import { MAX_FX_LIGHTS, LIGHT_FLOATS } from '../../src/world/hollow/fx-layout.js';

/** The uniform's size: a count (vec4), then two vec4 a light. */
export const FX_LIGHT_BYTES = 16 + MAX_FX_LIGHTS * 32;

/**
 * Pack the engine's lights (LIGHT_FLOATS each) into the uniform's floats: those with a reach, in
 * order, up to MAX_FX_LIGHTS. @param {Float32Array | null | undefined} src
 * @param {number} [n] how many to read (else all of src) @param {Float32Array} [out]
 */
export function packFxLights(src, n, out = new Float32Array(FX_LIGHT_BYTES / 4)) {
  out.fill(0);
  let k = 0;
  const total = src ? Math.min(n ?? src.length / LIGHT_FLOATS, src.length / LIGHT_FLOATS) : 0;
  for (let i = 0; i < total && k < MAX_FX_LIGHTS && src; i++) {
    const o = i * LIGHT_FLOATS;
    if (!(src[o + 3] > 0)) continue;
    out.set(src.subarray(o, o + 4), 4 + k * 8);
    out.set(src.subarray(o + 4, o + 7), 8 + k * 8);
    k++;
  }
  out[0] = k;
  return out;
}

/**
 * The stage's light buffer, or a zeroed one of its own for a pass made without the stage's (no lights).
 * @param {{ device: GPUDevice, fxLights?: GPUBuffer }} gpu
 */
export function fxLightsOf(gpu) {
  return gpu.fxLights ?? gpu.device.createBuffer({ label: 'fx-lights-none', size: FX_LIGHT_BYTES, usage: GPUBufferUsage.UNIFORM });
}
