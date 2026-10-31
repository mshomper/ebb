// @ts-check
// Fishing and the angler's chart (docs/future/17) for tools/unit-tests.html: the worm split (the
// small red worm and the big dark worm in their own pouches, older saves unchanged); the fish
// generator, catch gen 2 (species and individuals rebuild from their seeds, the grown pattern, the
// mesh, the swim), with gen 1 catches still rebuilding.

import { cleanPack } from '../src/world/pack/model.js';
import { digFinds } from '../src/world/dig/finds.js';
import { ordinarySpecies, rareSpecies, namedSpecies, fishIndividual, morphOf } from '../src/world/nets/living/fish-species.js';
import { growField } from '../src/world/nets/living/fish-field.js';
import { fishSkin, swimBones } from '../src/world/nets/living/fish-mesh.js';
import { fishNumbers, fishMeshOf, fishName } from '../src/world/nets/living/fish2.js';
import { catchMesh, catchNumbers, catchName, catchWords, catchAlpha } from '../src/world/nets/living/index.js';

const G = 'fishing';
const GEN = 'fishing: generator';
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
}
