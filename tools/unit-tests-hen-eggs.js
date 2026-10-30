// @ts-check
// Hen egg tests for tools/unit-tests.html (docs/future/15, slice 4): she lays by day length (none in
// winter, most in late spring and summer, fewer in autumn, none while she moults), at about one egg
// every 1.2 days at best, the same eggs on every replay; before Familiar in her scrape, from
// Familiar in the nest box once it stands, never more than nestMax waiting; the nest box and the
// eggshell grit are makes whose parts no other make or build takes; the walker's meal wants an egg
// (salt makes it the good one) and has its boon and words; grit is her treat and eggs are no
// creature's; the pack holds a few eggs at most; an older hen state (no nest) reads as before.

import { layingShare, laysOn, layDayLength, moulting, applyEggs, takeEgg, henBoxBuilt, scrapeSpot, seasonPosOf } from '../src/world/hen/eggs.js';
import { newHen, coarseStep } from '../src/world/hen/trust.js';
import { sunMoon } from '../src/world/sky/sun-moon.js';
import { layout, serves, cleanCook } from '../src/world/camp/making.js';
import { mealOf } from '../src/world/camp/cookpot.js';
import { add as packAdd } from '../src/world/pack/model.js';
import { makeKinds } from '../src/world/pack/kinds.js';
import { eggMesh, scrapeMesh, nestBoxMesh, bedMesh, eggSpots, nestCard } from '../src/world/hen/nest.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';
import { choosePlan } from '../src/world/hen/bands.js';

const G = 'hen: eggs';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();
/** The sun's day length on game day d (the starter sky's orbit). @param {number} d @param {any} sky */
const dayLen = (d, sky) => sunMoon(d * 86400 + 43200, sky.orbit).dayLengthH;
/** Three gorse bushes about the origin, her scrub. */
const PLANTS = [{ sp: 'gorse', x: 0, z: 1, size: 0.8 }, { sp: 'gorse', x: 1.5, z: -1, size: 0.7 }, { sp: 'gorse', x: -1.4, z: -0.8, size: 0.75 }];

/**
 * A year of her laying, hour by hour at layH: eggs taken each day so the nest never fills.
 * @param {any} R @param {any} sky @param {number} trust @param {boolean} box @param {number} seed
 */
function year(R, sky, trust, box, seed) {
  /** @type {any} */ let H = { ...newHen(0), trust, ...(box ? { box: true } : {}) };
  const bySeason = [0, 0, 0, 0], where = { scrape: 0, box: 0 };
  for (let d = 0; d < 56; d++) {
    const hour = d * HOURS_PER_DAY + R.eggs.layH;
    const state = { growth: { plants: PLANTS }, seasons: { dayLengthH: dayLen(d, sky) } };
    const ev = applyEggs(H, R, hour, state, seed);
    for (const e of ev) if (e.name === 'hen:laid') { bySeason[Math.floor(d / 14)]++; where[/** @type {'scrape'|'box'} */ (e.payload.where)]++; }
    H = { ...H, nest: { ...H.nest, eggs: 0 } };
  }
  return { bySeason, where, H };
}

