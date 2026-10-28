// @ts-check
// Spring at the pond, for tools/unit-tests.html (doc 13; M2): frogspawn laid by happy frogs in a warm
// shallow, hatching into tadpoles that minnows thin and that leave as froglets in summer; the toad's
// night walk from a stone or log; and turtles, which need a basking spot and come only in summer.

import * as seasons from '../src/world/seasons.js';
import { runHour, hashWorldState } from '../src/sim/tick.js';
import { coarseStep as springStep, warmShallows, toadAt, tadpoleField, springDusk, springSpots, nearestPond } from '../src/world/creatures/spring.js';
import { baskField } from '../src/world/ecology/coarse.js';
import { needMaps } from '../src/world/ecology/needs.js';
import { cellCenter } from '../src/world/ecology/habitat.js';
import { due, grant } from '../src/world/expansion.js';
import { HOURS_PER_DAY } from '../src/core/clock.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const G = 'spring at the pond';

/**
 * A world in spring (day 5) whose frogs are happy and settled along the warmest shallows.
 * @param {any} R @param {number} seed
 */
function happyFrogs(R, seed) {
  const w = islandWorld(R, 'starter-island', seed, 5);
  const hab = w.model.habitat;
  // Frogs on the shallows' edge squares, a few meters apart.
  /** @type {any[]} */ const frogs = [];
  for (let k = 0; k < hab.n * hab.n && frogs.length < 8; k++) {
    if (!(hab.open[k] && !hab.sea[k] && hab.still[k] && hab.depthCm[k] >= 5 && hab.depthCm[k] <= 30)) continue;
    const [x, z] = cellCenter(k, hab.n);
    if (frogs.some((f) => (f.x - x) ** 2 + (f.z - z) ** 2 < 9)) continue;
    frogs.push({ id: frogs.length + 1, k, x, z, yaw: 0, since: 0, mood: 0.9, low: 0, near: [] });
  }
  w.state = { ...w.state, creatures: { ...(w.state.creatures ?? {}), frogs: { phase: 'settled', happy: true, dormant: false, frogs } } };
  return w;
}

/**
 * Hours of seasons and spring only (the frogs held as they are), collecting spring's events.
 * @param {any} state @param {any} env @param {number} from @param {number} hours
 */
