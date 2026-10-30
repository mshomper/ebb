// @ts-check
// Beach glints (src/world/glints.js): each glint keeps its own seeded rhythm, flashes briefly and only
// now and then, facets stay within the recipe's tilt of up, bottles glint strongest, and only the
// recipe's finds glint (living finds and ground pickups never do).

import { glintSeed, flashAt, facetAt, keepsakeGlints, findGlints } from '../src/world/glints.js';

const G = 'glints';
const load = async () => (await fetch(new URL('../recipes/world/glints.json', import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addGlintsTests(test, assert, eq) {
  test(G, 'a glint flashes briefly and only now and then: lit a small share of the time', async () => {
    const R = await load(), seed = glintSeed('3:1234');
    let lit = 0, n = 0;
    for (let t = 0; t < 600; t += 0.05, n++) if (flashAt(t, seed, R).env > 0) lit++;
    const share = lit / n, mean = (R.everyS[0] + R.everyS[1]) / 2;
    assert(share > 0 && share < 0.2, `lit ${(share * 100).toFixed(1)}% of the time`);
    assert(Math.abs(share - (R.chance * R.flashS) / mean) < 0.06, 'about chance x flash / gap');
    eq(flashAt(12.3, seed, R).env, flashAt(12.3, seed, R).env, 'the same time, the same flash');
  });

  test(G, 'glints keep their own rhythms: two never flash in step', async () => {
    const R = await load(), a = glintSeed('1:10'), b = glintSeed('1:11');
    let both = 0, either = 0;
    for (let t = 0; t < 600; t += 0.05) {
      const x = flashAt(t, a, R).env > 0, y = flashAt(t, b, R).env > 0;
      if (x && y) both++;
      if (x || y) either++;
    }
    assert(either > 0 && both / either < 0.3, 'mostly apart');
  });

  test(G, 'each flash tilts a facet within the recipe\'s tilt of straight up', async () => {
    const R = await load(), cos = Math.cos((R.facetDeg * Math.PI) / 180);
    for (let c = 0; c < 200; c++) {
      const n = facetAt(glintSeed('x'), c, R);
      assert(Math.abs(Math.hypot(...n) - 1) < 1e-9 && n[1] >= cos - 1e-9, 'unit, near up');
    }
  });

  test(G, 'bottles glint strongest; only the recipe\'s finds glint, never living finds or pickups', async () => {
    const R = await load();
    const k = keepsakeGlints([{ id: 'a', x: 0, y: 0, z: 0, n: { family: 'bottle' } }, { id: 'b', x: 1, y: 0, z: 0, n: { family: 'shell' } }], R);
    eq(k[0].boost, R.bottle, 'a bottle');
    eq(k[1].boost, 1, 'any other keepsake');
    assert(R.bottle > 1, 'bottles stronger');
    const f = findGlints([{ sp: 'sanddollars', x: 0, z: 0, storm: false }, { sp: 'hermitcrab', x: 1, z: 0, storm: false },
      { sp: 'shells', x: 2, z: 0, storm: false }, { sp: 'shells', x: 3, z: 0, storm: true }], () => 0, R);
    eq(f.length, R.stormShells ? 2 : 1, 'a sand dollar and a storm shell; no crab, no everyday shell');
    for (const id of ['pebbles', 'flat-stones', 'wrack', 'kelp', 'sticks', 'shells']) assert(!R.finds.includes(id), `${id} never glints`);
  });
}
