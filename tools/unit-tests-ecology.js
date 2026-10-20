// @ts-check
// Ecology tests for tools/unit-tests.html (S6a, docs 11, 12): on the real starter island and Two
// ponds, built without the GPU (tools/ecology-world.js), frogs arrive through the arc within a few
// game days, the same way every time; a new world starts quiet; a bare bank holds no frogs; and a
// pond that fails sends them away one a day.

import { runHour, hashWorldState } from '../src/sim/tick.js';
import { frogNeeds, goodEdge } from '../src/world/ecology/habitat.js';
import { midgeTarget } from '../src/world/ecology/midges.js';
import { bringFrogs } from '../src/world/creatures/coarse.js';
import { pickSwarms, swarmShareNow, afterRainNow, orbit } from '../src/world/ecology/midge-paths.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';
import { initialJournal, observe, foundAnimal } from '../src/world/journal/observe.js';
import { describe } from '../src/world/journal/describe.js';
import { inkWeb } from '../src/world/journal/web.js';
import { shoreline } from './unit-tests-growth.js';

const ECOLOGY = 'ecology';

/** The recipes with rushes as a starter (on the islands they come by themselves). @param {any} R */
const withRushes = (R) => ({ ...R, growth: { ...R.growth, starters: [...R.growth.starters, 'rushes'] } });
const ARC = ['creature:habitat-right', 'creature:arrived', 'creature:settled', 'creature:joined', 'creature:left', 'creature:dormant', 'creature:woke', 'species:happy'];

/**
 * Run a world for some hours, keeping the arc's events.
 * @param {any} state @param {any} env @param {number} from first hour @param {number} hours
 */
function run(state, env, from, hours) {
  /** @type {{ hour: number, name: string, payload: any }[]} */ const events = [];
  for (let h = from; h < from + hours; h++) {
    const r = runHour(state, h, env);
    state = r.state;
    for (const e of r.events) if (ARC.includes(e.name)) events.push({ hour: h, name: e.name, payload: e.payload });
  }
  return { state, events };
}

