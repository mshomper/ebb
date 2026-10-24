// @ts-check
// The four tea herbs (P2b, docs/future/13 section 5) for tools/unit-tests.html: water mint,
// meadowsweet, nettle and chamomile each keep to their own ground, creep only in their season and
// stop at their cap, and give their part only in its window. Uniform made-up habitats, so a test
// reads one kind of ground at a time.

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { suitability, plantSeed, settleGrowth } from '../src/world/growth/coarse.js';
import { volunteerAt } from '../src/world/growth/volunteers.js';
import { loadRecipes } from './unit-tests-growth.js';
import { partsOf, pickable, pick } from '../src/world/gather/plants.js';
import { makeKinds } from '../src/world/pack/kinds.js';
import { itemIconFor, driedIconFor } from '../src/ui/icons/item-registry.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';

/** @param {string} p */
const getJson = (p) => fetch(`../recipes/${p}.json`).then((r) => {
  if (!r.ok) throw new Error(`recipes/${p}.json: HTTP ${r.status}`);
  return r.json();
});

const HERBS = 'herbs';
const IDS = ['watermint', 'meadowsweet', 'nettle', 'chamomile'];
const HOURS_PER_SEASON = 14 * 24;

/**
 * A habitat that is the same ground everywhere. depthCm (cm of standing water), the rest 0..1;
 * shoreM is the height above the sea (m).
 * @param {{ depthCm?: number, moisture?: number, salt?: number, sand?: number, rock?: number, soil?: number, slopeDeg?: number, shoreM?: number }} g
 */
export function uniform(g) {
  const N = HABITAT_CELLS, n = N * N;
  const b = (/** @type {number | undefined} */ v) => Math.round(255 * (v ?? 0));
  return {
    n: N, hash: 0x7ea, open: new Uint8Array(n).fill(1), sea: new Uint8Array(n), grass: new Uint8Array(n),
    depthCm: new Uint8Array(n).fill(g.depthCm ?? 0), moisture: new Uint8Array(n).fill(b(g.moisture)), salt: new Uint8Array(n).fill(b(g.salt)),
    still: new Uint8Array(n).fill(1), sand: new Uint8Array(n).fill(b(g.sand)), rock: new Uint8Array(n).fill(b(g.rock)),
    soil: new Uint8Array(n).fill(b(g.soil)), slopeDeg: new Uint8Array(n).fill(g.slopeDeg ?? 3),
    heightDm: new Int16Array(n).fill(Math.round((g.shoreM ?? 2) * 10)),
  };
}

/** Each herb's home ground, and grounds it must refuse with the need it names. */
export const HERB_GROUND = {
  watermint: {
    home: { depthCm: 4, moisture: 1, soil: 1 },
    never: [['20 cm deep', { depthCm: 20, moisture: 1, soil: 1 }, 'deep'], ['a damp bank, out of the water', { moisture: 0.45, soil: 1 }, 'dry'],
      ['salty shallows', { depthCm: 4, moisture: 1, soil: 1, salt: 0.6 }, 'salt']],
  },
  meadowsweet: {
    home: { moisture: 0.75, soil: 1 },
    never: [['4 cm of water', { depthCm: 4, moisture: 1, soil: 1 }, 'deep'], ['dry ground', { moisture: 0.1, soil: 1 }, 'dry'],
      ['salty ground', { moisture: 0.75, soil: 1, salt: 0.5 }, 'salt']],
  },
  nettle: {
    home: { moisture: 0.45, soil: 1 },
    never: [['3 cm of water', { depthCm: 3, moisture: 1, soil: 1 }, 'deep'], ['salty ground', { moisture: 0.45, soil: 1, salt: 0.6 }, 'salt'],
      ['bare sand', { moisture: 0.45, sand: 1 }, 'ground']],
  },
  chamomile: {
    home: { sand: 0.6, moisture: 0.2, salt: 0.2, shoreM: 2 },
    never: [['the tide band', { sand: 0.6, moisture: 0.82, salt: 0.82, shoreM: 0.3 }, 'wet'], ['turf with no sand', { soil: 1, moisture: 0.2, shoreM: 2 }, 'ground'],
      ['wet sand', { sand: 0.6, moisture: 0.8, salt: 0.2, shoreM: 2 }, 'wet']],
  },
};

