// @ts-check
// Live moss (docs 10, 22), an interim form until the growth system's reaction-diffusion moss
// arrives: moss covers the ground where it stays damp, read from the water summary (damp hollows
// and the banks of ponds and streams, never the salty tide band). Cover creeps in over game time,
// starting from the inside of a hollow and from the water's edge, and fades slowly where the
// ground dries out. Visual only and not saved: on load, existing habitat starts fully grown.
// The cover goes to a 0.5 m r8unorm texture the terrain reads as the fifth ground layer.

import { makeTexture } from '../../core/gpu.js';
import { WATER_CELLS, WATER_CELL } from '../water/grid.js';
import { WATER_CLASS } from '../water/summary.js';

/**
 * @param {GPUDevice} device
 * @param {{ water: import('../water/index.js').Water, recipe: any }} opts  recipe: terrain.json `moss`
 */
export function createMossLive(device, opts) {
  const { water, recipe } = opts;
  const rect = water.rect;
  const n = rect.w * rect.h;
  const texture = makeTexture(device, {
    label: 'moss-cover', size: [WATER_CELLS, WATER_CELLS], format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const cover = new Float32Array(n);
  const habitat = new Float32Array(n);   // how much moss the ground supports (0..1)
  const core = new Uint8Array(n);       // cells where moss may start on its own
  const bytes = new Uint8Array(n);
  /** @type {any} */ let summary = null;
  let first = true;
  let hours = 0;     // game hours waiting to be applied
  let clockS = 0;    // real seconds since the last update
  /** @type {number | null} */ let lastWorldT = null;

  const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  /** Bank width in cells and how much moss each ring from the water supports. */
  const BANK = 3;
  const BANK_FALLOFF = [0.85, 0.45, 0.15];

  /** Habitat from the summary: damp hollows big enough to read, and banks next to fresh water. */
  function rebuildHabitat(/** @type {any} */ s) {
    const { w, h } = rect;
    /** @type {Map<number, number>} */ const size = new Map();
    for (let i = 0; i < n; i++) if (s.cls[i] === WATER_CLASS.damp) size.set(s.basin[i], (size.get(s.basin[i]) ?? 0) + 1);
    const minCells = recipe.minHollowM2 / (WATER_CELL * WATER_CELL);
    const fresh = (/** @type {number} */ c) => c === WATER_CLASS.still || c === WATER_CLASS.slow || c === WATER_CLASS.running;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const c = s.cls[k];
        let hab = 0;
        let start = 0;
        if (c === WATER_CLASS.damp && (size.get(s.basin[k]) ?? 0) >= minCells) hab = 1;
        if (!hab && !fresh(c) && c !== WATER_CLASS.sea && !s.band[k]) {
          // Banks: full next to fresh water, thinning out over the next cells.
          let near = 99;
          for (let dj = -BANK; dj <= BANK; dj++) {
            for (let di = -BANK; di <= BANK; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
              if (fresh(s.cls[jj * w + ii])) near = Math.min(near, Math.max(Math.abs(di), Math.abs(dj)));
            }
          }
          if (near <= BANK) { hab = BANK_FALLOFF[near - 1]; start = near === 1 ? 1 : 0; }
        }
        habitat[k] = hab;
        core[k] = start;
      }
    }
    // Inside a hollow (every neighbor also habitat), moss can start by itself.
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        if (habitat[k] < 1 || core[k]) continue;
        let inside = 1;
        for (const [di, dj] of NB) if (habitat[(j + dj) * w + i + di] < 1) { inside = 0; break; }
        core[k] = inside;
      }
    }
    if (first) { for (let k = 0; k < n; k++) cover[k] = habitat[k]; first = false; }
  }

  function step(/** @type {number} */ dh) {
    const { w, h } = rect;
    const grow = dh / recipe.growHours;
    const fade = dh / recipe.fadeHours;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        // Above what the ground supports (it dried, or the bank moved), moss fades back.
        if (cover[k] > habitat[k]) { cover[k] = Math.max(habitat[k], cover[k] - fade); continue; }
        if (cover[k] >= habitat[k]) continue;
        let reach = core[k] === 1 || cover[k] > 0;
        if (!reach) {
          for (const [di, dj] of NB) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < w && jj < h && cover[jj * w + ii] > recipe.spreadFrom) { reach = true; break; }
          }
        }
        if (reach) cover[k] = Math.min(habitat[k], cover[k] + grow);
      }
    }
  }

  function upload() {
    for (let k = 0; k < n; k++) bytes[k] = Math.round(cover[k] * 255);
    device.queue.writeTexture({ texture, origin: [rect.x, rect.y] }, bytes, { bytesPerRow: rect.w, rowsPerImage: rect.h }, [rect.w, rect.h]);
  }

  return {
    id: 'moss',
    texture,
    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      const s = water.getSummary();
      if (s && s !== summary) { summary = s; rebuildHabitat(s); upload(); }
      // Game hours from the world clock (FrameInfo.dt is real seconds; worldT follows 1x to 4x and pause).
      if (lastWorldT !== null) hours += Math.max(0, f.worldT - lastWorldT) / 3600;
      lastWorldT = f.worldT;
      clockS += f.realDt;
      if (clockS < 0.5 || !summary) return;
      clockS = 0;
      if (hours > 0) { step(Math.min(hours, 6)); hours = 0; upload(); }
    },
    dispose() { texture.destroy(); },
  };
}

/** @typedef {ReturnType<typeof createMossLive>} MossLive */
