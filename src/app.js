// @ts-check
// Starts ebb on a canvas: GPU, tier, camera, terrain, sky and light, the hourly tick, frame graph,
// input, history and the frame loop.
// Shared by index.html (through main.js) and the tools pages, so they measure the same code.

import { initGpu, onDeviceLost } from './core/gpu.js';
import * as clock from './core/clock.js';
import { flushDeferred, emitDeferred, on } from './core/events.js';
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
import { createWaterWorld } from './world/water-world.js';
import { createGrowth } from './world/growth/index.js';
import { createPlantTool } from './world/growth/plant-tool.js';
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
import { createCreaturePass } from './render/passes/creatures.js';
import { bakeBody } from './world/creatures/body-bake.js';
import { previewSpots } from './world/creatures/preview-spots.js';
import { createCreatures } from './world/creatures/index.js';
import { createFinds } from './world/finds/index.js';
import { createPieces } from './world/pieces/index.js';
import { shorePresence } from './world/journal/shore-presence.js';
import { createPresence } from './world/creatures/presence.js';
import { cleanName, nameFrog } from './world/creatures/trust.js';
import { lushLook } from './world/growth/lush.js';
import { createMidges } from './world/ecology/midges-live.js';
import { SPECIES, keyOf, swarmSpecies } from './world/species.js';
import { createSchools } from './world/creatures/schools.js';
import { bringSwarm, testRecipe } from './world/creatures/swarms.js';
import { onAction, history } from './input/actions.js';
import { attachDesktopInput } from './input/desktop.js';
import { attachTouchInput } from './input/touch.js';
import { beginSave, TEST_PARAMS } from './save/autosave.js';
import { buildCliffDemo } from './world/terrain/cliff-demo.js';
import { loadPrefs, keepPrefs } from './save/prefs.js';
import { fingerprint } from './save/backup.js';

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
 * @param {{ onDeviceLost?: (rebuilding: boolean) => void, save?: boolean, build?: string }} [hooks]
 *   save: keep this island in the device's save (only the game asks; tool pages run unsaved)
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
  /** @type {{ id: string, name: string }[]} */ const islands = terrainRecipe.islands?.list ?? [];
  const asked = params.get('island');
  const island = islands.find((i) => i.id === asked) ?? islands.find((i) => `land/${i.id}` === terrainRecipe.starter.land) ?? { id: terrainRecipe.starter.land.slice(5), name: 'Starter island' };
  const landRecipe = await loadRecipe(`land/${island.id}`);
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
  }
  // Device settings (src/save/prefs.js): kept on this device, never in the island.
  const prefs = loadPrefs();
  updateStore('settings', (s) => {
    for (const k of ['textSize', 'motion', 'audio', 'hudDim', 'reveal', 'qualityChoice', 'leftHanded', 'journalList']) if (prefs[k] !== undefined) s[k] = prefs[k];
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
    const earned = u?.earned ?? back?.unlocks ?? {};
    return { earned, ...earned, springs: !!earned.springs || params.has('sandbox'),
      cliffs: !!earned.cliffs || params.has('sandbox') || params.has('cliffs'),
      stones: !!earned.stones || params.has('sandbox') || params.has('stones'), stonesTest: params.has('stones'),
      driftwood: !!earned.driftwood || params.has('driftwood'),
      carry: !!earned.carry || params.has('sandbox') || params.has('driftwood'),
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

  const terrain = await createTerrain(gpu, { seed: subSeed(seed, 'terrain'), recipe: terrainRecipe, land: landRecipe });
  history.setApplier('terrain', (cmd, dir) => terrain.applyTiles(dir === 'undo' ? cmd.before : cmd.after));
  if (back) terrain.restoreChunks(back.chunks);   // before the water reads the ground
  // The world clock and the shared hourly tick (weather, seasons). A new world starts mid-morning.
  // `?day=N` starts a new world N game days in (14 per season: 15 is early summer), to see later seasons sooner.
  // `?frogs=N` (testing) starts on spring day 7 unless a day is given, after the frogs' winter sleep
  // (they wake 0.3 into spring, day 5).
  // `?dragonflies=N` starts on summer day 2: they fly from the start of summer (recipes/world/seasons.json).
  const startDay = Math.max(0, Number.parseInt(params.get('day') ?? (params.has('dragonflies') ? '15' : params.has('frogs') ? '6' : '0'), 10) || 0);
  if (clock.worldT() === 0) clock.reset(((skyRecipe.orbit.startHour ?? 10) + 24 * startDay) * clock.SECONDS_PER_HOUR);
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
  // Growth (docs 10, 11): the habitat grid from the water summary, plants and grass cover grown in
  // the hourly tick; this keeps the habitat current and uploads what the drawing needs.
  // `?plants=all` (testing, unsaved): a new island starts with every plant, not only the starters
  // (growth.json starters; the rest otherwise come by themselves, volunteers.js).
  const growthRecipe = { ...(await loadRecipe('world/growth')) };
  if (params.get('plants') === 'all') growthRecipe.starters = [...growthRecipe.species, ...(growthRecipe.cover ?? [])];
  /** @type {Record<string, any>} */
  const flora = Object.fromEntries(await Promise.all(growthRecipe.species.map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  /** @type {Record<string, any>} the cover plants other than grass (rushes) */
  const covers = Object.fromEntries(await Promise.all((growthRecipe.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  const grassRecipe = await loadRecipe('flora/grass');
  const growth = createGrowth(gpu.device, { terrain, water, world, recipes: { growth: growthRecipe, flora, covers, land: landRecipe, grass: grassRecipe } });
  sim.addSystem(growth);
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
  world.env.recipes.species = speciesRecipes;
  updateStore('world', () => world.state);
  const unHour = on('clock:hour', (/** @type {{ hour: number }} */ p) => {
    const events = sim.hourlyTick(p.hour);
    for (const e of events) emitDeferred(e.name, e.payload);
    updateStore('world', () => world.state);
    // The hour as a whole, for watchers of the world such as the journal (src/world/journal).
    emitDeferred('world:ticked', { hour: p.hour, events, state: world.state });
  });

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
  const floraPass = createFloraPass({ growth, terrain, water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, recipes: flora });
  // The frogs (src/world/creatures): posed bodies at their homes until S6b, the plop, finding one.
  // `?frogs=N` (testing): N frogs come at once instead of over days (1: a scout, the sign).
  const testFrogs = params.has('frogs') ? Math.max(1, Math.min(12, Number.parseInt(params.get('frogs') ?? '1', 10) || 1)) : 0;
  // floraFrame: the time and wind the plants were drawn with this frame (frogs on lily pads ride them).
  /** @type {{ time: number, wind: number, windDir: number } | null} */ let floraFrame = null;
  // Presence (doc 23): the camera as the one source creatures react to; edits are reported below.
  const presence = createPresence({ camera });
  const creatures = createCreatures({ world, recipe: frogRecipe, terrain, water, ripples, camera, testFrogs, flora, floraFrame: () => floraFrame, presence });
  sim.addSystem(creatures);
  // Schools you can see (src/world/creatures/schools.js): minnows under the live water surface, one
  // system and one pass per species that has a body and a school's motion.
  const schools = swarmSpecies(speciesRecipes).filter((rec) => rec.body && rec.motion)
    .map((rec) => createSchools({ world, recipe: rec, water, ripples, camera, presence, budget: tierSettings.liveCreatures ?? 120,
      ground: (x, z) => terrain.sampleHeight(x, z) }));
  for (const s of schools) sim.addSystem(s);
  // `?minnows=N`, `?dragonflies=N` (testing, unsaved): a group of N comes at once and is settled,
  // once the island, its water and the journal are up (as `?frogs` does).
  const testSwarms = ['minnow', 'dragonfly'].filter((id) => params.has(keyOf(speciesRecipes[id])))
    .map((id) => ({ rec: speciesRecipes[id], count: Math.max(1, Math.min(30, Number.parseInt(params.get(keyOf(speciesRecipes[id])) ?? '12', 10) || 12)) }));
  let swarmWait = 0;
  if (testSwarms.length) sim.addSystem({ id: 'swarm-tests', tick(/** @type {any} */ f) {
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
    weather: () => ({ weatherSeed: world.env.weatherSeed, weather: seasonsRecipe.weather, state: world.state?.weather }) });
  sim.addSystem(finds);
  terrainPass.setCasts(finds.casts(), finds.castShape);
  // Placed pieces (doc 09, docs/future/10): loose stones, set with Sculpt's Loose stone mode and
  // lifted with a tap; a handful comes by itself with the naturalist's reward (src/world/pieces).
  // Driftwood washes up on the strandline after high tides (the reward at ten finds), and the
  // turtles' gift carries a stone or a log to where you tap next.
  const pieces = createPieces({ terrain, water, camera, history, seed, recipe: await loadRecipe('world/pieces'), ground: groundDetail, terrainRecipe,
    shore: ww.shore, tide: waterRecipe.tide });
  sim.addSystem(pieces);
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
    creatures.pass,
    ...schools.map((s) => s.pass),
    finds.pass,
    pieces.pass,
    // Moon jellyfish on the summer strandline: clear, so drawn over the opaque things behind them.
    ...(finds.jellyPass ? [finds.jellyPass] : []),
    ...(frogScale ? [frogScale.pass] : []),
    waterPass,
    midges.pass,
    createSkyPass(atmosphere, skyRecipe),
    // Waterfalls after the sky, so a curtain seen against the sky is not drawn over (src/render/passes/falls.js).
    fallsPass,
    exposure,
    bloom,
    tonemap,
  ], { tier, lighting });
  await graph.setup();
  // Quality while playing (src/render/quality-live.js): dynamic resolution, the frame cap, thermal
  // care and the one automatic tier step down with its calm note.
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
    terrain.endStroke().then((cmd) => { if (cmd) history.push(cmd); });
  }

  // ---- the water tool (docs/07): pour and drain while held; springs on tap (when unlocked) ----
  /** Screen point of a held pour or drain, or null. @type {null | { x: number, y: number }} */
  let pouring = null;

  /** Each frame while pour or drain is held: the brush source under the pointer. */
  function updatePour() {
    const t = tools();
    const p = pouring && t.tool === 'water' ? groundAt(pouring.x, pouring.y) : null;
    if (p) presence.edit(p[0], p[2]);
    ww.holdBrush(p, t);
  }

  /** Tap with the spring mode: select a placed spring, or place a new one under the cap. @param {number} x @param {number} y */
  function springTap(x, y) {
    if (!getStore('unlocks')?.springs) return;
    const p = groundAt(x, y);
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
    if (cmd) { history.push(cmd); emitDeferred('terrain:stone-set', { x: p[0], z: p[2] }); }
  }

  /** Sculpt's Loose stone mode: select a placed stone, or set one under the cap (src/world/pieces). @param {number} x @param {number} y */
  function looseStoneTap(x, y) {
    if (!getStore('unlocks')?.stones) return;
    const p = groundAt(x, y);
    if (!p) return;
    presence.edit(p[0], p[2]);
    pieces.tap(p);
  }

  // The Plant tool (src/world/growth/plant-tool.js): plants a seed where the ground suits it, rings where.
  const plantTool = createPlantTool({ growth, world, flora, recipe: growthRecipe.marks });
  /** @param {number} x @param {number} y */
  function plantTap(x, y) {
    const p = groundAt(x, y);
    if (p) presence.edit(p[0], p[2]);
    if (p && plantTool.tap(tools().plantSpecies ?? 'reeds', p)) updateStore('world', () => world.state);
  }

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
    else updateStore('identify', (c) => (c ? { ...c, carrying: r.reason === 'water', carryNote: r.reason === 'gone' ? null : r.reason, canCarry: r.reason === 'water' } : c));
  }

  /** @param {'undo'|'redo'} dir */
  function runHistory(dir) {
    const ok = dir === 'undo' ? history.undo() : history.redo();
    queuedHistory = ok ? null : dir; // busy: retry once the stroke has settled
  }

  const unAction = onAction((a) => {
    switch (a.type) {
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
        break;
      }
      case 'water.springRemove':
        ww.removeSpring(a.id);
        break;
      case 'pieces.remove':
        pieces.remove(a.id);
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
        if (tools().tool === 'water') {
          if (tools().waterMode === 'spring') { if (a.type === 'tool.begin') springTap(a.x, a.y); }
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
      case 'tool.cancel':
        pouring = null;
        finishStroke();
        break;
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
  const detachTouch = attachTouchInput(canvas, camRecipe);

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
    if (!live.due(now)) return;   // the frame cap: a display faster than the tier's target
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
    camera.update(realDt);
    presence.update(realDt);
    updateRing();
    // Plant tool rings, and a breathing ring round whatever the journal's tap card names.
    terrainPass.setMarks(plantTool.marks(now, tools().tool === 'plant', getStore('identify'), [...(getStore('reveal')?.rings?.(now) ?? []), ...creatures.foodRings()]));
    // Lugworm casts are drawn into the sand by the terrain pass.
    terrainPass.setCasts(finds.casts());
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
      season: season.index + season.phase,
    };
    grassPass.update(bladeFrame);
    // No blade grows through a loose stone (src/world/pieces).
    const clears = pieces.clears(camera.target);
    grassPass.setClears(clears);
    rushPass.setClears(clears);
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

  // Autosave from here on (src/save/autosave.js): what the island is now, whenever it asks.
  save.start({
    recipe: await loadRecipe('world/save'),
    parts: () => ({
      build: hooks.build ?? 'dev', seed, island: island.id, worldT: clock.worldT(), flow: clock.flow(),
      carryMinutes: getStore('meta')?.carryMinutes ?? 0, keepGrowing: getStore('meta')?.keepGrowing ?? true,
      world: world.state, journal: getStore('journal'), water: getStore('water'), unlocks: getStore('unlocks')?.earned ?? {},
      view: camera.pose(), looks: getStore('looks') ?? {}, music: getStore('music') ?? { hearted: [] }, pieces: getStore('pieces'), chunks: getStore('chunks'), mirror: getStore('terrainLive')?.mirror ?? null,
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
    unHistory();
    unHour();
    unWash();
    ww.dispose();
    unProbe();
    live.dispose();
    detachDesktop();
    detachTouch();
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
    /** The placed loose stones (the journal asks which one a tap landed on). */
    pieces,
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
    /** The quality tier and render scale, switched live with no reload (S8b's Settings, tools/phone-check.html). */
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
      /** Hold the render scale, or release it with null (tools/phone-check.html's sweep). @param {number | null} s */
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
