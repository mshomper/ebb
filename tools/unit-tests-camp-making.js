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
    eq(makesAt(C, 'workbench').join(), 'rush-cord,shovel,rack,mortar,hamper,hamper2,hearth-stones,cooking-pot,tea-pot,cup,bowl,leaf-pack',
      'the workbench knows rush cord, the shovel (P2c), the rack and mortar (S2), the hampers (P2j), the hearth stones and the clay pieces (S4, S5) and the leaf pack (P2h)');
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

  test(G, 'S2: the rack and mortar wait for the apothecary bench; Dry takes any herb once the rack stands; Grind turns shells to crushed shell', async () => {
    const C = await load('world/cook'), s = cleanCook(null);
    /** @param {string[]} built */
    const ctx = (built) => ({ filled: (/** @type {string} */ id) => built.includes(id), groupOf: (/** @type {string} */ k) => (k.endsWith('.leaves') || k.endsWith('.flowers') ? 'herbs' : 'other') });
    eq(layout(C, 'workbench', ['flat-stones', 'pebbles'], s, ctx([])).make, 'shovel', 'no mortar before the bench: a flat stone points to the shovel');
    const m = layout(C, 'workbench', ['flat-stones', 'pebbles'], s, ctx(['apothecary']));
    assert(m.make === 'mortar' && m.complete, 'a flat stone and a pebble make the mortar once the bench stands');
    const r = layout(C, 'workbench', ['willow.withies', 'sticks'], s, ctx(['apothecary']));
    eq(r.make, 'rack', 'withies and a stick point to the rack');
    eq(JSON.stringify(r.missing), JSON.stringify([['rush-cord']]), 'cord in pencil');
    // Sticks and cord: the shovel wins a tie (the lower tier); a second stick makes it the rack.
    eq(layout(C, 'workbench', ['sticks', 'rush-cord'], s, ctx(['apothecary'])).make, 'shovel', 'a stick and cord show the shovel first');
    assert(layout(C, 'workbench', ['sticks', 'rush-cord', 'sticks'], s, ctx(['apothecary'])).complete, 'two sticks and cord are the rack');
    eq(layout(C, 'apothecary', ['watermint.leaves'], s, ctx(['apothecary'])).make, null, 'Dry waits for the rack');
    const d = layout(C, 'apothecary', ['watermint.leaves'], s, ctx(['apothecary', 'rack']));
    assert(d.make === 'dry' && d.complete, 'any herb dries');
    eq(layout(C, 'apothecary', ['chamomile.flowers'], s, ctx(['apothecary', 'rack'])).make, 'dry', 'chamomile too');
    eq(layout(C, 'apothecary', ['sticks'], s, ctx(['apothecary', 'rack', 'mortar'])).make, null, 'sticks are no herb');
    const g = layout(C, 'apothecary', ['shells'], s, ctx(['apothecary', 'mortar']));
    assert(g.make === 'grind' && g.complete, 'shells grind in the mortar');
    eq(C.makes.grind.gives, 'crushed-shell', 'to crushed shell');
    eq(C.makes.dry.act, 'dry', 'Dry wears its own icon'); eq(C.makes.grind.act, 'grind', 'Grind its own');
    // Pencil outlines for a herb part wear the kind it shows.
    eq(JSON.stringify(layout(C, 'apothecary', [], s, ctx(['apothecary', 'rack'])).missing), JSON.stringify([]), 'nothing laid shows nothing');
    eq(JSON.stringify(buildKinds(C.builds.apothecary)), JSON.stringify(['sticks', 'sticks', 'rush-cord']), 'the bench: two sticks and cord');
  });

  test(G, 'P2j: rushes and cord make the hamper; the second needs the first and a withy lid; each is made once', async () => {
    const C = await load('world/cook'), s = cleanCook(null);
    const ctx = (/** @type {string[]} */ built) => ({ filled: (/** @type {string} */ id) => built.includes(id) });
    eq(layout(C, 'workbench', ['rushes.stems'], s, ctx([])).make, 'rush-cord', 'rushes alone still twist cord');
    const h = layout(C, 'workbench', ['rushes.stems', 'rush-cord', 'marram.leaves'], s, ctx([]));
    assert(h.make === 'hamper' && h.complete, 'rushes, cord and marram make a hamper');
    eq(layout(C, 'workbench', ['rushes.stems', 'rush-cord', 'willow.withies'], s, ctx([])).make, 'hamper', 'before a hamper stands, the second is not offered');
    const made = recordMade(s, 'hamper', 10);
    const h2 = layout(C, 'workbench', ['rushes.stems', 'rush-cord', 'willow.withies'], made, ctx(['store']));
    assert(h2.make === 'hamper2' && h2.complete, 'with a hamper standing, rushes, cord and a withy lid make the second');
    eq(layout(C, 'workbench', ['rushes.stems', 'rush-cord', 'willow.withies'], recordMade(made, 'hamper2', 20), ctx(['store'])).make, 'rush-cord', 'and only once');
    for (const id of ['apothecary', 'rack', 'mortar', 'hamper', 'hamper2', 'dry', 'grind']) assert(C.words.pageNames[id] && C.words.pageParts[id] && (C.words.made[id] || C.builds[id]), `${id} has its words`);
  });

  test(G, 'the walker works at the bench for the make: the make gesture is as long as the make', async () => {
    const PO = (await load('world/figure')).poses, C = await load('world/cook');
    const len = gestureLength(PO, 'make');
    assert(len > 2 && Math.abs(len - C.makeS) < 0.05, `make gesture ${len} s for a ${C.makeS} s make`);
  });
}