function runSpring(state, env, from, hours) {
  /** @type {{ hour: number, name: string, payload: any }[]} */ const events = [];
  for (let h = from; h < from + hours; h++) {
    state = seasons.coarseStep(state, h, env).state;
    const r = springStep(state, h, env);
    state = r.state;
    for (const e of r.events) events.push({ hour: h, ...e });
  }
  return { state, events };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPondSpringTests(test, assert, eq) {
  test(G, 'happy frogs lay frogspawn in the warm shallows at dusk, the same way twice', async () => {
    const R = await loadEcologyRecipes();
    const a = happyFrogs(R, 11), b = happyFrogs(R, 11);
    const ra = runSpring(a.state, a.env, a.h0 + 1, 24 * 5), rb = runSpring(b.state, b.env, b.h0 + 1, 24 * 5);
    const laid = ra.events.filter((e) => e.name === 'creature:spawned');
    assert(laid.length > 0, 'some spawn laid in five spring days');
    // Dusk moves later as spring's days lengthen: an hour or so after sunset each day.
    const dusk = springDusk(ra.state.seasons, R.species.frog);
    assert(laid.every((e) => Math.abs(e.hour % HOURS_PER_DAY - dusk) <= 1), `laid at dusk (${laid.map((e) => e.hour % 24).join(', ')})`);
    eq(hashWorldState(ra.state.spring), hashWorldState(rb.state.spring), 'same seed, same spawn');
    const hab = a.model.habitat;
    for (const c of ra.state.spring.clumps) {
      const k = Math.floor(c.z + 80) * hab.n + Math.floor(c.x + 80);
      assert(hab.depthCm[k] >= 5 && hab.depthCm[k] <= 30, `clump ${c.id} in 5 to 30 cm (${hab.depthCm[k]})`);
    }
    return `${laid.length} clumps, first at hour ${laid[0].hour % 24}`;
  });

  test(G, 'no spawn from frogs that are not happy, nor in summer', async () => {
    const R = await loadEcologyRecipes();
    const w = happyFrogs(R, 11);
    const sad = { ...w.state, creatures: { ...w.state.creatures, frogs: { ...w.state.creatures.frogs, happy: false } } };
    eq(runSpring(sad, w.env, w.h0 + 1, 24 * 5).events.filter((e) => e.name === 'creature:spawned').length, 0, 'not happy: none');
    const s = islandWorld(R, 'starter-island', 11, 16);
    const summer = { ...s.state, creatures: { frogs: w.state.creatures.frogs } };
    eq(runSpring(summer, s.env, s.h0 + 1, 24 * 4).events.filter((e) => e.name === 'creature:spawned').length, 0, 'summer: none');
  });

  test(G, 'no spawn in the willow\'s shade', async () => {
    const R = await loadEcologyRecipes();
    const w = happyFrogs(R, 11);
    const hab = w.model.habitat, L = R.species.frogspawn.lay;
    const frogs = w.state.creatures.frogs.frogs;
    const open = warmShallows(hab, [], frogs, L);
    assert(open.length > 0, 'warm shallows near the frogs');
    const [x, z] = cellCenter(open[0], hab.n);
    const shaded = warmShallows(hab, [{ sp: 'willow', x, z, size: 1 }], frogs, L);
    assert(!shaded.includes(open[0]), 'the square under a willow is shaded');
    return `${open.length} warm squares, ${open.length - shaded.length} shaded by one willow`;
  });

  test(G, 'spawn hatches after four days; minnows close by thin the tadpoles; froglets leave in summer', async () => {
    const R = await loadEcologyRecipes();
    const w = happyFrogs(R, 11);
    const r1 = runSpring(w.state, w.env, w.h0 + 1, 24 * 6);
    const hatched = r1.events.filter((e) => e.name === 'creature:hatched');
    assert(hatched.length > 0, 'hatched within six days');
    const first = r1.events.find((e) => e.name === 'creature:spawned');
    const h1 = hatched.find((e) => e.payload.id === first?.payload.id);
    // At the dusk four days on (which may fall an hour later by then).
    if (h1 && first) assert(Math.abs(h1.hour - first.hour - 24 * R.species.frogspawn.hatch.days) <= 1, `four days on (${h1.hour - first.hour} hours)`);
    // The same days with a school of minnows living on the clumps.
    const c = r1.state.spring.clumps[0];
    const fish = { ...r1.state, creatures: { ...r1.state.creatures, minnows: { groups: [{ id: 1, k: 0, x: c.x, z: c.z, count: 20, mood: 1, low: 0, since: 0 }] } } };
    const day = w.h0 + 1 + 24 * 6;
    const lone = runSpring(r1.state, w.env, day, 24 * 4).state.spring.clumps.reduce((s, q) => s + q.tadpoles, 0);
    const eaten = runSpring(fish, w.env, day, 24 * 4).state.spring.clumps.reduce((s, q) => s + q.tadpoles, 0);
    assert(eaten < lone, `fewer tadpoles with minnows (${eaten} against ${lone})`);
    const field = tadpoleField(r1.state, w.model.habitat.n, R.species.frogspawn);
    assert(field && field.some((v) => v > 0), 'the tadpoles make a field for the minnows');
    // On into summer: froglets, then gone.
    const toSummer = 24 * 14 - (day - w.h0) + 24 * 3;
    const r2 = runSpring(r1.state, w.env, day, toSummer);
    assert(r2.events.some((e) => e.name === 'creature:froglets'), 'froglets in early summer');
    eq(r2.state.spring.clumps.length, 0, 'all gone by summer day 3');
    return `${hatched.length} hatched; ${lone} tadpoles alone, ${eaten} with minnows`;
  });

  test(G, 'drained water takes the clumps with it', async () => {
    const R = await loadEcologyRecipes();
    const w = happyFrogs(R, 11);
    const r = runSpring(w.state, w.env, w.h0 + 1, 24 * 5);
    assert(r.state.spring.clumps.length > 0, 'some clumps first');
    const hab = w.model.habitat;
    const dry = { ...hab, depthCm: new Uint16Array(hab.depthCm.length) };
    const env = { ...w.env, habitat: () => dry };
    const r2 = runSpring(r.state, env, w.h0 + 1 + 24 * 5, 1);
    eq(r2.state.spring.clumps.length, 0, 'none left');
    assert(r2.events.every((e) => e.name !== 'creature:gone' || e.payload.why === 'dry'), 'gone because it dried');
  });

  test(G, 'a toad walks from a stone near the pond to the water on a spring night, and only then', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 5, 3);
    const hab = w.model.habitat;
    // A stone 4 m from the pond's nearest water.
    let stone = null;
    for (let k = 0; k < hab.n * hab.n && !stone; k++) {
      if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0) continue;
      const [x, z] = cellCenter(k, hab.n);
      const p = nearestPond(hab, x, z, 6, 8);
      if (p && Math.hypot(p.x - x, p.z - z) > 3.5) stone = { x, z, kind: 'stone' };
    }
    assert(stone, 'a spot for a stone');
    const none = runSpring(w.state, w.env, w.h0 + 1, 24 * 8).events.filter((e) => e.name === 'creature:walking');
    eq(none.length, 0, 'no stone or log: no toad');
    const withStone = { ...w.state, basks: [stone] };
    const r = runSpring(withStone, w.env, w.h0 + 1, 24 * 8);
    const walks = r.events.filter((e) => e.name === 'creature:walking');
    assert(walks.length > 0, 'a toad walks on some night');
    assert(walks.every((e) => e.hour % 24 === R.species.toad.walk.startH), 'at night');
    // Follow one walk: it starts at the stone and ends by the water.
    const one = runSpring(withStone, w.env, w.h0 + 1, walks[0].hour - w.h0).state.spring.toad;
    const a = toadAt(one, one.startH), b = toadAt(one, one.endH);
    assert(a && Math.hypot(a.x - stone.x, a.z - stone.z) < 0.05, 'sets out from the stone');
    const pond = nearestPond(hab, b?.x ?? 0, b?.z ?? 0, 1.5, 1);
    assert(pond, 'ends at the water');
    eq(springSpots('toads', { spring: { toad: one } }).length, 1, 'Show me has a spot');
    return `${walks.length} walks in eight nights`;
  });

  test(G, 'the toad sets out from the damp under a log or stone when there is one (L3a)', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 5, 3);
    const hab = w.model.habitat, n = hab.n;
    // Two stones 3.5 m or more from the water, far apart: one damp underneath, one dry.
    /** @type {{ x: number, z: number, kind: string, k: number }[]} */ const spots = [];
    for (let k = 0; k < n * n && spots.length < 2; k++) {
      if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0) continue;
      const [x, z] = cellCenter(k, n);
      const p = nearestPond(hab, x, z, 6, 8);
      if (!p || Math.hypot(p.x - x, p.z - z) <= 3.5) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
      spots.push({ x, z, kind: 'stone', k });
    }
    assert(spots.length === 2, 'two spots for stones');
    const shelterUnder = new Uint8Array(n * n), dampUnder = new Uint8Array(n * n);
    for (const s of spots) shelterUnder[s.k] = 255;
    dampUnder[spots[1].k] = 240;
    const basks = spots.map(({ x, z, kind }) => ({ x, z, kind }));
    const state = { ...w.state, basks, ecology: { ...w.state.ecology, under: { shelterUnder, dampUnder } } };
    const walks = runSpring(state, w.env, w.h0 + 1, 24 * 10).events.filter((e) => e.name === 'creature:walking');
    assert(walks.length > 0, 'a toad walks');
    const fromDamp = (/** @type {any} */ e) => Math.hypot(e.payload.x - spots[1].x, e.payload.z - spots[1].z) < 0.05;
    eq(walks.filter(fromDamp).length, walks.length, 'every walk sets out from the damp stone');
    return `${walks.length} walks, all from the damp`;
  });

  test(G, 'turtles want a stone or log by the water: shelter only near one', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1, 15);
    const hab = w.model.habitat, n = hab.n, T = R.species.turtle;
    const without = needMaps(hab, w.state.growth, {}, T);
    let k0 = -1;
    for (let k = 0; k < n * n; k++) if (without.water[k] > 0.9) { k0 = k; break; }
    assert(k0 >= 0, 'water that suits turtles');
    const [x, z] = cellCenter(k0, n);
    const basks = baskField([{ x, z }], n);
    const withStone = needMaps(hab, w.state.growth, { basks }, T);
    assert(withStone.shelter[k0] > without.shelter[k0] + 0.3, `shelter by the stone ${withStone.shelter[k0].toFixed(2)} vs ${without.shelter[k0].toFixed(2)}`);
    assert(withStone.score[k0] > without.score[k0], 'a better home');
    eq(baskField([], n), null, 'no field without spots');
  });

  test(G, 'turtles sleep through spring and wake once the water warms in summer', async () => {
    const R = await loadEcologyRecipes();
    const spring = islandWorld(R, 'starter-island', 1, 6);
    const summer = islandWorld(R, 'starter-island', 1, 16);
    const s1 = runHour(spring.state, spring.h0 + 1, spring.env).state, s2 = runHour(summer.state, summer.h0 + 1, summer.env).state;
    eq(!!s1.seasons.dormant.turtles, true, 'spring: still asleep');
    eq(!!s2.seasons.dormant.turtles, false, 'summer: awake');
  });

  test(G, 'a named turtle gives the floating reed raft, once', async () => {
    const naturalist = await (await fetch('../recipes/world/naturalist.json')).json();
    const words = await (await fetch('../recipes/world/journal.json')).json();
    const R = await loadEcologyRecipes();
    const gifts = { turtles: R.species.turtle.ecology.gift };
    const g = due({ found: 0, flags: ['turtles:known'], earned: {}, rewards: [], gifts, words, giftWords: naturalist.gifts });
    eq(g.length, 1, 'gifts due');
    eq(JSON.stringify(g[0].give), JSON.stringify({ raft: true }), 'what it gives');
    eq(g[0].icon, 'raft', 'its icon');
    eq(due({ found: 0, flags: ['turtles:known'], earned: grant({}, g[0]), rewards: [], gifts, words, giftWords: naturalist.gifts }).length, 0, 'not twice');
  });
}
