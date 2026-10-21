// @ts-check
// Keepsake artifact tests for tools/unit-tests.html (docs/future/12). The nine baked models: each
// loads, is under 4,000 triangles, sits base down on y = 0 at its recipe size, has a credit entry,
// and the recipe's measured stats are current. The variants made from them: the same seed gives
// the same artifact, a kept one rebuilds exactly, every one is sound (finite, sized, on the ground),
// the variety does not run dry (shapes, colours, names), rarity widens it, the marks do what they
// say, names follow the numbers, and the shelf sketch traces.

import { loadFindModel } from '../src/world/finds/models.js';
import { loadArtifactBases, redescribe } from '../src/world/keepsakes/families/artifact.js';
import { colorWord, recolor } from '../src/world/keepsakes/families/artifact-color.js';
import { keepsakeMesh, keepsakeWords, rollKeepsake } from '../src/world/keepsakes/families/index.js';
import { keepsakeSvg, traceKeepsake } from '../src/ui/sketches/keepsake.js';

const G = 'keepsake artifacts';

async function artifactRecipe() {
  const r = await fetch('../recipes/world/keepsake-artifacts.json');
  if (!r.ok) throw new Error(`recipes/world/keepsake-artifacts.json: HTTP ${r.status}`);
  return r.json();
}

async function keepsakeRecipe() {
  const r = await fetch('../recipes/world/keepsakes.json');
  if (!r.ok) throw new Error(`recipes/world/keepsakes.json: HTTP ${r.status}`);
  const K = await r.json();
  await loadArtifactBases(K);
  return K;
}

/** @param {string} url @returns {Promise<{ tris: number, minY: number, size: number, mean: number[], dims: number[] }>} */
async function measure(url) {
  const parts = await loadFindModel('../' + url);
  let tris = 0, n = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], mean = [0, 0, 0];
  for (const p of parts) {
    tris += p.indices.length / 3;
    for (let i = 0; i < p.count; i++, n++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.vertices[i * 9 + k]); hi[k] = Math.max(hi[k], p.vertices[i * 9 + k]); mean[k] += p.vertices[i * 9 + 6 + k]; }
  }
  const dims = hi.map((h, k) => h - lo[k]);
  return { tris, minY: lo[1], size: Math.max(...dims), mean: mean.map((m) => m / n), dims };
}

/** A mesh's size, lowest point, non-finite count and triangle count. @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} m */
function sound(m) {
  let bad = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < m.count; v++) {
    for (let c = 0; c < 9; c++) if (!Number.isFinite(m.vertices[v * 9 + c])) bad++;
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.vertices[v * 9 + c]); hi[c] = Math.max(hi[c], m.vertices[v * 9 + c]); }
  }
  return { bad, minY: lo[1], size: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), dims: hi.map((h, k) => h - lo[k]), tris: m.indices.length / 3 };
}

const COND = { spring: 1, season: 'winter' };

