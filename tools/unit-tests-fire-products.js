// @ts-check
// Fire products tests (P2i, docs/future/13): fire-nights written before each burn overwrites the
// last, charcoal fuel's longer flame, the ring's charcoal and ash from dawn to dusk after a
// fire-night, the overnight work list (willow charcoal) giving the same answers however the hours
// are cut, ash patches and their marks, and nettles spreading only onto ash once they have come.

import { noFire, layFire, lightFire, feedFire, bankFire, settleFire, fireNights, fireAt, cleanFire } from '../src/world/camp/fire.js';
import { cleanWork, layWork, writeWork, workDone, fired, withFire, takeDone } from '../src/world/camp/work.js';
import { share, ringSpots, spotsAt, KINDS } from '../src/world/gather/spots.js';
import { PERIOD, periodOf, cleanGather } from '../src/world/gather/events.js';
import { spreadAsh, liveAshes, ashMarks, cleanAshes } from '../src/world/gather/ashes.js';
import { ashSpreadAt } from '../src/world/growth/volunteers.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';

const G = 'fire products';
const F = { flameH: 3, emberH: 24, ashFadeH: 24, maxFuelH: 9, fuelK: { charcoal: 2 }, night: { duskH: 20, dawnH: 4, needH: 3, keep: 3 } };
const RECIPE = { kinds: { charcoal: { source: 'ring', handfuls: [1, 1, 1, 1] }, ash: { source: 'ring', handfuls: [2, 2, 2, 2] } } };

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addFireProductsTests(test, assert, eq) {
  test(G, 'a fire lit at dusk makes a fire-night by dawn; a fire lit at noon and gone cold by dusk makes none', () => {
    const lit = /** @type {any} */ (lightFire(layFire(noFire(), 0), 24 * 2 + 19, F));
    eq(fireNights(lit, 24 * 2 + 21, F).length, 0, 'two hours in: not yet');
    eq(JSON.stringify(fireNights(lit, 24 * 2 + 23.5, F)), '[3]', 'three and a half hours: the night of the dawn of day 3');
    // A short noon fire with no embers kept: only its flame and a day of embers (embers count, so it does make one).
    const shortF = { ...F, emberH: 1 };
    const noon = /** @type {any} */ (lightFire(layFire(noFire(), 0), 12, shortF));
    eq(fireNights(noon, 40, shortF).length, 0, 'burned out by 16:00: no fire-night');
  });

  test(G, 'fire-nights survive a relighting, a banking and settling; the last three are kept', () => {
    let f = /** @type {any} */ (lightFire(layFire(noFire(), 0), 19, F));
    f = bankFire(f, 22, F);
    for (let d = 1; d < 6; d++) {
      f = settleFire(f, 24 * d + 12, F);
      f = /** @type {any} */ (lightFire(f, 24 * d + 19, F) ?? feedFire(f, 24 * d + 19, F));
    }
    const n = fireNights(f, 24 * 6 + 8, F);
    eq(n.length, 3, 'three kept');
    eq(n[2], 6, 'the newest is the dawn of day 6');
    eq(JSON.stringify(cleanFire(JSON.parse(JSON.stringify(f)))), JSON.stringify(f), 'saved and loaded, the same');
  });

  test(G, 'a night split between two burns still adds up (carried hours)', () => {
    const shortF = { ...F, emberH: 0.01 };
    // 20:00 to 21:30, out, then 02:00 to 03:45: 1.5 + 1.75 hours in the one night.
    let f = /** @type {any} */ (lightFire(layFire(noFire(), 0), 20, { ...shortF, flameH: 1.5 }));
    f = settleFire(f, 23, shortF);
    eq(fireAt(f, 23, shortF).word, 'cold', 'out by 23:00');
    f = /** @type {any} */ (lightFire(f, 26, { ...shortF, flameH: 1.75 }));
    eq(fireNights(f, 29, shortF).length, 1, 'one fire-night from the two burns');
  });

  test(G, 'charcoal burns twice the flame hours of sticks, and the card knows it', () => {
    const lit = /** @type {any} */ (lightFire(layFire(noFire(), 0), 10, F));
    const fedSticks = /** @type {any} */ (feedFire(lit, 10, F, 'sticks'));
    const fedChar = /** @type {any} */ (feedFire(lit, 10, F, 'charcoal'));
    eq(fedSticks.flameUntilHour, 16, 'sticks: three more');
    eq(fedChar.flameUntilHour, 19, 'charcoal: six more');
    assert(fedChar.charcoal && !fedSticks.charcoal, 'charcoal flagged on the burn');
  });

  test(G, 'the ring gives charcoal and ash from dawn until dusk after a fire-night, and nothing otherwise', () => {
    const ring = { x: 1, z: 2, r: 0.8, nights: [5], dawnH: 4, duskH: 20 };
    const at = (/** @type {number} */ hour) => ({ seed: 7, day: Math.floor(hour / 24), season: 0, hour, ring });
    const p = periodOf(PERIOD.ring, 5);
    eq(share('charcoal', 0, p, at(5 * 24 + 6), RECIPE), 1, 'one handful of charcoal at 06:00');
    eq(share('ash', 0, p, at(5 * 24 + 6), RECIPE), 2, 'two of ash');
    eq(share('charcoal', 0, p, at(5 * 24 + 3), RECIPE), 0, 'not before dawn');
    eq(share('charcoal', 0, p, at(5 * 24 + 20.5), RECIPE), 0, 'gone at dusk');
    eq(share('charcoal', 0, periodOf(PERIOD.ring, 6), at(6 * 24 + 8), RECIPE), 0, 'the next day, no fire-night: none');
    eq(ringSpots(1.2, 2, 0, at(5 * 24 + 6), RECIPE).length, 2, 'a tap on the ring finds both');
    eq(spotsAt(9, 9, at(5 * 24 + 6), RECIPE).length, 0, 'a tap far off finds neither');
    eq(KINDS.slice(-2).join(','), 'charcoal,ash', 'appended at the end of the kinds');
  });

  test(G, 'willow charcoal: done after eight hours of fire, lit or banked, however the hours are cut', () => {
    const make = { id: 'willow-charcoal', needH: 8, gives: 'charcoal-sticks', count: 3 };
    let c = { fire: layFire(noFire(), 0), work: layWork([], make, 18) };
    assert(!workDone(c.work[0], c.fire, 40, F), 'a laid, unlit ring does nothing');
    c = withFire(c, /** @type {any} */ (lightFire(c.fire, 19, F)), 19, F);
    c = withFire(c, bankFire(c.fire, 21, F), 21, F);
    assert(!workDone(c.work[0], c.fire, 26, F), 'seven hours in: not yet');
    assert(workDone(c.work[0], c.fire, 27, F), 'eight hours: done by morning');
    // The same night settled hour by hour (catch-up) gives the same.
    let d = { fire: c.fire, work: c.work };
    for (let h = 22; h <= 27; h++) d = withFire(d, settleFire(d.fire, h, F), h, F);
    eq(Math.round(fired(d.work[0], d.fire, 27, F) * 1000), Math.round(fired(c.work[0], c.fire, 27, F) * 1000), 'stepwise, the same hours');
    const t = takeDone(writeWork(d.work, d.fire, 27, F), d.fire, 27, F);
    eq(t.piece?.gives, 'charcoal-sticks', 'taken up: charcoal sticks');
    eq(t.work.length, 0, 'off the list');
    eq(JSON.stringify(cleanWork(JSON.parse(JSON.stringify(c.work)))), JSON.stringify(c.work), 'saved and loaded, the same');
  });

  test(G, 'ash patches: at most six, gone after their days, kept in the gather section, drawn after the holes', () => {
    const S = { patchM: 1.2, days: 14, max: 6 };
    let a = /** @type {any[]} */ ([]);
    for (let i = 0; i < 8; i++) a = spreadAsh(a, i, 0, 100 + i, S);
    eq(a.length, 6, 'six kept');
    eq(a[0][0], 2, 'the oldest went first');
    eq(liveAshes(a, 100 + 14 * 24 + 3, S).length, 4, 'two have gone by their fourteenth day');
    const g = cleanGather({ version: 1, events: [1, 8, 1], ashes: a });
    eq(g.ashes?.length, 6, 'the gather section keeps them');
    eq(cleanGather({ version: 1, events: [] }).ashes, undefined, 'none: no key, as before');
    eq(cleanAshes([[1, 2], 'x', [1, 2, 3]]).length, 1, 'bad entries dropped');
    const holes = new Float32Array(16 * 8);
    holes.set([5, 5, 0.2, 0.8, 0.1, 0.1, 0.1, 0.3], 0);
    const m = ashMarks(holes, [{ x: 1, z: 1, r: 0.6, fresh: 1 }], [0, 0], { rgb: [0.36, 0.35, 0.33], strength: 0.7, nearM: 30 });
    eq(m[2], Math.fround(0.2), 'the hole stays first');
    eq(m[8 + 2], Math.fround(0.6), 'the ash in the next slot');
    assert(m[8 + 3] < 0, 'its mouth darkness negative: an ash wash');
  });

  test(G, 'nettles come up on ash only once they are on the island, one a patch, the same each run', () => {
    const n = HABITAT_CELLS, open = new Uint8Array(n * n).fill(1);
    const hab = /** @type {any} */ ({ n, open, ash: { patches: [[HABITAT_ORIGIN + 50.5, HABITAT_ORIGIN + 50.5, 0]], r: 0.6, days: 14 } });
    const env = { seed: 11, recipes: { growth: { volunteers: { minSuit: 0.5 } }, flora: { nettle: { volunteer: { cause: { kind: 'fire', ash: { chancePerH: 1 } } }, spread: { maxCount: 16 } } } } };
    const suit = () => 1, free = () => false;
    eq(ashSpreadAt({ arrived: {}, plants: [] }, hab, env, 5, suit, free), null, 'not on the island yet: never');
    const a = ashSpreadAt({ arrived: { nettle: 0 }, plants: [] }, hab, env, 5, suit, free);
    assert(a && a.sp === 'nettle', 'on the island: one comes up on the ash');
    const b = ashSpreadAt({ arrived: { nettle: 0 }, plants: [] }, hab, env, 5, suit, free);
    eq(b?.k, a?.k, 'the same square each run');
    const x = HABITAT_ORIGIN + 50.5, z = HABITAT_ORIGIN + 50.5;
    eq(ashSpreadAt({ arrived: { nettle: 0 }, plants: [{ sp: 'nettle', x, z }] }, hab, env, 5, suit, free), null, 'one a patch');
    eq(ashSpreadAt({ arrived: { nettle: 0 }, plants: [] }, hab, env, 15 * 24, suit, free), null, 'after its days: never');
  });
}
