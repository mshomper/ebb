// @ts-check
// Treats and friendship pace tests for tools/unit-tests.html (P2h, docs/future/13 section 8): a treat
// is worth treatFeeds meals once a creature a game day, for a frog and for a school; a tea boon
// multiplies watching, meals and treats but not the camp's standing presence; trust never goes down
// or past the ceiling; the trust lab's pace is about 4.6 played days to every top word without treats
// and about 3.3 with a treat a day (1.5 times the P2h pace, October 28, 2026); kelp, wrack and fallen leaves lie where and when gather.json says;
// a treat set out lies, pales and is gone by the hour alone; and who likes what comes from the
// species recipes.

import { applyTrust, treatGain, maxTrust, addTrustEvent } from '../src/world/creatures/trust.js';
import { applySwarmTrust, addSwarmEvent } from '../src/world/creatures/swarms.js';
import { paceCurve, topWord, knownAt } from '../src/world/creatures/pace.js';
import { cleanTreats, lyingAt, paleOf, likersOf, isTreatKind, treatIdOf, TREATS_MAX } from '../src/world/creatures/treat-rules.js';
import { turtleId, groupOfTurtle, turtleTrust, nameTurtle, bondOf, namedTurtles } from '../src/world/creatures/bonds.js';
import { due } from '../src/world/expansion.js';
import { namedFrog } from '../src/world/journal/creatures.js';
import { KINDS, gatherSeed, share, binKey } from '../src/world/gather/spots.js';
import { cleanGather, periodOf, PERIOD } from '../src/world/gather/events.js';
import { keyOf } from '../src/world/species.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';

const G = 'treats';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());
const r4 = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;

