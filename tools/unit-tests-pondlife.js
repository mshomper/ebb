// @ts-check
// Pond life tests for tools/unit-tests.html (M2: minnows and dragonflies, docs 11, 12): the shared
// needs reader gives the frogs exactly what they had before it, minnows want a pool with a deep spot,
// dragonflies want still water with perches near, and the species list and dormancy cover them.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { initialJournal, observe, foundAnimal } from '../src/world/journal/observe.js';
import { due, grant } from '../src/world/expansion.js';
import { createSchool } from '../src/world/creatures/school.js';
import { needMaps, waterBodies } from '../src/world/ecology/needs.js';
import { openBox } from '../src/world/ecology/fields.js';
import { seasonsAt } from '../src/world/seasons.js';
import { SECONDS_PER_HOUR, HOURS_PER_DAY } from '../src/core/clock.js';
import { keyOf, SPECIES, swarmSpecies } from '../src/world/species.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const G = 'pond life';

/** FNV-1a over text. @param {string} s */
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const join = (/** @type {ArrayLike<number>} */ a) => Array.from(a).join(',');

/**
 * The habitat with one square of the deepest pond dug to `cm` (a copy; the rest shared).
 * @param {any} hab @param {number} cm
 */
function dug(hab, cm) {
  const { bodies } = waterBodies(hab, openBox(hab, 1));
  const pond = bodies.slice().sort((a, b) => b.area - a.area)[0];
  const depthCm = hab.depthCm.slice();
  depthCm[pond.deepK] = cm;
  return { hab: { ...hab, depthCm }, pond };
}

/**
 * A new world whose big pond has one square dug to 1.1 m, as the frogs' Cut would.
 * @param {any} R @param {string} island @param {number} seed
 */
function dugWorld(R, island, seed) {
  const w = islandWorld(R, island, seed);
  const { hab } = dug(w.model.habitat, 110);
  w.env.habitat = () => hab;
  return w;
}

/**
 * Run a world for some hours, keeping the minnows' events.
 * @param {any} state @param {any} env @param {number} from @param {number} hours
 */
