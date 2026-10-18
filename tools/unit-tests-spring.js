// @ts-check
// Starter spring tests (docs 07, 08) for tools/unit-tests.html: the spring wells up in a small
// pool ringed by stones, at the head of its bed, and the pool spills only down the brook. Built
// from the real starter island landform, so they guard the recipe as well as the code.

import { subSeed } from '../src/core/rng.js';
import { buildBase, landmarks } from '../src/world/terrain/landform.js';
import { CELL, CHUNK_CELLS, CHUNK_SIZE, WORLD_CELLS, chunkFirstCell, dequantize, quantize } from '../src/world/terrain/grid.js';
import { buildSummary, WATER_CLASS } from '../src/world/water/summary.js';
import { rectForBounds, waterCellOf, waterCellCenter } from '../src/world/water/grid.js';

const SPRING = 'spring';

/** @type {Promise<{ land: any, water: any }> | null} */ let recipesPromise = null;
function loadRecipes() {
  recipesPromise ??= (async () => {
    const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => {
      if (!r.ok) throw new Error(`recipes/${p}.json: HTTP ${r.status}`);
      return r.json();
    });
    return { land: await get('land/starter-island'), water: await get('world/water') };
  })();
  return recipesPromise;
}

/**
 * Heights and materials of the starter island's landform at world points, building chunks on demand.
 * @param {any} land @param {number} seed
 */
