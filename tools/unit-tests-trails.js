// @ts-check
// The trails (doc 13 "Trails") for tools/unit-tests.html: firsts written once, the beachcomber's
// stops by need, the trail lines as the journal draws them, the shaper's places from what the game
// computes (only what the player made), the Trails page, and save format 8.

import { addFirst, keptFirsts, seenMark, counts, reached, trailLine, firstsOf, sampleTrails } from '../src/world/trails.js';
import { due, grant } from '../src/world/expansion.js';
import { placesNow, reedMargin } from '../src/world/shaper.js';
import { trailsView } from '../src/ui/journal-trails.js';
import { trails8 } from '../src/save/migrate-trails.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { snapshot, restore } from '../src/save/sections.js';
import { WATER_CLASS } from '../src/world/water/summary.js';
import { STAGE } from '../src/world/growth/coarse.js';
import { HABITAT_ORIGIN, buildHabitat } from '../src/world/growth/habitat.js';
import { waterCellOf } from '../src/world/water/grid.js';
import { buildSummary } from '../src/world/water/summary.js';
import { buildIslandModel } from '../src/world/island-model.js';
import { landmarks } from '../src/world/terrain/landform.js';
import { quantize, WORLD_CELLS } from '../src/world/terrain/grid.js';
import { subSeed } from '../src/core/rng.js';

