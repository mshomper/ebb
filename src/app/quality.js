// @ts-check
// Quality while playing: dynamic resolution, canvas sizing, tier switches and the startup probe.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { on } from '../core/events.js';
import { update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { probeResult, settingsFor, setTier as setQualityTier } from '../render/quality.js';
import { createQualityLive } from '../render/quality-live.js';
import { createFrameUniformWriter } from '../render/frame-uniforms.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { bloom, camp, canvas, caveLighting, fallsPass, gpu, graph, grassPass, groundDetail, lighting, matsPass, midges, rushPass, schools, shadowPass, terrainPass, waterPass } = ctx;
  // The tier, its settings and the probe are read from ctx each time: a tier switch changes them.
  // Quality while playing (src/render/quality-live.js): dynamic resolution and the one automatic
  // tier step down with its calm note.
  const live = createQualityLive({
    recipe: await loadRecipe('quality-tiers'), timestamps: graph.timingSupported,
    tier: () => ctx.tier, settings: () => ctx.tierSettings, applyTier: (t, keepScale) => applyTier(t, keepScale),
  });
  live.setTier(ctx.tier, ctx.tierSettings, false);

  const uniforms = createFrameUniformWriter();
  const prevViewProj = new Float32Array(16);

  // Size the canvas from its CSS box, within the tier's DPR and megapixel caps (ctx.size: the frame,
  // photo mode and the pointer read it).
  const size = { cssW: 1, cssH: 1, devW: 1, devH: 1 };
  ctx.size = size;
  /** @type {ResizeObserverEntry | null} */ let lastEntry = null;
  /** @param {ResizeObserverEntry} e */
  function sizeCanvas(e) {
    lastEntry = e;
    size.cssW = e.contentRect.width;
    size.cssH = e.contentRect.height;
    const { tierSettings } = ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, tierSettings.maxDpr);
    const box = e.devicePixelContentBoxSize?.[0];
    let w = box ? box.inlineSize * (dpr / (window.devicePixelRatio || 1)) : size.cssW * dpr;
    let h = box ? box.blockSize * (dpr / (window.devicePixelRatio || 1)) : size.cssH * dpr;
    const maxPx = tierSettings.maxMegapixels * 1e6;
    if (w * h > maxPx) {
      const k = Math.sqrt(maxPx / (w * h));
      w *= k;
      h *= k;
    }
    size.devW = Math.max(1, Math.round(w));
    size.devH = Math.max(1, Math.round(h));
  }
  const observer = new ResizeObserver((entries) => sizeCanvas(entries[0]));
  observer.observe(canvas);

  // Startup probe (docs/19): a device trying ultra measures GPU time for a couple of seconds once
  // the ground detail has faded in, then keeps ultra or steps back to high, with no reload.
  // Any tier switch (the probe, the automatic step down and its undo, Settings) comes through here.
  /** @param {any} t tier name @param {boolean} [keepScale] keep the render scale (an automatic step or its undo) */
  function applyTier(t, keepScale = false) {
    ctx.tier = t;
    const tierSettings = ctx.tierSettings = settingsFor(t);
    setQualityTier(t);
    terrainPass.setTier({ ...tierSettings, name: t });
    grassPass.setTier(tierSettings);
    rushPass.setTier(tierSettings);
    matsPass.setTier(tierSettings);
    waterPass.setDetailFade(tierSettings.waterDetailFadeM);
    waterPass.setSSR(tierSettings.waterSSR ?? null);
    if (fallsPass.setTier(tierSettings)) graph.invalidate();
    if (camp.firePass.setTier(t)) graph.invalidate();
    // Shadows, bloom and the midges follow too. A texture's size is fixed once made, so a new
    // shadow map size re-makes only that map and the lighting group that binds it; new bloom levels
    // re-make the bloom chain at the next resize, which invalidate() forces.
    if (shadowPass.setTier(tierSettings.shadows, gpu.device, tierSettings.cliffDetailM)) { lighting.setShadow(shadowPass.resources(gpu.device)); caveLighting.setShadow(shadowPass.resources(gpu.device)); }
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
  ctx.unProbe = () => {};
  const { probe } = ctx;
  if (probe) {
    if (!graph.timingSupported) {
      // Without GPU timestamps there is nothing to measure; stay on the safe side.
      applyTier(probeResult(false, probe.fallback));
    } else {
      ctx.unProbe = on('render:timings', (/** @type {{ passes: { ms: number }[], gpu: boolean }} */ p) => {
        if (!ctx.probe || groundDetail.fade < 1) return;
        if (++probeFrames < probe.settleFrames) return;
        if (!probeStart) probeStart = performance.now();
        probeMs.push(p.passes.reduce((sum, x) => sum + x.ms, 0));
        if (performance.now() - probeStart < probe.seconds * 1000) return;
        const sorted = probeMs.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const passed = p95 <= probe.maxMs;
        console.info(`quality probe: GPU p95 ${p95.toFixed(2)} ms over ${sorted.length} frames, ${passed ? 'keeping' : 'stepping down from'} ${ctx.tier}`);
        applyTier(probeResult(passed, probe.fallback));
        ctx.probe = null;
        ctx.unProbe();
      });
    }
  }
  Object.assign(ctx, { live, uniforms, prevViewProj, observer, applyTier });
}
