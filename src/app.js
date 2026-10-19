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
import { pickTier, probeResult, settingsFor } from './render/quality.js';
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
import { createWaterPass } from './render/passes/water.js';
import { createGrassPass } from './render/passes/grass.js';
import { createFloraPass } from './render/passes/flora.js';
import { createCreaturePass } from './render/passes/creatures.js';
import { bakeBody } from './world/creatures/body-bake.js';
import { previewSpots } from './world/creatures/preview-spots.js';
import { createCreatures } from './world/creatures/index.js';
import { createPresence } from './world/creatures/presence.js';
import { createMidges } from './world/ecology/midges-live.js';
import { onAction, history } from './input/actions.js';
import { attachDesktopInput } from './input/desktop.js';
import { attachTouchInput } from './input/touch.js';

/**
 * @typedef {{ ok: true, tier: string, tierReasons: string[], adapterInfo: GPUAdapterInfo | null, features: string[], stop: () => void,
 *   terrain: import('./world/terrain/index.js').Terrain,
 *   water: import('./world/water/index.js').Water,
 *   growth: import('./world/growth/index.js').Growth, world: { state: any, env: any },
 *   palette: { list: () => { id: string, name: string }[], current: () => any, apply: (json: any, fadeS?: number) => void },
 *   pickColor: (cssX: number, cssY: number) => Promise<string> }
 *   | { ok: false, reason: 'missing'|'no-adapter'|'device-failed' }} StartResult
 */

/** Palettes available in the slice (docs/05): Moonlight and Clear sight join later. */
const PALETTES = [{ id: 'dusk', name: 'Dusk' }, { id: 'meadow-morning', name: 'Meadow morning' }];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onDeviceLost?: (rebuilding: boolean) => void }} [hooks]
 * @returns {Promise<StartResult>}
 */
