// @ts-check
// Quality while playing (docs 04, 19): the wiring around dynamic resolution. It gathers one GPU
// time per frame (the sum of the pass timestamps, or, where the browser has no timestamp-query, an
// onSubmittedWorkDone round trip for the whole frame; the frame time if neither has come for a
// while), feeds src/render/dynamic-res.js, paces frames with src/render/frame-cap.js, and makes the
// one automatic tier step down a session with its calm note (src/ui/quality-note.js) and Undo.
// Emits `render:gpu-frame` { ms, measure, scale } for each GPU time (tools/phone-check.html).

import { on, emit } from '../core/events.js';
import { createDynamicRes } from './dynamic-res.js';
import { createFrameCap } from './frame-cap.js';
import { tierBelow } from './quality.js';
import { showQualityNote, hideQualityNote } from '../ui/quality-note.js';

const NOTE_TEXT = 'The island is running a little lighter so it stays smooth.';
const NOTE_UNDO = 'Undo';

/**
 * @param {{ recipe: any, timestamps: boolean, tier: () => string, settings: () => any,
 *   applyTier: (t: string, keepScale: boolean) => void }} opts
 *   recipe: recipes/quality-tiers.json; timestamps: the device has timestamp-query;
 *   applyTier: switch the app's tier live (it calls setTier below)
 */
export function createQualityLive(opts) {
  const R = opts.recipe.dynamicRes;
  const dyn = createDynamicRes(R);
  const cap = createFrameCap(opts.recipe.frameCap);
  let sinceGpu = 0;
  let workDonePending = false;
  let disposed = false;
  /** @type {null | { from: string, to: string }} */ let autoStep = null;
  let autoOff = false;

  /** @param {number} ms @param {import('./dynamic-res.js').Measure} measure */
  function gpuSample(ms, measure) {
    sinceGpu = 0;
    dyn.sample(ms, measure, performance.now());
    emit('render:gpu-frame', { ms, measure, scale: dyn.scale });
  }

  const unTimings = on('render:timings', (/** @type {{ passes: { ms: number }[] }} */ p) => {
    if (!disposed) gpuSample(p.passes.reduce((sum, x) => sum + x.ms, 0), 'timestamps');
  });

  /** The one automatic step down this session, with the calm note and its Undo. */
  function stepDownOnce() {
    if (autoStep || autoOff) return;
    const from = opts.tier();
    const to = tierBelow(/** @type {any} */ (from));
    if (!to) return;   // already on low: dynamic resolution is all there is
    autoStep = { from, to };
    opts.applyTier(to, true);
    console.info(`quality: render scale at its minimum and over budget for ${R.stepDown.atMinSeconds} s; stepping ${from} down to ${to}`);
    emit('quality:stepped-down', { from, to });
    showQualityNote({
      text: NOTE_TEXT, undoLabel: NOTE_UNDO, seconds: R.stepDown.noteSeconds,
      onUndo: () => {
        autoOff = true;   // the player chose: no more automatic steps this session
        opts.applyTier(from, true);
        emit('quality:undone', { tier: from });
      },
    });
  }

  return {
    /**
     * Should this animation frame be drawn (the frame cap)? Call first thing in the frame.
     * @param {number} now rAF time
     */
    due: (now) => cap.due(now, opts.settings().targetFps),

    /**
     * After queue.submit: time the frame with a work-done round trip where there are no
     * timestamps, fall back to the frame time if no GPU time has come for a while, and act on a
     * long stay at the minimum scale.
     * @param {GPUQueue} queue @param {number} frameMs time since the last drawn frame
     */
    afterSubmit(queue, frameMs) {
      sinceGpu++;
      if (!opts.timestamps && !workDonePending) {
        workDonePending = true;
        const t0 = performance.now();
        queue.onSubmittedWorkDone().then(() => {
          workDonePending = false;
          if (!disposed) gpuSample(performance.now() - t0, 'work-done');
        }, () => { workDonePending = false; });
      }
      if (sinceGpu > R.staleFrames && frameMs > 0) dyn.sample(frameMs, 'frame', performance.now());
      if (dyn.takeStuck()) stepDownOnce();
    },

    /**
     * The app switched tier (applyTier calls this). keepScale: an automatic step or its undo
     * keeps the scale inside the new range; a chosen tier starts at its own scale.
     * @param {string} t @param {any} settings @param {boolean} keepScale
     */
    setTier(t, settings, keepScale) {
      dyn.setTier(t, settings, keepScale, performance.now());
      cap.reset();
    },

    /** The player picked a tier (Settings): no automatic step down after that, this session. */
    chosen() {
      autoOff = true;
      hideQualityNote(true);
    },

    /** @param {number} w @param {number} h canvas pixels @returns {[number, number]} internal size */
    internalSize: (w, h) => dyn.internalSize(w, h),

    get scale() { return dyn.scale; },

    /** For tools: the scale range, what the GPU time is measured with, every scale change. */
    info: () => ({
      scale: dyn.scale, min: dyn.min, max: dyn.max, budgetMs: dyn.budgetMs,
      measure: dyn.measure === 'frame' ? 'frame' : opts.timestamps ? 'timestamps' : 'work-done',
      changes: dyn.changes(), autoStep, autoOff,
    }),

    dispose() {
      disposed = true;
      unTimings();
      hideQualityNote(true);
    },
  };
}

/** @typedef {ReturnType<typeof createQualityLive>} QualityLive */
