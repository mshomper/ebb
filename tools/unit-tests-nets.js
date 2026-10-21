// @ts-check
// The nets (docs/future/12, piece K6) for tools/unit-tests.html: where a net may be cast, when it is
// ready, the beachcomber's stop that gives it, and save format 7. The haul and the living catches
// have their own groups below.

import { cleanNets, emptyNets, ensureNets, canCast, cast, bringIn, netState, nextHighTide, readyHour, noteReleased, RELEASED_CAP } from '../src/world/nets/model.js';
import { due, grant, keptFamily } from '../src/world/expansion.js';
import { nets7 } from '../src/save/migrate-nets.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { snapshot, restore } from '../src/save/sections.js';
import { haulOf } from '../src/world/nets/haul.js';
import { catchMesh, catchNumbers, catchWords, distinctive } from '../src/world/nets/living/index.js';
import { pickRarity } from '../src/world/keepsakes/rarity.js';
import { hash32 } from '../src/core/rng.js';
import { foundFind } from '../src/world/journal/observe.js';
import { findsFound } from '../src/world/expansion.js';
import { registerCatchSketches } from '../src/ui/sketches/catch.js';
import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';
import { haulsJob, comeBack } from '../src/world/nets/haul.js';

const G = 'nets';
const H = 'nets: hauls';
const recipes = () => Promise.all([fetch('../recipes/world/nets.json').then((r) => r.json()), fetch('../recipes/world/keepsakes.json').then((r) => r.json())]);
/** A haul input. @param {Record<string, any>} [o] */
const input = (o = {}) => ({ seed: 99, net: { id: 1, kind: 'general' }, tideId: 40, cell: [10, 12], depthM: 0.6, spring: 0.9, season: 'summer', ...o });
const TIDE = { periodH: 12, phaseH: 0 };
const RULE = { wadeM: 0.15, coverM: 0.08 };

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addNetsTests(test, assert, eq) {
  test(G, 'a net goes in the shallows of the tide band, never fresh water, high ground or deep water', () => {
    const at = { band: true, depth: 0.05, ground: -0.4, nextHighLevel: 0.6 };
    assert(canCast(at, RULE).ok, 'ankle deep in the band');
    assert(canCast({ ...at, depth: 0 }, RULE).ok, 'bare wet sand the tide will cover');
    eq(/** @type {any} */ (canCast({ ...at, band: false, depth: 0.3 }, RULE)).reason, 'fresh', 'a pond');
    eq(/** @type {any} */ (canCast({ ...at, band: false, sea: true, depth: 2 }, RULE)).reason, 'deep', 'open sea past the tide band is too deep, not fresh');
    eq(/** @type {any} */ (canCast({ ...at, band: false, depth: 0 }, RULE)).reason, 'dry', 'dry land');
    eq(/** @type {any} */ (canCast({ ...at, ground: 0.55 }, RULE)).reason, 'dry', 'too high for the coming tide');
    eq(/** @type {any} */ (canCast({ ...at, depth: 0.4 }, RULE)).reason, 'deep', 'too deep to wade');
  });

  test(G, 'cast at low water, it fishes the next high water and is ready at the low after it, and waits', () => {
    let s = ensureNets(emptyNets(), { general: true });
    eq(s.nets.length, 1, 'one net once given');
    eq(ensureNets(s, { general: true }).nets.length, 1, 'never a second of the same kind');
    const id = s.nets[0].id;
    eq(netState(s.nets[0], 30, TIDE).state, 'in', 'in until cast');
    s = cast(s, id, 3, 4, 30, TIDE); // low water at hour 30
    eq(/** @type {any} */ (s.nets[0].at).setTide, 3, 'the high water at hour 36');
    eq(nextHighTide(36, TIDE), 4, 'cast right at high water, it waits for the next');
    const fishing = /** @type {any} */ (netState(s.nets[0], 33, TIDE));
    eq(fishing.state, 'fishing', 'fishing through the high water');
    eq(fishing.hoursLeft, 9, 'ready at the low water at hour 42');
    eq(readyHour(3, TIDE), 42, 'the low water after it');
    eq(netState(s.nets[0], 42, TIDE).state, 'ready', 'ready at that low water');
    eq(netState(s.nets[0], 42 + 24 * 30, TIDE).state, 'ready', 'and a month later, still ready (it never spoils)');
    s = bringIn(s, id);
    eq(netState(s.nets[0], 50, TIDE).state, 'in', 'lifting brings it in');
  });

  test(G, 'the test link casts a net that is ready at once', () => {
    const s = cast(ensureNets(emptyNets(), { general: true }), 1, 0, 0, 30, TIDE, { readyNow: true });
    eq(netState(s.nets[0], 30, TIDE).state, 'ready', 'ready at once');
  });

  test(G, 'released catches: the first of each kind, and distinctive ones, up to the cap', () => {
    let s = emptyNets();
    s = noteReleased(s, { kind: 'goby', seed: 1, hour: 5 }, false);
    s = noteReleased(s, { kind: 'goby', seed: 2, hour: 6 }, false);
    eq(s.released.length, 1, 'a second plain goby is not kept');
    s = noteReleased(s, { kind: 'goby', seed: 3, hour: 7 }, true);
    eq(s.released.length, 2, 'a distinctive one is');
    for (let i = 0; i < RELEASED_CAP + 5; i++) s = noteReleased(s, { kind: 'wrasse', seed: 100 + i, hour: 8 + i }, true);
    eq(s.released.length, RELEASED_CAP, 'never more than the cap');
    assert(s.released.some((r) => r.kind === 'goby' && r.seed === 1), "a kind's first is never forgotten");
  });

  test(G, 'nets read back from a save keep only what is readable', () => {
    eq(cleanNets(null).nets.length, 0, 'nothing readable is no nets');
    const c = cleanNets({ nets: [{ id: 2, kind: 'general', at: { x: 1, z: 2, setTide: 5 } }, { id: 'x' }], released: [{ kind: 'goby', seed: 4, hour: 1 }, {}], nextId: 1 });
    eq(c.nets.length, 1, 'the unreadable net goes');
    eq(c.nets[0].wear, 0, 'wear starts at 0 (K7)');
    eq(c.nextId, 3, 'the next id is past the highest');
    eq(c.released.length, 1, 'the unreadable release goes');
  });

  test(G, "the beachcomber's stop: the net at four families kept, once, never taken back", async () => {
    const B = await fetch('../recipes/world/beachcomber.json').then((r) => r.json());
    const ask = (/** @type {any} */ earned) => due({ found: 0, flags: [], earned, rewards: [], gifts: {}, words: {}, giftWords: {}, stops: B.stops });
    let earned = {};
    for (const f of ['shell', 'stone', 'shell', 'feather']) earned = keptFamily(earned, f);
    eq(/** @type {any} */ (earned).kept.length, 3, 'three families, a family counted once');
    eq(ask(earned).length, 0, 'nothing at three');
    earned = keptFamily(earned, 'urchin');
    const g = ask(earned);
    eq(g.length, 1, 'the net at four');
    eq(g[0].id, 'net', 'it is the net');
    earned = grant(earned, g[0]);
    assert(/** @type {any} */ (earned).nets?.general, 'the general net is given');
    eq(ask(earned).length, 0, 'once only');
    eq(keptFamily(earned, 'shell'), earned, 'keeping a family again changes nothing');
  });

  test(G, 'save format 7: the nets come back exactly, and an older island gets none and its kept families', () => {
    eq(FORMAT, 7, 'this build writes format 7');
    let n = ensureNets(emptyNets(), { general: true });
    n = cast(n, 1, 2.5, -3, 30, TIDE);
    n = noteReleased(n, { kind: 'goby', seed: 77, hour: 41 }, false);
    const { sections } = snapshot(/** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
      unlocks: {}, view: null, looks: {}, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0, nets: n }));
    eq(JSON.stringify(restore(Object.fromEntries(sections)).nets), JSON.stringify(n), 'the nets come back exactly');
    const old = { meta: {}, unlocks: { shells: true }, keepsakes: { version: 1, nextId: 3, shelf: [{ id: 1, n: { family: 'shell' }, hour: 1 }, { id: 2, n: { family: 'stone' }, hour: 2 }] } };
    const up = migrate(structuredClone(old), 6);
    eq(JSON.stringify(up.nets), JSON.stringify(emptyNets()), 'no nets yet');
    eq(up.unlocks.kept.join(), 'shell,stone', 'the families on its shelf are kept families');
    assert(up.unlocks.shells, 'the rest of its unlocks stay');
    nets7(old);
    assert(!(/** @type {any} */ (old)).nets, 'the input is not changed');
  });

  test(H, 'a haul is the same for the same net, tide and place, and another tide or place brings another', async () => {
    const [NR, K] = await recipes();
    const a = JSON.stringify(haulOf(input(), NR, K));
    eq(JSON.stringify(haulOf(input(), NR, K)), a, 'the same haul, however late it is lifted');
    let differ = 0;
    for (let t = 41; t < 61; t++) if (JSON.stringify(haulOf(input({ tideId: t }), NR, K)) !== a) differ++;
    eq(differ, 20, 'every other tide differs');
    assert(JSON.stringify(haulOf(input({ cell: [11, 12] }), NR, K)) !== a, 'another place differs');
  });

  test(H, 'most hauls hold a living thing; about one in four a keepsake, never an artifact', async () => {
    const [NR, K] = await recipes();
    let living = 0, none = 0, ks = 0;
    for (let t = 0; t < 4000; t++) {
      const h = haulOf(input({ tideId: t }), NR, K);
      living += h.living.length;
      if (!h.living.length) none++;
      if (h.keepsake) { ks++; assert(h.keepsake.n.family !== 'artifact' && h.keepsake.n.family !== 'bottle', 'no artifacts or bottles in the general net'); }
    }
    assert(none / 4000 > 0.06 && none / 4000 < 0.14, `about one haul in ten holds nothing living (${none})`);
    assert(living / 4000 > 1.1 && living / 4000 < 1.4, `a living thing or two (${(living / 4000).toFixed(2)} a haul)`);
    assert(ks / 4000 > 0.21 && ks / 4000 < 0.29, `about one in four with a keepsake (${ks})`);
  });

  test(H, "a net's keepsakes lean rarer than the beach's, and the tide's gates still hold", async () => {
    const [NR, K] = await recipes();
    let netRare = 0, netKs = 0, beachRare = 0;
    for (let t = 0; t < 12000; t++) {
      const k = haulOf(input({ tideId: t, spring: 1 }), NR, K).keepsake;
      if (k) { netKs++; if (k.n.rarity !== 'common' && k.n.rarity !== 'uncommon') netRare++; }
      const r = pickRarity((hash32(5, t) >>> 8) / 16777216, K.rarity, { spring: 1, season: 'summer' });
      if (r !== 'common' && r !== 'uncommon') beachRare++;
    }
    assert(netRare / netKs > 1.6 * (beachRare / 12000), `rare and up: net ${(netRare / netKs).toFixed(3)}, beach ${(beachRare / 12000).toFixed(3)}`);
    for (let t = 0; t < 3000; t++) {
      const k = haulOf(input({ tideId: t, spring: -1 }), NR, K).keepsake;
      assert(!k || k.n.rarity === 'common' || k.n.rarity === 'uncommon', 'nothing rare from a neap tide');
    }
  });

  test(H, 'depth and season steer the living kinds', async () => {
    const [NR, K] = await recipes();
    const share = (/** @type {Record<string, any>} */ o, /** @type {string[]} */ kinds) => {
      let n = 0, all = 0;
      for (let t = 0; t < 3000; t++) for (const c of haulOf(input({ tideId: t, ...o }), NR, K).living) { all++; if (kinds.includes(c.n.kind)) n++; }
      return n / Math.max(1, all);
    };
    const edge = ['shrimp', 'shorecrab', 'goby'];
    assert(share({ depthM: 0.15 }, edge) > 2 * share({ depthM: 0.7 }, edge), 'shrimp, crabs and gobies in the shallows');
    eq(share({ season: 'winter' }, ['moonjelly']), 0, 'no moon jellies in winter');
    assert(share({ season: 'summer' }, ['moonjelly']) > 0.1, 'plenty in summer');
  });

  test(H, 'every living kind, smallest and largest tier, builds a sound mesh and a line', async () => {
    const [NR, K] = await recipes();
    for (const kind of Object.keys(NR.catches.kinds)) {
      for (const rarity of [K.rarity.order[0], K.rarity.order[K.rarity.order.length - 1]]) {
        const n = catchNumbers(hash32(3, kind.length, rarity.length), kind, rarity, NR);
        eq(JSON.stringify(catchNumbers(n.seed, kind, rarity, NR)), JSON.stringify(n), `${kind}: its seed makes it again`);
        const m = catchMesh(n, NR);
        assert(m.count > 200 && m.indices.length >= 3 * 200, `${kind} ${rarity}: a mesh (${m.count} vertices)`);
        for (let i = 0; i < m.vertices.length; i++) if (!Number.isFinite(m.vertices[i])) throw new Error(`${kind}: a number that is not finite`);
        for (const ix of m.indices) if (ix >= m.count) throw new Error(`${kind}: an index past the end`);
        assert(/About \d+ cm long\./.test(catchWords(n, NR)), `${kind}: its line says how long it is`);
      }
    }
    assert(distinctive(/** @type {any} */ ({ rarity: 'rare', morph: false })) && !distinctive(/** @type {any} */ ({ rarity: 'common', morph: false })), 'rare ones are distinctive');
  });

  test(H, 'a distinctive animal let go comes back now and then, the same one; a plain one never does', async () => {
    const [NR, K] = await recipes();
    // A rare wrasse and a plain common one, both let go before.
    let rare = null, plain = null;
    for (let s = 1; !rare || !plain; s++) {
      const r = catchNumbers(s, 'wrasse', 'rare', NR), c = catchNumbers(s + 5000, 'wrasse', 'common', NR);
      if (!rare && distinctive(r)) rare = { kind: 'wrasse', seed: r.seed, hour: 100, rarity: 'rare' };
      if (!plain && !distinctive(c)) plain = { kind: 'wrasse', seed: c.seed, hour: 90, rarity: 'common' };
    }
    const released = [plain, rare];
    eq(comeBack(released, NR, 0.7, 'summer').length, 1, 'only the distinctive one can come back');
    eq(comeBack([{ kind: 'moonjelly', seed: 3, hour: 1, rarity: 'veryRare' }], NR, 0.7, 'winter').length, 0, 'never out of its season');
    let again = 0, other = 0;
    for (let t = 0; t < 3000; t++) {
      for (const c of haulOf(input({ tideId: t, released }), NR, K).living) {
        if (c.again) { again++; eq(c.n.seed, rare.seed, 'the same animal'); eq(c.again.hour, 100, 'when it was let go'); eq(c.n.rarity, 'rare', 'as rare as it was'); }
        else if (c.n.seed === plain.seed) other++;
      }
    }
    assert(again > 100 && again < 900, `now and then (${again} in 3,000 hauls)`);
    eq(other, 0, 'the plain one never comes back');
    eq(JSON.stringify(haulOf(input({ released }), NR, K)), JSON.stringify(haulOf(input({ released }), NR, K)), 'still pure');
    const n = noteReleased(emptyNets(), /** @type {any} */ (rare), true);
    eq(cleanNets(n).released[0].rarity, 'rare', 'its rarity is kept in the save');
  });

  test(H, 'the same hauls on the page and in the determinism job', async () => {
    const [NR, K] = await recipes();
    const a = haulsJob({ seed: 7, tides: 40, NR, K }), b = haulsJob({ seed: 7, tides: 40, NR: structuredClone(NR), K: structuredClone(K) });
    eq(a.hash, b.hash, 'one hash for the same seed');
    assert(haulsJob({ seed: 8, tides: 40, NR, K }).hash !== a.hash, 'another seed, other hauls');
  });

  test(H, 'every living kind has a journal page, a place on the naturalist line and on the Web, and a sketch', async () => {
    const [NR] = await recipes();
    const [words, web] = await Promise.all([fetch('../recipes/world/journal.json').then((r) => r.json()), fetch('../recipes/world/journal-web.json').then((r) => r.json())]);
    registerCatchSketches(NR, () => [{ kind: 'goby', seed: 1234, hour: 3 }]);
    for (const [kind, k] of Object.entries(NR.catches.kinds)) {
      const page = /** @type {any} */ (k).journal;
      eq(words.species[page]?.kind, 'find', `${kind}: its page is a find`);
      assert(words.findOrder.includes(page), `${kind}: on the naturalist's line`);
      assert(web.nodes[page] && web.links.some((/** @type {any} */ l) => l.b === page), `${kind}: on the Web, with a tie`);
      assert(hasSketch(page) && drawSketch(page, { stage: 1, labels: {} }).includes('<svg'), `${kind}: a sketch`);
    }
  });

  test(H, 'a first release of a kind is a find, once; a second writes nothing', async () => {
    const words = await fetch('../recipes/world/journal.json').then((r) => r.json());
    const ctx = { state: null, hour: 30, words };
    let j = { species: {}, flags: [], notes: [] };
    const before = findsFound(j, words).length;
    const r1 = foundFind(/** @type {any} */ (j), 'wrasse', ctx);
    eq(r1.notes.length, 1, 'one note the first time');
    j = /** @type {any} */ (r1.journal);
    eq(findsFound(j, words).length, before + 1, 'one more mark on the naturalist line');
    eq(foundFind(/** @type {any} */ (j), 'wrasse', ctx).notes.length, 0, 'nothing the second time');
  });
}
