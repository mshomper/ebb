// @ts-check
// Plant rules (docs/future/13 section 5, P2a) for tools/unit-tests.html: how a picked, thin or
// drowned plant looks (A1).

import { plantLooks, pickShares } from '../src/world/growth/looks.js';
import { packLooks } from '../src/render/passes/flora.js';
import { loadShader } from '../src/core/gpu.js';

const G = 'plant rules';

/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPlantRulesTests(test, assert, eq) {
  // Within float32 rounding (the packed looks are a Float32Array).
  const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ msg) => assert(Math.abs(a - b) < 1e-6, `${msg}: expected ${b}, got ${a}`);

  test(G, 'looks: one full pick reads 1, half a pick 0.5, a whole plant 0', async () => {
    const gather = await json('world/gather');
    const takes = pickShares(gather);
    const take = takes.get('reeds');
    assert(take && take > 0, 'reeds give down, so they have a pick share');
    const rec = { growth: { lowHours: 72, drownHours: 48 } };
    const L = { thinRampH: 24 };
    const full = { size: 0.95, best: 0.95, low: 0, drown: 0 };
    eq(plantLooks(full, rec, L, take)[0], 0, 'whole');
    near(plantLooks({ ...full, size: 0.95 * (1 - take) }, rec, L, take)[0], 1, 'one pick');
    near(plantLooks({ ...full, size: 0.95 * (1 - take / 2) }, rec, L, take)[0], 0.5, 'half a pick');
    eq(plantLooks({ ...full, size: 0.2 }, rec, L, take)[0], 1, 'never past 1');
    eq(plantLooks({ ...full, size: 0.5 }, rec, L, undefined)[0], 0, 'a species with no gather part never looks picked');
    return `reeds take ${take}`;
  });

  test(G, 'looks: thin ramps over thinRampH after lowHours and hides the picked look; drowned is drown over drownHours', () => {
    const rec = { growth: { lowHours: 72, drownHours: 48 } };
    const L = { thinRampH: 24 };
    const p = { size: 0.5, best: 0.9, low: 72, drown: 0 };
    eq(plantLooks(p, rec, L, 0.33)[1], 0, 'not thin at lowHours');
    near(plantLooks({ ...p, low: 84 }, rec, L, 0.33)[1], 0.5, 'half way up the ramp');
    eq(plantLooks({ ...p, low: 200 }, rec, L, 0.33)[1], 1, 'fully thin');
    eq(plantLooks({ ...p, low: 84 }, rec, L, 0.33)[0], 0, 'a thin plant does not also look picked');
    near(plantLooks({ ...p, drown: 12 }, rec, L, 0.33)[2], 0.25, 'drowned a quarter');
    eq(plantLooks({ ...p, drown: 99 }, rec, L, 0.33)[2], 1, 'drowned never past 1');
  });

  test(G, 'the draw numbers: 12 floats a plant, lib-flora reads three vec4f, the looks pack in its order', async () => {
    const lib = await loadShader('lib-flora');
    assert(/const FLORA_STRIDE: u32 = 3u;/.test(lib), 'lib-flora reads three vec4f a plant');
    assert(/@group\(2\) @binding\(4\) var<uniform> floraLooks/.test(lib), 'the looks at binding 4');
    for (const s of ['flora-draw', 'flora-iris', 'flora-thrift', 'flora-shrub', 'flora-lilies', 'flora-pondweed']) {
      const src = await loadShader(s);
      assert(!/plants\[ii \* 2u/.test(src), `${s} no longer reads two vec4f a plant`);
    }
    const growth = await json('world/growth');
    const L = growth.looks;
    const f = packLooks(L);
    eq(f.length, 12, 'three vec4f');
    near(f[0], L.pickHeads, 'pick.x'); near(f[1], L.pickTrim, 'pick.y'); near(f[2], L.cutFrom, 'pick.z'); near(f[3], L.cutBlades, 'pick.w');
    near(f[4], L.thinPale, 'thin.x'); near(f[5], L.thinSparse, 'thin.y');
    near(f[8], L.drownLean, 'drown.x'); near(f[9], L.drownDark, 'drown.y'); near(f[10], L.drownDroop, 'drown.z');
    eq(packLooks(undefined)[0], 0, 'no looks recipe: no look');
  });
}
