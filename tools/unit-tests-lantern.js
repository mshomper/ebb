// @ts-check
// The lantern and the stone crossing (B2 L1 and W7, October 30, 2026): a lantern glows from dusk to
// dawn by the sun alone; it stands only on dry ground off the camp, apart from another; the island's
// lanterns are counted wherever they are (standing, in the pack, being made); the record keeps
// through the save's cleaner; its three makes are offered only once the trail gives it, and their
// parts are unique among every make and build; and a click across a shallow pond keeps to the
// stepping stones rather than wading beside them.

import { lanternGlow, mayStand, lanternsOwned, makeLantern, lanternAt, potMesh, postMesh, holesMesh, bandMesh } from '../src/world/pieces/lantern.js';
import { cleanPieces } from '../src/world/pieces/model.js';
import { cleanCook, layout, partKinds } from '../src/world/camp/making.js';
import { createWalkGrid } from '../src/world/walk/grid.js';
import { findPath } from '../src/world/walk/path.js';

const G = 'lantern';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addLanternTests(test, assert, eq) {
  test(G, 'a lantern is dark by day, wakes at dusk and is full by night, by the sun alone', async () => {
    const L = (await load('world/pieces')).lantern, F = L.light;
    eq(lanternGlow(30, F), 0, 'noon');
    eq(lanternGlow(F.litAtSunDeg + 0.1, F), 0, 'just before it wakes');
    eq(lanternGlow(F.fullAtSunDeg, F), 1, 'full at its full altitude');
    eq(lanternGlow(-40, F), 1, 'midnight');
    let prev = -1;
    for (let a = F.litAtSunDeg; a >= F.fullAtSunDeg; a -= 0.25) { const g = lanternGlow(a, F); assert(g >= prev, `brighter as the sun sinks (${a})`); prev = g; }
    eq(F.lightK, 2200, 'a warm rush light, 2200 K');
    return `wakes at ${F.litAtSunDeg} deg, full at ${F.fullAtSunDeg} deg, ${F.cd} cd`;
  });

  test(G, 'it stands only on dry ground, off the camp, apart from another; owned lanterns count wherever they are', async () => {
    const L = (await load('world/pieces')).lantern;
    assert(mayStand({ depth: 0, camp: false, others: [] }, 0, 0, L), 'dry open ground');
    assert(!mayStand({ depth: 0.05, camp: false, others: [] }, 0, 0, L), 'not in water');
    assert(!mayStand({ depth: 0, camp: true, others: [] }, 0, 0, L), 'not on the camp ground');
    assert(!mayStand({ depth: 0, camp: false, others: [{ x: L.apartM * 0.5, z: 0 }] }, 0, 0, L), 'not beside another');
    eq(lanternsOwned({ standing: 0, pouches: [['sticks', 3]], shaped: ['cup'], work: [] }), 0, 'none yet');
    eq(lanternsOwned({ standing: 0, pouches: [], shaped: ['lantern-pot'], work: [] }), 1, 'pale on the bench counts');
    eq(lanternsOwned({ standing: 0, pouches: [], shaped: [], work: [{ id: 'fire-lantern-pot' }] }), 1, 'firing counts');
    eq(lanternsOwned({ standing: 0, pouches: [['lantern-pot', 1]], shaped: [], work: [] }), 1, 'a fired pot counts');
    eq(lanternsOwned({ standing: 1, pouches: [['post-lantern', 1]], shaped: [], work: [] }), 2, 'standing and in the pack');
    eq(L.cap, 1, 'one lantern for now (three with M3 paths)');
  });

  test(G, 'its record is seeded, keeps through the save cleaner, and an old save without one still reads', async () => {
    const L = (await load('world/pieces')).lantern;
    const a = makeLantern(77, 3, 1.5, -2, 400, L), b = makeLantern(77, 3, 1.5, -2, 400, L);
    eq(JSON.stringify(a), JSON.stringify(b), 'same seed, same lantern');
    eq(a.kind, 'lantern');
    const back = cleanPieces({ version: 1, list: [a], nextId: 4, arrived: true });
    eq(JSON.stringify(back.list[0]), JSON.stringify(a), 'kept exactly');
    eq(cleanPieces({ version: 1, list: [], nextId: 1 }).list.length, 0, 'an older save with no lanterns');
    const at = lanternAt(a, 2, L);
    assert(Math.abs(at.glass[1] - (2 + Math.cos(at.tilt) * L.post.heightM + L.pot.heightM / 2)) < 1e-6, 'the light sits in the pot on the post');
    for (const m of [potMesh(L), postMesh(L), holesMesh(L), bandMesh(L)]) {
      assert(m.data.length % 8 === 0 && m.indices.length % 3 === 0, 'props layout');
      assert(m.data.every(Number.isFinite), 'finite vertices');
    }
  });

  test(G, 'its makes wait for the trail and room, and their parts are unique among every make and build', async () => {
    const C = await load('world/cook'), s = cleanCook(null);
    const open = { unlocked: (/** @type {string} */ k) => k === 'lantern' }, shut = { unlocked: () => false };
    const pot = layout(C, 'workbench', ['clay', 'pebbles'], s, open);
    assert(pot.make === 'lantern-pot' && pot.complete, 'clay and pebbles shape a lantern pot once given');
    assert(layout(C, 'workbench', ['clay', 'pebbles'], s, shut).make !== 'lantern-pot', 'not before the trail gives it');
    const lamp = layout(C, 'workbench', ['lantern-pot', 'sticks', 'rushes.stems'], s, open);
    assert(lamp.make === 'post-lantern' && lamp.complete, 'the fired pot, a stick and rushes make the lantern');
    eq(layout(C, 'workbench', ['sticks', 'rushes.stems', 'rushes.stems'], s, open).make, 'nest-box', 'the nest box keeps its own parts');
    eq(layout(C, 'workbench', ['clay', 'sand'], s, open).make, 'cooking-pot', 'the cooking pot keeps its own');
    eq(layout(C, 'fire', ['shaped:lantern-pot'], s, open).make, 'fire-lantern-pot', 'the pale pot fires in the star fire');
    // Every make and build as a sorted list of what serves each part: no two alike.
    /** @type {Map<string, string>} */ const seen = new Map();
    const all = [...Object.entries(C.makes).map(([id, m]) => [id, /** @type {any} */ (m).parts]),
      ...Object.entries(C.builds).map(([id, b]) => [id, /** @type {any} */ (b).parts.flatMap((/** @type {[string, number]} */ [k, n]) => Array(n).fill(k))])];
    for (const [id, parts] of all) {
      const key = parts.map((/** @type {any} */ p) => partKinds(p).slice().sort().join('|')).sort().join(' + ');
      // Older pairs that share parts: the workbench and the hearth stones (two flat stones), and the
      // cup and the bowl (a handful of clay, S5: which one is shaped is the bench's own choice).
      const pair = [id, seen.get(key)].sort().join(' ');
      if (seen.has(key) && !['hearth-stones workbench', 'bowl cup'].includes(pair)) assert(false, `${id} has the same parts as ${seen.get(key)}: ${key}`);
      seen.set(key, id);
    }
    return `${all.length} makes and builds checked`;
  });

  test(G, 'a click across a shallow pond keeps to the stepping stones, never wading beside them', async () => {
    const R = await load('world/walker');
    // A pond 12 m across (water 0.25 m deep, under knee deep), a line of stones across it along z = 10.
    const inPond = (/** @type {number} */ x, /** @type {number} */ z) => x > 14 && x < 26 && z > 4 && z < 16;
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (inPond(x, z) ? 0.75 : 1);
    const footing = (/** @type {number} */ x, /** @type {number} */ z) => (inPond(x, z) && Math.abs(z - 10) < 0.3 ? 1.04 : -Infinity);
    const grid = createWalkGrid({ ground, footing, minX: 0, minZ: 0, maxX: 40, maxZ: 20, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
    const depth = (/** @type {number} */ k) => Math.max(0, 1 - grid.height[k]);
    const G2 = R.grid, rules = { depth, wadeM: G2.wadeM, wadeCost: G2.wadeCost, maxStepM: G2.maxStepM, snapM: G2.snapM,
      wadeEnterCost: G2.wadeEnterCost, dryM: G2.dryM, footCost: G2.footCost };
    const from = /** @type {[number, number]} */ ([12, 11.6]), to = /** @type {[number, number]} */ ([28, 11.6]);
    const r = findPath(grid, rules, from, to);
    assert(r.ok, 'no way across');
    if (!r.ok) return;
    let prev = from, wet = 0;
    for (const p of r.points) {
      for (let s = 0; s <= 40; s++) {
        const x = prev[0] + ((p[0] - prev[0]) * s) / 40, z = prev[1] + ((p[1] - prev[1]) * s) / 40;
        if (depth(grid.cellAt(x, z)) > G2.dryM) wet++;
      }
      prev = p;
    }
    eq(wet, 0, 'no step of the way is in the water beside the stones');
    // With no stones the same click still wades straight across (shallow water is open).
    const bare = createWalkGrid({ ground, minX: 0, minZ: 0, maxX: 40, maxZ: 20, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
    const wade = findPath(bare, { ...rules, depth: (k) => Math.max(0, 1 - bare.height[k]) }, from, to);
    assert(wade.ok, 'with no stones it still wades across');
    return `${r.points.length} legs, all on the stones or the bank`;
  });
}
