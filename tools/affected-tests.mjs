// Which unit tests a change needs (Matt, October 22 and 31, 2026): a branch runs the groups its
// changes reach, while it works and at handoff, with `node tools/run-tests.mjs --affected` (which
// asks this file); the full suite runs once, on the combined tip in the orchestrator's merge queue.
// Node, no npm packages.
//
//   node tools/affected-tests.mjs                  what this branch changed against origin/main
//   node tools/affected-tests.mjs src/a.js b.json  these files instead
//
// It prints the groups to run, the Node command and the page link (tools/unit-tests.html?groups=...),
// and whether tools/determinism.html is needed. A group is one test file in tools/unit-tests-index.js (by its
// key, its file name: tools/unit-tests-<key>.js), or one group of the tests still written on the
// test page itself (by its name, as a slug: workers, palette).
//
// How a group reaches a file: the test file's imports (static, dynamic and new URL(...)), followed
// through src/ recursively, and the files its code names in strings: a recipe id ('world/walker',
// as recipes/index.json lists them), a path to a recipe, a shader by name ('terrain-draw'; with its
// `// #include`s) or an asset. A string with a `${...}` in it reaches every file under its fixed
// start ('flora/${sp}' reaches every flora recipe). A page group reaches what its own tests and the
// page helpers they call use.
//
// What runs:
//   - the CORE always: rng, the save format and its upgrades, and a quick determinism smoke;
//   - every group that reaches a changed file;
//   - the FULL suite when a changed file is reached by nothing and is not on the lists below, or
//     when the test runner itself changed, so nothing is ever skipped by accident.
// Files no unit test reaches and that are only seen on screen (the app shell, the DOM UI, render
// passes and shaders, NO_UNIT_TESTS) run the core and say so: check those in the game. A render
// file or shader a test does reach (the palette's lib-oklab) maps to that test as usual. Docs and notes (NO_TESTS) need no tests.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanTests } from './index-tests.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..');

/** Groups that always run: quick, and they guard what every island depends on (as in tools/unit-tests-parallel.js). */
export const CORE = ['rng', 'save', 'format9', 'smoke'];
/** Files that need no tests (both runners check the test list whenever they run). */
export const NO_TESTS = [/^tools\/unit-tests-index\.js$/, /^tools\/typecheck-baseline\.json$/, /^docs\//, /\.md$/i, /^brand\//, /^\.claude\//, /^\.gitignore$/, /^\.gitattributes$/, /^LICENSE/i];
/** Files no unit test can reach (the app shell, the DOM UI): the core runs, and a note says to check them in the game. */
export const NO_UNIT_TESTS = [/^src\/app\.js$/, /^src\/main\.js$/, /^src\/ui\//, /^index\.html$/, /^src\/render\//, /^src\/shaders\//, /^play\.cmd$/, /^tools\/(?!unit-tests).*\.(html|js|mjs|css)$/, /^tools\/assets\/(?!models\.json)/];
/** The test runner itself: a change here runs everything. */
export const RUNNER = [/^tools\/unit-tests\.(js|html)$/, /^tools\/unit-tests-(parallel|worker)\.js$/, /^tools\/affected-tests\.mjs$/, /^tools\/(run-tests|run-tests-env|run-tests-env-worker|index-tests)\.mjs$/];
/** Changes that also need tools/determinism.html. */
export const DETERMINISM = [/^src\/sim\//, /^src\/world\//, /^src\/save\//, /^src\/core\/rng\.js$/, /^recipes\/world\//];

/** A group name as a page link slug: 'sky and seasons' -> 'sky-and-seasons'. @param {string} s */
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Repo-relative, forward slashes. @param {string} abs */
const rel = (abs) => relative(REPO, abs).split('\\').join('/');

/** Every file under a folder, repo-relative. @param {string} dir */
function walk(dir) {
  /** @type {string[]} */ const out = [];
  const abs = join(REPO, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); } else out.push(p);
  }
  return out;
}

/** String literals in a source, with whether each holds a `${...}`. @param {string} src */
function strings(src) {
  /** @type {{ text: string, template: boolean }[]} */ const out = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) out.push({ text: m[3], template: m[3].includes('${') });
    else out.push({ text: m[1] ?? m[2], template: false });
  }
  return out;
}

