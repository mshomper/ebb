// @ts-check
// The move effects' lights on the GPU (src/world/hollow/fx-layout.js; src/shaders/lib-fx-light.wgsl):
// one small uniform buffer the workbench stage owns and writes, bound by every pass drawn in its pass
// (the ground, props, figure and water, the Hollow's foes, the effects), so one write lights them all.
// With the lights go the capsules a shadow-casting light is blocked by (the cinematic pass, November
// 3, 2026): the walker, the things and the pillars, and how soft the shadows' edges are.

import { MAX_FX_LIGHTS, LIGHT_FLOATS } from '../../src/world/hollow/fx-layout.js';

/** Most capsules that cast shadows. */
export const MAX_FX_OCCLUDERS = 12;
/** The uniform's size: a count (vec4), two vec4 a light, a vec4 a capsule, then the capsules' tops four to a vec4. */
export const FX_LIGHT_BYTES = 16 + MAX_FX_LIGHTS * 32 + MAX_FX_OCCLUDERS * 16 + (MAX_FX_OCCLUDERS / 4) * 16;

/** @typedef {{ x: number, z: number, r: number, y0: number, y1: number }} FxOccluder an upright capsule (m) */

/**
 * Pack the engine's lights (LIGHT_FLOATS each) into the uniform's floats: those with a reach, in
 * order, up to MAX_FX_LIGHTS, each with its shadow flag; then the capsules, up to MAX_FX_OCCLUDERS.
 * @param {Float32Array | null | undefined} src
 * @param {number} [n] how many to read (else all of src) @param {Float32Array} [out]
 * @param {{ list: FxOccluder[], softM: number } | null} [occ] the shadows' capsules
 */
export function packFxLights(src, n, out = new Float32Array(FX_LIGHT_BYTES / 4), occ = null) {
  out.fill(0);
  let k = 0;
  const total = src ? Math.min(n ?? src.length / LIGHT_FLOATS, src.length / LIGHT_FLOATS) : 0;
  for (let i = 0; i < total && k < MAX_FX_LIGHTS && src; i++) {
    const o = i * LIGHT_FLOATS;
    if (!(src[o + 3] > 0)) continue;
    out.set(src.subarray(o, o + 4), 4 + k * 8);
    out.set(src.subarray(o + 4, o + 8), 8 + k * 8);
    k++;
  }
  out[0] = k;
  const base = 4 + MAX_FX_LIGHTS * 8, tops = base + MAX_FX_OCCLUDERS * 4;
  const list = occ ? occ.list.slice(0, MAX_FX_OCCLUDERS) : [];
  list.forEach((c, i) => { out.set([c.x, c.z, c.r, c.y0], base + i * 4); out[tops + i] = c.y1; });
  out[1] = list.length;
  out[2] = occ?.softM ?? 0.35;
  return out;
}

/**
 * The stage's light buffer, or a zeroed one of its own for a pass made without the stage's (no lights).
 * @param {{ device: GPUDevice, fxLights?: GPUBuffer }} gpu
 */
export function fxLightsOf(gpu) {
  return gpu.fxLights ?? gpu.device.createBuffer({ label: 'fx-lights-none', size: FX_LIGHT_BYTES, usage: GPUBufferUsage.UNIFORM });
}