const CENTER = HABITAT_ORIGIN + HABITAT_CELLS / 2 + 0.5;

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addHerbTests(test, assert, eq) {
  test(HERBS, 'the four tea herbs keep to their ground: mint in the shallows, meadowsweet on the damp bank, nettle on rich soil, chamomile on sand above the tide', async () => {
    const { flora } = await loadRecipes();
    const lines = [];
    for (const [sp, G] of Object.entries(HERB_GROUND)) {
      const rec = flora[sp];
      assert(rec, `recipes/flora/${sp}.json is listed in growth.json species`);
      const home = suitability(rec, /** @type {any} */ (uniform(G.home)), CENTER, CENTER).suit;
      assert(home >= 0.9, `${sp} at home: ${home.toFixed(2)}, wanted at least 0.9`);
      for (const [name, g, need] of /** @type {[string, any, string][]} */ (G.never)) {
        const r = suitability(rec, /** @type {any} */ (uniform(g)), CENTER, CENTER);
        assert(r.suit < 0.2, `${sp} on ${name}: ${r.suit.toFixed(2)}, wanted under 0.2`);
        eq(r.worst, need, `${sp} on ${name} names the need`);
      }
      lines.push(`${sp} ${home.toFixed(2)} at home, refuses ${G.never.map((n) => n[0]).join(', ')}`);
    }
    return lines.join('; ');
  });

  test(HERBS, 'arrivals: mint comes after iris, chamomile after marigold, meadowsweet and nettle last; nettle waits for 3 lit days and lands within 4 m of the ring', async () => {
    const recipes = await loadRecipes();
    const O = recipes.growth.volunteers.order;
    eq(O[O.indexOf('iris') + 1], 'watermint', 'after iris');
    eq(O[O.indexOf('marigold') + 1], 'chamomile', 'after marigold');
    eq(O.slice(-2).join(), 'meadowsweet,nettle', 'last two');
    const C = recipes.flora.nettle.volunteer.cause;
    eq(JSON.stringify(C), JSON.stringify({ kind: 'fire', reachM: 4, days: 3 }), 'nettle cause');
    // Everything else has come already; only nettle waits. Nettle ground everywhere, a fire in the middle.
    const hab = /** @type {any} */ (uniform(HERB_GROUND.nettle.home));
    const env = { ...makeEnv(13, recipes), habitat: () => hab };
    const arrived = Object.fromEntries(O.filter((/** @type {string} */ sp) => sp !== 'nettle').map((/** @type {string} */ sp) => [sp, 0]));
    const g = { arrived, since: 0 };
    const suit = (/** @type {any} */ rec, /** @type {number} */ k) => suitability(rec, hab, HABITAT_ORIGIN + (k % hab.n) + 0.5, HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5).suit;
    /** Hours of a summer's first week on which a volunteer lands, with the fire lit on `days` days. @param {number} days */
    const landings = (days) => {
      hab.fire = { x: CENTER, z: CENTER, days };
      /** @type {number[]} */ const out = [];
      for (let h = HOURS_PER_SEASON + 30; h < HOURS_PER_SEASON + 30 + 24 * 30; h++) {
        const v = volunteerAt(g, hab, env, h, suit, () => false);
        if (v) { eq(v.sp, 'nettle', 'the only one waiting'); out.push(v.k); }
      }
      return out;
    };
    eq(landings(2).length, 0, 'landings with the fire lit on 2 days');
    const ks = landings(3);
    assert(ks.length > 0, 'nettle lands once the fire has been lit on 3 days');
    for (const k of ks) {
      const d = Math.hypot(HABITAT_ORIGIN + (k % hab.n) + 0.5 - CENTER, HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5 - CENTER);
      assert(d <= 4, `a nettle landed ${d.toFixed(2)} m from the ring`);
    }
    return `order ${O.join(', ')}; nettle could land in ${ks.length} hours over 30 days, all within 4 m`;
  });

  test(HERBS, 'the herbs are gather plants: they creep, never jump, have caps, rest in winter, and are not in the Plant tool', async () => {
    const [{ flora, growth }, words] = await Promise.all([loadRecipes(), getJson('world/journal')]);
    /** @type {Record<string, number>} */ const caps = { watermint: 20, meadowsweet: 14, nettle: 16, chamomile: 20 };
    for (const sp of IDS) {
      const r = flora[sp];
      assert(growth.species.includes(sp), `${sp} in growth.json species`);
      assert(!growth.starters.includes(sp), `${sp} is no starter`);
      assert(r.tags.includes('gather') && r.tags.includes('tea'), `${sp} tagged gather and tea`);
      eq(words.species[sp].plantable, false, `${sp}'s page writes no "you can plant it now"`);
      eq(r.plantTool, false, `${sp} plantTool`);
      eq(r.spread.kind, 'rhizome', `${sp} spreads by`);
      assert(r.spread.distanceM[0] > r.spread.minSpacingM, `${sp}: a creep step must clear the spacing`);
      eq(r.spread.minSuit, 0.75, `${sp} spread.minSuit`);
      eq(r.spread.maxCount, caps[sp], `${sp} cap`);
      assert(r.spread.window, `${sp} creeps only in its window`);
      eq(JSON.stringify(r.dormant), '[3.05,3.95]', `${sp} winter rest`);
      assert(r.volunteer?.seasons?.length, `${sp} names the seasons it may arrive in`);
    }
    eq(flora.chamomile.drawScale, 1.5, 'chamomile drawn 1.5 times real size (Matt, October 24, 2026)');
    eq(JSON.stringify(growth.testSets.herbs), JSON.stringify(IDS), 'growth.json testSets.herbs');
    const idx = IDS.map((sp) => flora[sp].index);
    const others = Object.entries(flora).filter(([sp]) => !IDS.includes(sp)).map(([, r]) => r.index);
    assert(new Set([...idx, ...others]).size === idx.length + others.length, `draw indexes are unique: ${idx.join(', ')}`);
    return `caps ${IDS.map((sp) => `${sp} ${caps[sp]}`).join(', ')}; indexes ${idx.join(', ')}`;
  });

  test(HERBS, 'water mint creeps from one clump to its cap in spring and summer, never in autumn, the same way twice', async () => {
    const recipes = await loadRecipes();
    const hab = uniform(HERB_GROUND.watermint.home);
    const env = { ...makeEnv(11, recipes), habitat: () => hab };
    const count = (/** @type {any} */ s) => s.growth.plants.filter((/** @type {any} */ p) => p.sp === 'watermint').length;
    /** @param {number} h0 @param {number} hours */
    const run = (h0, hours) => {
      let s = settleGrowth(initialWorldState(11), env);
      const r = plantSeed(s, 'watermint', CENTER, CENTER, env);
      assert(r.ok, `a mint seed takes (${r.reason})`);
      s = r.state;
      let most = 0;
      for (let h = h0; h < h0 + hours; h++) { s = runHour(s, h, env).state; most = Math.max(most, count(s)); }
      return { s, most };
    };
    // Spring and summer: from day 4 of spring to the end of its creeping window.
    const a = run(4 * 24, Math.round(1.8 * HOURS_PER_SEASON) - 4 * 24);
    const b = run(4 * 24, Math.round(1.8 * HOURS_PER_SEASON) - 4 * 24);
    eq(hashWorldState(a.s), hashWorldState(b.s), 'world hash of two runs');
    const cap = recipes.flora.watermint.spread.maxCount;
    assert(a.most > 1, `the clump never crept: ${a.most}`);
    assert(a.most <= cap, `${a.most} clumps, past the cap of ${cap}`);
    // Autumn into winter: the clump grows but never creeps.
    const c = run(2 * HOURS_PER_SEASON, HOURS_PER_SEASON);
    eq(c.most, 1, 'mint clumps after an autumn');
    return `${a.most} clumps by midsummer (cap ${cap}); 1 after an autumn`;
  });

  test(HERBS, 'each herb gives its part only in its window: mint leaves, meadowsweet flowers, nettle tops in spring and autumn, chamomile flowers', async () => {
    const [{ flora }, gather] = await Promise.all([loadRecipes(), getJson('world/gather')]);
    /** Season positions [pos, can pick] per herb (well inside or outside its window, past the plant's jitter). @type {Record<string, [string, [number, boolean][]]>} */
    const CASES = {
      watermint: ['leaves', [[0.3, false], [1.5, true], [2.2, true], [2.8, false], [3.5, false]]],
      meadowsweet: ['flowers', [[0.8, false], [1.6, true], [2.4, false], [3.5, false]]],
      nettle: ['tops', [[0.5, true], [1.5, false], [2.4, true], [3.5, false]]],
      chamomile: ['flowers', [[0.6, false], [1.6, true], [2.0, true], [2.6, false], [3.5, false]]],
    };
    const lines = [];
    for (const [sp, [part, cases]] of Object.entries(CASES)) {
      eq(partsOf(sp, gather).join(), part, `${sp} parts`);
      const env0 = { flora: flora[sp] };
      for (let id = 1; id <= 5; id++) {
        const plant = { id, sp, size: 0.9, best: 0.9 };
        for (const [pos, ok] of cases) {
          const r = pickable(plant, part, { ...env0, pos }, gather);
          assert(r.ok === ok, `${sp} ${part} at season ${pos}, plant ${id}: ${r.ok ? 'pickable' : r.why}`);
        }
      }
      // A pick takes a third and leaves it resting; a young plant gives nothing.
      const picked = pick({ id: 1, sp, size: 0.9, best: 0.9 }, part, env0, gather);
      assert(Math.abs(picked.size - 0.9 * (1 - gather.plants.defaults.herb.share)) < 1e-9, `${sp} after one pick: ${picked.size}`);
      eq(pickable(picked, part, { ...env0, pos: cases.find((c) => c[1])?.[0] ?? 0 }, gather).why, 'rest', `${sp} just picked`);
      eq(pickable({ id: 1, sp, size: 0.5, best: 0.5 }, part, { ...env0, pos: 1.6 }, gather).why, 'young', `${sp} still young`);
      lines.push(`${sp}.${part}`);
    }
    return lines.join(', ');
  });

  test(HERBS, 'herb parts go into named herb pouches with their drawn icons, and dry on the rack', async () => {
    const pack = await getJson('world/pack');
    const kinds = makeKinds(pack);
    /** @type {[string, string, string][]} */
    const want = [['watermint.leaves', 'Water mint', 'mint'], ['meadowsweet.flowers', 'Meadowsweet', 'meadowsweet'],
      ['nettle.tops', 'Nettle tops', 'nettle'], ['chamomile.flowers', 'Chamomile', 'chamomile']];
    for (const [id, name, icon] of want) {
      const k = /** @type {any} */ (kinds.byId.get(id));
      assert(k, `${id} in pack.json kinds`);
      eq(k.name, name, `${id} name`);
      eq(kinds.groupOf(id), 'herbs', `${id} group`);
      eq(kinds.campOf(id), 'rack', `${id} at camp`);
      assert(k.line.length > 10, `${id} has a card line`);
      eq(itemIconFor(id), icon, `${id} icon`);
      eq(driedIconFor(id), `dried:${icon}`, `${id} dried icon`);
    }
    return want.map((w) => `${w[1]} (${w[2]})`).join(', ');
  });

  test(HERBS, 'each herb has a home: a journal page with its chip, a sketch drawing every label, a Gives line inked by the first pick, a web node and a place', async () => {
    const [words, web, list] = await Promise.all([getJson('world/journal'), getJson('world/journal-web'), getJson('world/journal-list')]);
    for (const sp of IDS) {
      const rec = words.species[sp];
      assert(rec, `journal.json page ${sp}`);
      assert(words.order.includes(sp), `${sp} in the journal's order`);
      assert(ICON_NAMES.includes(rec.icon), `${sp}'s chip ${rec.icon} is drawn`);
      eq(rec.stages.length, 6, `${sp} stage lines`);
      for (const k of ['arrived', 'seen', 'spread', 'flower', 'dormant', 'woke', 'drown', 'seed', 'gone']) assert(rec.notes[k], `${sp} note ${k}`);
      assert(rec.gives.some((/** @type {any} */ g) => g.when === `picked:${sp}` && /tea/i.test(g.ink)), `${sp}'s Gives line says it is for tea, inked by picked:${sp}`);
      assert(hasSketch(sp), `${sp} has a sketch`);
      const labels = Object.fromEntries(Object.entries(rec.sketch.labels).map(([k, v]) => [k, /** @type {any} */ (v).text]));
      const svg = drawSketch(sp, { stage: 2, labels, scale: rec.sketch.scale });
      for (const [k, lines] of Object.entries(labels)) assert(svg.includes(`>${lines[0]}<`), `${sp} sketch draws its ${k} label`);
      assert(!drawSketch(sp, { stage: 0, labels: {}, scale: rec.sketch.scale }).includes('<text'), `${sp} pencil sketch has no labels`);
      eq(web.nodes[sp]?.page, sp, `${sp} web node`);
      assert(web.links.some((/** @type {any} */ l) => l.b === sp), `${sp} has a web link`);
      assert(list.placeOf[sp], `${sp} has a place in the list`);
    }
    assert(words.species.nettle.field.some((/** @type {any} */ f) => /sting/.test(f.text)), 'the nettle sting is a field note');
    return IDS.map((sp) => `${sp}: ${Object.keys(words.species[sp].sketch.labels).join(', ')}`).join('; ');
  });
}
