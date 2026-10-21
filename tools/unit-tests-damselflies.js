// @ts-check
// Azure damselfly tests for tools/unit-tests.html (M2 season marker; docs 12, 13 "The year, season
// by season"): they fly from the very end of spring through the summer, come to any still pond with
// reeds (fish are fine), perch more than they fly with their wings folded, give no gift, and have a
// journal page with a sketch and true ties in the web.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { due } from '../src/world/expansion.js';
import { createPatrol, posePatrol } from '../src/world/creatures/patrol.js';
import { axisAngle } from '../src/world/creatures/pose.js';
import { needMaps } from '../src/world/ecology/needs.js';
import { seasonsAt } from '../src/world/seasons.js';
import { SECONDS_PER_HOUR, HOURS_PER_DAY } from '../src/core/clock.js';
import { hasSketch, drawSketch } from '../src/ui/sketches/index.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { TEST_PARAMS } from '../src/save/autosave.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const G = 'damselflies';
const KEY = 'damselflies';
const json = (/** @type {string} */ p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());

/**
 * Run a world for some hours, keeping the damselflies' events.
 * @param {any} state @param {any} env @param {number} from @param {number} hours
 */
function run(state, env, from, hours) {
  /** @type {{ hour: number, name: string, payload: any }[]} */ const events = [];
  for (let h = from; h < from + hours; h++) {
    const r = runHour(state, h, env);
    state = r.state;
    for (const e of r.events) if (e.payload?.species === KEY) events.push({ hour: h, name: e.name, payload: e.payload });
  }
  return { state, events };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addDamselflyTests(test, assert, eq) {
  test(G, 'they fly from the very end of spring through the summer, and are nymphs the rest of the year', async () => {
    const R = await loadEcologyRecipes();
    const at = (/** @type {number} */ season, /** @type {number} */ day) => seasonsAt(((season * 14 + day) * HOURS_PER_DAY + 12) * SECONDS_PER_HOUR, R.seasons).dormant.damselflies;
    eq(at(0, 1), true, 'early spring');
    eq(at(0, 10), true, 'mid spring');
    eq(at(0, 13), false, 'the last day of spring');
    eq(at(1, 0), false, 'the first day of summer');
    eq(at(1, 13), false, 'late summer');
    eq(at(2, 5), true, 'autumn');
    eq(at(3, 7), true, 'winter');
    // Ahead of the dragonflies, which wait for summer.
    assert(seasonsAt(((13) * HOURS_PER_DAY + 12) * SECONDS_PER_HOUR, R.seasons).dormant.dragonflies, 'the dragonflies are not flying yet then');
  });

  test(G, 'they want still water with reeds near; fish are fine, so the starter pond suits them', async () => {
    const R = await loadEcologyRecipes();
    const rec = R.species.damselfly;
    eq(rec.ecology.pond, undefined, 'no pond rule (the dragonflies want a fish-free pond; damselflies do not mind)');
    eq(rec.ecology.gift, undefined, 'a season marker gives no gift');
    const w = islandWorld(R, 'starter-island', 1);
    const hab = w.model.habitat, n = hab.n;
    const midges = new Uint8Array(n * n).fill(200);
    const m = needMaps(hab, w.state.growth, { midges }, rec);
    let best = 0, far = 0;
    for (let k = 0; k < n * n; k++) {
      best = Math.max(best, m.score[k]);
      if (m.water[k] === 0 && m.score[k] > 0) far++;
    }
    assert(m.bodies.length > 0, 'the starter pond is a pool for them');
    assert(best > rec.ecology.arrival.rightScore, `the best square scores ${best.toFixed(2)}`);
    eq(far, 0, 'squares scoring with no still water near');
    const bare = needMaps(hab, { ...w.state.growth, plants: [], cover: {} }, { midges }, rec);
    const bareBest = bare.score.reduce((a, v) => Math.max(a, v), 0);
    assert(bareBest < rec.ecology.arrival.rightScore, `with no stems the best square scores ${bareBest.toFixed(2)}, too low to come`);
    return `best ${best.toFixed(2)} with the starter reeds, ${bareBest.toFixed(2)} with none`;
  });

  test(G, 'on a new island the first ones come at the very end of spring, a late morning, then more through the summer', async () => {
    const R = await loadEcologyRecipes();
    const A = R.species.damselfly.ecology.arrival;
    const lines = [];
    for (const seed of [1, 2]) {
      const w = islandWorld(R, 'starter-island', seed);
      const r = run(w.state, w.env, w.h0 + 1, 24 * 26);
      const at = (/** @type {string} */ name) => r.events.find((e) => e.name === name)?.hour ?? -1;
      const sign = at('creature:arrived'), settled = at('creature:settled'), joined = at('creature:joined');
      assert(sign >= 24 * 12.6 && sign < 24 * 18, `seed ${seed}: the first came at hour ${sign} (day ${(sign / 24).toFixed(1)})`);
      eq(sign % 24, A.comeAtH, `seed ${seed}: in the late morning`);
      assert(settled > sign, `seed ${seed}: settled at hour ${settled}`);
      assert(joined > settled, `seed ${seed}: more came at hour ${joined}`);
      const S = r.state.creatures[KEY];
      const count = S.groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
      assert(count >= 6, `seed ${seed}: ${count} by the middle of summer`);
      const happy = r.events.find((e) => e.name === 'species:happy');
      if (happy) eq(happy.payload.gift, undefined, `seed ${seed}: happy, with no gift`);
      lines.push(`seed ${seed}: first on day ${Math.floor(sign / 24) + 1}, ${count} by day 27`);
    }
    return lines.join('; ');
  });

  test(G, 'minnows in the pond do not send them away, and they sleep through autumn and winter', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    const a = run(w.state, w.env, w.h0 + 1, 24 * 18);
    const g = a.state.creatures[KEY].groups[0];
    assert(g, 'a group by early summer');
    // A school of minnows settles in the same pond.
    const fish = { ...a.state, creatures: { ...a.state.creatures, minnows: { phase: 'settled', groups: [{ id: 1, k: g.k, x: g.x, z: g.z, count: 10, mood: 1, low: 0, since: 0 }] } } };
    const b = run(fish, w.env, w.h0 + 1 + 24 * 18, 24 * 30);
    eq(b.events.filter((e) => e.name === 'creature:left').length, 0, 'none moved on because of the fish');
    const dormant = b.events.find((e) => e.name === 'creature:dormant');
    assert(dormant && dormant.hour >= 24 * 29 && dormant.hour < 24 * 31, `nymphs from day ${dormant ? (dormant.hour / 24).toFixed(1) : '-'}`);
    const after = b.events.filter((e) => e.hour > /** @type {any} */ (dormant).hour);
    eq(after.length, 0, 'nothing comes or goes while they are nymphs');
    assert(b.state.creatures[KEY].groups.length > 0, 'they are still in the pond, waiting for next spring');
  });

  test(G, 'the same seed gives the same damselflies twice', async () => {
    const R = await loadEcologyRecipes();
    const once = () => { const w = islandWorld(R, 'starter-island', 4); return run(w.state, w.env, w.h0 + 1, 24 * 20).state; };
    const a = once(), b = once();
    eq(JSON.stringify(a.creatures[KEY]), JSON.stringify(b.creatures[KEY]), 'the groups');
    eq(hashWorldState(a), hashWorldState(b), 'the world');
  });

  test(G, 'they flutter low and rest on stems more than they fly, wings folded back along the body', async () => {
    const rec = await json('species/damselfly');
    const M = rec.motion;
    const water = (/** @type {number} */ x, /** @type {number} */ z) => { const r2 = (x * x + z * z) / 9; return { surface: 0, depth: Math.max(0, 0.8 * (1 - r2)) }; };
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (x * x + z * z < 9 ? -water(x, z).depth : 0.1);
    const perches = () => [{ x: 1.2, z: 0.4, h: 1.2 }, { x: -0.6, z: 1, h: 1.1 }, { x: 0.3, z: -1.2, h: 0.6 }];
    const make = () => createPatrol({ id: 1, seed: 5, count: 6, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: 1.5, M, env: { water, ground, perches } });
    const a = make(), b = make();
    /** @type {Record<string, number>} */ const seen = { hover: 0, dart: 0, perch: 0, flee: 0 };
    let high = 0, fast = 0;
    for (let i = 0; i < 30 * 180; i++) {
      a.step(1 / 30); b.step(1 / 30);
      for (const f of a.fish) {
        seen[f.mode]++;
        if (f.mode !== 'perch' && f.y > M.hoverHeightM[1] + 0.3) high++;
        if (Math.hypot(f.vx, f.vy, f.vz) > M.dartMps * 1.2) fast++;
      }
    }
    assert(seen.perch > seen.hover + seen.dart, `perched ${seen.perch} steps, flying ${seen.hover + seen.dart}`);
    eq(high, 0, 'steps flying high over the water');
    eq(fast, 0, 'steps faster than a weak flutter');
    eq(a.fish.map((f) => f.x.toFixed(5)).join(), b.fish.map((f) => f.x.toFixed(5)).join(), 'the same seed, the same flight');
    // At rest each wing is swept back along the body: its outward axis (+x on the left) points back (-z).
    const rig = rec.body.bones;
    const moves = posePatrol(rig, /** @type {any} */ ({ mode: 'perch', phase: 0 }), M, [0, 0, 0, 1], axisAngle);
    const turn = (/** @type {number[]} */ q, /** @type {number[]} */ v) => {
      const [x, y, z, w] = q;
      const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
      return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
    };
    rig.forEach((/** @type {any} */ bone, /** @type {number} */ i) => {
      if (bone.parent < 0) return;
      const out = turn(/** @type {number[]} */ (moves[i].q), [bone.name.endsWith('l') ? 1 : -1, 0, 0]);
      assert(out[2] < -0.9 && Math.abs(out[0]) < 0.15, `${bone.name} at rest points (${out.map((v) => v.toFixed(2)).join(', ')})`);
    });
    return `three minutes: perched ${seen.perch}, hovering ${seen.hover}, flitting ${seen.dart} fly-steps`;
  });

  test(G, 'a season marker: no gift is ever due, however happy they are', async () => {
    const [naturalist, words] = await Promise.all([json('world/naturalist'), json('world/journal')]);
    const R = await loadEcologyRecipes();
    // The gifts as main.js gathers them: only species whose recipe names one.
    /** @type {Record<string, any>} */ const gifts = {};
    for (const rec of Object.values(R.species)) if (/** @type {any} */ (rec).ecology?.gift) gifts[/** @type {any} */ (rec).key ?? `${/** @type {any} */ (rec).id}s`] = /** @type {any} */ (rec).ecology.gift;
    eq(gifts[KEY], undefined, 'no damselfly gift');
    const g = due({ found: 0, flags: ['damselflies:happy', 'damselflies:settled'], earned: {}, rewards: [], gifts, words, giftWords: naturalist.gifts });
    eq(g.length, 0, 'gifts due');
    eq(words.species[KEY].gives, undefined, 'the page promises nothing');
  });

  test(G, 'the journal page: found by you, a sketch, its own icon, and true ties in the web', async () => {
    const [words, web, list] = await Promise.all([json('world/journal'), json('world/journal-web'), json('world/journal-list')]);
    const P = words.species[KEY];
    assert(P && P.kind === 'school' && words.order.includes(KEY), 'a page in the animals');
    assert(ICON_NAMES.includes(P.icon), `its icon ${P.icon} is drawn`);
    eq(list.placeOf[KEY], 'pond', 'listed at the pond');
    assert(!/genuine/i.test(JSON.stringify(P)), 'plain words');
    for (const n of Object.values(P.notes)) assert(!/damselfl/i.test(/** @type {string} */ (n)) || !['sign', 'signAgain', 'settledUnseen', 'joinedUnseen', 'scoutLeftUnseen', 'right'].some((k) => P.notes[k] === n), 'notes before they are found never name them');
    assert(hasSketch(KEY), 'a field sketch');
    for (const stage of /** @type {(0|1|2)[]} */ ([0, 1, 2])) {
      const labels = stage ? Object.fromEntries(Object.entries(P.sketch.labels).map(([k, l]) => [k, /** @type {any} */ (l).text])) : {};
      const svg = drawSketch(KEY, { stage, labels, scale: P.sketch.scale });
      assert(svg.startsWith('<svg') && !/NaN|undefined/.test(svg), `stage ${stage} draws cleanly`);
      if (stage) for (const l of Object.values(P.sketch.labels)) assert(svg.includes(/** @type {any} */ (l).text[0]), `stage ${stage} labels ${/** @type {any} */ (l).text[0]}`);
    }
    const node = web.nodes[KEY];
    assert(node && node.page === KEY && node.flag === `${KEY}:seen`, 'a web node known once found');
    const ties = web.links.filter((/** @type {any} */ l) => l.a === KEY || l.b === KEY).map((/** @type {any} */ l) => `${l.a}>${l.b}`);
    for (const t of ['fresh>damselflies', 'reeds>damselflies', 'midges>damselflies', 'damselflies>dragonflies']) assert(ties.includes(t), `the web ties ${t}`);
    return ties.join(', ');
  });

  test(G, 'the test link ?damselflies is a throwaway island', async () => {
    assert(TEST_PARAMS.includes(KEY), 'never saved over your island');
  });
}