const G = 'trails';
const load = (/** @type {string} */ p) => fetch(`../recipes/world/${p}.json`).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addTrailsTests(test, assert, eq) {
  test(G, 'a first is written once, with its hour; a kept keepsake brings its family, rarity and mark', () => {
    let e = addFirst({}, { trail: 'beach', kind: 'family', id: 'shell', hour: 5 });
    eq(addFirst(e, { trail: 'beach', kind: 'family', id: 'shell', hour: 9 }), e, 'the same object the second time');
    eq(e.firsts[0].hour, 5, 'its hour is kept');
    const f = keptFirsts({ family: 'stone', rarity: 'rare', mark: 'holed' }, 40);
    eq(f.map((x) => `${x.kind}:${x.id}`).join(), 'family:stone,rarity:rare,mark:stone:holed', 'family, rarity and mark');
    eq(keptFirsts({ family: 'feather', rarity: 'common', mark: null }, 1).length, 1, 'a common one brings only its family');
    eq(seenMark({ family: 'shell', mark: null }, 3), null, 'no mark, nothing seen');
  });

  test(G, "the beachcomber's stops: the net at four families, the case at the first rare, the second shelf at three marks", async () => {
    const B = await load('beachcomber');
    const ask = (/** @type {any} */ earned) => due({ found: 0, flags: [], earned, rewards: [], gifts: {}, words: {}, giftWords: {}, stops: B.stops });
    let e = {};
    for (const fam of ['shell', 'stone', 'feather']) e = addFirst(e, { trail: 'beach', kind: 'family', id: fam, hour: 1 });
    eq(ask(e).length, 0, 'nothing given at three families (the shelf has nothing to give)');
    e = addFirst(e, { trail: 'beach', kind: 'family', id: 'urchin', hour: 2 });
    eq(ask(e).map((g) => g.id).join(), 'net', 'the net at four');
    e = grant(e, ask(e)[0]);
    eq(ask(e).length, 0, 'once only');
    const c = counts(firstsOf(e, 'beach'));
    assert(reached({ families: 4 }, c) && !reached({ rarity: 'rare' }, c), 'the rare stop waits');
    eq(ask({ kept: ['a', 'b', 'c', 'd'] }).map((g) => g.id).join(), 'net', 'families kept before firsts (format 7) count too');
  });

  test(G, 'a trail line: firsts in order, each stop after the first that reached it, then only the next stop, in pencil', async () => {
    const B = await load('beachcomber');
    const e = sampleTrails({});
    const line = trailLine(firstsOf(e, 'beach'), B.stops, ['net'], e.kept);
    const kinds = line.map((x) => (x.type === 'first' ? x.first.id : x.type === 'station' ? `[${x.stop.id}${x.inked ? '' : '?'}]` : `next:${x.stop.id}`));
    eq(kinds.join(' '), 'shell [shelf] stone stone:holed uncommon feather urchin [net] bivalve rare [case?] next:lightnet',
      'the shelf inks at the first keep, the net after the fourth family, the case in pencil after the first rare, then the light net ahead');
    const S = await load('shaper');
    const sl = trailLine(firstsOf(e, 'shape'), S.stops, []);
    eq(sl.map((x) => x.type === 'first' ? x.first.id : x.type === 'station' ? `[${x.stop.id}${x.inked ? '' : '?'}]` : `next:${x.stop.id}`).join(' '),
      'deepPool [stones] cove [paths?] next:lantern', 'each place, its reward (inked once built: stepping stones are), then the next place ahead');
  });

  test(G, "the shaper's places come only from what the player made", async () => {
    const S = await load('shaper');
    const C = S.check;
    const n = 8, N = n * n;
    // A summary of 4 x 4 half-metre cells at the habitat's corner, and a habitat of 8 x 8 squares.
    const rect = { x: waterCellOf(HABITAT_ORIGIN + 0.1), y: waterCellOf(HABITAT_ORIGIN + 0.1), w: 4, h: 4 };
    const summary = { rect, targetMm: new Uint16Array(16), cls: new Uint8Array(16).fill(WATER_CLASS.running) };
    const hab = { n, open: new Uint8Array(N).fill(1), sea: new Uint8Array(N), depthCm: new Uint8Array(N), still: new Uint8Array(N), shapedCm: new Uint8Array(N) };
    assert(!placesNow({ summary, hab }, { ...C, streamCells: 8 }).has('stream'), "the island's own brook does not count");
    hab.shapedCm.fill(40);
    assert(placesNow({ summary, hab }, { ...C, streamCells: 8 }).has('stream'), 'a stream on shaped ground does');
    summary.targetMm[3] = 1050;
    assert(placesNow({ summary, hab }, C).has('deepPool'), 'a pool a metre deep, dug by the player');
    assert(!placesNow({ summary }, C).has('deepPool'), 'not without knowing the ground was shaped');
    const cove = new Uint8Array(16).fill(C.coveScore);
    assert(placesNow({ summary, hab, cove }, C).has('cove'), 'a sheltered cove you carved');
    assert(placesNow({ falls: [{ heightM: C.fallM + 0.1 }] }, C).has('fall') && !placesNow({ falls: [{ heightM: 0.1 }] }, C).has('fall'), 'water falling from a terrace, not a ripple');
    assert(placesNow({ pools: [{ fit: true }] }, C).has('fishFreePond') && !placesNow({ pools: [{ fit: false }] }, C).has('fishFreePond'), "the dragonflies' own pond test");
    const flowering = ['a', 'b', 'c', 'd', 'e'].map((sp) => ({ sp, x: 0, z: 0, stage: STAGE.flowering }));
    assert(placesNow({ plants: flowering }, C).has('flowers') && !placesNow({ plants: flowering.slice(1) }, C).has('flowers'), 'five kinds in flower');
  });

  test(G, "a new starter island has no deep pool of the player's; deepening its pond 30 cm makes one", async () => {
    const C = (await load('shaper')).check;
    const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
    const [terrain, water, growth, land] = await Promise.all([get('world/terrain'), get('world/water'), get('world/growth'), get('land/starter-island')]);
    const seed = 1;
    const m = buildIslandModel({ seed, terrain, land, water, growth });
    let deepest = 0;
    for (const v of m.summary.targetMm) deepest = Math.max(deepest, v);
    assert(deepest >= C.deepPoolMm, `the starter pond is a metre deep as it begins (${deepest} mm), which is the case this guards`);
    assert(!placesNow({ summary: m.summary, hab: m.habitat }, C).has('deepPool'), 'a new island: the starter pond does not count');
    // Deepen the pond's bed by 30 cm, as the player would with Sculpt, and look again.
    const s = m.summary, T = WORLD_CELLS, heightQ = m.heightQ.slice(), drop = quantize(0.3) - quantize(0);
    for (let k = 0; k < s.targetMm.length; k++) {
      if (s.targetMm[k] < 300 || s.cls[k] !== WATER_CLASS.still) continue;
      const i = s.rect.x + (k % s.rect.w), j = s.rect.y + Math.floor(k / s.rect.w);
      for (const t of [2 * j * T + 2 * i, 2 * j * T + 2 * i + 1, (2 * j + 1) * T + 2 * i, (2 * j + 1) * T + 2 * i + 1]) heightQ[t] -= drop;
    }
    const springs = landmarks(land, subSeed(seed, 'terrain')).springs.map((p) => ({ cellX: waterCellOf(p.x), cellY: waterCellOf(p.z), rateLps: p.rateLps }));
    const dug = buildSummary({ heightQ, rect: s.rect, springs, params: { ...water.summary, manningN: water.sim.manningN }, tide: water.tide });
    const hab = buildHabitat({ eco: dug.eco, material: m.material, materialCells: T, params: growth.habitat, heightQ, baseQ: m.heightQ });
    assert(placesNow({ summary: dug, hab }, C).has('deepPool'), 'the deepened pond counts');
  });

  test(G, 'a reed margin: reeds, rushes or iris along most of a pond edge', async () => {
    const C = (await load('shaper')).check;
    const n = 10, N = n * n;
    const hab = { n, open: new Uint8Array(N).fill(1), sea: new Uint8Array(N), depthCm: new Uint8Array(N), still: new Uint8Array(N) };
    for (let j = 3; j <= 5; j++) for (let i = 3; i <= 5; i++) { hab.depthCm[j * n + i] = 40; hab.still[j * n + i] = 1; }
    assert(!reedMargin(hab, [], null, { ...C, reedPondM2: 6 }), 'a bare pond');
    const ring = [];
    for (const [i, j] of [[2, 2], [4, 2], [6, 2], [2, 4], [6, 4], [2, 6], [4, 6], [6, 6]]) ring.push({ sp: 'reeds', x: HABITAT_ORIGIN + i + 0.5, z: HABITAT_ORIGIN + j + 0.5 });
    assert(reedMargin(hab, ring, null, { ...C, reedPondM2: 6 }), 'reeds all round');
    assert(!reedMargin(hab, ring.slice(0, 2), null, { ...C, reedPondM2: 6 }), 'a few reeds on one side are not a margin');
  });

  test(G, 'the Trails page: three side by side when wide, three tabs otherwise', async () => {
    const [R, B, S, words] = await Promise.all([load('naturalist'), load('beachcomber'), load('shaper'), load('journal')]);
    const e = sampleTrails({});
    const live = { journal: () => ({ species: {} }), describe: () => ({ icon: 'find', name: 'x' }),
      progress: { line: () => [], beachLine: () => trailLine(firstsOf(e, 'beach'), B.stops, ['net'], e.kept), shapeLine: () => trailLine(firstsOf(e, 'shape'), S.stops, []) } };
    const wide = trailsView({ live, words, R, B, S, which: 'beach', wide: true });
    eq((wide.match(/ebb-trails__col/g) ?? []).length, 3, 'three columns');
    assert(wide.includes('5 of 13 families kept') && wide.includes('2 of 7 kinds of place'), 'kinds counted, never totals');
    assert(wide.includes('You can weave a net') && wide.includes('A glass case'), 'the net inked, the case in pencil');
    const narrow = trailsView({ live, words, R, B, S, which: 'shape', wide: false });
    eq((narrow.match(/ebb-trails__col/g) ?? []).length, 1, 'one trail at a time');
    assert(narrow.includes('aria-pressed="true">Shaper'), 'its tab pressed');
  });

  test(G, "save format 8: the trails' firsts come back, and an older island gets them from its shelf", () => {
    eq(FORMAT, 8, 'this build writes format 8');
    const e = sampleTrails({});
    const { sections } = snapshot(/** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
      unlocks: e, view: null, looks: {}, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0 }));
    eq(JSON.stringify(restore(Object.fromEntries(sections)).unlocks.firsts), JSON.stringify(e.firsts), 'the firsts come back exactly');
    const old = { meta: {}, unlocks: { kept: ['shell', 'driftwood'], nets: { general: true } },
      keepsakes: { version: 1, nextId: 3, shelf: [{ id: 2, n: { family: 'stone', rarity: 'rare', mark: 'holed' }, hour: 80 }, { id: 1, n: { family: 'shell', rarity: 'uncommon' }, hour: 30 }] } };
    const up = migrate(structuredClone(old), 7);
    eq(up.unlocks.firsts.map((/** @type {any} */ f) => `${f.kind}:${f.id}@${f.hour}`).join(),
      'family:driftwood@-1,family:shell@30,rarity:uncommon@30,family:stone@80,rarity:rare@80,mark:stone:holed@80',
      'kept and let go first (undated), then the shelf by when each was found');
    assert(up.unlocks.nets.general, 'a net already earned stays earned');
    trails8(old);
    assert(!(/** @type {any} */ (old)).unlocks.firsts, 'the input is not changed');
  });
}
