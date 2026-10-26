// @ts-check
// Teas as boons tests for tools/unit-tests.html (P2e, docs/future/13 section 7): what the laid herbs
// brew (a single cup, a blend, Deep rest only with a dried herb, any other pair the stronger herb's
// cup with its taste line); every boon's multipliers on, and every one off without a tea; one tea at
// a time (a new cup replaces); the countdown runs only on game hours played (a jump, a rest or time
// away, is not counted) and Deep rest wakes into its day; the boon rides the camp section through a
// save and a reload; the tea notes for the camp page; the dig's act keeping pace with its lift.

import { brew, herbOf, blendKey, pairKey, tasteLine, drankLine, cleanTeaNotes, noteTea } from '../src/world/camp/brew.js';
import { cleanBoon, drink, tick, shareOf, liftOf, wake, leftWord, NO_LIFT, createBoons } from '../src/world/camp/boons.js';
import { cleanCamp } from '../src/world/camp/model.js';
import { actLength, setActRate } from '../src/world/figure/acts.js';
import { get, update } from '../src/core/store.js';

const G = 'teas';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addTeasTests(test, assert, eq) {
  const cookP = json('world/cook'), figureP = json('world/figure');

  test(G, 'one herb, or two of the same, is its own cup', async () => {
    const C = await cookP;
    eq(herbOf('watermint.leaves', C.teas), 'watermint');
    eq(herbOf('dried:chamomile.flowers', C.teas), 'chamomile', 'a dried herb is still its herb');
    eq(herbOf('sticks', C.teas), null, 'sticks are no tea');
    eq(brew(['nettle.tops'], C)?.id, 'nettle');
    const two = brew(['gorse.flowers', 'gorse.flowers'], C);
    eq(two?.id, 'gorse'); eq(two?.pair, null, 'no pair from one herb twice');
    eq(brew(['sticks'], C), null);
    eq(brew([], C), null);
  });

  test(G, 'the five blends, in either order; Deep rest wants a dried herb', async () => {
    const C = await cookP;
    for (const [a, b, id] of [['watermint.leaves', 'nettle.tops', 'watermint+nettle'], ['chamomile.flowers', 'meadowsweet.flowers', 'meadowsweet+chamomile'],
      ['gorse.flowers', 'chamomile.flowers', 'gorse+chamomile'], ['gorse.flowers', 'willow.bark', 'willow+gorse']]) {
      eq(brew([a, b], C)?.id, id, `${a} + ${b}`); eq(brew([b, a], C)?.id, id, `${b} + ${a}`);
      assert(brew([a, b], C)?.blend, `${id} is a blend`);
    }
    const fresh = brew(['willow.bark', 'chamomile.flowers'], C);
    eq(fresh?.id, 'willow', 'fresh willow and chamomile: the stronger herb alone');
    eq(fresh?.taste, 'dry', 'with a line that wants something drier');
    eq(brew(['willow.bark', 'dried:chamomile.flowers'], C)?.id, 'willow+chamomile', 'one dried: Deep rest');
    eq(brew(['dried:willow.bark', 'chamomile.flowers'], C)?.id, 'willow+chamomile');
    eq(blendKey('meadowsweet', 'watermint', C.boons), null, 'the waking boon is never brewed');
  });

  test(G, 'any other pair: the stronger herb, a taste line the same each time', async () => {
    const C = await cookP, W = C.words;
    const t = brew(['watermint.leaves', 'gorse.flowers'], C);
    eq(t?.id, 'gorse', 'gorse is stronger than water mint (teas.strength)');
    eq(t?.pair, pairKey('watermint', 'gorse', C.teas)); eq(pairKey('gorse', 'watermint', C.teas), pairKey('watermint', 'gorse', C.teas), 'a pair is one key in either order');
    const line = tasteLine(/** @type {any} */ (t), W);
    assert(line && /^Gorse and mint\.|^Gorse with mint\./.test(line), `taste line: ${line}`);
    eq(tasteLine(/** @type {any} */ (brew(['gorse.flowers', 'watermint.leaves'], C)), W), line, 'the same line either way');
    eq(tasteLine(/** @type {any} */ (brew(['willow.bark', 'chamomile.flowers'], C)), W), W.tasteDry['willow+chamomile']);
    eq(drankLine(/** @type {any} */ (brew(['watermint.leaves', 'nettle.tops'], C)), W), 'Water mint and nettle tea. Out all day.');
    eq(drankLine(/** @type {any} */ (brew(['watermint.leaves'], C)), W), 'Water mint tea. Light on your feet.');
  });

  test(G, 'every boon lifts what it says, and nothing without a tea', async () => {
    const C = await cookP, B = C.boons;
    eq(JSON.stringify(liftOf(null, B)), JSON.stringify(NO_LIFT), 'no tea: every lift off');
    const want = /** @type {Record<string, Partial<typeof NO_LIFT>>} */ ({
      watermint: { walk: 1.05 }, meadowsweet: { trust: 1.05 }, gorse: { sight: 1.5 }, nettle: { dig: 0.9 }, chamomile: { comfort: 0.9 }, willow: { make: 0.85, burn: 1.1 },
      'watermint+nettle': { walk: 1.1, dig: 0.85 }, 'meadowsweet+chamomile': { trust: 1.12, comfort: 0.85 }, 'gorse+chamomile': { sight: 2.2, reveal: true },
      'willow+gorse': { make: 0.75, handful: 0.15 }, 'willow+chamomile': {}, 'meadowsweet+watermint': { trust: 1.05, walk: 1.05 },
    });
    for (const [id, lifts] of Object.entries(want)) {
      const L = /** @type {any} */ (liftOf(drink(id, B), B));
      for (const k of Object.keys(NO_LIFT)) eq(L[k], /** @type {any} */ (lifts)[k] ?? /** @type {any} */ (NO_LIFT)[k], `${id}: ${k}`);
    }
    const spent = { .../** @type {any} */ (drink('gorse+chamomile', B)), revealed: true };
    eq(liftOf(spent, B).reveal, false, 'the reveal comes once');
    eq(liftOf(spent, B).sight, 2.2, 'the rest of the blend goes on');
    // The words on the HUD: never a number.
    for (const s of [1, 0.5, 0.2, 0.05]) assert(!/\d/.test(leftWord(s, C)), `no number at ${s}`);
  });

  test(G, 'one tea at a time: a new cup replaces the old', async () => {
    const C = await cookP, B = C.boons;
    let b = drink('watermint', B);
    b = tick(b, 5);
    eq(b?.leftH, 3);
    b = drink('nettle', B);
    eq(b?.id, 'nettle'); eq(b?.leftH, 8, 'full again, the old boon gone');
    eq(drink('nothing-like-it', B), null);
  });

  test(G, 'the countdown: game hours played, then gone; a jump is not counted', async () => {
    const C = await cookP, B = C.boons;
    let b = drink('watermint', B);
    eq(tick(b, 0), b, 'no hours, no change');
    b = tick(b, 7.5); eq(b?.leftH, 0.5); assert(Math.abs(shareOf(b) - 0.5 / 8) < 1e-9);
    eq(tick(b, 0.6), null, 'run out');
    // Live: hours played come off; a jump of more than maxStepH (a rest, time away) does not.
    const before = get('camp');
    let hour = 100;
    update('camp', () => cleanCamp({ boon: null }));
    const live = createBoons({ cook: C, change: (fn) => update('camp', (c) => fn(cleanCamp(c))), hourNow: () => hour, maxStepH: 0.5 });
    live.drink('meadowsweet');
    for (let i = 0; i < 10; i++) { hour += 0.1; live.update(1); }
    assert(Math.abs((live.now()?.leftH ?? 0) - 7) < 1e-6, `1 hour played: ${live.now()?.leftH}`);
    hour += 30; live.update(1);
    assert(Math.abs((live.now()?.leftH ?? 0) - 7) < 1e-6, 'thirty hours away cost nothing');
    hour += 0.25; live.update(1);
    assert(Math.abs((live.now()?.leftH ?? 0) - 6.75) < 1e-6, 'and play counts again after');
    live.flush();
    eq(get('camp').boon.id, 'meadowsweet', 'written into the camp section');
    live.dispose();
    update('camp', () => before);
  });

  test(G, 'Deep rest wakes into a whole easy day; other boons sleep as they are', async () => {
    const C = await cookP, B = C.boons;
    const w = wake(drink('willow+chamomile', B), B);
    eq(w?.id, 'meadowsweet+watermint'); eq(w?.leftH, 24);
    const L = liftOf(w, B);
    eq(L.trust, 1.05); eq(L.walk, 1.05);
    const g = tick(drink('gorse', B), 2);
    eq(wake(g, B), g, 'gorse sleeps as it was');
    eq(wake(null, B), null);
  });

  test(G, 'save and reload mid-boon: the camp section keeps it, no format bump', async () => {
    const C = await cookP, B = C.boons;
    const camp = cleanCamp({ boon: tick(drink('willow+gorse', B), 3.25) });
    const back = cleanCamp(JSON.parse(JSON.stringify(camp)));
    eq(JSON.stringify(back.boon), JSON.stringify({ id: 'willow+gorse', leftH: 12.75, h: 16 }));
    eq(back.version, 1);
    eq(cleanCamp({}).boon, null, 'an older save: no boon');
    for (const bad of [{ id: 3 }, { id: 'gorse', leftH: -1, h: 8 }, { id: 'gorse', leftH: 'x', h: 8 }, 'gorse']) eq(cleanBoon(bad), null, `cleaned: ${JSON.stringify(bad)}`);
    eq(cleanBoon({ id: 'gone-herb', leftH: 1, h: 8 }, B), null, 'a boon the recipe no longer has');
    eq(cleanBoon({ id: 'gorse', leftH: 20, h: 8 })?.leftH, 8, 'never more than full');
    // Live: a loaded save's boon is taken up and counts on.
    const before = get('camp');
    let hour = 50;
    update('camp', () => back);
    const live = createBoons({ cook: C, change: (fn) => update('camp', (c) => fn(cleanCamp(c))), hourNow: () => hour });
    eq(live.now()?.id, 'willow+gorse');
    hour += 0.25; live.update(1);
    assert(Math.abs((live.now()?.leftH ?? 0) - 12.5) < 1e-6);
    eq(get('boonLift')?.handful, 0.15, 'its lift published for the systems');
    live.dispose();
    update('camp', () => before);
    update('boonLift', () => null);
  });

  test(G, 'tea notes for the camp page: found once, pairs tried once with their line', async () => {
    const C = await cookP;
    let n = cleanTeaNotes(undefined);
    eq(JSON.stringify(n), JSON.stringify({ found: {}, tried: {}, tastes: {} }));
    const mixed = /** @type {any} */ (brew(['watermint.leaves', 'gorse.flowers'], C));
    n = noteTea(n, mixed, 10, tasteLine(mixed, C.words));
    n = noteTea(n, mixed, 20, 'another line');
    eq(n.found.gorse, 10, 'first drunk at 10'); eq(n.tried[/** @type {string} */ (mixed.pair)], 10);
    eq(n.tastes[/** @type {string} */ (mixed.pair)], tasteLine(mixed, C.words), 'the first line kept');
    eq(JSON.stringify(cleanTeaNotes({ found: { a: 'x', b: 2 }, tastes: { c: 4 } })), JSON.stringify({ found: { b: 2 }, tried: {}, tastes: {} }));
  });

  test(G, 'a strong back: the dig act keeps pace with the quicker dig', async () => {
    const PO = (await figureP).poses;
    const len = actLength(PO, 'dig');
    setActRate((name) => (name === 'dig' ? 1 / 0.9 : 1));
    try {
      assert(Math.abs(actLength(PO, 'dig') - len * 0.9) < 1e-9, 'a tenth shorter');
      eq(actLength(PO, 'pitch'), actLength(PO, 'pitch'), 'other acts as they were');
    } finally { setActRate(() => 1); }
    eq(actLength(PO, 'dig'), len);
    assert(PO.gestures.sip?.keys?.length > 4 && PO.gestures.steep?.keys?.length > 3, 'the sip and steep gestures are drawn');
  });
}
