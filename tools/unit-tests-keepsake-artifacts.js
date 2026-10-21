// @ts-check
// Keepsake artifact tests for tools/unit-tests.html (docs/future/12): each model in
// recipes/world/keepsake-artifacts.json loads, is under 4,000 triangles, sits base down on y = 0 at its
// hand size, and has a credit entry in assets/models/keepsakes/CREDITS.md; the old bullet is 3 to 4 cm.

import { loadFindModel } from '../src/world/finds/models.js';

const G = 'keepsake artifacts';

async function artifactRecipe() {
  const r = await fetch('../recipes/world/keepsake-artifacts.json');
  if (!r.ok) throw new Error(`recipes/world/keepsake-artifacts.json: HTTP ${r.status}`);
  return r.json();
}

/** @param {string} url @returns {Promise<{ tris: number, minY: number, size: number }>} */
async function measure(url) {
  const parts = await loadFindModel('../' + url);
  let tris = 0, minY = Infinity;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    tris += p.indices.length / 3;
    for (let i = 0; i < p.count; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.vertices[i * 9 + k]); hi[k] = Math.max(hi[k], p.vertices[i * 9 + k]); }
  }
  minY = lo[1];
  return { tris, minY, size: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}

/** @param {(g: string, n: string, f: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addKeepsakeArtifactTests(test, assert, eq) {
  test(G, 'the recipe lists nine artifacts with unique ids and the plain fields', async () => {
    const R = await artifactRecipe();
    eq(R.artifacts.length, 9, 'nine artifacts');
    eq(new Set(R.artifacts.map((/** @type {any} */ a) => a.id)).size, 9, 'unique ids');
    for (const a of R.artifacts) {
      assert(a.name && a.url && a.sizeM > 0 && a.rotDeg.length === 3, `${a.id}: name, url, sizeM, rotDeg`);
      assert(a.observation.length > 10 && !/genuine/i.test(a.observation), `${a.id}: a plain observation`);
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

  test(G, 'the old bullet is 3 to 4 cm long', async () => {
    const R = await artifactRecipe();
    const b = R.artifacts.find((/** @type {any} */ a) => a.id === 'old-bullet');
    assert(b, 'the old bullet is in the recipe');
    const m = await measure(b.url);
    assert(m.size >= 0.03 && m.size <= 0.04, `bullet ${m.size} m`);
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
}
