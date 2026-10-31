// @ts-check
// The small lights (doc 06, Lanterns and small lights; src/render/light-pick.js): with more lights
// than the shaders take, the nearest bright ones are drawn; a light coming in or going out fades
// rather than snapping; the drawn count never passes the limit; the JS and WGSL limits agree and
// the uniform buffer holds them.

import { createLightPicker, lightScore, reachesView } from '../src/render/light-pick.js';
import { MAX_POINT_LIGHTS, LIGHT_UNIFORM_BYTES } from '../src/render/lighting.js';

const G = 'small lights';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();
const WHITE = [1, 1, 1];
/** A lantern-like light at x, z. @param {string} key @param {number} x @param {number} z @param {number} [cd] */
const L = (key, x, z, cd = 8) => ({ key, x, y: 0.5, z, rangeM: 8, cd, rgb: WHITE });

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addSmallLightsTests(test, assert, eq) {
  test(G, 'the limit is eight in the code and the shaders, and the buffer holds them', async () => {
    const R = await load('world/small-lights');
    eq(MAX_POINT_LIGHTS, 8, 'eight in lighting.js');
    const wgsl = await (await fetch(new URL('../src/shaders/common.wgsl', import.meta.url))).text();
    assert(/const MAX_POINT_LIGHTS: u32 = 8u;/.test(wgsl), 'eight in common.wgsl');
    assert(/points: array<vec4f, 16>/.test(wgsl), 'two vec4s a light in LightUniforms');
    eq(LIGHT_UNIFORM_BYTES, (68 + MAX_POINT_LIGHTS * 8) * 4, 'the uniform buffer fits the struct');
    assert(R.max <= MAX_POINT_LIGHTS && R.fadeS > 0, 'the recipe asks for no more than the shaders take');
  });

  test(G, 'with twelve lights, the nearest bright ones are drawn, and out of reach ones never', async () => {
    const R = await load('world/small-lights'), P = createLightPicker(R, MAX_POINT_LIGHTS), eye = [0, 2, 0], target = [0, 0, 0];
    const list = Array.from({ length: 12 }, (_, i) => L(`lantern:${i}`, i * 1.5 + 1, 0));
    list.push(L('far', 200, 0, 1000));
    let out = [];
    for (let k = 0; k < 40; k++) out = P.pick(list, eye, target, 1 / 60);
    eq(out.length, R.max, `${R.max} drawn`);
    eq(out.map((l) => l.key).sort().join(), list.slice(0, R.max).map((l) => l.key).sort().join(), 'the nearest eight');
    assert(!out.some((l) => l.key === 'far'), 'a bright light far past the view is never drawn');
    assert(out.every((l) => Math.abs(l.cd - 8) < 1e-9), 'fully in after the fade');
    assert(lightScore(L('a', 1, 0, 8), eye) > lightScore(L('b', 6, 0, 8), eye) && lightScore(L('c', 6, 0, 80), eye) > lightScore(L('d', 3, 0, 8), eye), 'nearer or brighter scores higher');
    assert(!reachesView(L('x', 40, 0), target, R.viewReachM) && reachesView(L('y', 30, 0), target, R.viewReachM), 'reach: range plus viewReachM');
  });

  test(G, 'a swap fades rather than snaps, and the count never passes the limit', async () => {
    const R = await load('world/small-lights'), P = createLightPicker(R, MAX_POINT_LIGHTS), target = [0, 0, 0];
    const list = Array.from({ length: 12 }, (_, i) => L(`lantern:${i}`, i * 1.5 + 1, 0));
    for (let k = 0; k < 40; k++) P.pick(list, [0, 2, 0], target, 1 / 60);
    // Walk to the far end: the far lanterns become the nearest.
    const eye = [18, 2, 0], dt = 1 / 60;
    let max = 0, sawHalf = false, outFirst = P.pick(list, eye, target, dt);
    const leaving = outFirst.find((l) => l.key === 'lantern:0');
    assert(!!leaving && leaving.cd > 0 && leaving.cd < 8, `the light going out dims first (${leaving?.cd.toFixed(2)} cd), not off at once`);
    for (let k = 0; k < 90; k++) {
      const out = P.pick(list, eye, target, dt);
      max = Math.max(max, out.length);
      if (out.some((l) => l.key === 'lantern:11' && l.cd > 1 && l.cd < 7)) sawHalf = true;
    }
    assert(max <= R.max, `never more than ${R.max} at once (${max})`);
    assert(sawHalf, 'the light coming in rose through half bright');
    const end = P.pick(list, eye, target, dt).map((l) => l.key);
    assert(end.includes('lantern:11') && !end.includes('lantern:0'), 'after the fades, the near ones are the drawn ones');
    // A light taken away is gone at once (there is nothing left to fade).
    const fewer = list.filter((l) => l.key !== 'lantern:11');
    assert(!P.pick(fewer, eye, target, dt).some((l) => l.key === 'lantern:11'), 'a lantern taken up goes at once');
  });
}
