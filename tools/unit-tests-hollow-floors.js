// @ts-check
// The Hollow's floor maker (H1; docs/future/16-the-sea-cave.md, A floor and How it is built) for
// tools/unit-tests.html: the depth a level picks (soft edges), the floor plan (the way in, a main path
// of 3 to 5 ending at the way down, 1 to 3 side chambers, 12 to 20 m chambers, bent passages, the
// sponge about 1 in 12 from depth 2, never on the wet shelf), and the floor itself: the same inputs
// give the identical plan and mesh hash, sampling in slabs gives the same field as all at once, every
// depth meshes near 60k to 100k triangles and walks from the way in to the way down by the island's
// path finder, and a floor that can never be walked tries the next seeds and says so. Also the shared
// surface nets mesher: a sphere comes out closed.

import { planFloor, depthForLevel } from '../src/world/hollow/plan.js';
import { dressFloor } from '../src/world/hollow/shapes.js';
import { fieldSlab, floorBounds } from '../src/world/hollow/field.js';
import { buildFloor, meshField, meshHash, planHash } from '../src/world/hollow/floor.js';
import { hollowRules } from '../src/world/hollow/walk-grid.js';
import { findPath } from '../src/world/walk/path.js';
import { surfaceNets } from '../src/world/mesh/surface-nets.js';

const G = 'hollowFloors';
const floors = async () => (await (await fetch('../recipes/world/hollow.json')).json()).floors;

