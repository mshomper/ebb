// @ts-check
// The naturalist's notes and species gifts (src/world/expansion.js), and the save upgrade that
// brought them in (src/save/migrate-naturalist.js), for tools/unit-tests.html.

import { findsFound, naturalistLine, due, grant, ready } from '../src/world/expansion.js';
import { naturalist3 } from '../src/save/migrate-naturalist.js';
import { cliffs4 } from '../src/save/migrate-cliffs.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { musselPair, musselBones } from '../src/world/finds/mussel.js';

const G = 'naturalist';

/** A journal with these finds known, found at these hours. @param {Record<string, number>} found @param {string[]} [flags] */
function journalWith(found, flags = []) {
  /** @type {Record<string, any>} */ const species = {};
  for (const [id, first] of Object.entries(found)) species[id] = { ever: true, first, learned: ['seen'] };
  return { species, flags, notes: [] };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addNaturalistTests(test, assert, eq) {
  const loaded = Promise.all([
    fetch('../recipes/world/naturalist.json').then((r) => r.json()),
    fetch('../recipes/world/journal.json').then((r) => r.json()),
  ]);

  test(G, 'finds count in the order you found them, and only finds', async () => {
    const [, words] = await loaded;
    const j = journalWith({ lugworm: 30, anemone: 12, reeds: 1, periwinkle: 12 });
    eq(findsFound(j, words).join(), 'anemone,periwinkle,lugworm', 'by hour, ties in findOrder; reeds is not a find');
  });

  test(G, 'the line: marks, a station after its mark, gaps only to the next reward, no further', async () => {
    const [R] = await loaded;
    const line = naturalistLine(['anemone', 'lugworm'], R.rewards, {});
    eq(line.map((e) => e.type).join(), 'mark,mark,gap,station', 'two marks, one gap, the shells in pencil');
    const st = /** @type {any} */ (line[3]);
    eq(`${st.id} ${st.inked}`, 'shells false', 'shells next, in pencil');
    const after = naturalistLine(['anemone', 'lugworm', 'periwinkle', 'hermitcrab'], R.rewards, { naturalist: ['shells'] });
    eq(after.map((e) => e.type).join(), 'mark,mark,mark,station,mark,gap,gap,station', 'shells inked after the third mark, then on to stones');
    assert(/** @type {any} */ (after[3]).inked, 'shells inked');
    assert(!after.some((e) => /** @type {any} */ (e).id === 'lens'), 'nothing past the next reward');
    eq(naturalistLine([], R.rewards, {}).filter((e) => e.type === 'gap').length, 3, 'a new island: three gaps then shells');
  });

  test(G, 'shells are given at three finds, once; rewards not built yet are never given', async () => {
    const [R, words] = await loaded;
    const p = { flags: [], rewards: R.rewards, gifts: {}, words, giftWords: R.gifts };
    eq(due({ ...p, found: 2, earned: {} }).length, 0, 'two finds: nothing yet');
    const d = due({ ...p, found: 3, earned: {} });
    eq(d.map((g) => g.id).join(), 'shells', 'three finds: shells');
    const earned = grant({}, d[0]);
    assert(earned.shells === true && earned.naturalist.includes('shells'), 'shells earned');
    eq(due({ ...p, found: 20, earned }).length, 0, 'given once; stones, lens and driftwood are not built yet');
    assert(!ready(R.rewards.find((/** @type {any} */ r) => r.id === 'stones')), 'stones not built');
  });

  test(G, 'a happy species gives its gift once, and a seed gift offers that plant', async () => {
    const [R, words] = await loaded;
    const p = { found: 0, rewards: R.rewards, gifts: { frogs: { kind: 'seed', id: 'lilies' } }, words, giftWords: R.gifts };
    eq(due({ ...p, flags: [], earned: {} }).length, 0, 'not happy: nothing');
    const d = due({ ...p, flags: ['frogs:happy'], earned: {} });
    eq(d.length, 1, 'happy: the gift');
    assert(/lilies/i.test(d[0].line) && /frogs/i.test(d[0].title), 'its words name the plant and the species');
    const earned = grant({ springs: true }, d[0]);
    assert(earned.seeds.lilies && earned.gifts.frogs && earned.springs, 'seed given, earlier unlocks kept');
    eq(due({ ...p, flags: ['frogs:happy'], earned }).length, 0, 'given once');
  });

  test(G, "the frogs' gift is the Cliff tool: its own words and drawn icon, given once", async () => {
    const [R, words] = await loaded;
    const frog = await fetch('../recipes/species/frog.json').then((r) => r.json());
    eq(JSON.stringify(frog.ecology.gift), JSON.stringify({ kind: 'tool', id: 'cliffs' }), 'frog.json gift');
    const p = { found: 0, rewards: R.rewards, gifts: { frogs: frog.ecology.gift }, words, giftWords: R.gifts };
    const d = due({ ...p, flags: ['frogs:happy'], earned: {} });
    eq(d.length, 1, 'happy: the gift');
    eq(d[0].icon, 'terrace', 'the terrace icon');
    assert(/frogs/i.test(d[0].title) && /terrace/i.test(d[0].line) && !/[{}]/.test(d[0].title + d[0].line), `card words: ${d[0].title}. ${d[0].line}`);
    const earned = grant({ springs: true }, d[0]);
    assert(earned.cliffs === true && earned.gifts.frogs && earned.springs && !earned.seeds, 'cliffs given, earlier unlocks kept, no seed');
    eq(due({ ...p, flags: ['frogs:happy'], earned }).length, 0, 'given once');
  });

  test(G, 'the same journal gives the same, every time (live, catch-up, a reload)', async () => {
    const [R, words] = await loaded;
    const j = journalWith({ anemone: 4, periwinkle: 9, lugworm: 22 }, ['frogs:happy']);
    const run = () => {
      let e = {};
      for (const g of due({ found: findsFound(j, words).length, flags: j.flags, earned: e, rewards: R.rewards, gifts: { frogs: { kind: 'seed', id: 'lilies' } }, words, giftWords: R.gifts })) e = grant(e, g);
      return JSON.stringify(e);
    };
    eq(run(), run(), 'deterministic');
  });

  test(G, 'save format 3: an island that found shells, or three finds, keeps shells', () => {
    const s = { meta: { worldT: 100 }, journal: journalWith({ shells: 40 }), unlocks: { springs: true } };
    const m = naturalist3(s);
    assert(m.unlocks.shells && m.unlocks.naturalist.includes('shells') && m.unlocks.springs, 'shells kept, springs kept');
    assert(!s.unlocks.shells, 'the input is not changed');
    const three = naturalist3({ journal: journalWith({ anemone: 1, lugworm: 2, periwinkle: 3 }), unlocks: {} });
    assert(three.unlocks.shells, 'three kinds: shells');
    const two = naturalist3({ journal: journalWith({ anemone: 1, lugworm: 2 }), unlocks: {} });
    assert(!two.unlocks.shells && !two.unlocks.naturalist, 'two kinds: nothing yet, the card will come at the third');
    const none = naturalist3({ journal: null, unlocks: undefined });
    eq(JSON.stringify(none.unlocks), '{}', 'no journal: empty unlocks');
  });

  test(G, 'the mussel: one valve mirrored into a pair that opens about its hinge', () => {
    // A tiny valve: a triangle cupped below its rim (y 0..1), beak at x = 0.
    const valve = { vertices: Float32Array.from([0, 1, 0, 0, -1, 0, 0.2, 0.2, 0.3, 1, 1, -0.3, 0, -1, 0, 0.2, 0.2, 0.3, 1, 0, 0.3, 0, -1, 0, 0.2, 0.2, 0.3]), count: 3, indices: Uint32Array.from([0, 1, 2]) };
    const pr = musselPair(valve);
    eq(pr.mesh.count, 6, 'two valves');
    eq(`${pr.mesh.vertices[3 * 9 + 1]} ${pr.mesh.vertices[5 * 9 + 1]}`, '1 2', 'the upper valve is the lower mirrored across the rim');
    eq(pr.mesh.vertices[5 * 9 + 4], 1, 'its normals turn with it');
    eq([...pr.mesh.indices.slice(3)].join(), '3,5,4', 'its triangles wound back');
    eq(`${pr.joints[0]} ${pr.joints[3 * 4]}`, '0 1', 'lower valve on bone 0, upper on bone 1');
    eq(`${pr.hinge[0]} ${pr.hinge[1]}`, '0 1', 'the hinge at the beak, on the rim');
    const B = musselBones(pr.hinge, 0.2);
    const tip = [1, 1], h = pr.hinge;
    const y = B[17] * tip[0] + B[21] * tip[1] + B[29];
    assert(y > 1.15, 'opening lifts the far end of the upper valve');
    const hy = B[17] * h[0] + B[21] * h[1] + B[29], hx = B[16] * h[0] + B[20] * h[1] + B[28];
    assert(Math.abs(hx - h[0]) < 1e-6 && Math.abs(hy - h[1]) < 1e-6, 'the hinge stays put');
    eq([...musselBones(pr.hinge, 0).slice(16)].map((v) => Math.round(v * 1e6) / 1e6).join(), '1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1', 'shut: no turn');
  });

  test(G, 'save upgrade: happy frogs keep their lilies, quietly; the step runs from format 2', () => {
    const m = naturalist3({ journal: journalWith({}, ['frogs:happy']), unlocks: {} });
    assert(m.unlocks.gifts.frogs && m.unlocks.seeds.lilies, 'gift and seed');
    const up = migrate({ meta: { worldT: 10 }, world: null, journal: journalWith({ shells: 2 }), unlocks: {} }, 2);
    assert(up.unlocks.shells, 'migrate(2) runs the naturalist step');
    eq(JSON.stringify(naturalist3(naturalist3(up))), JSON.stringify(naturalist3(up)), 'running it again changes nothing');
  });

  test(G, `save format ${FORMAT}: frogs that gave their gift keep the Cliff tool, quietly`, () => {
    const gave = cliffs4({ journal: journalWith({}, ['frogs:happy']), unlocks: { gifts: { frogs: true }, seeds: { lilies: true }, springs: true } });
    assert(gave.unlocks.cliffs && gave.unlocks.gifts.frogs && gave.unlocks.springs, 'cliffs added, the rest kept');
    const not = cliffs4({ journal: journalWith({}), unlocks: {} });
    assert(!not.unlocks.cliffs, 'frogs not happy yet: no cliffs; the card comes when they are');
    const from2 = migrate({ meta: { worldT: 10 }, world: null, journal: journalWith({}, ['frogs:happy']), unlocks: {} }, 2);
    assert(from2.unlocks.cliffs && from2.unlocks.gifts.frogs, 'a format 2 island with happy frogs ends with cliffs');
    const s = { unlocks: { gifts: { frogs: true } } };
    cliffs4(s);
    assert(!(/** @type {any} */ (s.unlocks)).cliffs, 'the input is not changed');
    eq(FORMAT, 4, 'this build writes format 4');
  });
}