function sampler(land, seed) {
  /** @type {Map<string, ReturnType<typeof buildBase>>} */ const chunks = new Map();
  /** @param {number} x @param {number} z */
  const at = (x, z) => {
    const cx = Math.floor((x + CHUNK_SIZE / 2) / CHUNK_SIZE), cz = Math.floor((z + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let c = chunks.get(key);
    if (!c) { c = buildBase({ land, seed, cx, cz }); chunks.set(key, c); }
    const i = Math.floor((x - (CHUNK_SIZE * cx - CHUNK_SIZE / 2)) / CELL);
    const j = Math.floor((z - (CHUNK_SIZE * cz - CHUNK_SIZE / 2)) / CELL);
    return { c, k: j * CHUNK_CELLS + i };
  };
  return {
    /** @param {number} x @param {number} z */
    height: (x, z) => { const { c, k } = at(x, z); return dequantize(c.heightQ[k]); },
    /** Rock weight 0..255. @param {number} x @param {number} z */
    rock: (x, z) => { const { c, k } = at(x, z); return c.material[k * 4 + 2]; },
  };
}

/**
 * The opened starter chunks (-1..1) as the summary's 768 x 768 heights, and their water rect.
 * @param {any} land @param {number} seed
 */
function islandHeights(land, seed) {
  const heightQ = new Uint16Array(WORLD_CELLS * WORLD_CELLS).fill(quantize(land.seabedDepth));
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const b = buildBase({ land, seed, cx, cz });
      const x0 = chunkFirstCell(cx), z0 = chunkFirstCell(cz);
      for (let j = 0; j < CHUNK_CELLS; j++) heightQ.set(b.heightQ.subarray(j * CHUNK_CELLS, (j + 1) * CHUNK_CELLS), (z0 + j) * WORLD_CELLS + x0);
    }
  }
  const half = 1.5 * CHUNK_SIZE;
  return { heightQ, rect: rectForBounds({ openMin: [-half, -half], openMax: [half, half] }) };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSpringTests(test, assert, eq) {
  test(SPRING, 'the spring wells up in a pool: lower than the rim and stones around it on every side', async () => {
    const { land } = await loadRecipes();
    for (const seed of [subSeed(1, 'terrain'), subSeed(2, 'terrain')]) {
      const sp = /** @type {{ x: number, z: number }} */ (landmarks(land, seed).spring);
      const s = sampler(land, seed);
      const h0 = s.height(sp.x, sp.z);
      // The ring just outside the pool: rim and stones, open only where the notch lets the water out.
      let higher = 0;
      const N = 48;
      for (let a = 0; a < N; a++) {
        const t = (2 * Math.PI * a) / N;
        if (s.height(sp.x + 1.1 * Math.cos(t), sp.z + 1.1 * Math.sin(t)) > h0 + 0.05) higher++;
      }
      assert(higher >= 0.75 * N, `seed ${seed}: only ${higher} of ${N} points around the spring stand above it`);
    }
  });

  test(SPRING, 'the outcrop is painted rock around the pool, and another seed gives other stones', async () => {
    const { land } = await loadRecipes();
    /** @param {number} seed */
    const rockCells = (seed) => {
      const sp = /** @type {{ x: number, z: number }} */ (landmarks(land, seed).spring);
      const s = sampler(land, seed);
      const cells = [];
      for (let dz = -2.5; dz <= 2.5; dz += CELL) {
        for (let dx = -2.5; dx <= 2.5; dx += CELL) if (s.rock(sp.x + dx, sp.z + dz) > 128) cells.push(`${dx},${dz}`);
      }
      eq(s.rock(sp.x, sp.z) > 128, false, `seed ${seed}: the spring itself is rock`);
      return cells;
    };
    const a = rockCells(subSeed(1, 'terrain'));
    const a2 = rockCells(subSeed(1, 'terrain'));
    const b = rockCells(subSeed(2, 'terrain'));
    assert(a.length >= 16, `only ${a.length} rock cells around the spring`);
    eq(a.join(' '), a2.join(' '), 'same seed, same stones:');
    assert(a.join(' ') !== b.join(' '), 'a different seed gave the same stones');
    return `${a.length} and ${b.length} rock cells (${(a.length * CELL * CELL).toFixed(1)} and ${(b.length * CELL * CELL).toFixed(1)} m²)`;
  });

  test(SPRING, 'the summary sees a small spring-fed pool that spills only down the brook', async () => {
    const { land, water } = await loadRecipes();
    const seed = subSeed(1, 'terrain');
    const lm = landmarks(land, seed);
    const sp = /** @type {{ x: number, z: number, rateLps: number }} */ (lm.spring);
    const { heightQ, rect } = islandHeights(land, seed);
    const s = buildSummary({
      heightQ, rect, springs: [{ cellX: waterCellOf(sp.x), cellY: waterCellOf(sp.z), rateLps: sp.rateLps }],
      params: { ...water.summary, manningN: water.sim.manningN }, tide: water.tide,
    });
    const at = (waterCellOf(sp.z) - rect.y) * rect.w + (waterCellOf(sp.x) - rect.x);
    eq(s.cls[at], WATER_CLASS.still, 'the spring cell class');
    assert(s.basin[at] > 0, 'the spring cell is in no basin');
    let pool = 0;
    for (let k = 0; k < s.basin.length; k++) if (s.basin[k] === s.basin[at]) pool++;
    assert(pool >= 2 && pool <= 16, `the spring's pool is ${pool} cells (${pool / 4} m²), expected a small pool`);
    // Downhill is from the rise toward the pond: every stream cell near the spring lies in a
    // narrow corridor below it, so no water leaves the pool sideways or uphill.
    const dx = lm.basin.x - lm.rise.x, dz = lm.basin.z - lm.rise.z, dl = Math.hypot(dx, dz);
    const ux = dx / dl, uz = dz / dl;
    let near = 0, worst = 0;
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const k = j * rect.w + i;
        if (s.cls[k] !== WATER_CLASS.slow && s.cls[k] !== WATER_CLASS.running) continue;
        const ox = waterCellCenter(rect.x + i) - sp.x, oz = waterCellCenter(rect.y + j) - sp.z;
        if (Math.hypot(ox, oz) > 3) continue;
        near++;
        const along = ox * ux + oz * uz, across = Math.abs(oz * ux - ox * uz);
        assert(along > 0, `a stream cell ${along.toFixed(2)} m uphill of the spring`);
        worst = Math.max(worst, across);
      }
    }
    assert(near >= 3, `only ${near} stream cells within 3 m of the spring`);
    assert(worst <= 1.5, `a stream cell ${worst.toFixed(2)} m to the side of the brook's line`);
    return `pool ${pool / 4} m², ${near} stream cells within 3 m, widest ${worst.toFixed(2)} m off the line`;
  });
}
