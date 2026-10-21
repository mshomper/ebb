// Measures each baked keepsake artifact (assets/models/keepsakes/) and writes its stats into
// recipes/world/keepsake-artifacts.json: dims (width x, height y, depth z, meters) and mean (the
// average vertex colour, linear sRGB). The keepsake generator (src/world/keepsakes/families/artifact.js)
// uses them to name a variant before its mesh is loaded. Run from the repo root after a model is
// re-baked:
//   node tools/artifact-base-stats.mjs          writes the recipe
//   node tools/artifact-base-stats.mjs --check  only reports whether the stats are current
// Pure Node, no packages.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFindModel } from '../src/world/finds/models.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const file = join(ROOT, 'recipes/world/keepsake-artifacts.json');
const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
const recipe = JSON.parse(text);
const check = process.argv.includes('--check');
const r5 = (/** @type {number} */ x) => Math.round(x * 1e5) / 1e5;

/** @param {string} url */
function measure(url) {
  const f = join(ROOT, url);
  const gltf = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
  const buffers = gltf.buffers.map((/** @type {any} */ b) => { const n = readFileSync(join(dirname(f), b.uri)); return n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength); });
  const parts = parseFindModel(gltf, buffers);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], mean = [0, 0, 0];
  let n = 0;
  for (const p of parts) for (let i = 0; i < p.count; i++, n++) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p.vertices[i * 9 + k]); hi[k] = Math.max(hi[k], p.vertices[i * 9 + k]);
    mean[k] += p.vertices[i * 9 + 6 + k];
  }
  return { dims: hi.map((h, k) => r5(h - lo[k])), mean: mean.map((m) => r5(m / n)) };
}

let out = text, stale = 0;
for (const a of recipe.artifacts) {
  const s = measure(a.url);
  if (JSON.stringify(a.stats) !== JSON.stringify(s)) stale++;
  // The artifact's line in the file: replace or add its stats at the end of the object.
  const re = new RegExp(`(\\{ "id": "${a.id}",.*?)(, "stats": \\{.*?\\})? \\}(,?)$`, 'm');
  out = out.replace(re, (_, head, _old, comma) => `${head}, "stats": ${JSON.stringify(s).replace(/,"/g, ', "').replace(/":/g, '": ')} }${comma}`);
  console.log(a.id.padEnd(18), 'dims', s.dims.join(' x '), 'mean', s.mean.join(' '));
}
if (check) { console.log(stale ? `${stale} artifact(s) have stale stats` : 'stats are current'); process.exit(stale ? 1 : 0); }
writeFileSync(file, out);
console.log('wrote', file);