/** "day 3, 19:00" @param {number} h */
const when = (h) => `day ${Math.floor(h / 24)}, ${h % 24}:00`;

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addEcologyTests(test, assert, eq) {
  test(ECOLOGY, 'a new starter island is quiet: no midges at first, no frogs and no signs for half a day', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    const r = run(w.state, w.env, w.h0 + 1, 12);
    eq(r.events.filter((e) => e.name !== 'creature:habitat-right').length, 0, 'arc events in the first 12 hours');
    eq(r.state.creatures.frogs.frogs.length, 0, 'frogs after 12 hours');
    const first = run(w.state, w.env, w.h0 + 1, 1).state.ecology.midges;
    const most = first.reduce((m, v) => Math.max(m, v), 0);
    assert(most <= 30, `midges reached ${most} of 255 in the first hour`);
    return `after 12 hours: ${r.state.creatures.frogs.phase}, the edge ${r.state.creatures.frogs.edge.metres} m good`;
  });

  test(ECOLOGY, 'the same seed gives the same frogs twice, and a run stopped and resumed lands in the same place', async () => {
    const R = await loadEcologyRecipes();
    const hours = 24 * 7;
    const a = islandWorld(R, 'starter-island', 7);
    const b = islandWorld(R, 'starter-island', 7);
    const ra = run(a.state, a.env, a.h0 + 1, hours), rb = run(b.state, b.env, b.h0 + 1, hours);
    eq(hashWorldState(ra.state), hashWorldState(rb.state), 'world hash of the two runs');
    // Stopped half way and saved (a deep copy, as a save would hold it), then resumed.
    const half = run(a.state, a.env, a.h0 + 1, hours / 2);
    const resumed = run(structuredClone(half.state), a.env, a.h0 + 1 + hours / 2, hours / 2);
    eq(hashWorldState(resumed.state), hashWorldState(ra.state), 'world hash after stopping and resuming');
    eq(ra.events.map((e) => `${e.hour}:${e.name}`).join(' '), rb.events.map((e) => `${e.hour}:${e.name}`).join(' '), 'the arc events');
    return `${ra.state.creatures.frogs.frogs.length} frogs after a week, hash ${(hashWorldState(ra.state) >>> 0).toString(16).toUpperCase()}`;
  });

  for (const island of ['starter-island', 'two-ponds']) {
    test(ECOLOGY, `frogs arrive within a few days on ${island}: a hint, a sign at dusk, settling, then more`, async () => {
      const R = await loadEcologyRecipes();
      const lines = [];
      for (const seed of [1, 2, 3]) {
        const w = islandWorld(R, island, seed);
        const r = run(w.state, w.env, w.h0 + 1, 24 * 8);
        const at = (/** @type {string} */ name) => r.events.find((e) => e.name === name)?.hour ?? -1;
        const right = at('creature:habitat-right'), sign = at('creature:arrived'), settled = at('creature:settled'), joined = at('creature:joined');
        assert(right >= 0 && right < 24, `seed ${seed}: the pond was right at ${when(right)}`);
        assert(sign > right && sign <= 24 * 5 + 23, `seed ${seed}: the sign came at ${when(sign)}`);
        // Frogs sleep until early spring; the sign comes at dusk once they are awake.
        const hour = sign % 24;
        assert(hour >= 18 && hour <= 22, `seed ${seed}: the sign came at ${hour}:00, not dusk`);
        assert(settled > sign, `seed ${seed}: settled at ${when(settled)}`);
        assert(joined > settled && joined - settled <= 30, `seed ${seed}: the second frog came at ${when(joined)}`);
        const fr = r.state.creatures.frogs;
        assert(fr.frogs.length >= 2 && fr.frogs.length <= fr.edge.capacity, `seed ${seed}: ${fr.frogs.length} frogs for room for ${fr.edge.capacity}`);
        // Every frog sits on a bank square, beside the water.
        const edge = new Set(r.state.ecology.frogs.edge.cells);
        for (const f of fr.frogs) assert(edge.has(f.k), `seed ${seed}: frog ${f.id} is not on the bank`);
        eq(r.events.filter((e) => e.name === 'creature:left').length, 0, `seed ${seed}: frogs that left a good pond`);
        lines.push(`seed ${seed}: sign ${when(sign)}, settled ${when(settled)}, ${fr.frogs.length} frogs by day 8 (room for ${fr.edge.capacity})`);
      }
      return lines.join('; ');
    });
  }

  test(ECOLOGY, 'a bare grassy bank holds no frogs; reeds along it make good edge', async () => {
    const R = await loadEcologyRecipes();
    const hab = shoreline();
    hab.grass.fill(255);
    const n = hab.n;
    const midges = new Uint8Array(n * n).fill(255);
    const growth = { plants: /** @type {any[]} */ ([]), grass: new Uint8Array(n * n).fill(255), cover: {} };
    const rec = R.species.frog;
    const bare = frogNeeds(hab, growth, midges, rec);
    const score = Uint8Array.from(bare.score, (v) => Math.floor(255 * v + 0.5));
    eq(goodEdge(bare.edge, score, rec.ecology).capacity, 0, 'frogs a bare bank holds');
    // Reeds every meter along the bank (column 40).
    for (let j = 0; j < n; j++) growth.plants.push({ id: j + 1, sp: 'reeds', x: HABITAT_ORIGIN + 40.5, z: HABITAT_ORIGIN + j + 0.5, size: 1 });
    const reedy = frogNeeds(hab, growth, midges, rec);
    const score2 = Uint8Array.from(reedy.score, (v) => Math.floor(255 * v + 0.5));
    const good = goodEdge(reedy.edge, score2, rec.ecology);
    assert(good.capacity >= 50, `a reedy bank of ${n} m holds only ${good.capacity} frogs`);
    return `bare bank: none; reedy bank: ${good.metres.toFixed(0)} m of good edge, room for ${good.capacity}`;
  });

  test(ECOLOGY, 'midges gather by the reeds over still water in summer, and hardly any in winter', async () => {
    // Rushes feed midges too; they come by themselves within a few days (growth.json volunteers),
    // so the island here has them from the start.
    const R = withRushes(await loadEcologyRecipes());
    const w = islandWorld(R, 'starter-island', 1);
    const F = R.species.midge.field;
    const summer = midgeTarget(w.model.habitat, w.state.growth, F, 1), winter = midgeTarget(w.model.habitat, w.state.growth, F, 3);
    const area = (/** @type {Uint8Array} */ m) => m.reduce((a, v) => a + (v >= 64 ? 1 : 0), 0);
    assert(area(summer) > 50, `only ${area(summer)} m2 of midges in summer`);
    eq(area(winter), 0, 'm2 of midges in winter');
    // None out over dry ground far from water.
    const hab = w.model.habitat;
    let far = 0;
    for (let k = 0; k < summer.length; k++) if (summer[k] && hab.moisture[k] === 0) far++;
    eq(far, 0, 'midge squares on dry ground');
    return `${area(summer)} m2 in summer, ${area(winter)} in winter`;
  });

  test(ECOLOGY, 'the journal tells the arc without naming frogs until you find one; then the page and the web ink', async () => {
    const R = await loadEcologyRecipes();
    const [words, web] = await Promise.all(['journal', 'journal-web'].map((p) => fetch(new URL(`../recipes/world/${p}.json`, import.meta.url)).then((r) => r.json())));
    const w = islandWorld(R, 'starter-island', 1);
    const hab = w.model.habitat;
    let state = w.state;
    let journal = observe(initialJournal(w.h0), { state, events: [], hour: w.h0, habitat: hab, words }).journal;
    /** @type {string[]} */ const texts = [];
    /** @type {string[]} */ const riddles = [];
    for (let h = w.h0 + 1; h < w.h0 + 24 * 6; h++) {
      const r = runHour(state, h, w.env);
      state = r.state;
      const o = observe(journal, { state, events: r.events, hour: h, habitat: hab, words });
      journal = inkWeb(o.journal, null, { web, words, state, hour: h }).journal;
      for (const n of o.notes) texts.push(n.text);
      const riddle = describe(journal, 'frogs', state, hab, words, h).riddle;
      if (riddles[riddles.length - 1] !== riddle) riddles.push(riddle);
    }
    const frogNotes = texts.filter((t) => /frog/i.test(t));
    eq(frogNotes.length, 0, `notes naming frogs before one was found (${frogNotes.join(' | ')})`);
    assert(texts.includes(words.species.frogs.notes.sign), 'the sign was noted');
    // Midges are drawn (S6b-5): known at the first dusk they gather, with the reeds link inked.
    assert(texts.includes(words.species.midges.notes.seen), 'midges were noted at dusk');
    assert(journal.flags.includes('midges:seen') && journal.flags.includes('web:reeds>midges'), 'the reeds-midges link is inked');
    eq(riddles.length, 3, `the frog page's pencil line: riddle, then two hints (${riddles.join(' | ')})`);
    eq(describe(journal, 'frogs', state, hab, words).known, false, 'frogs known before you find one');
    // You find one.
    const f = foundAnimal(journal, { state, hour: w.h0 + 24 * 6, words });
    journal = inkWeb(f.journal, null, { web, words, state, hour: w.h0 + 24 * 6 }).journal;
    eq(f.notes[0]?.text, words.species.frogs.notes.found, 'the note when you find one');
    const d = describe(journal, 'frogs', state, hab, words);
    assert(d.known && d.status && !/\d/.test(d.status), `status "${d.status}"`);
    const inked = web.links.filter((/** @type {any} */ l) => l.b === 'frogs' && journal.flags.includes(`web:${l.a}>${l.b}`)).map((/** @type {any} */ l) => l.a);
    assert(inked.length >= 2, `frog links inked: ${inked.join(', ')}`);
    const named = [...d.likes, ...d.field].filter((l) => l.known && /midge/i.test(l.text)).map((l) => l.text);
    eq(named.length, 0, `frog page lines naming midges (${named.join(' | ')})`);
    return `${d.status} Links inked: ${inked.join(', ')}.`;
  });

  test(ECOLOGY, 'midge swarms sit over the densest midges; many at dusk, few by day, almost none at night', async () => {
    // With rushes, which come by themselves within a few days (see the test above).
    const R = withRushes(await loadEcologyRecipes());
    const w = islandWorld(R, 'starter-island', 1);
    let st = w.state;
    for (let h = w.h0 + 1; h < w.h0 + 30; h++) st = runHour(st, h, w.env).state;
    const S = R.species.midge.swarm;
    const swarms = pickSwarms(st.ecology.midges, S);
    assert(swarms.length >= 3, `only ${swarms.length} swarms`);
    for (let i = 1; i < swarms.length; i++) assert(swarms[i].share <= swarms[i - 1].share, 'swarms out of order');
    for (const a of swarms) for (const b of swarms) if (a !== b) assert(Math.hypot(a.x - b.x, a.z - b.z) >= S.swarms.apartM, 'two swarms too close');
    eq(JSON.stringify(pickSwarms(st.ecology.midges, S)), JSON.stringify(swarms), 'the same swarms twice');
    // With the reeds: swarms hang over the reed clumps first, and the rest spread over the island
    // (in summer hundreds of squares are equally full; they used to pile into the grid's first rows).
    const reeds = st.growth.plants.filter((/** @type {any} */ p) => p.sp === 'reeds');
    const withReeds = pickSwarms(st.ecology.midges, S, reeds);
    const overReeds = withReeds.filter((s) => reeds.some((/** @type {any} */ p) => p.x === s.x && p.z === s.z)).length;
    assert(overReeds >= Math.min(3, S.swarms.overReeds), `only ${overReeds} swarms over the reeds`);
    eq(JSON.stringify(pickSwarms(st.ecology.midges, S, reeds)), JSON.stringify(withReeds), 'the same swarms over the reeds twice');
    const zs = swarms.map((s) => s.z);
    assert(Math.max(...zs) - Math.min(...zs) > 20, `swarms bunched in a band ${Math.min(...zs)} to ${Math.max(...zs)}`);
    const D = S.density;
    const dusk = swarmShareNow(19.5, 18, 12, 0, D), day = swarmShareNow(12, 18, 12, 0, D), night = swarmShareNow(2, 18, 12, 0, D);
    assert(dusk > day && day > night, `dusk ${dusk}, day ${day}, night ${night}`);
    assert(swarmShareNow(19.5, 18, 12, 1, D) < dusk, 'wind does not thin them');
    // Rain: drizzle thins them, a downpour clears them, the still hours after bring them out thicker.
    const drizzle = swarmShareNow(19.5, 18, 12, 0, D, 0.15), pour = swarmShareNow(19.5, 18, 12, 0, D, 0.5);
    assert(drizzle < dusk && drizzle > 0.3 * dusk, `drizzle ${drizzle.toFixed(2)} of ${dusk.toFixed(2)}`);
    eq(pour, 0, 'midges out in a downpour');
    const justAfter = afterRainNow((h) => (h >= 1 ? 0.5 : 0), D.rain), later = afterRainNow((h) => (h >= 2.5 ? 0.5 : 0), D.rain);
    assert(justAfter > later && later > 0, `after rain ${justAfter.toFixed(2)}, later ${later.toFixed(2)}`);
    eq(afterRainNow(() => 0.5, D.rain), 0, 'after rain while it rains');
    eq(afterRainNow(() => 0, D.rain), 0, 'after rain on a dry day');
    assert(swarmShareNow(19.5, 18, 12, 0, D, 0, justAfter) > dusk, 'no more midges after rain');
    // A midge's path stays within its loop and band, and the same time gives the same place.
    const o1 = orbit(swarms[0].seed, 7, 12.3, S), o2 = orbit(swarms[0].seed, 7, 12.3, S);
    eq(o1.join(','), o2.join(','), 'the same midge at the same time');
    assert(Math.hypot(o1[0], o1[2]) <= S.radiusM[1] * 1.36 + 1e-9 && o1[1] >= S.heightM[0] - 0.07 && o1[1] <= S.heightM[1] + 0.07, `a midge off its loop: ${o1.map((v) => v.toFixed(2))}`);
    return `${swarms.length} swarms, ${overReeds} over the reeds; share at dusk ${dusk.toFixed(2)}, day ${day.toFixed(2)}, night ${night.toFixed(2)}; drizzle ${drizzle.toFixed(2)}, downpour 0, just after rain ${swarmShareNow(19.5, 18, 12, 0, D, 0, justAfter).toFixed(2)}`;
  });

  test(ECOLOGY, 'the ?frogs test shortcut brings a scout, or a settled group, on the bank at once', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1, 6);
    const one = bringFrogs(w.state, w.h0, w.env, 1);
    eq(one.state.creatures.frogs.frogs.length, 1, 'frogs after ?frogs=1');
    eq(one.state.creatures.frogs.phase, 'visiting', 'phase after ?frogs=1');
    assert(one.events.some((e) => e.name === 'creature:arrived'), 'the sign event');
    const four = bringFrogs(w.state, w.h0, w.env, 4);
    eq(four.state.creatures.frogs.frogs.length, 4, 'frogs after ?frogs=4');
    eq(four.state.creatures.frogs.phase, 'settled', 'phase after ?frogs=4');
    const edge = new Set(four.state.ecology.frogs.edge.cells);
    for (const f of four.state.creatures.frogs.frogs) assert(edge.has(f.k), `frog ${f.id} is not on the bank`);
    eq(hashWorldState(bringFrogs(w.state, w.h0, w.env, 4).state), hashWorldState(four.state), 'the same frogs twice');
    // The scout then settles a day later through the hourly tick, as usual.
    const r = run(one.state, w.env, w.h0 + 1, 30);
    assert(r.events.some((e) => e.name === 'creature:settled'), 'the scout settled within 30 hours');
    return `one scout, or four settled frogs; the scout settled at ${when(r.events.find((e) => e.name === 'creature:settled')?.hour ?? -1)}`;
  });

  test(ECOLOGY, 'when the pond fails, frogs leave one a day, quietly, and none come back while it stays dry', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1);
    const settled = run(w.state, w.env, w.h0 + 1, 24 * 9);
    const before = settled.state.creatures.frogs.frogs.length;
    assert(before >= 3, `only ${before} frogs before the pond failed`);
    // Drain every pond and damp hollow.
    const h = w.model.habitat;
    const dry = { ...h, depthCm: new Uint8Array(h.depthCm.length), still: new Uint8Array(h.still.length), hash: h.hash ^ 1 };
    const env = { ...w.env, habitat: () => dry };
    const from = w.h0 + 1 + 24 * 9;
    const after = run(settled.state, env, from, 24 * (before + 3));
    const left = after.events.filter((e) => e.name === 'creature:left').map((e) => e.hour);
    eq(after.state.creatures.frogs.frogs.length, 0, 'frogs left at the dry pond');
    eq(left.length, before, 'frogs that moved on');
    for (let i = 1; i < left.length; i++) assert(left[i] - left[i - 1] >= 24, `two left ${left[i] - left[i - 1]} hours apart`);
    eq(after.events.filter((e) => e.name === 'creature:arrived' || e.name === 'creature:joined').length, 0, 'frogs that came to the dry pond');
    return `${before} frogs left one a day, the last on ${when(left[left.length - 1])}`;
  });
}
