// @ts-check
// Shared by the music lab's Piece and Themes tabs: loading the music recipes, the instruments and
// performer (made once, on the first play, and shared by both tabs so a phone unpacks the piano
// only once), and playing a performance with the piano roll's playhead and the notation following
// along, with "Finish gently" (to the end of the section, then the coda) and Stop. Starting a new
// performance in either tab stops the one playing.

import { realize } from '../../src/audio/music/realize.js';
import { createPerformer } from '../../src/audio/music/perform.js';
import { createInstruments } from '../../src/audio/music/instruments.js';
import { dayKeyName } from '../../src/audio/music/daycolor.js';

/** Instruments the realizer may use before the real set has been made (the set's usual names). */
export const DEFAULT_AVAILABLE = ['piano', 'pad', 'bell', 'fm-piano'];

const KEY_LABEL = { night: 'night', blueHour: 'blue hour', golden: 'golden hour', morning: 'morning or afternoon', day: 'midday' };

/** Fetch a JSON file by its path from the repo root. @param {string} p */
export async function loadJson(p) {
  return (await fetch(new URL(`../../${p}`, import.meta.url), { cache: 'no-cache' })).json();
}

/** The director (for the day colour) and the realizer's recipes. */
export async function loadMusicRecipes() {
  const [director, rz, vo] = await Promise.all([
    loadJson('recipes/music/director.json'), loadJson('recipes/music/realize.json'), loadJson('recipes/music/voicing.json'),
  ]);
  return { director, recipes: { realize: rz, voicing: vo } };
}

/** "15 degrees, morning or afternoon". @param {number} sun @param {any} director */
export function sunLabel(sun, director) {
  return `${sun} degrees, ${KEY_LABEL[/** @type {'day'} */ (dayKeyName(sun, director.dayColor))]}`;
}

/** The score tick sounding at a time, from the performance's tick-to-time samples. @param {any} p @param {number} t */
export function tickAt(p, t) {
  const tt = p.tickTimes;
  if (!tt.length || t < 0) return null;
  for (let i = 1; i < tt.length; i++) {
    if (tt[i][1] >= t) {
      const [k0, t0] = tt[i - 1], [k1, t1] = tt[i];
      return k0 + ((k1 - k0) * (t - t0)) / Math.max(1e-6, t1 - t0);
    }
  }
  return tt[tt.length - 1][0];
}

/** @typedef {{inst: any, performer: any}} Engine */
/** @type {Promise<Engine> | null} */
let enginePromise = null;
/** @type {Engine | null} */
let engine = null;
/** Counts play requests across both tabs; a play whose unpacking ends after a newer request is dropped. */
let latest = 0;

/**
 * A tab's player: its piano roll and notation follow whatever it plays.
 * @param {{mixer: any}} env
 * @param {{realize: any, voicing: any}} recipes
 * @param {{roll: {setPlayhead: (s: number|null) => void}, notation: {highlight: (tick: number|null) => void}, status: (text: string) => void}} ui
 */
export function createStage(env, recipes, ui) {
  let raf = 0;

  async function ensure() {
    if (engine) return engine;
    if (!enginePromise) {
      ui.status('Getting the instruments ready.');
      enginePromise = createInstruments(env.mixer.ctx, env.mixer.input('music')).then((inst) => {
        engine = { inst, performer: createPerformer(env.mixer.ctx, inst.set) };
        return engine;
      });
    }
    return enginePromise;
  }

  return {
    /** Palette names that exist (the usual set until the instruments are made). */
    available: () => (engine ? engine.inst.available() : DEFAULT_AVAILABLE),
    /**
     * Get ready to play: sound unlocked, instruments made, whatever is playing stopped.
     * @returns {Promise<number>} a ticket for play()
     */
    async begin() {
      const ticket = ++latest;
      await env.mixer.unlock();
      const e = await ensure();
      e.performer.stop(0.2);
      return ticket;
    },
    /**
     * Unpack and play a performance; resolves when it ends (finished, stopped or replaced).
     * @param {number} ticket from begin()
     * @param {any} piece the piece it was realized from (for the coda)
     * @param {any} p the performance
     * @param {{seed: number, dayColor: Record<string, number>, label: string}} o label as in "Playing <label>."
     * @returns {Promise<void>}
     */
    async play(ticket, piece, p, o) {
      const { inst, performer } = /** @type {Engine} */ (engine);
      env.mixer.setMusicTone({ lowpassHz: o.dayColor.brightHz, wet: o.dayColor.wet }, 0.5);
      ui.status('Unpacking the notes this performance uses.');
      const t0 = performance.now();
      await inst.prepare(p);
      if (ticket !== latest) return; // a newer play was asked for while this one unpacked
      const mem = Object.values(inst.stats()).reduce((n, x) => n + (/** @type {any} */ (x).decodedMB ?? 0), 0);
      ui.status(`Playing ${o.label}. Unpacked in ${((performance.now() - t0) / 1000).toFixed(1)} s; ${mem.toFixed(0)} MB in memory.`);
      return new Promise((done) => {
        // For "Finish gently": the coda alone, at this seed's tempo, to follow the current section.
        const coda = piece.sections.coda ? realize(piece, { seed: o.seed, dayColor: o.dayColor, available: inst.available(), key: p.key, path: ['coda'] }, recipes) : null;
        performer.play(p, {
          coda,
          onTime: () => {},
          onEnd: () => { cancelAnimationFrame(raf); ui.roll.setPlayhead(-1); ui.notation.highlight(null); ui.status(`Finished ${o.label}.`); inst.trim(); done(); },
        });
        // The performance starts a moment ahead (its position is below zero until then), so follow
        // for as long as it plays rather than stopping at the first negative position.
        const follow = () => {
          if (!performer.playing) return;
          const pos = performer.position();
          if (pos >= 0) {
            ui.roll.setPlayhead(pos);
            ui.notation.highlight(tickAt(p, pos));
          }
          raf = requestAnimationFrame(follow);
        };
        raf = requestAnimationFrame(follow);
      });
    },
    /** Stop at once, with a short fade. @param {number} [fadeS] */
    stop(fadeS = 0.3) { latest++; engine?.performer.stop(fadeS); },
    /** Finish gracefully. @returns {number|undefined} seconds until the music has finished, if playing */
    finish() { return engine?.performer.finish(); },
  };
}
