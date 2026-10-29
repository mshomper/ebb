// @ts-check
// The volumetric fire's look (src/world/camp/fire-look.js): the flame's size from the fire's rules,
// the two feeds (as the game now, and the study's catch-then-surge), and the sim's fixed steps.
// Pure: fuel hours in, shown flame and flare out.

import { gameFlame, newFireLook, feedLook, stepFireLook, simSteps } from '../src/world/camp/fire-look.js';
import { noFire, layFire, lightFire, fireAt } from '../src/world/camp/fire.js';

const G = 'camp: fire look';
const F = { flameH: 3, maxFuelH: 9, highH: 1.5, lowFlame: 0.35, flare: 1.35, flareS: 2.5, emberH: 24, ashFadeH: 24 };
const S = { levelScale: 0.9, flareAdd: 0.22, feed: { catchS: 0.9, flareS: 1.6, puffS: 1.0, rise: 0.7, fall: 0.35, ease: 2.2 } };
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

  test(G, 'catch, then surge: the flame holds while the handful catches, then flares and settles', () => {
    const look = newFireLook();
    look.flame = 0.5;
    feedLook(look, 'surge', F);
    let o = stepFireLook(look, 0.5, 1, 'surge', F, S);
    assert(o.catching, 'catching at 0.5 s');
    eq(o.flame, 0.5, 'holds the size it had while catching');
    eq(o.flare, 0, 'no flare yet');
    o = stepFireLook(look, 0.5, 1, 'surge', F, S);
    assert(!o.catching, 'caught by 1.0 s');
    assert(o.flare > 0.7 && o.flare <= 1, 'the surge starts near 1');
    assert(o.smokePuff > 0.6, 'a smoke puff with it');
    assert(near(o.level, 0.9 * o.flame + 0.22 * o.flare), 'level = levelScale x flame + flareAdd x flare');
    for (let i = 0; i < 600; i++) o = stepFireLook(look, 1 / 60, 1, 'surge', F, S);
    assert(o.flare < 0.003, 'the surge has died away after 10 s');
    assert(o.flame > 0.99, 'the flame has risen to the game value');
  });

  test(G, 'catch, then surge: the flame rises faster than it falls', () => {
    const up = newFireLook(), down = newFireLook();
    down.flame = 1;
    const a = stepFireLook(up, 0.1, 1, 'surge', F, S).flame;
    const b = 1 - stepFireLook(down, 0.1, 0, 'surge', F, S).flame;
    assert(near(a, 0.7 * 0.1 * 2.2) && near(b, 0.35 * 0.1 * 2.2), 'rise 0.7 and fall 0.35, times ease 2.2');
  });

  test(G, 'as the game now: the flame jumps at once and flares by flare, gone after flareS', () => {
    const look = newFireLook();
    feedLook(look, 'now', F);
    let o = stepFireLook(look, 0, 1, 'now', F, S);
    assert(near(o.flame, 1.35), 'flares 1.35 at once');
    o = stepFireLook(look, 1.25, 1, 'now', F, S);
    assert(near(o.flame, 1 + 0.35 * 0.5), 'half the flare at half of flareS');
    o = stepFireLook(look, 1.25, 1, 'now', F, S);
    eq(o.flame, 1, 'back to the game value after flareS');
    eq(o.smokePuff, 0, 'no puff');
  });

  test(G, 'the sim steps at a fixed 60 a second, at most three a frame, carrying what is left', () => {
    const c = { acc: 0 };
    eq(simSteps(c, 1 / 60, 1 / 60, 3), 1, 'one step in a 60 fps frame');
    eq(simSteps(c, 1 / 120, 1 / 60, 3), 0, 'none in half a step');
    eq(simSteps(c, 1 / 120, 1 / 60, 3), 1, 'the carried half makes one');
    eq(simSteps(c, 0.5, 1 / 60, 3), 3, 'a long frame gives three at most');
    eq(simSteps(c, 0, 1 / 60, 3), 0, 'and drops the rest');
  });
}
