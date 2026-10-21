// @ts-check
// Keepsake tests for tools/unit-tests.html (docs/future/12): a shell is the same for the same seed,
// rarity follows the tide's gates and never reaches past them, a kept shell's numbers make the same
// mesh, and the mesh is sound (finite, sized, base on the ground, faces pointing out).

import { rollShell, shellMesh, shellWords } from '../src/world/keepsakes/families/shell.js';
import { pickIndex, rarityWeights } from '../src/world/keepsakes/rarity.js';
import { keepsakeSvg, traceKeepsake } from '../src/ui/sketches/keepsake.js';
import { FAMILIES, keepsakeMesh, keepsakeWords, rollKeepsake } from '../src/world/keepsakes/families/index.js';
import { onShore, tideKeepsakes } from '../src/world/keepsakes/shore.js';
import { cleanShelf, emptyShelf, keep, letGo, swap, SHELF_CAP } from '../src/world/keepsakes/shelf.js';
import { snapshot, restore } from '../src/save/sections.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { loadArtifactBases } from '../src/world/keepsakes/families/artifact.js';

const KEEPSAKES = 'keepsakes';

async function recipe() {
  const r = await fetch('../recipes/world/keepsakes.json');
  if (!r.ok) throw new Error(`recipes/world/keepsakes.json: HTTP ${r.status}`);
  const K = await r.json();
  await loadArtifactBases(K);
  return K;
}