export async function startApp(canvas, hooks = {}) {
  const result = await initGpu(canvas);
  if (!result.ok) return result;
  const gpu = result.gpu;

  const params = new URLSearchParams(location.search);
  const seed = Number.parseInt(params.get('seed') ?? '1', 10) >>> 0;
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

  // Tool state for the tool bar (ui/tools.js reads it; actions below change it).
  updateStore('tools', (t) => t ?? {
    tool: null, sculptMode: 'raise', paintLayer: 'grass', waterMode: 'pour', springRate: 'brook', plantSpecies: 'reeds',
    size: rb.radiusDefault, strength: rb.strengthDefault, sizeRange: rb.radiusRange,
  });
  // Unlocks (docs 12, 13): placing springs is the dragonflies' gift; `?sandbox` opens it early.
  updateStore('unlocks', (u) => ({ ...(u ?? {}), springs: !!u?.springs || params.has('sandbox') }));
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
  // The world clock and the shared hourly tick (weather, seasons). A new world starts mid-morning.
  // `?day=N` starts a new world N game days in (7 per season: 8 is early summer), to see later seasons sooner.
  // `?frogs=N` (testing) starts on spring day 4 unless a day is given, after the frogs' winter sleep.
  const startDay = Math.max(0, Number.parseInt(params.get('day') ?? (params.has('frogs') ? '3' : '0'), 10) || 0);
  if (clock.worldT() === 0) clock.reset(((skyRecipe.orbit.startHour ?? 10) + 24 * startDay) * clock.SECONDS_PER_HOUR);
  updateStore('meta', (m) => { m.flow = clock.flow(); });
  const env = makeEnv(seed, { seasons: seasonsRecipe, sky: skyRecipe.orbit, water: waterRecipe });
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
  const growthRecipe = await loadRecipe('world/growth');
  /** @type {Record<string, any>} */
  const flora = Object.fromEntries(await Promise.all(growthRecipe.species.map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  /** @type {Record<string, any>} the cover plants other than grass (rushes) */
  const covers = Object.fromEntries(await Promise.all((growthRecipe.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  const growth = createGrowth(gpu.device, { terrain, water, world, recipes: { growth: growthRecipe, flora, covers, land: landRecipe } });
  sim.addSystem(growth);
  // Ecology and creatures (S6a, docs 11, 12): the midge field, frog habitat and the frogs' arrival
  // run in the hourly tick from these recipes.
  const [frogRecipe, midgeRecipe] = await Promise.all([loadRecipe('species/frog'), loadRecipe('species/midge')]);
  world.env.recipes.species = { frog: frogRecipe, midge: midgeRecipe };
  updateStore('world', () => world.state);
  const unHour = on('clock:hour', (/** @type {{ hour: number }} */ p) => {
    const events = sim.hourlyTick(p.hour);
    for (const e of events) emitDeferred(e.name, e.payload);
    updateStore('world', () => world.state);
    // The hour as a whole, for watchers of the world such as the journal (src/world/journal).
    emitDeferred('world:ticked', { hour: p.hour, events, state: world.state });
  });

  const camera = createOrbitCamera(camRecipe);
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
  const shadowPass = createShadowPass({ terrain, recipe: shadowRecipe, terrainRecipe, tierShadows: tierSettings.shadows, worldRadius: camRecipe.worldRadius });
  const lighting = createLighting(gpu.device, atmosphere, shadowPass.resources(gpu.device));
  const exposure = createExposurePass(exposureRecipe);
  const daylight = createDaylight({ sky: skyRecipe, seasons: seasonsRecipe, shadows: shadowRecipe });

  // Look: bloom, then the palette LUT in the tonemap (physical light, painted last; docs/05).
  const baker = await createPaletteBaker(gpu.device);
  // The palette is a device setting (doc 18): remembered in this browser until saves arrive in S7.
  let savedPalette = null;
  try { savedPalette = localStorage.getItem('ebb.palette'); } catch { /* storage blocked: use the default */ }
  const wanted = savedPalette ?? getStore('settings')?.palette;
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
    ground: groundDetail, groundTier: tierSettings.ground, getTide: () => water.tide, lodDistances: tierSettings.lodDistances,
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current, damp: water.sim.damp, dampWet: waterRecipe.look.dampHollowWet,
      vel: water.sim.vel, caustics: waterRecipe.caustics },
    moss: moss.texture, causticLayers: tierSettings.causticLayers, wetness,
    probe: { view: atmosphere.probeView, sampler: atmosphere.probeSampler }, rings: waterRecipe.ripples.rings,
  });
  // The meadow (docs 10): GPU grass blades where grass is painted, after the terrain.
  const grassPass = createGrassPass({
    terrain, recipe: await loadRecipe('flora/grass'), terrainRecipe, seed: subSeed(seed, 'grass'), tier: tierSettings,
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
  // Midges you can see (src/world/ecology/midges-live.js): swarms from the midge field, after the water.
  const midges = createMidges({ world, recipe: midgeRecipe, budget: tierSettings.boids ?? 4096, ripples,
    ground: (x, z) => terrain.sampleHeight(x, z), water: (x, z) => water.sampleLive(x, z),
    wind: () => ({ strength: weatherAt(world.state?.weather, clock.display(), seasonsRecipe).wind, dir: world.state?.weather?.today?.windDir ?? 0 }),
    rain: (hoursAgo) => weatherAt(world.state?.weather, clock.display() - hoursAgo * clock.SECONDS_PER_HOUR, seasonsRecipe).rain });
  sim.addSystem(midges);
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
  const graph = createFrameGraph(gpu, [
    shadowPass,
    terrainPass,
    grassPass,
    rushPass,
    floraPass,
    creatures.pass,
    ...(frogScale ? [frogScale.pass] : []),
    waterPass,
    midges.pass,
    createSkyPass(atmosphere, skyRecipe),
    exposure,
    bloom,
    tonemap,
  ], { tier, lighting });
  await graph.setup();

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
  /** @param {any} t tier name */
  function applyTier(t) {
    tier = t;
    tierSettings = settingsFor(t);
    terrainPass.setTier(tierSettings);
    grassPass.setTier(tierSettings);
    rushPass.setTier(tierSettings);
    waterPass.setDetailFade(tierSettings.waterDetailFadeM);
    waterPass.setSSR(tierSettings.waterSSR ?? null);
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
    return { kind, radius: t.size, strength: t.strength, layer: t.paintLayer };
  }
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

  // The Plant tool (src/world/growth/plant-tool.js): plants a seed where the ground suits it, rings where.
  const plantTool = createPlantTool({ growth, world, flora, recipe: growthRecipe.marks });
  /** @param {number} x @param {number} y */
  function plantTap(x, y) {
    const p = groundAt(x, y);
    if (p) presence.edit(p[0], p[2]);
    if (p && plantTool.tap(tools().plantSpecies ?? 'reeds', p)) updateStore('world', () => world.state);
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
        updateStore('tools', (t) => { t.tool = next; });
        emitDeferred('tool:selected', { toolId: next });
        break;
      }
      case 'brush.set': {
        updateStore('tools', (t) => {
          Object.assign(t, a.patch);
          t.size = clampSize(t.size);
          t.strength = Math.min(1, Math.max(0, t.strength));
        });
        // A new flow step applies to the selected spring too (undoable).
        if (a.patch.springRate) ww.rateSelected(a.patch.springRate);
        if (a.patch.waterMode && a.patch.waterMode !== 'spring') ww.syncSprings(null);
        break;
      }
      case 'water.springRemove':
        ww.removeSpring(a.id);
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
        if (tools().tool === 'water') {
          if (tools().waterMode === 'spring') { if (a.type === 'tool.begin') springTap(a.x, a.y); }
          else if (a.type === 'tool.begin' || pouring) pouring = { x: a.x, y: a.y };
          break;
        }
        if (a.type === 'tool.begin') wantStroke = true;
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
      case 'look.tap': emitDeferred('look:tapped', { x: a.x, y: a.y, point: groundAt(a.x, a.y) }); break;
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
        try { localStorage.setItem('ebb.palette', a.id); } catch { /* storage blocked: the choice lasts this visit */ }
        emitDeferred('palette:changed', { id: a.id });
        break;
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
    const p = t.tool && pointer.inside ? groundAt(pointer.x, pointer.y) : null;
    // The Plant tool marks just the spot a seed would go.
    if (p) terrain.setRing({ x: p[0], z: p[2], radius: t.tool === 'plant' ? 0.4 : t.size, visible: true });
    else terrain.setRing({ visible: false });
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
    graph.resize(devW * tierSettings.renderScale, devH * tierSettings.renderScale);

    const t = clock.advance(realDt);
    camera.setViewport(cssW, cssH);
    camera.update(realDt);
    presence.update(realDt);
    updateRing();
    // Plant tool rings, and a breathing ring round whatever the journal's tap card names.
    terrainPass.setMarks(plantTool.marks(now, tools().tool === 'plant', getStore('identify')));
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
    sim.afterSubmit();
    exposure.afterSubmit();
    tonemap.afterSubmit();

    if (frameIndex > 0) emitDeferred('render:frame-ended', { frameMs, cpuMs: performance.now() - cpuStart, frameIndex });
    flushDeferred();
    frameIndex++;
  }
  raf = requestAnimationFrame(frame);

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
    /** The live midge swarms (tools). */
    midges,
    presence,
    /** The orbit camera, for tools and checks (eye, target, distance). */
    camera,
    /** The island this world started from, and the islands there are (the badge's switch). */
    island: { current: island, list: islands },
    /** Palette access for the palette lab (tools/palette-lab.html). */
    palette: {
      list: () => PALETTES.slice(),
      current: () => structuredClone(baker.current()),
      /** @param {any} json @param {number} [fadeS] */
      apply: (json, fadeS = 0) => baker.setPalette(json, { fadeS }),
    },
    /**
     * Final on-screen color at a point given in CSS pixels from the canvas's top-left.
     * @param {number} cssX @param {number} cssY
     */
    pickColor: (cssX, cssY) => tonemap.pick((cssX * canvas.width) / Math.max(1, cssW), (cssY * canvas.height) / Math.max(1, cssH)),
  };
}