function runMinnows(state, env, from, hours) {
  /** @type {{ hour: number, name: string, payload: any }[]} */ const events = [];
  for (let h = from; h < from + hours; h++) {
    const r = runHour(state, h, env);
    state = r.state;
    for (const e of r.events) if (e.payload?.species === 'minnows') events.push({ hour: h, name: e.name, payload: e.payload });
  }
  return { state, events };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPondLifeTests(test, assert, eq) {
  test(G, 'the shared needs reader leaves the frogs exactly as they were (9 days on both islands)', async () => {
    const R = await loadEcologyRecipes();
    // Fingerprints taken on main before the needs reader existed (seed 7, nine days from 10:00).
    const before = {
      'starter-island': { eco: 552383584, frogs: 20518727, events: 1585692829 },
      'two-ponds': { eco: 3142424852, frogs: 37453754, events: 2368654099 },
    };
    const lines = [];
    for (const [island, want] of Object.entries(before)) {
      const w = islandWorld(R, island, 7);
      let s = w.state;
      /** @type {string[]} */ const ev = [];
      for (let h = w.h0; h < w.h0 + 24 * 9; h++) {
        const r = runHour(s, h, w.env);
        s = r.state;
        for (const e of r.events) if (e.name.startsWith('creature') || e.name.startsWith('species')) ev.push(h + e.name);
      }
      const F = s.ecology.frogs;
      eq(fnv(`${join(F.score)}|${join(F.water)}|${join(F.shelter)}|${F.edge.cells.join(',')}|${F.edge.faces.join(',')}`), want.eco, `${island}: frog habitat maps`);
      eq(fnv(JSON.stringify(s.creatures.frogs)), want.frogs, `${island}: the frogs`);
      eq(fnv(ev.join(';')), want.events, `${island}: the arc's events`);
      lines.push(`${island}: ${s.creatures.frogs.frogs.length} frogs, unchanged`);
    }
    return lines.join('; ');
  });

  test(G, 'minnows want a pool with a deep spot: none in the starter pond, one once a square is dug to 1.1 m', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    const hab = w.model.habitat, n = hab.n;
    const midges = new Uint8Array(n * n).fill(120);
    const before = needMaps(hab, w.state.growth, { midges }, R.species.minnow);
    eq(before.bodies.length, 0, 'pools that suit minnows in the starter pond');
    assert(before.score.every((v) => v === 0), 'no square scores for minnows before digging');
    const { hab: deep, pond } = dug(hab, 110);
    const after = needMaps(deep, w.state.growth, { midges }, R.species.minnow);
    eq(after.bodies.length, 1, 'pools after digging');
    const b = after.bodies[0];
    assert(b.area >= 20 && b.good >= 20, `the pool is ${b.area} m² with ${b.good} m² of good depth`);
    let inside = 0, outside = 0;
    for (let k = 0; k < n * n; k++) {
      if (after.score[k] <= 0) continue;
      if (after.label?.[k] === b.id) inside++; else outside++;
    }
    eq(outside, 0, 'squares scoring for minnows outside the pool');
    assert(inside > 0, 'squares scoring for minnows in the pool');
    return `starter pond deepest ${pond.deepCm} cm: no pool; dug to 110 cm: a ${b.area} m² pool, ${inside} squares score`;
  });

  test(G, 'dragonflies want still water with perches near: their score fades to nothing 10 m from the pond', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    const hab = w.model.habitat, n = hab.n;
    const midges = new Uint8Array(n * n).fill(255);
    const m = needMaps(hab, w.state.growth, { midges }, R.species.dragonfly);
    let best = 0, far = 0;
    for (let k = 0; k < n * n; k++) {
      best = Math.max(best, m.score[k]);
      if (m.water[k] === 0 && m.score[k] > 0) far++;
    }
    assert(best > 0.5, `the best square scores ${best.toFixed(2)}`);
    eq(far, 0, 'squares scoring with no still water within 10 m');
    // Without reeds, rushes or iris there are no perches: the score falls.
    const bare = needMaps(hab, { ...w.state.growth, plants: [], cover: {} }, { midges }, R.species.dragonfly);
    const bareBest = bare.score.reduce((a, v) => Math.max(a, v), 0);
    assert(bareBest < best * 0.5, `with no perches the best square scores ${bareBest.toFixed(2)}`);
    return `best ${best.toFixed(2)} with the starter reeds, ${bareBest.toFixed(2)} with none`;
  });

  test(G, 'dragonflies fly from late spring into autumn and are nymphs in the pond the rest of the year', async () => {
    const R = await loadEcologyRecipes();
    const at = (/** @type {number} */ season, /** @type {number} */ day) => seasonsAt(((season * 14 + day) * HOURS_PER_DAY + 12) * SECONDS_PER_HOUR, R.seasons).dormant.dragonflies;
    eq(at(0, 1), true, 'early spring');
    eq(at(0, 10), false, 'late spring');
    eq(at(1, 7), false, 'summer');
    eq(at(2, 4), false, 'early autumn');
    eq(at(2, 12), true, 'late autumn');
    eq(at(3, 7), true, 'winter');
  });

  test(G, 'minnows come to a dug pool: a sign in the morning, settled a day later, a growing school, happy within a week', async () => {
    const R = await loadEcologyRecipes();
    const lines = [];
    for (const seed of [1, 2, 3]) {
      const w = dugWorld(R, 'starter-island', seed);
      const r = runMinnows(w.state, w.env, w.h0 + 1, 24 * 7);
      const at = (/** @type {string} */ name) => r.events.find((e) => e.name === name)?.hour ?? -1;
      const right = at('creature:habitat-right'), sign = at('creature:arrived'), settled = at('creature:settled'), happy = at('species:happy');
      assert(right >= 0 && right < 24, `seed ${seed}: the pool was right at hour ${right}`);
      assert(sign > right && sign % 24 === R.species.minnow.ecology.arrival.comeAtH, `seed ${seed}: the sign came at hour ${sign}`);
      assert(settled > sign, `seed ${seed}: settled at ${settled}`);
      assert(happy > settled && happy < w.h0 + 24 * 7, `seed ${seed}: happy at ${happy}`);
      const M = r.state.creatures.minnows;
      const n = M.groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
      assert(n >= 8 && n <= R.species.minnow.ecology.needs.company.n[2], `seed ${seed}: ${n} minnows`);
      eq(r.state.creatures.frogs.frogs.length > 0, true, `seed ${seed}: frogs still come too`);
      lines.push(`seed ${seed}: sign day ${Math.floor(sign / 24) + 1}, happy day ${Math.floor(happy / 24) + 1}, ${n} minnows`);
    }
    return lines.join('; ');
  });

  test(G, 'the same seed gives the same minnows twice, and a run stopped and resumed lands in the same place', async () => {
    const R = await loadEcologyRecipes();
    const a = dugWorld(R, 'starter-island', 4), b = dugWorld(R, 'starter-island', 4);
    const hours = 24 * 6;
    const ra = runMinnows(a.state, a.env, a.h0 + 1, hours), rb = runMinnows(b.state, b.env, b.h0 + 1, hours);
    eq(hashWorldState(ra.state), hashWorldState(rb.state), 'world hash of the two runs');
    const half = runMinnows(a.state, a.env, a.h0 + 1, hours / 2);
    const resumed = runMinnows(structuredClone(half.state), a.env, a.h0 + 1 + hours / 2, hours / 2);
    eq(hashWorldState(resumed.state), hashWorldState(ra.state), 'world hash after stopping and resuming');
  });

  test(G, 'a drained pool sends its school away at once, quietly', async () => {
    const R = await loadEcologyRecipes();
    const w = dugWorld(R, 'starter-island', 1);
    const r = runMinnows(w.state, w.env, w.h0 + 1, 24 * 4);
    assert(r.state.creatures.minnows.groups.length === 1, 'a school before draining');
    // Drain: the pond's water is gone from the habitat.
    const hab = w.env.habitat();
    const dry = { ...hab, depthCm: new Uint8Array(hab.depthCm.length), still: new Uint8Array(hab.still.length) };
    const env2 = { ...w.env, habitat: () => dry };
    const after = runMinnows(r.state, env2, w.h0 + 1 + 24 * 4, 2);
    const left = after.events.filter((e) => e.name === 'creature:left');
    eq(left.length, 1, 'schools that moved on');
    eq(left[0].payload.count, 0, 'minnows left on the island');
    eq(after.state.creatures.minnows.phase, 'waiting', 'phase after they moved on');
  });

  test(G, 'the minnows page: a sign while unseen, inked when found, growth noted only as its word changes, the gift inks', async () => {
    const R = await loadEcologyRecipes();
    const words = await (await fetch('../recipes/world/journal.json')).json();
    const w = dugWorld(R, 'starter-island', 1);
    let j = initialJournal(w.h0);
    let s = w.state;
    /** @type {string[]} */ const texts = [];
    let foundAt = -1;
    for (let h = w.h0 + 1; h < w.h0 + 1 + 24 * 7; h++) {
      const r = runHour(s, h, w.env);
      s = r.state;
      const o = observe(j, { state: s, events: r.events, hour: h, words, habitat: w.env.habitat() });
      j = o.journal;
      for (const n of o.notes) if (n.sp === 'minnows') texts.push(n.text);
      // Found the morning after they settled.
      if (foundAt < 0 && s.creatures.minnows?.phase === 'settled' && h % 24 === 10) {
        foundAt = h;
        const f = foundAnimal(j, { state: s, hour: h, words }, 'minnows');
        j = f.journal;
        for (const n of f.notes) texts.push(n.text);
      }
    }
    const M = words.species.minnows;
    assert(texts.includes(M.notes.sign), 'the sign was written');
    assert(texts.indexOf(M.notes.sign) < texts.indexOf(M.notes.found), 'the sign came before finding them');
    assert(!texts.slice(0, texts.indexOf(M.notes.found)).some((t) => t.includes('minnow')), 'nothing named minnows before they were found');
    eq(j.species.minnows.ever, true, 'the page is inked');
    const grew = texts.filter((t) => t === M.notes.joined).length;
    assert(grew >= 1 && grew <= M.amount.length, `growth written ${grew} times`);
    assert(j.flags.includes('minnows:happy'), 'happy flag for the gives line and the gift');
    return `${texts.length} notes; growth written ${grew} times`;
  });

  test(G, 'happy minnows give pondweed seed, once', async () => {
    const naturalist = await (await fetch('../recipes/world/naturalist.json')).json();
    const words = await (await fetch('../recipes/world/journal.json')).json();
    const R = await loadEcologyRecipes();
    const gifts = { minnows: R.species.minnow.ecology.gift };
    const g = due({ found: 0, flags: ['minnows:happy'], earned: {}, rewards: [], gifts, words, giftWords: naturalist.gifts });
    eq(g.length, 1, 'gifts due');
    eq(JSON.stringify(g[0].give), JSON.stringify({ seeds: { pondweed: true } }), 'what it gives');
    eq(due({ found: 0, flags: ['minnows:happy'], earned: grant({}, g[0]), rewards: [], gifts, words, giftWords: naturalist.gifts }).length, 0, 'gifts due after it was given');
  });

  test(G, 'a live school stays in the water, between the bed and the surface, and moves the same way twice', async () => {
    const M = (await (await fetch('../recipes/species/minnow.json')).json()).motion;
    // A round pond 4 m across, 1 m deep in the middle, its surface at 0.
    const water = (/** @type {number} */ x, /** @type {number} */ z) => { const r2 = (x * x + z * z) / 4; return { surface: 0, depth: Math.max(0, 1 - r2) }; };
    const make = () => createSchool({ id: 1, seed: 7, count: 20, home: { x: 0.5, z: 0 }, deep: { x: 0, z: 0 }, size: 1.5, M, env: { water } });
    const a = make(), b = make();
    let worst = 0, rings = 0;
    const c = createSchool({ id: 1, seed: 7, count: 20, home: { x: 0.5, z: 0 }, deep: { x: 0, z: 0 }, size: 1.5, M, env: { water, ring: () => { rings++; } } });
    for (let i = 0; i < 30 * 60; i++) {
      a.step(1 / 30); b.step(1 / 30); c.step(1 / 30);
      for (const f of a.fish) {
        const w = water(f.x, f.z);
        assert(w.depth >= M.minDepthM * 0.5 - 1e-9, `a fish at depth ${w.depth.toFixed(3)} m`);
        assert(f.y <= w.surface && f.y >= w.surface - w.depth, `a fish out of the water (y ${f.y.toFixed(3)})`);
        worst = Math.max(worst, Math.hypot(f.x, f.z));
      }
    }
    eq(a.fish.map((f) => f.x.toFixed(6)).join(), b.fish.map((f) => f.x.toFixed(6)).join(), 'the same seed, the same school');
    assert(rings >= 2, `rises that rang the water in a minute: ${rings}`);
    // A startle sends them to the deep spot, faster than they cruise.
    const d = createSchool({ id: 2, seed: 7, count: 12, home: { x: 1.2, z: 0 }, deep: { x: -0.9, z: 0 }, size: 1.5, M, env: { water } });
    for (let i = 0; i < 30 * 5; i++) d.step(1 / 30);
    d.startle();
    let fast = 0;
    for (let i = 0; i < 30 * 4; i++) { d.step(1 / 30); fast += d.fish.reduce((s, f) => s + Math.hypot(f.vx, f.vz), 0) / d.fish.length; }
    fast /= 30 * 4;
    const c2 = d.centre();
    assert(Math.hypot(c2.x + 0.9, c2.z) < 0.8, `the startled school is ${Math.hypot(c2.x + 0.9, c2.z).toFixed(2)} m from the deep spot`);
    assert(fast > 2 * M.cruiseMps, `darting at ${fast.toFixed(2)} m/s`);
    return `a minute of swimming, farthest fish ${worst.toFixed(2)} m from the middle, ${rings} rises`;
  });

  test(G, 'the species list knows every recipe by its world key', async () => {
    const R = await loadEcologyRecipes();
    eq(SPECIES.map((id) => keyOf(R.species[id])).join(), 'frogs,midges,minnows,dragonflies', 'keys');
    eq(swarmSpecies(R.species).map((r) => r.id).join(), 'minnow,dragonfly', 'schools and swarms with needs');
  });
}
