// @ts-check
// Dynamic resolution (docs 04, 19): the first defense against a heavy moment. One GPU time per
// frame comes in; after `overFrames` frames in a row over the tier's budget the render scale drops
// by `step`, and after `recoverFrames` frames in a row under `recoverBelow` of the budget it climbs
// back, always between the tier's renderScaleMin and renderScale. It also says when the scale has
// sat at its minimum while still over budget for `stepDown.atMinSeconds` (the app then steps the
// tier down once), and, on the tiers in `thermal.tiers`, drops a step early when GPU p95 creeps up
// over minutes at a steady scale (a phone getting warm).
// Each step down must earn its blur (S8d-2): the GPU time over `worth.frames` frames after a step is
// compared with the frames just before it, and a step that saved less than `worth.minGain` is undone
// and no lower scale is tried for `worth.holdSeconds` (on a phone whose cost is in what is drawn
// rather than in pixels, a smaller picture only looks worse). The scale can also be pinned (the
// phone check page's sweep). Every number comes from recipes/quality-tiers.json `dynamicRes`.
// Pure logic: no GPU, no DOM, time is passed in.

/**
 * @typedef {{ step: number, overFrames: number, recoverFrames: number, recoverBelow: number, snapPx: number,
 *   staleFrames: number, frameSlack: number, stepDown: { atMinSeconds: number, noteSeconds: number },
 *   thermal: { tiers: string[], bucketSeconds: number, windowMinutes: number, rise: number, holdMinutes: number },
 *   worth?: { settleFrames: number, frames: number, minGain: number, holdSeconds: number } }} DynamicResRecipe
 * @typedef {'timestamps'|'work-done'|'frame'} Measure  where a sample came from: GPU timestamps,
 *   an onSubmittedWorkDone round trip, or the frame time when no GPU time has come for a while
 * @typedef {{ at: number, from: number, to: number, why: 'over'|'recover'|'thermal'|'tier'|'no-gain'|'pin' }} ScaleChange
 * @typedef {{ renderScale: number, renderScaleMin: number, gpuBudgetMs: number, targetFps: number }} TierScale
 */

const EPS = 1e-4;
const KEEP_CHANGES = 200;

/** @param {number} v */
const round2 = (v) => Math.round(v * 100) / 100;

/** @param {number[]} arr @param {number} q */
function pct(arr, q) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

