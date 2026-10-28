// @ts-check
// Pond life tests for tools/unit-tests.html (M2: minnows and dragonflies, docs 11, 12): the shared
// needs reader gives the frogs exactly what they had before it, minnows want a pool with a deep spot,
// dragonflies want still water with perches near, and the species list and dormancy cover them.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { initialJournal, observe, foundAnimal } from '../src/world/journal/observe.js';
import { due, grant } from '../src/world/expansion.js';
import { createSchool } from '../src/world/creatures/school.js';
import { createPatrol } from '../src/world/creatures/patrol.js';
import { tapRay } from '../src/world/creatures/schools.js';
import { roomOf, applySwarmTrust, addSwarmEvent } from '../src/world/creatures/swarms.js';
import { suitability } from '../src/world/growth/coarse.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { needMaps, waterBodies } from '../src/world/ecology/needs.js';
import { openBox } from '../src/world/ecology/fields.js';
import { seasonsAt } from '../src/world/seasons.js';
import { SECONDS_PER_HOUR, HOURS_PER_DAY } from '../src/core/clock.js';
import { keyOf, SPECIES, swarmSpecies } from '../src/world/species.js';
import { loadEcologyRecipes, islandWorld, digPond } from './ecology-world.js';

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
  return runSpecies(state, env, from, hours, 'minnows');
}

/**
 * Run a world for some hours, keeping one species' events.
 * @param {any} state @param {any} env @param {number} from @param {number} hours @param {string} key
 */
