// @ts-check
// Fishing and the angler's chart (docs/future/17) for tools/unit-tests.html: the worm split (the
// small red worm and the big dark worm in their own pouches, older saves unchanged).

import { cleanPack } from '../src/world/pack/model.js';
import { digFinds } from '../src/world/dig/finds.js';

const G = 'fishing';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addFishingTests(test, assert, eq) {
  test(G, 'the two worms keep apart: red worms from the topsoil, big dark worms from the subsoil, each its own pouch', async () => {
    const [Pk, D] = await Promise.all([load('world/pack'), load('world/dig')]);
    const kinds = Pk.kinds.map((/** @type {any} */ k) => k.id);
    assert(kinds.includes('worms') && kinds.includes('bigworms'), 'both are pouch kinds');
    const big = Pk.kinds.find((/** @type {any} */ k) => k.id === 'bigworms');
    eq(big.group, 'living', 'a living thing');
    eq(big.camp, 'none', 'set down, it digs itself in like the red worms');
    assert(D.words.wormsIn && D.words.bigWormsIn, 'the dig card says which pouch');
    // Dig the same cell in spring at both layers until each gives a worm: the layer says which.
    /** @type {Record<string, string>} */ const got = {};
    for (let day = 0; day < 40 && Object.keys(got).length < 2; day++) {
      for (const [layer, depth] of /** @type {[string, number][]} */ ([['topsoil', 1], ['subsoil', 2]])) {
        const f = digFinds({ seed: 7, cell: 11, day, layer, depth, season: 0, moisture: 0.3, rainBefore: false, frost: false, thin: 1, budgetLeft: 0 }, D, null);
        if (f.worm) got[layer] = f.worm;
      }
    }
    eq(got.topsoil, 'small', 'the topsoil gives the small red worm');
    eq(got.subsoil, 'big', 'the subsoil gives the big dark worm');
  });

  test(G, 'an older save keeps its worms as red worms, and a pack with big dark worms reads back', async () => {
    const Pk = await load('world/pack');
    const kinds = Pk.kinds.map((/** @type {any} */ k) => k.id);
    const old = cleanPack({ version: 1, pouches: [['worms', 2]], heaps: [] }, kinds, Pk);
    eq(old.pouches.filter((p) => p[0] === 'worms').length, 1, 'the worms pouch is still there, as red worms');
    const now = cleanPack({ version: 1, pouches: [['worms', 2], ['bigworms', 1]], heaps: [] }, kinds, Pk);
    assert(now.pouches.some((p) => p[0] === 'bigworms'), 'big dark worms keep their pouch');
  });
}
