// @ts-check
// The test files the unit test page spreads over all cores. Each one only needs pure
// modules and fetch, so it runs the same in a worker as on the page. Tests that need the
// page itself (WebGPU, the worker pool, timers against the frame) stay in unit-tests.js.

/** @typedef {(test: (group: string, name: string, fn: () => any) => void, assert: (cond: any, msg?: string) => void, eq: (a: any, b: any, msg?: string) => void) => void} AddTests */

/** @type {Record<string, () => Promise<AddTests>>} */
export const PARALLEL = {
  growth: () => import('./unit-tests-growth.js').then((m) => m.addGrowthTests),
  journal: () => import('./unit-tests-journal.js').then((m) => m.addJournalTests),
  spring: () => import('./unit-tests-spring.js').then((m) => m.addSpringTests),
  creatures: () => import('./unit-tests-creatures.js').then((m) => m.addCreatureTests),
  islands: () => import('./unit-tests-islands.js').then((m) => m.addIslandTests),
  ecology: () => import('./unit-tests-ecology.js').then((m) => m.addEcologyTests),
  frogs: () => import('./unit-tests-frogs.js').then((m) => m.addFrogTests),
  save: () => import('./unit-tests-save.js').then((m) => m.addSaveTests),
  away: () => import('./unit-tests-away.js').then((m) => m.addAwayTests),
  stone: () => import('./unit-tests-stone.js').then((m) => m.addStoneTests),
  cliff: () => import('./unit-tests-cliff.js').then((m) => m.addCliffTests),
  reveal: () => import('./unit-tests-reveal.js').then((m) => m.addRevealTests),
  trust: () => import('./unit-tests-trust.js').then((m) => m.addTrustTests),
  finds: () => import('./unit-tests-finds.js').then((m) => m.addFindsTests),
  naturalist: () => import('./unit-tests-naturalist.js').then((m) => m.addNaturalistTests),
  pondlife: () => import('./unit-tests-pondlife.js').then((m) => m.addPondLifeTests),
  pieces: () => import('./unit-tests-pieces.js').then((m) => m.addPiecesTests),
  damselflies: () => import('./unit-tests-damselflies.js').then((m) => m.addDamselflyTests),
  autumn: () => import('./unit-tests-autumn.js').then((m) => m.addAutumnTests),
  keepsakes: () => import('./unit-tests-keepsakes.js').then((m) => m.addKeepsakeTests),
  cove: () => import('./unit-tests-cove.js').then((m) => m.addCoveTests),
  keepsakeArtifacts: () => import('./unit-tests-keepsake-artifacts.js').then((m) => m.addKeepsakeArtifactTests),
  walk: () => import('./unit-tests-walk.js').then((m) => m.addWalkTests),
  figure: () => import('./unit-tests-figure.js').then((m) => m.addFigureTests),
  nets: () => import('./unit-tests-nets.js').then((m) => m.addNetsTests),
};

/** @param {any} cond @param {string} [msg] */
export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
/** @param {any} a @param {any} b @param {string} [msg] */
export function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${String(b)}, got ${String(a)}`.trim());
}

/** Runs one test and times it. @param {() => any} fn */
export async function runOne(fn) {
  const t0 = performance.now();
  let ok = true, detail = '';
  try {
    const r = await fn();
    if (typeof r === 'string') detail = r;
  } catch (e) {
    ok = false;
    detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return { ok, detail, ms: performance.now() - t0 };
}