function runSpecies(state, env, from, hours, key) {
  /** @type {{ hour: number, name: string, payload: any }[]} */ const events = [];
  for (let h = from; h < from + hours; h++) {
    const r = runHour(state, h, env);
    state = r.state;
    for (const e of r.events) if (e.payload?.species === key) events.push({ hour: h, name: e.name, payload: e.payload });
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
    // Fingerprints taken on main before the needs reader existed (seed 7, nine days from 10:00);
    // re-pinned October 21, 2026 when plants began to change stage on their own days (doc 10
    // phenology jitter: reeds and iris give shelter), with the same number of frogs and events.
    // Re-pinned October 24, 2026 (P2b): water mint now arrives after iris and stands at the pond's
    // edge within the nine days; the frogs' events are unchanged.
    const before = {
      'starter-island': { eco: 3533890342, frogs: 1092847199, events: 1585692829 },
      'two-ponds': { eco: 2984250628, frogs: 558216916, events: 2368654099 },
    };
    const lines = [];
    for (const [island, want] of Object.entries(before)) {
      const w = islandWorld(R, island, 7);
      let s = w.state;
      /** @type {string[]} */ const ev = [];
      for (let h = w.h0; h < w.h0 + 24 * 9; h++) {
        const r = runHour(s, h, w.env);
        s = r.state;
        // The frogs' events (before minnows and dragonflies, every creature event was a frog's).
        for (const e of r.events) if ((e.name.startsWith('creature') || e.name.startsWith('species')) && e.payload?.species === 'frogs') ev.push(h + e.name);
      }
      const F = s.ecology.frogs;
      const got = {
        eco: fnv(`${join(F.score)}|${join(F.water)}|${join(F.shelter)}|${F.edge.cells.join(',')}|${F.edge.faces.join(',')}`),
        frogs: fnv(JSON.stringify(s.creatures.frogs)),
        events: fnv(ev.join(';')),
      };
      // Every fingerprint at once, so a deliberate change can be re-pinned in one run.
      if (got.eco !== want.eco || got.frogs !== want.frogs || got.events !== want.events) {
        throw new Error(`${island}: fingerprints changed, now { eco: ${got.eco}, frogs: ${got.frogs}, events: ${got.events} } (${s.creatures.frogs.frogs.length} frogs, ${ev.length} events)`);
      }
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

  test(G, 'dragonflies wait for warm water: they fly from the start of summer into autumn and are nymphs the rest of the year', async () => {
    const R = await loadEcologyRecipes();
    const at = (/** @type {number} */ season, /** @type {number} */ day) => seasonsAt(((season * 14 + day) * HOURS_PER_DAY + 12) * SECONDS_PER_HOUR, R.seasons).dormant.dragonflies;
    eq(at(0, 1), true, 'early spring');
    eq(at(0, 12), true, 'late spring');
    eq(at(1, 0), false, 'the first day of summer');
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

  test(G, 'minnows that know you give pondweed seed, once', async () => {
    const naturalist = await (await fetch('../recipes/world/naturalist.json')).json();
    const words = await (await fetch('../recipes/world/journal.json')).json();
    const R = await loadEcologyRecipes();
    const gifts = { minnows: R.species.minnow.ecology.gift };
    const g = due({ found: 0, flags: ['minnows:known'], earned: {}, rewards: [], gifts, words, giftWords: naturalist.gifts });
    eq(g.length, 1, 'gifts due');
    eq(JSON.stringify(g[0].give), JSON.stringify({ seeds: { pondweed: true } }), 'what it gives');
    eq(due({ found: 0, flags: ['minnows:known'], earned: grant({}, g[0]), rewards: [], gifts, words, giftWords: naturalist.gifts }).length, 0, 'gifts due after it was given');
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

  test(G, 'pondweed grows under still water, never on land, and never comes by itself', async () => {
    const R = await loadEcologyRecipes();
    const rec = R.flora.pondweed;
    assert(rec, 'pondweed is a flora recipe the growth step loads');
    assert(!R.growth.starters.includes('pondweed') && !R.growth.volunteers.order.includes('pondweed'), 'not a starter or a volunteer');
    const w = islandWorld(R, 'starter-island', 1);
    const hab = w.model.habitat, n = hab.n;
    let deepBest = 0, landBest = 0;
    for (let k = 0; k < n * n; k++) {
      if (!hab.open[k] || hab.sea[k]) continue;
      const x = HABITAT_ORIGIN + (k % n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / n) + 0.5;
      const s = suitability(rec, hab, x, z).suit;
      if (hab.depthCm[k] >= 50) deepBest = Math.max(deepBest, s);
      if (hab.depthCm[k] === 0 && !hab.still[k]) landBest = Math.max(landBest, s);
    }
    assert(deepBest >= 0.9, `the best still water half a meter deep or more suits it ${deepBest.toFixed(2)}`);
    assert(landBest < 0.05, `dry land suits it ${landBest.toFixed(2)}`);
  });

  test(G, 'pondweed in a pool feeds and shelters minnows and holds more of them', async () => {
    const R = await loadEcologyRecipes();
    const rec = R.species.minnow;
    const pool = { room: 60, weed: 0 };
    const bare = roomOf(pool, rec), weedy = roomOf({ ...pool, weed: 8 }, rec);
    assert(weedy > bare, `a small pool holds ${bare}, with pondweed ${weedy}`);
    const big = roomOf({ room: 400, weed: 0 }, rec), bigWeedy = roomOf({ room: 400, weed: 8 }, rec);
    assert(bigWeedy > big && bigWeedy <= rec.ecology.needs.company.n[2] + rec.ecology.arrival.weedExtra, `a big pool holds ${big}, with pondweed ${bigWeedy}`);
    // Its needs: food and shelter rise beside pondweed.
    const w = dugWorld(R, 'starter-island', 1);
    const hab = w.env.habitat(), n = hab.n;
    const midges = new Uint8Array(n * n);
    const before = needMaps(hab, w.state.growth, { midges }, rec);
    const k = before.bodies[0].deepK;
    const x = HABITAT_ORIGIN + (k % n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / n) + 0.5;
    const growth = { ...w.state.growth, plants: [...w.state.growth.plants, { sp: 'pondweed', x, z, size: 1, stage: 3 }] };
    const after = needMaps(hab, growth, { midges }, rec);
    assert(after.food[k] > before.food[k], `food at the deep spot ${before.food[k].toFixed(2)} to ${after.food[k].toFixed(2)}`);
    assert(after.shelter[k] >= before.shelter[k], 'shelter at the deep spot');
    return `room ${bare} to ${weedy} (small pool), ${big} to ${bigWeedy} (big pool)`;
  });

  test(G, 'no starting pond is one the dragonflies take: none come to either island as it starts', async () => {
    const R = await loadEcologyRecipes();
    const lines = [];
    for (const island of ['starter-island', 'two-ponds']) {
      const w = islandWorld(R, island, 1);
      const r = runSpecies(w.state, w.env, w.h0 + 1, 24 * 28, 'dragonflies');
      eq(r.events.filter((e) => e.name !== 'creature:dormant' && e.name !== 'creature:woke').length, 0, `${island}: dragonfly events in 28 days (into summer)`);
      const pools = r.state.ecology.dragonflies.pools;
      assert(pools.length > 0 && pools.every((/** @type {any} */ p) => !p.fit && p.margin === 0), `${island}: ${pools.length} ponds, none of them shaped`);
      lines.push(`${island}: ${pools.length} ponds, none fit`);
    }
    return lines.join('; ');
  });

  test(G, 'a pond the player dug, with no fish and reeds grown in, is one they take; minnows moving in send them away', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    const p = digPond(w);
    assert(p, 'room for a second pond');
    const r = runSpecies(w.state, w.env, w.h0 + 1, 24 * 24, 'dragonflies');
    const pool = r.state.ecology.dragonflies.pools.find((/** @type {any} */ q) => q.fit);
    assert(pool, 'the dug pond fits');
    assert(r.events.some((e) => e.name === 'creature:arrived'), 'a pair came');
    const D = r.state.creatures.dragonflies;
    assert(D.groups.length === 1, 'a group on the dug pond');
    // Later the player digs one square of it on to 1.1 m (it stays mostly shallow), and a school of
    // minnows settles there: the dragonflies thin out and move on.
    const h0 = w.env.habitat();
    const depthCm = h0.depthCm.slice();
    depthCm[(p.j + 2) * h0.n + p.i + 3] = 110;
    const deeper = { ...h0, depthCm };
    const env2 = { ...w.env, habitat: () => deeper };
    const g = D.groups[0];
    const fish = { ...r.state, creatures: { ...r.state.creatures, minnows: { phase: 'settled', groups: [{ id: 1, k: g.k, x: g.x, z: g.z, count: 10, mood: 1, low: 0, since: 0 }] } } };
    const after = runSpecies(fish, env2, w.h0 + 1 + 24 * 24, 24 * 6, 'dragonflies');
    const fitNow = after.state.ecology.dragonflies.pools.find((/** @type {any} */ q) => q.id === pool.id || q.best === pool.best);
    eq(fitNow?.fish, true, 'the pond has fish');
    eq(after.state.creatures.dragonflies.groups.length, 0, 'dragonflies left on the pond');
    assert(after.events.some((e) => e.name === 'creature:left'), 'they moved on');
    const leftH = after.events.filter((e) => e.name === 'creature:left').pop()?.hour ?? 0;
    return `the dug pond: ${pool.area} m², ${pool.margin} m² of shaped margin with reeds; gone ${((leftH - (w.h0 + 1 + 24 * 24)) / 24).toFixed(1)} days after the minnows came`;
  });

  test(G, 'dragonflies come to a pond you dug once summer comes: a pair in the late morning, then more, happy within days', async () => {
    const R = await loadEcologyRecipes();
    const A = R.species.dragonfly.ecology.arrival;
    const lines = [];
    for (const seed of [1, 2, 3]) {
      const w = islandWorld(R, 'starter-island', seed);
      digPond(w);
      const r = runSpecies(w.state, w.env, w.h0 + 1, 24 * 24, 'dragonflies');
      const at = (/** @type {string} */ name) => r.events.find((e) => e.name === name)?.hour ?? -1;
      const sign = at('creature:arrived'), happy = at('species:happy');
      // They wait for warm water: they fly from the start of summer (day 14).
      assert(sign >= 24 * 14 && sign % 24 === A.comeAtH, `seed ${seed}: the sign came at hour ${sign}`);
      assert(happy > sign, `seed ${seed}: happy at hour ${happy}`);
      lines.push(`seed ${seed}: sign day ${Math.floor(sign / 24) + 1}, happy day ${Math.floor(happy / 24) + 1}`);
    }
    return lines.join('; ');
  });

  test(G, 'in autumn the dragonflies go, and nothing comes or goes while they are nymphs', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    digPond(w);
    // A run through the summer into winter (day 1 to day 46).
    const r = runSpecies(w.state, w.env, w.h0 + 1, 24 * 45, 'dragonflies');
    const dormant = r.events.find((e) => e.name === 'creature:dormant');
    assert(dormant, 'they went dormant');
    const after = r.events.filter((e) => e.hour > /** @type {any} */ (dormant).hour && e.name !== 'creature:dormant');
    eq(after.length, 0, 'events while they are nymphs');
    eq(r.state.creatures.dragonflies.dormant, true, 'dormant in winter');
    return `dormant from day ${Math.floor(/** @type {any} */ (dormant).hour / 24) + 1}`;
  });

  test(G, 'dragonflies that know you give springs, with their own card', async () => {
    const naturalist = await (await fetch('../recipes/world/naturalist.json')).json();
    const words = await (await fetch('../recipes/world/journal.json')).json();
    const R = await loadEcologyRecipes();
    const g = due({ found: 0, flags: ['dragonflies:known'], earned: {}, rewards: [], gifts: { dragonflies: R.species.dragonfly.ecology.gift }, words, giftWords: naturalist.gifts });
    eq(g.length, 1, 'gifts due');
    eq(JSON.stringify(g[0].give), JSON.stringify({ springs: true }), 'what it gives');
    eq(g[0].icon, 'wellspring', 'its icon');
    eq(g[0].title, 'A gift from the dragonflies', 'its title');
    assert(g[0].line.includes('Spring'), 'it says where to find it');
  });

  test(G, 'dragonflies patrol a beat: they hover, dart and rest on reeds, roost at night, and rise when startled', async () => {
    const M = (await (await fetch('../recipes/species/dragonfly.json')).json()).motion;
    // A round pond 6 m across with its surface at 0, flat ground at 0.1 around it, and two reed clumps.
    const water = (/** @type {number} */ x, /** @type {number} */ z) => { const r2 = (x * x + z * z) / 9; return { surface: 0, depth: Math.max(0, 0.8 * (1 - r2)) }; };
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => (x * x + z * z < 9 ? -water(x, z).depth : 0.1);
    const perches = () => [{ x: 3.2, z: 0, h: 1.4 }, { x: 0, z: -3.3, h: 1.2 }];
    const make = () => createPatrol({ id: 1, seed: 3, count: 4, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: 1.5, M, env: { water, ground, perches } });
    const a = make(), b = make();
    /** @type {Record<string, number>} */ const seen = { hover: 0, dart: 0, perch: 0, flee: 0 };
    let low = 0;
    for (let i = 0; i < 30 * 120; i++) {
      a.step(1 / 30); b.step(1 / 30);
      for (const f of a.fish) {
        seen[f.mode]++;
        const floorY = water(f.x, f.z).depth > 0.01 ? 0 : ground(f.x, f.z);
        if (f.mode !== 'perch' && f.y < floorY + M.clearM - 1e-6) low++;
      }
    }
    eq(low, 0, 'steps a flying dragonfly was below its clearance');
    assert(seen.hover > 0 && seen.dart > 0, `hover ${seen.hover}, dart ${seen.dart} steps`);
    assert(seen.perch > 0, `perched ${seen.perch} steps in two minutes`);
    eq(a.fish.map((f) => f.x.toFixed(5)).join(), b.fish.map((f) => f.x.toFixed(5)).join(), 'the same seed, the same beat');
    // At night every one heads for a reed and rests there.
    a.setMood('night');
    for (let i = 0; i < 30 * 40; i++) a.step(1 / 30);
    assert(a.fish.every((f) => f.mode === 'perch'), `at night: ${a.fish.map((f) => f.mode).join(', ')}`);
    // A startle by day sends them up.
    b.startle();
    const y0 = b.centre().y;
    for (let i = 0; i < 30 * 2; i++) b.step(1 / 30);
    assert(b.centre().y > y0, `startled: up from ${y0.toFixed(2)} to ${b.centre().y.toFixed(2)} m`);
    return `two minutes: hover ${seen.hover}, dart ${seen.dart}, perch ${seen.perch} fly-steps`;
  });

  test(G, 'trust for a school: quiet watching and meals earn it in the tick, never past the ceiling', async () => {
    const R = await loadEcologyRecipes();
    const P = R.species.minnow.presence, D = R.species.dragonfly.presence;
    // Fifty minutes (P2h's slower pace, recipes/species/minnow.json) and two meals reach Tolerant.
    const S = { groups: [{ id: 1, count: 10 }], pending: [{ kind: 'watched', minutes: 50, hour: 5 }, { kind: 'fed', hour: 5 }, { kind: 'fed', hour: 6 }] };
    const ev = applySwarmTrust(S, P, 'minnows');
    assert(/** @type {any} */ (S).trust > 0.2, `trust after fifty minutes and two meals: ${/** @type {any} */ (S).trust}`);
    eq(ev.filter((e) => e.name === 'creature:ate').length, 2, 'meals told');
    eq(ev.find((e) => e.name === 'creature:trusted')?.payload.word, 'tolerant', 'the word it moved up to');
    eq(/** @type {any} */ (S).pending, undefined, 'pending cleared');
    // Dragonflies stop at Curious, however long you watch.
    const F = { groups: [{ id: 1, count: 4 }], pending: [{ kind: 'watched', minutes: 600, hour: 5 }] };
    applySwarmTrust(F, D, 'dragonflies');
    assert(/** @type {any} */ (F).trust < D.bands[2] && /** @type {any} */ (F).trust >= D.bands[1], `dragonflies' trust ${/** @type {any} */ (F).trust} stays Curious`);
    // Recorded in live play on the world, not on the previous hour's state.
    const state = { creatures: { minnows: { groups: [{ id: 1, count: 3 }] } } };
    const next = addSwarmEvent(state, 'minnows', { kind: 'fed', hour: 3 });
    eq(/** @type {any} */ (state.creatures.minnows).pending, undefined, 'the old state is untouched');
    eq(next.creatures.minnows.pending.length, 1, 'the event is on the new state');
  });

  test(G, 'crumbs on the water bring the school swirling up to them', async () => {
    const M = (await (await fetch('../recipes/species/minnow.json')).json()).motion;
    const water = (/** @type {number} */ x, /** @type {number} */ z) => ({ surface: 0, depth: Math.max(0, 1 - (x * x + z * z) / 4) });
    const s = createSchool({ id: 1, seed: 9, count: 15, home: { x: -0.8, z: 0 }, deep: { x: 0, z: 0 }, size: 1.5, M, env: { water } });
    for (let i = 0; i < 30 * 3; i++) s.step(1 / 30);
    const food = { x: 0.9, z: 0.4 };
    s.feed(food);
    for (let i = 0; i < 30 * 6; i++) s.step(1 / 30);
    const c = s.centre();
    assert(Math.hypot(c.x - food.x, c.z - food.z) < 0.6, `the school is ${Math.hypot(c.x - food.x, c.z - food.z).toFixed(2)} m from the crumbs`);
    assert(c.y > -0.1, `and up near the surface (${c.y.toFixed(2)} m)`);
    assert(s.feeding, 'still swirling');
  });

  test(G, 'a tap finds a dragonfly a meter up along the line from the eye, not by the ground under it', async () => {
    const F = (await (await fetch('../recipes/species/dragonfly.json')).json()).find;
    // The eye 3 m up, 4 m back; a dragonfly 1 m over the water at the origin; the tap's line runs
    // through it and on to the ground 2 m behind it.
    const eye = [0, 3, -4], fly = { x: 0, y: 1, z: 0 };
    const ray = tapRay(eye, [0, 0, 2]);
    const { d, far } = ray(fly);
    assert(d < F.tapM + F.tapPerM * far, `the dragonfly is ${d.toFixed(2)} m from the tap's line`);
    // The ground point under the old test was 2 m from it: missed.
    assert(Math.hypot(fly.x - 0, fly.z - 2) > F.tapM + F.tapPerM * 5, 'the ground point alone misses it');
    // A tap two meters to the side still misses (1.2 m before the dragonflies were drawn 2.5x, October 21, 2026).
    assert(tapRay(eye, [2, 0, 2])(fly).d > F.tapM + F.tapPerM * far, 'a tap well to the side misses');
  });

  test(G, 'the species list knows every recipe by its world key', async () => {
    const R = await loadEcologyRecipes();
    eq(SPECIES.map((id) => keyOf(R.species[id])).join(), 'frogs,midges,minnows,dragonflies,damselflies,turtles,frogspawn,toads,slowworms,lizards', 'keys');
    eq(swarmSpecies(R.species).map((r) => r.id).join(), 'minnow,dragonfly,damselfly,turtle', 'schools and swarms with needs');
  });
}
