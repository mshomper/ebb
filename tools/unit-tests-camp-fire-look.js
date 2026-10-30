// @ts-check
// The volumetric fire's look (src/world/camp/fire-look.js): the flame's size from the fire's rules,
// the catch-then-surge of a handful fed, the sim's fixed steps, and when the sim runs (it stops when
// the fire is cold, out of view, or the tier leaves it out). Pure: fuel hours in, shown flame and
// flare out.

import { gameFlame, newFireLook, feedLook, stepFireLook, simSteps, fireSimRuns } from '../src/world/camp/fire-look.js';
import { noFire, layFire, lightFire, feedFire, fireAt } from '../src/world/camp/fire.js';

const G = 'camp: fire look';
const F = { flameH: 3, maxFuelH: 9, highH: 1.5, lowFlame: 0.35, catchS: 0.9, flare: 0.22, flareS: 1.6, emberH: 24, ashFadeH: 24 };
const S = { levelScale: 0.9, feed: { puffS: 1.0, rise: 0.7, fall: 0.35, ease: 2.2 } };
const near = (/** @type {number} */ a, /** @type {number} */ b, e = 1e-6) => Math.abs(a - b) < e;

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addCampFireLookTests(test, assert, eq) {
  test(G, 'the shown flame follows the rules: high above highH, sinking to lowFlame, nothing as embers or cold', () => {
    const lit = /** @type {any} */ (lightFire(layFire(noFire(), 0), 0, F));
    eq(gameFlame(fireAt(lit, 0, F), F), 1, 'burning high just lit (3 h left)');
    eq(gameFlame(fireAt(lit, 1.5, F), F), 1, 'still high at 1.5 h left');
    assert(near(gameFlame(fireAt(lit, 2.25, F), F), 0.35 + 0.65 * 0.5), 'half way down the low flames');
    assert(near(gameFlame(fireAt(lit, 2.9999, F), F), 0.35, 1e-3), 'nearly lowFlame just before embers');
    eq(gameFlame(fireAt(lit, 3, F), F), 0, 'embers: no flame');
    eq(gameFlame(fireAt(lit, 40, F), F), 0, 'cold: no flame');
  });

  test(G, 'feeding changes the fuel hours at once; only the look waits', () => {
    const lit = /** @type {any} */ (lightFire(layFire(noFire(), 0), 0, F));
    const fed = /** @type {any} */ (feedFire(lit, 2.5, F));
    eq(fireAt(fed, 2.5, F).flameLeftH, 3.5, 'three more hours the moment it is fed');
    eq(gameFlame(fireAt(fed, 2.5, F), F), 1, 'the rules say burning high at once');
    const look = newFireLook(gameFlame(fireAt(lit, 2.5, F), F));
    feedLook(look);
    const o = stepFireLook(look, 0.1, 1, F, S);
    assert(o.catching && o.flame < 0.7, 'the shown flame still holds its low size while it catches');
  });

  test(G, 'catch, then surge: the flame holds while the handful catches, then surges and settles', () => {
    const look = newFireLook(0.5);
    feedLook(look);
    let o = stepFireLook(look, 0.5, 1, F, S);
    assert(o.catching, 'catching at 0.5 s');
    eq(o.flame, 0.5, 'holds the size it had while catching');
    eq(o.flare, 0, 'no surge yet');
    o = stepFireLook(look, 0.5, 1, F, S);
    assert(!o.catching, 'caught by 1.0 s');
    assert(o.flare > 0.7 && o.flare <= 1, 'the surge starts near 1');
    assert(o.smokePuff > 0.6, 'a smoke puff with it');
    assert(near(o.light, o.flame + 0.22 * o.flare), 'the light is the flame plus flare x the surge');
    assert(near(o.level, 0.9 * o.light), 'level = levelScale x light');
    for (let i = 0; i < 600; i++) o = stepFireLook(look, 1 / 60, 1, F, S);
    assert(o.flare < 0.003, 'the surge has died away after 10 s');
    assert(o.flame > 0.99, 'the flame has risen to the game value');
  });

  test(G, 'catch, then surge: the flame rises faster than it falls', () => {
    const up = newFireLook(0), down = newFireLook(1);
    const a = stepFireLook(up, 0.1, 1, F, S).flame;
    const b = 1 - stepFireLook(down, 0.1, 0, F, S).flame;
    assert(near(a, 0.7 * 0.1 * 2.2) && near(b, 0.35 * 0.1 * 2.2), 'rise 0.7 and fall 0.35, times ease 2.2');
  });

  test(G, 'the sim steps at a fixed 60 a second, at most three a frame, carrying what is left', () => {
    const c = { acc: 0 };
    eq(simSteps(c, 1 / 60, 1 / 60, 3), 1, 'one step in a 60 fps frame');
    eq(simSteps(c, 1 / 120, 1 / 60, 3), 0, 'none in half a step');
    eq(simSteps(c, 1 / 120, 1 / 60, 3), 1, 'the carried half makes one');
    eq(simSteps(c, 0.5, 1 / 60, 3), 3, 'a long frame gives three at most');
    eq(simSteps(c, 0, 1 / 60, 3), 0, 'and drops the rest');
  });

  test(G, 'the sim runs only while lit and a few seconds after, in view, with the tier on', () => {
    const base = { tierOn: true, inView: true, lit: true, sinceLitS: 0, afterS: 6 };
    eq(fireSimRuns(base), true, 'lit, in view, tier on');
    eq(fireSimRuns({ ...base, lit: false, sinceLitS: 3 }), true, 'embers for 3 s: the last smoke drifts off');
    eq(fireSimRuns({ ...base, lit: false, sinceLitS: 6 }), false, 'stops after afterS');
    eq(fireSimRuns({ ...base, lit: false, sinceLitS: Infinity }), false, 'cold: never ran');
    eq(fireSimRuns({ ...base, inView: false }), false, 'out of view');
    eq(fireSimRuns({ ...base, tierOn: false }), false, 'tier off');
  });
}
