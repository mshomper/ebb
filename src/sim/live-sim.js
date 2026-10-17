// @ts-check
// Live simulation registry (doc 03): world systems in a fixed order, with per-frame CPU work,
// GPU compute encoding and an after-submit hook. The hourly tick joins here in S2 and later.

/**
 * @typedef {Object} FrameInfo
 * @property {number} dt        game-time step in seconds
 * @property {number} realDt    real seconds since the last frame
 * @property {number} worldT
 * @property {number} animT
 * @property {number} displayT
 * @property {string} tier
 */

/**
 * @typedef {Object} LiveSystem
 * @property {string} id
 * @property {(f: FrameInfo) => void} [tick]
 * @property {(encoder: GPUCommandEncoder, f: FrameInfo) => void} [encode]
 * @property {() => void} [afterSubmit]
 * @property {() => void} [dispose]
 */

export function createLiveSim() {
  /** @type {LiveSystem[]} */
  const systems = [];
  return {
    /** @param {LiveSystem} s */
    addSystem(s) { systems.push(s); },
    /** @param {FrameInfo} f */
    update(f) { for (const s of systems) s.tick?.(f); },
    /** @param {GPUCommandEncoder} encoder @param {FrameInfo} f */
    encode(encoder, f) { for (const s of systems) s.encode?.(encoder, f); },
    afterSubmit() { for (const s of systems) s.afterSubmit?.(); },
    dispose() { for (const s of systems) s.dispose?.(); systems.length = 0; },
  };
}
