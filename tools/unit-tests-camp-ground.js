// @ts-check
// The camp ground and the larger island (docs/future/13 sections 3.1, 3.8, 3.11) for
// tools/unit-tests.html: the new land's level pad, beach and varied coast; an island keeps the land
// its chunks record; an older island's pad goes to the recipe spot, or to the nearest dry flat
// ground when that spot was dug into a pond.

import { buildBase, hashBase, campOf, islandCenter } from '../src/world/terrain/landform.js';
import { islandLand } from '../src/world/terrain/chunks.js';
import { CHUNK_CELLS, CHUNK_SIZE, CELL, WORLD_CELLS, WORLD_ORIGIN, chunkFirstCell, dequantize, quantize } from '../src/world/terrain/grid.js';
import { padOf, padMask, padToWorld, slotWorld } from '../src/world/camp/layout.js';
import { choosePadSpot, padTiles, clearPieces } from '../src/world/camp/migrate-pad.js';

const G = 'camp ground';
const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());

/**
 * Heights and materials of a land's open chunks in a whole-window mirror.
 * @param {any} land @param {number} seed
 */
function mirrorOf(land, seed) {
  const N = WORLD_CELLS, heightQ = new Uint16Array(N * N).fill(quantize(land.seabedDepth)), material = new Uint8Array(N * N * 4);
  for (let cz = land.chunkMin; cz <= land.chunkMax; cz++) for (let cx = land.chunkMin; cx <= land.chunkMax; cx++) {
    const b = buildBase({ land, seed, cx, cz });
    for (let j = 0; j < CHUNK_CELLS; j++) {
      const k = (chunkFirstCell(cz) + j) * N + chunkFirstCell(cx);
      heightQ.set(b.heightQ.subarray(j * CHUNK_CELLS, (j + 1) * CHUNK_CELLS), k);
      material.set(b.material.subarray(j * CHUNK_CELLS * 4, (j + 1) * CHUNK_CELLS * 4), k * 4);
    }
  }
  return { heightQ, material };
}
/** @param {number} x @param {number} z */
const cell = (x, z) => Math.floor((z - WORLD_ORIGIN) / CELL) * WORLD_CELLS + Math.floor((x - WORLD_ORIGIN) / CELL);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampGroundTests(test, assert, eq) {
  test(G, 'the larger island: a level pad of grass and soil, a beach below it, 16 chunks centered on the island', async () => {
    const land = await get('land/starter-island-2');
    eq((land.chunkMax - land.chunkMin + 1) ** 2, 16, '4 x 4 chunks');
    const o = islandCenter(land), lo = CHUNK_SIZE * land.chunkMin - CHUNK_SIZE / 2, hi = CHUNK_SIZE * land.chunkMax + CHUNK_SIZE / 2;
    eq((lo + hi) / 2, o.x, 'the block is centered on the island');
    const lines = [];
    for (const seed of [1, 7, 42, 1234]) {
      const m = mirrorOf(land, seed), pad = /** @type {any} */ (campOf(land));
      for (let a = 0; a < 16; a++) for (const rr of [0, 1.5, 3, 3.9]) {
        const x = pad.x + rr * Math.cos(a * 0.39), z = pad.z + rr * Math.sin(a * 0.39), k = cell(x, z);
        assert(Math.abs(dequantize(m.heightQ[k]) - pad.h) < 0.002, `seed ${seed}: the pad is level at ${pad.h} m`);
        assert(m.material[k * 4 + 1] === 0 && m.material[k * 4 + 2] === 0, `seed ${seed}: grass and soil only on the pad`);
      }
      // Out along the facing line from the pad's edge: sand at the waterline, the sea within 9 to 14 m of the center.
      let sea = -1;
      for (let t = pad.r; t < 30; t += 0.25) if (dequantize(m.heightQ[cell(pad.x + pad.fx * t, pad.z + pad.fz * t)]) < 0) { sea = t; break; }
      assert(sea > 9 && sea < 14, `seed ${seed}: the sea ${sea} m from the pad`);
      const k = cell(pad.x + pad.fx * (sea - 1), pad.z + pad.fz * (sea - 1));
      assert(m.material[k * 4 + 1] > 128, `seed ${seed}: a sand beach where the boat lands`);
      // No land past the open block's edge.
      for (let i = 0; i < WORLD_CELLS; i += 8) {
        const e = cell(hi - 0.2, WORLD_ORIGIN + (i + 0.5) * CELL);
        assert(dequantize(m.heightQ[e]) < -2, `seed ${seed}: the shelf has reached the seabed at the block's edge`);
      }
      lines.push(`seed ${seed}: sea ${sea} m`);
    }
    return lines.join(', ');
  });

  test(G, 'two seeds give clearly different coasts; the old land is unchanged by its stamp-only camp block', async () => {
    const land = await get('land/starter-island-2');
    const a = mirrorOf(land, 1), b = mirrorOf(land, 2);
    let differ = 0, coast = 0;
    for (let k = 0; k < a.heightQ.length; k += 7) {
      const la = dequantize(a.heightQ[k]) > 0, lb = dequantize(b.heightQ[k]) > 0;
      if (la || lb) coast++;
      if (la !== lb) differ++;
    }
    assert(differ / coast > 0.06, `the land differs in ${(100 * differ / coast).toFixed(1)}% of cells`);
    const old = await get('land/starter-island');
    eq(old.camp.inBase, false, 'the old land carries its camp only for the stamp');
    const bare = { ...old }; delete bare.camp;
    const x = buildBase({ land: old, seed: 9, cx: 0, cz: -1 }), y = buildBase({ land: bare, seed: 9, cx: 0, cz: -1 });
    eq(hashBase(x.heightQ, x.material), hashBase(y.heightQ, y.material), 'an older island grows exactly as before');
  });

  test(G, 'an island keeps the land its chunks record; a new one grows the larger land', () => {
    const isl = { id: 'starter-island', land: 'starter-island-2' };
    eq(islandLand(isl, []), 'starter-island-2', 'a new island');
    eq(islandLand(isl, [{ land: 'land/starter-island' }]), 'starter-island', 'an island made before the update');
    eq(islandLand(isl, [{ land: 'land/starter-island-2' }]), 'starter-island-2', 'one made after');
    eq(islandLand({ id: 'two-ponds' }, [{ land: 'land/starter-island' }]), 'two-ponds', 'Two ponds never takes the starter land its chunks once recorded');
  });

  test(G, "the pad's frame: u seaward, v to the left facing the sea; the lock fades over a meter", async () => {
    const land = await get('land/starter-island-2'), pad = /** @type {any} */ (padOf(land));
    const [sx, sz] = padToWorld(pad, 1, 0);
    assert(Math.abs(Math.hypot(sx - pad.x, sz - pad.z) - 1) < 1e-9 && (sx - pad.x) * pad.fx + (sz - pad.z) * pad.fz > 0.99, 'u is seaward');
    const [lx, lz] = padToWorld(pad, 0, 1);
    // Left of the facing, seen from above with y up: the cross product of facing and left points down (-y).
    assert(pad.fx * (lz - pad.z) - pad.fz * (lx - pad.x) < 0, 'v is to the left facing the sea');
    eq(padMask(pad, pad.x, pad.z), 0, 'nothing on the pad');
    eq(padMask(pad, pad.x + pad.r + pad.lockFadeM, pad.z), 1, 'full a meter outside');
    const mid = padMask(pad, pad.x + pad.r + pad.lockFadeM / 2, pad.z);
    assert(mid > 0.4 && mid < 0.6, 'half way across the fade');
    for (const s of pad.camp.slots) {
      const w = slotWorld(pad, s);
      assert(Math.hypot(w.x - pad.x, w.z - pad.z) <= 3.71, `slot ${s.id} inside 3.7 m`);
    }
  });

  test(G, "an older island's pad: the recipe spot when untouched, the nearest dry flat ground when dug into a pond", async () => {
    const [old, terrain, water] = await Promise.all([get('land/starter-island'), get('world/terrain'), get('world/water')]);
    const m = mirrorOf(old, 5), pad = /** @type {any} */ (padOf(old));
    const N = WORLD_CELLS, baseQ = m.heightQ.slice();
    const tideTopM = water.tide.amplitudeM * (1 + water.tide.springNeap);
    const ground = (/** @type {Uint16Array} */ heightQ, /** @type {(x: number, z: number) => boolean} */ wet) => ({
      heightQ, baseQ, wet, cliffStepM: Math.tan(terrain.cliff.faceDeg * Math.PI / 180) * CELL, tideTopM,
      openMin: /** @type {[number, number]} */ ([-48, -48]), openMax: /** @type {[number, number]} */ ([48, 48]) });
    const sea = (/** @type {number} */ x, /** @type {number} */ z) => dequantize(m.heightQ[cell(x, z)]) < 0;
    const here = choosePadSpot(ground(m.heightQ, sea), pad, old.camp.kingTideMarginM);
    eq(here.source, 'recipe', 'the recipe spot');
    eq(`${here.x},${here.z}`, `${pad.x},${pad.z}`, 'at the recipe place');
    // Dig the spot into a pond: 1.2 m down, standing water.
    const dug = m.heightQ.slice();
    for (let k = 0; k < N * N; k++) {
      const x = WORLD_ORIGIN + ((k % N) + 0.5) * CELL, z = WORLD_ORIGIN + (Math.floor(k / N) + 0.5) * CELL;
      if (Math.hypot(x - pad.x, z - pad.z) < 3) dug[k] = quantize(0.1);
    }
    const pond = (/** @type {number} */ x, /** @type {number} */ z) => Math.hypot(x - pad.x, z - pad.z) < 3 || dequantize(dug[cell(x, z)]) < 0;
    const moved = choosePadSpot(ground(dug, pond), pad, old.camp.kingTideMarginM);
    eq(moved.source, 'nearest', 'the nearest spot instead');
    const d = Math.hypot(moved.x - pad.x, moved.z - pad.z);
    assert(d >= 4 && d < 15, `close by (${d.toFixed(1)} m away)`);
    assert(moved.heightM >= tideTopM + old.camp.kingTideMarginM, 'above the highest tide');
    // Laid in: level on the pad, the pond's water left alone.
    const tiles = padTiles({ heightQ: dug, material: m.material }, moved, pad, pond);
    assert(tiles.length > 0, 'tiles to apply');
    eq(JSON.stringify(choosePadSpot(ground(dug, pond), pad, old.camp.kingTideMarginM)), JSON.stringify(moved), 'the same spot every time');
    // Stones on the pad move to its edge.
    const p = clearPieces({ version: 1, list: [/** @type {any} */ ({ id: 's1', kind: 'stone', x: moved.x + 1, z: moved.z, yaw: 0, seed: 1, size: 0.4 }),
      /** @type {any} */ ({ id: 's2', kind: 'stone', x: moved.x + 9, z: moved.z, yaw: 0, seed: 2, size: 0.4 })], nextId: 3, arrived: true }, moved, pad.r);
    assert(Math.hypot(p.list[0].x - moved.x, p.list[0].z - moved.z) >= pad.r, 'the stone on the pad is off it');
    eq(p.list[1].x, moved.x + 9, 'the stone away from the pad stays');
  });
}
