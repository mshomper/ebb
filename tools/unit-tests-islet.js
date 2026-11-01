// @ts-check
// The meadow islet (B3a, src/world/islet) for tools/unit-tests.html: where it lies on both starter
// islands (outside the open land, inside the world, 86 m out, on the side away from the camp and
// the spit), its ground (just above high tide, the bar dry only around low water), when it shows
// and how it rises, the Tier 1 milestone, its save section, and its hint and thread.

import { subSeed } from '../src/core/rng.js';
import { baseSampler, islandCenter } from '../src/world/terrain/landform.js';
import { isletLayout, makeShape, riseLowH, underBy, phaseOf, nextLowH, landBox, inBox } from '../src/world/islet/layout.js';
import { cleanIslet, emptyIslet } from '../src/world/islet/model.js';
import { milestoneReached } from '../src/world/expansion.js';
import { SECTIONS9, clean9 } from '../src/save/migrate-format9.js';
import { tideParams, amplitude } from '../src/world/tide.js';
import { coverHour } from '../src/world/growth/cover.js';
import { HABITAT_CELLS } from '../src/world/growth/habitat.js';
import { testMachair, grow } from './mat-machair.js';

const G = 'islet';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {any} R @param {any} land @param {number} seed */
function layoutOf(R, land, seed) {
  const ts = subSeed(seed, 'terrain'), base = baseSampler(land, ts);
  return isletLayout(R, land, ts, subSeed(seed, 'islet'), (x, z) => base(x, z)[0]);
}

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addIsletTests(test, assert, eq) {
  test(G, 'it lies 86 m out (a little nearer by the older island), outside the open land and inside the world, on both starter islands', async () => {
    const R = await load('land/meadow-islet');
    for (const name of ['starter-island-2', 'starter-island']) {
      const land = await load(`land/${name}`), c = islandCenter(land), box = landBox(land);
      for (const seed of [1, 2, 3, 99, 12345]) {
        const L = layoutOf(R, land, seed);
        assert(L, `${name} seed ${seed}: an islet fits`);
        if (!L) continue;
        const out = Math.hypot(L.x - c.x, L.z - c.z);
        if (name === 'starter-island-2') assert(Math.abs(out - R.place.distanceM) < 1e-6, 'its middle is distanceM from the middle of the larger island');
        else assert(out <= R.place.distanceM && out >= R.place.distanceM - R.place.nearerM, "a little nearer by the older island, where the world's edge is close");
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const x = L.x + a * L.A * L.tx + b * L.B * L.ux, z = L.z + a * L.A * L.tz + b * L.B * L.uz;
          assert(!inBox(box, x, z), `${name} seed ${seed}: its outline stays off the open land`);
          assert(x > -80 && x < 112 && z > -80 && z < 112, 'and inside the world');
        }
        // The bar runs from the island's middle side straight out to the islet.
        const d0 = Math.hypot(L.bar.from[0] - c.x, L.bar.from[1] - c.z), d1 = Math.hypot(L.bar.to[0] - c.x, L.bar.to[1] - c.z);
        assert(d0 < d1 && d1 > out - L.B, 'the bar runs out from the shore into the islet');
      }
    }
  });

  test(G, 'the side is the one farthest from the camp and the spit, and the seed can pick either', async () => {
    const R = await load('land/meadow-islet'), land = await load('land/starter-island-2');
    const sides = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const L = layoutOf(R, land, seed);
      if (L) sides.add(Math.round(L.sideDeg / 90) * 90);
    }
    // The larger island fills one corner of the world: open sea only toward +x and +z.
    assert([...sides].every((s) => s === 0 || s === 90), 'only the open-sea sides');
    eq(sides.size, 2, 'both open-sea sides come up across seeds');
  });

  test(G, 'its ground sits just above high tide, and its bar is dry only around low water', async () => {
    const [R, land, W] = await Promise.all([load('land/meadow-islet'), load('land/starter-island-2'), load('world/water')]);
    const L = layoutOf(R, land, 7);
    assert(L, 'an islet');
    if (!L) return;
    const S = makeShape(L, R, subSeed(7, 'islet'), land.seabedDepth);
    let top = -9;
    for (let a = -1; a <= 1; a += 0.05) for (let b = -1; b <= 1; b += 0.05) top = Math.max(top, S.heightAt(L.x + a * L.A * L.tx + b * L.B * L.ux, L.z + a * L.A * L.tz + b * L.B * L.uz));
    const tide = tideParams(W.tide), highest = tide.amplitudeM * (1 + tide.springNeap);
    assert(top > highest + 0.3 && top < highest + 1.5, `its top (${top.toFixed(2)} m) stands just above the highest tide`);
    const mid = [(L.bar.from[0] + L.bar.to[0]) / 2, (L.bar.from[1] + L.bar.to[1]) / 2];
    const crest = S.heightAt(mid[0], mid[1]);
    const lowest = tide.amplitudeM * (1 - tide.springNeap);
    assert(crest < 0 && crest > -lowest, `the bar's crest (${crest.toFixed(2)} m) dries at every low water and is under the sea otherwise`);
    // Far from it, the seabed is left alone.
    eq(S.heightAt(L.x + L.ux * 60, L.z + L.uz * 60), -Infinity, 'the open sea beyond is not touched');
    const [grass, sand] = S.paintAt(mid[0], mid[1], crest);
    assert(sand > 0.99 && grass < 0.01, 'the bar is sand');
    // Machair: mostly sand through a thin turf, with sparse grassy patches.
    let sandSum = 0, n = 0, grassy = 0;
    for (let a = -0.7; a <= 0.7; a += 0.05) for (let b = -0.6; b <= 0.6; b += 0.05) {
      const x = L.x + a * L.A * L.tx + b * L.B * L.ux, z = L.z + a * L.A * L.tz + b * L.B * L.uz;
      const [g, sa] = S.paintAt(x, z, 1.4);
      sandSum += sa; n++; if (g > 0.5) grassy++;
    }
    assert(sandSum / n > 0.5, `its top is mostly sand (${(sandSum / n).toFixed(2)})`);
    assert(grassy > 0 && grassy / n < 0.4, `with sparse grassy patches (${(100 * grassy / n).toFixed(0)}% of it)`);
  });

  test(G, 'it first shows at the big low tide of day 27, or at the first low water after a later milestone', async () => {
    const [R, W] = await Promise.all([load('land/meadow-islet'), load('world/water')]);
    const tide = tideParams(W.tide);
    eq(riseLowH(R, tide, 100), 27 * 24 + 18, 'earned early: day 27 at 18:00');
    eq(nextLowH(27 * 24 + 18, tide), 27 * 24 + 18, 'which is a low water');
    // The biggest low tide of those days.
    const amp = (/** @type {number} */ h) => amplitude(h, tide);
    assert(amp(27 * 24 + 18) >= amp(27 * 24 + 6) && amp(27 * 24 + 18) >= amp(26 * 24 + 18), 'a spring low tide');
    const later = riseLowH(R, tide, 30 * 24 + 7);
    assert(later > 30 * 24 + 7 && later - (30 * 24 + 7) <= tide.periodH + R.rise.shoalH, 'earned later: the next low water after it');
    eq(nextLowH(later, tide), later, 'a low water too');
  });

  test(G, 'the rise: a shoal grows out of the seabed, then it climbs over one tide cycle, never sinking', async () => {
    const R = await load('land/meadow-islet');
    const low = 666, span = 4.6;
    eq(phaseOf(R, null, 900), 'waiting', 'not earned: waiting');
    eq(phaseOf(R, low, low - R.rise.shoalH - 0.1), 'waiting', 'before its shoal');
    eq(underBy(R, low, low - R.rise.shoalH - 0.1, span), Infinity, 'nothing written before its shoal');
    eq(phaseOf(R, low, low - 0.5), 'shoal', 'a shoal before the low water');
    eq(underBy(R, low, low - R.rise.shoalH, span), span, 'the shoal starts at the seabed');
    eq(underBy(R, low, low, span), R.rise.blendDepthM, 'at the low water it is blendDepthM under');
    eq(phaseOf(R, low, low + 1), 'rising', 'then rising');
    eq(underBy(R, low, low + R.rise.durationH, span), 0, 'one tide cycle on, at full height');
    eq(phaseOf(R, low, low + R.rise.durationH), 'risen', 'and risen');
    let last = Infinity;
    for (let t = low - R.rise.shoalH; t <= low + R.rise.durationH + 1; t += 0.1) {
      const u = underBy(R, low, t, span);
      assert(u <= last + 1e-9, 'it never sinks');
      last = u;
    }
  });

  test(G, 'the Tier 1 milestone: the second happy pond species', async () => {
    const R = await load('land/meadow-islet');
    assert(!milestoneReached(['frogs:happy'], R.milestone), 'one happy species is not enough');
    assert(!milestoneReached(['frogs:happy', 'damselflies:happy'], R.milestone), 'damselflies are not a pond-tier species');
    assert(milestoneReached(['frogs:happy', 'minnows:happy'], R.milestone), 'two are');
    assert(milestoneReached(['turtles:happy', 'dragonflies:happy'], R.milestone), 'any two of the four');
  });

  test(G, 'its save section: an older save reads as not earned, and a risen islet stays risen', () => {
    assert(SECTIONS9.includes(/** @type {any} */ ('islet')), 'a format 9 section');
    eq(JSON.stringify(clean9(/** @type {any} */ ('islet'), undefined)), JSON.stringify(emptyIslet()), 'missing: not earned');
    eq(cleanIslet({ version: 2 }).earnedH, null, 'unreadable: not earned');
    const risen = cleanIslet({ version: 1, earnedH: 300, lowH: 666, applied: 1, planted: ['0:campion', 4], phase: 'risen', x: 70 });
    eq(risen.applied, 1, 'risen stays risen');
    eq(risen.lowH, 666, 'with the low water it rose at');
    eq(JSON.stringify(risen.planted), JSON.stringify(['0:campion']), 'its clumps kept');
    eq(/** @type {any} */ (risen).x, undefined, 'the live layout is not kept (it is rebuilt on load)');
    eq(cleanIslet({ version: 1, earnedH: null, lowH: 666 }).lowH, null, 'no low water without the milestone');
  });

  test(G, 'its morning hint and thread read flags the islet sets, and its flax slot is named', async () => {
    const [H, T, R] = await Promise.all([load('world/morning-hints'), load('world/threads'), load('land/meadow-islet')]);
    const hint = H.hints.find((/** @type {any} */ h) => h.id === 'islet');
    assert(hint && H.tests[hint.when] && H.tests[hint.done], 'the hint waits on its tests');
    eq(H.tests[hint.when][0].flag, 'setpiece:islet:rose', 'the morning after it first shows');
    const th = T.threads.find((/** @type {any} */ t) => t.id === 'islet');
    assert(th && th.lines.every((/** @type {any} */ l) => T.tests[l.test]) && th.end.every((/** @type {string} */ e) => T.tests[e]), 'every thread line has its test');
    assert(R.starters.clumps.some((/** @type {any} */ c) => c.sp === 'flax'), 'flax has its slot');
  });

  test(G, 'the machair plants: each a flora recipe, a journal page and a web node, and none comes to the pond island by itself', async () => {
    const [R, Gr, J, W] = await Promise.all([load('land/meadow-islet'), load('world/growth'), load('world/journal'), load('world/journal-web')]);
    const machair = ['harebell', 'trefoil', 'thyme', 'clover', 'bedstraw'];
    for (const sp of machair) {
      const rec = await load(`flora/${sp}`);
      eq(rec.id, sp, `${sp} has its recipe`);
      const mat = ['thyme', 'clover', 'trefoil'].includes(sp);
      // Thyme, clover and trefoil are mats (cover plants drawn as shells); harebell and bedstraw plants.
      assert(mat ? Gr.cover.includes(sp) && rec.spread.planted === true : Gr.species.includes(sp), `${sp} is in growth's ${mat ? 'cover' : 'species'} list`);
      if (mat) eq(J.species[sp].kind, 'cover', `${sp}'s page is a cover page`);
      assert(!Gr.volunteers.order.includes(sp), `${sp} never volunteers on the pond island`);
      eq(rec.plantTool, false, `${sp} is not in the Plant tool`);
      assert(J.species[sp] && J.order.includes(sp), `${sp} has a journal page`);
      assert(W.nodes[sp], `${sp} is a web node`);
      assert(R.starters.clumps.some((/** @type {any} */ c) => c.sp === sp), `${sp} is planted when the islet rises`);
    }
    // None of the pond island's own plants are planted on it: its biome is its own.
    const own = R.starters.clumps.map((/** @type {any} */ c) => c.sp).filter((/** @type {string} */ sp) => sp !== 'flax');
    assert(own.every((/** @type {string} */ sp) => machair.includes(sp)), 'only machair plants as its starters');
  });

  test(G, 'the mats: none until planted, then thyme, clover and trefoil spread by the season, sharing the ground', async () => {
    const growth = await load('world/growth');
    const covers = Object.fromEntries(await Promise.all(growth.cover.map(async (/** @type {string} */ sp) => [sp, await load(`flora/${sp}`)])));
    const env = { seed: 7, recipes: { growth: { ...growth, cover: growth.cover.filter((/** @type {string} */ s) => s !== 'rushes') }, covers } };
    const hab = testMachair();
    // Nothing planted: no mat map at all, so the pond island's growth state is as it was.
    const none = coverHour({ cover: {} }, hab, env, 100, 1);
    eq(Object.keys(none?.cover ?? {}).length, 0, 'no mat map before any is planted');
    const N = HABITAT_CELLS;
    /** @type {Record<string, Uint8Array>} */ const maps = {};
    const plant = (/** @type {string} */ sp, /** @type {number} */ i, /** @type {number} */ j) => {
      const m = new Uint8Array(N * N);
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1]]) m[(j + dj) * N + i + di] = covers[sp].spread.plantStart;
      maps[sp] = m;
    };
    plant('thyme', 50, 66); plant('trefoil', 55, 84); plant('clover', 85, 75);
    const area = (/** @type {Uint8Array} */ m) => m.reduce((a, v) => a + (v > 64 ? 1 : 0), 0);
    const autumn = grow(hab, env, maps, 27, 15);
    const winter = grow(hab, env, autumn, 42, 14);
    const summer = grow(hab, env, winter, 56, 28);
    for (const sp of ['thyme', 'clover', 'trefoil']) {
      assert(area(autumn[sp]) > 3, `${sp} spreads through its first autumn`);
      eq(area(winter[sp]), area(autumn[sp]), `${sp} rests through winter`);
      assert(area(summer[sp]) > 2 * area(autumn[sp]), `${sp} spreads on through spring and summer`);
    }
    // Clover makes the beds: it outgrows the others and fills most of the grassy patch by summer.
    assert(area(summer.clover) > area(summer.thyme) && area(summer.clover) > area(summer.trefoil), 'clover spreads fastest');
    assert(area(summer.clover) > 450, `clover makes a bed of hundreds of square meters by its second summer (${area(summer.clover)})`);
    // Thyme keeps to the open sand (grass shades it out); nothing grows off the open ground.
    let thymeInPatch = 0, outside = 0, over = 0;
    for (let k = 0; k < N * N; k++) {
      const i = k % N;
      if (summer.thyme[k] > 64 && i >= 72 && hab.open[k]) thymeInPatch++;
      if (!hab.open[k] && (summer.thyme[k] || summer.clover[k] || summer.trefoil[k])) outside++;
      if (summer.thyme[k] + summer.clover[k] + summer.trefoil[k] > 255) over++;
    }
    eq(thymeInPatch, 0, 'no thyme mat in the grassy patch');
    eq(outside, 0, 'no mat off the open ground');
    eq(over, 0, 'mats never hold more than a whole square between them');
    // The same island grows the same way.
    const again = grow(hab, env, maps, 27, 15);
    eq(Array.from(again.clover).join(), Array.from(autumn.clover).join(), 'seeded: the same clover again');
  });
}
