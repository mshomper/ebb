// @ts-check
// Field journal tests (docs 13, 15) for tools/unit-tests.html: a new island's plants are noted as
// already there, the journal built over game hours is the same twice, a Plant tool refusal teaches
// a like line once, status words carry no numbers, and a tap names the nearest plant. Uses the
// made-up shoreline habitat of the growth tests.

import { initialWorldState, makeEnv, runHour } from '../src/sim/tick.js';
import { settleGrowth, plantSeed } from '../src/world/growth/coarse.js';
import { initialJournal, observe, learn, describe, identify } from '../src/world/journal/observe.js';
import { shoreline, at, loadRecipes } from './unit-tests-growth.js';

const JOURNAL = 'journal';

/** @type {Promise<any> | null} */ let wordsPromise = null;
function loadWords() {
  wordsPromise ??= fetch('../recipes/world/journal.json').then((r) => {
    if (!r.ok) throw new Error(`recipes/world/journal.json: HTTP ${r.status}`);
    return r.json();
  });
  return wordsPromise;
}

/** The shoreline with grass painted on its dry middle. */
function grassyShoreline() {
  const hab = shoreline();
  for (let k = 0; k < hab.n * hab.n; k++) if (!hab.sea[k] && !hab.depthCm[k] && hab.salt[k] === 0 && hab.moisture[k] === 0) hab.grass[k] = 255;
  return hab;
}

/** A fresh island on the shoreline, its journal after the first look, and what is needed to go on. */
async function setup(seed = 9) {
  const recipes = await loadRecipes();
  const words = await loadWords();
  const hab = grassyShoreline();
  const env = { ...makeEnv(seed, recipes), habitat: () => hab };
  const state = settleGrowth(initialWorldState(seed), env);
  const first = observe(initialJournal(0), { state, events: [], hour: 0, habitat: hab, words });
  return { recipes, words, hab, env, state, first };
}

/** Run hours 1..n, the journal looking after each. @param {any} s */
function live(s, n) {
  let state = s.state, journal = s.first.journal;
  /** @type {string[]} */ const texts = [];
  for (let h = 1; h <= n; h++) {
    const r = runHour(state, h, s.env);
    state = r.state;
    const o = observe(journal, { state, events: r.events, hour: h, habitat: s.hab, words: s.words });
    journal = o.journal;
    for (const note of o.notes) texts.push(note.text);
  }
  return { state, journal, texts };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addJournalTests(test, assert, eq) {
  test(JOURNAL, 'a new island: every living thing on it is noted as already there', async () => {
    const { words, first } = await setup();
    for (const sp of words.order) {
      assert(first.journal.species[sp]?.ever, `${sp} is seen at the first look`);
      assert(first.notes.some((n) => n.sp === sp && n.text === words.species[sp].notes.arrived), `${sp} has its "arrived" note`);
    }
    return `${first.notes.length} notes at the first look`;
  });

  test(JOURNAL, '96 hours twice give the same journal, and spreading is learned and noted once', async () => {
    const s = await setup();
    const a = live(s, 96);
    const b = live(s, 96);
    eq(JSON.stringify(a.journal), JSON.stringify(b.journal), 'journal of the two runs');
    const spread = s.words.order.filter((/** @type {string} */ sp) => a.journal.species[sp]?.learned.includes('spread'));
    assert(spread.length > 0, 'some species spread in 96 hours');
    for (const sp of spread) {
      const text = s.words.species[sp].notes.spread;
      eq(a.texts.filter((t) => t === text).length, 1, `${sp} spread note`);
    }
    return `spread learned by ${spread.join(', ')}; ${a.texts.length} notes in 96 hours`;
  });

  test(JOURNAL, 'a Plant tool refusal teaches a like line once', async () => {
    const { words, state, first } = await setup();
    const ctx = { state, hour: 3, words };
    const r1 = learn(first.journal, 'reeds', 'refused:dry', ctx);
    eq(r1.notes.length, 1, 'notes from the first refusal');
    assert(r1.notes[0].text.startsWith('Reeds: '), `note text "${r1.notes[0].text}"`);
    const r2 = learn(r1.journal, 'reeds', 'refused:dry', ctx);
    eq(r2.notes.length, 0, 'notes from the same refusal again');
    eq(r2.journal, r1.journal, 'the journal is unchanged by a repeat');
    const like = describe(r1.journal, 'reeds', state, null, words).likes.find((l) => l.text === 'Turns away from dry ground');
    assert(like?.known, 'the like line shows on the page');
    return r1.notes[0].text;
  });

  test(JOURNAL, 'page words: a status for every species, with no numbers in it', async () => {
    const s = await setup();
    const a = live(s, 30);
    const lines = [];
    for (const sp of s.words.order) {
      const d = describe(a.journal, sp, a.state, s.hab, s.words);
      assert(d.known, `${sp} known`);
      assert(d.status.length > 0, `${sp} has a status`);
      assert(!/\d/.test(d.status), `${sp} status has a number: "${d.status}"`);
      eq(d.seasons.length, 4, `${sp} season boxes`);
      assert(d.seasons[0].text, `${sp} spring box filled`);
      lines.push(d.status);
    }
    return lines.join(' / ');
  });

  test(JOURNAL, 'grass learns it drowns only when water comes over growing grass', async () => {
    const { words, env, hab } = await setup();
    for (let k = 0; k < hab.n * hab.n; k++) if (hab.depthCm[k] > 0) hab.grass[k] = 255;   // painted under the pond
    const fresh = settleGrowth(initialWorldState(9), env);
    const a = observe(initialJournal(0), { state: fresh, events: [], hour: 0, habitat: hab, words });
    assert(!a.journal.species.grass.learned.includes('grass:flooded'), 'a new island with a pond on painted grass is not flooding');
    const wet = { ...fresh, growth: { ...fresh.growth, grass: new Uint8Array(fresh.growth.grass.length).fill(255) } };
    const b = observe(a.journal, { state: wet, events: [], hour: 1, habitat: hab, words });
    assert(b.journal.species.grass.learned.includes('grass:flooded'), 'grass still growing under new water is flooding');
    eq(b.notes.filter((n) => n.text === words.species.grass.notes.flooded).length, 1, 'flooded notes');
    return words.species.grass.notes.flooded;
  });

  test(JOURNAL, 'a tap names the nearest plant, or grass, or nothing', async () => {
    const { words, env, state, hab } = await setup();
    const r = plantSeed(state, 'iris', at('bank')[0], at('bank')[1] + 40, env);
    assert(r.ok, 'iris seed takes on the bank');
    const id = identify(r.state, hab, at('bank')[0] + 0.3, at('bank')[1] + 40, words);
    eq(id?.sp, 'iris', 'tap beside the iris');
    eq(id?.text, words.species.iris.stages[0], 'a seed says it is waiting');
    const g = identify(r.state, hab, at('dry')[0], at('dry')[1] + 70, words);
    eq(g?.sp, 'grass', 'tap on the painted dry ground');
    const none = identify(r.state, hab, at('pond')[0], at('pond')[1] + 90, words);
    assert(!none || none.sp === 'lilies', `tap on open water: ${none?.sp}`);
    return `${id?.name}: "${id?.text}"; ${g?.name}`;
  });
}
