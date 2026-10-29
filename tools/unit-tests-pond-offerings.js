// @ts-check
// Pond offerings tests for tools/unit-tests.html (B1 P1, docs/future/13 8.3 F-05 and F-07): pondweed
// strands are a gather from grown pondweed, a pouch kind with a look on the ground, and the minnows'
// second treat (its own id, worth and graze time, one treat a day); the perch stick is a saved piece
// that stands only in a pond's shallows, its tip where its mesh ends; a dragonfly on patrol lands on
// it and reports the landing; a landing is the dragonflies' treat, once a day; and both have their
// Likes lines and notes.

import { applySwarmTrust, addSwarmEvent } from '../src/world/creatures/swarms.js';
import { likersOf, isTreatKind, treatIdOf } from '../src/world/creatures/treat-rules.js';
import { treatGain } from '../src/world/creatures/trust.js';
import { pickable, partOf } from '../src/world/gather/plants.js';
import { makePerch, shallowsAlong, perchTip, perchMesh, rayToSegment } from '../src/world/creatures/perch-rules.js';
import { createPatrol } from '../src/world/creatures/patrol.js';
import { cleanPieces } from '../src/world/pieces/model.js';
import { WATER_CLASS } from '../src/world/water/summary.js';
import { itemIconFor, makeIcon } from '../src/ui/icons/item-registry.js';
import { keyOf } from '../src/world/species.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';

