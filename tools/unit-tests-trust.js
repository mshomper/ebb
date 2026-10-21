// @ts-check
// Trust tests for tools/unit-tests.html (S6c, doc 23): words from trust, the ceiling, events applied
// once by the hourly step and never lowering trust, the same events giving the same trust however
// the hours are cut, and quiet watching counting only a still camera close by.

import { trustWord, maxTrust, addTrustEvent, applyTrust, cleanName, nameFrog, NAME_MAX } from '../src/world/creatures/trust.js';
import { createWatching } from '../src/world/creatures/watching.js';

const TRUST = 'trust';

async function frogRecipe() {
  const r = await fetch('../recipes/species/frog.json');
  if (!r.ok) throw new Error(`recipes/species/frog.json: HTTP ${r.status}`);
  return r.json();
}

/** A world state with two frogs and no pending trust. */
function twoFrogs() {
  return { creatures: { frogs: { frogs: [{ id: 1, x: 0, z: 0, trust: 0 }, { id: 2, x: 3, z: 0, trust: 0.4 }], pending: [] } } };
}

/** The tick's part: copy the frogs and apply what is pending. @param {any} state @param {any} P */
function hour(state, P) {
  const F = state.creatures.frogs;
  const fr = { ...F, frogs: F.frogs.map((/** @type {any} */ f) => ({ ...f })) };
  const events = applyTrust(fr, P, 0);
  return { state: { ...state, creatures: { ...state.creatures, frogs: fr } }, events };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addTrustTests(test, assert, eq) {
  test(TRUST, 'trust reads as words, and a frog stops at Familiar', async () => {
    const P = (await frogRecipe()).presence;
    eq(trustWord(0, P.bands), 'wary', '0 is wary');
    eq(trustWord(0.3, P.bands), 'tolerant', '0.3 is tolerant');
    eq(trustWord(0.5, P.bands), 'curious', '0.5 is curious');
    eq(trustWord(0.7, P.bands), 'familiar', '0.7 is familiar');
    const top = maxTrust(P);
    eq(trustWord(top, P.bands), 'familiar', `the ceiling ${top} is still familiar`);
    return `ceiling ${top}`;
  });

  test(TRUST, 'events apply once, raise trust, never lower it, and say when the word moves', async () => {
    const P = (await frogRecipe()).presence;
    let s = twoFrogs();
    s = addTrustEvent(s, { kind: 'watched', id: 2, minutes: 5, hour: 10 });
    s = addTrustEvent(s, { kind: 'fed', id: 2, hour: 10 });
    s = addTrustEvent(s, { kind: 'watched', id: 9, minutes: 5, hour: 10 });
    eq(s.creatures.frogs.pending.length, 2, 'an event for a frog that is not there is dropped');
    const a = hour(s, P);
    const t2 = a.state.creatures.frogs.frogs[1].trust;
    eq(t2, Math.round((0.4 + 5 * P.watch.trustPerMin + P.feedTrust) * 10000) / 10000, 'watching and feeding add up');
    const words = a.events.filter((e) => e.name === 'creature:trusted');
    eq(words.length, 1, 'one word moved');
    eq(words[0].payload.word, 'curious', 'tolerant to curious');
    const b = hour(a.state, P);
    eq(b.state.creatures.frogs.frogs[1].trust, t2, 'applied once: the next hour changes nothing');
    eq(b.events.length, 0, 'nothing is told twice');
    let c = b.state;
    for (let i = 0; i < 20; i++) c = addTrustEvent(c, { kind: 'watched', id: 2, minutes: 999, hour: 11 });
    const d = hour(c, P);
    eq(d.state.creatures.frogs.frogs[1].trust, maxTrust(P), 'stops at the ceiling');
    return `trust ${t2}, then ${d.state.creatures.frogs.frogs[1].trust}`;
  });

  test(TRUST, 'the same events give the same trust in one hour or spread over several', async () => {
    const P = (await frogRecipe()).presence;
    const evs = [{ kind: 'watched', id: 1, minutes: 3, hour: 1 }, { kind: 'fed', id: 1, hour: 2 }, { kind: 'watched', id: 1, minutes: 7.5, hour: 3 }];
    let one = twoFrogs();
    for (const e of evs) one = addTrustEvent(one, /** @type {any} */ (e));
    one = hour(one, P).state;
    let spread = twoFrogs();
    for (const e of evs) { spread = addTrustEvent(spread, /** @type {any} */ (e)); spread = hour(spread, P).state; }
    const a = one.creatures.frogs.frogs[0].trust, b = spread.creatures.frogs.frogs[0].trust;
    assert(Math.abs(a - b) < 0.0002, `one hour ${a}, spread ${b}`);
    return `${a} and ${b}`;
  });

  test(TRUST, 'a meal earns trust and says so; another soon after earns less', async () => {
    const rec = await frogRecipe();
    const P = rec.presence, fullH = rec.feed.fullH;
    let s = addTrustEvent(twoFrogs(), { kind: 'fed', id: 1, hour: 100 });
    const tickOf = (/** @type {any} */ st) => {
      const F = st.creatures.frogs;
      const fr = { ...F, frogs: F.frogs.map((/** @type {any} */ f) => ({ ...f })) };
      const events = applyTrust(fr, P, 0, fullH);
      return { state: { ...st, creatures: { ...st.creatures, frogs: fr } }, events };
    };
    const a = tickOf(s);
    const first = a.state.creatures.frogs.frogs[0].trust;
    eq(first, P.feedTrust, 'a first meal earns feedTrust');
    assert(a.events.some((e) => e.name === 'creature:ate' && e.payload.id === 1), 'creature:ate is told');
    s = addTrustEvent(a.state, { kind: 'fed', id: 1, hour: 101 });
    const b = tickOf(s);
    const second = Math.round((b.state.creatures.frogs.frogs[0].trust - first) * 10000) / 10000;
    assert(second < P.feedTrust / 2, `an hour later it earns less: ${second}`);
    s = addTrustEvent(b.state, { kind: 'fed', id: 1, hour: 101 + fullH });
    const c = tickOf(s);
    const third = Math.round((c.state.creatures.frogs.frogs[0].trust - b.state.creatures.frogs.frogs[0].trust) * 10000) / 10000;
    eq(third, P.feedTrust, `${fullH} hours later it is hungry again`);
    return `${first}, then ${second}, then ${third}`;
  });

  test(TRUST, 'names are tidied, kept with the frog, and never land on a frog that is not there', () => {
    eq(cleanName('  Pip  '), 'Pip', 'trimmed');
    eq(cleanName('Old   Bramble'), 'Old Bramble', 'single spaces');
    eq(cleanName("O'Fen-Moss"), "O'Fen-Moss", 'apostrophes and hyphens stay');
    eq(cleanName('Zoë'), 'Zoë', 'letters of any language stay');
    eq(cleanName('Pip <3 99'), 'Pip', 'symbols and digits go');
    eq(cleanName('1234'), '', 'no letters, no name');
    assert(cleanName('x'.repeat(40)).length === NAME_MAX, `at most ${NAME_MAX} long`);
    const s = nameFrog(twoFrogs(), 2, 'Pip', 50);
    eq(s.creatures.frogs.frogs[1].name, 'Pip', 'named');
    eq(s.creatures.frogs.frogs[1].namedAt, 50, 'when');
    eq(s.creatures.frogs.frogs[0].name, undefined, 'the other frog is untouched');
    const t = nameFrog(s, 9, 'Moss', 50);
    eq(t, s, 'no frog 9: nothing changes');
    return 'ok';
  });

  test(TRUST, 'quiet watching counts a still camera close by, not a moving or far one', async () => {
    const W = (await frogRecipe()).presence.watch;
    const frog = { id: 1, x: 0, y: 0, z: 0, mode: 'rest' };
    const near = (/** @type {number} */ speed) => [{ id: 'camera', kind: /** @type {const} */ ('camera'), pos: /** @type {[number, number, number]} */ ([1, 0.5, 0]), speed, editing: false, edits: [], stillS: 0, body: true }];
    const far = [{ ...near(0)[0], pos: /** @type {[number, number, number]} */ ([10, 0.5, 0]) }];
    const w = createWatching(W);
    /** @type {{ id: number, minutes: number }[]} */ let got = [];
    for (let t = 0; t < 60; t += 0.1) got = got.concat(w.step([frog], near(0), 0.1));
    got = got.concat(w.step([frog], near(1), 0.1));
    eq(got.length, 1, 'a minute of stillness, then a move, is one stretch');
    assert(Math.abs(got[0].minutes - 1) < 0.02, `about a minute: ${got[0].minutes}`);
    for (let t = 0; t < 10; t += 0.1) got = got.concat(w.step([frog], near(0), 0.1));
    got = got.concat(w.step([frog], near(1), 0.1));
    eq(got.length, 1, 'ten seconds is too short to count');
    for (let t = 0; t < 60; t += 0.1) got = got.concat(w.step([frog], far, 0.1));
    eq(got.length, 1, 'watching from far away does not count');
    return `${got[0].minutes} min`;
  });
}
