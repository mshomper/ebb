// @ts-check
// Creature tests for tools/unit-tests.html: the frog body bakes to the same clean mesh every time,
// at its real size, and the frog size preview finds its spots around a pond.

import { bakeBody } from '../src/world/creatures/body-bake.js';
import { previewSpots } from '../src/world/creatures/preview-spots.js';
import { shoreline } from './unit-tests-growth.js';

const CREATURES = 'creatures';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCreatureTests(test, assert, eq) {
  test(CREATURES, 'the frog body bakes to the same clean mesh twice, at real size', async () => {
    const r = await fetch('../recipes/species/frog.json').then((x) => x.json());
    const a = bakeBody(r.body, r.bake.cellM);
    const b = bakeBody(r.body, r.bake.cellM);
    eq(a.vertices.length, b.vertices.length, 'vertex floats');
    let same = true;
    for (let i = 0; i < a.vertices.length; i++) if (a.vertices[i] !== b.vertices[i]) { same = false; break; }
    assert(same, 'identical vertices');
    assert(a.vertices.every(Number.isFinite), 'every number finite');
    let maxIdx = 0;
    for (const i of a.indices) maxIdx = Math.max(maxIdx, i);
    assert(maxIdx < a.count, 'indices in range');
    // Real size: the mesh's length (z) and height sit inside a common frog's.
    let z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < a.count; v++) { z0 = Math.min(z0, a.vertices[v * 9 + 2]); z1 = Math.max(z1, a.vertices[v * 9 + 2]); y1 = Math.max(y1, a.vertices[v * 9 + 1]); }
    const len = z1 - z0;
    assert(len > 0.06 && len < 0.1, `length ${(len * 100).toFixed(1)} cm`);
    assert(y1 > 0.03 && y1 < 0.06, `height ${(y1 * 100).toFixed(1)} cm`);
    return `${a.count} vertices, ${a.indices.length / 3} triangles; ${(len * 100).toFixed(1)} cm long, ${(y1 * 100).toFixed(1)} cm tall`;
  });

  test(CREATURES, 'the size preview sets frogs on the bank and in the shallows of a pond', () => {
    const hab = shoreline();
    const found = previewSpots(hab, { plants: [] }, { ground: () => 1, surface: () => 1.1, from: [0, 60] });
    assert(found, 'spots found on the shoreline');
    const f = /** @type {NonNullable<typeof found>} */ (found);
    eq(f.spots.filter((s) => s.where === 'bank').length, 4, 'frogs on the bank');
    assert(f.edgeM > 0 && f.pondM2 > 0, `pond edge ${f.edgeM} m, area ${f.pondM2} m2`);
    return `pond edge about ${f.edgeM} m; ${f.spots.map((s) => s.where).join(', ')}`;
  });
}
