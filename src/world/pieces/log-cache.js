// @ts-check
// Each log's own mesh (log-bake.js), baked the first time it is drawn and handed to the pieces pass
// under its own key; a mesh no log has used for a while is let go (strand logs come and go with the
// tides). A log is keyed by its seed and its proportions, so the same log always draws the same.

import { packMesh } from '../creatures/bodies.js';
import { bakeLogSeed } from './log-bake.js';

/**
 * @param {{ setMesh: (key: string, mesh: { data: ArrayBuffer, indices: Uint32Array }) => void, dropMesh: (key: string) => void }} pass
 * @param {any} D pieces.json driftwood
 */
export function createLogCache(pass, D) {
  /** @type {Map<string, ReturnType<typeof bakeLogSeed> & { key: string, usedS: number }>} */
  const baked = new Map();
  let clockS = 0;
  return {
    /**
     * A log's mesh, baked if it is new. @param {{ seed: number, size: number, length?: number }} p
     */
    of(p) {
      const a = p.size / (p.length ?? 1);
      const key = `log-${p.seed >>> 0}-${Math.round(a * 1000)}`;
      let b = baked.get(key);
      if (!b) {
        b = { ...bakeLogSeed(D, p.seed, Math.round(a * 1000) / 1000), key, usedS: clockS };
        baked.set(key, b);
        pass.setMesh(key, { data: packMesh(b.mesh), indices: b.mesh.indices });
      }
      b.usedS = clockS;
      return b;
    },
    /** Time passes (real seconds): meshes unused for a minute are let go. @param {number} dt */
    tick(dt) {
      clockS += dt;
      for (const [key, b] of baked) if (clockS - b.usedS > 60) { baked.delete(key); pass.dropMesh(key); }
    },
  };
}
