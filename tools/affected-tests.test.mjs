// Tests for tools/affected-tests.mjs, against the real repo. Node (the mapper reads files, so it
// cannot run on the browser test page):  node tools/affected-tests.test.mjs
// Prints each check and exits non-zero if any fails.

import { buildMap, affected, pageUrl, CORE } from './affected-tests.mjs';

let failed = 0;
/** @param {string} name @param {() => void} fn */
function check(name, fn) {
  try { fn(); console.log(`passed ${name}`); } catch (e) { failed++; console.log(`FAILED ${name}: ${e instanceof Error ? e.message : e}`); }
}
/** @param {any} c @param {string} msg */
function assert(c, msg) { if (!c) throw new Error(msg); }

const map = buildMap();
const groups = [...map.keys()];

check('every test file and page group is mapped, the core among them', () => {
  assert(groups.length > 60, `${groups.length} groups`);
  for (const c of CORE) assert(map.has(c), `core group ${c} is mapped`);
  for (const g of ['pack', 'gather', 'click', 'sky-and-seasons', 'falls']) assert(map.has(g), `${g} is mapped`);
});

check('a file only one group reaches selects that group and the core', () => {
  const r = affected(['src/world/walk/click.js'], map);
  assert(!r.full, 'not the full suite');
  assert(r.groups.join() === 'click', `click.js selects ${r.groups.join() || 'nothing'}`);
  assert(pageUrl(r) === 'tools/unit-tests.html?groups=click', pageUrl(r));
  // And any other file with exactly one group, found from the map.
  const counts = new Map();
  for (const [g, files] of map) if (!CORE.includes(g)) for (const f of files) if (f.startsWith('src/')) counts.set(f, [...(counts.get(f) ?? []), g]);
  const only = [...counts].find(([, gs]) => gs.length === 1 && ![...map].some(([c, s]) => CORE.includes(c) && s.has(gs[0])));
  if (only) assert(affected([only[0]], map).groups.join() === only[1][0], `${only[0]} selects ${only[1][0]}`);
});

check('a shared core file selects every group that reaches it', () => {
  for (const f of ['src/core/events.js', 'src/core/store.js']) {
    const want = groups.filter((g) => !CORE.includes(g) && map.get(g)?.has(f)).sort();
    const r = affected([f], map);
    assert(!r.full, `${f}: not the full suite`);
    assert(r.groups.join() === want.join(), `${f}: ${r.groups.length} groups, wanted ${want.length}`);
    assert(want.length > 10, `${f} is reached by ${want.length} groups`);
  }
});

check('a recipe and a shader map to the tests that read them', () => {
  assert(affected(['recipes/world/pack.json'], map).groups.includes('pack'), 'pack.json selects pack');
  assert(affected(['src/shaders/lib-oklab.wgsl'], map).groups.includes('palette'), 'lib-oklab.wgsl selects the palette tests');
});

check('an unknown file, or the runner itself, runs the full suite; nothing is skipped silently', () => {
  for (const f of ['src/world/brand-new-thing.js', 'recipes/world/brand-new.json', 'tools/unit-tests.js', 'tools/unit-tests-parallel.js']) {
    const r = affected([f], map);
    assert(r.full && r.groups.length === groups.length - CORE.length && r.why.length, `${f} runs everything`);
    assert(pageUrl(r) === 'tools/unit-tests.html', pageUrl(r));
  }
});

check('docs need nothing; the DOM UI runs the core and says to check it in the game', () => {
  const docs = affected(['docs/README.md', 'README.md'], map);
  assert(!docs.full && !docs.groups.length && pageUrl(docs) === 'tools/unit-tests.html?core', 'docs: core only');
  const ui = affected(['src/ui/island-notes.js'], map);
  assert(!ui.full && ui.untested.join() === 'src/ui/island-notes.js', 'ui: named as untested');
});

check('determinism is asked for world, sim, save and rng changes only', () => {
  assert(affected(['src/world/pack/model.js'], map).determinism, 'src/world');
  assert(affected(['recipes/world/gather.json'], map).determinism, 'recipes/world');
  assert(affected(['src/core/rng.js'], map).determinism, 'rng');
  assert(!affected(['src/ui/island-notes.js', 'src/core/events.js'], map).determinism, 'ui and events');
});

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
