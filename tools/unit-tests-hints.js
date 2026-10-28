// @ts-check
// Morning hints tests for tools/unit-tests.html (Matt, October 28, 2026; src/world/hints): a fresh
// island hears the first hint; one whose player already gathered skips straight to small finds; the
// first evening's Skip does not count as gathering; a hint with a trigger waits for it and then goes
// first; shown hints never come back, and one a day; first-week hints stop on an older island;
// Show me picks a species known on the island; and the live part offers one line at the first quiet
// daylight moment, records what the player did, and keeps quiet while the first evening runs.

import { pickHint, testHolds, shownOf, shownFlag, shownToday, showMeOf } from '../src/world/hints/morning.js';
import { createMorningHints } from '../src/world/hints/morning-live.js';
import { sunMoon } from '../src/world/sky/sun-moon.js';
import { on, emit } from '../src/core/events.js';
import { get, update } from '../src/core/store.js';
import { onAction } from '../src/input/actions.js';

const G = 'hints';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/** A journal with these flags and species records. @param {string[]} [flags] @param {Record<string, any>} [species] */
const J = (flags = [], species = {}) => ({ born: 0, flags, species, notes: [] });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addHintsTests(test, assert, eq) {
  const hintsP = json('world/morning-hints'), journalP = json('world/journal'), skyP = json('world/sky');
  /** @param {any} words */
  const kindOfFrom = (words) => (/** @type {string} */ sp) => words.species?.[sp]?.kind;

  test(G, 'every hint names tests the recipe has, and its Show me species have pages', async () => {
    const R = await hintsP, W = await journalP, I = await json('world/journal-island');
    const ids = new Set();
    for (const h of R.hints) {
      assert(!ids.has(h.id), `${h.id} is listed once`); ids.add(h.id);
      assert(!h.id.includes('@') && !h.id.includes(':'), `${h.id}: no @ or : in an id (the flag is hint:<id>@<day>)`);
      assert(Array.isArray(R.tests[h.done]), `${h.id}: its done test ${h.done} is in tests`);
      if (h.when) assert(Array.isArray(R.tests[h.when]), `${h.id}: its trigger ${h.when} is in tests`);
      // Show me rings animals, plants, covers and grounds; a find has no spot (describe.js showMeSpot).
      for (const sp of h.showMe ?? []) assert((W.species[sp] && W.species[sp].kind !== 'find') || I.ground?.[sp], `${h.id}: Show me ${sp} is a page Show me can ring`);
      assert(!/genuine/i.test(h.text), `${h.id}: words`);
    }
    eq(R.hints.filter((/** @type {any} */ h) => h.withinDays !== undefined).length, 7, 'seven first-week hints');
  });

  test(G, 'a fresh island hears gathering first; one that gathered skips to small finds', async () => {
    const R = await hintsP, kindOf = kindOfFrom(await journalP);
    eq(pickHint(R, { journal: J(), kindOf }, 0)?.id, 'gather', 'nothing done: gathering');
    eq(pickHint(R, { journal: J(['did:gathered']), kindOf }, 1)?.id, 'finds', 'gathered on foot');
    eq(pickHint(R, { journal: J(['picked:reeds']), kindOf }, 1)?.id, 'finds', 'picked a plant counts as gathering');
    eq(pickHint(R, { journal: J(['intro:gather']), kindOf }, 1)?.id, 'finds', 'the first evening gathered twigs and pebbles');
    eq(pickHint(R, { journal: J(['intro:gather', 'intro:skipped']), kindOf }, 1)?.id, 'gather', 'Skip sets the beat flag without gathering');
  });

  test(G, 'what is done is passed over, in order, to the end of the first week', async () => {
    const R = await hintsP, kindOf = kindOfFrom(await journalP);
    const found = { shells: { ever: true, learned: [] } };
    eq(pickHint(R, { journal: J(['did:gathered'], found), kindOf }, 2)?.id, 'shape', 'a find met: on to shaping (no animal yet, so that one waits)');
    eq(pickHint(R, { journal: J(['did:gathered', 'intro:shape.1'], found), kindOf }, 2)?.id, 'plant', 'shaped in the first evening');
    eq(pickHint(R, { journal: J(['did:gathered', 'did:shaped', 'did:planted'], found), kindOf }, 3)?.id, 'web', 'no rushes yet: the cord hint waits; the Web');
    eq(pickHint(R, { journal: J(['did:gathered', 'did:shaped', 'did:planted', 'did:web'], found), kindOf }, 3), null, 'all done: nothing to say');
    const grownNotFound = { reeds: { ever: true, learned: [] } };
    eq(pickHint(R, { journal: J(['did:gathered'], grownNotFound), kindOf }, 1)?.id, 'finds', 'a plant growing is no find');
  });

  test(G, 'a trigger holds a hint back, then sends it ahead of the order', async () => {
    const R = await hintsP, kindOf = kindOfFrom(await journalP);
    const rushes = { rushes: { ever: true, learned: [] } };
    eq(pickHint(R, { journal: J([], rushes), kindOf }, 2)?.id, 'cord', 'rushes grow: the cord hint comes first');
    eq(pickHint(R, { journal: J([], rushes), cook: { made: { 'rush-cord': 40 } }, kindOf }, 2)?.id, 'gather', 'cord already made: passed over');
    eq(pickHint(R, { journal: J(['frogs:sign']), kindOf }, 2)?.id, 'animals', 'frogs came: the animal hint');
    eq(pickHint(R, { journal: J(['frogs:sign'], { frogs: { ever: true, learned: [] } }), kindOf }, 2)?.id, 'gather', 'a frog met already: passed over');
    eq(pickHint(R, { journal: J(['picked:chamomile']), kindOf }, 30)?.id, 'herbs', 'a herb picked, long after the first week');
    eq(pickHint(R, { journal: J(['picked:chamomile', 'did:brewed']), kindOf }, 30), null, 'brewed already');
    eq(pickHint(R, { journal: J([], { turtles: { ever: true, learned: ['trust:tolerant'] } }), kindOf }, 30)?.id, 'treats', 'a turtle knows you a little');
    eq(pickHint(R, { journal: J(['did:gifted']), kindOf }, 30)?.id, 'gift', 'a gift came');
    eq(pickHint(R, { journal: J(['did:gifted', 'did:gift-spot']), kindOf }, 30), null, 'the gift spot used already');
  });

  test(G, 'first-week hints stop on an older island; event hints do not', async () => {
    const R = await hintsP, kindOf = kindOfFrom(await journalP);
    eq(pickHint(R, { journal: J(), kindOf }, 9.9)?.id, 'gather', 'day 9: still the first week');
    eq(pickHint(R, { journal: J(), kindOf }, 10), null, 'day 10: an older island hears none of them');
    eq(pickHint(R, { journal: J(['did:gifted']), kindOf }, 40)?.id, 'gift');
  });

  test(G, 'a hint shows once ever, and one a day', async () => {
    const R = await hintsP, kindOf = kindOfFrom(await journalP);
    const f = shownFlag(R, 'gather', 3);
    eq(f, 'hint:gather@3');
    eq(shownOf(R, [f, 'intro:done', 'hint:finds@4']).get('finds'), 4);
    eq(pickHint(R, { journal: J([f]), kindOf }, 3)?.id, 'finds', 'gathering never comes back, though still not done');
    assert(shownToday(R, [f], 3), 'day 3 had its hint');
    assert(!shownToday(R, [f], 4), 'day 4 has not');
    assert(!shownToday(R, ['intro:done', 'keeper:tend'], 0), 'other flags are no hint');
  });

  test(G, 'Show me rings a species known here, or the first when always', async () => {
    const R = await hintsP;
    const animals = R.hints.find((/** @type {any} */ h) => h.id === 'animals'), finds = R.hints.find((/** @type {any} */ h) => h.id === 'finds');
    eq(showMeOf(animals, { journal: J(['turtles:sign']) }), 'turtles', 'the one that came');
    eq(showMeOf(animals, { journal: J([]) }), null, 'none known: no Show me');
    eq(showMeOf(finds, { journal: J([]) }), 'shore', 'the shore, always');
    eq(showMeOf(R.hints.find((/** @type {any} */ h) => h.id === 'gather'), { journal: J([]) }), null, 'gathering has none');
    assert(!testHolds(R, 'nope', { journal: J() }), 'an unknown test never holds');
  });

  test(G, 'live: one line at the first quiet daylight moment, recorded, and quiet in the first evening', async () => {
    const R = await hintsP, W = await journalP, sky = await skyP;
    // A daylight hour on day 2, and a night hour on day 3.
    let day = 2 * 86400 + 6 * 3600;
    while (sunMoon(day, sky.orbit).sunAlt < 0.05) day += 600;
    let night = 3 * 86400;
    while (sunMoon(night, sky.orbit).sunAlt >= 0) night += 600;
    let t = day;
    const clock = { display: () => t };
    update('journal', () => J());
    update('intro', () => ({ beat: 'gather', started: true, done: false }));
    update('cook', () => ({ made: {} }));
    const offAct = onAction((/** @type {any} */ a) => { if (a.type === 'journal.flag') update('journal', (j) => (j.flags.includes(a.flag) ? j : { ...j, flags: [...j.flags, a.flag] })); });
    /** @type {any[]} */ const heard = [];
    const offHeard = on('morning:hint', (/** @type {any} */ p) => heard.push(p));
    const live = createMorningHints({ R, clock, orbit: sky.orbit, journalWords: W });
    const run = (/** @type {number} */ s) => { for (let i = 0; i < s * 2; i++) live.tick({ realDt: 0.5 }); };
    try {
      run(10);
      eq(heard.length, 0, 'the first evening is still running');
      update('intro', () => ({ beat: null, started: false, done: true }));
      emit('intro:hint', { text: 'A line from the evening.' });
      run(10);
      eq(heard.length, 0, 'a line of the first evening still shows');
      emit('intro:hint', { text: null });
      run(R.quietS / 2);
      eq(heard.length, 0, 'not before quietS');
      run(R.quietS);
      eq(heard.length, 1, 'then one line');
      eq(heard[0].id, 'gather');
      assert(get('journal').flags.includes(`hint:gather@${Math.floor(day / 86400)}`), 'its flag is kept with the island');
      run(30);
      eq(heard.length, 1, 'one a day');
      emit('gather:done', {});
      assert(get('journal').flags.includes('did:gathered'), 'gathering is recorded');
      t = night;
      run(10);
      eq(heard.length, 1, 'no hint at night');
      t = day + 86400;
      run(R.quietS + 1);
      eq(heard.length, 2, 'the next morning');
      eq(heard[1].id, 'finds', 'gathered, and gathering showed: small finds');
      eq(heard[1].sp, 'shore', 'with Show me');
      t = day + 2 * 86400;
      emit('keeper:card', { id: 'tend' });
      run(R.quietS + 1);
      eq(heard.length, 2, 'not while a keeper card is up');
      update('journal', (j) => ({ ...j, flags: [...j.flags, 'keeper:tend:read'] }));
      run(R.quietS + 1);
      eq(heard.length, 3, 'once it is read');
      update('journalUi', () => ({ open: true, view: 'web' }));
      assert(get('journal').flags.includes('did:web'), 'the Web opened is recorded');
    } finally {
      live.dispose(); offAct(); offHeard();
      update('journalUi', () => ({ open: false, view: 'notes' }));
    }
  });
}
