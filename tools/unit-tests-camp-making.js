// @ts-check
// Making at camp (S1; docs/future/13 sections 3.12 and 6.5): the pencil outlines a station shows for
// what is laid, nothing taken until the action and then the pack before the piles, the cook section's
// cleaner and firsts, the camp page's order, the new bench slots clear of every other slot in both
// land recipes, and the walker's make motion as long as the make.

import { cleanCook, layout, drawPlan, available, recordMade, buildKinds, makesAt } from '../src/world/camp/making.js';
import { clean9, empty9 } from '../src/save/migrate-format9.js';
import { campFirsts, campPageHad } from '../src/ui/journal-camp.js';
import { gestureLength } from '../src/world/figure/acts.js';

const G = 'camp: making';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addCampMakingTests(test, assert, eq) {
  test(G, 'a stick and a flat stone show the shovel with a pencil coil; all three are complete; an extra part is not', async () => {
    const C = await load('world/cook'), s = cleanCook(null);
    eq(layout(C, 'workbench', [], s).make, null, 'nothing laid shows nothing');
    const two = layout(C, 'workbench', ['sticks', 'flat-stones'], s);
    eq(two.make, 'shovel', 'the shovel');
    eq(JSON.stringify(two.missing), JSON.stringify([['rush-cord']]), 'the cord is the pencil outline');
    assert(!two.complete, 'not complete yet');
    const all = layout(C, 'workbench', ['rush-cord', 'sticks', 'flat-stones'], s);
    assert(all.complete && !all.missing.length, 'complete in any order');
    const extra = layout(C, 'workbench', ['sticks', 'flat-stones', 'pebbles'], s);
    eq(extra.make, 'shovel', 'still points to the shovel');
    assert(!extra.complete && extra.extra.length === 1, 'but the pebbles make it incomplete');
    eq(layout(C, 'workbench', ['pebbles'], s).make, null, 'pebbles alone come to nothing');
    eq(layout(C, 'fire', ['sticks'], s).make, null, 'the fire knows no make in S1');
    const made = recordMade(s, 'shovel', 40, true);
    eq(layout(C, 'workbench', ['sticks', 'flat-stones'], made).make, null, 'a shovel made is not offered again (max 1)');
  });

  test(G, 'Make draws from the pack first, then the piles; short is nothing; laid parts count against what is left', () => {
    const plan = drawPlan(['sticks', 'flat-stones', 'flat-stones'], [{ id: 'pack', holds: { sticks: 1, 'flat-stones': 1 } }, { id: 'piles', holds: { 'flat-stones': 5 } }]);
    eq(JSON.stringify(plan?.map((p) => p.from)), JSON.stringify(['pack', 'pack', 'piles']), 'pack, pack, then the pile');
    eq(drawPlan(['clay'], [{ id: 'pack', holds: { sticks: 3 } }]), null, 'no clay anywhere: nothing');
    const a = available([{ holds: { sticks: 2 } }, { holds: { sticks: 3 } }], ['sticks', 'sticks']);
    eq(a.sticks, 3, 'two laid of five');
  });

  test(G, 'the cook section cleans, keeps unknown fields, keeps the first hour, and is the save\'s cook section', () => {
    const c = cleanCook({ version: 1, made: { shovel: 12, bad: 'x' }, count: { shovel: 1, no: -2 }, tools: ['shovel', 'shovel', 3], later: { x: 1 } });
    eq(JSON.stringify(c.made), JSON.stringify({ shovel: 12 }), 'made by hour');
    eq(JSON.stringify(c.count), JSON.stringify({ shovel: 1 }), 'counts');
    eq(JSON.stringify(c.tools), JSON.stringify(['shovel']), 'tools once each');
    eq(c.later?.x, 1, 'a later field is kept');
    eq(JSON.stringify(cleanCook(c)), JSON.stringify(c), 'cleaning twice changes nothing');
    const r = recordMade(recordMade(cleanCook(null), 'workbench', 5), 'workbench', 9);
    eq(r.made.workbench, 5, 'the first hour stays');
    eq(r.count.workbench, 2, 'counted twice');
    eq(JSON.stringify(clean9('cook', c)), JSON.stringify(c), 'format 9 cleans cook the same way');
    eq(JSON.stringify(empty9('cook')), JSON.stringify(cleanCook(null)), 'a new island starts with nothing made');
    eq(JSON.stringify(clean9('cook', { version: 1 })), JSON.stringify(cleanCook(null)), 'the reserved empty section reads as nothing made');
  });

  test(G, 'the workbench is built from two flat stones; the camp page lists the ring, then each first in order', async () => {
    const C = await load('world/cook');
    eq(JSON.stringify(buildKinds(C.builds.workbench)), JSON.stringify(['flat-stones', 'flat-stones']), 'two handfuls of flat stones');
    eq(makesAt(C, 'workbench').join(), 'rush-cord,shovel', 'the workbench knows rush cord (P2c) and the shovel');
    const camp = { slots: [{ slot: 'ring', kind: 'ring', placedHour: 3 }] };
    assert(!campPageHad({ slots: [] }, cleanCook(null)), 'no page before the ring');
    assert(campPageHad(camp, cleanCook(null)), 'the page once the ring is laid');
    const f = campFirsts(C, camp, { made: { shovel: 30, workbench: 20 } });
    eq(f.map((x) => x.id).join(), 'ring,workbench,shovel', 'oldest first');
    eq(f[2].parts.join(), 'sticks,flat-stones,rush-cord', 'the shovel drawn from its parts');
    for (const id of ['ring', 'workbench', 'shovel']) assert(C.words.pageNames[id] && C.words.pageParts[id], `${id} has its words`);
  });

  test(G, 'the bench and store slots sit on the pad, clear of every other slot, in both land recipes', async () => {
    for (const land of ['land/starter-island-2', 'land/starter-island']) {
      const slots = (await load(land)).camp.slots;
      const by = (/** @type {string} */ id) => slots.find((/** @type {any} */ s) => s.id === id);
      for (const id of ['workbench', 'apothecary', 'store']) assert(by(id), `${land}: ${id}`);
      eq(by('mortar').on, 'apothecary', `${land}: the mortar moved onto the apothecary bench`);
      /** A slot's footprint as a circle round its centre (half its diagonal for a box). @param {any} s */
      const rOf = (s) => s.r ?? Math.hypot(s.w ?? 0, s.d ?? 0) / 2;
      for (const id of ['workbench', 'apothecary', 'store']) {
        const s = by(id);
        assert(Math.hypot(s.u, s.v) + rOf(s) <= 3.75, `${land}: ${id} lies on the pad`);
        for (const q of slots) {
          if (q.id === id || q.on === id || !Number.isFinite(q.u) || q.id === 'hearth') continue;
          const d = Math.hypot(q.u - s.u, q.v - s.v);
          assert(d >= rOf(s) + rOf(q) - 0.15, `${land}: ${id} clear of ${q.id} (${d.toFixed(2)} m)`);
        }
      }
      // Where you stand to work at the workbench: out from its edge, away from the ring.
      const w = by('workbench'), r = by('ring'), l = Math.hypot(w.u - r.u, w.v - r.v);
      const camp = await load('world/camp'), out = w.d / 2 + camp.stations.standM;
      const su = w.u + ((w.u - r.u) / l) * out, sv = w.v + ((w.v - r.v) / l) * out;
      for (const q of slots) {
        if (q.id === 'workbench' || !Number.isFinite(q.u) || q.id === 'hearth') continue;
        assert(Math.hypot(q.u - su, q.v - sv) >= rOf(q) + 0.25, `${land}: you can stand at the workbench clear of ${q.id}`);
      }
    }
  });

  test(G, 'the walker works at the bench for the make: the make gesture is as long as the make', async () => {
    const PO = (await load('world/figure')).poses, C = await load('world/cook');
    const len = gestureLength(PO, 'make');
    assert(len > 2 && Math.abs(len - C.makeS) < 0.05, `make gesture ${len} s for a ${C.makeS} s make`);
  });
}