/** @param {(group: string, name: string, fn: () => any) => void} test @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq */
export function addHenEggTests(test, assert, eq) {
  test(G, 'laying follows day length: none in short days, her best in long ones, and none through her autumn moult', async () => {
    const [R, sky] = await Promise.all([load('species/hen'), load('world/sky')]), E = R.eggs;
    eq(layingShare(E, 9.9), 0, 'midwinter: none');
    eq(layingShare(E, 11.7), 0, 'late winter: none yet');
    eq(layingShare(E, 14.1), 1, 'midsummer: her best');
    assert(layingShare(E, 12.4) > 0 && layingShare(E, 12.4) < 1, 'between, in proportion');
    for (let d = 42; d < 56; d++) assert(layingShare(E, layDayLength(E, d)) === 0, `winter day ${d}: no egg`);
    assert(layingShare(E, layDayLength(E, 28)) > 0.3, 'the first day of autumn: still laying, the light answered late');
    assert(layingShare(E, layDayLength(E, 0)) === 0, 'the first day of spring: not yet');
    for (let d = 0; d < 56; d++) if (moulting(E, d)) assert(!laysOn(E, 1, d, 14), `moult day ${d}: no egg even in long days`);
    assert([...Array(56).keys()].some((d) => moulting(E, d) && seasonPosOf(d) >= 2 && seasonPosOf(d) < 3), 'the moult falls in autumn');
  });

  test(G, 'a year of eggs: most in spring and summer, fewer in autumn, none in winter, about one every 1.2 days at best, the same on a replay', async () => {
    const [R, sky] = await Promise.all([load('species/hen'), load('world/sky')]);
    let total = [0, 0, 0, 0];
    for (const seed of [11, 22, 33, 44, 55]) {
      const a = year(R, sky, 0, false, seed), b = year(R, sky, 0, false, seed);
      eq(JSON.stringify(a.bySeason), JSON.stringify(b.bySeason), `seed ${seed}: the same eggs on a replay`);
      total = total.map((t, i) => t + a.bySeason[i]);
    }
    const [spring, summer, autumn, winter] = total;
    eq(winter, 0, 'none in winter');
    assert(summer > autumn && spring > autumn, `spring ${spring} and summer ${summer} over autumn ${autumn}`);
    assert(autumn > 0, 'a few in autumn');
    // Five summers of 14 days at best 1/1.2 is at most about 58; the long days give most of that.
    assert(summer <= 5 * 14 / R.eggs.bestEveryDays * 1.25 && summer >= 5 * 14 / R.eggs.bestEveryDays * 0.5, `summer near her best rate (${summer} in 70 days)`);
  });

  test(G, 'where she lays: the scrape before Familiar, the nest box from Familiar once it stands; never past nestMax', async () => {
    const [R, sky] = await Promise.all([load('species/hen'), load('world/sky')]);
    const top = R.presence.bands[R.presence.bands.length - 1];
    const wary = year(R, sky, 0, true, 7), fam = year(R, sky, top, true, 7), famNoBox = year(R, sky, top, false, 7);
    eq(wary.where.box, 0, 'Wary: never the box'); assert(wary.where.scrape > 0, 'Wary: the scrape');
    eq(fam.where.scrape, 0, 'Familiar with the box: never the scrape'); assert(fam.where.box > 0, 'Familiar: the box');
    eq(famNoBox.where.box, 0, 'Familiar without a box: still the scrape');
    const sc = wary.H.nest.scrape;
    assert(sc && Math.hypot(sc[0] - 0, sc[1] - 1) < 1, 'the scrape lies under her roost bush');
    // Never past nestMax: eggs left in the nest stop her laying there.
    /** @type {any} */ const H = { ...newHen(0) };
    for (let d = 0; d < 28; d++) applyEggs(H, R, d * 24 + R.eggs.layH, { growth: { plants: PLANTS }, seasons: { dayLengthH: 14 } }, 3);
    eq(H.nest.eggs, R.eggs.nestMax, 'the nest holds nestMax at most');
    const s1 = takeEgg({ creatures: { hens: H } });
    eq(s1.creatures.hens.nest.eggs, R.eggs.nestMax - 1, 'one taken');
    eq(takeEgg({ creatures: { hens: { ...H, nest: { ...H.nest, eggs: 0 } } } }).creatures.hens.nest.eggs, 0, 'none to take');
    eq(henBoxBuilt({ creatures: { hens: newHen(0) } }).creatures.hens.box, true, 'the nest box kept with her');
    eq(scrapeSpot(R, { growth: { plants: [] }, creatures: {} }), null, 'no scrape spot with no scrub and no sighting');
    // A laying morning: she goes to the nest, before foraging or following.
    const see = { band: 3, hen: { x: 4, z: 0 }, home: { x: 0, z: 0 }, walker: { x: 9, z: 0, speed: 1, sit: false }, ring: null, hourOfDay: 9.5, day: 2, greetedDay: 2,
      treat: null, dig: null, visitDue: false, following: false, lay: { x: 1, z: 1 } };
    eq(choosePlan(R, see)?.purpose, 'lay', 'to the nest to lay');
  });

  test(G, 'the hourly tick lays her eggs; an older hen state with no nest reads as before', async () => {
    const R = await load('species/hen');
    const env = { recipes: { species: { hen: R } }, seed: 5 };
    // An old save's hen: trust and Fond's counts, no nest, no roost, no box.
    const old = { creatures: { hens: { trust: 0.3, since: 0, day: 0, nearH: 0, famDays: 0, together: 0 } }, growth: { plants: PLANTS }, seasons: { dayLengthH: 14 } };
    let s = old, laid = 0;
    for (let h = 24 * 14; h < 24 * 20; h++) { const r = coarseStep(s, h, env); s = r.state; laid += r.events.filter((e) => e.name === 'hen:laid').length; }
    assert(laid > 0, `she lays in the long days of summer (${laid} in 6 days)`);
    eq(s.creatures.hens.trust, 0.3, 'her trust as it was');
  });

  test(G, 'the nest box and the eggshell grit: unique parts, the box into the nest slot, the grit at the mortar', async () => {
    const C = await load('world/cook'), s = cleanCook(null);
    const box = C.makes['nest-box'], grit = C.makes['eggshell-grit'];
    eq(JSON.stringify(box.parts), JSON.stringify(['sticks', 'rushes.stems', 'rushes.stems']), 'the box: sticks and two handfuls of rushes');
    eq(box.out, 'slot'); eq(box.slot, 'nest'); eq(box.max, 1);
    eq(JSON.stringify(grit.parts), JSON.stringify(['eggshells']), 'the grit: eggshells');
    eq(grit.act, 'grind'); eq(grit.at, 'apothecary'); eq(grit.gives, 'grit'); eq(grit.after, 'mortar');
    const L = layout(C, 'workbench', ['rushes.stems', 'sticks', 'rushes.stems'], s, { filled: () => true });
    assert(L.complete && L.make === 'nest-box', `laid in any order, the nest box (${L.make})`);
    for (const [mine, laid] of /** @type {[string, string[]][]} */ ([['nest-box', ['sticks', 'rushes.stems', 'rushes.stems']], ['eggshell-grit', ['eggshells']]])) {
      const fills = (/** @type {any[]} */ parts) => {
        if (parts.length !== laid.length) return false;
        const used = laid.map(() => false);
        return parts.every((p) => { const i = laid.findIndex((k, j) => !used[j] && serves(p, k)); if (i < 0) return false; used[i] = true; return true; });
      };
      for (const [id, other] of Object.entries(C.makes)) if (id !== mine) assert(!fills(/** @type {any} */ (other).parts), `${id} does not take the ${mine}'s parts`);
      for (const [id, b] of Object.entries(C.builds)) assert(!fills(/** @type {any} */ (b).parts.flatMap((/** @type {[string, number]} */ [k, n]) => Array(n).fill(k))), `the ${id} build takes other parts`);
      for (const k of ['pageNames', 'pageParts', 'made']) assert(C.words[k][mine], `the camp page's ${k} has the ${mine}`);
    }
    const lands = await Promise.all(['land/starter-island', 'land/starter-island-2'].map(load));
    for (const L2 of lands) assert(L2.camp.slots.some((/** @type {any} */ q) => q.id === 'nest'), 'the nest slot on the starter islands');
  });

  test(G, "the walker's meal: an egg, salt for the good one; its boon, its words; the shells after", async () => {
    const C = await load('world/cook'), ML = C.meal;
    eq(mealOf(['egg'], ML)?.salted, false, 'an egg alone: a plain boiled egg');
    eq(mealOf(['egg', 'sea-salt'], ML)?.salted, true, 'with a pinch of salt: the good breakfast');
    eq(mealOf(['sea-salt'], ML), null, 'salt alone is no meal');
    eq(mealOf([], ML), null, 'nothing laid, no meal');
    const B = C.boons[ML.boon];
    assert(B && B.h > 0 && B.walk > 1, 'a small timed boon');
    assert(C.words.boonNames[ML.boon] && C.words.boonLines[ML.boon], 'its name and line');
    for (const k of ['name', 'cook', 'plain', 'salted', 'first', 'noEgg', 'noWater', 'noFire']) assert(C.words.cookpot[k], `the cooking pot's word ${k}`);
    eq(ML.gives, 'eggshells', 'the shells go in the pack');
    assert(C.words.pageNames.meal && C.words.pageParts.meal, 'the camp page names the meal');
  });

  test(G, 'grit is her treat; eggs are no creature\'s; a few eggs in the pack at most; the meshes are well formed', async () => {
    const [R, P, idx] = await Promise.all([load('species/hen'), load('world/pack'), load('index')]);
    assert(R.treat.kinds.includes('grit') && R.treat.idOf.grit === 'grit', 'grit among her treats');
    const ids = Object.keys(idx.recipes ?? idx).filter((k) => k.startsWith('species/'));
    for (const id of ids) {
      const S = await load(id);
      assert(!(S.treat?.kinds ?? []).includes('egg'), `${id} is never fed eggs`);
    }
    for (const k of ['egg', 'eggshells', 'grit', 'sea-salt']) assert(P.kinds.some((/** @type {any} */ q) => q.id === k), `the pack knows ${k}`);
    assert(P.pickups.kinds.grit, 'set out, grit lies drawn on the ground');
    const kinds = makeKinds(P);
    const r = packAdd(/** @type {any} */ ({ pouches: [], carriers: [], heaps: [], holding: null }), 'egg', 5, kinds, P);
    eq(r.added, P.kinds.find((/** @type {any} */ q) => q.id === 'egg').max, 'a few eggs at most');
    for (const m of [eggMesh(R.eggs.draw.eggM), scrapeMesh(0.16), nestBoxMesh(), bedMesh()]) {
      assert(m.data.every(Number.isFinite) && m.indices.length % 3 === 0 && Math.max(...m.indices) < m.data.length / 8, 'a well-formed mesh');
    }
    eq(eggSpots(3, { x: 0, z: 0 }, 0.05).length, 3, 'a spot for each egg');
    const c = nestCard({ x: 0, z: 0 }, 'scrape', 2, R.eggs.words);
    assert(c.henNest === 'scrape' && c.eggs === 2 && /Two/.test(c.text), 'the scrape card says two eggs');
  });
}