/** @param {DynamicResRecipe} recipe */
export function createDynamicRes(recipe) {
  let tier = '';
  let max = 1;
  let min = 0.67;
  let scale = 1;
  let budgetMs = 12;
  let framePeriodMs = 1000 / 60;
  // Frames in a row over budget, and under the recover line.
  let over = 0;
  let under = 0;
  /** Over-budget flags for the last `overFrames` samples. @type {boolean[]} */ let recent = [];
  let lastT = -1;
  let atMinOverMs = 0;
  let stuck = false;
  // Thermal care: one p95 per bucket at a steady scale; a thermal step holds a ceiling for a while,
  // or recovery would climb straight back into the heat.
  let thermalOn = false;
  /** @type {number[]} */ let bucket = [];
  let bucketStart = -1;
  /** @type {number[]} */ let p95s = [];
  let ceiling = 1;
  let ceilingUntil = -1;
  /** @type {Measure} */ let measure = 'timestamps';
  /** @type {ScaleChange[]} */ const changes = [];
  // Whether a step down earned its blur: the GPU times just before it, then a trial after it.
  const W = recipe.worth ?? null;
  /** @type {number[]} */ let lastMs = [];
  /** @type {null | { from: number, before: number, skip: number, samples: number[] }} */ let trial = null;
  let floor = 0;
  let floorUntil = -1;
  /** A scale held by hand (the phone check page's sweep), or null. @type {number | null} */ let pinned = null;

  function resetCounts() {
    over = 0;
    under = 0;
    recent = [];
    atMinOverMs = 0;
    bucket = [];
    bucketStart = -1;
    p95s = [];
  }

  /** @param {number} next @param {ScaleChange['why']} why @param {number} now */
  function change(next, why, now) {
    next = round2(Math.max(min, Math.min(max, next)));
    const from = scale;
    if (Math.abs(next - scale) > EPS) {
      changes.push({ at: now, from: scale, to: next, why });
      if (changes.length > KEEP_CHANGES) changes.shift();
    }
    scale = next;
    resetCounts();
    // A step down goes on trial against the frames just before it.
    trial = W && why === 'over' && lastMs.length >= Math.min(W.frames, recipe.overFrames) && next < from - EPS
      ? { from, before: pct(lastMs, 0.5), skip: W.settleFrames, samples: [] } : null;
    lastMs = [];
  }

  /** The lowest scale allowed now: the tier's minimum, or a floor left by a step that saved nothing. */
  const lowest = () => Math.max(min, floorUntil >= 0 ? floor : min);

  /** @param {number} ms @param {number} now @returns {boolean} true while a trial is running */
  function judge(ms, now) {
    if (!W) return false;
    if (!trial) {
      lastMs.push(ms);
      if (lastMs.length > W.frames) lastMs.shift();
      return false;
    }
    if (trial.skip > 0) { trial.skip--; return true; }
    trial.samples.push(ms);
    if (trial.samples.length < W.frames) return true;
    const t = trial;
    trial = null;
    const after = pct(t.samples, 0.5);
    if (t.before > 0 && (t.before - after) / t.before < W.minGain) {
      change(t.from, 'no-gain', now);
      floor = t.from;
      floorUntil = now + W.holdSeconds * 1000;
    }
    return false;
  }

  /** @param {number} ms @param {number} now */
  function thermal(ms, now) {
    const T = recipe.thermal;
    if (bucketStart < 0) bucketStart = now;
    bucket.push(ms);
    if (now - bucketStart < T.bucketSeconds * 1000) return;
    p95s.push(pct(bucket, 0.95));
    bucket = [];
    bucketStart = now;
    const span = Math.max(1, Math.round((T.windowMinutes * 60) / T.bucketSeconds));
    if (p95s.length > span + 1) p95s.shift();
    if (p95s.length === span + 1 && p95s[span] > p95s[0] * (1 + T.rise) && scale > min + EPS) {
      change(scale - recipe.step, 'thermal', now);
      ceiling = scale;
      ceilingUntil = now + T.holdMinutes * 60000;
    }
  }

  return {
    /**
     * A new tier: its scale range and budget. keepScale holds the current scale inside the new
     * range (an automatic step down or its undo); otherwise the tier's own scale is used.
     * @param {string} name @param {TierScale} s @param {boolean} [keepScale] @param {number} [now]
     */
    setTier(name, s, keepScale = false, now = 0) {
      tier = name;
      max = s.renderScale;
      min = Math.min(max, s.renderScaleMin);
      budgetMs = s.gpuBudgetMs;
      framePeriodMs = 1000 / Math.max(1, s.targetFps);
      thermalOn = recipe.thermal.tiers.includes(name);
      ceiling = max;
      ceilingUntil = -1;
      stuck = false;
      trial = null;
      lastMs = [];
      floorUntil = -1;
      const from = scale;
      scale = round2(keepScale ? Math.max(min, Math.min(max, scale)) : max);
      if (Math.abs(from - scale) > EPS) changes.push({ at: now, from, to: scale, why: 'tier' });
      resetCounts();
    },

    /**
     * One frame's time. GPU samples are judged against the tier's GPU budget; a frame-time sample
     * (no GPU time has come for a while) against the frame period times frameSlack. Under a frame
     * cap the frame time cannot show headroom, so a frame-time sample rarely lets the scale climb.
     * @param {number} ms @param {Measure} from @param {number} now performance.now()
     */
    sample(ms, from, now) {
      measure = from;
      const limit = from === 'frame' ? framePeriodMs * recipe.frameSlack : budgetMs;
      const isOver = ms > limit;
      if (isOver) { over++; under = 0; }
      else if (ms < limit * recipe.recoverBelow) { under++; over = 0; }
      else { over = 0; under = 0; }
      recent.push(isOver);
      if (recent.length > recipe.overFrames) recent.shift();
      const dt = lastT < 0 ? 0 : Math.max(0, Math.min(now - lastT, 250));
      lastT = now;
      if (ceilingUntil >= 0 && now >= ceilingUntil) { ceiling = max; ceilingUntil = -1; }
      if (floorUntil >= 0 && now >= floorUntil) floorUntil = -1;
      if (pinned !== null) return;
      const onTrial = from !== 'frame' && judge(ms, now);

      if (!onTrial) {
        if (over >= recipe.overFrames && scale > lowest() + EPS) change(scale - recipe.step, 'over', now);
        else if (under >= recipe.recoverFrames && scale < Math.min(max, ceiling) - EPS) change(Math.min(scale + recipe.step, ceiling), 'recover', now);
      }

      // At the lowest scale allowed and still mostly over budget: time toward the one automatic
      // step down (a lighter tier draws less, which helps where a smaller picture did not).
      const mostlyOver = recent.length >= recipe.overFrames && recent.filter(Boolean).length * 2 > recent.length;
      if (!onTrial && scale <= lowest() + EPS && mostlyOver) atMinOverMs += dt;
      else atMinOverMs = 0;
      if (atMinOverMs >= recipe.stepDown.atMinSeconds * 1000) { stuck = true; atMinOverMs = 0; }

      if (thermalOn && from !== 'frame') thermal(ms, now);
    },

    /**
     * Hold the render scale (the phone check page's sweep), or release it with null. While held the
     * scale never moves by itself.
     * @param {number | null} s @param {number} [now]
     */
    pin(s, now = 0) {
      trial = null;
      lastMs = [];
      if (s === null) { pinned = null; resetCounts(); return; }
      pinned = round2(Math.max(0.25, Math.min(1, s)));
      if (Math.abs(pinned - scale) > EPS) changes.push({ at: now, from: scale, to: pinned, why: 'pin' });
      scale = pinned;
      resetCounts();
    },

    /** True once after the scale has sat at its minimum, over budget, for atMinSeconds. */
    takeStuck() {
      const s = stuck;
      stuck = false;
      return s;
    },

    /**
     * The internal render size for a canvas size. Below a scale of 1 it snaps to snapPx pixels, so
     * small scale changes do not re-make textures every frame; at 1 it is the canvas size exactly.
     * @param {number} w @param {number} h canvas pixels
     * @returns {[number, number]}
     */
    internalSize(w, h) {
      if (scale >= 1 - EPS) return [w, h];
      const snap = Math.max(1, recipe.snapPx);
      return [Math.max(snap, Math.round((w * scale) / snap) * snap), Math.max(snap, Math.round((h * scale) / snap) * snap)];
    },

    get scale() { return scale; },
    get min() { return min; },
    get max() { return max; },
    get tier() { return tier; },
    get budgetMs() { return budgetMs; },
    /** The scale held by hand, or null. */
    get pinned() { return pinned; },
    /** The lowest scale allowed now (raised for a while after a step that saved nothing). */
    get lowest() { return lowest(); },
    /** Where the last sample came from. */
    get measure() { return measure; },
    /** Every scale change this session, oldest first (the phone check page saves them). */
    changes: () => changes.slice(),
  };
}

/** @typedef {ReturnType<typeof createDynamicRes>} DynamicRes */
