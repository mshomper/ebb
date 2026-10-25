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
  underlog: () => import('./unit-tests-under-log.js').then((m) => m.addUnderLogTests),
  damselflies: () => import('./unit-tests-damselflies.js').then((m) => m.addDamselflyTests),
  autumn: () => import('./unit-tests-autumn.js').then((m) => m.addAutumnTests),
  keepsakes: () => import('./unit-tests-keepsakes.js').then((m) => m.addKeepsakeTests),
  cove: () => import('./unit-tests-cove.js').then((m) => m.addCoveTests),
  keepsakeArtifacts: () => import('./unit-tests-keepsake-artifacts.js').then((m) => m.addKeepsakeArtifactTests),
  walk: () => import('./unit-tests-walk.js').then((m) => m.addWalkTests),
  figure: () => import('./unit-tests-figure.js').then((m) => m.addFigureTests),
  nets: () => import('./unit-tests-nets.js').then((m) => m.addNetsTests),
  trails: () => import('./unit-tests-trails.js').then((m) => m.addTrailsTests),
  forager: () => import('./unit-tests-forager.js').then((m) => m.addForagerTests),
  format9: () => import('./unit-tests-format9.js').then((m) => m.addFormat9Tests),
  assets: () => import('./unit-tests-assets.js').then((m) => m.addAssetTests),
  campLock: () => import('./unit-tests-camp-lock.js').then((m) => m.addCampLockTests),
  campGround: () => import('./unit-tests-camp-ground.js').then((m) => m.addCampGroundTests),
  campPieces: () => import('./unit-tests-camp-pieces.js').then((m) => m.addCampPieceTests),
  shoreSand: () => import('./unit-tests-shore-sand.js').then((m) => m.addShoreSandTests),
  campEdge: () => import('./unit-tests-camp-edge.js').then((m) => m.addCampEdgeTests),
  campPlants: () => import('./unit-tests-camp-plants.js').then((m) => m.addCampPlantsTests),
  pondSpring: () => import('./unit-tests-pond-spring.js').then((m) => m.addPondSpringTests),
  turtles: () => import('./unit-tests-turtles.js').then((m) => m.addTurtleTests),
  rigsSpring: () => import('./unit-tests-rigs-spring.js').then((m) => m.addRigsSpringTests),
  waterTable: () => import('./unit-tests-water-table.js').then((m) => m.addWaterTableTests),
  underLogMeshes: () => import('./unit-tests-under-log-meshes.js').then((m) => m.addUnderLogMeshTests),
  grace: () => import('./unit-tests-grace.js').then((m) => m.addGraceTests),
  boat: () => import('./unit-tests-boat.js').then((m) => m.addBoatTests),
  intro: () => import('./unit-tests-intro.js').then((m) => m.addIntroTests),
  campFire: () => import('./unit-tests-camp-fire.js').then((m) => m.addCampFireTests),
  pack: () => import('./unit-tests-pack.js').then((m) => m.addPackTests),
  gather: () => import('./unit-tests-gather.js').then((m) => m.addGatherTests),
  plantRules: () => import('./unit-tests-plant-rules.js').then((m) => m.addPlantRulesTests),
  click: () => import('./unit-tests-click.js').then((m) => m.addClickTests),
  items: () => import('./unit-tests-items.js').then((m) => m.addItemTests),
  herbs: () => import('./unit-tests-herbs.js').then((m) => m.addHerbTests),
  sowing: () => import('./unit-tests-sowing.js').then((m) => m.addSowingTests),
  // The audio tests that need no Web Audio (workers have none). The two that render sound through
  // an OfflineAudioContext (pond and keepsake sounds) stay on tools/unit-tests-audio.html, which
  // also still runs all of these, as does `node tools/run-audio-tests.mjs`.
  music: () => import('./unit-tests-music.js').then((m) => m.addMusicTests),
  chordsExtra: () => import('./unit-tests-chords-extra.js').then((m) => m.addChordExtraTests),
  sampler: () => import('./unit-tests-sampler.js').then((m) => m.addSamplerTests),
  voicing: () => import('./unit-tests-voicing.js').then((m) => m.addVoicingTests),
  director: () => import('./unit-tests-director.js').then((m) => m.addDirectorTests),
  develop: () => import('./unit-tests-develop.js').then((m) => m.addDevelopTests),
  soundGame: () => import('./unit-tests-sound-game.js').then((m) => m.addSoundGameTests),
  summer: () => import('./unit-tests-summer.js').then((m) => m.addSummerTests),
  melody: () => import('./unit-tests-melody.js').then((m) => m.addMelodyTests),
  fallsSound: () => import('./unit-tests-falls-sound.js').then((m) => m.addFallsSoundTests),
  campSound: () => import('./unit-tests-camp-sound.js').then((m) => m.addCampSoundTests),
  musicRender: () => import('./unit-tests-music-render.js').then((m) => m.addMusicRenderTests),
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
