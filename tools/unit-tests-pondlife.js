// @ts-check
// Pond life tests for tools/unit-tests.html (M2: minnows and dragonflies, docs 11, 12): the shared
// needs reader gives the frogs exactly what they had before it, minnows want a pool with a deep spot,
// dragonflies want still water with perches near, and the species list and dormancy cover them.

import { runHour } from '../src/sim/tick.js';
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

  test(G, 'the species list knows every recipe by its world key', async () => {
    const R = await loadEcologyRecipes();
    eq(SPECIES.map((id) => keyOf(R.species[id])).join(), 'frogs,midges,minnows,dragonflies', 'keys');
    eq(swarmSpecies(R.species).map((r) => r.id).join(), 'minnow,dragonfly', 'schools and swarms with needs');
  });
}
