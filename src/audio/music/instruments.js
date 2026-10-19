// @ts-check
// The music's instruments by palette name (doc 24, "Instruments"): 'piano' is the Steinway B game
// set with the Knight's pedal sound under it, 'pad' and 'bell' and 'fm-piano' are built in code.
// prepare() unpacks only the notes a performance uses, a little ahead of time (doc 24, budget:
// the piano downloads once, then each piece unpacks its own notes); afterwards the least recently
// sounded notes are freed once the music passes its memory budget. The sampled support kit (harp,
// flute, solo cello, vibraphone struck and bowed, glass, and the string section played as one
// ensemble) comes from recipes/music/roster.json; an instrument whose recipe is missing is simply
// absent, and the realizer falls back to the next one in a piece's list.

import { createSampler } from './sampler.js';
import { createEnsemble } from './ensemble.js';
import * as synth from './synth.js';
import { loadAudioRecipe, samplerSettingsFor } from '../recipes.js';

/** @typedef {{noteOn: Function, noteOff: Function, pedal: Function, stopAll: Function, load: Function, stats: Function, trim?: Function}} Instrument */

/**
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} output the music bus input
 * @param {{tier?: 'desktop'|'mobile', budgetMB?: number}} [opts]
 */
export async function createInstruments(ctx, output, opts = {}) {
  const tier = opts.tier ?? 'desktop';
  const budgetMB = opts.budgetMB ?? (tier === 'mobile' ? 20 : 128);
  const [samplerRecipe, synthRecipe, piano, pedal] = await Promise.all([
    loadAudioRecipe('music/sampler'),
    loadAudioRecipe('music/synth'),
    loadAudioRecipe('music/instruments/piano-steinway-b'),
    loadAudioRecipe('music/instruments/pedal-knight').catch(() => null),
  ]);
  /** @type {Record<string, Instrument>} */
  const set = {
    piano: createSampler(ctx, output, piano, samplerSettingsFor(samplerRecipe, piano.id), { tier, pedalNoise: pedal }),
    'fm-piano': synth.createFmPiano(ctx, output, synthRecipe, { tier }),
  };
  // The pad and bell join as soon as synth.js has them (namespace import, so a missing one is skipped).
  const s = /** @type {any} */ (synth);
  if (typeof s.createPad === 'function' && synthRecipe.pad) set.pad = s.createPad(ctx, output, synthRecipe, { tier });
  if (typeof s.createBell === 'function' && synthRecipe.bell) set.bell = s.createBell(ctx, output, synthRecipe, { tier });

  // The sampled support kit, by roster name. A recipe that is not there yet is skipped.
  const roster = await loadAudioRecipe('music/roster').catch(() => null);
  const recipeOf = (/** @type {string} */ id) => loadAudioRecipe(`music/instruments/${id}`).catch(() => null);
  if (roster) {
    await Promise.all(Object.entries(roster.sampled ?? {}).map(async ([name, e]) => {
      const rec = await recipeOf(/** @type {any} */ (e).recipe);
      if (!rec) return;
      const id = /** @type {any} */ (e).settings ?? rec.id;
      set[name] = createSampler(ctx, output, rec, samplerSettingsFor(samplerRecipe, id), { tier, articulation: /** @type {any} */ (e).articulation });
    }));
    await Promise.all(Object.entries(roster.sections ?? {}).map(async ([name, e]) => {
      const parts = (await Promise.all(/** @type {any} */ (e).parts.map(async (/** @type {any} */ p) => {
        const rec = await recipeOf(p.recipe);
        return rec ? { sampler: createSampler(ctx, output, rec, samplerSettingsFor(samplerRecipe, p.settings ?? rec.id), { tier }), below: p.below ?? 128 } : null;
      }))).filter(Boolean);
      if (parts.length) set[name] = createEnsemble(/** @type {any} */ (parts));
    }));
  }

  return {
    set,
    /** Palette names that exist right now. */
    available: () => Object.keys(set),
    /**
     * Unpack what a performance needs. Resolves when every note it uses is ready.
     * @param {{ranges: Record<string, {low: number, high: number}>, notes: any[], pedal: any[]}} perf a performance from realize.js
     */
    async prepare(perf) {
      await Promise.all(Object.entries(perf.ranges).map(async ([name, r]) => {
        const inst = /** @type {any} */ (set[name]);
        if (!inst) return;
        if (!inst.filesFor) return inst.load({ low: r.low, high: r.high });
        // Exactly the recordings this performance will sound: each note's nearest zone, the layers
        // its velocity reaches, the set the pedal picks at that moment, and its key-off sound.
        const pedal = perf.pedal.filter((/** @type {any} */ e) => e.instrument === name);
        const down = (/** @type {number} */ t) => { let d = false; for (const e of pedal) { if (e.t <= t) d = e.down; else break; } return d; };
        /** @type {Set<string>} */
        const files = new Set();
        for (const n of perf.notes) if (n.instrument === name) for (const f of inst.filesFor(n.midi, n.vel, down(n.t))) files.add(f);
        await inst.loadFiles([...files]);
      }));
    },
    /**
     * After a piece: free the least recently sounded notes beyond the memory budget, keeping the
     * ranges of whatever plays next.
     * @param {Record<string, {low: number, high: number}>} [keep]
     */
    trim(keep = {}) {
      // One budget for all the music: each instrument may keep its share of it, by what it holds now.
      const held = Object.fromEntries(Object.entries(set).map(([k, i]) => [k, i.stats().decodedMB ?? 0]));
      const total = Object.values(held).reduce((a, b) => a + b, 0);
      if (total <= budgetMB) return;
      for (const [name, inst] of Object.entries(set)) inst.trim?.(budgetMB * (held[name] / total), keep[name] ? [keep[name]] : []);
    },
    stopAll(/** @type {number} */ fadeS = 0.3) { for (const i of Object.values(set)) i.stopAll(fadeS); },
    stats() {
      return Object.fromEntries(Object.entries(set).map(([k, i]) => [k, i.stats()]));
    },
  };
}
