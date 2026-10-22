// @ts-check
// Boat tests for tools/unit-tests.html (docs/future/13 section 3.9; src/world/intro/boat.js): the
// mooring on a simple round island whose ground falls off with distance from its middle. The stake
// sits at the first ground at or under stakeLevelM out from the pad, the boat boatOutM beyond it,
// and the walker's first spot inland of the stake, facing inland. The stand-in meshes are sound.

import { mooringOf } from '../src/world/intro/boat.js';
import { boatMeshes } from '../src/world/intro/boat-mesh.js';

const BOAT = 'boat';
const M = { stakeLevelM: 0.05, boatOutM: 1.6, searchM: 30, standInM: 2.2 };

/** A round island: 3 m high in the middle, down to sea level 0 at 20 m out, sea floor beyond. */
const ground = (/** @type {number} */ x, /** @type {number} */ z) => 3 * (1 - Math.hypot(x, z) / 20);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addBoatTests(test, assert, eq) {
  test(BOAT, 'the stake sits at the first ground under stakeLevelM, the boat boatOutM beyond', () => {
    const f = [Math.cos(0.7), Math.sin(0.7)];
    const pad = { x: f[0] * 6, z: f[1] * 6, r: 3, fx: f[0], fz: f[1] };
    const m = /** @type {import('../src/world/intro/boat.js').Mooring} */ (mooringOf(pad, ground, M));
    assert(m, 'a mooring');
    const rs = Math.hypot(m.stake.x, m.stake.z);
    // Ground at 0.05 m is at 20 * (1 - 0.05 / 3) = 19.667 m from the middle; steps are 0.1 m.
    assert(ground(m.stake.x, m.stake.z) <= M.stakeLevelM, `stake ground ${ground(m.stake.x, m.stake.z).toFixed(3)}`);
    assert(ground(m.stake.x - f[0] * 0.1, m.stake.z - f[1] * 0.1) > M.stakeLevelM, 'a step inland is above stakeLevelM');
    assert(Math.abs(rs - 19.667) < 0.11, `stake ${rs.toFixed(2)} m from the middle`);
    const out = Math.hypot(m.boat.x - m.stake.x, m.boat.z - m.stake.z);
    assert(Math.abs(out - M.boatOutM) < 1e-9, `boat ${out} m beyond the stake`);
    assert(Math.hypot(m.boat.x, m.boat.z) > rs, 'the boat is seaward of the stake');
    // Bow toward the stake: the boat's forward (sin yaw, cos yaw) points from the boat to the stake.
    const bx = Math.sin(m.boat.yaw), bz = Math.cos(m.boat.yaw);
    const tx = (m.stake.x - m.boat.x) / out, tz = (m.stake.z - m.boat.z) / out;
    assert(bx * tx + bz * tz > 0.999, 'bow toward the stake');
    return `stake at ${rs.toFixed(2)} m, boat at ${Math.hypot(m.boat.x, m.boat.z).toFixed(2)} m`;
  });

  test(BOAT, 'the walker starts inland of the stake, facing inland', () => {
    const pad = { x: 0, z: -8, r: 2.5, fx: 0, fz: -1 };
    const m = /** @type {import('../src/world/intro/boat.js').Mooring} */ (mooringOf(pad, ground, M));
    const back = Math.hypot(m.stand.x - m.stake.x, m.stand.z - m.stake.z);
    assert(Math.abs(back - M.standInM) < 1e-9, `stand ${back} m from the stake`);
    assert(ground(m.stand.x, m.stand.z) > ground(m.stake.x, m.stake.z), 'the stand point is higher (inland)');
    // Facing inland: +z for a pad facing -z.
    assert(Math.abs(Math.sin(m.stand.yaw)) < 1e-9 && Math.cos(m.stand.yaw) > 0.999, `stand yaw ${m.stand.yaw}`);
    return `stand ${back.toFixed(2)} m inland, yaw ${m.stand.yaw.toFixed(3)}`;
  });

  test(BOAT, 'no pad gives no mooring; no low ground uses the search end', () => {
    eq(mooringOf(null, ground, M), null, 'null pad');
    const high = () => 5;
    const m = /** @type {import('../src/world/intro/boat.js').Mooring} */ (mooringOf({ x: 0, z: 0, r: 2, fx: 3, fz: 0 }, high, M));
    assert(Math.abs(m.stake.x - (2 + M.searchM)) < 1e-9 && m.stake.z === 0, `stake at ${m.stake.x}, ${m.stake.z}`);
  });

  test(BOAT, 'the stand-in meshes are whole: indices in range, unit normals, the hull about 2.6 by 1.1 m', async () => {
    const B = (await (await fetch(new URL('../recipes/world/boat.json', import.meta.url))).json()).boat;
    const all = boatMeshes(B);
    for (const [key, mesh] of Object.entries(all)) {
      if (key === 'bow') continue;
      const me = /** @type {{ vertices: Float32Array, indices: Uint32Array, count: number }} */ (mesh);
      assert(me.indices.length % 3 === 0 && me.indices.every((i) => i < me.count), `${key} indices`);
      for (let v = 0; v < me.count; v++) {
        const n = Math.hypot(me.vertices[v * 9 + 3], me.vertices[v * 9 + 4], me.vertices[v * 9 + 5]);
        assert(Math.abs(n - 1) < 1e-3, `${key} normal ${v} length ${n}`);
      }
    }
    const V = all.hull.vertices;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = 0; v < all.hull.count; v++) {
      x0 = Math.min(x0, V[v * 9]); x1 = Math.max(x1, V[v * 9]); y0 = Math.min(y0, V[v * 9 + 1]);
      z0 = Math.min(z0, V[v * 9 + 2]); z1 = Math.max(z1, V[v * 9 + 2]);
    }
    assert(Math.abs(z1 - z0 - 2.6) < 0.01 && Math.abs(x1 - x0 - 1.1) < 0.02, `hull ${(z1 - z0).toFixed(2)} by ${(x1 - x0).toFixed(2)} m`);
    assert(Math.abs(y0) < 1e-6, `keel at ${y0}`);
    return `hull ${all.hull.indices.length / 3} triangles, ${(z1 - z0).toFixed(2)} by ${(x1 - x0).toFixed(2)} m`;
  });
}