/** One frog, ticked: copy, apply what is pending. @param {any} fr @param {any} P @param {number} [boost] */
function tick(fr, P, boost = 1) {
  const c = { ...fr, frogs: fr.frogs.map((/** @type {any} */ f) => ({ ...f })) };
  const events = applyTrust(c, P, 0, 6, boost);
  return { fr: c, events };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addTreatsTests(test, assert, eq) {
  const ids = ['frog', 'minnow', 'dragonfly', 'damselfly', 'turtle'];
  const specP = Promise.all(ids.map((id) => json(`species/${id}`)));
  const treatsP = json('world/treats'), cookP = json('world/cook'), gatherP = json('world/gather'), packP = json('world/pack');

  test(G, 'a treat is worth treatFeeds meals, once a creature a game day', async () => {
    const [frog] = await specP;
    const P = frog.presence;
    const worth = r4(P.feedTrust * P.treatFeeds);
    eq(P.treatFeeds, 2.5, 'two and a half meals');
    eq(treatGain(P, undefined, 100).gain, P.feedTrust * P.treatFeeds, 'the first treat');
    eq(treatGain(P, Math.floor(100 / HOURS_PER_DAY), 101).gain, 0, 'the same day: nothing');
    eq(treatGain(P, Math.floor(100 / HOURS_PER_DAY), 100 + HOURS_PER_DAY).gain, P.feedTrust * P.treatFeeds, 'the next day: full again');
    let fr = { frogs: [{ id: 1, x: 0, z: 0, trust: 0 }, { id: 2, x: 1, z: 0, trust: 0 }], pending: [] };
    fr = addTrustEvent({ creatures: { frogs: fr } }, { kind: 'treat', id: 1, hour: 30, treat: 'wrack' }).creatures.frogs;
    let t = tick(fr, P);
    eq(t.fr.frogs[0].trust, worth, 'trust moves by a treat');
    eq(t.fr.frogs[1].trust, 0, 'the other frog is untouched');
    eq(t.fr.frogs[0].treatDay, 1, 'the day is kept');
    assert(t.events.some((e) => e.name === 'creature:ate' && e.payload.treat === 'wrack' && e.payload.id === 1), 'creature:ate says which treat');
    // A second the same day is eaten and earns nothing; it does not touch the meal hour.
    t = tick({ ...t.fr, pending: [{ kind: 'treat', id: 1, hour: 40, treat: 'wrack' }] }, P);
    eq(t.fr.frogs[0].trust, worth, 'a second the same day earns nothing');
    assert(t.events.some((e) => e.name === 'creature:ate'), 'but it is still eaten');
    eq(t.fr.frogs[0].fedAt, undefined, 'a treat is not a meal');
    t = tick({ ...t.fr, pending: [{ kind: 'treat', id: 1, hour: 48, treat: 'wrack' }] }, P);
    eq(t.fr.frogs[0].trust, r4(2 * worth), 'the next game day it counts again');
    return `a treat ${worth}`;
  });

  test(G, 'a school takes its treat once a game day too, and never loses trust', async () => {
    const [, minnow] = await specP;
    const P = minnow.presence, key = keyOf(minnow);
    let state = { creatures: { [key]: { groups: [{ id: 1 }], trust: 0.3 } } };
    state = addSwarmEvent(state, key, { kind: 'treat', hour: 50, treat: 'leaf-pack' });
    state = addSwarmEvent(state, key, { kind: 'treat', hour: 51, treat: 'leaf-pack' });
    const S = { ...state.creatures[key] };
    const ev = applySwarmTrust(S, P, key);
    eq(S.trust, r4(0.3 + P.feedTrust * P.treatFeeds), 'one treat counted of two');
    eq(S.treatDay, 2, 'its day kept');
    eq(ev.filter((e) => e.name === 'creature:ate').length, 2, 'both eaten');
    const T = { trust: 0.7, pending: [{ kind: 'watched', minutes: 0, hour: 1 }] };
    applySwarmTrust(T, P, key);
    eq(T.trust, 0.7, 'trust it already had is kept');
    const U = { trust: 0, pending: Array.from({ length: 400 }, (_, i) => ({ kind: 'treat', hour: i * 24, treat: 'leaf-pack' })) };
    applySwarmTrust(U, P, key);
    eq(U.trust, maxTrust(P), 'never past the ceiling');
  });

  test(G, 'a tea boon lifts watching, meals and treats, not the camp', async () => {
    const [frog] = await specP;
    const P = frog.presence;
    const base = { frogs: [{ id: 1, x: 0, z: 0, trust: 0 }], pending: [{ kind: 'watched', id: 1, minutes: 5, hour: 1 }, { kind: 'fed', id: 1, hour: 1 }, { kind: 'treat', id: 1, hour: 1, treat: 'wrack' }] };
    const plain = tick(base, P).fr.frogs[0].trust, boosted = tick(base, P, 1.12).fr.frogs[0].trust;
    assert(Math.abs(boosted - plain * 1.12) < 0.0002, `boosted ${boosted} is 1.12 times ${plain}`);
    const camp = { frogs: [{ id: 1, x: 0, z: 0, trust: 0.3 }], pending: [{ kind: 'camp', id: 1, hour: 1, gain: 0.02 }] };
    eq(tick(camp, P, 1.12).fr.frogs[0].trust, 0.32, 'standing presence is not a boon');
  });

  test(G, 'the trust lab: about 4.6 played days to every top word, about 3.3 with a treat a day', async () => {
    const recs = await specP, T = await treatsP, C = await cookP;
    const H = T.labHabit;
    const out = [];
    for (const rec of recs) {
      // The turtles are paced to their name instead (October 27, 2026): the next test.
      if (rec.id === 'turtle') continue;
      const top = topWord(rec);
      const none = paceCurve(rec, { ...H, treat: false }, 20).at[top];
      assert(none > 4.2 && none < 5.1, `${rec.id}: ${none?.toFixed(2)} days to ${top} without treats`);
      out.push(`${rec.id} ${none.toFixed(1)}`);
      if (!(rec.presence.treatFeeds > 0)) continue;
      const one = paceCurve(rec, { ...H, treat: true }, 20).at[top];
      assert(one > 3 && one < 3.7, `${rec.id}: ${one.toFixed(2)} days with a treat a day`);
      const mead = paceCurve(rec, { ...H, treat: true, boost: C.boons.meadowsweet.trust }, 20).at[top];
      const blend = paceCurve(rec, { ...H, treat: true, boost: C.boons['meadowsweet+chamomile'].trust }, 20).at[top];
      assert(mead < one && blend < mead, `meadowsweet ${mead.toFixed(2)} and the blend ${blend.toFixed(2)} come sooner`);
      // The curve never goes down and never passes the ceiling.
      const c = paceCurve(rec, { ...H, treat: true }, 20).trust;
      assert(c.every((v, i) => i === 0 || v >= c[i - 1]), 'never down');
      eq(Math.max(...c), maxTrust(rec.presence), 'stops at the ceiling');
    }
    return out.join(', ');
  });

  test(G, 'kelp, wrack and leaves: appended kinds, kelp only on a spring tide, leaves only in autumn and winter', async () => {
    const R = await gatherP;
    eq(KINDS.slice(-4).join(), 'ash,kelp,wrack,leaves', 'appended after ash, so no older roll moves');
    const seed = gatherSeed(1207);
    const noCluster = { ...R, nearBoat: undefined, kinds: Object.fromEntries(Object.entries(R.kinds).map(([k, K]) => [k, { ...(/** @type {any} */ (K)), cluster: undefined }])) };
    /** @param {number} spring */
    const kelpAt = (spring) => {
      const line = { tideId: 40, level: 0.6, spring, season: 1, day: { day: 20, mood: 'clear', windStrength: 0.2, windDir: 0, rainAmount: 0 } };
      const ctx = /** @type {any} */ ({ seed, day: 20, season: 1, lines: [line], center: [0, 0] });
      let held = 0;
      for (let bi = 60; bi < 90; bi++) for (let bj = 40; bj < 50; bj++) if (share('kelp', binKey(bi, bj), periodOf(PERIOD.tide, 40), ctx, noCluster) > 0) held++;
      return held;
    };
    eq(kelpAt(0), 0, 'a neap tide casts no kelp');
    assert(kelpAt(1) > 50, `a spring tide does (${kelpAt(1)} of 300)`);
    const day = periodOf(PERIOD.day, 10);
    /** @param {number} season */
    const leavesIn = (season) => {
      const ctx = /** @type {any} */ ({ seed, day: 10, season, today: { windStrength: 0.2 }, yesterday: { windStrength: 0.2 } });
      let held = 0;
      for (let id = 1; id < 300; id++) if (share('leaves', id, day, ctx, R) > 0) held++;
      return held;
    };
    eq(leavesIn(0) + leavesIn(1), 0, 'no fallen leaves in spring or summer');
    assert(leavesIn(2) > 200, `most willows have leaves under them in autumn (${leavesIn(2)})`);
    assert(R.kinds.leaves.hosts.includes('willow'), 'under the willows');
  });

  test(G, 'a treat set out lies, pales over its last hours and is gone by the hour alone', async () => {
    const T = await treatsP;
    const list = cleanTreats([['wrack', 1.234, 2.345, 100.111, 1], ['bad', 'x', 0, 0, 2], ['leaf-pack', 0, 0, 101, 2.7], 'junk']);
    eq(JSON.stringify(list), JSON.stringify([['wrack', 1.23, 2.35, 100.11, 1], ['leaf-pack', 0, 0, 101, 2]]), 'kept tidy, bad entries dropped');
    eq(cleanTreats(Array.from({ length: 40 }, (_, i) => ['wrack', 0, 0, i, i])).length, TREATS_MAX, 'at most TREATS_MAX');
    const t = /** @type {any} */ (['wrack', 0, 0, 100, 1]);
    eq(lyingAt([t], 100, T).length, 1, 'lies when set');
    eq(lyingAt([t], 100 + T.fadeH - 0.01, T).length, 1, 'still there just before fadeH');
    eq(lyingAt([t], 100 + T.fadeH, T).length, 0, 'gone at fadeH');
    eq(paleOf(t, 100, T), 0, 'fresh');
    eq(paleOf(t, 100 + T.fadeH - T.paleH, T), 0, 'paling starts paleH before the end');
    assert(paleOf(t, 100 + T.fadeH - T.paleH / 2, T) > 0.4, 'half pale half way through');
    const g = cleanGather({ version: 1, events: [], treats: [t] });
    eq(g.treats?.length, 1, 'the gather section keeps them');
    eq(cleanGather({ version: 1, events: [] }).treats, undefined, 'and adds nothing when there are none');
  });

  test(G, 'who likes what comes from the species recipes; the leaf pack is made at the workbench', async () => {
    const recs = await specP, C = await cookP, Pk = await packP;
    const species = recs.map((rec) => ({ key: keyOf(rec), rec }));
    eq(likersOf('wrack', species).map((l) => l.key).join(), 'frogs', 'wrack: frogs');
    eq(likersOf('kelp', species).map((l) => `${l.key}:${l.T.id}`).join(), 'frogs:wrack', 'kelp: the frogs\' wrack treat');
    eq(likersOf('leaf-pack', species).map((l) => l.key).join(), 'minnows', 'leaf pack: minnows');
    assert(!isTreatKind('pebbles', species) && !isTreatKind('leaves', species), 'pebbles and loose leaves are nobody\'s treat');
    const M = C.makes['leaf-pack'];
    eq(M.at, 'workbench', 'at the workbench');
    eq(M.parts.join(), 'leaves,rush-cord', 'fallen leaves and rush cord');
    eq(M.gives, 'leaf-pack', 'gives a leaf pack');
    for (const k of ['leaves', 'kelp', 'wrack', 'leaf-pack']) {
      assert(Pk.kinds.some((/** @type {any} */ q) => q.id === k), `${k} is a pouch kind`);
      assert(Pk.pickups.kinds[k], `${k} has a look on the ground`);
    }
  });

  // ---- Turtle friendship and gifts at naming (Matt, October 27, 2026) ----

  test(G, 'the gift givers come to know you: turtles name in about 7.5 played days, about 2.3 with a parcel a day', async () => {
    const recs = await specP, T = await treatsP;
    const H = T.labHabit, by = Object.fromEntries(recs.map((r) => [r.id, r]));
    const known = (/** @type {any} */ rec, /** @type {any} */ h) => paceCurve(rec, { ...H, ...h }, 30).at.known;
    for (const id of ['frog', 'turtle']) eq(by[id].presence.namingTrust, 0.5, `${id}: named at 0.5`);
    for (const id of ['minnow', 'dragonfly']) eq(by[id].presence.knownTrust, 0.5, `${id}: known at 0.5`);
    eq(knownAt(by.damselfly), undefined, 'damselflies give no gift, so none');
    const days = {
      frog: [known(by.frog, { treat: false }), known(by.frog, { treat: true })],
      minnow: [known(by.minnow, { treat: false }), known(by.minnow, { treat: true })],
      dragonfly: [known(by.dragonfly, { treat: false })],
      turtle: [known(by.turtle, { treat: false }), known(by.turtle, { treat: true, treatId: 'worms' }), known(by.turtle, { treat: true, treatId: 'lily-parcel' })],
    };
    // The first summer holds about 9 played days once the turtles have come.
    assert(days.turtle[1] < 6 && days.turtle[2] < days.turtle[1], `with treats: worms ${days.turtle[1]?.toFixed(1)}, a parcel ${days.turtle[2]?.toFixed(1)}`);
    // 1.5 times the October 27 pace (October 28, 2026): a frog's gift in about 3.5 days, 2.5 with treats.
    assert(days.turtle[0] > 6.8 && days.turtle[0] < 8.2, `without treats about 7.5 (${days.turtle[0]?.toFixed(1)})`);
    assert(days.turtle[2] > 2 && days.turtle[2] < 2.6, `a parcel a day about 2.3 (${days.turtle[2]?.toFixed(1)})`);
    assert(days.frog[0] > 3.2 && days.frog[0] < 3.9 && days.frog[1] > 2.2 && days.frog[1] < 2.9, `frogs about 3.5, 2.5 with treats (${days.frog[0]?.toFixed(1)}/${days.frog[1]?.toFixed(1)})`);
    assert(days.frog[0] > days.frog[1] && days.minnow[1] < days.minnow[0], 'a treat a day comes sooner');
    assert(days.dragonfly[0] > 4 && days.dragonfly[0] < 7, `dragonflies by watching (${days.dragonfly[0]?.toFixed(1)})`);
    return Object.entries(days).map(([k, v]) => `${k} ${v.map((d) => d?.toFixed(1)).join('/')}`).join(', ');
  });

  test(G, 'a turtle knows you as its group does, plus what it ate itself; it can be named at 0.5', async () => {
    const [, , , , turtle] = await specP;
    const P = turtle.presence, key = keyOf(turtle);
    eq(key, 'turtles', 'key');
    eq(turtleId(3, 2), 3002, 'id: group x 1000 + place');
    eq(groupOfTurtle(3002), 3, 'and back');
    let state = { creatures: { turtles: { groups: [{ id: 3, count: 3 }], trust: 0.2 } } };
    state = addSwarmEvent(state, key, { kind: 'treat', hour: 30, treat: 'lily-parcel', who: [3000, 3001] });
    state = addSwarmEvent(state, key, { kind: 'treat', hour: 31, treat: 'worms', who: [3000] });
    const S = { ...state.creatures.turtles };
    const ev = applySwarmTrust(S, P, key);
    const parcel = r4(P.feedTrust * P.treatFeedsOf['lily-parcel']);
    eq(S.trust, r4(0.2 + parcel), 'the group: one treat that day, the parcel');
    eq(turtleTrust(S, 3000, P), r4(0.2 + parcel + parcel), 'a turtle that tore at it: its own share on top');
    eq(turtleTrust(S, 3001, P), r4(0.2 + parcel + parcel), 'and the other one');
    eq(turtleTrust(S, 3002, P), r4(0.2 + parcel), 'one that did not: the group\'s');
    assert(ev.some((e) => e.name === 'creature:ate' && e.payload.treat === 'worms'), 'the worms were eaten, for nothing more that day');
    assert(parcel > r4(P.feedTrust * P.treatFeeds), 'a parcel is worth more than worms');
    // Never past the ceiling.
    const U = { trust: 0.6, groups: [{ id: 3 }], bonds: [{ id: 3000, own: 0.4 }] };
    eq(turtleTrust(U, 3000, P), maxTrust(P), 'capped');
    // Naming: kept, once, only for a group that is there.
    const named = nameTurtle({ creatures: { turtles: S } }, 3002, 'Mossback', 400);
    eq(bondOf(named.creatures.turtles, 3002)?.name, 'Mossback', 'named');
    eq(bondOf(named.creatures.turtles, 3002)?.namedAt, 400, 'with the hour');
    eq(nameTurtle(named, 3002, 'Slate', 401), named, 'a name is kept');
    eq(nameTurtle(named, 9001, 'Slate', 401), named, 'no such group');
    eq(namedTurtles(named.creatures.turtles).map((b) => b.name).join(), 'Mossback', 'the named ones');
    eq(JSON.stringify(applySwarmTrust({ trust: 0.1 }, P, key)), '[]', 'a group with nothing pending writes no bonds');
  });

  test(G, 'minnows and dragonflies come to know you once, at knownTrust; an older save too', async () => {
    const [, minnow, dragonfly] = await specP;
    for (const rec of [minnow, dragonfly]) {
      const P = rec.presence, key = keyOf(rec);
      const S = /** @type {any} */ ({ trust: P.knownTrust - 0.001, pending: [{ kind: 'watched', minutes: 5, hour: 1 }] });
      const ev = applySwarmTrust(S, P, key);
      eq(ev.filter((e) => e.name === 'creature:known').length, 1, `${key}: known`);
      eq(S.known, true, 'kept');
      S.pending = [{ kind: 'watched', minutes: 5, hour: 2 }];
      eq(applySwarmTrust(S, P, key).filter((e) => e.name === 'creature:known').length, 0, 'once');
      const old = /** @type {any} */ ({ trust: 0.6 });
      eq(applySwarmTrust(old, P, key).filter((e) => e.name === 'creature:known').length, 1, `${key}: an older save past it is known at its next hour`);
      const low = /** @type {any} */ ({ trust: 0.2 });
      applySwarmTrust(low, P, key);
      eq(low.known, undefined, 'below it, nothing is added to the save');
    }
  });

  test(G, 'gifts come at known, not at happy; the journal writes known from a name or the event', async () => {
    const words = await json('world/journal'), naturalist = await json('world/naturalist');
    const recs = await specP;
    const gifts = Object.fromEntries(recs.filter((r) => r.ecology?.gift).map((r) => [keyOf(r), r.ecology.gift]));
    eq(Object.keys(gifts).sort().join(), 'dragonflies,frogs,minnows,turtles', 'the four gift givers');
    const ask = (/** @type {string[]} */ flags) => due({ found: 0, flags, earned: {}, rewards: [], gifts, words, giftWords: naturalist.gifts }).map((g) => g.id).sort().join();
    eq(ask(['frogs:happy', 'minnows:happy', 'dragonflies:happy', 'turtles:happy']), '', 'happy gives nothing now');
    eq(ask(['frogs:known', 'turtles:known']), 'frogs,turtles', 'known gives');
    eq(due({ found: 0, flags: ['frogs:known'], earned: { gifts: { frogs: true } }, rewards: [], gifts, words, giftWords: naturalist.gifts }).length, 0, 'an older save that has its gift keeps it, once');
    for (const sp of Object.keys(gifts)) assert(words.species[sp].gives.some((/** @type {any} */ g) => g.when === `${sp}:known`), `${sp}: its gives line inks at known`);
    // A name writes the flag and the note; a known event does for a school.
    const ctx = { hour: 50, words, date: 'Summer, day 3', copy: (/** @type {any} */ j) => structuredClone(j) };
    const j0 = { species: {}, flags: [], notes: [] };
    const r = namedFrog(/** @type {any} */ (j0), 'Mossback', ctx, 'turtles');
    assert(r.journal.flags.includes('turtles:known'), 'naming a turtle: turtles:known');
    eq(r.notes[0].text, 'You named a turtle Mossback.', 'its note');
  });

  test(G, 'the turtles\' treats: worms and the lily leaf parcel, set at the water\'s edge, made at the bench', async () => {
    const recs = await specP, C = await cookP, Pk = await packP, R = await gatherP, words = await json('world/journal');
    const species = recs.map((rec) => ({ key: keyOf(rec), rec }));
    eq(likersOf('worms', species).map((l) => l.key).join(), 'turtles', 'worms: turtles');
    eq(likersOf('lily-parcel', species).map((l) => l.key).join(), 'turtles', 'the parcel: turtles');
    const T = likersOf('lily-parcel', species)[0].T;
    eq(treatIdOf('worms', T), 'worms', 'worms are their own treat');
    eq(treatIdOf('lily-parcel', T), 'lily-parcel', 'and the parcel its own');
    eq(treatIdOf('leaf-pack', likersOf('leaf-pack', species)[0].T), 'leaf-pack', 'one treat id when there is no idOf');
    assert(T.edge && !T.water, 'set at the edge, not in the water');
    const M = C.makes['lily-parcel'];
    eq(M.at, 'workbench', 'at the workbench');
    eq(M.parts.join(), 'worms,lilies.leaf,rush-cord', 'worms, a lily leaf, rush cord');
    eq(M.gives, 'lily-parcel', 'gives a parcel');
    for (const k of ['worms', 'lily-parcel', 'lilies.leaf']) {
      assert(Pk.kinds.some((/** @type {any} */ q) => q.id === k), `${k} is a pouch kind`);
      assert(Pk.pickups.kinds[k], `${k} has a look on the ground`);
    }
    const part = R.plants.parts['lilies.leaf'];
    eq(part.type, 'water', 'a water plant\'s share');
    eq(JSON.stringify(part.window), '[1,2]', 'picked in summer');
    const likes = words.species.turtles.likes.map((/** @type {any} */ l) => `${l.text}|${l.learn}`);
    assert(likes.includes("Takes worms at the water's edge|likes:worms") && likes.includes('Tears at a lily leaf parcel|likes:lily-parcel'), 'their Likes lines');
  });
}
