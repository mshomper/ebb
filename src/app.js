// @ts-check
// Starts ebb on a canvas: GPU, tier, camera, terrain, sky and light, the hourly tick, frame graph,
// input, history and the frame loop.
// Shared by index.html (through main.js) and the tools pages, so they measure the same code.

import { initGpu, onDeviceLost } from './core/gpu.js';
import * as clock from './core/clock.js';
import { flushDeferred, emit, emitDeferred, on } from './core/events.js';
import { get as getStore, update as updateStore, subscribe as subscribeStore } from './core/store.js';
import { loadRecipe } from './core/recipes.js';
import { subSeed } from './core/rng.js';
import { pickTier, probeResult, settingsFor, setTier as setQualityTier, isTier } from './render/quality.js';
import { createQualityLive } from './render/quality-live.js';
import { createOrbitCamera } from './render/camera.js';
import { createFrameGraph } from './render/frame-graph.js';
import { createFrameUniformWriter } from './render/frame-uniforms.js';
import { createTerrainPass } from './render/passes/terrain.js';
import { createShadowPass } from './render/passes/shadow.js';
import { createSkyPass } from './render/passes/sky.js';
import { createExposurePass } from './render/passes/post/exposure.js';
import { createTonemapPass } from './render/passes/post/tonemap.js';
import { createBloomPass } from './render/passes/post/bloom.js';
import { createPaletteBaker } from './render/passes/post/lut-bake.js';
import { createGroundDetail } from './render/ground-detail.js';
import { createAtmosphere } from './render/sky/atmosphere.js';
import { createLighting } from './render/lighting.js';
import { createDaylight } from './render/daylight.js';
import { createLiveSim } from './sim/live-sim.js';
import { initialWorldState, makeEnv, runHour } from './sim/tick.js';
import { createTerrain } from './world/terrain/index.js';
import { islandLand } from './world/terrain/chunks.js';
import { islandCenter, campOf } from './world/terrain/landform.js';
import { padOf, onPad } from './world/camp/layout.js';
import { edgeTarget, stepEdge, edgeMark } from './world/camp/edge.js';
import { stampOlderPad } from './world/camp/stamp.js';
import { createWaterWorld } from './world/water-world.js';
import { createGrowth } from './world/growth/index.js';
import { createPlantTool } from './world/growth/plant-tool.js';
import { createSowing } from './world/sowing/index.js';
import { createPlanting } from './world/sowing/planting.js';
import { mountSowOverlay } from './ui/sow-overlay.js';
import { weatherAt } from './world/weather.js';
import { state as tideState, tideParams } from './world/tide.js';
import { soundNear, nothingNear } from './world/sound-near.js';
import { groupFalls, fallsNear } from './world/falls-near.js';
import { loadAudioRecipe } from './audio/recipes.js';
import { setVerdict } from './audio/music/hearts.js';
import { createWaterPass } from './render/passes/water.js';
import { createFallsPass } from './render/passes/falls.js';
import { createGrassPass } from './render/passes/grass.js';
import { createFloraPass } from './render/passes/flora.js';
import { buryRings, RAISING_MODES } from './world/growth/rings.js';
import { createCreaturePass } from './render/passes/creatures.js';
import { setLiftLook, setLiftTargets, liftFor } from './render/lift.js';
import { bakeBody } from './world/creatures/body-bake.js';
import { previewSpots } from './world/creatures/preview-spots.js';
import { createCreatures } from './world/creatures/index.js';
import { createFinds } from './world/finds/index.js';
import { createKeepsakes } from './world/keepsakes/index.js';
import { keepsakeWords } from './world/keepsakes/families/index.js';
import { keptFamily } from './world/expansion.js';
import { addFirst, keptFirsts, seenMark, firstsOf, sampleTrails, trailLine } from './world/trails.js';
import { createShaperWatch } from './world/shaper.js';
import { pickedFirsts, noteFirsts, knifed, hasForage, sampleForager } from './world/forager.js';
import { createForagerBelt } from './world/forager-belt.js';
import { createNets } from './world/nets/index.js';
import { cleanShelf, keep as keepShelf, letGo as letGoShelf, readLetter, swap as swapShelf } from './world/keepsakes/shelf.js';
import { chooseLetter } from './world/keepsakes/letters.js';
import { createPieces } from './world/pieces/index.js';
import { createAutumn } from './world/finds/autumn-live.js';
import { createLift } from './world/pieces/lift.js';
import { createUnderLogLive } from './world/finds/under-log-live.js';
import { createSpring } from './world/creatures/spring-live.js';
import { moodsOf, mistyAutumnMorning, autumnStartOf } from './world/finds/autumn.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from './world/growth/habitat.js';
import { waterCellOf } from './world/water/grid.js';
import { shorePresence } from './world/journal/shore-presence.js';
import { createPresence } from './world/creatures/presence.js';
import { cleanName, nameFrog } from './world/creatures/trust.js';
import { lushLook } from './world/growth/lush.js';
import { createMidges } from './world/ecology/midges-live.js';
import { SPECIES, keyOf, swarmSpecies } from './world/species.js';
import { createSchools } from './world/creatures/schools.js';
import { bringSwarm, testRecipe } from './world/creatures/swarms.js';
import { onAction, history, dispatch } from './input/actions.js';
import { createWalkControls } from './world/walk/controls.js';
import { createSolidsLive } from './world/walk/solids-live.js';
import { createWhere } from './world/camp/where.js';
import { attachDesktopInput } from './input/desktop.js';
import { beginSave, TEST_PARAMS } from './save/autosave.js';
import { createIntroBoot, introStartHour } from './world/intro/boot.js';
import { createBoat } from './world/intro/boat.js';
import { buildCliffDemo } from './world/terrain/cliff-demo.js';
import { createWalk } from './world/walk/index.js';
import { buildSandbarDemo } from './world/walk/sandbar.js';
import { loadPrefs, keepPrefs } from './save/prefs.js';
import { fingerprint } from './save/backup.js';
import { SECTIONS9, empty9 } from './save/migrate-format9.js';
import { clickKind, clickPlan } from './world/walk/click.js';
import { createPack } from './world/pack/index.js';
import { createGather } from './world/gather/index.js';
import { createTreats } from './world/creatures/treats.js';
import { ashMarks } from './world/gather/ashes.js';
import { createDig } from './world/dig/index.js';
import { createSketchbook } from './world/sketchbook/index.js';
import { createPiles } from './world/pack/piles-live.js';
import { setDownAtCamp } from './world/pack/route.js';
import { createStores } from './world/pack/stores.js';
import { createCamp } from './world/camp/index.js';
import { createPackDraw } from './world/pack/draw.js';

/**
 * @typedef {{ ok: true, tier: string, tierReasons: string[], adapterInfo: GPUAdapterInfo | null, features: string[], stop: () => void,
 *   terrain: import('./world/terrain/index.js').Terrain,
 *   water: import('./world/water/index.js').Water,
 *   growth: import('./world/growth/index.js').Growth, world: { state: any, env: any },
 *   palette: { list: () => { id: string, name: string }[], current: () => any, apply: (json: any, fadeS?: number) => void },
 *   quality: { set: (tier: string) => boolean, tier: () => string, renderScale: () => number, pinScale: (s: number | null) => void, info: () => any },
 *   pickColor: (cssX: number, cssY: number) => Promise<string> }
 *   | { ok: false, reason: 'missing'|'no-adapter'|'device-failed' }
 *   | { ok: false, reason: 'elsewhere', takeOver: () => void }
 *   | { ok: false, reason: 'damaged', save: any, islands: { id: string, name: string }[] }} StartResult
 */

/** Palettes available in the slice (docs/05): Moonlight and Clear sight join later. */
const PALETTES = [{ id: 'dusk', name: 'Dusk' }, { id: 'meadow-morning', name: 'Meadow morning' }, { id: 'clear-sight', name: 'Clear sight' }];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onDeviceLost?: (rebuilding: boolean) => void, save?: boolean, build?: string, labCamera?: boolean }} [hooks]
 *   save: keep this island in the device's save (only the game asks; tool pages run unsaved);
 *   labCamera: the camera may come close and its own eye startles creatures (the frog lab)
 * @returns {Promise<StartResult>}
 */
