// @ts-check
// The star fire, the hearth and the clay pieces (S4, S5; docs/future/13 sections 3.12 and 4.1 K-26):
// the star's logs meeting in the middle and stopping at the hearth stones, pushed in as the fire
// burns; the hearth's one pot, swapping and the first fired pot onto empty stones; the pot slots clear
// of the camp's other slots in both land recipes; which water fills the pot; the clay makes (the cup
// before the bowls, three bowls at most, the tempers, the hearth stones after the ring) and a shaped
// piece laid at the fire from the workbench; firing that agrees whether the hours pass in one go or
// through a lighting, a feed, a banking and a settling, as catch-up and live play do.

import { starLogs, logPlace, burntM, workSpot, stoneTop } from '../src/world/camp/star.js';
import { cleanCamp, layRing } from '../src/world/camp/model.js';
import { swapOn, placeFired, setHearth, potOnHearth, pieceOf, setWater, waterIn, shapedOn, addShaped, takeShaped, waterHere, potsMade } from '../src/world/camp/pots.js';
import { cleanCook, layout, drawPlan, recordMade } from '../src/world/camp/making.js';
import { noFire, layFire, lightFire, feedFire, bankFire, settleFire, fireAt } from '../src/world/camp/fire.js';
import { layWork, withFire, workDone, takeDone, fired } from '../src/world/camp/work.js';
import { WATER_CLASS, BASIN_SOURCE } from '../src/world/water/summary.js';