const G = 'pondoffer';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPondOfferingsTests(test, assert, eq) {
  const specP = Promise.all(['minnow', 'dragonfly', 'frog', 'turtle', 'damselfly'].map((id) => json(`species/${id}`)));
  const treatsP = json('world/treats'), gatherP = json('world/gather'), packP = json('world/pack'), wordsP = json('world/journal');
  const pondweedP = json('flora/pondweed');

  test(G, 'pondweed strands: a gather from grown pondweed, in its season, that grows back', async () => {
    const R = await gatherP, flora = await pondweedP;
    const P = partOf('pondweed', 'strands', R);
    assert(P, 'pondweed gives strands');
    eq(P?.type, 'water', 'a water plant, picked from the bank or the shallows');
    const grown = { id: 1, sp: 'pondweed', size: 1, best: 1 };
    eq(pickable(grown, 'strands', { flora, pos: 1.5 }, R).ok, true, 'a grown pondweed in summer');
    eq(pickable(grown, 'strands', { flora, pos: 3.5 }, R).why, 'season', 'not in winter, when it has died back');
    eq(pickable({ ...grown, best: 0.3, size: 0.3 }, 'strands', { flora, pos: 1.5 }, R).why, 'young', 'not a young one');
    eq(pickable({ ...grown, size: 1 - (P?.share ?? 0) }, 'strands', { flora, pos: 1.5 }, R).why, 'rest', 'picked once, it rests');
  });

  test(G, 'pondweed strands: a pouch kind with its icon and a look when set out', async () => {
    const Pk = await packP;
    const k = Pk.kinds.find((/** @type {any} */ q) => q.id === 'pondweed.strands');
    assert(k, 'a pouch kind');
    eq(k?.group, 'living', 'with the living things');
    assert(Pk.pickups.kinds['pondweed.strands'], 'a look on the ground (or the water)');
    eq(itemIconFor('pondweed.strands'), 'pondweed', 'the pondweed glyph');
    eq(makeIcon('perch-stick'), 'perch-stick', 'and the perch stick has its own (its card wears it)');
  });

  test(G, 'pondweed is the minnows\' second treat: its own id, worth and graze, one treat a day', async () => {
    const recs = await specP;
    const species = recs.map((rec) => ({ key: keyOf(rec), rec }));
    const L = likersOf('pondweed.strands', species);
    eq(L.map((l) => l.key).join(), 'minnows', 'only the minnows like it');
    const T = L[0].T;
    eq(treatIdOf('pondweed.strands', T), 'pondweed', 'its treat id');
    eq(treatIdOf('leaf-pack', T), 'leaf-pack', 'the leaf pack keeps its own');
    assert(T.water, 'set out on the water');
    const minnow = recs[0], P = minnow.presence;
    assert(minnow.treat.nibbleSOf.pondweed > minnow.treat.nibbleS, 'grazed a little longer than a leaf pack');
    eq(treatGain(P, undefined, 100, 'pondweed').gain, P.feedTrust * P.treatFeedsOf.pondweed, 'worth its own meals');
    assert(P.treatFeedsOf.pondweed < P.treatFeeds, 'a raw handful is worth a little less than the made pack');
    // A leaf pack and pondweed the same day: only the first counts.
    let state = { creatures: { minnows: { groups: [{ id: 1, count: 8 }], trust: 0 } } };
    state = addSwarmEvent(state, 'minnows', { kind: 'treat', hour: 30, treat: 'pondweed' });
    state = addSwarmEvent(state, 'minnows', { kind: 'treat', hour: 31, treat: 'leaf-pack' });
    const S = JSON.parse(JSON.stringify(state.creatures.minnows));
    const events = applySwarmTrust(S, P, 'minnows');
    eq(S.trust, Math.round(P.feedTrust * P.treatFeedsOf.pondweed * 10000) / 10000, 'one treat a day');
    assert(events.some((e) => e.name === 'creature:ate' && e.payload.treat === 'pondweed'), 'creature:ate names the pondweed');
  });

  test(G, 'the perch stick is the dragonflies\' treat: nothing to Set out, a landing counts once a day', async () => {
    const recs = await specP;
    const species = recs.map((rec) => ({ key: keyOf(rec), rec }));
    const dragonfly = recs[1], T = dragonfly.treat, P = dragonfly.presence;
    eq(T.id, 'perch-stick', 'its id');
    eq(T.kinds.length, 0, 'no pouch is Set out for them');
    assert(!isTreatKind('sticks', species), 'sticks are nobody\'s treat');
    assert(T.nearM > 0, 'you must be near');
    assert(!dragonfly.feed, 'they still take no food');
    let state = { creatures: { dragonflies: { groups: [{ id: 1, count: 3 }], trust: 0.1 } } };
    state = addSwarmEvent(state, 'dragonflies', { kind: 'treat', hour: 40, treat: 'perch-stick' });
    state = addSwarmEvent(state, 'dragonflies', { kind: 'treat', hour: 41, treat: 'perch-stick' });
    const S = JSON.parse(JSON.stringify(state.creatures.dragonflies));
    const events = applySwarmTrust(S, P, 'dragonflies');
    eq(S.trust, Math.round((0.1 + P.feedTrust * P.treatFeeds) * 10000) / 10000, 'the first landing of the day counts');
    eq(S.treatDay, Math.floor(41 / HOURS_PER_DAY), 'the day is kept');
    assert(events.some((e) => e.name === 'creature:ate' && e.payload.treat === 'perch-stick'), 'creature:ate names the perch');
  });

  test(G, 'a perch stick stands only in a pond\'s shallows; its record is saved and its tip is where its mesh ends', async () => {
    const T = await treatsP, P = T.perch;
    // A line from the bank out: dry, too shallow, then shallows, then deep. The sea never counts.
    /** @param {number} x */
    const depthAt = (x) => (x < 0.5 ? 0 : x < 0.8 ? 0.02 : x < 1.4 ? 0.2 : 0.8);
    const pond = (/** @type {number} */ x) => ({ depth: depthAt(x), cls: depthAt(x) > 0 ? WATER_CLASS.still : WATER_CLASS.dry });
    const at = shallowsAlong(0, 0, 1, 0, pond, P);
    assert(at && at.x >= 0.8 && at.x < 1.4, `the first shallows along the line (${at?.x.toFixed(2)})`);
    eq(shallowsAlong(0, 0, 1, 0, (x) => ({ ...pond(x), cls: x < 0.5 ? WATER_CLASS.dry : WATER_CLASS.sea }), P), null, 'never the sea');
    eq(shallowsAlong(0, 0, 1, 0, () => ({ depth: 0.9, cls: WATER_CLASS.still }), P), null, 'never deep water');
    // Its record: the same every time from the same seed and number, and kept by the save.
    const a = makePerch(1234, 7, 1.2, 0, 0.2, 500, P), b = makePerch(1234, 7, 1.2, 0, 0.2, 500, P);
    eq(JSON.stringify(a), JSON.stringify(b), 'seeded');
    eq(a.kind, 'perch', 'a piece of kind perch');
    assert(a.size >= P.sinkM + 0.2 + P.aboveM[0] - 1e-3 && a.size <= P.sinkM + 0.2 + P.aboveM[1] + 1e-3, `stands aboveM over the water (${a.size})`);
    const kept = cleanPieces({ version: 1, list: [a], nextId: 8, arrived: false });
    eq(JSON.stringify(kept.list[0]), JSON.stringify(a), 'the save keeps it as it was');
    // The tip: the mesh's highest point, from its foot sinkM under the bed.
    const bed = 0.5, tip = perchTip(a, bed, P);
    const m = perchMesh(a, P.sinkM + 0.2, P);
    let top = -Infinity;
    for (let i = 0; i < m.count; i++) top = Math.max(top, m.vertices[i * 9 + 1]);
    assert(Math.abs(bed - P.sinkM + top - tip.y) < 0.03, `the tip is the top of the stick (${(bed - P.sinkM + top).toFixed(3)} / ${tip.y.toFixed(3)})`);
    assert(tip.y > bed + 0.2 + P.aboveM[0] * 0.9, 'well above the water');
    // A tap's ray meets it; one passing a meter off does not.
    const hit = rayToSegment([1.2, 1, -3], [0, 0, 1], [1.2, 0, 0], [1.2, 1, 0]);
    assert(hit.d < 1e-6 && Math.abs(hit.t - 3) < 1e-6, 'straight through it');
    assert(rayToSegment([2.2, 1, -3], [0, 0, 1], [1.2, 0, 0], [1.2, 1, 0]).d > 0.99, 'a meter off');
  });

  test(G, 'a dragonfly on patrol lands on a perch stick near home now and then, one at a time, and says so', async () => {
    const recs = await specP, M = recs[1].motion;
    const stick = { id: 'p1', x: 1, y: 0.9, z: 0.5 };
    const env = { water: () => ({ surface: 0.2, depth: 0.3 }), ground: () => 0, perches: () => [], sticks: () => [stick] };
    const make = () => createPatrol({ id: 1, seed: 9, count: 3, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: 1, M, env });
    const a = make(), b = make();
    /** @type {any[]} */ const landings = [];
    let most = 0, onTip = 0;
    for (let i = 0; i < 30 * 600; i++) {
      a.step(1 / 30); b.step(1 / 30);
      landings.push(...a.landed());
      b.landed();
      const on = a.fish.filter((f) => f.mode === 'perch' && f.perch?.stick === 'p1');
      most = Math.max(most, on.length);
      for (const f of on) if (Math.hypot(f.x - stick.x, f.y - stick.y, f.z - stick.z) < 1e-6) onTip++;
    }
    assert(landings.length >= 3, `landed on it ${landings.length} times in ten minutes`);
    assert(landings.every((l) => l.stick === 'p1' && l.x === stick.x && l.z === stick.z), 'each landing names the stick and where it is');
    eq(most, 1, 'one at a time');
    assert(onTip > 0, 'sitting on its very tip');
    eq(JSON.stringify(a.fish.map((f) => [f.x, f.z, f.mode])), JSON.stringify(b.fish.map((f) => [f.x, f.z, f.mode])), 'the same beat flies the same way');
    // Taken up: one sitting on it flies off at once.
    const c = make();
    let sitting = false;
    for (let i = 0; i < 30 * 600 && !sitting; i++) { c.step(1 / 30); sitting = c.fish.some((f) => f.mode === 'perch' && f.perch?.stick === 'p1'); }
    assert(sitting, 'one sits on it');
    env.sticks = () => [];
    c.step(1 / 30);
    assert(!c.fish.some((f) => f.perch?.stick === 'p1'), 'and leaves once it is taken up');
    // Too far from home: passed by.
    const far = createPatrol({ id: 1, seed: 9, count: 3, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: 1, M,
      env: { ...env, sticks: () => [{ ...stick, x: M.stickReachM + 2 }] } });
    let farLand = 0;
    for (let i = 0; i < 30 * 300; i++) { far.step(1 / 30); farLand += far.landed().length; }
    eq(farLand, 0, 'a stick beyond stickReachM of home');
  });

  test(G, 'both treats have their Likes lines and their own notes', async () => {
    const words = await wordsP;
    const likes = (/** @type {string} */ sp) => words.species[sp].likes.map((/** @type {any} */ l) => `${l.text}|${l.learn}`);
    assert(likes('minnows').includes('Swirls up to graze the pondweed|likes:pondweed'), 'the minnows\' line');
    assert(likes('dragonflies').includes('Comes back again and again to the same bare perch|likes:perch-stick'), 'the dragonflies\' line');
    assert(words.species.minnows.notes['treat:pondweed'], 'the minnows\' note');
    assert(words.species.dragonflies.notes['treat:perch-stick'], 'the dragonflies\' note');
    const all = JSON.stringify([words.species.minnows, words.species.dragonflies]);
    assert(!/genuine/i.test(all), 'no banned words');
  });
}
