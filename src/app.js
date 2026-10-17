// @ts-check
// Starts ebb on a canvas: GPU, tier, camera, frame graph, input and the frame loop.
// Shared by index.html (through main.js) and the tools pages, so they measure the same code.

import { initGpu, onDeviceLost } from './core/gpu.js';
import * as clock from './core/clock.js';
import { flushDeferred, emitDeferred } from './core/events.js';
import { update as updateStore } from './core/store.js';
import { loadRecipe } from './core/recipes.js';
import { pickTier } from './render/quality.js';
import { createOrbitCamera } from './render/camera.js';
import { createFrameGraph } from './render/frame-graph.js';
import { createFrameUniformWriter } from './render/frame-uniforms.js';
import { createPlaceholderIslandPass, placeholderGroundProbe } from './render/passes/placeholder-island.js';
import { createSkyPlainPass } from './render/passes/sky-plain.js';
import { createTonemapPass } from './render/passes/post/tonemap.js';
import { onAction } from './input/actions.js';
import { attachDesktopInput } from './input/desktop.js';
import { attachTouchInput } from './input/touch.js';

/**
 * @typedef {{ ok: true, tier: string, tierReasons: string[], adapterInfo: GPUAdapterInfo | null, features: string[], stop: () => void }
 *   | { ok: false, reason: 'missing'|'no-adapter'|'device-failed' }} StartResult
 */

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

  const [{ tier, settings: tierSettings, reasons }, camRecipe, skyRecipe, islandRecipe] = await Promise.all([
    pickTier(gpu.adapter),
    loadRecipe('world/camera'),
    loadRecipe('world/sky'),
    loadRecipe('world/placeholder-island'),
  ]);
  updateStore('settings', (s) => { s.quality = tier; });

  const camera = createOrbitCamera(camRecipe);
  camera.setGroundProbe(placeholderGroundProbe(islandRecipe));

  const graph = createFrameGraph(gpu, [
    createPlaceholderIslandPass({ seed }),
    createSkyPlainPass(),
    createTonemapPass(),
  ], { tier });
  await graph.setup();
  graph.setSky(skyRecipe);

  const sunDir = normalize3(skyRecipe.sunDir);
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

  const unAction = onAction((a) => {
    if (a.type === 'camera.orbit') camera.orbit(a.dx, a.dy);
    else if (a.type === 'camera.pan') camera.pan(a.dx, a.dy);
    else if (a.type === 'camera.zoom') camera.zoom(a.factor, a.x, a.y);
    else if (a.type === 'camera.twist') camera.twist(a.angle);
  });
  const detachDesktop = attachDesktopInput(canvas, camRecipe);
  const detachTouch = attachTouchInput(canvas, camRecipe);

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

    const display = clock.display();
    const season = clock.seasonOf(display);
    graph.writeFrameUniforms(uniforms.pack({
      view: camera.view, proj: camera.proj, viewProj: camera.viewProj, invViewProj: camera.invViewProj,
      prevViewProj, cameraPos: camera.eye, near: camera.near,
      renderSize: graph.size,
      animTime: t.animT,
      displayHours: (display % clock.SECONDS_PER_YEAR) / clock.SECONDS_PER_HOUR,
      dayFrac: clock.dayFractionOf(display),
      yearFrac: clock.yearFractionOf(display),
      seasonPhase: season.phase,
      moonPhase: 0,
      ev100: skyRecipe.ev100,
      sunDir, sunIlluminance: skyRecipe.sunIlluminanceLux,
      moonDir: [0, 1, 0], moonIlluminance: [0, 0, 0],
      tierFlags: tier === 'high' ? 2 : tier === 'medium' ? 1 : 0,
      frameIndex,
    }));
    prevViewProj.set(camera.viewProj);

    const encoder = gpu.device.createCommandEncoder({ label: 'frame' });
    graph.render(encoder);
    gpu.device.queue.submit([encoder.finish()]);
    graph.afterSubmit();

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
    detachDesktop();
    detachTouch();
    graph.dispose();
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
  };
}

/** @param {number[]} v */
function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