const G = 'camp: hearth and pots';
const DEG = Math.PI / 180;
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addHearthTests(test, assert, eq) {
  test(G, 'the star: six logs meet in the middle; with hearth stones the three lined up with a stone stop at it', async () => {
    const R = await load('world/camp'), S = R.star, F = R.fire;
    const lit = { word: 'lit', ash: 0 }, fire = { sinceHour: 10, flameUntilHour: 13 };
    const bare = starLogs(lit, fire, 10, F, S, { seed: 7, hearth: false });
    eq(bare.length, S.logs, 'one log a ray');
    assert(bare.every((g) => g.r === S.innerM), 'every inner end in the middle');
    const withStones = starLogs(lit, fire, 10, F, S, { seed: 7, hearth: true });
    eq(withStones.filter((g) => g.r === S.stoneClearM).length, 3, 'three stop at a stone');
    eq(withStones.filter((g) => g.r === S.hearthInnerM).length, 3, 'three reach in between them');
    // The same seed lays the same star; another seed another.
    eq(JSON.stringify(starLogs(lit, fire, 10, F, S, { seed: 7, hearth: true })), JSON.stringify(withStones), 'seeded');
    assert(JSON.stringify(starLogs(lit, fire, 10, F, S, { seed: 8, hearth: true })) !== JSON.stringify(withStones), 'another seed, another star');
    eq(starLogs({ word: 'none', ash: 0 }, fire, 10, F, S, { seed: 7, hearth: false }).length, 0, 'no ring, no star');
  });

  test(G, 'the logs rest on the stones and never pass through one, at every burn state, with and without the hearth stones', async () => {
    const R = await load('world/camp'), S = R.star, F = R.fire, fire = { sinceHour: 0, flameUntilHour: 100 };
    let worst = 0, checked = 0;
    for (const seed of [1, 7, 99, 12345]) for (const hearth of [false, true]) {
      for (const [word, hour] of /** @type {[string, number][]} */ ([['laid', 0], ['lit', 1], ['lit', 20], ['embers', 30], ['cold', 50]])) {
        for (const g of starLogs({ word, ash: 0 }, fire, hour, F, S, { seed, hearth })) {
          // Its underside, from the inner end's bottom along its tip, across its width.
          const len = S.logLenM * g.size * g.stretch, hw = S.logHalfW * g.size, ca = Math.cos(g.a), sa = Math.sin(g.a);
          const y0 = g.y - (len / 2) * Math.sin(g.roll);
          for (let t = 0.03; t <= len; t += 0.005) for (const w of [-1, 0, 1]) {
            const s = t * Math.cos(g.roll), top = stoneTop(ca * (g.r + s) - sa * w * hw, sa * (g.r + s) + ca * w * hw, hearth);
            if (top > S.ashTopM) worst = Math.max(worst, top - (y0 + t * Math.sin(g.roll)));
          }
          assert(g.roll <= S.maxTiltDeg * DEG + 1e-9 || g.stretch <= S.minStretch + 1e-9, 'steeper than the most only as a short end');
          checked++;
        }
      }
    }
    assert(checked > 200, 'every log checked');
    assert(worst <= 0.001, `no log passes into a stone (worst ${(worst * 1000).toFixed(1)} mm)`);
  });

  test(G, 'the logs are pushed in as the fire burns, never past maxBurntM; a log keeps its inner end where it was', async () => {
    const R = await load('world/camp'), S = R.star, F = R.fire, fire = { sinceHour: 0, flameUntilHour: 9 };
    const at = (/** @type {number} */ h) => burntM({ word: 'lit' }, fire, h, F, S);
    eq(at(0), 0, 'fresh logs at lighting');
    assert(at(3) > at(1) && at(1) > 0, 'shorter as it burns');
    assert(Math.abs(at(9) - Math.min(S.maxBurntM, S.pushM * 3)) < 1e-9, 'a handful a flameH');
    assert(at(1000) <= S.maxBurntM, 'never past the most');
    eq(burntM({ word: 'laid' }, fire, 5, F, S), 0, 'a laid ring is unburnt');
    const g = starLogs({ word: 'lit', ash: 0 }, fire, 6, F, S, { seed: 3, hearth: false })[0], half = S.logLenM / 2;
    const p = logPlace(g, half), len = half * g.size * g.stretch;
    const inner = [p.x - Math.cos(g.a) * len * Math.cos(g.roll), p.z - Math.sin(g.a) * len * Math.cos(g.roll)];
    assert(Math.abs(Math.hypot(inner[0], inner[1]) - g.r) < 1e-9, 'the inner end stays at its radius as the log shortens');
    assert(g.stretch < 1 && g.stretch >= 0.3, 'shorter, never a stub');
    const w = workSpot(0, S);
    assert(Math.hypot(w.x, w.z) >= 0.5, 'a piece firing sits outside the ring, between the log ends');
  });

  test(G, 'the hearth holds one pot: the first fired pot goes on it, a waiting pot swaps on, water rides on its own pot', async () => {
    const R = await load('world/camp'), H = R.hearth;
    let c = layRing(cleanCamp(null), 1, 9);
    c = placeFired(c, 'tea-pot', 2, 11, H);
    eq(potOnHearth(c), null, 'no hearth stones yet: it waits in its slot');
    eq(pieceOf(c, 'tea-pot')?.slot, 'pot-tea', 'in its own slot');
    c = setHearth(c, 3, 12, H);
    eq(potOnHearth(c), 'tea-pot', 'hearth stones made: the pot already fired goes on them');
    c = placeFired(c, 'cooking-pot', 4, 13, H);
    eq(potOnHearth(c), 'tea-pot', 'a second pot waits at the side');
    c = swapOn(c, 'cooking-pot');
    eq(potOnHearth(c), 'cooking-pot', 'swapped on');
    eq(swapOn(c, 'dye-pot'), c, 'a pot not made cannot be swapped on');
    c = setWater(c, 'cooking-pot', 'fresh');
    eq(waterIn(c, 'cooking-pot'), 'fresh', 'filled');
    eq(waterIn(c, 'tea-pot'), null, 'the other pot is still empty');
    c = placeFired(c, 'cup', 5, 14, H);
    eq(pieceOf(c, 'cup')?.slot, 'cup', 'the cup to its slot');
    eq(JSON.stringify(potsMade(c, H)), JSON.stringify(['cooking-pot', 'tea-pot']), 'both pots made');
    // A save round trip keeps the hearth's pot, the water and the shaped pieces.
    c = { ...c, slots: [...c.slots, { slot: 'workbench', kind: 'workbench', seed: 1, placedHour: 0 }] };
    c = addShaped(addShaped(c, 'bowl'), 'cup');
    const back = cleanCamp(JSON.parse(JSON.stringify(c)));
    eq(potOnHearth(back), 'cooking-pot', 'the hearth pot is saved');
    eq(waterIn(back, 'cooking-pot'), 'fresh', 'its water is saved');
    eq(JSON.stringify(shapedOn(back)), JSON.stringify(['bowl', 'cup']), 'the shaped pieces are saved');
    eq(JSON.stringify(shapedOn(takeShaped(back, 'bowl'))), JSON.stringify(['cup']), 'one taken to the fire');
  });

  test(G, 'the pot slots stand clear of every other camp slot in both land recipes', async () => {
    for (const land of ['land/starter-island', 'land/starter-island-2']) {
      const slots = (await load(land)).camp.slots;
      for (const id of ['pot-cook', 'pot-tea']) {
        const a = slots.find((/** @type {any} */ s) => s.id === id);
        assert(a, `${land} has ${id}`);
        for (const b of slots) {
          if (b === a || b.id === 'hearth' || b.on) continue;
          // A round slot by its radius; a bench or the tent by half its narrower side.
          const rb = b.r ?? Math.min(b.w ?? 0, b.d ?? 0) / 2, d = Math.hypot(a.u - b.u, a.v - b.v);
          assert(d >= a.r + rb - 1e-9, `${land}: ${id} clear of ${b.id} (${d.toFixed(2)} m)`);
        }
      }
    }
  });

  test(G, 'the pot fills fresh at running or slow water or a spring-fed pool, salt at the sea; still water only says so', () => {
    const W = { cellOf: (/** @type {number} */ m) => Math.floor(m / 0.5), cellM: 0.5, fresh: [WATER_CLASS.running, WATER_CLASS.slow], sea: WATER_CLASS.sea, still: WATER_CLASS.still, spring: BASIN_SOURCE.spring, seaFill: true };
    const grid = (/** @type {number} */ cls, basinSource = 0) => {
      const w = 20, cl = new Uint8Array(w * w), basin = new Uint16Array(w * w), src = new Uint8Array(4);
      cl[10 * w + 12] = cls; basin[10 * w + 12] = 1; src[1] = basinSource;
      return { rect: { x: 0, y: 0, w, h: w }, cls: cl, basin, basinSource: src };
    };
    // The walker stands in cell (10, 10); the water lies two cells (1 m) away.
    eq(waterHere(grid(WATER_CLASS.running), 5.25, 5.25, 1.2, W), 'fresh', 'a stream');
    eq(waterHere(grid(WATER_CLASS.slow), 5.25, 5.25, 1.2, W), 'fresh', 'a slow rill');
    eq(waterHere(grid(WATER_CLASS.still), 5.25, 5.25, 1.2, W), 'still', 'a rain pond stands still');
    eq(waterHere(grid(WATER_CLASS.still, BASIN_SOURCE.spring), 5.25, 5.25, 1.2, W), 'fresh', 'the spring\'s own pool');
    eq(waterHere(grid(WATER_CLASS.sea), 5.25, 5.25, 1.2, W), 'sea', 'the sea');
    eq(waterHere(grid(WATER_CLASS.running), 5.25, 5.25, 0.4, W), null, 'out of reach');
    eq(waterHere(grid(WATER_CLASS.sea), 5.25, 5.25, 1.2, { ...W, seaFill: false }), null, 'no sea fill when the recipe says so');
    eq(waterHere(grid(WATER_CLASS.dry), 9.9, 9.9, 1.2, W), 'sea', 'off the summary is open sea');
  });

  test(G, 'clay makes: the tempers, the cup before three bowls, the hearth stones after the ring, a shaped piece fired at the fire', async () => {
    const C = await load('world/cook');
    let s = cleanCook(null);
    eq(layout(C, 'workbench', ['clay', 'sand'], s).make, 'cooking-pot', 'clay and sand: the cooking pot');
    eq(layout(C, 'workbench', ['clay', 'crushed-shell'], s).make, 'tea-pot', 'clay and crushed shell: the tea pot');
    eq(layout(C, 'workbench', ['clay'], s).make, 'cup', 'clay alone: the cup first');
    s = recordMade(s, 'cup', 1);
    eq(layout(C, 'workbench', ['clay'], s).make, 'bowl', 'then bowls');
    for (let i = 0; i < 3; i++) s = recordMade(s, 'bowl', 2 + i);
    eq(layout(C, 'workbench', ['clay'], s).make, 'cooking-pot', 'a fourth bowl is not offered: clay now points to the cooking pot, waiting for sand');
    const filled = (/** @type {string} */ slot) => slot === 'ring';
    eq(layout(C, 'workbench', ['flat-stones', 'flat-stones'], cleanCook(null), { filled: () => false }).make === 'hearth-stones', false, 'no hearth stones before the ring');
    const hs = layout(C, 'workbench', ['flat-stones', 'flat-stones'], cleanCook(null), { filled });
    assert(hs.make === 'hearth-stones' && hs.complete, 'two flat stones once the ring is laid');
    assert(!C.makes['dye-pot'], 'the dye pot waits for Phase 4');
    const fire = layout(C, 'fire', ['shaped:tea-pot'], s);
    assert(fire.make === 'fire-tea-pot' && fire.complete, 'a shaped tea pot is fired at the fire');
    const plan = drawPlan(['shaped:tea-pot'], [{ id: 'pack', holds: {} }, { id: 'bench', holds: { 'shaped:tea-pot': 1 } }]);
    eq(plan?.[0].from, 'bench', 'lifted off the workbench');
    eq(C.makes['fire-tea-pot'].needH, 8, 'eight hours of fire');
    eq(C.makes['fire-tea-pot'].fires, 'tea-pot', 'it becomes the tea pot');
  });

  test(G, 'firing agrees: a pot laid at a cold fire waits; eight hours of fire through a lighting, a feed, a banking and a settle fire it, as one stretch does', async () => {
    const F = (await load('world/camp')).fire, C = await load('world/cook');
    const m = C.makes['fire-cooking-pot'];
    const piece = { id: 'fire-cooking-pot', needH: m.needH, gives: m.gives, count: 1 };
    // Live: laid at a laid (cold) ring at 18:00, lit at 19, fed at 21, banked at 22, the clock settling it at 26.
    let c = /** @type {any} */ ({ fire: layFire(noFire(), 17), work: [] });
    c = { ...c, work: layWork(c.work, piece, 18) };
    assert(!workDone(c.work[0], c.fire, 40, F), 'a cold fire never fires it');
    c = withFire(c, /** @type {any} */ (lightFire(c.fire, 19, F)), 19, F);
    c = withFire(c, /** @type {any} */ (feedFire(c.fire, 21, F)), 21, F);
    c = withFire(c, bankFire(c.fire, 22, F), 22, F);
    c = withFire(c, settleFire(c.fire, 26, F), 26, F);
    const live = fired(c.work[0], c.fire, 26.5, F);
    // Catch-up: the same fire, worked out from the clock at once.
    let d = /** @type {any} */ ({ fire: layFire(noFire(), 17), work: [] });
    d = { ...d, work: layWork(d.work, piece, 18) };
    d = withFire(d, /** @type {any} */ (lightFire(d.fire, 19, F)), 19, F);
    d = withFire(d, /** @type {any} */ (feedFire(d.fire, 21, F)), 21, F);
    d = withFire(d, bankFire(d.fire, 22, F), 22, F);
    const away = fired(d.work[0], d.fire, 26.5, F);
    assert(Math.abs(live - away) < 1e-9, `the same hours of fire (${live} and ${away})`);
    assert(workDone(c.work[0], c.fire, 27, F) && !workDone(c.work[0], c.fire, 26.9, F), 'fired at its eighth hour of fire, lit or banked');
    eq(fireAt(c.fire, 27, F).word, 'embers', 'banked under ash when it finished');
    // A fired pot leaves the ring for its slot; the ring's Take up only takes a bowl or charcoal.
    const slotted = (/** @type {any} */ p) => !C.makes[p.id]?.fires || C.makes[p.id].fires === 'bowl';
    eq(takeDone(c.work, c.fire, 28, F, slotted).piece, null, 'a pot is not taken up into the pack');
    eq(takeDone(c.work, c.fire, 28, F).piece?.id, 'fire-cooking-pot', 'without the filter it is done');
  });
}
