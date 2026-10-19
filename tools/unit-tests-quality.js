// @ts-check
// Quality tests for tools/unit-tests.html (S8d-1, docs 04, 19): dynamic resolution steps down and
// back, stays inside the tier's range, says when it is stuck at the minimum, eases off early when
// the GPU warms up on low; the frame cap draws about the tier's target rate on fast displays.

import { createDynamicRes } from '../src/render/dynamic-res.js';
import { createFrameCap } from '../src/render/frame-cap.js';

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
    for (let i = 0; i < 1200; i++) {
      t += 16.7;
      d.sample(high.gpuBudgetMs * 1.5, 'timestamps', t);
      if (d.takeStuck() && stuckAt < 0) stuckAt = t;
    }
    eq(d.scale, high.renderScaleMin, 'ends at the tier minimum');
    assert(stuckAt > 0, 'stuck at the minimum is reported');
    for (let i = 0; i < 2000; i++) { t += 16.7; d.sample(high.gpuBudgetMs * 0.5, 'timestamps', t); }
    eq(d.scale, high.renderScale, 'climbs back to the tier scale');
    return `stuck reported ${(stuckAt / 1000).toFixed(1)} s in; ${d.changes().length} scale changes`;
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

  test(QUALITY, 'thermal care drops a step early on low when GPU time creeps up', async () => {
    const q = await recipe();
    const d = createDynamicRes(q.dynamicRes);
    d.setTier('low', q.tiers.low, false, 0);
    let t = 0;
    const minutes = q.dynamicRes.thermal.windowMinutes + 2;
    for (let i = 0; i < 30 * 60 * minutes; i++) {
      t += 1000 / 30;
      d.sample(10 * (1 + 0.4 * Math.min(1, t / (minutes * 60000))), 'timestamps', t);
    }
    const thermal = d.changes().filter((c) => c.why === 'thermal');
    assert(thermal.length >= 1, 'a thermal step happened');
    return `thermal step at ${(thermal[0]?.at / 60000).toFixed(1)} min`;
  });

  test(QUALITY, 'the frame cap draws about the target rate', async () => {
    const q = await recipe();
    const lines = [];
    for (const [hz, fps] of [[120, 30], [60, 30], [144, 60], [60, 60]]) {
      const cap = createFrameCap(q.frameCap);
      let n = 0;
      for (let i = 0; i < hz * 10; i++) if (cap.due((i * 1000) / hz, fps)) n++;
      assert(Math.abs(n / 10 - fps) < 1, `${hz} Hz at ${fps}: ${n / 10} fps`);
      lines.push(`${hz} Hz at ${fps}: ${n / 10}`);
    }
    return lines.join('; ');
  });
}