/** @param {(g: string, n: string, f: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addKeepsakeArtifactTests(test, assert, eq) {
  test(G, 'the recipe lists nine artifacts with unique ids and the plain fields', async () => {
    const R = await artifactRecipe();
    eq(R.artifacts.length, 9, 'nine artifacts');
    eq(new Set(R.artifacts.map((/** @type {any} */ a) => a.id)).size, 9, 'unique ids');
    for (const a of R.artifacts) {
      assert(a.name && a.url && a.sizeM > 0 && a.rotDeg.length === 3 && a.view.length === 2, `${a.id}: name, url, sizeM, rotDeg, view`);
      assert(a.observations.length >= 3, `${a.id}: three or more observations`);
      for (const o of a.observations) assert(o.length > 10 && o.endsWith('.') && !/genuine/i.test(o), `${a.id}: a plain observation (${o})`);
      assert(a.nouns.length === 3 && a.nouns.every((/** @type {any} */ x) => x[1].length >= 2), `${a.id}: nouns by shape, with synonyms`);
      // One weight per rarity tier: five since "once in a lifetime" (October 21, 2026).
      assert(a.weights.length === 5 && a.stats?.dims?.length === 3 && a.stats?.mean?.length === 3, `${a.id}: tier weights and measured stats`);
    }
  });

  test(G, 'every model loads, is under 4,000 triangles, sits base on y = 0 at its recipe size', async () => {
    const R = await artifactRecipe();
    for (const a of R.artifacts) {
      const m = await measure(a.url);
      assert(m.tris > 0 && m.tris < 4000, `${a.id}: ${m.tris} triangles`);
      assert(Math.abs(m.minY) < 1e-5, `${a.id}: base on y = ${m.minY}`);
      assert(m.size >= 0.03 && m.size <= 0.12, `${a.id}: ${m.size} m largest extent`);
      assert(Math.abs(m.size - a.sizeM) < 0.002, `${a.id}: recipe sizeM ${a.sizeM} but the model is ${m.size.toFixed(4)} m`);
    }
  });

  test(G, 'the recipe\'s measured stats match the models (run tools/artifact-base-stats.mjs if not)', async () => {
    const R = await artifactRecipe();
    for (const a of R.artifacts) {
      const m = await measure(a.url);
      for (let k = 0; k < 3; k++) {
        assert(Math.abs(m.dims[k] - a.stats.dims[k]) < 2e-5, `${a.id}: dims ${k} are ${m.dims[k]}, the recipe says ${a.stats.dims[k]}`);
        assert(Math.abs(m.mean[k] - a.stats.mean[k]) < 2e-5, `${a.id}: mean colour ${k} is ${m.mean[k]}, the recipe says ${a.stats.mean[k]}`);
      }
    }
  });

  test(G, 'the old bullet is 3 to 4 cm long, and every bullet variant stays so', async () => {
    const K = await keepsakeRecipe();
    const b = K.artifacts.artifacts.find((/** @type {any} */ a) => a.id === 'old-bullet');
    assert(b, 'the old bullet is in the recipe');
    const m = await measure(b.url);
    assert(m.size >= 0.03 && m.size <= 0.04, `bullet ${m.size} m`);
    let seen = 0;
    for (let i = 0; i < 1500 && seen < 12; i++) {
      const n = rollKeepsake('artifact', 5, i, K, COND, 'veryRare');
      if (n.base !== 'old-bullet') continue;
      seen++;
      assert(n.sizeM >= 0.03 && n.sizeM <= 0.04, `bullet variant ${n.sizeM} m`);
    }
    assert(seen >= 6, 'bullet variants turn up');
  });

  test(G, 'every model has a credit entry (title, author link, license, files) in CREDITS.md', async () => {
    const R = await artifactRecipe();
    const r = await fetch('../assets/models/keepsakes/CREDITS.md');
    assert(r.ok, `CREDITS.md: HTTP ${r.status}`);
    const sections = (await r.text()).split(/\n## /);
    for (const a of R.artifacts) {
      const file = a.url.split('/').pop();
      const sec = sections.find((s) => s.includes('`' + file + '`'));
      assert(sec, `${a.id}: no CREDITS entry lists ${file}`);
      assert(/This work is based on ".+" \(https:\/\/sketchfab\.com\/3d-models\/.+\) by .+ licensed under CC-BY-4\.0/.test(sec ?? ''), `${a.id}: credit line incomplete`);
      assert(/- Changes: /.test(sec ?? ''), `${a.id}: no changes listed`);
    }
  });

  // ---- The variants ----

  test(G, 'the same seed and slot make the same artifact; another slot makes another', async () => {
    const K = await keepsakeRecipe();
    eq(JSON.stringify(rollKeepsake('artifact', 7, 3, K, COND)), JSON.stringify(rollKeepsake('artifact', 7, 3, K, COND)), 'same numbers');
    assert(JSON.stringify(rollKeepsake('artifact', 7, 3, K, COND)) !== JSON.stringify(rollKeepsake('artifact', 7, 4, K, COND)), 'a different slot differs');
  });

  test(G, 'a kept artifact\'s numbers rebuild the same mesh, sized and on the ground, whatever the tier', async () => {
    const K = await keepsakeRecipe();
    for (const r of K.rarity.order) {
      for (let i = 0; i < 40; i++) {
        const n = rollKeepsake('artifact', 3, i, K, COND, r);
        const kept = JSON.parse(JSON.stringify(n));
        const a = keepsakeMesh(n, K), b = keepsakeMesh(kept, K);
        eq(a.count, b.count, `${r} ${i}: same vertex count`);
        let same = true;
        for (let k = 0; k < a.vertices.length; k++) if (a.vertices[k] !== b.vertices[k]) { same = false; break; }
        assert(same, `${r} ${i}: the kept numbers rebuild it exactly`);
        const s = sound(a);
        eq(s.bad, 0, `${r} ${i} (${n.name}): every number finite`);
        assert(Math.abs(s.minY) < 1e-6, `${r} ${i}: base on y = 0`);
        assert(Math.abs(s.size - n.sizeM) < n.sizeM * 0.01, `${r} ${i} (${n.name}): largest extent ${s.size} is its size ${n.sizeM}`);
        assert(s.tris > 200 && s.tris < 6000, `${r} ${i}: ${s.tris} triangles`);
        for (let v = 0; v < a.count; v++) {
          const l = Math.hypot(a.vertices[v * 9 + 3], a.vertices[v * 9 + 4], a.vertices[v * 9 + 5]);
          assert(Math.abs(l - 1) < 1e-3, `${r} ${i}: unit normals`);
          for (let c = 6; c < 9; c++) assert(a.vertices[v * 9 + c] >= -1e-4 && a.vertices[v * 9 + c] <= 1.0001, `${r} ${i}: colours within the display`);
        }
      }
    }
  });

  test(G, 'the variety does not run dry: all nine bases, hundreds of names, many colours, shapes that differ', async () => {
    const K = await keepsakeRecipe();
    /** @type {Set<string>} */ const names = new Set(), colours = new Set(), bases = new Set(), nouns = new Set();
    /** @type {Record<string, number[]>} */ const aspects = {};
    for (let i = 0; i < 400; i++) {
      const n = rollKeepsake('artifact', 11, i, K, COND);
      names.add(n.name); colours.add(n.colorName); bases.add(n.base); nouns.add(n.noun);
      if (i < 240) {
        const s = sound(keepsakeMesh(n, K));
        (aspects[n.base] ??= []).push(s.dims[1] / Math.max(s.dims[0], s.dims[2]));
      }
    }
    eq(bases.size, 9, 'every base turns up');
    assert(names.size >= 250, `${names.size} different names in 400 (want 250)`);
    assert(colours.size >= 25, `${colours.size} colour words`);
    assert(nouns.size >= 30, `${nouns.size} object words`);
    // Within a base the proportions differ a good deal: the spread of height over width.
    for (const [base, a] of Object.entries(aspects)) {
      if (a.length < 8) continue;
      const mean = a.reduce((x, y) => x + y, 0) / a.length, sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
      assert(sd / mean > 0.1, `${base}: proportions vary (spread ${(sd / mean).toFixed(3)} of ${mean.toFixed(2)})`);
    }
  });

  test(G, 'rarity widens the morph and lifts the marks; every mark turns up at the top', async () => {
    const K = await keepsakeRecipe();
    const spread = (/** @type {string} */ r) => {
      let s = 0;
      for (let i = 0; i < 600; i++) {
        const m = rollKeepsake('artifact', 4, i, K, COND, /** @type {any} */ (r)).morph;
        s += Math.abs(m.sx - 1) + Math.abs(m.sy - 1) + Math.abs(m.sz - 1) + Math.abs(m.twist) + Math.abs(m.bend) + Math.abs(m.taper) + m.lump * 4 + Math.abs(m.swell) + Math.abs(m.shear);
      }
      return s / 600;
    };
    const common = spread('common'), uncommon = spread('uncommon'), rare = spread('rare'), very = spread('veryRare');
    assert(common < uncommon && uncommon < rare && rare < very, `spread grows with rarity: ${[common, uncommon, rare, very].map((x) => x.toFixed(2)).join(' < ')}`);
    /** @type {Record<string, number>} */ const top = {};
    let marksCommon = 0, marksTop = 0;
    for (let i = 0; i < 3000; i++) {
      const n = rollKeepsake('artifact', 4, i, K, COND, 'veryRare');
      if (n.mark) { marksTop++; top[n.mark] = (top[n.mark] ?? 0) + 1; }
      if (rollKeepsake('artifact', 4, i, K, COND, 'common').mark) marksCommon++;
    }
    assert(marksTop > marksCommon * 2, `marks at least twice as common when very rare (${marksTop} against ${marksCommon})`);
    for (const id of Object.keys(K.artifacts.marks)) assert(top[id] > 0, `the ${id} mark turns up`);
  });

  test(G, 'each mark does what its card says: broken has a flat face, a pair is two bodies, gilded shows gold', async () => {
    const K = await keepsakeRecipe();
    const find = (/** @type {string} */ mark) => {
      for (let i = 0; i < 6000; i++) { const n = rollKeepsake('artifact', 8, i, K, COND, 'veryRare'); if (n.mark === mark) return n; }
      throw new Error('no ' + mark);
    };
    const broken = find('broken'), whole = { ...broken, mark: null, cut: null };
    const mb = keepsakeMesh(broken, K), mw = keepsakeMesh(whole, K);
    // The cut face: many vertices share one flat normal, and the piece is smaller than it was whole.
    const key = (/** @type {number} */ v) => [3, 4, 5].map((c) => mb.vertices[v * 9 + c].toFixed(3)).join(',');
    /** @type {Record<string, number>} */ const tally = {};
    for (let v = 0; v < mb.count; v++) tally[key(v)] = (tally[key(v)] ?? 0) + 1;
    assert(Math.max(...Object.values(tally)) > mb.count * 0.04, 'a flat face on the break');
    assert(broken.desc.includes(K.artifacts.marks.broken.word) && broken.name.startsWith('Broken'), 'the card and name say broken');
    assert(mw.count === mb.count, 'the cut moves vertices, it does not add them');
    const pair = find('pair'), mp = keepsakeMesh(pair, K), one = keepsakeMesh({ ...pair, mark: null, twin: null }, K);
    eq(mp.count, one.count * 2, 'a pair has two bodies');
    assert(pair.name.startsWith('Twinned'), 'named twinned');
    const gilded = find('gilded'), plain = { ...gilded, mark: null, color: { ...gilded.color, gilt: 0 } };
    const gold = (/** @type {any} */ m) => { let s = 0; for (let v = 0; v < m.count; v++) s += m.vertices[v * 9 + 6] - m.vertices[v * 9 + 8]; return s / m.count; };
    assert(gold(keepsakeMesh(gilded, K)) > gold(keepsakeMesh(plain, K)), 'gilding adds yellow');
    assert(gilded.name.startsWith('Gilded'), 'named gilded');
  });

  test(G, 'names follow the numbers: a stretched bowl is a cup, a squashed one a dish, and words stay plain', async () => {
    const K = await keepsakeRecipe();
    let bowl = null;
    for (let i = 0; i < 400 && !bowl; i++) { const n = rollKeepsake('artifact', 2, i, K, COND, 'common'); if (n.base === 'rice-bowl') bowl = n; }
    assert(bowl, 'a bowl');
    const tall = redescribe({ ...bowl, morph: { ...bowl.morph, sx: 0.8, sy: 1.6, sz: 0.8 } }, K), flat = redescribe({ ...bowl, morph: { ...bowl.morph, sx: 1.3, sy: 0.6, sz: 1.3 } }, K);
    const B = K.artifacts.artifacts.find((/** @type {any} */ a) => a.id === 'rice-bowl');
    assert(B.nouns[2][1].includes(tall.noun), `a tall one is ${tall.noun}, one of ${B.nouns[2][1]}`);
    assert(B.nouns[0][1].includes(flat.noun), `a flat one is ${flat.noun}, one of ${B.nouns[0][1]}`);
    for (let i = 0; i < 300; i++) {
      const n = rollKeepsake('artifact', 6, i, K, COND);
      assert(/^[A-Z][a-z]+(?:[- ][a-z]+)*$/.test(n.name), `a plain name: "${n.name}"`);
      assert(!/genuine/i.test(n.name + n.desc), 'never that word');
      assert(n.desc.endsWith('.') && n.desc.length > 30 && keepsakeWords(n, K) === n.desc, `a card line: ${n.desc}`);
      assert(n.desc.toLowerCase().includes(n.colorName) && n.desc.toLowerCase().includes(n.noun), `the card names its colour and object: ${n.desc}`);
    }
  });

  test(G, 'colour words are plain and recolouring stays inside the display\'s colours', () => {
    eq(colorWord([0.002, 0.002, 0.002]), 'black', 'black');
    eq(colorWord([0.9, 0.9, 0.9]), 'white', 'white');
    assert(/green|moss|lime|emerald|sage|mint/.test(colorWord([0.05, 0.4, 0.05])), 'a green');
    assert(/blue|azure|navy|denim|cornflower|powder|indigo|midnight|periwinkle/.test(colorWord([0.03, 0.08, 0.6])), 'a blue');
    for (let h = -180; h <= 180; h += 30) {
      for (const c of [[0.8, 0.1, 0.05], [0.05, 0.3, 0.1], [0.5, 0.5, 0.5], [0.02, 0.02, 0.02]]) {
        const o = recolor(/** @type {any} */ (c), { hue: (h * Math.PI) / 180, chroma: 1.6, lightMul: 1.2, lightAdd: 0, tintHue: 2, tintChroma: 0.13 });
        assert(o.every((x) => x >= 0 && x <= 1 && Number.isFinite(x)), `hue ${h}: inside the display`);
      }
    }
  });

  test(G, 'an artifact\'s shelf sketch traces the same every time, with an outline and a colour wash', async () => {
    const K = await keepsakeRecipe();
    for (let i = 0; i < 10; i++) {
      const n = rollKeepsake('artifact', 21, i, K, COND, /** @type {any} */ (K.rarity.order[i % 4]));
      const mesh = keepsakeMesh(n, K);
      const a = traceKeepsake(mesh, n, n.view), b = traceKeepsake(mesh, n, n.view);
      eq(JSON.stringify(a), JSON.stringify(b), `${n.name}: same tracing`);
      assert(a.outline.length > 8, `${n.name}: an outline`);
      assert((a.wash ?? []).flat().some((c) => c), `${n.name}: a colour wash`);
      assert(keepsakeSvg(a, n.name).startsWith('<svg'), `${n.name}: an SVG`);
    }
  });
}