/** The repo's files that string references can name. */
function catalog() {
  const recipes = new Map();
  try {
    const idx = JSON.parse(readFileSync(join(REPO, 'recipes/index.json'), 'utf8'));
    const list = idx.recipes ?? idx;
    for (const [id, path] of Object.entries(list)) if (typeof path === 'string') recipes.set(id, `recipes/${path}`);
  } catch { /* no index */ }
  const shaders = new Map(walk('src/shaders').filter((f) => f.endsWith('.wgsl')).map((f) => [posix.basename(f, '.wgsl'), f]));
  const files = new Set([...walk('recipes'), ...walk('assets'), ...walk('src'), ...walk('tools')]);
  return { recipes, shaders, files };
}

/**
 * The files one source file names: its imports, and the recipes, shaders and assets its strings point at.
 * @param {string} file repo-relative @param {ReturnType<typeof catalog>} cat
 * @returns {string[]}
 */
function refsOf(file, cat) {
  const abs = join(REPO, file);
  if (!existsSync(abs)) return [];
  const src = readFileSync(abs, 'utf8');
  /** @type {Set<string>} */ const out = new Set();
  const dir = posix.dirname(file);
  if (file.endsWith('.wgsl')) {
    for (const m of src.matchAll(/\/\/\s*#include\s+([\w-]+)/g)) { const s = cat.shaders.get(m[1]); if (s) out.add(s); }
    return [...out];
  }
  if (!/\.(m?js)$/.test(file)) return [];
  /**
   * A relative path from this file, if it names a repo file; else from src/, as a worker job names
   * its module ({ module: './sim/away.js' }, src/core/workers.js). @param {string} p
   */
  const local = (p) => {
    const r = posix.normalize(posix.join(dir, p));
    if (cat.files.has(r)) return r;
    const s = posix.normalize(posix.join('src', p));
    return p.startsWith('./') && cat.files.has(s) ? s : null;
  };
  for (const { text, template } of strings(src)) {
    if (template) {
      // Everything under the fixed start: '../recipes/flora/${sp}.json', 'flora/${sp}'.
      const head = text.slice(0, text.indexOf('${'));
      if (!head) continue;
      const asPath = head.startsWith('.') ? posix.normalize(posix.join(dir, head)) : null;
      // A loader of any recipe (`../recipes/${p}.json`) is called with the ids written out
      // elsewhere ('world/seasons'), which are read as ids: it does not reach every recipe itself.
      if (asPath && /^recipes\/?$/.test(asPath)) continue;
      for (const f of cat.files) if (asPath && f.startsWith(asPath) && asPath.length > 4) out.add(f);
      if (head.length >= 3) for (const [id, f] of cat.recipes) if (id.startsWith(head)) out.add(f);
      continue;
    }
    if (text.startsWith('.')) { const r = local(text); if (r) out.add(r); continue; }
    const recipe = cat.recipes.get(text);
    if (recipe) { out.add(recipe); continue; }
    const shader = cat.shaders.get(text);
    if (shader) { out.add(shader); continue; }
    if (/^(recipes|assets|src)\//.test(text) && cat.files.has(text)) out.add(text);
  }
  return [...out];
}

/** Every file a set of files reaches, following imports through src/ and tools/. @param {string[]} start @param {ReturnType<typeof catalog>} cat */
function reach(start, cat, memo = new Map()) {
  /** @type {Set<string>} */ const seen = new Set();
  const todo = [...start];
  while (todo.length) {
    const f = /** @type {string} */ (todo.pop());
    if (seen.has(f)) continue;
    seen.add(f);
    let refs = memo.get(f);
    if (!refs) { refs = refsOf(f, cat); memo.set(f, refs); }
    // The runner's own files (the test list imports every test file) are not what a test is about.
    for (const r of refs) if (!seen.has(r) && !RUNNER.some((x) => x.test(r))) todo.push(r);
  }
  return seen;
}

/**
 * The page's own test groups: each group's tests, and the page helpers they call, as the imports
 * and strings they use. @param {ReturnType<typeof catalog>} cat
 * @returns {Map<string, string[]>} group slug -> the files it names directly
 */
function pageGroups(cat) {
  const file = 'tools/unit-tests.js';
  const whole = readFileSync(join(REPO, file), 'utf8');
  // The tests and their helpers only: the runner below them loads every test file.
  const cut = whole.indexOf('// ---- runner and rendering ----');
  const src = cut > 0 ? whole.slice(0, cut) : whole;
  // Imported names -> their module.
  /** @type {Map<string, string>} */ const names = new Map();
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const mod = posix.normalize(posix.join('tools', m[2]));
    const what = m[1];
    for (const n of what.replace(/[{}]/g, ' ').split(',')) {
      const parts = n.trim().split(/\s+as\s+|\s+/).filter(Boolean);
      const local = parts[parts.length - 1];
      if (local && local !== '*') names.set(local, mod);
    }
  }
  // Group constants: const SKY = 'sky and seasons'.
  /** @type {Map<string, string>} */ const consts = new Map();
  for (const m of src.matchAll(/^const (\w+) = '([^']+)';/gm)) consts.set(m[1], m[2]);
  // Top-level helpers: their text, so a group that calls one reaches what it uses.
  /** @type {Map<string, string>} */ const helpers = new Map();
  const tops = [...src.matchAll(/^(?:async )?function (\w+)|^(?:const|let) (\w+) =/gm)];
  tops.forEach((m, i) => helpers.set(m[1] ?? m[2], src.slice(m.index, tops[i + 1]?.index ?? src.length)));
  // Each test call's text, up to the next top-level statement.
  const calls = [...src.matchAll(/^test\((\w+|'[^']*'),/gm)];
  const ends = [...src.matchAll(/^(?:test\(|const |let |function |async function |\/\/ ----)/gm)].map((m) => m.index);
  /** @type {Map<string, Set<string>>} */ const groups = new Map();
  for (const c of calls) {
    const g = c[1].startsWith("'") ? c[1].slice(1, -1) : consts.get(c[1]) ?? c[1];
    const end = ends.find((e) => e > c.index) ?? src.length;
    let text = src.slice(c.index, end);
    // The helpers it calls, and theirs.
    const used = new Set();
    for (let more = true; more;) {
      more = false;
      for (const [h, body] of helpers) {
        if (!used.has(h) && new RegExp(`\\b${h}\\b`).test(text)) { used.add(h); text += body; more = true; }
      }
    }
    const set = groups.get(slug(g)) ?? new Set();
    for (const [n, mod] of names) if (!RUNNER.some((x) => x.test(mod)) && new RegExp(`\\b${n}\\b`).test(text)) set.add(mod);
    // Strings in its text: write a scratch copy of the slice through refsOf's rules.
    for (const r of refsInText(text, 'tools', cat)) set.add(r);
    groups.set(slug(g), set);
  }
  return new Map([...groups].map(([g, s]) => [g, [...s]]));
}

/** refsOf's string rules on a piece of text. @param {string} text @param {string} dir @param {ReturnType<typeof catalog>} cat */
function refsInText(text, dir, cat) {
  /** @type {Set<string>} */ const out = new Set();
  for (const { text: t, template } of strings(text)) {
    if (template) {
      const head = t.slice(0, t.indexOf('${'));
      const asPath = head.startsWith('.') ? posix.normalize(posix.join(dir, head)) : null;
      if (asPath && /^recipes\/?$/.test(asPath)) continue;
      for (const f of cat.files) if (asPath && f.startsWith(asPath) && asPath.length > 4) out.add(f);
      continue;
    }
    if (t.startsWith('.')) { const r = posix.normalize(posix.join(dir, t)); if (cat.files.has(r)) out.add(r); continue; }
    const recipe = cat.recipes.get(t) ?? cat.shaders.get(t);
    if (recipe) out.add(recipe);
  }
  return [...out];
}

/**
 * Every group and every file it reaches.
 * @returns {Map<string, Set<string>>} group -> repo-relative files
 */
export function buildMap() {
  const cat = catalog();
  const memo = new Map();
  /** @type {Map<string, Set<string>>} */ const map = new Map();
  for (const key of Object.keys(scanTests())) map.set(key, reach([`tools/unit-tests-${key}.js`], cat, memo));
  for (const [g, files] of pageGroups(cat)) map.set(g, reach(files, cat, memo));
  return map;
}

/**
 * What a set of changed files needs.
 * @param {string[]} changed repo-relative @param {Map<string, Set<string>>} map buildMap()
 * @returns {{ full: boolean, groups: string[], determinism: boolean, untested: string[], why: string[] }}
 *   groups: what to run besides the core (all of them when full); untested: changed files no unit
 *   test reaches (check them in the game); why: the reasons for a full run
 */
export function affected(changed, map) {
  /** @type {Set<string>} */ const groups = new Set();
  /** @type {string[]} */ const untested = [], why = [];
  let full = false;
  const files = changed.map((f) => f.split('\\').join('/'));
  for (const f of files) {
    if (RUNNER.some((r) => r.test(f))) { full = true; why.push(`${f} is the test runner`); continue; }
    if (NO_TESTS.some((r) => r.test(f))) continue;
    let hit = false;
    for (const [g, reached] of map) if (reached.has(f)) { groups.add(g); hit = true; }
    if (hit) continue;
    if (NO_UNIT_TESTS.some((r) => r.test(f))) { untested.push(f); continue; }
    full = true;
    why.push(`${f} is reached by no test group`);
  }
  for (const c of CORE) groups.delete(c);
  const all = [...map.keys()].filter((g) => !CORE.includes(g));
  return {
    full, groups: full ? all.sort() : [...groups].sort(), untested, why,
    determinism: files.some((f) => DETERMINISM.some((r) => r.test(f))),
  };
}

/** The page link for a result. @param {ReturnType<typeof affected>} r */
export const pageUrl = (r) => (r.full ? 'tools/unit-tests.html' : r.groups.length ? `tools/unit-tests.html?groups=${r.groups.join(',')}` : 'tools/unit-tests.html?core');

/** GitHub Desktop's git (git is not on PATH on Matt's machine). */
function gitExe() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'GitHubDesktop');
  if (existsSync(base)) {
    const apps = readdirSync(base).filter((d) => d.startsWith('app-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const a of apps) {
      const p = join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe');
      if (existsSync(p)) return p;
    }
  }
  return 'git';
}

/** What this branch changed against origin/main, committed or not. */
export function changedFiles() {
  const git = gitExe();
  const run = (/** @type {string[]} */ args) => execFileSync(git, args, { cwd: REPO, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const committed = run(['diff', '--name-only', 'origin/main...HEAD']);
  const open = run(['status', '--porcelain', '--untracked-files=all']).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
  return [...new Set([...committed, ...open])];
}

// Run from the command line.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const given = process.argv.slice(2);
  const changed = given.length ? given : changedFiles();
  const t0 = Date.now();
  const map = buildMap();
  const r = affected(changed, map);
  console.log(`${changed.length} changed file${changed.length === 1 ? '' : 's'}; ${map.size} test groups mapped in ${Date.now() - t0} ms.`);
  if (r.full) console.log(`Full suite: ${r.why.join('; ')}.`);
  else console.log(`Groups: core (${CORE.join(', ')})${r.groups.length ? ` + ${r.groups.join(', ')}` : ' only'}.`);
  if (r.untested.length) console.log(`No unit test reaches ${r.untested.join(', ')}: check those by hand (in the game, or on their own tools page).`);
  const how = !given.length ? ' --affected' : r.full ? '' : r.groups.length ? ` --groups=${r.groups.join(',')}` : ' --core';
  console.log(`Run: node tools/run-tests.mjs${how} (or open ${pageUrl(r)})`);
  console.log(r.determinism ? 'Determinism: yes, open tools/determinism.html too.' : 'Determinism: not needed.');
}
