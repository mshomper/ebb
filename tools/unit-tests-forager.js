// @ts-check
// The forager's trail (doc 13 "Trails", P2k) for tools/unit-tests.html: a picked handful's firsts
// written once and never taken back, the stops given at their needs (and the pencil ones never),
// the trail's currency, the gathering knife's effect, the herbarium and almanac, the four-trail
// Trails page in each of its layouts, and no save format change.

import { pickedFirsts, noteFirsts, forageLineFirsts, knifed, sprigs, almanacArcs, sampleForager, hasForage } from '../src/world/forager.js';
import { addFirst, trailLine, firstsOf, sampleTrails } from '../src/world/trails.js';
import { due, grant } from '../src/world/expansion.js';
import { pickable } from '../src/world/gather/plants.js';
import { recoverFactor } from '../src/world/growth/plant.js';
import { trailsView } from '../src/ui/journal-trails.js';
import { herbariumView, windowWords } from '../src/ui/journal-herbarium.js';
import { FORMAT } from '../src/save/migrate.js';
import { snapshot, restore } from '../src/save/sections.js';

const G = 'forager';
const load = (/** @type {string} */ p) => fetch(`../recipes/world/${p}.json`).then((r) => r.json());
/** What the forager's stops give now. @param {any} F @param {Record<string, any>} earned */
const ask = (F, earned) => due({ found: 0, flags: [], earned, rewards: [], gifts: {}, words: {}, giftWords: {}, forage: F.stops });
/** Give everything due, as progress does. @param {any} F @param {Record<string, any>} e */
const giveAll = (F, e) => { for (const g of ask(F, e)) e = grant(e, g); return e; };
/** A trail line as short words. @param {import('../src/world/trails.js').TrailEntry[]} line */
const words = (line) => line.map((x) => (x.type === 'first' ? `${x.first.kind}:${x.first.id}` : x.type === 'station' ? `[${x.stop.id}${x.inked ? '' : '?'}]` : `next:${x.stop.id}`)).join(' ');

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addForagerTests(test, assert, eq) {
  test(G, 'a picked handful writes its plant, part and season once, with its hour, and never takes them back', () => {
    const fs = pickedFirsts('nettle', 'tops', 0, 50);
    eq(fs.map((f) => `${f.trail}:${f.kind}:${f.id}`).join(), 'forage:plant:nettle,forage:part:nettle.tops,forage:season:spring', 'plant, part and season');
    eq(pickedFirsts('willow', 'bark', 3.6, 1)[2].id, 'winter', 'the season index names its season');
    const e = noteFirsts({}, fs);
    eq(noteFirsts(e, pickedFirsts('nettle', 'tops', 0, 90)), e, 'the same handful again: the same object');
    const e2 = noteFirsts(e, pickedFirsts('nettle', 'tops', 2, 900));
    eq(firstsOf(e2, 'forage').filter((f) => f.kind === 'plant').length, 1, 'nettle once, though picked again in autumn');
    assert(firstsOf(e2, 'forage').some((f) => f.kind === 'season' && f.id === 'autumn'), 'autumn is a new first');
    eq(firstsOf(e2, 'forage')[0].hour, 50, 'the first hour is kept');
    assert(!forageLineFirsts(e2).some((f) => f.kind === 'part'), 'parts feed the almanac, not the line');
    // Nothing takes a first back: firsts are only ever added (addFirst), and the other trails keep theirs.
    const both = noteFirsts(sampleTrails({}), fs);
    eq(firstsOf(both, 'beach').length, firstsOf(sampleTrails({}), 'beach').length, "the beachcomber's firsts are untouched");
  });

  test(G, "the stops come at their needs: the herbarium at 1 plant, the knife at 4, the almanac at four seasons; each once", async () => {
    const F = await load('forager');
    let e = noteFirsts({}, pickedFirsts('reeds', 'down', 2, 1));
    eq(ask(F, e).map((g) => `${g.id}:${g.trail}`).join(), 'herbarium:forage', 'the herbarium at the first plant, opening the forager\'s trail');
    e = giveAll(F, e);
    assert(hasForage(e, 'herbarium') && e.forager.includes('herbarium'), 'given, for good');
    eq(ask(F, e).length, 0, 'once only');
    for (const [sp, part] of [['nettle', 'tops'], ['watermint', 'leaves']]) e = noteFirsts(e, pickedFirsts(sp, part, 2, 5));
    eq(ask(F, e).length, 0, 'three plants: no knife yet');
    e = noteFirsts(e, pickedFirsts('chamomile', 'flowers', 2, 6));
    eq(ask(F, e).map((g) => g.id).join(), 'knife', 'the knife at four plants');
    e = giveAll(F, e);
    e = noteFirsts(noteFirsts(noteFirsts(e, pickedFirsts('nettle', 'tops', 0, 7)), pickedFirsts('chamomile', 'flowers', 1, 8)), pickedFirsts('willow', 'bark', 3, 9));
    eq(ask(F, e).map((g) => g.id).join(), 'almanac', 'the almanac once something is gathered in all four seasons');
    e = giveAll(F, e);
    for (const sp of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) e = noteFirsts(e, pickedFirsts(sp, 'leaves', 1, 10));
    eq(ask(F, e).length, 0, 'the caddy, the stick and the frame are reached but not built: nothing given');
    const line = words(trailLine(forageLineFirsts(e), F.stops, e.forager ?? []));
    assert(line.includes('[caddy?]') && line.includes('[stick?]') && line.includes('[frame?]'), 'they sit in pencil where they fall');
    assert(!line.includes('[papers') && !line.includes('[scoop') && line.endsWith('next:papers'), 'the seed stops wait for seed saving, shown ahead');
    e = addFirst(e, { trail: 'forage', kind: 'seed', id: 'reeds', hour: 11 });
    e = addFirst(addFirst(e, { trail: 'forage', kind: 'seed', id: 'nettle', hour: 12 }), { trail: 'forage', kind: 'seed', id: 'thrift', hour: 13 });
    assert(words(trailLine(forageLineFirsts(e), F.stops, e.forager)).includes('[papers?]'), 'the seed hook: three seeds saved reach the seed papers (in pencil until P2g)');
  });

  test(G, "the trail's currency: ways to gather, keep and press, never shaping, plants or seed", async () => {
    const F = await load('forager');
    for (const s of F.stops) {
      if (!s.give) continue;
      eq(Object.keys(s.give).join(), 'forage', `${s.id} gives only the forager's own things`);
    }
    const e = giveAll(F, sampleForager({}));
    for (const k of ['cliffs', 'springs', 'stones', 'seeds', 'plants', 'allPlants']) assert(!(k in e), `nothing of ${k}`);
  });

  test(G, 'the gathering knife: ready again at 0.8 of its size, not 0.9, and drawn less bare; the recipe itself untouched', async () => {
    const [F, gather] = await Promise.all([load('forager'), load('gather')]);
    const k = knifed(gather, F.knife);
    eq(k.plants.parts['reeds.down'].readyShare, 0.8, 'reed down at 0.8');
    eq(k.plants.defaults.herb.readyShare, 0.8, 'herbs at 0.8');
    eq(gather.plants.defaults.herb.readyShare, 0.9, 'the gather recipe is not changed');
    eq(k.plants.bareLook, F.knife.bareLook, 'the picked look scaled');
    eq(knifed(gather, null), gather, 'no knife: the recipe itself');
    assert(k.plants.parts['reeds.down'].share === gather.plants.parts['reeds.down'].share, 'a handful takes as much as ever');
    const plant = { id: 1, sp: 'reeds', size: 0.85, best: 1 };
    const env = { flora: { growth: { stages: { matureSize: 0.5 } } }, pos: 2.5 };
    eq(pickable(plant, 'down', env, gather).why, 'rest', 'at 0.85 of its size it rests without the knife');
    assert(pickable(plant, 'down', env, k).ok, 'and is ready with it');
    const P = gather.plants;
    assert(recoverFactor(0.85, 1, 0.5, 0.9, P, 0, 0) < 1 && recoverFactor(0.85, 1, 0.5, 0.8, P, 0, 0) === 1, 'it stops resting sooner, so it is back sooner');
  });

  test(G, 'the herbarium: a sprig a plant, in order; the almanac only once given, and only the parts gathered', async () => {
    const [F, gather, journal] = await Promise.all([load('forager'), load('gather'), load('journal')]);
    let e = noteFirsts({}, pickedFirsts('watermint', 'leaves', 1, 30));
    e = giveAll(F, noteFirsts(e, pickedFirsts('nettle', 'tops', 1, 40)));
    eq(sprigs(e).map((s) => s.sp).join(), 'watermint,nettle', 'in the order first gathered');
    const o = { earned: e, F, words: journal, gather, partName: (/** @type {string} */ k) => k };
    let html = herbariumView(o);
    eq((html.match(/ebb-herb__sprig/g) ?? []).length, 2, 'one row a plant');
    assert(html.includes('Water mint') && html.includes('Nettle'), 'named as the journal names them');
    assert(!html.includes('ebb-herb__ring'), 'no almanac before it is given');
    e = giveAll(F, sampleForager(e));
    html = herbariumView({ ...o, earned: e });
    assert(html.includes('ebb-herb__ring'), 'the ring once given');
    assert(html.includes('nettle.tops') && !html.includes('meadowsweet.flowers') && !html.includes('gorse.flowers'), 'parts never gathered stay unseen');
    eq(almanacArcs(e, gather).find((a) => a.id === 'nettle.tops')?.windows.length, 2, 'nettle tops come twice a year');
    eq(windowWords([0.6, 2.4], F.almanac), 'spring to autumn', 'a window in words');
    eq(windowWords([0, 4], F.almanac), F.almanac.all, 'all year');
  });

  test(G, 'the Trails page: four side by side from 1400 px, two by two from 1100 px, four tabs below that', async () => {
    const [R, B, S, F, journal] = await Promise.all([load('naturalist'), load('beachcomber'), load('shaper'), load('forager'), load('journal')]);
    const e = giveAll(F, sampleForager(sampleTrails({})));
    const live = { journal: () => ({ species: {} }), describe: () => ({ icon: 'find', name: 'x' }),
      progress: { line: () => [], beachLine: () => trailLine(firstsOf(e, 'beach'), B.stops, ['net'], e.kept), shapeLine: () => trailLine(firstsOf(e, 'shape'), S.stops, []),
        forageLine: () => trailLine(forageLineFirsts(e), F.stops, e.forager) } };
    const base = { live, words: journal, R, B, S, F, herbarium: true };
    const four = trailsView({ ...base, which: 'beach', wide: true, four: true });
    eq((four.match(/ebb-trails__col/g) ?? []).length, 4, 'four columns');
    assert(four.includes('ebb-trails is-wide is-four'), 'in a row of four');
    assert(four.includes('5 kinds of plant gathered'), 'the forager counts kinds of plant, never handfuls');
    assert(four.includes('A gathering knife') && four.includes('The herbarium') && four.includes('a tin for the good ones'), 'stops inked, the next ahead in pencil');
    assert(four.includes('Gathered: nettle') && four.includes('Gathered in winter'), 'plants and seasons on the line');
    assert(four.includes('data-view="herbarium"'), 'the herbarium opens from its trail');
    const two = trailsView({ ...base, which: 'beach', wide: true, four: false });
    assert(two.includes('ebb-trails is-wide"') && (two.match(/ebb-trails__col/g) ?? []).length === 4, 'two by two: the same four, not in a row');
    const tabs = trailsView({ ...base, which: 'forage', wide: false });
    eq((tabs.match(/ebb-trails__tab"/g) ?? []).length, 4, 'four tabs');
    eq((tabs.match(/ebb-trails__col/g) ?? []).length, 1, 'one trail at a time');
    assert(tabs.includes('aria-pressed="true">Forager'), 'its tab pressed');
    const css = await fetch('../src/ui/journal-trails.css').then((r) => r.text());
    assert(/\.ebb-trails\.is-wide\.is-four \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(css), 'four columns that may shrink (minmax 0): no horizontal scroll');
    assert(/\.ebb-trails\.is-wide \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css), 'two by two');
    assert(/\.ebb-trails__tabs \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css), 'the four tabs two by two');
    assert(/\.ebb-journal\.is-wide\.is-four \{ width: min\(1120px, calc\(100vw/.test(css), 'the panel never wider than the window');
  });

  test(G, "no save format change: the forager's firsts and stops come back as they were", () => {
    assert(FORMAT >= 10, 'format 10 or later: the forager adds no format of its own');
    const e = sampleForager({ forager: ['herbarium'], forage: { herbarium: true } });
    const { sections } = snapshot(/** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
      unlocks: e, view: null, looks: {}, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0 }));
    const back = restore(Object.fromEntries(sections)).unlocks;
    eq(JSON.stringify(back.firsts), JSON.stringify(e.firsts), 'the firsts come back exactly');
    assert(back.forage.herbarium && back.forager[0] === 'herbarium', 'what was given stays given');
  });
}
