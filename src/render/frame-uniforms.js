// @ts-check
// CPU mirror of FrameUniforms in src/shaders/common.wgsl. Offsets are in floats.

export const FRAME_UNIFORM_BYTES = 448;

const O = {
  view: 0, proj: 16, viewProj: 32, invViewProj: 48, prevViewProj: 64,
  cameraPos: 80, near: 83,
  renderSize: 84, invRenderSize: 86,
  animTime: 88, displayHours: 89, dayFrac: 90, yearFrac: 91,
  seasonPhase: 92, moonPhase: 93, exposure: 94, ev100: 95,
  sunDir: 96, tierFlags: 99,
  sunIlluminance: 100, frameIndex: 103,
  moonDir: 104, moonIlluminance: 108,
};

/**
 * @typedef {Object} FrameUniformValues
 * @property {Float32Array} view
 * @property {Float32Array} proj
 * @property {Float32Array} viewProj
 * @property {Float32Array} invViewProj
 * @property {Float32Array} prevViewProj
 * @property {ArrayLike<number>} cameraPos
 * @property {number} near
 * @property {[number, number]} renderSize
 * @property {number} animTime
 * @property {number} displayHours
 * @property {number} dayFrac
 * @property {number} yearFrac
 * @property {number} seasonPhase
 * @property {number} moonPhase
 * @property {number} ev100
 * @property {ArrayLike<number>} sunDir
 * @property {ArrayLike<number>} sunIlluminance
 * @property {ArrayLike<number>} moonDir
 * @property {ArrayLike<number>} moonIlluminance
 * @property {number} tierFlags
 * @property {number} frameIndex
 */

/** Packs FrameUniforms into one reusable buffer. */
export function createFrameUniformWriter() {
  const data = new ArrayBuffer(FRAME_UNIFORM_BYTES);
  const f = new Float32Array(data);
  const u = new Uint32Array(data);

  /** @param {FrameUniformValues} v @returns {ArrayBuffer} */
  function pack(v) {
    f.set(v.view, O.view);
    f.set(v.proj, O.proj);
    f.set(v.viewProj, O.viewProj);
    f.set(v.invViewProj, O.invViewProj);
    f.set(v.prevViewProj, O.prevViewProj);
    f.set(Array.from(v.cameraPos).slice(0, 3), O.cameraPos);
    f[O.near] = v.near;
    f[O.renderSize] = v.renderSize[0];
    f[O.renderSize + 1] = v.renderSize[1];
    f[O.invRenderSize] = 1 / v.renderSize[0];
    f[O.invRenderSize + 1] = 1 / v.renderSize[1];
    f[O.animTime] = v.animTime;
    f[O.displayHours] = v.displayHours;
    f[O.dayFrac] = v.dayFrac;
    f[O.yearFrac] = v.yearFrac;
    f[O.seasonPhase] = v.seasonPhase;
    f[O.moonPhase] = v.moonPhase;
    f[O.ev100] = v.ev100;
    f[O.exposure] = 1 / (1.2 * 2 ** v.ev100); // saturation-based exposure, pre-exposed HDR (docs/04)
    f.set(Array.from(v.sunDir).slice(0, 3), O.sunDir);
    u[O.tierFlags] = v.tierFlags >>> 0;
    f.set(Array.from(v.sunIlluminance).slice(0, 3), O.sunIlluminance);
    u[O.frameIndex] = v.frameIndex >>> 0;
    f.set(Array.from(v.moonDir).slice(0, 3), O.moonDir);
    f.set(Array.from(v.moonIlluminance).slice(0, 3), O.moonIlluminance);
    return data;
  }

  return { pack };
}
