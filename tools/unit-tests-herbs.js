// @ts-check
// The four tea herbs (P2b, docs/future/13 section 5) for tools/unit-tests.html: water mint,
// meadowsweet, nettle and chamomile each keep to their own ground, creep only in their season and
// stop at their cap, and give their part only in its window. Uniform made-up habitats, so a test
// reads one kind of ground at a time.

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { suitability, plantSeed, settleGrowth } from '../src/world/growth/coarse.js';
import { loadRecipes } from './unit-tests-growth.js';

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

  test(HERBS, 'the herbs are gather plants: they creep, never jump, have caps, rest in winter, are not in the Plant tool and do not arrive by themselves yet', async () => {
    const { flora, growth } = await loadRecipes();
    /** @type {Record<string, number>} */ const caps = { watermint: 20, meadowsweet: 14, nettle: 16, chamomile: 20 };
    for (const sp of IDS) {
      const r = flora[sp];
      assert(growth.species.includes(sp), `${sp} in growth.json species`);
      assert(!growth.starters.includes(sp), `${sp} is no starter`);
      assert(r.tags.includes('gather') && r.tags.includes('tea'), `${sp} tagged gather and tea`);
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
}
