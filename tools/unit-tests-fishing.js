// @ts-check
// Fishing and the angler's chart (docs/future/17) for tools/unit-tests.html: the worm split (the
// small red worm and the big dark worm in their own pouches, older saves unchanged); the fish
// generator, catch gen 2 (species and individuals rebuild from their seeds, the grown pattern, the
// mesh, the swim), with gen 1 catches still rebuilding; the line (its make, its gorse thorns, the
// belt), the five waters, the roster, the bite's odds (conditions raise them, never gate) and the
// fishing save section; the journal's Fish pages and group, and the nets' fish as glimpses; the
// angler's chart (everything placed with nothing overlapping on several island shapes, what inks
// as fish are sketched, its thread).

import { cleanPack } from '../src/world/pack/model.js';
import { digFinds } from '../src/world/dig/finds.js';
import { ordinarySpecies, rareSpecies, namedSpecies, fishIndividual, morphOf } from '../src/world/nets/living/fish-species.js';
import { growField } from '../src/world/nets/living/fish-field.js';
import { fishSkin, swimBones } from '../src/world/nets/living/fish-mesh.js';
import { fishNumbers, fishMeshOf, fishName } from '../src/world/nets/living/fish2.js';
import { catchMesh, catchNumbers, catchName, catchWords, catchAlpha } from '../src/world/nets/living/index.js';
import { classifyWater, sampleWater } from '../src/world/fishing/waters.js';
import { rosterOf, rareRoster, allFish } from '../src/world/fishing/roster.js';
import { conditionsNow, weightOf, biteOf, bitesJob } from '../src/world/fishing/bite.js';
import { cleanFishing, emptyFishing, sketch, glimpse, castOnce, finer, sketchedOrInked } from '../src/world/fishing/model.js';
import { cleanCook, layout } from '../src/world/camp/making.js';
import { addFishPages } from '../src/world/fishing/pages.js';
import { speciesOf } from '../src/world/nets/living/fish2.js';
import { livingList, DEFAULT_CHOICE } from '../src/world/journal/list.js';
import { haulOf, comeBack } from '../src/world/nets/haul.js';
import { findsFound } from '../src/world/expansion.js';
import { chartLayout, chartInk, chartFlags } from '../src/world/fishing/chart.js';

