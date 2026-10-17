// @ts-check
// Starts ebb on a canvas: GPU, tier, camera, terrain, sky and light, the hourly tick, frame graph,
// input, history and the frame loop.
// Shared by index.html (through main.js) and the tools pages, so they measure the same code.

import { initGpu, onDeviceLost } from './core/gpu.js';
import * as clock from './core/clock.js';
import { flushDeferred, emitDeferred, on } from './core/events.js';
import { get as getStore, update as updateStore } from './core/store.js';
import { loadRecipe } from './core/recipes.js';
import { subSeed } from './core/rng.js';
import { pickTier } from './render/quality.js';
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
import { onAction, history } from './input/actions.js';
import { attachDesktopInput } from './input/desktop.js';
import { attachTouchInput } from './input/touch.js';

/**
 * @typedef {{ ok: true, tier: string, tierReasons: string[], adapterInfo: GPUAdapterInfo | null, features: string[], stop: () => void,
 *   terrain: import('./world/terrain/index.js').Terrain,
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

  const [{ tier, settings: tierSettings, reasons }, camRecipe, skyRecipe, terrainRecipe, seasonsRecipe, exposureRecipe, shadowRecipe, postRecipe, ...paletteRecipes] = await Promise.all([
    pickTier(gpu.adapter),
    loadRecipe('world/camera'),
    loadRecipe('world/sky'),
    loadRecipe('world/terrain'),
    loadRecipe('world/seasons'),
    loadRecipe('world/exposure'),
    loadRecipe('world/shadows'),
    loadRecipe('world/post'),
    ...PALETTES.map((p) => loadRecipe(`palettes/${p.id}`)),
  ]);
  /** @type {Record<string, any>} */
  const palettes = Object.fromEntries(PALETTES.map((p, i) => [p.id, paletteRecipes[i]]));
  const landRecipe = await loadRecipe(terrainRecipe.starter.land);
  updateStore('settings', (s) => { s.quality = tier; });
  const rb = terrainRecipe.brush;

  // Tool state for the tool bar (ui/tools.js reads it; actions below change it).
  updateStore('tools', (t) => t ?? {
    tool: null, sculptMode: 'raise', paintLayer: 'grass',
    size: rb.radiusDefault, strength: rb.strengthDefault, sizeRange: rb.radiusRange,
  });
  const syncHistory = () => updateStore('history', () => ({ canUndo: history.canUndo(), canRedo: history.canRedo() }));
  history.setBudget((terrainRecipe.undoBudgetMB[tier] ?? 12) * 1024 * 1024);
  const unHistory = history.onChange(syncHistory);
  syncHistory();

  const terrain = await createTerrain(gpu, { seed: subSeed(seed, 'terrain'), recipe: terrainRecipe, land: landRecipe });
  history.setApplier('terrain', (cmd, dir) => terrain.applyTiles(dir === 'undo' ? cmd.before : cmd.after));
  // The world clock and the shared hourly tick (weather, seasons). A new world starts mid-morning.
  if (clock.worldT() === 0) clock.reset((skyRecipe.orbit.startHour ?? 10) * clock.SECONDS_PER_HOUR);
  updateStore('meta', (m) => { m.flow = clock.flow(); });
  const env = makeEnv(seed, { seasons: seasonsRecipe, sky: skyRecipe.orbit });
  /** @type {import('./sim/live-sim.js').LiveWorld} */
  const world = { state: getStore('world') ?? runHour(initialWorldState(seed), clock.hourIndex(), env).state, env };
  updateStore('world', () => world.state);
  const sim = createLiveSim({ world });
  sim.addSystem(terrain);
  const unHour = on('clock:hour', (/** @type {{ hour: number }} */ p) => {
    for (const e of sim.hourlyTick(p.hour)) emitDeferred(e.name, e.payload);
    updateStore('world', () => world.state);
  });

  const camera = createOrbitCamera(camRecipe);
  camera.setGroundProbe((x, z) => terrain.sampleHeight(x, z));

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

  const graph = createFrameGraph(gpu, [
    shadowPass,
    createTerrainPass({
      terrain, recipe: terrainRecipe, seed: subSeed(seed, 'terrain-look'), getEye: () => camera.eye, tier,
      ground: groundDetail, groundTier: tierSettings.ground,
    }),
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
  const observer = new ResizeObserver((entries) => {
    const e = entries[0];
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
  });
  observer.observe(canvas);

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
      case 'tool.select': {
        const next = a.toolId && a.toolId !== tools().tool ? a.toolId : null;
        if (!next) finishStroke();
        updateStore('tools', (t) => { t.tool = next; });
        emitDeferred('tool:selected', { toolId: next });
        break;
      }
      case 'brush.set':
        updateStore('tools', (t) => {
          Object.assign(t, a.patch);
          t.size = clampSize(t.size);
          t.strength = Math.min(1, Math.max(0, t.strength));
        });
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
        if (a.type === 'tool.begin') wantStroke = true;
        if (!wantStroke) break;
        const p = groundAt(a.x, a.y);
        if (!p) break;
        if (!stroking) stroking = terrain.beginStroke(currentBrush(), p, a.pressure);
        else terrain.strokeTo(p, a.pressure);
        break;
      }
      case 'tool.end':
      case 'tool.cancel':
        finishStroke();
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
    const p = t.tool && pointer.inside ? groundAt(pointer.x, pointer.y) : null;
    if (p) terrain.setRing({ x: p[0], z: p[2], radius: t.size, visible: true });
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
    updateRing();
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
      tierFlags: tier === 'high' ? 2 : tier === 'medium' ? 1 : 0,
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
    ok: true, tier, tierReasons: reasons,
    adapterInfo: gpu.adapter.info ?? null,
    features: [...gpu.features],
    stop,
    terrain,
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