/** Distance from point p to segment a-b in plan (x, z). @param {number[]} p @param {number[]} a @param {number[]} b */
function segDist(p, a, b) {
  const bx = b[0] - a[0], bz = b[2] - a[2], l2 = bx * bx + bz * bz;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * bx + (p[2] - a[2]) * bz) / l2));
  return Math.hypot(p[0] - a[0] - bx * t, p[2] - a[2] - bz * t);
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addHollowFloorTests(test, assert, eq) {
  test(G, 'the level picks the depth, with soft edges near each border', async () => {
    const F = await floors();
    eq(depthForLevel(1, F.level, 0.5), 0, 'level 1 is the wet shelf');
    eq(depthForLevel(12, F.level, 0.5), 3, 'level 12 is the glass halls');
    eq(depthForLevel(5, F.level, 0.99), 1, 'level 5 is the dripstone');
    const b = F.level.borders[0];
    eq(depthForLevel(b, F.level, 0.1), 1, 'at the border a low draw goes deeper');
    eq(depthForLevel(b, F.level, 0.9), 0, 'and a high draw stays');
    eq(depthForLevel(b - F.level.softLevels, F.level, 0), 0, 'below the soft band never deeper');
  });

  test(G, 'a floor plan has the way in, a main path to the way down and side chambers, the same every time', async () => {
    const F = await floors();
    for (let s = 0; s < 24; s++) {
      const inputs = { seed: 1000 + s, trip: s % 5, floor: s % 7, level: 1 + (s % 12) };
      const p = planFloor(inputs, F);
      eq(JSON.stringify(planFloor(inputs, F)), JSON.stringify(p), `seed ${inputs.seed}: the same plan again`);
      const main = p.chambers.filter((c) => c.main), side = p.chambers.filter((c) => !c.main);
      assert(main.length >= F.count.main[0] && main.length <= F.count.main[1], `main path ${main.length}`);
      assert(side.length >= F.count.side[0] && side.length <= F.count.side[1], `side chambers ${side.length}`);
      eq(main[0].kind, 'in', 'the way in comes first');
      eq(main[main.length - 1].kind, 'down', 'the main path ends at the way down');
      eq(p.chambers.filter((c) => c.kind === 'in').length, 1, 'one way in');
      eq(p.chambers.filter((c) => c.kind === 'down').length, 1, 'one way down');
      assert(p.chambers.filter((c) => c.kind === 'seep').length <= 1, 'at most one seep');
      if (p.depth === 0) assert(!p.chambers.some((c) => c.kind === 'seep'), 'no seeps on the wet shelf');
      for (const c of p.chambers) assert(c.r * 2 >= F.layout.acrossM[0] - 1e-9 && c.r * 2 <= F.layout.acrossM[1] + 1e-9, `chamber ${(c.r * 2).toFixed(1)} m across`);
      eq(p.passages.length, p.chambers.length - 1, 'a tree: one passage less than chambers');
      // Each passage bends: its middle sits off the straight line from door to door by more than the tube.
      for (const q of p.passages) assert(segDist(q.pts[1], q.pts[0], q.pts[2]) > q.r, `passage ${q.a}-${q.b} bends past its own width`);
    }
    const a = planFloor({ seed: 5, trip: 1, floor: 2, level: 4 }, F), b = planFloor({ seed: 5, trip: 2, floor: 2, level: 4 }, F);
    assert(JSON.stringify(a.chambers) !== JSON.stringify(b.chambers), 'another trip, another floor');
  });

  test(G, 'deeper floors have more chambers; the sponge is about 1 in 12, never on the wet shelf', async () => {
    const F = await floors();
    let top = 0, deep = 0, sponge = 0, spongeTop = 0, n = 0;
    for (let s = 0; s < 240; s++) {
      top += planFloor({ seed: s, trip: 1, floor: 1, level: 1 }, F).chambers.length;
      const p = planFloor({ seed: s, trip: 1, floor: 1, level: 12 }, F);
      deep += p.chambers.length;
      if (p.flavor === 'sponge') sponge++;
      if (planFloor({ seed: s, trip: 2, floor: 1, level: 1 }, F).flavor === 'sponge') spongeTop++;
      n++;
    }
    assert(top / n < 5 && deep / n > 6.5, `about 4 near the top (${(top / n).toFixed(2)}), about 8 deep down (${(deep / n).toFixed(2)})`);
    const share = sponge / n;
    assert(share > 0.04 && share < 0.14, `sponge share ${share.toFixed(3)}`);
    eq(spongeTop, 0, 'no sponge on the wet shelf');
  });

  test(G, 'the same inputs give the identical plan and mesh hash; slabs give the same field as one pass', async () => {
    const F = await floors();
    const inputs = { seed: 77, trip: 3, floor: 1, level: 5 };
    const a = buildFloor(inputs, F), b = buildFloor(inputs, F);
    eq(a.planHash, b.planHash, 'plan hash');
    eq(a.meshHash, b.meshHash, 'mesh hash');
    eq(meshHash(a.mesh), a.meshHash, 'the hash is the mesh');
    eq(planHash(a.plan), a.planHash, 'the hash is the plan');
    // The field in three uneven slabs, side by side, is the field all at once.
    const plan = planFloor({ ...inputs, attempt: 0 }, F), dressed = dressFloor(plan, F), bounds = floorBounds(dressed, F.mesh);
    const whole = fieldSlab({ dressed, bounds, k0: 0, k1: bounds.n[2], clampM: F.mesh.clampM }).field;
    const cut = [0, 7, Math.floor(bounds.n[2] / 2), bounds.n[2]];
    const plane = bounds.n[0] * bounds.n[1], joined = new Float32Array(whole.length);
    for (let i = 1; i < cut.length; i++) joined.set(fieldSlab({ dressed, bounds, k0: cut[i - 1], k1: cut[i], clampM: F.mesh.clampM }).field, cut[i - 1] * plane);
    let same = true;
    for (let i = 0; i < whole.length && same; i++) if (whole[i] !== joined[i]) same = false;
    assert(same, 'slabs match one pass bit for bit');
    eq(meshHash(meshField(joined, bounds)), meshHash(meshField(whole, bounds)), 'and so does the mesh');
  });

  test(G, 'every depth and the sponge mesh near 60k to 100k triangles and walk from the way in to the way down', async () => {
    const F = await floors();
    const cases = [{ depth: 0, flavor: 'rock' }, { depth: 1, flavor: 'rock' }, { depth: 2, flavor: 'rock' }, { depth: 3, flavor: 'rock' }, { depth: 2, flavor: 'sponge' }];
    for (const c of cases) {
      const f = buildFloor({ seed: 41, trip: 2, floor: 3, level: 6, ...c }, F);
      const name = `${f.plan.depthId}${f.plan.flavor === 'sponge' ? ' sponge' : ''}`;
      assert(f.check.ok, `${name}: walkable (${f.tries.map((t) => t.reason || 'ok').join(', ')})`);
      assert(f.mesh.triangles > 45000 && f.mesh.triangles < 125000, `${name}: ${f.mesh.triangles} triangles`);
      // Normals are unit length and the floor faces up somewhere.
      const V = f.mesh.vertices;
      let up = 0;
      for (let v = 0; v < V.length; v += 6) { assert(Math.abs(Math.hypot(V[v + 3], V[v + 4], V[v + 5]) - 1) < 1e-3, 'unit normal'); if (V[v + 4] > 0.9) up++; }
      assert(up > 1000, `${name}: floor faces up (${up})`);
      // The island's path finder crosses it too, on the same grid interface.
      const g = f.grid, r = hollowRules(g, F.walk);
      const a = f.plan.chambers[0], d = /** @type {any} */ (f.plan.chambers.find((x) => x.kind === 'down'));
      const from = g.center(f.check.from), to = g.center(f.check.to);
      const path = findPath(g, r, from, to);
      assert(path.ok, `${name}: the path finder walks from the way in (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) to the way down (${d.x.toFixed(1)}, ${d.z.toFixed(1)})`);
      eq(typeof g.cellAt, 'function', 'grid: cellAt');
      eq(g.height.length, g.w * g.h, 'grid: a height per cell');
      eq(g.steep.length, g.w * g.h, 'grid: a steep flag per cell');
    }
  });

  test(G, 'the silt channel is deep water and its causeways are dry; the wet shelf has shallow puddles', async () => {
    const F = await floors();
    const at = { seed: 41, trip: 2, floor: 3, level: 6, flavor: /** @type {'rock'} */ ('rock') };
    const silt = buildFloor({ ...at, depth: 2 }, F), shelf = buildFloor({ ...at, depth: 0 }, F);
    let deep = 0, shallow = 0;
    for (let k = 0; k < silt.grid.w * silt.grid.h; k++) if (silt.grid.water[k] >= F.walk.wadeM) deep++;
    for (let k = 0; k < shelf.grid.w * shelf.grid.h; k++) if (shelf.grid.water[k] > 0.02 && shelf.grid.water[k] < F.walk.wadeM) shallow++;
    assert(deep > 50, `silt deeps: deep channel cells ${deep}`);
    assert(shallow > 10, `wet shelf: shallow puddle cells ${shallow}`);
  });

  test(G, 'a floor that can never be walked tries the next seeds and reports each', async () => {
    const F = await floors();
    const G2 = { ...F, walk: { ...F.walk, headroomM: 99, retries: 2 } };
    const f = buildFloor({ seed: 3, trip: 1, floor: 1, level: 2 }, G2);
    eq(f.tries.length, 3, 'the first seed and two more');
    assert(f.tries.every((t, i) => t.attempt === i && !t.ok && t.reason), 'each try reported, with why');
    assert(!f.check.ok, 'and the result says it is not walkable');
  });

  test(G, 'surface nets: a sphere comes out closed, every edge shared by two triangles', () => {
    const n = [24, 24, 24], cellM = 0.1, min = [-1.15, -1.15, -1.15];
    const field = new Float32Array(n[0] * n[1] * n[2]);
    for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
      field[(k * n[1] + j) * n[0] + i] = Math.hypot(min[0] + i * cellM, min[1] + j * cellM, min[2] + k * cellM) - 0.8;
    }
    const { idx, count } = surfaceNets(field, n, min, cellM);
    assert(count > 100 && idx.length > 600, `${count} vertices`);
    /** @type {Map<string, number>} */ const edges = new Map();
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    let open = 0;
    for (const v of edges.values()) if (v !== 2) open++;
    eq(open, 0, 'no open edges');
  });
}
