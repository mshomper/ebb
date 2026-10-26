// @ts-check
// Treats and friendship pace tests for tools/unit-tests.html (P2h, docs/future/13 section 8): a treat
// is worth treatFeeds meals once a creature a game day, for a frog and for a school; a tea boon
// multiplies watching, meals and treats but not the camp's standing presence; trust never goes down
// or past the ceiling; the trust lab's pace is about 7 played days to every top word without treats
// and about 5 with a treat a day; kelp, wrack and fallen leaves lie where and when gather.json says;
// a treat set out lies, pales and is gone by the hour alone; and who likes what comes from the
// species recipes.

import { applyTrust, treatGain, maxTrust, addTrustEvent } from '../src/world/creatures/trust.js';
import { applySwarmTrust, addSwarmEvent } from '../src/world/creatures/swarms.js';
import { paceCurve, topWord } from '../src/world/creatures/pace.js';
import { cleanTreats, lyingAt, paleOf, likersOf, isTreatKind, TREATS_MAX } from '../src/world/creatures/treat-rules.js';
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

  test(G, 'the trust lab: about 7 played days to every top word, about 5 with a treat a day', async () => {
    const recs = await specP, T = await treatsP, C = await cookP;
    const H = T.labHabit;
    const out = [];
    for (const rec of recs) {
      const top = topWord(rec);
      const none = paceCurve(rec, { ...H, treat: false }, 20).at[top];
      assert(none > 6.3 && none < 7.6, `${rec.id}: ${none?.toFixed(2)} days to ${top} without treats`);
      out.push(`${rec.id} ${none.toFixed(1)}`);
      if (!(rec.presence.treatFeeds > 0)) continue;
      const one = paceCurve(rec, { ...H, treat: true }, 20).at[top];
      assert(one > 4.5 && one < 5.5, `${rec.id}: ${one.toFixed(2)} days with a treat a day`);
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
}