export async function startApp(canvas, hooks = {}) {
  const result = await initGpu(canvas);
  if (!result.ok) return result;
  const gpu = result.gpu;

  const params = new URLSearchParams(location.search);
  let seed = Number.parseInt(params.get('seed') ?? '1', 10) >>> 0;
  updateStore('meta', (m) => { m.seed = seed; });

  // `tier` and `tierSettings` may change once, if the startup probe steps ultra down to high.
  let [{ tier, settings: tierSettings, reasons, probe }, camRecipe, skyRecipe, terrainRecipe, waterRecipe, seasonsRecipe, exposureRecipe, shadowRecipe, postRecipe, ...paletteRecipes] = await Promise.all([
    pickTier(gpu.adapter),
    loadRecipe('world/camera'),
    loadRecipe('world/sky'),
    loadRecipe('world/terrain'),
    loadRecipe('world/water'),
    loadRecipe('world/seasons'),
    loadRecipe('world/exposure'),
    loadRecipe('world/shadows'),
    loadRecipe('world/post'),
    ...PALETTES.map((p) => loadRecipe(`palettes/${p.id}`)),
  ]);
  /** @type {Record<string, any>} */
  const palettes = Object.fromEntries(PALETTES.map((p, i) => [p.id, paletteRecipes[i]]));
  // `?island=<id>` starts another island from recipes/world/terrain.json's list (tests, comparisons).
  /** @type {{ id: string, name: string, land?: string }[]} */ const islands = terrainRecipe.islands?.list ?? [];
  const asked = params.get('island');
  const island = islands.find((i) => i.id === asked) ?? islands.find((i) => `land/${i.id}` === terrainRecipe.starter.land) ?? { id: terrainRecipe.starter.land.slice(5), name: 'Starter island' };
  updateStore('meta', (m) => { m.island = island.id; });
  updateStore('settings', (s) => { s.quality = tier; });
  const rb = terrainRecipe.brush;

  // Saving (doc 18, src/save): each island keeps its own save; a test link runs unsaved.
  const save = await beginSave({ enabled: !!hooks.save, islandId: island.id, test: TEST_PARAMS.some((k) => params.has(k)) });
  if (save.status === 'elsewhere') return { ok: false, reason: 'elsewhere', takeOver: save.takeOver };
  // No copy of the save reads at all: the recovery card (src/ui/damaged.js) offers a file or a new island.
  if (save.status === 'damaged') return { ok: false, reason: 'damaged', save, islands };
  // What came back from the save, applied once (a GPU rebuild finds it all in the store already).
  const back = save.restored;
  // The island's land (docs/future/13 section 3.11): a new island grows from the island's current
  // land recipe (`land` in terrain.json's list, the larger starter island); one already made keeps
  // the land its chunks record, so its shape never changes.
  const landName = islandLand(island, back?.chunks ?? Object.values(getStore('chunks') ?? {}));
  const landRecipe = await loadRecipe(`land/${landName}`);
  updateStore('meta', (m) => { m.land = landName; });
  // The camera starts over the island's center and keeps within its reach (cameraRadiusM).
  const isle = islandCenter(landRecipe);
  camRecipe = { ...camRecipe, worldRadius: landRecipe.cameraRadiusM ?? camRecipe.worldRadius, worldCenter: [isle.x, isle.z],
    start: { ...camRecipe.start, target: [camRecipe.start.target[0] + isle.x, camRecipe.start.target[1], camRecipe.start.target[2] + isle.z] } };
  if (back) {
    seed = back.meta.seed >>> 0;
    updateStore('meta', (m) => { m.seed = seed; m.carryMinutes = back.meta.carryMinutes ?? 0; m.keepGrowing = back.meta.keepGrowing ?? true; });
    clock.reset(back.meta.worldT);
    clock.setFlow(clock.FLOWS.includes(back.meta.flow) ? back.meta.flow : 1);
    updateStore('world', () => back.world);
    if (back.journal) updateStore('journal', () => back.journal);
    if (back.water) updateStore('water', () => back.water);
    // The pieces of music you hearted (src/audio/music/hearts.js).
    if (back.music) updateStore('music', () => back.music);
    // Placed loose stones (src/world/pieces).
    updateStore('pieces', () => back.pieces);
    // The shelf of keepsakes (src/world/keepsakes/shelf.js).
    updateStore('keepsakes', () => back.keepsakes);
    // The nets (src/world/nets/model.js).
    updateStore('nets', () => back.nets);
  }
  // The keeper's camp sections (format 9, src/save/migrate-format9.js): from the save, empty on a
  // new island, and as they were on a GPU rebuild.
  for (const id of SECTIONS9) updateStore(id, (v) => (back ? back[id] : v ?? empty9(id)));
  // The camp pad (src/world/camp/layout.js): in a new island's base from the start; on an older
  // island once it is stamped (camp.pad, src/world/camp/migrate-pad.js).
  {
    const inBase = campOf(landRecipe);
    // A new island's pad is where its land put it; the save's camp.pad says so for every reader.
    if (inBase?.inBase && !getStore('camp')?.pad) {
      updateStore('camp', (c) => ({ ...c, stamped: true, pad: { x: inBase.x, z: inBase.z, heightM: inBase.h,
        facingDeg: Math.atan2(inBase.fz, inBase.fx) * 180 / Math.PI, source: 'recipe' } }));
    }
    const at = getStore('camp')?.pad ?? null;
    updateStore('campPad', () => (inBase?.inBase || at ? padOf(landRecipe, at) : null));
  }
  // Device settings (src/save/prefs.js): kept on this device, never in the island.
  const prefs = loadPrefs();
  updateStore('settings', (s) => {
    for (const k of ['textSize', 'motion', 'audio', 'hudDim', 'reveal', 'qualityChoice', 'journalList']) if (prefs[k] !== undefined) s[k] = prefs[k];
  });
  keepPrefs();

  // Tool state for the tool bar (ui/tools.js reads it; actions below change it).
  updateStore('tools', (t) => t ?? {
    tool: null, sculptMode: 'raise', paintLayer: 'grass', waterMode: 'pour', springRate: 'brook', plantSpecies: 'reeds',
    size: rb.radiusDefault, strength: rb.strengthDefault, sizeRange: rb.radiusRange,
  });
  // Terrace and Cut's Height slider (docs/08), and its range for the card.
  updateStore('tools', (t) => {
    t.cliffHeight ??= terrainRecipe.cliff.heightDefault;
    t.cliffHeightRange = terrainRecipe.cliff.heightM;
    t.cliffHeightStep = terrainRecipe.cliff.snapM;
  });
  // Unlocks (docs 12, 13): placing springs is the dragonflies' gift and the Cliff tool (Terrace and
  // Cut) the frogs'; `?sandbox` opens both early for this visit only, and `?cliffs` the Cliff tool
  // (`earned` holds what was given, and is what the save keeps). Loose stones are the naturalist's
  // reward at six finds; `?sandbox` opens the Loose stone mode early, and `?stones` (a test link,
  // unsaved) that and the handful that comes with the reward (src/world/pieces). Driftwood is the
  // reward at ten finds, and carrying a stone or a log the turtles' gift (not given by anything
  // yet); `?sandbox` opens carrying, and `?driftwood` (unsaved) both.
  // `?sandbox` and `?plants=all` also
  // offer every plant in the Plant tool before it has come to the island (volunteers.js); sea
  // campion, for one, grows nowhere until there is rock by the sea.
  updateStore('unlocks', (u) => {
    // `?trails` (testing, unsaved): stops on the beachcomber's and shaper's trails already reached.
    // `?forager` (testing, unsaved): a year of gathering, so the herbarium, the knife and the almanac are reached.
    let earned = params.has('trails') ? sampleTrails(u?.earned ?? back?.unlocks ?? {}) : u?.earned ?? back?.unlocks ?? {};
    if (params.has('forager')) earned = sampleForager(earned);
    return { earned, ...earned, springs: !!earned.springs || params.has('sandbox'),
      cliffs: !!earned.cliffs || params.has('sandbox') || params.has('cliffs'),
      stones: !!earned.stones || params.has('sandbox') || params.has('stones'), stonesTest: params.has('stones'),
      driftwood: !!earned.driftwood || params.has('driftwood'),
      carry: !!earned.carry || !!earned.driftwood || params.has('sandbox') || params.has('driftwood'),
      // The general net (the beachcomber's trail, at four families kept); `?nets` (unsaved) gives it at once.
      nets: { ...(earned.nets ?? {}), ...(params.has('nets') ? { general: true } : {}) },
      allPlants: params.has('sandbox') || params.get('plants') === 'all' };
  });
  // `?weather=clear|cloud|rain|mist` previews a weather look (as the sky lab does); the world's
  // own weather record is untouched.
  const weatherPreview = params.get('weather');
  if (weatherPreview && ['clear', 'cloud', 'rain', 'mist'].includes(weatherPreview)) {
    updateStore('preview', (p) => ({ ...(p ?? {}), weather: weatherPreview }));
  }
  const syncHistory = () => updateStore('history', () => ({ canUndo: history.canUndo(), canRedo: history.canRedo() }));
  history.setBudget((terrainRecipe.undoBudgetMB[tier] ?? 12) * 1024 * 1024);
  const unHistory = history.onChange(syncHistory);
  syncHistory();

  const terrain = await createTerrain(gpu, { seed: subSeed(seed, 'terrain'), recipe: terrainRecipe, land: landRecipe, landId: `land/${landName}` });
  history.setApplier('terrain', (cmd, dir) => terrain.applyTiles(dir === 'undo' ? cmd.before : cmd.after));
  if (back) terrain.restoreChunks(back.chunks);   // before the water reads the ground
  // The world clock and the shared hourly tick (weather, seasons). A new world starts mid-morning.
  // `?day=N` starts a new world N game days in (14 per season: 15 is early summer), to see later seasons sooner.
  // `?frogs=N` (testing) starts on spring day 7 unless a day is given, after the frogs' winter sleep
  // (they wake 0.3 into spring, day 5).
  // `?dragonflies=N` starts on summer day 2: they fly from the start of summer (recipes/world/seasons.json).
  // `?damselflies=N` starts on the last day of spring (day 13): the first ones climb out at 0.9.
  // `?turtles=N` starts on summer day 2 too: they wake once the water has warmed (0.05 into summer).
  const testDay = params.has('dragonflies') || params.has('turtles') ? '15' : params.has('damselflies') ? '13' : params.has('frogs') ? '6' : '0';
  const startDay = Math.max(0, Number.parseInt(params.get('day') ?? testDay, 10) || 0);
  // `?autumn` (testing, unsaved): a new world starts on its first misty autumn morning with fungi
  // grown (src/world/finds/autumn.js), and a kept log is laid near the view once the island is up.
  const autumnRecipe = await loadRecipe('species/autumn-finds');
  const autumnMoods = (/** @type {number} */ lean) => moodsOf(subSeed(seed, 'weather'), lean, seasonsRecipe.weather);
  const autumnDay = params.has('autumn') ? mistyAutumnMorning({ fromDay: 0, moodOf: autumnMoods(0), F: autumnRecipe.fungi }) : null;
  if (clock.worldT() === 0 && autumnDay !== null) clock.reset((autumnRecipe.webs.testHour + 24 * autumnDay) * clock.SECONDS_PER_HOUR);
  // `?hour=H` (testing, unsaved) starts a new world at that hour of the day: low water falls at 6
  // and 18, so `?sandbar&hour=7` opens in early light with the bar dry and the tide rising.
  const startHour = Math.min(23.9, Math.max(0, Number.parseFloat(params.get('hour') ?? '') || (skyRecipe.orbit.startHour ?? 10)));
  // A new island opens at dawn on spring day 0, for the first evening (src/world/intro/boot.js).
  const introRecipe = await loadRecipe('world/intro');
  const introHour = introStartHour(introRecipe, skyRecipe.orbit, params, !back, TEST_PARAMS,
    params.has('hour') || params.has('day') || testDay !== '0' || autumnDay !== null);
  if (clock.worldT() === 0 && introHour !== null) clock.reset(introHour * clock.SECONDS_PER_HOUR);
  if (clock.worldT() === 0) clock.reset((startHour + 24 * startDay) * clock.SECONDS_PER_HOUR);
  updateStore('meta', (m) => { m.flow = clock.flow(); });
  const env = makeEnv(seed, { seasons: seasonsRecipe, sky: skyRecipe.orbit, water: waterRecipe });
  // `?trust=0.5` (testing): every frog knows you at least this well from the next hour (S6c, trust.js).
  /** @type {any} */ (env).testTrust = Math.max(0, Math.min(1, Number.parseFloat(params.get('trust') ?? '0') || 0));
  /** @type {import('./sim/live-sim.js').LiveWorld} */
  const world = { state: getStore('world') ?? runHour(initialWorldState(seed), clock.hourIndex(), env).state, env };
  updateStore('world', () => world.state);
  const sim = createLiveSim({ world });
  sim.addSystem(terrain);
  // The live water world (docs/07, 08): water, foam, wet ground, ripples and moss, in tick order.
  const ww = await createWaterWorld(gpu, {
    terrain, sim, seed, tier, history, recipes: { water: waterRecipe, terrain: terrainRecipe, land: landRecipe },
  });
  const { water, foam, ripples, wetness, moss } = ww;
  // An older island's camp pad, laid once on its first load after the keeper's camp update (CP-07, CP-08).
  stampOlderPad({ land: landRecipe, terrain, water, terrainRecipe, waterRecipe });
  // Growth (docs 10, 11): the habitat grid from the water summary, plants and grass cover grown in
  // the hourly tick; this keeps the habitat current and uploads what the drawing needs.
  // `?plants=all` (testing, unsaved): a new island starts with every plant, not only the starters
  // (growth.json starters; the rest otherwise come by themselves, volunteers.js).
  const growthRecipe = { ...(await loadRecipe('world/growth')) };
  if (params.get('plants') === 'all') growthRecipe.starters = [...growthRecipe.species, ...(growthRecipe.cover ?? [])];
  // `?plants=herbs` (testing, unsaved): the starters plus a set from growth.json testSets (the four tea herbs).
  const testSet = growthRecipe.testSets?.[params.get('plants') ?? ''];
  if (testSet) growthRecipe.starters = [...growthRecipe.starters, ...testSet];
  /** @type {Record<string, any>} */
  const flora = Object.fromEntries(await Promise.all(growthRecipe.species.map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  /** @type {Record<string, any>} the cover plants other than grass (rushes) */
  const covers = Object.fromEntries(await Promise.all((growthRecipe.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  const grassRecipe = await loadRecipe('flora/grass');
  const growth = createGrowth(gpu.device, { terrain, water, world, recipes: { growth: growthRecipe, flora, covers, land: landRecipe, grass: grassRecipe } });
  sim.addSystem(growth);
  // A burying stroke's plants come back with its undo and go under again with its redo (bury.js).
  history.setApplier('terrain', (cmd, dir) => {
    const r = terrain.applyTiles(dir === 'undo' ? cmd.before : cmd.after);
    // applyTiles is false while a stroke settles (undo tries again shortly): the plants wait with it.
    if (r && cmd.buried) { if (dir === 'undo') growth.unbury(cmd.buried); else growth.rebury(cmd.buried); }
    return r;
  });
  // Ecology and creatures (S6a, docs 11, 12): the midge field, frog habitat and the frogs' arrival
  // run in the hourly tick from these recipes.
  // Every species in the list (src/world/species.js): frogs and midges, then minnows and dragonflies.
  /** @type {Record<string, any>} */
  const speciesRecipes = Object.fromEntries(await Promise.all(SPECIES.map(async (id) => [id, await loadRecipe(`species/${id}`)])));
  const frogRecipe = speciesRecipes.frog, midgeRecipe = speciesRecipes.midge;
  // `?minnows=N` (testing, unsaved): a school comes at once, and the biggest still water will do
  // without its deep spot (src/world/creatures/swarms.js testRecipe), so a new island can be tested.
  if (params.has('minnows')) speciesRecipes.minnow = testRecipe(speciesRecipes.minnow);
  // `?dragonflies=N` likewise: any pond will do, not only a fish-free one you shaped.
  if (params.has('dragonflies')) speciesRecipes.dragonfly = testRecipe(speciesRecipes.dragonfly);
  // `?damselflies=N` likewise (any still pond suits them anyway).
  if (params.has('damselflies')) speciesRecipes.damselfly = testRecipe(speciesRecipes.damselfly);
  if (params.has('turtles')) speciesRecipes.turtle = testRecipe(speciesRecipes.turtle);
  world.env.recipes.species = speciesRecipes;
  updateStore('world', () => world.state);
  /** One game hour of the shared tick, live. @param {number} hour */
  function tickHour(hour) {
    const events = sim.hourlyTick(hour);
    for (const e of events) emitDeferred(e.name, e.payload);
    updateStore('world', () => world.state);
    // The hour as a whole, for watchers of the world such as the journal (src/world/journal).
    emitDeferred('world:ticked', { hour, events, state: world.state });
  }
  const unHour = on('clock:hour', (/** @type {{ hour: number }} */ p) => tickHour(p.hour));

  const camera = createOrbitCamera(camRecipe);
  if (back?.view) camera.setPose(back.view);   // the view you left
  // The ground, or the water's surface where it stands higher, so a close-up never dips under a pond.
  camera.setGroundProbe((x, z) => Math.max(terrain.sampleHeight(x, z), water.sim.live ? water.sampleLive(x, z).surface : -Infinity));
  // The view, for the UI (store slice `view`): the ground point in the middle of the screen, and
  // where a ground point lands on screen in CSS pixels (behind: it is behind the camera, and x, y
  // are mirrored so they still say which way to turn).
  updateStore('view', () => ({
    center: () => [camera.target[0], camera.target[2]],
    /** @param {number} x @param {number} z @returns {{ x: number, y: number, behind: boolean }} */
    project(x, z) {
      const m = camera.viewProj, y = terrain.sampleHeight(x, z);
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const behind = w <= 1e-4, s = behind ? -1 / Math.max(Math.abs(w), 1e-4) : 1 / w;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (cx * s * 0.5 + 0.5) * r.width, y: r.top + (0.5 - cy * s * 0.5) * r.height, behind };
    },
    /** A world point on screen (CSS pixels), as project() but at its own height. @param {number} x @param {number} y @param {number} z */
    project3(x, y, z) {
      const m = camera.viewProj;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const behind = w <= 1e-4, s = behind ? -1 / Math.max(Math.abs(w), 1e-4) : 1 / w;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (cx * s * 0.5 + 0.5) * r.width, y: r.top + (0.5 - cy * s * 0.5) * r.height, behind };
    },
  }));

  // Light: the physical sky, sun or moon shadows, the shared lighting group, slow eye adaptation.
  const atmosphere = await createAtmosphere(gpu.device, skyRecipe, tierSettings);
  const shadowPass = createShadowPass({ terrain, recipe: shadowRecipe, terrainRecipe, tierShadows: tierSettings.shadows, worldRadius: camRecipe.worldRadius,
    getEye: () => camera.eye, cliffDetailM: tierSettings.cliffDetailM });
  const lighting = createLighting(gpu.device, atmosphere, shadowPass.resources(gpu.device));
  const exposure = createExposurePass(exposureRecipe);
  const daylight = createDaylight({ sky: skyRecipe, seasons: seasonsRecipe, shadows: shadowRecipe });

  // Look: bloom, then the palette LUT in the tonemap (physical light, painted last; docs/05).
  const baker = await createPaletteBaker(gpu.device);
  // The palette is a device setting (doc 18, src/save/prefs.js).
  const wanted = prefs.palette ?? getStore('settings')?.palette;
  const startPalette = palettes[wanted] ? wanted : PALETTES[0].id;
  updateStore('settings', (s) => { s.palette = startPalette; });
  baker.setPalette(palettes[startPalette], { fadeS: 0 });
  // Scanned ground detail (docs/22): placeholders now, the real maps load after the first calm frames.
  const groundDetail = createGroundDetail(gpu.device, { tier: tierSettings.ground, recipe: terrainRecipe.detail });
  let groundRequested = false;
  const bloom = createBloomPass({ levels: tierSettings.bloomLevels, mix: postRecipe.bloom.mix, radius: postRecipe.bloom.radius, karis: postRecipe.bloom.karis });
  const tonemap = createTonemapPass({ bloom, luts: baker.views, recipe: postRecipe });
  // The journal's show-where wash (store slice `wash`, src/world/journal/wash.js), painted last.
  tonemap.setWash(getStore('wash') ?? null);
  const unWash = subscribeStore('wash', (/** @type {any} */ w) => tonemap.setWash(w));

  const terrainPass = createTerrainPass({
    terrain, recipe: terrainRecipe, seed: subSeed(seed, 'terrain-look'), getEye: () => camera.eye, tier,
    ground: groundDetail, groundTier: tierSettings.ground, getTide: () => water.tide, lodDistances: tierSettings.lodDistances, cliffDetailM: tierSettings.cliffDetailM,
    getHours: () => clock.display() / clock.SECONDS_PER_HOUR,
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current, damp: water.sim.damp, dampWet: waterRecipe.look.dampHollowWet,
      vel: water.sim.vel, caustics: waterRecipe.caustics, tide: waterRecipe.tide },
    moss: moss.texture, causticLayers: tierSettings.causticLayers, wetness, cover: growth.coverTex,
    probe: { view: atmosphere.probeView, sampler: atmosphere.probeSampler }, rings: waterRecipe.ripples.rings,
    shore: { texture: ww.shore.texture, look: ww.shore.recipe.look },
  });
  // The camp pad's trodden look and dashed edge pattern follow the live pad (CP-01, CP-02).
  terrainPass.setCampPad(getStore('campPad') ?? null);
  subscribeStore('campPad', (/** @type {any} */ p) => terrainPass.setCampPad(p ?? null));
  let padEdge = 0;   // the dashed edge's opacity now, fading toward its target
  // The meadow (docs 10): GPU grass blades where grass is painted, after the terrain.
  const grassPass = createGrassPass({
    terrain, recipe: grassRecipe, terrainRecipe, seed: subSeed(seed, 'grass'), tier: tierSettings,
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, cover: growth.coverTex,
  });
  // The marsh's rushes (docs 10): the same blades in tussocks, where the rush cover is, standing in
  // shallow still water.
  const rushPass = createGrassPass({
    terrain, recipe: covers.rushes, terrainRecipe, seed: subSeed(seed, 'rushes'), tier: tierSettings, kind: 'rushes',
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, cover: growth.coverTex,
  });
  // Plants (docs 10): every species from the growth step's instances, after the grass.
  const floraPass = createFloraPass({ growth, terrain, water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, recipes: flora, looks: growthRecipe.looks });
  // The frogs (src/world/creatures): posed bodies at their homes until S6b, the plop, finding one.
  // `?frogs=N` (testing): N frogs come at once instead of over days (1: a scout, the sign).
  const testFrogs = params.has('frogs') ? Math.max(1, Math.min(12, Number.parseInt(params.get('frogs') ?? '1', 10) || 1)) : 0;
  // floraFrame: the time and wind the plants were drawn with this frame (frogs on lily pads ride them).
  /** @type {{ time: number, wind: number, windDir: number } | null} */ let floraFrame = null;
  // Presence (doc 23): what creatures react to. Two views (W3): the camera above counts only for
  // its edits (reported below); you on foot are felt with your pace, posture and gaze.
  const walkerRecipe = await loadRecipe('world/walker');
  // Planting on foot (D1a): the seed tin, the gift spot and the net in hand (src/world/sowing).
  const sowingRecipe = await loadRecipe('world/sowing');
  // The lift (F5): a hovered or chosen thing is tinted warm with a thin rim in its own shader, never ringed.
  setLiftLook(await loadRecipe('world/highlight'));
  // The keeper's camp's words (recipes/world/camp.json): `clear`, the line when a tap lands on the pad.
  const campRecipe = await loadRecipe('world/camp');
  /** @type {import('./world/walk/index.js').Walk | null} */ let walkRef = null;
  // `hooks.labCamera` (tools/frog-lab.html): the old close camera, whose own eye startles frogs.
  if (hooks.labCamera) camera.setClose(camRecipe.labClose);
  const presence = createPresence({ camera, cameraBody: !!hooks.labCamera, walker: () => walkRef?.presenceNow() ?? null, heightM: walkerRecipe.presence.heightM });
  /** Where you are felt on foot (finds, food, finding by watching); null while you are above. */
  const you = () => walkRef?.you() ?? null;
  const creatures = createCreatures({ world, recipe: frogRecipe, terrain, water, ripples, camera, testFrogs, flora, floraFrame: () => floraFrame, presence, you });
  sim.addSystem(creatures);
  // Schools you can see (src/world/creatures/schools.js): minnows under the live water surface, one
  // system and one pass per species that has a body and a school's motion.
  const schools = swarmSpecies(speciesRecipes).filter((rec) => rec.body && rec.motion)
    .map((rec) => createSchools({ world, recipe: rec, water, ripples, camera, presence, budget: tierSettings.liveCreatures ?? 120,
      ground: (x, z) => terrain.sampleHeight(x, z), you }));
  for (const s of schools) sim.addSystem(s);
  // `?minnows=N`, `?dragonflies=N`, `?damselflies=N` (testing, unsaved): a group of N comes at once
  // and is settled, once the island, its water and the journal are up (as `?frogs` does). Under
  // `?debug`, window.ebb.summon() asks for one the same way (below).
  const testSwarms = ['minnow', 'dragonfly', 'damselfly', 'turtle'].filter((id) => params.has(keyOf(speciesRecipes[id])))
    .map((id) => ({ rec: speciesRecipes[id], count: Math.max(1, Math.min(30, Number.parseInt(params.get(keyOf(speciesRecipes[id])) ?? '12', 10) || 12)) }));
  let swarmWait = 0;
  if (testSwarms.length || params.has('debug')) sim.addSystem({ id: 'swarm-tests', tick(/** @type {any} */ f) {
    if (!testSwarms.length || !world.env.habitat?.() || !water.sim.live) return;
    swarmWait += f.realDt;
    if (!getStore('journal') && swarmWait < 3) return;
    for (const t of testSwarms.splice(0)) {
      const r = bringSwarm(world.state, clock.hourIndex(), world.env, t.rec, t.count);
      world.state = r.state;
      updateStore('world', () => world.state);
      for (const e of r.events) emitDeferred(e.name, e.payload);
      emitDeferred('world:ticked', { hour: clock.hourIndex(), events: r.events, state: world.state });
    }
  } });
  // Midges you can see (src/world/ecology/midges-live.js): swarms from the midge field, after the water.
  const midges = createMidges({ world, recipe: midgeRecipe, budget: tierSettings.boids ?? 4096, ripples,
    ground: (x, z) => terrain.sampleHeight(x, z), water: (x, z) => water.sampleLive(x, z),
    wind: () => ({ strength: weatherAt(world.state?.weather, clock.display(), seasonsRecipe).wind, dir: world.state?.weather?.today?.windDir ?? 0 }),
    rain: (hoursAgo) => weatherAt(world.state?.weather, clock.display() - hoursAgo * clock.SECONDS_PER_HOUR, seasonsRecipe).rain });
  sim.addSystem(midges);
  // What the animals do that can be heard (src/audio reads it): frog calls and plops, midge swarms,
  // and the schools: each minnow and dragonfly with its speed, and the minnows' rises to the surface.
  updateStore('creatureSound', () => ({ frogs: (/** @type {number} */ since) => creatures.sounds(since), swarms: () => midges.heard(),
    schools: () => schools.flatMap((s) => s.heard()) }));
  // Finds (docs/future/11): anemones in rock pools, periwinkles on the wrack, lugworm casts on the
  // sand, where the shore zones say, near the view; a tap finds them for the journal.
  // `?shells=rare` or `?shells=<id>` (testing, unsaved): the strandline is thick with those shells,
  // whatever the tide, so a rare one can be seen and its page checked.
  const findsRecipe = await loadRecipe('species/finds');
  const shellTest = params.get('shells');
  if (shellTest && findsRecipe.kinds.shells) {
    const S = findsRecipe.kinds.shells;
    const keep = S.items.filter((/** @type {any} */ it) => (shellTest === 'rare' ? it.springMin !== undefined : it.id === shellTest));
    if (keep.length) findsRecipe.kinds.shells = { ...S, density: 0.3, items: keep.map((/** @type {any} */ it) => ({ ...it, springMin: undefined })) };
  }
  // Shells wash up once the naturalist's notes give them (world/expansion.js); `?shells` shows them anyway.
  const finds = createFinds({ water, shore: ww.shore, terrain, camera, recipe: findsRecipe, seed: subSeed(seed, 'finds'), tide: waterRecipe.tide,
    shellsOn: () => !!shellTest || !!getStore('unlocks')?.shells,
    // Winter storm tides read the weather of the day each high water came (world/finds/strand.js).
    weather: () => ({ weatherSeed: world.env.weatherSeed, weather: seasonsRecipe.weather, state: world.state?.weather }), you });
  sim.addSystem(finds);
  terrainPass.setCasts(finds.casts(), finds.castShape);
  // Keepsakes (docs/future/12): one-of-a-kind trinkets each high tide leaves on its strandline, a
  // few for the whole island. They come with the shells (the naturalist's reward at three finds);
  // `?keepsakes` (testing, unsaved) shows them at once, several to a tide.
  const keepsakesRecipe = await loadRecipe('world/keepsakes');
  const keepsakeTest = params.has('keepsakes');
  // Sheltered coves catch more of them (the cove field, src/world/water/cove.js).
  const coveRecipe = await loadRecipe('world/cove');
  // The shaper's trail notices the kinds of place you make (src/world/shaper.js, wired below).
  const shaperRecipe = await loadRecipe('world/shaper');
  const keepsakes = createKeepsakes({ water, shore: ww.shore, terrain, camera, recipe: keepsakesRecipe, passRecipe: findsRecipe,
    seed: subSeed(seed, 'keepsakes'), tide: waterRecipe.tide, test: keepsakeTest, coveRecipe,
    on: () => keepsakeTest || !!getStore('unlocks')?.shells });
  const keepsakesApi = { ...keepsakes, words: (/** @type {any} */ n) => keepsakeWords(n, keepsakesRecipe) };
  // Bottle letters (recipes/world/bottle-messages.json): which letter a bottle on the beach turned
  // out to hold, once read, so reading it again (or keeping it) gives the same one.
  const bottleMessages = await loadRecipe('world/bottle-messages');
  /** @type {Map<string, string>} */ const shoreLetters = new Map();
  sim.addSystem(keepsakes);
  // The nets (docs/future/12, K6; src/world/nets): cast with the Water tool's Net mode once the
  // beachcomber's trail gives the general net; `?nets` (testing, unsaved) gives it at once, and a
  // net cast there is ready to lift straight away.
  const netsRecipe = await loadRecipe('world/nets');
  const nets = createNets({ water, terrain, camera, seed: subSeed(seed, 'nets'), recipe: netsRecipe, keepsakes: keepsakesRecipe,
    passRecipe: findsRecipe, tide: waterRecipe.tide, nowH: () => clock.worldT() / clock.SECONDS_PER_HOUR, test: params.has('nets') });
  sim.addSystem(nets);
  // Placed pieces (doc 09, docs/future/10): loose stones, set with Sculpt's Loose stone mode and
  // lifted with a tap; a handful comes by itself with the naturalist's reward (src/world/pieces).
  // Driftwood washes up on the strandline after high tides (the reward at ten finds), and the
  // turtles' gift carries a stone or a log to where you tap next.
  const pieces = createPieces({ terrain, water, camera, history, seed, recipe: await loadRecipe('world/pieces'), ground: groundDetail, terrainRecipe,
    shore: ww.shore, tide: waterRecipe.tide });
  sim.addSystem(pieces);
  // The walker (doc 23, presence below; W2): Go down puts you on foot where you are looking, and
  // the camera glides down behind you; a tap walks you there. Go up glides back over you.
  const figureRecipe = await loadRecipe('world/figure');
  const walk = createWalk({ recipe: walkerRecipe, figure: figureRecipe, terrain, water, camera, tide: waterRecipe.tide,
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, creatures: () => creatures.frogs(),
    // Pond stones are footing: you step across on them (src/world/pieces/stepping.js).
    footing: (x, z) => pieces.footing(x, z) });
  // Pond stones and Steps are the shaper's trail's first and fourth stops (shaper.json, built):
  // offered once the trail reaches them, or with `?sandbox`, or `?pondstones` and `?steps`, for this visit.
  // Reaching one while you play shows a quiet gift card that opens the shaper's trail (a stop
  // reached before this visit, or in a catch-up the island already showed, makes none).
  /** @type {Set<string> | null} */ let shapeReached = null;
  const shapingOffers = () => {
    const u = getStore('unlocks') ?? {};
    const reached = new Set(trailLine(firstsOf(u.earned ?? {}, 'shape'), shaperRecipe.stops, [])
      .flatMap((e) => (e.type === 'station' ? [e.stop.id] : [])));
    for (const id of ['stones', 'steps']) {
      const stop = shaperRecipe.stops.find((/** @type {any} */ s) => s.id === id);
      if (shapeReached && !shapeReached.has(id) && reached.has(id) && stop?.gift) emitDeferred('progress:gifted', { ...stop.gift, icon: stop.icon, trail: 'shape' });
    }
    shapeReached = reached;
    const pondStones = reached.has('stones') || params.has('sandbox') || params.has('pondstones');
    const steps = reached.has('steps') || params.has('sandbox') || params.has('steps');
    if (u.pondStones !== pondStones || u.steps !== steps) updateStore('unlocks', (v) => ({ ...v, pondStones, steps }));
    // The reed raft is the turtles' gift (`unlocks.raft`, given by the spring creatures); `?sandbox`
    // or `?raft` open its Water mode early, for this visit.
    if (!u.raft && (params.has('sandbox') || params.has('raft'))) updateStore('unlocks', (v) => ({ ...v, raft: true }));
  };
  subscribeStore('unlocks', shapingOffers);
  shapingOffers();
  walkRef = walk;
  // Your figure stays where you left it (kept with the view; the save still opens above).
  walk.restoreSpot(back?.view?.walker);
  // The first evening (docs/future/13 section 2; src/world/intro): the boat at its mooring, a new
  // island's walker on the beach below the camp, and the director, started once the journal is up.
  const boatRecipe = await loadRecipe('world/boat');
  const boat = createBoat({ recipe: boatRecipe, ground: (/** @type {number} */ x, /** @type {number} */ z) => terrain.sampleHeight(x, z), water });
  sim.addSystem({ id: 'boat', tick: (/** @type {any} */ f) => boat.update(f.realDt, clock.animT()) });
  const intro = createIntroBoot({ R: introRecipe, boatR: boatRecipe, campRecipe, params, testParams: TEST_PARAMS, back, walk, terrain, water,
    land: landRecipe, terrainSeed: subSeed(seed, 'terrain'), orbit: skyRecipe.orbit, clock, camera, boat });
  sim.addSystem(intro);
  // Autumn's season markers (doc 13; src/world/finds/autumn-live.js): fungi on the kept logs, and
  // dewy webs in the tall grass on misty mornings. Tapping either is a find.
  const autumn = createAutumn({ world, terrain, water, camera, pieces, growth, recipe: autumnRecipe, seasons: seasonsRecipe, seed });
  sim.addSystem(autumn);
  finds.addSource(autumn.shown);
  // Spring at the pond (doc 13; src/world/creatures/spring-live.js): frogspawn, tadpoles and
  // froglets, the toad's night walk, and the basking spots (stones, logs, the raft) turtles and the
  // toad read. `?spring=spawn|tadpoles|froglets|toad` (testing, unsaved) sets one near the view.
  const spring = createSpring({ world, terrain, water, camera, pieces, presence, test: params.get('spring'),
    recipes: { frogspawn: speciesRecipes.frogspawn, toad: speciesRecipes.toad, frog: frogRecipe, slowworm: speciesRecipes.slowworm, lizard: speciesRecipes.lizard } });
  sim.addSystem(spring);
  finds.addSource(spring.shown);
  // Lift, on foot (docs/future/11 L3a; src/world/pieces/lift.js): a kept log's or a loose stone's card
  // offers Lift within reach, and what lives underneath is rolled for the day.
  const underLogRecipe = await loadRecipe('species/under-log');
  const lift = createLift({ pieces, walk, world, recipe: underLogRecipe, seed, ageRecipe: (await loadRecipe('world/pieces')).driftwood?.age ?? null });
  // While it is up, woodlice and the violet ground beetle scuttle for the dark (under-log-live.js).
  const underLog = createUnderLogLive({ lift, terrain, recipe: underLogRecipe });
  sim.addSystem(underLog);
  finds.addSource(underLog.shown);

  // The walker's pack (docs/future/13 section 4.1): cloth pouches on the ground bar, filled by Gather.
  // Set down at camp puts a pouch onto its kind's pile in the camp's slots (src/world/pack/piles-live.js).
  // A pouch goes to its kind's own place first (the drying rack, its store's pile), then the hamper;
  // the heaps take the rest until a hamper stands (src/world/pack/route.js, P2j).
  /** @type {ReturnType<typeof createPiles> | null} */ let piles = null;
  /** @type {any} */ let keeps = null;
  const pack = createPack({ recipe: await loadRecipe('world/pack'), you: () => walk.you(), day: () => clock.dayIndexOf(clock.worldT()),
    speciesName: (sp) => flora[sp]?.name ?? world.env.recipes?.covers?.[sp]?.name,
    setDown: (k, h) => (piles && keeps ? setDownAtCamp(k, h, { campOf: pack.kinds.campOf, piles, rack: keeps.rack, hamper: keeps.hamper })
      : piles?.setDown(k, h) ?? { moved: 0, refuse: 'noSlot' }) });
  piles = createPiles({ recipe: pack.recipe, kinds: pack.kinds, seed, noHeaps: () => !!keeps?.hamper.here() });
  intro.usePack(pack);
  /** The camp's ring for gathering, set once the camp is made below. @type {(() => any) | null} */ let ringPlace = null;
  // Gathering on foot (section 4.2): Gather on a card walks you there, you kneel, a handful goes in.
  const gather = createGather({ recipe: await loadRecipe('world/gather'), seed, world, worldT: () => clock.worldT(), water, terrain, pack, walk,
    tide: waterRecipe.tide, strandline: ww.shore.recipe?.look?.strandline ?? null,
    weather: () => ({ weatherSeed: world.env.weatherSeed, weather: seasonsRecipe.weather, state: world.state?.weather }),
    center: () => { const b = terrain.openBounds(); return [(b.openMin[0] + b.openMax[0]) / 2, (b.openMin[1] + b.openMax[1]) / 2]; },
    // Where the boat lands the keeper: the beach there always has something to gather (F6).
    boat: () => { const s = boat.mooring?.stand; return s ? [s.x, s.z] : null; },
    // The fire ring's charcoal and ash the morning after a fire-night (P2i), once the camp exists.
    ring: () => ringPlace?.() ?? null });
  // Picked reeds grow back slowly, faster in rain (the growth step reads the gather recipe). The
  // forager's trail's gathering knife changes it (src/world/forager.js knifed): ready again sooner,
  // less bare; picking, growing back and catch-up all read it from here.
  const foragerRecipe = await loadRecipe('world/forager');
  const hasKnife = () => hasForage(getStore('unlocks')?.earned, 'knife');
  /** @type {boolean | null} */ let knifeOn = null;
  const applyKnife = () => {
    if (hasKnife() === knifeOn) return;
    knifeOn = hasKnife();
    world.env.recipes.gather = knifed(gather.recipe, knifeOn ? foragerRecipe.knife : null);
  };
  applyKnife();
  subscribeStore('unlocks', applyKnife);
  // The forager's trail (doc 13 "Trails"): a picked handful writes its plant, part and season firsts, once, for good.
  on('plant:picked', (/** @type {{ sp: string, part: string }} */ p) => updateStore('unlocks', (u) => {
    const earned = noteFirsts(u?.earned ?? {}, pickedFirsts(p.sp, p.part, world.state?.seasons?.index ?? 0, clock.hourIndex()));
    return earned === u?.earned ? u : { ...u, earned };
  }));
  // The knife on the walker's belt, once given.
  const belt = createForagerBelt({ recipe: foragerRecipe, figure: figureRecipe, walk, has: hasKnife });
  sim.addSystem({ id: 'forager-belt', tick() { belt.update(); } });
  on('world:ticked', () => gather.expire());
  on('world:caught-up', () => gather.expire());
  // Treats (P2h; src/world/creatures/treats.js): Set out on a pouch's card puts a handful down in front
  // of you and the nearest creature that likes it comes and eats it at once; one nobody wants fades
  // back into the ground. `?treats` (a test link, unsaved): a pouch of wrack, a pouch of leaf packs and
  // a handful of fallen leaves (with `&camp=bench`, enough to make another leaf pack).
  const treats = createTreats({ recipe: await loadRecipe('world/treats'), pack, walk, hour: () => clock.worldT() / 3600,
    depth: (x, z) => water.sampleLive(x, z)?.depth ?? 0,
    species: [{ key: 'frogs', rec: frogRecipe, live: creatures },
      ...swarmSpecies(speciesRecipes).filter((rec) => rec.treat).map((rec) => ({ key: keyOf(rec), rec, live: schools.find((s) => s.id === keyOf(rec)) ?? null }))] });
  updateStore('treatKinds', () => pack.recipe.kinds.map((/** @type {any} */ k) => k.id).filter((/** @type {string} */ k) => treats.isTreat(k)));
  if (params.has('treats') && !back) { pack.add('wrack', 3); pack.add('leaf-pack', 3); pack.add('leaves', 1); }
  // `?treats&frogs=N`: once the frogs are there, you stand on the bank a few steps from one, facing it.
  if (params.has('treats') && params.has('frogs') && !back) {
    let stood = false;
    sim.addSystem({ id: 'treats-test', tick() {
      const f = stood ? null : creatures.frogs()[0];
      if (!f) return;
      stood = true;
      for (let i = 0; i < 12; i++) {
        // Just outside a shy frog's comfort ring (frog.json presence.ringM), so it comes at once.
        const a = (i / 12) * 2 * Math.PI, d = frogRecipe.presence.ringM + 0.9, x = f.x + Math.sin(a) * d, z = f.z + Math.cos(a) * d;
        if ((water.sampleLive(x, z)?.depth ?? 0) > 0.01) continue;
        const yaw = Math.atan2(f.x - x, f.z - z);
        if (!walk.placeAt(x, z, yaw, 'stand')) continue;
        camera.setPose({ ...camera.pose(), target: [x, terrain.sampleHeight(x, z), z], yaw: yaw + Math.PI, distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
        return;
      }
    } });
  }
  // What lies on the ground to gather, the piles at camp and the heaps you left (src/world/pack/draw.js).
  const packDraw = createPackDraw({ terrain, camera, recipe: pack.recipe, gather, pack, treats, water: (x, z) => water.sampleLive(x, z), you: () => walk.you() });
  sim.addSystem(packDraw);
  /** How far a ground spot's pickups lie from its middle, for what its card lifts (F5). @param {string} kind */
  const spreadOf = (kind) => pack.recipe.pickups?.kinds?.[kind]?.spreadM ?? 0.4;
  // The keeper's camp (docs/future/13 section 3; src/world/camp): the tent and the fire ring in their
  // slots, the fire and the lantern as small lights, smoke and moths, and a night's rest in the tent.
  const camp = createCamp({ recipe: campRecipe, seed, walk, terrain, water, clock, orbit: skyRecipe.orbit, camera, world, piles,
    seasons: seasonsRecipe, lighting, pack, shadowBias: shadowPass.bias, low: tier === 'low', poses: (await loadRecipe('world/figure')).poses,
    beat: () => intro.live?.intro.current?.id ?? null, cook: await loadRecipe('world/cook') });
  sim.addSystem(camp);
  ringPlace = camp.ringPlace;
  keeps = camp.stations.keeps;
  // Solid things the walker cannot pass through (src/world/walk/solids-live.js): camp pieces, logs,
  // stones and the boat.
  const solidsLive = createSolidsLive({ walk, where: createWhere({ terrain }), benchAt: camp.stations.benchAt, rackYawDeg: campRecipe.rack?.yawDeg ?? 0,
    strand: () => pieces.strandLogs(), boat: () => (boat.visible ? boat.mooring?.boat ?? null : null), boatSize: boatRecipe.boat.hull });
  sim.addSystem({ id: 'solids', tick: (/** @type {any} */ f) => solidsLive.update(f.realDt) });
  shadowPass.addCaster(camp.props.caster);
  midges.keepClear(() => camp.smokeClear());
  // What your figure glances at on foot (src/world/figure/look.js): frogs near you, the fire while it
  // burns, and the finds drawn about you.
  walk.setInterests(() => {
    const fire = camp.smokeClear();
    return [
      ...creatures.frogs().map((f) => ({ x: f.x, z: f.z, kind: 'creature' })),
      ...(fire ? [{ x: fire.x, z: fire.z, kind: 'fire' }] : []),
      ...finds.shown().map((f) => ({ x: f.x, z: f.z, kind: 'find' })),
    ];
  });
  // Its gestures for the pouches (src/world/figure/acts.js): setting one down onto a pile at camp,
  // and emptying one.
  on('pack:set-down', (/** @type {{ pile: string | null, at?: { x: number, z: number } | null }} */ p) => walk.gesture('setDown', p.pile ? pieceSpot(p.pile) : p.at ?? undefined));
  on('pack:emptied', () => walk.gesture('empty'));
  intro.useCamp(camp);
  // The stores (section 3.12; src/world/pack/stores.js): the wood store, the stone pile and the clay
  // slab, places with a card from the first frame (drawn by packDraw), glowing while the pack holds
  // their kind near camp.
  const stores = createStores({ recipe: pack.recipe, piles, walk, glow: campRecipe.glow, ringLaid: () => camp.ringLaid() });
  // Digging (docs/future/13 section 10, P2c; src/world/dig): Dig and Scoop sand on the here-bar once
  // the shovel is made at the workbench; `?shovel` (testing, unsaved) puts it in the walker's kit.
  const dig = createDig({ recipe: await loadRecipe('world/dig'), keepsakes: keepsakesRecipe, seed, world, walk, terrain, water, pieces, pack, gather, presence,
    worldT: () => clock.worldT(), test: params.has('shovel'), propsRecipe: campRecipe.props, shadowBias: shadowPass.bias, noteKept: (n) => noteKept(n) });
  dig.setKeepsakeWords((n) => keepsakeWords(n, keepsakesRecipe));
  sim.addSystem(dig);
  shadowPass.addCaster(dig.props.caster);
  // The walker's sketchbook (P2i I5; src/world/sketchbook): Sketch on the here-bar with charcoal
  // sticks in the pack and a creature, plant or find near the middle of the view.
  const sketchRecipe = await loadRecipe('world/sketchbook');
  const sketchbook = createSketchbook({ recipe: sketchRecipe, walk, pack, worldT: () => clock.worldT(), season: () => world.state?.seasons?.index ?? 0,
    weather: () => { const w = weatherAt(world.state?.weather, clock.display(), seasonsRecipe); return { rain: w.rain ?? 0, mist: w.mist ?? 0 }; },
    subject: () => sketchSubject() });
  sim.addSystem(sketchbook);
  // `?sketch` (a test link, unsaved): a full pouch of charcoal sticks in the pack.
  if (params.has('sketch') && !back) pack.add('charcoal-sticks', 3);
  // `?planting` (a test link, unsaved; P2g): in the pack, water mint seed, an iris clump, two willow
  // withies, kelp for a good start and clay with campion seed for seed balls; the shovel made, for Lift.
  if (params.has('planting') && !back) {
    for (const [k, n] of [['watermint.seed', 3], ['willow.withies', 2], ['kelp', 1], ['clay', 1], ['campion.seed', 1]]) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    pack.addClump('iris', 0.55, 0.8);
    updateStore('cook', (c) => ({ ...(c ?? {}), tools: [...new Set([...(c?.tools ?? []), 'shovel'])] }));
  }
  // `?camp` (a test link, unsaved; S1): the evening skipped, the camp ready, the pack holding what
  // the workbench and the shovel take, and you standing at the workbench's ground; `?camp=bench`
  // has the workbench built already; `?camp=apothecary` (S2, P2j) the workbench and the apothecary
  // bench built, the rack, mortar and hamper made, and the pack holding herbs and shells, standing
  // at the apothecary bench.
  if (params.has('camp') && !back) {
    emit('intro:camp-ready', { tent: true, ring: true });
    // `?camp=dawn&hour=7` (P2i): the morning after a fire-night, the ring banked to embers with its
    // charcoal and ash, a handful of withies and a pouch of ash in the pack, standing at the ring.
    if (params.get('camp') === 'dawn') {
      const h = clock.worldT() / 3600;
      updateStore('camp', (c) => ({ ...c, fire: { ...c.fire, state: 'embers', sinceHour: h - 8, flameUntilHour: h - 8, litDays: 3, lastLitDay: Math.floor(h / 24) - 1, nights: [Math.floor(h / 24)], carry: null } }));
      for (const [k, n] of [['willow.withies', 1], ['ash', 2], ['sticks', 2]]) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    }
    const apo = params.get('camp') === 'apothecary';
    // `?camp=hearth` (S4, S5): the workbench built, the hearth stones set, the cooking pot and the
    // cup fired in their places, clay, sand and crushed shell in the pack, standing at the ring;
    // `&fire=lit|embers|cold` sets the fire.
    const hearthLink = params.get('camp') === 'hearth';
    // `?camp=carriers` (P2f): the workbench built and the pack holding a satchel's and a basket's parts.
    const carriersLink = params.get('camp') === 'carriers';
    const kit = carriersLink ? [['rushes.stems', 1], ['willow.withies', 1], ['rush-cord', 4]] : apo ? [['shells', 3], ['watermint.leaves', 2], ['chamomile.flowers', 2], ['sticks', 3], ['pebbles', 2], ['rushes.stems', 3]]
      : hearthLink ? [['clay', 3], ['sand', 2], ['crushed-shell', 1], ['sticks', 3]]
      : [['flat-stones', 3], ['sticks', 2], ['rush-cord', 1], ['pebbles', 2]];
    for (const [k, n] of kit) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    if (params.get('camp') === 'bench' || apo || hearthLink || carriersLink) camp.stations.debug.buildNow('workbench');
    if (apo) { camp.stations.debug.buildNow('apothecary'); for (const m of ['rack', 'mortar', 'hamper']) camp.stations.debug.placeNow(m); }
    if (hearthLink) {
      // `&shaped` is the look of it all at once (tools/hearth-check.html): every piece fired, a pale
      // bowl, cup and tea pot on the bench and a bowl firing. Without it, the tea pot and bowls are
      // still to shape and fire.
      camp.hearth.debug.setUp(params.has('shaped') ? { fired: ['cooking-pot', 'tea-pot', 'cup'], shaped: ['bowl', 'cup', 'tea-pot'], firing: ['bowl'] } : {});
      const f = params.get('fire');
      if (f === 'lit' || f === 'embers' || f === 'cold') camp.debug.fireAs(f);
    }
    const rp = hearthLink ? camp.ringPlace() : null, pad = getStore('campPad');
    // At the ring, on the pad's side of it, a little round so the workbench shows too.
    const ringAt = rp && pad ? (() => { const a = Math.atan2(pad.z - rp.z, pad.x - rp.x) - 0.5;
      return { x: rp.x, z: rp.z, stand: { x: rp.x + Math.cos(a) * 1.2, z: rp.z + Math.sin(a) * 1.2 } }; })() : null;
    const at = hearthLink ? ringAt : camp.stations.benchAt(apo ? 'apothecary' : 'workbench');
    if (at && walk.placeAt(at.stand.x, at.stand.z, Math.atan2(at.x - at.stand.x, at.z - at.stand.z), 'stand')) {
      const p = camera.pose();
      camera.setPose({ ...p, target: [at.stand.x, terrain.sampleHeight(at.stand.x, at.stand.z), at.stand.z], yaw: Math.atan2(at.x - at.stand.x, at.z - at.stand.z) + Math.PI + 0.9,
        distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
      walk.downHere();
    }
  }

  /**
   * A dry, grassy ground point near the view's middle, out of the tide, for a test log: on a widening
   * spiral, the first where no water stands and the grass is thick. @returns {number[] | null}
   */
  function testLogSpot() {
    const t = camera.target, grass = world.state?.growth?.grass;
    for (let k = 0; k < 400; k++) {
      const r = 0.6 + k * 0.03, a = k * 2.399;
      const x = t[0] + Math.cos(a) * r, z = t[2] + Math.sin(a) * r;
      if ((water.sampleLive?.(x, z)?.depth ?? 0) > 0 || (water.sampleLive?.(x + 1, z)?.depth ?? 0) > 0 || (water.sampleLive?.(x - 1, z)?.depth ?? 0) > 0) continue;
      const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
      if (grass && !(grass[j * HABITAT_CELLS + i] > 120)) continue;
      const s = water.getSummary?.();
      const wi = waterCellOf(x) - (s?.rect.x ?? 0), wj = waterCellOf(z) - (s?.rect.y ?? 0);
      if (s && wi >= 0 && wj >= 0 && wi < s.rect.w && wj < s.rect.h && s.band[wj * s.rect.w + wi]) continue;
      return [x, z];
    }
    return null;
  }
  /** Keep a log near the view as if carried there before this autumn (the fungi's test). @param {number} [x] @param {number} [z] */
  function keepTestLog(x, z) {
    const at = x === undefined || z === undefined ? testLogSpot() : [x, z];
    if (!at) return null;
    const day = Math.floor(clock.hourIndex() / 24), a0 = autumnStartOf(day);
    const F = autumnRecipe.fungi;
    return pieces.debugKeepLog(at[0], at[1], a0 === null ? F.restDays + 1 : day - a0 + F.restDays + 1);
  }
  // `?autumn`: once the water and the grass are up, a kept log near the view, and the camera looks at it.
  if (autumnDay !== null) {
    let laid = false, wait = 0;
    sim.addSystem({ id: 'autumn-test', tick(/** @type {any} */ f) {
      if (laid || !water.sim.live || !world.state?.growth?.grass || (wait += f.realDt) < 2) return;
      laid = true;
      const id = keepTestLog();
      const log = pieces.keptLogs().find((/** @type {any} */ l) => l.id === id);
      if (log) camera.focus(log.x, log.z, 2.6, 28);
    } });
  }
  // `?frogscale` (ahead of S6): real-size frogs from the species recipe around the pond, and a
  // camera that may come close, to judge creature size on the island (src/ui/frog-scale.js).
  const frogScale = params.has('frogscale') ? await createFrogScale() : null;
  async function createFrogScale() {
    const recipe = await loadRecipe('species/frog');
    const mesh = bakeBody(recipe.body, recipe.bake.cellM);
    const pass = createCreaturePass({ mesh, recipe });
    camera.setClose({ minDistance: recipe.preview.closeMinDistanceM, minEyeHeight: recipe.preview.closeMinEyeHeightM });
    let size = recipe.body.displayScale ?? 1;
    /** @type {ReturnType<typeof previewSpots>} */ let found = null;
    const place = () => pass.setBeings((found?.spots ?? []).map((s) => ({ ...s, size })));
    return {
      pass, recipe, triangles: mesh.indices.length / 3,
      /** Find the spots (once the island has fresh water); null until then. */
      find() {
        if (found) return found;   // found once, from where the camera first looks, then kept
        if (!water.sim.live) return null;   // the live water copy gives the pad heights
        const target = camera.eye;
        found = previewSpots(growth.habitat?.() ?? world.env.habitat?.() ?? null, world.state?.growth, {
          ground: (x, z) => terrain.sampleHeight(x, z),
          surface: (x, z) => water.sampleLive(x, z).surface,
          from: [target[0], target[2]],
        });
        place();
        return found;
      },
      /** @param {number} s times real size */
      setSize(s) { size = s; place(); },
      get size() { return size; },
    };
  }
  const waterPass = createWaterPass({
    water, terrain, atmosphere, recipe: waterRecipe, seaExtent: terrainRecipe.sea.extent, getTime: () => clock.animT(),
    seabed: { y: landRecipe.seabedDepth, albedo: terrainRecipe.materials.albedoSand.map((/** @type {number} */ a) => a * terrainRecipe.materials.wetDarkening),
      wetDarkening: terrainRecipe.materials.wetDarkening },
    detailFadeM: tierSettings.waterDetailFadeM, ssr: tierSettings.waterSSR ?? null, foam, ripples,
  });
  // Waterfalls (M2 Cliff tool): curtains where live water runs over a drop, visual only.
  // Near the eye they are droplet water with real volume (screen-space fluid, falls-fluid.js).
  const fallsPass = createFallsPass({ water, terrain, recipe: waterRecipe.falls, getTime: () => clock.animT(), tier: tierSettings,
    absorption: waterRecipe.look.absorptionPond, atmosphere, getEye: () => camera.eye, getProjY: () => camera.proj[5],
    getOpaqueDepth: () => waterPass.opaqueDepth });
  const graph = createFrameGraph(gpu, [
    shadowPass,
    terrainPass,
    grassPass,
    rushPass,
    floraPass,
    walk.printsPass,
    creatures.pass,
    walk.pass,
    // The gathering knife on the walker's belt (the forager's trail).
    belt.pass,
    ...schools.map((s) => s.pass),
    finds.pass,
    keepsakes.pass,
    nets.pass,
    ...packDraw.passes,
    pieces.pass,
    // The camp's tent, fire ring and lantern, drawn with their own paint maps.
    camp.props,
    // The shovel in the walker's hands while it digs (src/world/dig).
    dig.props,
    boat.pass,
    // What lives under a log, while it is lifted (L3a).
    underLog.pass,
    // Autumn's fungi (a creature pass) and dewy webs, after the logs and the grass they are on.
    ...autumn.passes,
    ...spring.passes,
    // Moon jellyfish on the summer strandline: clear, so drawn over the opaque things behind them.
    ...(finds.jellyPass ? [finds.jellyPass] : []),
    ...(frogScale ? [frogScale.pass] : []),
    waterPass,
    midges.pass,
    createSkyPass(atmosphere, skyRecipe),
    // Waterfalls after the sky, so a curtain seen against the sky is not drawn over (src/render/passes/falls.js).
    fallsPass,
    // The camp's flame, smoke, sparks and moths: after the sky too, so smoke against it shows.
    camp.fx,
    exposure,
    bloom,
    tonemap,
  ], { tier, lighting });
  await graph.setup();
  // Quality while playing (src/render/quality-live.js): dynamic resolution and the one automatic
  // tier step down with its calm note.
  const live = createQualityLive({
    recipe: await loadRecipe('quality-tiers'), timestamps: graph.timingSupported,
    tier: () => tier, settings: () => tierSettings, applyTier: (t, keepScale) => applyTier(t, keepScale),
  });
  live.setTier(tier, tierSettings, false);

  const uniforms = createFrameUniformWriter();
  const prevViewProj = new Float32Array(16);

  // Size the canvas from its CSS box, within the tier's DPR and megapixel caps.
  let cssW = 1;
  let cssH = 1;
  let devW = 1;
  let devH = 1;
  /** @type {ResizeObserverEntry | null} */ let lastEntry = null;
  /** @param {ResizeObserverEntry} e */
  function sizeCanvas(e) {
    lastEntry = e;
    cssW = e.contentRect.width;
    cssH = e.contentRect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, tierSettings.maxDpr);
    const box = e.devicePixelContentBoxSize?.[0];
    let w = box ? box.inlineSize * (dpr / (window.devicePixelRatio || 1)) : cssW * dpr;
    let h = box ? box.blockSize * (dpr / (window.devicePixelRatio || 1)) : cssH * dpr;
    const maxPx = tierSettings.maxMegapixels * 1e6;
    if (w * h > maxPx) {
      const k = Math.sqrt(maxPx / (w * h));
      w *= k;
      h *= k;
    }
    devW = Math.max(1, Math.round(w));
    devH = Math.max(1, Math.round(h));
  }
  const observer = new ResizeObserver((entries) => sizeCanvas(entries[0]));
  observer.observe(canvas);

  // Startup probe (docs/19): a device trying ultra measures GPU time for a couple of seconds once
  // the ground detail has faded in, then keeps ultra or steps back to high, with no reload.
  // Any tier switch (the probe, the automatic step down and its undo, Settings) comes through here.
  /** @param {any} t tier name @param {boolean} [keepScale] keep the render scale (an automatic step or its undo) */
  function applyTier(t, keepScale = false) {
    tier = t;
    tierSettings = settingsFor(t);
    setQualityTier(t);
    terrainPass.setTier({ ...tierSettings, name: t });
    grassPass.setTier(tierSettings);
    rushPass.setTier(tierSettings);
    waterPass.setDetailFade(tierSettings.waterDetailFadeM);
    waterPass.setSSR(tierSettings.waterSSR ?? null);
    if (fallsPass.setTier(tierSettings)) graph.invalidate();
    // Shadows, bloom and the midges follow too. A texture's size is fixed once made, so a new
    // shadow map size re-makes only that map and the lighting group that binds it; new bloom levels
    // re-make the bloom chain at the next resize, which invalidate() forces.
    if (shadowPass.setTier(tierSettings.shadows, gpu.device, tierSettings.cliffDetailM)) lighting.setShadow(shadowPass.resources(gpu.device));
    if (bloom.setLevels(tierSettings.bloomLevels)) graph.invalidate();
    midges.setBudget(tierSettings.boids ?? 4096);
    for (const s of schools) s.setBudget(tierSettings.liveCreatures ?? 120);
    live.setTier(t, tierSettings, keepScale);
    if (lastEntry) sizeCanvas(lastEntry);
    updateStore('settings', (s) => { s.quality = t; });
  }
  /** @type {number[]} */ const probeMs = [];
  let probeFrames = 0;
  let probeStart = 0;
  let unProbe = () => {};
  if (probe) {
    if (!graph.timingSupported) {
      // Without GPU timestamps there is nothing to measure; stay on the safe side.
      applyTier(probeResult(false, probe.fallback));
    } else {
      unProbe = on('render:timings', (/** @type {{ passes: { ms: number }[], gpu: boolean }} */ p) => {
        if (!probe || groundDetail.fade < 1) return;
        if (++probeFrames < probe.settleFrames) return;
        if (!probeStart) probeStart = performance.now();
        probeMs.push(p.passes.reduce((sum, x) => sum + x.ms, 0));
        if (performance.now() - probeStart < probe.seconds * 1000) return;
        const sorted = probeMs.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const passed = p95 <= probe.maxMs;
        console.info(`quality probe: GPU p95 ${p95.toFixed(2)} ms over ${sorted.length} frames, ${passed ? 'keeping' : 'stepping down from'} ${tier}`);
        applyTier(probeResult(passed, probe.fallback));
        probe = null;
        unProbe();
      });
    }
  }

  // ---- tools and strokes ----
  const pointer = { x: 0, y: 0, inside: false };
  let stroking = false;
  let wantStroke = false;
  /** @type {null | 'undo' | 'redo'} */
  let queuedHistory = null;

  const tools = () => getStore('tools');
  /** @returns {import('./world/terrain/brushes.js').Brush} */
  function currentBrush() {
    const t = tools();
    const kind = t.tool === 'sculpt' ? t.sculptMode : t.tool === 'smooth' ? 'smooth' : 'paint';
    return { kind, radius: t.size, strength: t.strength, layer: t.paintLayer, height: t.cliffHeight ?? terrainRecipe.cliff.heightDefault, sea: shiftHeld };
  }
  /** Shift held at the start of the stroke (desktop): Terrace and Cut level to mean sea level. */
  let shiftHeld = false;
  const isCliffMode = () => tools().tool === 'sculpt' && (tools().sculptMode === 'terrace' || tools().sculptMode === 'cut');
  /** @param {number} x @param {number} y */
  /**
   * The stone or log a tap below lands on (L3a): low down, the ray grazes past a log onto the ground
   * behind it, so it is tried where it passes a little over the ground too, nearest first.
   * @param {number} x @param {number} y @param {number[]} point the ground the tap landed on
   */
  function pieceUnderTap(x, y, point) {
    const r = camera.ray(x, y);
    // What sits up on the hearth or by the fire (a pot, the cup, a piece firing) wins over the ring
    // under it: the ray is tried against each one's own height.
    const lifted = camp.liftedUnderRay(r.o, r.d);
    if (lifted) return lifted;
    for (const h of [0.3, 0.2, 0.12, 0.05]) {
      if (r.d[1] > -1e-4) break;
      const t = (point[1] + h - r.o[1]) / r.d[1];
      if (!(t > 0)) continue;
      const hit = pieces.pieceAt(r.o[0] + r.d[0] * t, r.o[2] + r.d[2] * t);
      if (hit) return hit;
    }
    return pieces.pieceAt(point[0], point[2]);
  }
  /**
   * What a ground point holds, as a card (the journal's cardAt), and the journal's species words;
   * main.js hands these in once the journal exists (setCards below). Null until then.
   * @type {{ cardAt: (x: number, z: number, y?: number) => any, species: Record<string, any> } | null}
   */
  let cards = null;
  /** A thing you clicked on and are walking to: its card opens when you stop. @type {number[] | null} */
  let cardOnArrival = null;

  /**
   * A click below (src/world/walk/click.js): walk, walk to a thing then open its card, or open a card
   * where you stand. A walk elsewhere puts away the card that was open (not a Show me ring).
   * @param {number} sx @param {number} sy CSS pixels @param {number[]} p the ground point
   */
  function clickBelow(sx, sy, p) {
    const card = cards?.cardAt(p[0], p[2], p[1]) ?? null;
    const kind = clickKind(card, cards?.species ?? {});
    const wx = card?.wx ?? p[0], wz = card?.wz ?? p[2];
    const plan = clickPlan(kind, walk.distTo(wx, wz), card?.r ?? 0, walkerRecipe.click, !!card?.gathers?.length);
    cardOnArrival = null;
    if (plan.kind === 'card') { emitDeferred('look:tapped', { x: sx, y: sy, point: p }); return; }
    if (!getStore('identify')?.pinned) updateStore('identify', () => null);
    if (plan.kind === 'approach') {
      if (walk.tap(sx, sy, [wx, p[1], wz], plan.reachM)) cardOnArrival = p;
      return;
    }
    walk.tap(sx, sy, p);
  }

  /**
   * What the walker would sketch (P2i): the creature, plant or find nearest the middle of the view,
   * within reach. The view is sampled in rings out from its middle through the journal's cards, so
   * the first one found is the nearest the middle. Null above, or with nothing there.
   * @returns {{ id: string, name: string, x: number, z: number } | null}
   */
  function sketchSubject() {
    if (!walk.below || !cards) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight, s = sketchRecipe.viewSampleSpreadPx ?? 70;
    for (let ring = 0; ring <= 4; ring++) {
      for (let k = 0; k < (ring ? 8 : 1); k++) {
        const a = (k / 8) * 2 * Math.PI, p = groundAt(w / 2 + Math.cos(a) * ring * s, h / 2 + Math.sin(a) * ring * s);
        const c = p ? cards.cardAt(p[0], p[2], p[1]) : null;
        if (!c?.sp || !sketchRecipe.subjects.includes(c.sp)) continue;
        const x = c.wx ?? p?.[0] ?? 0, z = c.wz ?? p?.[2] ?? 0;
        // Named by its kind, singular and without its article ("school of minnows"), never a frog's own name.
        const sw = cards.species?.[c.sp], name = String(sw?.card ?? sw?.name ?? c.name ?? c.sp).replace(/^(a|an|the) /i, '');
        if (walk.distTo(x, z) <= sketchRecipe.reachM) return { id: c.sp, name, x, z };
      }
    }
    return null;
  }

  /**
   * After a Set down or Take up on a pile's or a store's card: the card again as it is now (the
   * pile's new size, or the store empty), kept where it is on screen; closed if nothing is there.
   */
  function refreshStoreCard() {
    const c = getStore('identify');
    if (!c || !(c.piece || c.store) || !cards) return;
    const next = cards.cardAt(c.wx, c.wz);
    updateStore('identify', () => (next ? { ...next, x: c.x, y: c.y, at: performance.now() } : null));
  }

  /**
   * Hovering below: what a click there would use (null over plain walking ground). Names what a
   * click would gather when there is something (else the thing itself), at the thing's own spot.
   * @param {number} ox @param {number} oy canvas point
   * @returns {{ key: string, name: string, wx: number, wz: number, lift: import('./render/lift.js').LiftTarget[] } | null}
   */
  function hoverPick(ox, oy) {
    if (!walk.below || !cards) return null;
    const p = groundAt(ox, oy);
    const pc = p ? pieceUnderTap(ox, oy, p) : null;
    const q = pc && p ? [pc.x, p[1], pc.z] : p;
    const card = q ? cards.cardAt(q[0], q[2], q[1]) : null;
    if (!card || !q) return null;
    const plan = clickPlan(clickKind(card, cards.species), walk.distTo(card.wx ?? q[0], card.wz ?? q[2]), card.r ?? 0, walkerRecipe.click, !!card.gathers?.length);
    if (plan.kind === 'walk') return null;
    const g = card.gathers?.[0];
    const at = g?.spot ? [g.spot.x, g.spot.z] : Number.isFinite(g?.x) ? [g.x, g.z] : [card.wx ?? q[0], card.wz ?? q[2]];
    const name = g?.name ?? card.name;
    return { key: `${name}|${Math.round(at[0] * 10)}|${Math.round(at[1] * 10)}`, name, wx: at[0], wz: at[1], lift: liftFor(card, spreadOf) };
  }
  /**
   * The hover tag (F4; src/ui/hover-tag.js reads the store slice `hover`): the hand cursor follows
   * the pointer a few times a second, but the tag names a thing only once the pointer rests on it
   * (recipes/world/walker.json click.hoverRestS), sits over the thing and never chases the pointer.
   * Moving onto another thing hides it until a new rest.
   */
  let hoverAt = 0, restTimer = 0, restX = -1e9, restY = -1e9;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const C = walkerRecipe.click;
    const ox = e.offsetX, oy = e.offsetY;
    // Something in hand (D1a): the sowing ring follows the pointer, and nothing else is named.
    if (walk.below && getStore('hand')) {
      sowing.setPointer(e.buttons ? null : groundAt(ox, oy));
      if (getStore('hover')) updateStore('hover', () => null);
      canvas.classList.remove('ebb-can-use');
      return;
    }
    if (Math.hypot(ox - restX, oy - restY) > (C.hoverRestPx ?? 4)) {
      restX = ox; restY = oy;
      clearTimeout(restTimer);
      restTimer = e.buttons ? 0 : window.setTimeout(() => {
        const h = hoverPick(ox, oy);
        if (h && h.key !== getStore('hover')?.key) updateStore('hover', () => h);
      }, (C.hoverRestS ?? 0.25) * 1000);
    }
    const now = performance.now();
    if (now - hoverAt < 1000 / C.hoverHz) return;
    hoverAt = now;
    const h = e.buttons ? null : hoverPick(ox, oy);
    const was = getStore('hover');
    if (was && was.key !== h?.key) updateStore('hover', () => null);
    canvas.classList.toggle('ebb-can-use', !!h);
  });
  const hoverOff = () => {
    clearTimeout(restTimer); restX = restY = -1e9;
    if (getStore('hover')) updateStore('hover', () => null);
    canvas.classList.remove('ebb-can-use');
  };
  canvas.addEventListener('pointerleave', () => { hoverOff(); sowing.setPointer(null); });
  canvas.addEventListener('pointerdown', hoverOff);

  // ---- walking with the keys and the mouse (WASD; src/world/walk/controls.js) ----
  /** What the centre dot rests on, and since when (ms): its tag shows after hoverRestS, as a pointer's rest. */
  let dotKey = '', dotSince = 0;
  const walkControls = createWalkControls({
    canvas, walk, camera, recipe: walkerRecipe,
    // A card or panel over the view: keys wait, and the pointer is freed to use it.
    open: () => !!getStore('identify') || !!getStore('journalUi')?.open || !!getStore('haul') || !!getStore('shelfPending')
      || !!getStore('sketchbookUi')?.open || !!getStore('stationView'),
    use: (x, y) => dispatch({ type: 'look.tap', x, y, source: 'mouse' }),
    hover: (x, y) => {
      if (getStore('hand')) { sowing.setPointer(groundAt(x, y)); return; }
      const h = hoverPick(x, y), key = h?.key ?? '', now = performance.now();
      if (key !== dotKey) { dotKey = key; dotSince = now; if (getStore('hover')) updateStore('hover', () => null); }
      else if (h && now - dotSince >= walkerRecipe.click.hoverRestS * 1000 && getStore('hover')?.key !== key) updateStore('hover', () => h);
    },
    pan: (dx, dy) => camera.pan(dx, dy),
  });
  // A movement key or a roll takes over from a click walk: the card it would open, and a walk to sow, are let go.
  on('walk:keys', () => { cardOnArrival = null; sowing.cancelWalk(); });

  /** Each frame: you reached the thing you clicked on, so its card opens beside it. */
  function arriveForCard() {
    if (!cardOnArrival) return;
    if (!walk.below) { cardOnArrival = null; return; }
    if (walk.busy()) return;
    const p = cardOnArrival;
    cardOnArrival = null;
    const at = getStore('view')?.project?.(p[0], p[2]);
    emitDeferred('look:tapped', { x: at?.x ?? cssW / 2, y: at?.y ?? cssH / 2, point: p });
  }

  function groundAt(x, y) {
    const r = camera.ray(x, y);
    const hit = terrain.raycast(r.o, r.d);
    if (!hit.hit) return null;
    const ob = terrain.openBounds();
    const [px, , pz] = hit.point;
    if (px < ob.openMin[0] || px > ob.openMax[0] || pz < ob.openMin[1] || pz > ob.openMax[1]) return null;
    return hit.point;
  }
  /** @param {number} size */
  const clampSize = (size) => Math.min(rb.radiusRange[1], Math.max(rb.radiusRange[0], size));

  function finishStroke() {
    if (!stroking) { wantStroke = false; return; }
    stroking = false;
    wantStroke = false;
    // Plants whose ground rose past their bury depth go under, and ride in the undo (bury.js).
    terrain.endStroke().then((cmd) => { if (cmd) history.push(growth.buryFor(cmd)); });
  }

  // ---- the water tool (docs/07): pour and drain while held; springs on tap (when unlocked) ----
  /** Screen point of a held pour or drain, or null. @type {null | { x: number, y: number }} */
  let pouring = null;

  /**
   * The camp ground stays clear (docs/future/13 CP-01): true when a ground point is on the live pad
   * (store slice `campPad`), after saying so in one quiet line on the island unless `quiet`.
   * @param {ArrayLike<number>} p @param {boolean} [quiet]
   */
  function onCampPad(p, quiet = false) {
    if (!onPad(getStore('campPad') ?? null, p[0], p[2])) return false;
    // On the tool card's own line, since the island notes step aside while a card is open on narrower windows.
    if (!quiet) updateStore('campUi', () => ({ message: campRecipe.words.clear, refused: true, at: performance.now() }));
    return true;
  }
  /** The pour held over the pad has said so once this press. */
  let pourRefusedOnPad = false;

  /** Each frame while pour or drain is held: the brush source under the pointer. No water is poured on the camp pad. */
  function updatePour() {
    const t = tools();
    let p = pouring && t.tool === 'water' ? groundAt(pouring.x, pouring.y) : null;
    if (!pouring) pourRefusedOnPad = false;
    if (p && t.waterMode === 'pour' && onCampPad(p, pourRefusedOnPad)) { pourRefusedOnPad = true; p = null; }
    if (p) presence.edit(p[0], p[2]);
    ww.holdBrush(p, t);
  }

  /** Tap with the spring mode: select a placed spring, or place a new one under the cap. @param {number} x @param {number} y */
  function springTap(x, y) {
    if (!getStore('unlocks')?.springs) return;
    const p = groundAt(x, y);
    // A spring already there (an older island's) can still be selected; a new one is refused on the pad.
    if (p && !ww.water.springAt(p[0], p[2], 1.0) && onCampPad(p)) return;
    if (p) ww.tapSpring(p, tools().springRate);
  }

  /**
   * Sculpt's Stone mode (docs/future/10): set a seeded boulder where you tap, undoable. The size slider
   * is the boulder's width, within terrain.json stone.widthM. @param {number} x @param {number} y
   */
  function stoneTap(x, y) {
    const p = groundAt(x, y);
    if (!p) return;
    presence.edit(p[0], p[2]);
    const [wMin, wMax] = terrainRecipe.stone.widthM;
    const cmd = terrain.stampStone(p, Math.min(wMax, Math.max(wMin, tools().size)) / 2);
    if (cmd) { history.push(growth.buryFor(cmd)); emitDeferred('terrain:stone-set', { x: p[0], z: p[2] }); }
  }

  /** Sculpt's Loose stone mode: select a placed stone, or set one under the cap (src/world/pieces). @param {number} x @param {number} y */
  function looseStoneTap(x, y) {
    if (!getStore('unlocks')?.stones) return;
    const p = groundAt(x, y);
    if (!p) return;
    // A stone already there can still be selected; a new one is refused on the camp pad.
    if (!pieces.pieceAt(p[0], p[2]) && onCampPad(p)) return;
    presence.edit(p[0], p[2]);
    pieces.tap(p);
  }

  /**
   * Sculpt's Pond stones and Steps modes (src/world/pieces): a drag lays a line of stones, or cuts
   * a flight from where it began to where it ends; a tap on one selects it.
   * @type {'pondstones' | 'steps' | null}
   */
  let shapingDrag = null;
  /** @param {'tool.begin' | 'tool.move'} type @param {number} x @param {number} y */
  function shapingDragTo(type, x, y) {
    const mode = tools().sculptMode;
    if ((mode === 'pondstones' && !getStore('unlocks')?.pondStones) || (mode === 'steps' && !getStore('unlocks')?.steps)) return;
    const p = groundAt(x, y);
    if (!p) return;
    if (type === 'tool.begin') {
      finishShapingDrag();
      shapingDrag = mode;
      presence.edit(p[0], p[2]);
      if (mode === 'pondstones') pieces.layBegin(p, camera.ray(x, y)); else pieces.stepsBegin(p);
    } else if (shapingDrag === 'pondstones') pieces.layTo(p);
    else if (shapingDrag === 'steps') pieces.stepsTo(p);
  }
  function finishShapingDrag() {
    if (shapingDrag === 'pondstones') pieces.layEnd();
    else if (shapingDrag === 'steps') pieces.stepsEnd();
    shapingDrag = null;
  }

  // The Plant tool (src/world/growth/plant-tool.js): plants a seed where the ground suits it, rings where.
  // A tap on the camp pad is refused with the camp's words (CP-16, recipes/world/camp.json).
  const plantTool = createPlantTool({ growth, world, flora, recipe: growthRecipe.marks, campWords: campRecipe?.words ?? null });
  /** @param {number} x @param {number} y */
  function plantTap(x, y) {
    const p = groundAt(x, y);
    if (p) presence.edit(p[0], p[2]);
    if (p && plantTool.tap(tools().plantSpecies ?? 'reeds', p)) updateStore('world', () => world.state);
  }
  // Planting on foot (D1a, src/world/sowing): the seed tin, the gift spot and the net in hand, the
  // ring under the pointer, a click to sow, place or set; drawn over the island by sow-overlay.js.
  // P2g (src/world/sowing/planting.js): saved seed, seed balls, clumps and withies from the pack, and
  // the plant card's Lift with the shovel.
  const planting = createPlanting({ recipe: sowingRecipe, plantTool, growth, pack, flora, walk,
    hasShovel: () => !!getStore('cook')?.tools?.includes('shovel'), plants: () => world.state?.growth?.plants ?? [],
    ground: (x, z) => terrain.sampleHeight(x, z), worldChanged: () => updateStore('world', () => world.state) });
  const sowing = createSowing({ recipe: sowingRecipe, plantTool, pieces, nets, walk, planting,
    ground: (x, z) => terrain.sampleHeight(x, z),
    depth: (x, z) => water.sampleLive(x, z)?.depth ?? 0,
    worldChanged: () => updateStore('world', () => world.state) });
  updateStore('hand', () => null);
  const sowOverlay = mountSowOverlay(document.body, sowingRecipe);

  // The Feed tool (S6c-2, src/world/creatures/feeding.js): food lands where you tap and a frog may
  // come for it. Not an edit: a gentle toss never startles. Its line goes to the tool card (`feedUi`).
  /** @param {number} x @param {number} y */
  function feedTap(x, y) {
    const p = groundAt(x, y);
    if (!p) return;
    // Who you are feeding: the chosen chip, else the first found (as the tool shows it, src/ui/tools.js).
    const known = ['frogs', ...schools.map((s) => s.id)].filter((id) => getStore('journal')?.species?.[id]?.ever);
    const chosen = tools().feedSpecies;
    const sp = chosen && known.includes(chosen) ? chosen : known[0] ?? 'frogs';
    const school = schools.find((s) => s.id === sp);
    const message = school ? school.feed(p[0], p[2]) : creatures.feed(p[0], p[2]);
    updateStore('feedUi', () => ({ message, at: performance.now() }));
  }

  /**
   * Feed from the hand (W4, only on foot): you kneel and the food goes down just in front of you.
   * Food in the water is for a school you have found (the minnows), on land for the frogs. Its line
   * goes on the island.
   */
  function feedHere() {
    const p = walk.feedPoint();
    if (!p) return;
    const known = schools.filter((s) => getStore('journal')?.species?.[s.id]?.ever);
    const wet = (water.sampleLive(p[0], p[2])?.depth ?? 0) > 0.03;
    const message = wet && known.length ? known[0].feed(p[0], p[2])
      : getStore('journal')?.species?.frogs?.ever || !known.length ? creatures.feed(p[0], p[2]) : walkerRecipe.words.feedNone;
    if (message) emitDeferred('island:notice', { text: message, showS: walkerRecipe.words.noticeS });
  }

  /** Where a piece or a pile stands, for a gesture toward it. @param {string} id */
  function pieceSpot(id) {
    const p = pieces.piece(id);
    return p ? { x: p.x, z: p.z } : undefined;
  }

  /**
   * Set a carried stone or log down where the tap lands (src/world/pieces, undoable). In water it
   * stays carried and the card says so; at the logs' cap it goes back and the card says that.
   * @param {number} x @param {number} y
   */
  function carryTap(x, y) {
    const p = groundAt(x, y);
    if (!p) return;
    presence.edit(p[0], p[2]);
    const r = pieces.setDown(p);
    if (r.ok) updateStore('identify', () => null);
    else {
      // Water and the camp ground keep it carried, with a line saying why; the cap puts it back.
      const still = r.reason === 'water' || r.reason === 'camp';
      updateStore('identify', (c) => (c ? { ...c, carrying: still, carryNote: r.reason === 'gone' ? null : r.reason, canCarry: still } : c));
    }
  }

  /**
   * A keepsake kept, noted for good in the saved unlocks: its family (src/world/expansion.js gives the
   * general net at four), and the beachcomber's firsts it brings (src/world/trails.js: its family,
   * its rarity, its mark). @param {any} n its numbers
   */
  function noteKept(n) {
    if (!n?.family) return;
    updateStore('unlocks', (u) => {
      let earned = keptFamily(u?.earned, n.family);
      for (const f of keptFirsts(n, clock.hourIndex())) earned = addFirst(earned, f);
      return { ...u, earned };
    });
  }
  /** Firsts for the trails (a mark seen, a place made): written once, for good. @param {import('./world/trails.js').First | null} f */
  function noteFirst(f) {
    if (f) updateStore('unlocks', (u) => { const earned = addFirst(u?.earned, f); return earned === u?.earned ? u : { ...u, earned }; });
  }
  // A keepsake with a mark seen, on the beach or on the haul tray: noticing is enough.
  on('keepsake:seen', (/** @type {{ n: any }} */ p) => noteFirst(seenMark(p.n, clock.hourIndex())));

  /** @param {'undo'|'redo'} dir */
  function runHistory(dir) {
    const ok = dir === 'undo' ? history.undo() : history.redo();
    queuedHistory = ok ? null : dir; // busy: retry once the stroke has settled
  }

  const unAction = onAction((a) => {
    // Below (the walker): a drag looks around you, a zoom stays on you, a tap walks there, and the
    // shaping tools are put away until you go up.
    if (walk.below) {
      if (a.type === 'camera.pan') { camera.orbit(a.dx, a.dy); return; }
      if (a.type === 'camera.zoom') { camera.zoom(a.factor); return; }
      if (a.type === 'look.tap') {
        // One click walks and uses (src/world/walk/click.js): a thing walks you to it and opens its
        // card; a creature's card opens where you stand; grass, sand and shingle only near you.
        const point = groundAt(a.x, a.y);
        if (!point) return;
        // A seed, a gift or the net in hand: the click sows, places or sets it instead (D1a).
        if (sowing.click(a.x, a.y, point)) return;
        sowing.cancelWalk();
        // Low down, the ray grazes past a log or stone onto the ground behind it: try it first.
        const pc = pieceUnderTap(a.x, a.y, point);
        clickBelow(a.x, a.y, pc ? [pc.x, point[1], pc.z] : point);
        return;
      }
      // The pouches (src/world/pack): a pouch's card, Set down at camp, Empty.
      if (a.type === 'pack.open') { pack.open(a.i, a.x, a.y); return; }
      if (a.type === 'pack.setDown') { pack.setDown(a.i); return; }
      // A pile's card: Set down one pouch of its kind, then the card again with the pile's new size.
      if (a.type === 'pack.setDownKind') {
        pack.setDownKind(a.kind);
        refreshStoreCard();
        return;
      }
      if (a.type === 'pack.empty') { pack.empty(a.i); return; }
      if (a.type === 'gather.take') { gather.take(a.n); return; }
      if (a.type === 'gather.heapHere') { gather.heapHere(); walk.gesture('heapHere'); return; }
      if (a.type === 'gather.leaveBe') { updateStore('identify', () => null); return; }
      if (a.type === 'gather.spreadAsh') { if (gather.spreadAsh()) { walk.gesture('empty'); updateStore('identify', () => null); } return; }
      // Set out a treat (P2h): its line on the island, as Feed's.
      if (a.type === 'treats.setOut') {
        const line = treats.setOut(a.kind);
        updateStore('identify', () => null);
        if (line) emitDeferred('island:notice', { text: line, showS: walkerRecipe.words.noticeS });
        return;
      }
      // A pile's Take up fills a pouch; with no room, the full card (without Set down here).
      if (a.type === 'pile.takeUp') {
        const r = piles?.takeUp(a.id, pack);
        if (r?.taken) walk.gesture('takeUp', pieceSpot(a.id));
        if (r?.full) updateStore('identify', (c) => (c ? { ...c, full: { kind: r.kind, g: { heap: -1 } }, text: pack.recipe.words.full } : c));
        // A store's card stays, with what is left (or Empty); a heap's goes with it.
        else if (getStore('identify')?.store) refreshStoreCard();
        else updateStore('identify', () => null);
        return;
      }
      if (a.type === 'walk.up') { sowing.putAway(); sowing.cancelWalk(); walk.up(); return; }
      if (a.type === 'walk.stuck') { sowing.cancelWalk(); walk.stuck(); return; }
      if (a.type === 'walk.posture') { walk.posture(a.posture); return; }
      if (a.type === 'walk.feed') { feedHere(); return; }
      // The seed tin, the gift spot and the net (D1a): pick one into your hand, or put it away.
      if (a.type === 'hand.pick') { sowing.pick({ kind: a.kind, id: a.id }); updateStore('identify', () => null); return; }
      if (a.type === 'hand.putAway') { sowing.putAway(); return; }
      if (a.type === 'tool.select' || a.type.startsWith('tool.') || a.type === 'brush.resize') return;
    }
    switch (a.type) {
      case 'walk.down':
        finishStroke();
        pouring = null;
        pieces.cancelCarry();
        updateStore('tools', (t) => { t.tool = null; });
        terrain.setRing({ visible: false, level: null });
        walk.down();
        break;
      case 'camera.orbit': camera.orbit(a.dx, a.dy); break;
      case 'camera.pan': camera.pan(a.dx, a.dy); break;
      case 'camera.zoom': camera.zoom(a.factor, a.x, a.y); break;
      case 'camera.twist': camera.twist(a.angle); break;
      case 'camera.focus': camera.focus(a.x, a.z, a.distance, a.pitchDeg, a.y); break;
      case 'tool.select': {
        const next = a.toolId && a.toolId !== tools().tool ? a.toolId : null;
        if (!next) finishStroke();
        pouring = null;
        // Choosing a tool, or Escape, puts a carried piece back.
        pieces.cancelCarry();
        updateStore('tools', (t) => { t.tool = next; });
        emitDeferred('tool:selected', { toolId: next });
        break;
      }
      case 'brush.set': {
        updateStore('tools', (t) => {
          Object.assign(t, a.patch);
          t.size = clampSize(t.size);
          t.strength = Math.min(1, Math.max(0, t.strength));
          const [hMin, hMax] = terrainRecipe.cliff.heightM;
          t.cliffHeight = Math.min(hMax, Math.max(hMin, t.cliffHeight ?? terrainRecipe.cliff.heightDefault));
        });
        // A new flow step applies to the selected spring too (undoable).
        if (a.patch.springRate) ww.rateSelected(a.patch.springRate);
        if (a.patch.waterMode && a.patch.waterMode !== 'spring') ww.syncSprings(null);
        if (a.patch.sculptMode && a.patch.sculptMode !== 'loosestone') pieces.deselect();
        if (a.patch.sculptMode || a.patch.waterMode) pieces.deselectShaping();
        break;
      }
      case 'water.springRemove':
        ww.removeSpring(a.id);
        break;
      case 'pieces.remove':
        pieces.remove(a.id);
        break;
      case 'pieces.removeRun':
        pieces.removeRun(a.run);
        break;
      // Carry (the turtles' gift): the card's Carry lifts the piece; the next tap on land sets it
      // down (look.tap below); a tap on the card, its close, a tool or Escape puts it back.
      case 'pieces.carry':
        if (getStore('unlocks')?.carry && pieces.carry(a.id)) updateStore('identify', (c) => (c ? { ...c, carrying: true, carryNote: null, pinned: false } : c));
        break;
      case 'pieces.carryCancel':
        pieces.cancelCarry();
        updateStore('identify', () => null);
        break;
      // Lift (on foot, L3a): the card's Lift rolls the piece back; the journal shows what was under it.
      case 'pieces.lift':
        lift.lift(a.id);
        break;
      // A keepsake's card: Leave it to the sea (docs/future/12). It goes, and the next tide takes it.
      case 'keepsakes.leave':
        keepsakes.leave(a.id);
        updateStore('identify', () => null);
        emitDeferred('keepsake:sound', { name: 'leave' });
        break;
      // Keep it: onto the shelf (src/world/keepsakes/shelf.js), and off the shore. A full shelf
      // opens in the journal and asks which one to let go; nothing is kept until you choose.
      case 'keepsakes.keep': {
        const k0 = keepsakes.toKeep(a.id);
        if (!k0) break;
        // A bottle whose letter was read on the beach keeps that letter.
        const k = shoreLetters.has(a.id) ? { ...k0, letter: shoreLetters.get(a.id) } : k0;
        const r = keepShelf(cleanShelf(getStore('keepsakes')), k);
        if (r.kept) {
          updateStore('keepsakes', () => r.state);
          noteKept(k.n);
          keepsakes.leave(a.id);
          updateStore('identify', () => null);
          emitDeferred('keepsake:sound', { name: k.n.family === 'bottle' ? 'keep-glass' : 'keep' });
        } else {
          updateStore('shelfPending', () => ({ shoreId: a.id, ...k }));
          updateStore('identify', () => null);
          updateStore('journalUi', (u) => ({ ...(u ?? {}), open: true, view: 'shelf', page: null }));
        }
        break;
      }
      case 'keepsakes.swap': {
        const p = getStore('shelfPending');
        if (!p) break;
        updateStore('keepsakes', (s) => swapShelf(cleanShelf(s), a.out, p));
        noteKept(p.n);
        // One from a net's haul: the tray's keepsake is answered.
        if (String(p.shoreId).startsWith('net:')) nets.answered();
        keepsakes.leave(p.shoreId);
        updateStore('shelfPending', () => null);
        emitDeferred('keepsake:sound', { name: p.n?.family === 'bottle' ? 'keep-glass' : 'keep' });
        break;
      }
      case 'keepsakes.letGo':
        updateStore('keepsakes', (s) => letGoShelf(cleanShelf(s), a.id));
        emitDeferred('keepsake:sound', { name: 'leave' });
        break;
      case 'keepsakes.cancelKeep':
        updateStore('shelfPending', () => null);
        break;
      // Read a bottle's letter (src/world/keepsakes/letters.js), on the beach (shoreId) or on the
      // shelf (entryId). Its letter is chosen the first time it is read, then kept with it; every
      // letter read is kept with the shelf to read again, and the journal opens on it.
      case 'keepsakes.read': {
        const s0 = cleanShelf(getStore('keepsakes'));
        const entry = a.entryId !== undefined ? s0.shelf.find((e) => e.id === a.entryId) : null;
        const k = entry ?? (a.shoreId ? keepsakes.toKeep(a.shoreId) : null);
        if (!k || k.n.family !== 'bottle' || !k.n.message) break;
        let id = entry?.letter ?? (a.shoreId ? shoreLetters.get(a.shoreId) : undefined);
        if (!id) {
          const season = ['spring', 'summer', 'autumn', 'winter'][clock.seasonOf(k.hour * 3600).index];
          id = chooseLetter(k.n.messageIndex, { rarity: k.n.rarity, season, hour: clock.worldT() / 3600, read: s0.letters },
            bottleMessages, keepsakesRecipe.rarity.order)?.id;
        }
        if (!id) break;
        const letter = id;
        if (a.shoreId) shoreLetters.set(a.shoreId, letter);
        updateStore('keepsakes', (s) => {
          const c = readLetter(cleanShelf(s), letter);
          return entry ? { ...c, shelf: c.shelf.map((e) => (e.id === entry.id ? { ...e, letter } : e)) } : c;
        });
        updateStore('identify', () => null);
        updateStore('shelfUi', () => ({ letter }));
        updateStore('journalUi', (u) => ({ ...(u ?? {}), open: true, view: 'shelf', page: null }));
        emitDeferred('keepsake:sound', { name: 'letter' });
        break;
      }
      // The nets (src/world/nets): the net's card lifts it (the haul goes on the tray) or brings it in;
      // the tray lets living catches go, keeps or returns its keepsake, and closes.
      case 'nets.lift':
        if (nets.lift(a.id)) updateStore('identify', () => null);
        break;
      case 'nets.bringIn': {
        const id = a.id ?? nets.nets().find((/** @type {any} */ n) => n.at)?.id;
        if (id !== undefined) nets.bringIn(id);
        updateStore('identify', () => null);
        break;
      }
      case 'nets.release':
        nets.release(a.id);
        break;
      case 'nets.close':
        nets.closeTray();
        break;
      case 'nets.leave':
        nets.answered(true);
        emitDeferred('keepsake:sound', { name: 'leave' });
        break;
      case 'nets.keep': {
        const h = getStore('haul');
        if (!h?.haul.keepsake || h.kept) break;
        const k = { n: structuredClone(h.haul.keepsake.n), hour: h.hour, spring: h.springTide };
        const r = keepShelf(cleanShelf(getStore('keepsakes')), k);
        if (r.kept) {
          updateStore('keepsakes', () => r.state);
          noteKept(k.n);
          nets.answered();
          emitDeferred('keepsake:sound', { name: 'keep' });
        } else {
          // A full shelf asks which to let go, in the journal; the tray waits underneath.
          updateStore('shelfPending', () => ({ shoreId: h.haul.keepsake.id, ...k }));
          updateStore('journalUi', (u) => ({ ...(u ?? {}), open: true, view: 'shelf', page: null }));
        }
        break;
      }
      case 'ui.identify':
        pieces.cancelCarry();
        break;
      case 'brush.resize':
        updateStore('tools', (t) => { t.size = clampSize(t.size * a.factor); });
        break;
      case 'tool.hover':
        pointer.x = a.x;
        pointer.y = a.y;
        pointer.inside = a.inside;
        break;
      case 'tool.begin':
      case 'tool.move': {
        if (!tools().tool) break;
        if (tools().tool === 'plant') { if (a.type === 'tool.begin') plantTap(a.x, a.y); break; }
        if (tools().tool === 'feed') { if (a.type === 'tool.begin') feedTap(a.x, a.y); break; }
        if (tools().tool === 'sculpt' && tools().sculptMode === 'stone') { if (a.type === 'tool.begin') stoneTap(a.x, a.y); break; }
        if (tools().tool === 'sculpt' && tools().sculptMode === 'loosestone') { if (a.type === 'tool.begin') looseStoneTap(a.x, a.y); break; }
        if (tools().tool === 'sculpt' && (tools().sculptMode === 'pondstones' || tools().sculptMode === 'steps')) { shapingDragTo(a.type, a.x, a.y); break; }
        if (tools().tool === 'water') {
          if (tools().waterMode === 'spring') { if (a.type === 'tool.begin') springTap(a.x, a.y); }
          // The net and the raft are set on foot now (D1a): their old modes from above do nothing.
          else if (tools().waterMode === 'net' || tools().waterMode === 'raft') { /* set on foot */ }
          else if (a.type === 'tool.begin' || pouring) pouring = { x: a.x, y: a.y };
          break;
        }
        if (a.type === 'tool.begin') { wantStroke = true; shiftHeld = !!a.shift; }
        if (!wantStroke) break;
        const p = groundAt(a.x, a.y);
        if (!p) break;
        presence.edit(p[0], p[2]);
        if (!stroking) stroking = terrain.beginStroke(currentBrush(), p, a.pressure);
        else terrain.strokeTo(p, a.pressure);
        break;
      }
      case 'tool.end':
      case 'tool.cancel': {
        // A pour ended: the first evening's shape beat reads where (src/world/intro).
        const pourEnd = pouring && tools().tool === 'water' ? groundAt(pouring.x, pouring.y) : null;
        if (pourEnd) emitDeferred('water:pour-ended', { x: pourEnd[0], z: pourEnd[2], tool: 'water', mode: tools().waterMode });
        pouring = null;
        finishStroke();
        finishShapingDrag();
        break;
      }
      // A tap with no tool: the journal names what grows there (src/world/journal).
      // Carrying, the tap sets the piece down instead.
      case 'look.tap':
        if (pieces.carrying()) carryTap(a.x, a.y);
        else emitDeferred('look:tapped', { x: a.x, y: a.y, point: groundAt(a.x, a.y) });
        break;
      case 'history.undo': if (!stroking) runHistory('undo'); break;
      case 'history.redo': if (!stroking) runHistory('redo'); break;
      case 'time.flow':
        clock.setFlow(a.flow);
        updateStore('meta', (m) => { m.flow = a.flow; });
        break;
      case 'look.palette':
        if (!palettes[a.id]) break;
        baker.setPalette(palettes[a.id]);
        updateStore('settings', (s) => { s.palette = a.id; });
        emitDeferred('palette:changed', { id: a.id });
        break;
      // Settings (src/ui/settings.js): growing while away belongs to the island; the rest are
      // this device's settings (src/save/prefs.js keeps them).
      case 'time.keepGrowing':
        updateStore('meta', (m) => { m.keepGrowing = a.on; });
        break;
      // A heart or a thumbs-down on the piece playing (src/ui/now-playing.js), kept with the island:
      // a heart plays it more often; a thumbs-down fades it out and it never comes back.
      case 'music.heart':
        updateStore('music', (m) => setVerdict(m, a.heart, 'heart'));
        break;
      case 'music.pass':
        updateStore('music', (m) => setVerdict(m, a.heart, 'pass'));
        break;
      case 'settings.set':
        updateStore('settings', (s) => { Object.assign(s, a.patch); });
        break;
      // A name for a frog that knows you well enough (S6c-3, the tap card): kept with the island.
      case 'creature.name': {
        const name = cleanName(a.name);
        const f = world.state?.creatures?.frogs?.frogs?.find((/** @type {any} */ g) => g.id === a.id);
        if (!name || !f || f.name || (f.trust ?? 0) < frogRecipe.presence.namingTrust) break;
        world.state = nameFrog(world.state, a.id, name, clock.hourIndex());
        updateStore('world', () => world.state);
        emitDeferred('creature:named', { species: 'frogs', id: a.id, name });
        break;
      }
    }
  });
  const detachDesktop = attachDesktopInput(canvas, camRecipe, rb);

  /** Keep the brush ring on the ground under the pointer, even as the camera moves. */
  function updateRing() {
    const t = tools();
    // Spring mode marks the selected spring, else a small ring where a tap would place one.
    if (t.tool === 'water' && t.waterMode === 'spring') {
      const sel = getStore('waterUi')?.selectedId;
      const s = sel ? water.springs().find((x) => x.id === sel) : null;
      const p = !s && pointer.inside ? groundAt(pointer.x, pointer.y) : null;
      if (s) terrain.setRing({ x: s.x, z: s.z, radius: 0.8, visible: true });
      else if (p) terrain.setRing({ x: p[0], z: p[2], radius: 0.6, visible: true });
      else terrain.setRing({ visible: false });
      return;
    }
    // Raft mode: round the selected raft, else where a tap would set one.
    if (t.tool === 'water' && t.waterMode === 'raft') {
      const sel = pieces.selected('raft');
      const p = !sel && pointer.inside ? groundAt(pointer.x, pointer.y) : null;
      terrain.setRing(sel ? { ...sel, visible: true, level: null } : p ? { x: p[0], z: p[2], radius: 0.6, visible: true, level: null } : { visible: false, level: null });
      return;
    }
    // Net mode: a ring where a tap would cast the net.
    if (t.tool === 'water' && t.waterMode === 'net') {
      const p = pointer.inside ? groundAt(pointer.x, pointer.y) : null;
      terrain.setRing(p ? { x: p[0], z: p[2], radius: netsRecipe.look.netWidthM / 2, visible: true, level: null } : { visible: false, level: null });
      return;
    }
    // Carrying a stone or a log: a ring where a tap would set it down.
    const held = !t.tool ? pieces.carrying() : null;
    if (held) {
      const p = pointer.inside ? groundAt(pointer.x, pointer.y) : null;
      terrain.setRing(p ? { x: p[0], z: p[2], radius: held.radius, visible: true, level: null } : { visible: false, level: null });
      return;
    }
    // Loose stone mode marks the selected stone, else a small ring where a tap would set one.
    if (t.tool === 'sculpt' && t.sculptMode === 'loosestone') {
      terrain.setRing({ ...pieces.ring(pointer.inside ? groundAt(pointer.x, pointer.y) : null), level: null });
      return;
    }
    // Pond stones and Steps mark the selected stone or flight, else where a drag would begin: a
    // stone's width, or a flight's, round the pointer (and its far end while cutting).
    if (t.tool === 'sculpt' && (t.sculptMode === 'pondstones' || t.sculptMode === 'steps')) {
      const sel = pieces.selected(t.sculptMode);
      const p = pointer.inside ? groundAt(pointer.x, pointer.y) : null;
      if (sel) terrain.setRing({ ...sel, visible: true, level: null });
      else if (p) terrain.setRing({ x: p[0], z: p[2], radius: t.sculptMode === 'steps' ? 0.8 : 0.3, visible: true, level: null });
      else terrain.setRing({ visible: false, level: null });
      return;
    }
    const p = t.tool && pointer.inside ? groundAt(pointer.x, pointer.y) : null;
    // The Plant tool marks just the spot a seed would go; Feed, where the food would land.
    // Terrace and Cut also draw a thin line where the ground meets the shelf's level (docs/15).
    const level = !p || !isCliffMode() ? null : terrain.strokeLevel() ?? terrain.cliffLevelAt(currentBrush(), p);
    if (p) terrain.setRing({ x: p[0], z: p[2], radius: t.tool === 'plant' ? 0.4 : t.tool === 'feed' ? 0.2 : t.size, visible: true, level });
    else terrain.setRing({ visible: false, level: null });
  }

  // The island's sound (src/audio, docs 17 and 25) reads the store slice `sound`, written here
  // about ten times a second: display time, season, weather, tide, the camera and what is near it.
  // Only the game starts the sound (src/main.js); for tool pages the slice is simply unread.
  const soundRecipe = await loadAudioRecipe('audio/game');
  const tideP = tideParams(waterRecipe.tide);
  let soundAcc = Infinity;
  let nearAcc = Infinity;
  let near = nothingNear();
  // The waterfalls, from the lips the falls pass reads back a couple of times a second.
  /** @type {import('./world/falls-near.js').Fall[]} */
  let falls = [];
  on('falls:lips', (/** @type {{ lips: Float32Array, count: number }} */ p) => { falls = groupFalls(p.lips, p.count, soundRecipe.falls); });
  // The shaper's trail (doc 13 "Trails"; src/world/shaper.js): the kinds of place you have made,
  // each noticed once, looked for when the water settles, every game hour and after time away.
  const shaperWatch = createShaperWatch({ world, water, recipe: shaperRecipe, coveRecipe, falls: () => falls,
    has: () => new Set(firstsOf(getStore('unlocks')?.earned ?? {}, 'shape').map((f) => f.id)),
    note: (id) => noteFirst({ trail: 'shape', kind: 'place', id, hour: clock.hourIndex() }) });
  // A first look a moment after the island is up (a loaded island notices what it already has).
  let shaperS = 3;
  for (const ev of ['world:ticked', 'water:summary-updated', 'journal:replaced']) on(ev, () => { shaperS = 0.5; });
  sim.addSystem({ id: 'shaper-watch', tick(/** @type {any} */ f) { if (shaperS > 0 && (shaperS -= f.realDt) <= 0) shaperWatch.look(); } });
  /** @param {number} realDt @param {number} display @param {{ index: number, phase: number }} season @param {any} day daylight.update's result */
  function publishSound(realDt, display, season, day) {
    const weather = day.weather;
    soundAcc += realDt;
    nearAcc += realDt;
    if (soundAcc < 1 / soundRecipe.updateHz) return;
    soundAcc = 0;
    if (nearAcc >= soundRecipe.near.nearEveryS) {
      nearAcc = 0;
      near = soundNear({ summary: water.getSummary(), growth: world.state?.growth, rushId: growthRecipe.cover?.[0] ?? null,
        x: camera.target[0], z: camera.target[2], recipe: soundRecipe.near });
      near.falls = fallsNear(falls, camera.target[0], camera.target[1], camera.target[2], soundRecipe.falls);
    }
    const frogs = world.state?.creatures?.frogs?.frogs ?? [];
    updateStore('sound', () => ({
      displayT: display, season: season.index, seasonPhase: season.phase,
      weather: { cloud: weather.cloud, rain: weather.rain, mist: weather.mist, wind: weatherAt(world.state?.weather, display, seasonsRecipe).wind },
      tidePhase: tideState(display / clock.SECONDS_PER_HOUR, tideP).phase01,
      eye: [...camera.eye], target: [...camera.target], near,
      residents: frogs.length ? ['frog'] : [],
      // For the music (doc 24): the frogs own dusk while they call; a time preview starts no piece.
      worldT: clock.worldT(), sunAltDeg: (day.sm.sunAlt * 180) / Math.PI,
      frogsAwake: frogs.length > 0 && !world.state?.creatures?.frogs?.dormant,
      frogsCalling: creatures.frogs().some((a) => a.mode === 'call'),
      // A brand-new island (no save came back) opens with music soon after the first touch.
      freshIsland: !back,
    }));
  }

  let running = true;
  let frameIndex = 0;
  let last = performance.now();
  let raf = 0;

  /** @param {number} now */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const cpuStart = performance.now();
    if (frameIndex === 0) last = now; // the first interval includes loading; don't count it
    const realDt = Math.min((now - last) / 1000, 0.25);
    const frameMs = now - last;
    last = now;

    if (canvas.width !== devW || canvas.height !== devH) {
      canvas.width = devW;
      canvas.height = devH;
    }
    const [renderW, renderH] = live.internalSize(devW, devH);   // dynamic resolution
    graph.resize(renderW, renderH);

    const t = clock.advance(realDt);
    camera.setViewport(cssW, cssH);
    walkControls.update(realDt);
    walk.update(realDt);
    arriveForCard();
    gather.update();
    camera.update(realDt);
    presence.update(realDt);
    updateRing();
    // Plant tool rings, and a breathing ring round whatever the journal's tap card names.
    // The camp pad's dashed edge (CP-01) while a brush ring touches the pad, fading in and out.
    const pad = getStore('campPad') ?? null;
    padEdge = pad ? stepEdge(padEdge, edgeTarget(pad, terrain.ring, tools()), realDt, pad.dash?.opacity ?? 1, pad.dash?.fadeS) : 0;
    const padMark = edgeMark(pad, padEdge);
    // A chosen thing is lifted in its own shader, not ringed (F5); only Show me (a pinned card, far
    // off) keeps its ring on the ground. The first evening's slot glows are rings of their own.
    const chosen = getStore('identify');
    setLiftTargets([...(getStore('hover')?.lift ?? []), ...liftFor(chosen, spreadOf)], realDt);
    // A raising Sculpt brush rings every plant it would cover (rings.js).
    const raising = tools().tool === 'sculpt' && RAISING_MODES.includes(tools().sculptMode);
    const bury = raising ? buryRings(world.state?.growth?.plants ?? [], flora, terrain.ring, growthRecipe.bury) : [];
    // Planting on foot (D1a): the ring under the pointer, a net walk's end, the tossed seeds.
    sowing.update(now);
    sowOverlay.draw(sowing.visuals(), getStore('view').project3, now);
    terrainPass.setMarks(plantTool.marks(now, !!getStore('hand') && getStore('hand').kind !== 'net', chosen?.pinned ? chosen : null, [...(padMark ? [padMark] : []), ...bury,...(getStore('reveal')?.rings?.(now) ?? []), ...creatures.foodRings(), ...intro.rings(now), ...camp.rings(now / 1000), ...stores.rings(now / 1000)]));
    // Lugworm casts are drawn into the sand by the terrain pass.
    terrainPass.setCasts(finds.casts());
    // So are the holes you dug (src/world/dig): their mouths and the fresh soil round them; and the
    // ash you spread (P2i), in the slots after them.
    const markAt = [camera.target[0], camera.target[2]], ashLook = gather.recipe.kinds?.ash?.spread?.look;
    terrainPass.setHoles(ashLook ? ashMarks(dig.marks(markAt), gather.ashesNow(), markAt, ashLook) : dig.marks(markAt), dig.ringM);
    updatePour();
    if (queuedHistory && !terrain.isBusy()) runHistory(queuedHistory);
    // Ground detail waits for a few calm frames so the first picture is as quick as before (docs/22).
    if (!groundRequested && frameIndex > 10 && frameMs < 50) {
      groundRequested = true;
      groundDetail.load().catch((err) => console.warn('ground detail did not load; keeping the flat look', err));
    }
    groundDetail.tick(realDt);

    // Sun, moon and weather at display time (a sky-lab preview moves only the look, never the world).
    const display = clock.display();
    const season = clock.seasonOf(display);
    const day = daylight.update(display, world.state, getStore('preview')?.weather ?? null, atmosphere.aerosolScale);
    atmosphere.setAtmosphere({ cloud: day.weather.cloud, mist: day.weather.mist, rain: day.weather.rain });
    for (const event of day.events) emitDeferred('sky:sun-crossed', { event });
    publishSound(realDt, display, season, day);
    // Palette keys follow the displayed sun, season and weather; positive exposureComp brightens.
    const look = baker.update(realDt, {
      sunAltDeg: (day.sm.sunAlt * 180) / Math.PI, seasonPhase: season.index + season.phase, weather: day.weather,
    });
    const split = getStore('preview')?.split;
    tonemap.set({
      lutFade: look.fade, lutFrom: look.from, lutTo: look.to, look: look.look, purkinje: look.purkinje,
      outline: look.outline, split: typeof split === 'number' ? split : -1,
    });
    const ev100 = exposure.ev100(realDt) - (look.exposureComp ?? 0);
    if (frameIndex % 15 === 0) updateStore('render', (r) => ({ ...(r ?? {}), ev100 }));

    graph.writeFrameUniforms(uniforms.pack({
      view: camera.view, proj: camera.proj, viewProj: camera.viewProj, invViewProj: camera.invViewProj,
      prevViewProj, cameraPos: camera.eye, near: camera.near,
      renderSize: graph.size,
      animTime: t.animT,
      displayHours: (display % clock.SECONDS_PER_YEAR) / clock.SECONDS_PER_HOUR,
      dayFrac: clock.dayFractionOf(display),
      yearFrac: clock.yearFractionOf(display),
      seasonPhase: season.phase,
      moonPhase: day.sm.moonPhase,
      ev100,
      sunDir: day.sm.sunDir, sunIlluminance: day.sunIlluminance,
      moonDir: day.sm.moonDir, moonIlluminance: day.moonIlluminance,
      tierFlags: tier === 'ultra' || tier === 'high' ? 2 : tier === 'medium' ? 1 : 0,
      frameIndex,
    }));
    prevViewProj.set(camera.viewProj);

    shadowPass.update({ eye: camera.eye, view: camera.view, proj: camera.proj, near: camera.near, targetDistance: camera.distance },
      day.shadowDir, day.shadowStrength);
    lighting.write({
      shadow: shadowPass.state, weather: day.weather,
      aerial: { maxDistance: atmosphere.aerialMaxDistance, slices: atmosphere.aerialSlices },
    });

    /** @type {import('./sim/live-sim.js').FrameInfo} */
    const info = { dt: t.dt, realDt, worldT: t.worldT, animT: t.animT, displayT: display, tier };
    const windNow = weatherAt(world.state?.weather, display, seasonsRecipe).wind;
    ww.update({ rain: day.weather.rain, sunY: day.sm.sunDir[1], wind: windNow }, camera.target);
    const bladeFrame = {
      focus: camera.target, time: t.animT, wind: windNow, windDir: world.state?.weather?.today?.windDir ?? 0,
      season: season.index + season.phase, seaLevel: water.tide,
    };
    grassPass.update(bladeFrame);
    // No blade grows through a loose stone (src/world/pieces).
    const clears = pieces.clears(camera.target);
    grassPass.setClears(clears);
    rushPass.setClears(clears);
    // Grass and rushes bend away from the walker's feet and body (W6).
    const pushes = walk.pushes();
    grassPass.setPushes(pushes);
    rushPass.setPushes(pushes);
    // Short, worn grass on the camp pad (CP-16; rushes never stand there).
    grassPass.setPad(getStore('campPad') ?? null, campRecipe?.grass?.thinWithWear ?? 0);
    // Wet-to-dry grass (lush.js): the ground's grass layer takes the blades' tint this season.
    terrainPass.setLush(grassRecipe.lush ? lushLook(grassRecipe, bladeFrame.season) : null);
    rushPass.update(bladeFrame);
    floraFrame = { time: t.animT, wind: windNow, windDir: world.state?.weather?.today?.windDir ?? 0 };
    floraPass.update({ ...floraFrame, season: season.index + season.phase, pressed: creatures.pressedPads() });
    // `?ripplerain=1` rains ripples in any weather, to judge rings in sunshine (tools, tuning).
    // Raindrops ring the water in the water shader; the ripple field keeps the pour and creatures.
    const ringRain = params.has('ripplerain') ? 1 : day.weather.rain;
    waterPass.setRain(ringRain);
    waterPass.setWind(windNow);
    terrainPass.setRain(ringRain);
    sim.update(info);
    const encoder = gpu.device.createCommandEncoder({ label: 'frame' });
    sim.encode(encoder, info);
    atmosphere.update(encoder, {
      sunDir: day.sm.sunDir, moonDir: day.sm.moonDir,
      sunIlluminanceTOA: day.sunTOA, moonIlluminanceTOA: day.moonTOA,
      cameraPos: camera.eye, invViewProj: camera.invViewProj, view: camera.view,
    });
    baker.encode(encoder);
    graph.render(encoder);
    gpu.device.queue.submit([encoder.finish()]);
    graph.afterSubmit();
    live.afterSubmit(gpu.device.queue, frameIndex > 0 ? frameMs : 0);
    sim.afterSubmit();
    exposure.afterSubmit();
    tonemap.afterSubmit();

    if (frameIndex > 0) emitDeferred('render:frame-ended', { frameMs, cpuMs: performance.now() - cpuStart, frameIndex });
    flushDeferred();
    frameIndex++;
  }
  raf = requestAnimationFrame(frame);

  // `?cliffs` (testing, unsaved): a small cliff scene built with real Terrace and Cut strokes, a
  // spring on the upper shelf so its water falls over the faces (src/world/terrain/cliff-demo.js).
  if (params.has('cliffs')) {
    buildCliffDemo({
      terrain, history, spring: params.get('cliffs') !== 'nospring',
      tapSpring: (p, rate) => ww.tapSpring(p, rate),
      focus: (x, z, distance, pitchDeg) => camera.focus(x, z, distance, pitchDeg),
    }).then(() => emitDeferred('terrain:cliff-demo-built', { cliffChunks: terrain.cliffs.size }))
      .catch((err) => console.error('cliff demo failed', err));
  }

  // `?sandbar` (testing, unsaved; W1): a sandbar and a small islet off the shore, built with real
  // strokes, so the walker's low-tide crossing can be tried before the meadow islet exists.
  if (params.has('sandbar')) {
    buildSandbarDemo({ terrain, history, focus: (x, z, distance, pitchDeg) => camera.focus(x, z, distance, pitchDeg) })
      .then((L) => emitDeferred('walk:sandbar-built', { ok: !!L }))
      .catch((err) => console.error('sandbar demo failed', err));
  }

  // Autosave from here on (src/save/autosave.js): what the island is now, whenever it asks.
  save.start({
    recipe: await loadRecipe('world/save'),
    parts: () => ({
      build: hooks.build ?? 'dev', seed, island: island.id, worldT: clock.worldT(), flow: clock.flow(),
      carryMinutes: getStore('meta')?.carryMinutes ?? 0, keepGrowing: getStore('meta')?.keepGrowing ?? true,
      world: world.state, journal: getStore('journal'), water: getStore('water'), unlocks: getStore('unlocks')?.earned ?? {},
      view: { ...camera.pose(), walker: walk.spot() }, looks: getStore('looks') ?? {}, music: getStore('music') ?? { hearted: [] }, pieces: getStore('pieces'), keepsakes: getStore('keepsakes'), nets: getStore('nets'), ...Object.fromEntries(SECTIONS9.map((id) => [id, getStore(id)])), chunks: getStore('chunks'), mirror: getStore('terrainLive')?.mirror ?? null,
    }),
  });

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    running = false;
    cancelAnimationFrame(raf);
    observer.disconnect();
    unAction();
    walkControls.dispose();
    walk.dispose();
    sowOverlay.dispose();
    unHistory();
    unHour();
    unWash();
    ww.dispose();
    unProbe();
    live.dispose();
    detachDesktop();
    graph.dispose();
    sim.dispose();
    atmosphere.dispose();
    groundDetail.dispose();
  }

  onDeviceLost((info) => {
    if (stopped) return;
    console.warn('GPU device lost:', info.reason, info.message);
    stop();
    hooks.onDeviceLost?.(true);
    // Rebuild everything from the store and recipes on a fresh device.
    startApp(canvas, hooks).then(() => hooks.onDeviceLost?.(false));
  });

  return {
    ok: true, get tier() { return tier; }, tierReasons: reasons,
    adapterInfo: gpu.adapter.info ?? null,
    features: [...gpu.features],
    stop,
    /**
     * Hand in what a ground point holds (the journal's cardAt) and its species words, so one click
     * below can walk and use (src/world/walk/click.js). main.js calls it once the journal exists.
     * @param {(x: number, z: number, y?: number) => any} cardAt @param {Record<string, any>} species
     */
    setCards(cardAt, species) { cards = { cardAt, species }; },
    /**
     * The walker's pack (src/world/pack/index.js): add, take, has, holds({ fuel: 1, stones: 2 }),
     * room; it emits pack:changed { pouches, size } after every change.
     */
    pack,
    /** Gathering (src/world/gather/index.js): the journal's cards gain their Gather buttons from it. */
    gather,
    /** The piles at camp (src/world/pack/piles-live.js): a pile's card reads its words from them. */
    piles,
    /** The camp's stores (src/world/pack/stores.js): the journal's cards ask them first at camp. */
    stores,
    terrain,
    water,
    /** The live growth (habitat, plants) and the world the hourly tick runs on (tools/growth-lab.html). */
    growth,
    world,
    /** The frog size preview (`?frogscale`), or null. */
    frogScale,
    /** The live frogs (the journal asks it what a tap landed on). */
    creatures,
    /** The finds near the view (the journal asks it what a tap landed on). */
    finds,
    /** The keepsakes on the strandline (the journal asks it what a tap landed on). */
    keepsakes: keepsakesApi,
    /** The nets (the journal asks which one a tap landed on; the haul tray reads the recipe). */
    nets: { ...nets, recipe: netsRecipe, keepsakesRecipe },
    /** The placed loose stones (the journal asks which one a tap landed on). */
    pieces,
    /** Lift on foot (L3a): the journal asks whether a piece is in reach to lift. */
    lift,
    /** Autumn's fungi and webs (counts() for tools). */
    autumn,
    /** The walker: the walk grid, your feet, Go down and Go up (tools and testing). */
    walk,
    /** The first evening: its start, the boat's mooring, and the director once main.js starts it. */
    intro,
    /** The keeper's camp: the journal asks it what a click at camp lands on; tools read the fire. */
    camp,
    /** Digging: the journal asks it whether a tap landed on an open hole. */
    dig,
    /**
     * Testing helpers, on window.ebb with `?debug`: autumn's misty morning and kept logs, skipping to
     * a time of year, and bringing a settled school or swarm. They change this island's time and
     * pieces, so use them on a test link (such as `?debug&autumn`, unsaved) to leave your own island alone.
     */
    debug: {
      /**
       * Jump to the next misty autumn morning on which fungi have grown in (autumn.js
       * mistyAutumnMorning), at the webs' test hour, and run that hour so its weather is the day's.
       * @returns {number | null} the game day, or null if none was found
       */
      autumnMorning() {
        const lean = world.state?.weather?.lean ?? 0;
        const day = mistyAutumnMorning({ fromDay: Math.floor(clock.hourIndex() / 24) + 1, moodOf: autumnMoods(lean), F: autumnRecipe.fungi });
        if (day === null) return null;
        clock.skip((autumnRecipe.webs.testHour + 24 * day) * clock.SECONDS_PER_HOUR - clock.worldT());
        tickHour(clock.hourIndex());
        return day;
      },
      /**
       * Keep a log at a ground point (or near the view's middle) as if carried there before this
       * autumn, so it fruits in autumn. @param {number} [x] @param {number} [z] @returns {string | null} its id
       */
      keptLog: (x, z) => keepTestLog(x, z),
      /** How many fungi and webs are drawn now, and the webs' dew. */
      autumn: () => autumn.counts(),
      /**
       * Skip to the next day `day` of the year (0..55; 13 is the last day of spring) at `hour`,
       * every hour between run by the hourly tick as usual (it may take a few seconds).
       * @param {number} day @param {number} [hour]
       */
      skipTo(day, hour = 10) {
        const year = clock.SECONDS_PER_YEAR, at = clock.worldT() % year;
        const want = (day * clock.HOURS_PER_DAY + hour) * clock.SECONDS_PER_HOUR;
        clock.skip(want > at ? want - at : want + year - at);
        return clock.season();
      },
      /** A settled group of `count` comes now (species id: minnow, dragonfly, damselfly), as its test link does. @param {string} id @param {number} [count] */
      summon(id, count = 8) {
        const rec = speciesRecipes[id];
        if (rec?.ecology?.kind !== 'swarm') return false;
        testSwarms.push({ rec, count: Math.max(1, Math.min(30, count)) });
        return true;
      },
      /** Late spring, if they are not flying now, and a few damselflies at the pond. @param {number} [count] */
      damselflies(count = 8) {
        if (world.state?.seasons?.dormant?.damselflies) this.skipTo(13, 10);
        return this.summon('damselfly', count);
      },
    },
    /** Planting on foot (D1a, P2g; tests and the test links). */
    sowing,
    planting,
    /** The shore zones and rock pools now (the journal's Web shows which are on the island). */
    shorePresence: () => shorePresence(ww.shore.zones(), water.getSummary(), getStore('terrainLive')?.mirror?.material ?? null),
    /** Every live animal system's hooks for the reveal on return (src/ui/reveal.js). */
    animals: [creatures.reveal, midges.reveal, ...schools.map((s) => s.reveal)],
    /** The live schools (minnows), the journal asks them what a tap landed on. */
    schools,
    /** The live midge swarms (tools). */
    midges,
    presence,
    /** The orbit camera, for tools and checks (eye, target, distance). */
    camera,
    /** The island this world started from, and the islands there are (the badge's switch). */
    island: { current: island, list: islands },
    /** This island's save (the badge says whether it is kept, and can start it again). */
    save: Object.assign(save, { fingerprint: () => fingerprint(world.state) }),
    /** Palette access for the palette lab (tools/palette-lab.html). */
    palette: {
      list: () => PALETTES.slice(),
      current: () => structuredClone(baker.current()),
      /** @param {any} json @param {number} [fadeS] */
      apply: (json, fadeS = 0) => baker.setPalette(json, { fadeS }),
    },
    /** The quality tier and render scale, switched live with no reload (S8b's Settings, tools). */
    quality: {
      /** Switch to a tier now; a chosen tier ends automatic step downs this session. @param {string} t */
      set(t) {
        if (!isTier(t) || !settingsFor(t)) return false;
        if (probe) { probe = null; unProbe(); }   // the player's pick outranks the startup probe
        live.chosen();
        applyTier(t, false);
        return true;
      },
      tier: () => tier,
      renderScale: () => live.scale,
      /** Hold the render scale, or release it with null (a tool page's sweep). @param {number | null} s */
      pinScale: (s) => live.pinScale(s),
      /** Scale range, GPU time measure, scale changes, the automatic step (tools). */
      info: () => live.info(),
    },
    /**
     * Final on-screen color at a point given in CSS pixels from the canvas's top-left.
     * @param {number} cssX @param {number} cssY
     */
    pickColor: (cssX, cssY) => tonemap.pick((cssX * canvas.width) / Math.max(1, cssW), (cssY * canvas.height) / Math.max(1, cssH)),
  };
}
