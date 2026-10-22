// @ts-check
// Quality tests for tools/unit-tests.html (S8d-1, docs 04, 19): dynamic resolution steps down and
// back, stays inside the tier's range, says when it is stuck at the minimum; low is a 60 fps
// emergency fallback below medium, the floor (desktop and laptop only, October 21, 2026).

import { createDynamicRes } from '../src/render/dynamic-res.js';

const QUALITY = 'quality';

async function recipe() {
  const r = await fetch('../recipes/quality-tiers.json');
  if (!r.ok) throw new Error(`recipes/quality-tiers.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addQualityTests(test, assert, eq) {
  test(QUALITY, 'dynamic resolution steps down to the minimum, says it is stuck, and climbs back', async () => {
    const q = await recipe();
    const d = createDynamicRes(q.dynamicRes);
    const high = q.tiers.high;
    d.setTier('high', high, false, 0);
    eq(d.scale, high.renderScale, 'starts at the tier scale');
    let t = 0, stuckAt = -1;
    // A GPU whose cost follows the pixels (scale squared), still over budget at the minimum.
    for (let i = 0; i < 3000; i++) {
      t += 16.7;
      d.sample(high.gpuBudgetMs * 2.5 * d.scale * d.scale, 'timestamps', t);
      if (d.takeStuck() && stuckAt < 0) stuckAt = t;
    }
    eq(d.scale, high.renderScaleMin, 'ends at the tier minimum');
    assert(stuckAt > 0, 'stuck at the minimum is reported');
    for (let i = 0; i < 2000; i++) { t += 16.7; d.sample(high.gpuBudgetMs * 0.5, 'timestamps', t); }
    eq(d.scale, high.renderScale, 'climbs back to the tier scale');
    return `stuck reported ${(stuckAt / 1000).toFixed(1)} s in; ${d.changes().length} scale changes`;
  });

  test(QUALITY, 'a step down that saves nothing is undone, and the tier steps down instead', async () => {
    const q = await recipe();
    const d = createDynamicRes(q.dynamicRes);
    const low = q.tiers.low;
    d.setTier('low', low, false, 0);
    let t = 0, stuckAt = -1;
    // A weak laptop whose cost does not follow the pixels, for 30 seconds.
    for (let i = 0; i < 60 * 30; i++) {
      t += 1000 / 60;
      d.sample(low.gpuBudgetMs * 1.5, 'timestamps', t);
      if (d.takeStuck() && stuckAt < 0) stuckAt = t;
    }
    const undone = d.changes().filter((c) => c.why === 'no-gain');
    assert(undone.length >= 1, 'the useless step was undone');
    eq(d.scale, low.renderScale, 'the picture stays at the tier scale');
    assert(stuckAt > 0, 'over budget at the lowest useful scale is reported, so the tier can step down');
    return `undone ${(undone[0].at / 1000).toFixed(1)} s in; stuck reported ${(stuckAt / 1000).toFixed(1)} s in`;
  });

  test(QUALITY, 'a pinned scale holds still, and moves again once released', async () => {
    const q = await recipe();
    const d = createDynamicRes(q.dynamicRes);
    const low = q.tiers.low;
    d.setTier('low', low, false, 0);
    d.pin(0.6, 0);
    let t = 0;
    for (let i = 0; i < 600; i++) { t += 1000 / 60; d.sample(low.gpuBudgetMs * 3 * d.scale * d.scale, 'timestamps', t); }
    eq(d.scale, 0.6, 'held at 0.6 while over budget');
    d.pin(null, t);
    for (let i = 0; i < 600; i++) { t += 1000 / 60; d.sample(low.gpuBudgetMs * 3 * d.scale * d.scale, 'timestamps', t); }
    assert(d.scale < 0.6, `released, it steps down: ${d.scale}`);
    return `ended at ${d.scale}`;
  });

  test(QUALITY, 'dynamic resolution snaps its size below a scale of 1 and keeps the scale on a step down', async () => {
    const q = await recipe();
    const d = createDynamicRes(q.dynamicRes);
    d.setTier('low', q.tiers.low, false, 0);
    const [w, h] = d.internalSize(1000, 1201);
    assert(w % q.dynamicRes.snapPx === 0 && h % q.dynamicRes.snapPx === 0, `snapped to ${q.dynamicRes.snapPx} px: ${w} by ${h}`);
    d.setTier('high', q.tiers.high, false, 0);
    eq(d.internalSize(1001, 777).join(','), '1001,777', 'scale 1 is the canvas size exactly');
    d.setTier('medium', q.tiers.medium, true, 0);
    eq(d.scale, q.tiers.medium.renderScale, 'kept scale is held inside the new range');
    return `low ${w} by ${h}`;
  });

  test(QUALITY, 'low is a 60 fps fallback below medium, with no phone-only settings left', async () => {
    const q = await recipe();
    const { low, medium } = q.tiers;
    eq(low.targetFps, 60, 'low targets 60 fps');
    assert(low.gpuBudgetMs < 1000 / 60, `low's GPU budget fits a 60 fps frame: ${low.gpuBudgetMs} ms`);
    assert(low.grassDensity <= medium.grassDensity && low.renderScale <= medium.renderScale, 'low draws no more than medium');
    assert(!('frameCap' in q) && !('budgetGroups' in q) && !('thermal' in q.dynamicRes), 'no frame cap, mobile budget groups or thermal care');
    return `low ${low.targetFps} fps, ${low.gpuBudgetMs} ms`;
  });
}