/** @param {any} test @param {any} assert @param {any} eq */
export function addKeepsakeTests(test, assert, eq) {
  test(KEEPSAKES, 'the same seed and slot make the same shell; another slot makes another', async () => {
    const K = await recipe();
    const c = { spring: 0.9, season: 'winter' };
    eq(JSON.stringify(rollShell(7, 3, K, c)), JSON.stringify(rollShell(7, 3, K, c)), 'same numbers');
    assert(JSON.stringify(rollShell(7, 3, K, c)) !== JSON.stringify(rollShell(7, 4, K, c)), 'a different slot differs');
  });

  test(KEEPSAKES, 'rare and very rare shells come only on tides that reach their gates', async () => {
    const K = await recipe();
    const seen = (/** @type {number} */ spring) => {
      /** @type {Set<string>} */ const s = new Set();
      for (let i = 0; i < 4000; i++) s.add(rollShell(11, i, K, { spring, season: 'summer' }).rarity);
      return s;
    };
    const neap = seen(-1), top = seen(0.95);
    assert(!neap.has('rare') && !neap.has('veryRare'), 'no rare shells at neap');
    assert(top.has('rare') && top.has('veryRare'), 'both rare tiers at the top of the spring');
    eq(rarityWeights(K.rarity, { spring: 0.6 })[3], 0, 'very rare is shut below its gate');
  });

  test(KEEPSAKES, 'once in a lifetime: the fifth tier, only at the very top of a spring tide, rarest of all', async () => {
    const K = await recipe();
    eq(K.rarity.order.join(','), 'common,uncommon,rare,veryRare,lifetime', 'five tiers in order');
    eq(K.rarity.words.lifetime, 'once in a lifetime', 'its word');
    eq(rarityWeights(K.rarity, { spring: 0.85 })[4], 0, 'shut below its gate, even where very rare is open');
    const top = rarityWeights(K.rarity, { spring: 1 });
    assert(top[4] > 0 && top[4] < top[3], 'open at the very top, and rarer than very rare');
    let seen = 0;
    for (let i = 0; i < 20000; i++) if (rollKeepsake('shell', 31, i, K, { spring: 1, season: 'winter' }).rarity === 'lifetime') seen++;
    assert(seen > 0 && seen < 200, `turns up, but seldom, on the best winter tides (${seen} in 20,000)`);
    assert(K.shelf.grounds.lifetime, 'its own paper on the shelf');
    for (const [key, fam] of Object.entries(K)) if (/** @type {any} */ (fam)?.tiers?.veryRare) assert(/** @type {any} */ (fam).tiers.lifetime, `${key} has a lifetime tier`);
  });

  test(KEEPSAKES, 'winter leans toward the rarer tiers', async () => {
    const K = await recipe();
    const w = rarityWeights(K.rarity, { spring: 0.9, season: 'winter' }), s = rarityWeights(K.rarity, { spring: 0.9, season: 'summer' });
    assert(w[3] / w[0] > s[3] / s[0], 'a greater share of very rare in winter');
    eq(pickIndex(0, [0, 3, 1]), 1, 'a weightless first tier is skipped');
    eq(pickIndex(0.9999999, [5, 0, 0]), 0, 'the top of the range lands on a tier with weight');
  });

  test(KEEPSAKES, 'a kept shell\'s numbers make the same mesh, sized and on the ground', async () => {
    const K = await recipe();
    for (let i = 0; i < 24; i++) {
      const n = rollShell(3, i, K, { spring: 0.9, season: 'winter' });
      const kept = JSON.parse(JSON.stringify(n));
      const a = shellMesh(n, K.shells.mesh), b = shellMesh(kept, K.shells.mesh);
      eq(a.count, b.count, 'same vertex count');
      let same = true, finite = true, lo = Infinity, ext = 0;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < a.vertices.length; k++) {
        if (a.vertices[k] !== b.vertices[k]) same = false;
        if (!Number.isFinite(a.vertices[k])) finite = false;
      }
      for (let v = 0; v < a.count; v++) {
        lo = Math.min(lo, a.vertices[v * 9 + 1]);
        for (let r = 0; r < 3; r++) { mn[r] = Math.min(mn[r], a.vertices[v * 9 + r]); mx[r] = Math.max(mx[r], a.vertices[v * 9 + r]); }
      }
      ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
      assert(same, `shell ${i}: the kept numbers rebuild it exactly`);
      assert(finite, `shell ${i}: every number finite`);
      assert(Math.abs(lo) < 1e-6, `shell ${i}: base on y = 0`);
      assert(Math.abs(ext - n.sizeM) < n.sizeM * 0.01, `shell ${i}: largest extent is its size`);
      assert(a.indices.length / 3 < 24000, `shell ${i}: under 24k triangles (${a.indices.length / 3})`);
    }
  });

  test(KEEPSAKES, 'a left-coiled shell is the mirror of its right-coiled twin, and says so', async () => {
    const K = await recipe();
    const n = rollShell(5, 1, K, { spring: 0, season: 'spring' });
    const r = shellMesh({ ...n, left: 0, mark: null }, K.shells.mesh), l = shellMesh({ ...n, left: 1, mark: 'leftCoiled' }, K.shells.mesh);
    let mirrored = true;
    for (let v = 0; v < r.count; v++) {
      if (Math.abs(r.vertices[v * 9] + l.vertices[v * 9]) > 1e-6 || Math.abs(r.vertices[v * 9 + 1] - l.vertices[v * 9 + 1]) > 1e-6) { mirrored = false; break; }
    }
    assert(mirrored, 'x is mirrored, y kept');
    assert(shellWords({ ...n, left: 1 }, K).includes(K.shells.marks.leftCoiled.word), 'the card names the mark');
    let found = 0;
    for (let i = 0; i < 5000; i++) found += rollShell(9, i, K, { spring: 0, season: 'spring' }).left;
    assert(found > 10 && found < 90, `left-coiled shells are uncommon but turn up (${found} in 5000)`);
  });

  test(KEEPSAKES, 'a shell\'s sketch traces the same every time, with an outline and a colour wash', async () => {
    const K = await recipe();
    const n = rollShell(21, 2, K, { spring: 0.9, season: 'winter' }, 'rare');
    const a = traceKeepsake(shellMesh(n, K.shells.mesh), n), b = traceKeepsake(shellMesh(n, K.shells.mesh), n);
    eq(JSON.stringify(a), JSON.stringify(b), 'same tracing');
    assert(a.outline.length > 8, 'an outline');
    assert((a.wash ?? []).flat().some((c) => c), 'a colour wash');
    const svg = keepsakeSvg(a, 'test');
    assert(svg.startsWith('<svg') && svg.includes('clip-path'), 'an SVG with its wash clipped to the outline');
  });

  test(KEEPSAKES, 'every family makes the same keepsake from the same seed, sized, on the ground and finite', async () => {
    const K = await recipe();
    for (const family of Object.keys(FAMILIES)) {
      for (const r of K.rarity.order) {
        for (let i = 0; i < 6; i++) {
          const n = rollKeepsake(family, 9, i, K, { spring: 1, season: 'winter' }, r);
          eq(JSON.stringify(n), JSON.stringify(rollKeepsake(family, 9, i, K, { spring: 1, season: 'winter' }, r)), `${family}: same numbers`);
          const m = keepsakeMesh(JSON.parse(JSON.stringify(n)), K);
          let lo = Infinity, finite = true;
          const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (let v = 0; v < m.count; v++) {
            lo = Math.min(lo, m.vertices[v * 9 + 1]);
            for (let c = 0; c < 9; c++) if (!Number.isFinite(m.vertices[v * 9 + c])) finite = false;
            for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], m.vertices[v * 9 + c]); mx[c] = Math.max(mx[c], m.vertices[v * 9 + c]); }
          }
          const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
          assert(finite, `${family} ${r} ${i}: finite`);
          assert(Math.abs(lo) < 1e-6, `${family} ${r} ${i}: base on y = 0`);
          assert(ext > n.sizeM * 0.5 && ext < n.sizeM * 1.05, `${family} ${r} ${i}: about its size (${ext.toFixed(3)} for ${n.sizeM})`);
          assert(m.indices.length / 3 < 24000, `${family} ${r} ${i}: under 24k triangles`);
          assert(keepsakeWords(n, K).length > 8, `${family}: a card line`);
        }
      }
    }
  });

  test(KEEPSAKES, 'every family\'s rare mark turns up, and more often at the rarer tiers', async () => {
    const K = await recipe();
    for (const family of Object.keys(FAMILIES)) {
      let common = 0, rare = 0;
      for (let i = 0; i < 3000; i++) {
        if (rollKeepsake(family, 4, i, K, { spring: 1 }, 'common').mark) common++;
        if (rollKeepsake(family, 4, i, K, { spring: 1 }, 'veryRare').mark) rare++;
      }
      assert(rare > 0, `${family}: the mark turns up`);
      assert(rare >= common, `${family}: at least as often when very rare (${rare} against ${common})`);
    }
  });

  test(KEEPSAKES, 'a tide leaves the same keepsakes every time, within its budget, kept apart', async () => {
    const K = await recipe();
    const cells = Array.from({ length: 400 }, (_, k) => ({ k, x: (k % 40) * 0.5, z: Math.floor(k / 40) * 0.5 }));
    let total = 0, tides = 0;
    for (let t = 0; t < 200; t++) {
      const a = tideKeepsakes(17, t, cells, { spring: 0 }, K), b = tideKeepsakes(17, t, cells, { spring: 0 }, K);
      eq(JSON.stringify(a), JSON.stringify(b), 'same for the same tide');
      assert(a.length <= K.shore.budget.length - 1, `tide ${t}: within the budget (${a.length})`);
      for (const p of a) for (const q of a) if (p !== q) assert(Math.hypot(p.x - q.x, p.z - q.z) >= K.shore.spacingM, 'kept apart');
      total += a.length; tides++;
    }
    const mean = total / tides;
    assert(mean > 0.6 && mean < 1.3, `about one a tide on average (${mean.toFixed(2)})`);
    let spring = 0;
    for (let t = 0; t < 200; t++) spring += tideKeepsakes(17, t, cells, { spring: 0.9 }, K).length;
    assert(spring / 200 > mean, 'more at spring tides');
    eq(tideKeepsakes(17, 3, [], { spring: 1 }, K).length, 0, 'no strandline, nothing');
  });

  test(KEEPSAKES, 'sheltered cells are chosen more often, and the island shows only its cap', async () => {
    const K = await recipe();
    // Two far-apart cells: one sheltered (weight 4), one open (weight 0.25).
    const cells = [{ k: 1, x: 0, z: 0, weight: 4 }, { k: 2, x: 50, z: 0, weight: 0.25 }];
    let cove = 0, open = 0;
    for (let t = 0; t < 600; t++) for (const s of tideKeepsakes(5, t, cells, { spring: 0 }, K, { budget: [0, 1] })) (s.k === 1 ? cove++ : open++);
    assert(cove > open * 4, `the cove wins far more often (${cove} against ${open})`);
    const lists = [tideKeepsakes(5, 9, cells, { spring: 0 }, K, { budget: [0, 0, 1] }), tideKeepsakes(5, 8, cells, { spring: 0 }, K, { budget: [0, 0, 1] })];
    eq(onShore(lists, 3).length, 3, 'capped at three');
    eq(onShore(lists, 3)[0].tideId, 9, 'the newest tide first');
    eq(onShore(lists, 3, new Set([lists[0][0].id])).some((s) => s.id === lists[0][0].id), false, 'one let go stays gone');
  });

  test(KEEPSAKES, 'a lean (a net\'s haul) raises the rarer tiers', async () => {
    const K = await recipe();
    const plain = rarityWeights(K.rarity, { spring: 0.9 }), net = rarityWeights(K.rarity, { spring: 0.9, lean: { rare: 3, veryRare: 5 } });
    assert(net[2] === plain[2] * 3 && net[3] === plain[3] * 5 && net[0] === plain[0], 'rare times three, very rare times five, common the same');
  });

  test(KEEPSAKES, 'the shelf keeps sixteen, then asks; letting go and swapping keep the rest in place', async () => {
    const K = await recipe();
    let s = emptyShelf();
    for (let i = 0; i < SHELF_CAP; i++) {
      const r = keep(s, { n: rollKeepsake('shell', 1, i, K, { spring: 0 }), hour: i * 12, spring: false });
      assert(r.kept && !r.full, `space for number ${i + 1}`);
      s = r.state;
    }
    const full = keep(s, { n: rollKeepsake('stone', 1, 99, K, { spring: 0 }), hour: 500, spring: true });
    assert(!full.kept && full.full && full.state === s, 'a full shelf keeps nothing and asks');
    const out = s.shelf[5].id;
    const swapped = swap(s, out, { n: rollKeepsake('stone', 1, 99, K, { spring: 0 }), hour: 500, spring: true });
    eq(swapped.shelf.length, SHELF_CAP, 'still sixteen');
    eq(swapped.shelf[5].n.family, 'stone', 'the new one takes the old one\'s place');
    assert(!swapped.shelf.some((e) => e.id === out), 'the old one is gone');
    const less = letGo(swapped, swapped.shelf[0].id);
    eq(less.shelf.length, SHELF_CAP - 1, 'one let go');
    eq(new Set(less.shelf.map((e) => e.id)).size, less.shelf.length, 'ids stay unique');
    eq(cleanShelf(null).shelf.length, 0, 'nothing readable is an empty shelf');
    eq(cleanShelf({ shelf: [{ id: 1, n: { family: 'shell' }, hour: 3 }, { bad: true }] }).shelf.length, 1, 'unreadable entries are dropped');
  });

  test(KEEPSAKES, 'the shelf goes into the save and comes back, and an older save gets an empty one', async () => {
    const K = await recipe();
    const s = keep(emptyShelf(), { n: rollKeepsake('bottle', 3, 1, K, { spring: 1 }, 'rare'), hour: 36, spring: true }).state;
    const { header, sections } = snapshot(/** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
      unlocks: {}, view: null, looks: {}, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0, keepsakes: s }));
    eq(header.format, FORMAT, 'written at this build\'s format');
    eq(FORMAT, 6, 'format 6');
    const back = restore(Object.fromEntries(sections));
    eq(JSON.stringify(back.keepsakes), JSON.stringify(s), 'the shelf comes back exactly');
    const old = migrate({ meta: {}, pieces: { version: 1, list: [], nextId: 1, arrived: false } }, 5);
    eq(JSON.stringify(old.keepsakes), JSON.stringify(emptyShelf()), 'a format 5 island gets an empty shelf');
  });

  test(KEEPSAKES, 'every form and tier in the recipe can be made', async () => {
    const K = await recipe();
    /** @type {Set<string>} */ const forms = new Set();
    for (const r of K.rarity.order) for (let i = 0; i < 400; i++) forms.add(rollShell(13, i, K, { spring: 1 }, r).form);
    eq([...forms].sort().join(','), K.shells.forms.map((/** @type {any} */ f) => f.id).sort().join(','), 'all forms appear');
  });
}