const G = 'fishing';
const GEN = 'fishing: generator';
const LINE = 'fishing: the line';
const PAGES = 'fishing: pages and nets';
const CHART = 'fishing: the chart';
/** A quiet noon in summer at mid tide, no weather. */
const NOON = { hourOfDay: 12, season: 'summer', rain: 0, mist: 0, cloud: 0, wind: 0.1, yRain: 0, yWind: 0, tideLevel: 0, tideAmp: 0.6, sign: null };
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addFishingTests(test, assert, eq) {
  test(G, 'the two worms keep apart: red worms from the topsoil, big dark worms from the subsoil, each its own pouch', async () => {
    const [Pk, D] = await Promise.all([load('world/pack'), load('world/dig')]);
    const kinds = Pk.kinds.map((/** @type {any} */ k) => k.id);
    assert(kinds.includes('worms') && kinds.includes('bigworms'), 'both are pouch kinds');
    const big = Pk.kinds.find((/** @type {any} */ k) => k.id === 'bigworms');
    eq(big.group, 'living', 'a living thing');
    eq(big.camp, 'none', 'set down, it digs itself in like the red worms');
    assert(D.words.wormsIn && D.words.bigWormsIn, 'the dig card says which pouch');
    // Dig the same cell in spring at both layers until each gives a worm: the layer says which.
    /** @type {Record<string, string>} */ const got = {};
    for (let day = 0; day < 40 && Object.keys(got).length < 2; day++) {
      for (const [layer, depth] of /** @type {[string, number][]} */ ([['topsoil', 1], ['subsoil', 2]])) {
        const f = digFinds({ seed: 7, cell: 11, day, layer, depth, season: 0, moisture: 0.3, rainBefore: false, frost: false, thin: 1, budgetLeft: 0 }, D, null);
        if (f.worm) got[layer] = f.worm;
      }
    }
    eq(got.topsoil, 'small', 'the topsoil gives the small red worm');
    eq(got.subsoil, 'big', 'the subsoil gives the big dark worm');
  });

  test(G, 'an older save keeps its worms as red worms, and a pack with big dark worms reads back', async () => {
    const Pk = await load('world/pack');
    const kinds = Pk.kinds.map((/** @type {any} */ k) => k.id);
    const old = cleanPack({ version: 1, pouches: [['worms', 2]], heaps: [] }, kinds, Pk);
    eq(old.pouches.filter((p) => p[0] === 'worms').length, 1, 'the worms pouch is still there, as red worms');
    const now = cleanPack({ version: 1, pouches: [['worms', 2], ['bigworms', 1]], heaps: [] }, kinds, Pk);
    assert(now.pouches.some((p) => p[0] === 'bigworms'), 'big dark worms keep their pouch');
  });

  test(GEN, 'a species rebuilds the same from its seed and water; ordinary ones carry a bait, a rarity and at most one condition', async () => {
    const FR = await load('world/fishing'), Gn = FR.gen;
    const a = ordinarySpecies(4242, 'reef', Gn), b = ordinarySpecies(4242, 'reef', Gn);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same species twice');
    assert(JSON.stringify(ordinarySpecies(4243, 'reef', Gn)) !== JSON.stringify(a), 'another seed, another species');
    let withWhen = 0;
    for (let s = 0; s < 400; s++) {
      for (const w of FR.waters.order) {
        const sp = ordinarySpecies(s * 7 + 1, w, Gn);
        assert(['small', 'big', 'either'].includes(sp.bait), 'a bait');
        assert(['common', 'uncommon', 'rare', 'veryRare'].includes(sp.rarity), 'a rarity');
        assert(sp.when.length <= 1, 'at most one condition');
        assert(sp.when.every((c) => Gn.commonWhen.includes(c)), 'from the common conditions');
        if (sp.when.length) withWhen++;
      }
    }
    const share = withWhen / 2000;
    assert(share > 0.33 && share < 0.47, `about 4 in 10 have a condition (${share.toFixed(2)})`);
  });

  test(GEN, 'the twelve rare species: the form of their type, their own name and conditions, three of each type, the same on every island', async () => {
    const FR = await load('world/fishing'), Gn = FR.gen;
    eq(FR.rare.length, 12, 'twelve');
    /** @type {Record<string, number>} */ const types = {};
    for (const r of FR.rare) {
      const sp = rareSpecies(r, Gn);
      eq(sp.special, r.type, `${r.name} has the form of its type`);
      eq(sp.name, r.name, 'its own name');
      eq(sp.rarity, 'veryRare', 'very rare');
      eq(sp.water, Gn.rareTypes[r.type].water, 'in the water of its type');
      eq(sp.when.join(), r.when.join(), 'its conditions');
      eq(JSON.stringify(rareSpecies(r, Gn)), JSON.stringify(sp), 'the same every time');
      types[r.type] = (types[r.type] ?? 0) + 1;
    }
    eq(Object.values(types).join(), '3,3,3,3', 'three of each type');
    eq(new Set(FR.rare.map((/** @type {any} */ r) => r.id)).size, 12, 'unique ids');
    eq(new Set(FR.rare.map((/** @type {any} */ r) => r.order)).size, 12, 'one riddle order each');
    for (const n of FR.named) eq(namedSpecies(n, Gn).name, n.name, `${n.name} keeps its name`);
  });

  test(GEN, 'an individual: nudged from its species, one phase, its size in range, and morphs far rarer than in the lab', async () => {
    const FR = await load('world/fishing'), Gn = FR.gen;
    const sp = ordinarySpecies(99, 'open', Gn);
    const i1 = fishIndividual(sp, 5, Gn), i2 = fishIndividual(sp, 5, Gn), i3 = fishIndividual(sp, 6, Gn);
    eq(JSON.stringify(i1), JSON.stringify(i2), 'the same individual twice');
    assert(JSON.stringify(i1) !== JSON.stringify(i3), 'another seed, another individual');
    assert(sp.phases.some((/** @type {any} */ p) => p.name === i1.phase), 'one of its phases');
    let morphs = 0;
    for (let s = 0; s < 20000; s++) if (morphOf(s, Gn)) morphs++;
    const m = morphs / 20000;
    assert(m > 0.012 && m < 0.035, `about 1 in 40 is a morph, not 1 in 7 as in the lab (${m.toFixed(3)})`);
    for (let s = 0; s < 50; s++) {
      const ind = fishIndividual(sp, s, Gn);
      const top = sp.size[1] * (ind.morph === 'giant' ? Gn.morph.giantSize : 1);
      assert(ind.sizeCm >= sp.size[0] - 1e-9 && ind.sizeCm <= top + 1e-9, 'its length in the range of its species');
    }
  });

  test(GEN, 'the grown pattern grows the same twice, from 0 to 1 for a grown family, on the grid of the fish itself', async () => {
    const FR = await load('world/fishing'), Gn = FR.gen;
    /** @type {any} */ let sp = null;
    for (let s = 1; s < 300 && !sp; s++) { const x = ordinarySpecies(s, 'reef', Gn); if (Gn.patterns.rd[x.pattern]) sp = x; }
    assert(sp, 'a species with a grown pattern');
    const ind = fishIndividual(sp, 11, Gn);
    const t0 = performance.now();
    const f1 = growField(sp, 11, ind.g, Gn), f2 = growField(sp, 11, ind.g, Gn);
    const ms = performance.now() - t0;
    eq(f1.Nu, Gn.patterns.rdGrid, 'its grid along');
    eq(f1.field.length, f1.Nu * f1.Nv, 'one value a cell');
    assert(f1.field.every((v, i) => v === f2.field[i]), 'grown the same twice');
    assert(f1.field.every((v) => v >= 0 && v <= 1), 'grown values 0..1');
    return `two grown fields in ${ms.toFixed(0)} ms`;
  });

  test(GEN, 'a gen 2 catch: its mesh is its length, nose forward, finite, 9 floats a vertex, and rebuilds the same; gen 1 still rebuilds', async () => {
    const [FR, NR] = await Promise.all([load('world/fishing'), load('world/nets')]);
    const refs = [{ water: 'kelp', seed: 77 }, { water: 'deep', rare: 'lantern-angler' }, { water: 'reef', rare: 'firework-lionfish' }, { water: 'sand', named: 'sandeel' }, { water: 'open', rare: 'glass-sprat' }];
    for (const ref of refs) {
      const n = fishNumbers('x', ref, 1234, FR);
      eq(n.gen, 2, 'gen 2');
      const m = fishMeshOf(n, FR), m2 = catchMesh(n, NR, FR);
      eq(m.vertices.length, m.count * 9, '9 floats a vertex');
      assert(m.vertices.every(Number.isFinite), 'finite');
      assert(m.indices.every((i) => i < m.count), 'indices in range');
      assert(m.vertices.every((v, i) => v === m2.vertices[i]), 'rebuilds the same');
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.count; i++) { lo = Math.min(lo, m.vertices[i * 9 + 2]); hi = Math.max(hi, m.vertices[i * 9 + 2]); }
      assert(Math.abs(hi - lo - n.lengthM) < n.lengthM * 0.25, `${fishName(n, FR)} is about its length (${(hi - lo).toFixed(3)} for ${n.lengthM})`);
      assert(Math.abs(hi + lo) < n.lengthM * 0.25, 'its middle at the origin');
      assert(catchName(n, NR, FR) === fishName(n, FR) && catchWords(n, NR, FR).length > 0, 'its name and line');
    }
    eq(catchAlpha(fishNumbers('x', { water: 'open', rare: 'glass-sprat' }, 1, FR), FR) < 1, true, 'a ghost fish is drawn see-through');
    const g1 = catchNumbers(55, 'goby', 'common', NR);
    eq(g1.gen, 1, 'a net catch is still gen 1');
    assert(catchMesh(g1, NR).count > 0, 'and its body still bakes');
  });

  test(GEN, 'the swim: four bones from head to tail, skin weights that sum to one, and a still fish is the mesh as baked', async () => {
    const FR = await load('world/fishing');
    const n = fishNumbers('x', { water: 'reef', seed: 3 }, 9, FR), m = fishMeshOf(n, FR);
    const sk = fishSkin(m, n.lengthM);
    for (let v = 0; v < m.count; v++) eq(sk.weights[v * 4] + sk.weights[v * 4 + 1] + sk.weights[v * 4 + 2] + sk.weights[v * 4 + 3], 255, 'weights sum to 255');
    const still = swimBones(0, n.lengthM, 0);
    for (let k = 0; k < 4; k++) for (let i = 0; i < 16; i++) assert(Math.abs(still[k * 16 + i] - (i % 5 === 0 ? 1 : 0)) < 1e-9, 'no swim: identity');
    const moving = swimBones(0.4, n.lengthM, 1.5);
    assert(Math.abs(moving[48] - 1) > 1e-3, 'the tail turns');
  });

  test(LINE, 'the line: a withy, rush cord and gorse thorns at the workbench, a tool on the belt; its parts are its own, and gorse gives thorns all year', async () => {
    const [C, Ga, Pk, K] = await Promise.all([load('world/cook'), load('world/gather'), load('world/pack'), load('world/kit')]);
    const M = C.makes.line;
    eq(M.at, 'workbench', 'at the workbench');
    eq(M.parts.join(), 'willow.withies,rush-cord,gorse.thorns', 'three parts, one for each part spot');
    eq(M.out, 'tool', 'a tool');
    const lay = layout(C, 'workbench', ['willow.withies', 'rush-cord', 'gorse.thorns'], cleanCook(null));
    assert(lay.make === 'line' && lay.complete, 'laid out, the bench makes the line');
    eq(layout(C, 'workbench', ['willow.withies', 'rush-cord', 'rush-cord'], cleanCook(null)).make, 'basket', 'the basket keeps its own parts');
    eq(Ga.plants.parts['gorse.thorns'].window.join(), '0,4', 'thorns all year');
    assert(Pk.kinds.some((/** @type {any} */ k) => k.id === 'gorse.thorns'), 'thorns are a pouch kind');
    assert(K.belt.some((/** @type {any} */ b) => b.id === 'line'), 'it hangs on the belt');
  });

  test(LINE, 'the five waters: deep past the drop-off, open past the tide band, kelp over the kelp band, the reef off rock, the flats otherwise', async () => {
    const W = (await load('world/fishing')).waters;
    eq(classifyWater({ depthM: 3, inBand: false, kelpShare: 0, rockShare: 0 }, W), 'deep', 'past the drop-off');
    eq(classifyWater({ depthM: 1.5, inBand: false, kelpShare: 0.5, rockShare: 1 }, W), 'open', 'past the tide band');
    eq(classifyWater({ depthM: 0.6, inBand: true, kelpShare: 0.4, rockShare: 0.9 }, W), 'kelp', 'over the kelp');
    eq(classifyWater({ depthM: 0.6, inBand: true, kelpShare: 0.05, rockShare: 0.9 }, W), 'reef', 'off rock with no kelp');
    eq(classifyWater({ depthM: 0.6, inBand: true, kelpShare: 0, rockShare: 0.1 }, W), 'sand', 'off sand');
    // A raised rock headland: the same shallows read as the reef once the shore beside them is rock.
    const read = (/** @type {boolean} */ rock) => ({ ground: () => -0.6, inBand: () => true, zoneAt: () => null, rockAt: () => rock });
    eq(classifyWater(sampleWater(0, 0, read(false), W), W), 'sand', 'a sandy cove brings the flats');
    eq(classifyWater(sampleWater(0, 0, read(true), W), W), 'reef', 'a rock headland brings the reef');
  });

  test(LINE, 'the roster: 22 ordinary species by water with unique names, the five net fish among them, the same twelve rare ones; another island, other fish', async () => {
    const FR = await load('world/fishing');
    const a = rosterOf(2026, FR), b = rosterOf(2026, FR), c = rosterOf(77, FR);
    eq(a.length, 22, '22 ordinary species');
    eq(JSON.stringify(a), JSON.stringify(b), 'the same island, the same fish');
    for (const [w, n] of Object.entries(FR.roster.counts)) eq(a.filter((f) => f.water === w).length, n, `${n} in ${w}`);
    eq(new Set(a.map((f) => f.name)).size, 22, 'every name its own');
    eq(a.filter((f) => f.kind === 'named').map((f) => f.id).sort().join(), 'goby,pipefish,plaice,sandeel,wrasse', 'the five net fish are members');
    eq(a.filter((f) => f.kind === 'named').map((f) => f.page).sort().join(), 'goby,pipefish,plaice,sandeel,wrasse', 'on their own journal pages');
    assert(a.filter((f) => f.kind === 'ordinary').some((f, i) => f.name !== c.filter((g) => g.kind === 'ordinary')[i]?.name), 'a sister island rolls its own');
    const r = rareRoster(FR);
    eq(r.length, 12, 'twelve rare species');
    eq(r.map((f) => f.id).join(), FR.rare.slice().sort((/** @type {any} */ x, /** @type {any} */ y) => x.order - y.order).map((/** @type {any} */ x) => x.id).join(), 'in riddle order');
    const share = a.filter((f) => f.kind === 'ordinary' && f.when.length).length / a.filter((f) => f.kind === 'ordinary').length;
    assert(share > 0.1 && share < 0.75, `some ordinary species have a condition (${share.toFixed(2)})`);
  });

  test(LINE, 'the odds: rarity sets the weight, each condition met multiplies it, the right worm doubles it, and nothing is ever gated', async () => {
    const FR = await load('world/fishing'), O = FR.odds;
    const nightFish = { rarity: 'rare', bait: 'big', when: ['night'] };
    const noon = conditionsNow(NOON, FR.when), night = conditionsNow({ ...NOON, hourOfDay: 23 }, FR.when);
    assert(!noon.has('night') && night.has('night'), 'night is read from the hour');
    eq(weightOf(nightFish, noon, 'small', O), O.rarity.rare, 'at noon on the wrong worm: its base weight, never none');
    eq(weightOf(nightFish, night, 'small', O), O.rarity.rare * O.condition, 'at night: times the condition');
    eq(weightOf(nightFish, night, 'big', O), O.rarity.rare * O.condition * O.bait, 'and the right worm doubles it');
    const two = conditionsNow({ ...NOON, hourOfDay: 2, rain: 0.6, tideLevel: -0.4 }, FR.when);
    assert(two.has('night') && two.has('rain') && two.has('low') && two.has('summer'), 'rain, low tide and the season read too');
    assert(conditionsNow({ ...NOON, mist: 0.5 }, FR.when).has('mist'), 'mist (the weather has no fog)');
    assert(conditionsNow({ ...NOON, yRain: 0.8, yWind: 0.8 }, FR.when).has('storm'), 'after a storm: yesterday wet and windy');
    assert(!conditionsNow(NOON, FR.when).has('sparkle'), 'no sparkle until the signs in the water are built');
    assert(conditionsNow({ ...NOON, sign: 'sparkle' }, FR.when).has('sparkle'), 'the hook is there for them');
  });

  test(LINE, 'a bite: pure, one fish of the water cast into, its waits in range; every fish of a water can bite, rare ones rarely, and ?fishing=rare brings them on', async () => {
    const FR = await load('world/fishing'), fish = allFish(99, FR);
    // A cloudy spring noon at mid tide: none of the reef's rare fish has its conditions met.
    const p = { seed: 5, cast: 3, water: 'reef', now: { ...NOON, season: 'spring', cloud: 0.7 }, bait: 'worms' };
    eq(JSON.stringify(biteOf(p, fish, FR)), JSON.stringify(biteOf(p, fish, FR)), 'the same cast, the same bite');
    /** @type {Record<string, number>} */ const got = {};
    let rare = 0;
    for (let c = 0; c < 6000; c++) {
      const b = /** @type {any} */ (biteOf({ ...p, cast: c }, fish, FR));
      const f = fish.find((x) => x.id === b.id);
      eq(f?.water, 'reef', 'a reef fish');
      assert(b.waitS >= FR.bite.waitS[0] && b.waitS <= FR.bite.waitS[1], 'its wait in range');
      got[b.id] = (got[b.id] ?? 0) + 1;
      if (f?.kind === 'rare') rare++;
    }
    eq(Object.keys(got).length, fish.filter((f) => f.water === 'reef').length, 'every reef species bites now and then');
    for (const f of fish.filter((x) => x.water === 'reef' && x.kind === 'rare')) assert((got[f.id] ?? 0) / 6000 < 0.02, `${f.name} rarely out of its conditions (${((got[f.id] ?? 0) / 60).toFixed(1)} in 100)`);
    assert(rare / 6000 < 0.1, `the six rare reef fish together under 1 in 10 (${(rare / 60).toFixed(1)} in 100)`);
    let boosted = 0;
    for (let c = 0; c < 400; c++) if (fish.find((x) => x.id === biteOf({ ...p, cast: c, rareBoost: FR.test.rareOdds }, fish, FR)?.id)?.kind === 'rare') boosted++;
    assert(boosted / 400 > 0.5, 'on ?fishing=rare they bite often');
    const job = bitesJob({ seed: 5, casts: 200, worldSeed: 99, FR, fish });
    eq(job.hash, bitesJob({ seed: 5, casts: 200, worldSeed: 99, FR, fish }).hash, 'a run of bites hashes the same twice');
  });

  test(LINE, 'the save: a sketch per species (a redraw replaces it), glimpses kept from the first, the cast count; an older save reads as nothing sketched', async () => {
    eq(JSON.stringify(cleanFishing(undefined)), JSON.stringify(emptyFishing()), 'no section: nothing sketched');
    eq(JSON.stringify(cleanFishing({ version: 2 })), JSON.stringify(emptyFishing()), 'an unknown version: nothing sketched');
    let s = sketch(emptyFishing(), 'reef-1', { seed: 9, hour: 40, cm: 20 });
    s = sketch(s, 'reef-1', { seed: 11, hour: 60, cm: 26, morph: 'golden' });
    eq(Object.keys(s.sketched).length, 1, 'one sketch per species');
    eq(s.sketched['reef-1'].seed, 11, 'a redraw replaces it');
    s = glimpse(glimpse(s, 'goby', 5), 'goby', 9);
    eq(s.glimpsed.goby, 5, 'a glimpse keeps its first hour');
    s = castOnce(castOnce(s));
    eq(s.casts, 2, 'casts counted, for the bite seeds only');
    eq(JSON.stringify(cleanFishing(JSON.parse(JSON.stringify(s)))), JSON.stringify(s), 'round trips');
    assert(finer({ seed: 1, hour: 1, cm: 20 }, { morphId: 'golden', lengthM: 0.2 }, 1.15), 'a morph is finer');
    assert(finer({ seed: 1, hour: 1, cm: 20 }, { morphId: null, lengthM: 0.24 }, 1.15), 'a much longer one is finer');
    assert(!finer({ seed: 1, hour: 1, cm: 20 }, { morphId: null, lengthM: 0.21 }, 1.15), 'a little longer is not');
    const FR = await load('world/fishing'), roster = rosterOf(3, FR);
    const set = sketchedOrInked(emptyFishing(), roster, (page) => page === 'sandeel');
    assert(set.has('sandeel') && set.size === 1, 'a net fish page inked from a net release counts as sketched');
  });

  test(PAGES, 'the Fish pages: one per species the island has, finds that list once sketched, a glimpse in pencil, the net fish on their own pages', async () => {
    const [FR, words, list] = await Promise.all([load('world/fishing'), load('world/journal'), load('world/journal-list')]);
    const fish = allFish(2026, FR);
    addFishPages(words, fish, FR, (f) => speciesOf(f.ref, FR).size);
    eq(words.fishOrder.length, 17 + 12, 'the 17 drawn species and the 12 rare ones have pages written');
    for (const id of words.fishOrder) {
      const r = words.species[id];
      eq(r.kind, 'find', `${id} is a find`);
      assert(r.name && r.icon === 'fish' && r.riddle && r.place && r.foundLine && r.notes.found && r.field.length && r.likes.length, `${id} has every line a page needs`);
    }
    for (const n of FR.named) assert(words.species[n.page]?.hints?.some((/** @type {any} */ h) => h.when === `glimpse:${n.id}`), `${n.name} keeps its page and takes the glimpse line`);
    const before = findsFound({ species: {}, flags: [] }, words).length;
    eq(before, 0, 'nothing found yet');
    /** @type {Record<string, boolean>} */ const known = { 'sandeel': true, [words.fishOrder[0]]: true };
    const groups = livingList(list, words, DEFAULT_CHOICE, (id) => ({ id, known: !!known[id], name: words.species[id].name, pencil: id === words.fishOrder[1] }), () => -1, {});
    const g = groups.find((x) => x.id === 'fish');
    assert(g, 'a Fish group under Living things');
    eq([...(g?.rows ?? [])].sort().join(), [words.fishOrder[0], words.fishOrder[1], 'sandeel'].sort().join(), 'sketched ones, and the glimpsed one in pencil; never the rest');
    const small = groups.find((x) => x.id === 'small');
    assert(!small || !small.rows.includes('sandeel'), 'the sand eel moved from Small lives to Fish');
    assert(!words.findOrder.some((/** @type {string} */ id) => words.fishOrder.includes(id)), 'the new pages are not naturalist finds');
    assert(words.findOrder.includes('sandeel'), 'the net fish pages still count on the naturalist\'s trail');
  });

  test(PAGES, 'in a net, the five fish are glimpses that never come back as the same animal; shrimp, crabs and jellies are as they were', async () => {
    const [NR, K] = await Promise.all([load('world/nets'), load('world/keepsakes')]);
    const fishKinds = Object.entries(NR.catches.kinds).filter(([, k]) => /** @type {any} */ (k).fish).map(([id]) => id).sort();
    eq(fishKinds.join(), 'goby,pipefish,plaice,sandeel,wrasse', 'the five net fish');
    let glimpses = 0, small = 0;
    for (let t = 0; t < 400; t++) {
      const h = haulOf({ seed: 9, net: { id: 1, kind: 'general' }, tideId: t, cell: [t % 9, 4], depthM: (t % 4) * 0.2, spring: 0, season: 'summer' }, NR, K);
      for (const c of h.living) {
        if (NR.catches.kinds[c.n.kind].fish) { assert(c.glimpse, `${c.n.kind} is a glimpse`); glimpses++; }
        else { assert(!c.glimpse, `${c.n.kind} is caught as before`); small++; }
      }
    }
    assert(glimpses > 0 && small > 0, `both come up (${glimpses} glimpses, ${small} small lives)`);
    const back = comeBack([{ kind: 'wrasse', seed: 1, hour: 3, rarity: 'veryRare' }, { kind: 'shrimp', seed: 2, hour: 4, rarity: 'veryRare' }], NR, 0.6, 'summer');
    assert(!back.some((r) => r.kind === 'wrasse'), 'a fish never comes back as the same animal');
  });

  test(CHART, 'the chart places every fish, riddle mark, water name, the compass and the title, nothing touching anything or crossing a line, on several island shapes', async () => {
    const FR = await load('world/fishing');
    const fish = rosterOf(2026, FR), rare = rareRoster(FR).map((f) => ({ id: f.id, water: f.water, mark: FR.rare.find((/** @type {any} */ r) => r.id === f.id).mark }));
    const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));
    /** @type {Record<string, (a: number) => number>} */
    const shapes = {
      round: () => 40,
      long: (a) => 40 / Math.sqrt((Math.cos(a) / 1.6) ** 2 + (Math.sin(a) / 0.6) ** 2),
      bay: (a) => 38 - 22 * Math.exp(-((wrap(a - 1.6) / 0.35) ** 2)) + 6 * Math.sin(3 * a),
      lumpy: (a) => 34 + 7 * Math.sin(2 * a + 1) + 4 * Math.sin(5 * a) + 2 * Math.sin(9 * a + 0.5),
    };
    let checked = 0;
    for (const [name, R] of Object.entries(shapes)) {
      for (const deep of [0.4, 2.3]) {
        const coast = Array.from({ length: 180 }, (_, i) => { const a = (i / 180) * Math.PI * 2, r = R(a); return { x: Math.cos(a) * r, z: Math.sin(a) * r, water: a < 2 ? 'reef' : a < 4 ? 'sand' : 'kelp' }; });
        const L = chartLayout({ coast, center: [0, 0], deepAngle: deep }, fish, rare, { waters: FR.words.waters, title: FR.chart.title, seed: 20261031 });
        const at = `${name}, deep at ${deep}`;
        eq(L.fishMarks.length, 22, `${at}: every fish placed`);
        eq(L.rares.length, 12, `${at}: every riddle mark placed`);
        eq(L.labels.length, 5, `${at}: every water named`);
        assert(L.compass && L.title, `${at}: the compass and the title`);
        const B = L.boxes;
        for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
          const a = B[i], b = B[j];
          assert(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `${at}: nothing touches anything else`);
        }
        for (const b of B) for (const Q of L.lines) for (const q of Q) assert(!(q[0] > b.x0 && q[0] < b.x1 && q[1] > b.y0 && q[1] < b.y1), `${at}: nothing crosses a line`);
        for (const b of B) assert(b.x0 >= 52 && b.y0 >= 52 && b.x1 <= 948 && b.y1 <= 648, `${at}: everything inside the frame`);
        checked++;
      }
    }
    return `${checked} charts laid out`;
  });

  test(CHART, 'the chart inks as fish are sketched: the coast of a water at its first, its name when finished, a riddle about every second sketch, the title with the last; its thread flags follow', async () => {
    const FR = await load('world/fishing');
    const fish = rosterOf(5, FR);
    const none = chartInk(fish, new Set(), 12);
    assert(!none.coast('reef') && !none.full && none.riddles === 0, 'nothing sketched: all pencil');
    eq(chartFlags(none, false).length, 0, 'no thread flags yet');
    const reef = fish.filter((f) => f.water === 'reef');
    const one = chartInk(fish, new Set([reef[0].id]), 12);
    assert(one.coast('reef') && !one.contour('reef') && !one.finished('reef'), 'one reef fish: its coast inks, not yet its depth line or name');
    const allReef = chartInk(fish, new Set(reef.map((f) => f.id)), 12);
    assert(allReef.finished('reef') && !allReef.finished('sand'), 'every reef fish: the reef is finished');
    eq(allReef.riddles, 2, 'five sketches: two riddles (one about every second sketch)');
    const ids = fish.map((f) => f.id);
    let last = 0;
    for (let k = 1; k <= ids.length; k++) {
      const ink = chartInk(fish, new Set(ids.slice(0, k)), 12);
      assert(ink.riddles >= last && ink.riddles - last <= 1, 'riddles come one at a time');
      last = ink.riddles;
    }
    eq(last, 12, 'all twelve with the last sketch');
    const full = chartInk(fish, new Set(ids), 12);
    assert(full.full && full.compass(3), 'the chart full: frame, title, the compass whole');
    const flags = chartFlags(full, true);
    for (const f of ['fishing:sketch', 'fishing:riddle:12', 'fishing:water:deep', 'fishing:rare', 'fishing:chart:full']) assert(flags.includes(f), `flag ${f}`);
    const T = await load('world/threads');
    const thread = T.threads.find((/** @type {any} */ t) => t.id === 'angler');
    assert(thread && thread.end.includes('chartFull'), 'the angler\'s chart has its thread, ending with the chart full');
    for (const l of thread.lines) assert(T.tests[l.test], `its line ${l.id} has a test`);
  });
}
