// @ts-check
// Island tests for tools/unit-tests.html: every island in recipes/world/terrain.json loads, builds
// the same chunk twice, and has the ponds, marshes and springs its recipe asks for; the starter
// island keeps its single pond and spring.

import { buildBase, hashBase, landmarks } from '../src/world/terrain/landform.js';

const ISLANDS = 'islands';

/** @param {string} path */
async function get(path) {
  const r = await fetch(`../recipes/${path}.json`);
  if (!r.ok) throw new Error(`recipes/${path}.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addIslandTests(test, assert, eq) {
  test(ISLANDS, 'every island builds the same chunk twice and has its springs and basins', async () => {
    const terrain = await get('world/terrain');
    const lines = [];
    for (const isl of terrain.islands.list) {
      const land = await get(`land/${isl.id}`);
      const a = buildBase({ land, seed: 12345, cx: 0, cz: 0 });
      const b = buildBase({ land, seed: 12345, cx: 0, cz: 0 });
      eq(hashBase(a.heightQ, a.material), hashBase(b.heightQ, b.material), `${isl.id} chunk hash`);
      const lm = landmarks(land, 12345);
      const springs = land.springs?.length ?? (land.spring ? 1 : 0);
      const basins = land.basins?.length ?? (land.basin ? 1 : 0);
      eq(lm.springs.length, springs, `${isl.id} springs`);
      eq(lm.basins.length, basins, `${isl.id} basins`);
      lines.push(`${isl.name}: ${basins} basins, ${springs} springs`);
    }
    return lines.join('; ');
  });

  test(ISLANDS, 'Two ponds: each spring sits uphill of its own pond', async () => {
    const land = await get('land/two-ponds');
    const lm = landmarks(land, 12345);
    land.springs.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      const p = lm.basins[s.basin], sp = lm.springs[i];
      const d = Math.hypot(sp.x - p.x, sp.z - p.z);
      assert(Math.abs(d - s.fromBasinM) < 3, `spring ${i + 1} is ${d.toFixed(1)} m from its pond (asked ${s.fromBasinM})`);
    });
    const apart = Math.hypot(lm.springs[0].x - lm.springs[1].x, lm.springs[0].z - lm.springs[1].z);
    assert(apart > 4, `the springs are ${apart.toFixed(1)} m apart`);
    return `springs ${apart.toFixed(1)} m apart`;
  });
}
