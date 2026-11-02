// @ts-check
// Shaping the meadow islet (m2-islet-brushes) for tools/unit-tests.html: a brushed chunk of the
// islet's new land is saved with its heights and paint and comes back marked raised; one only drawn
// by the rise is not saved (it regrows from the seed); the open chunks are as before.

import { encode, decode } from '../src/save/world-file.js';
import { snapshot, restore, copyChunk } from '../src/save/sections.js';
import { createMirror } from '../src/world/terrain/heightfield.js';

const G = 'islet-brushes';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addIsletBrushesTests(test, assert, eq) {
  test(G, 'a brushed islet chunk is saved and comes back raised; an unbrushed one is not saved', async () => {
    const m = createMirror();
    for (let k = 0; k < m.heightQ.length; k++) { m.heightQ[k] = (k * 5) & 0xffff; m.material[4 * k] = k & 0xff; }
    const land = 'land/starter-island';
    const parts = {
      build: 'test', seed: 7, island: 'starter-island', worldT: 3600, flow: /** @type {1} */ (1), world: { tide: { level: 0 } },
      journal: null, water: null, unlocks: {}, view: null, looks: {}, savedAt: 1, wallHighWater: 1, mirror: m,
      chunks: { '0,0': { state: 'open', land, edited: false }, '2,0': { state: 'raised', land, edited: true }, '2,1': { state: 'raised', land, edited: false } },
    };
    const { header, sections } = snapshot(/** @type {any} */ (parts));
    const r = restore((await decode(await encode(header, sections))).sections);
    const brushed = r.chunks.find((c) => c.cx === 2 && c.cz === 0);
    assert(brushed?.raised, 'the brushed islet chunk is marked raised');
    const want = copyChunk(m, 2, 0);
    assert(brushed?.heightQ?.every((q, i) => q === want.heightQ[i]), 'its heights come back');
    assert(brushed?.material?.every((q, i) => q === want.material[i]), 'its paint comes back');
    assert(!r.chunks.some((c) => c.cx === 2 && c.cz === 1), 'an islet chunk only the rise drew is not saved');
    const open = r.chunks.find((c) => c.cx === 0 && c.cz === 0);
    assert(open && !open.raised && !open.heightQ, 'an untouched open chunk is saved as before, without heights');
    eq(r.bad.length, 0, 'nothing read as damaged');
  });
}
