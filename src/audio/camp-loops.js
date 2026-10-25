// @ts-check
// The camp's two held sounds (doc 17 "The first evening and the camp"; docs/future/13 C-27, C-33):
// the fire's crackle, placed at the ring while it burns (fainter and duller as embers), and rain
// drumming on the tent canvas, heard around you within a few meters of the tent. Both are CC0
// loops in assets/audio/beds/ (fire/, canvas/), loaded the first time they are wanted. The camp
// publishes where things are and how the fire is in the store slice `campSound`
// (src/world/camp); the rain and the camera come from the sound slice. Numbers:
// recipes/audio/camp.json `loops`.
//
//   campSound.ring + fire ──→ crackle loop ──→ lowpass (embers) ──→ level ──→ placed chain ─┐
//   campSound.tent + rain ──→ canvas loop (take a or b) ──────────────────→ level ─────────┴→ ambience bus

import { pickFormat } from './music/sampler.js';
import { REPO_ROOT } from './recipes.js';
import { placedChain } from './spatial.js';
import { dbToGain, clamp01 } from './ambience/curves.js';

/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
/** @param {number[]} p @param {number[]} q */
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * How loud the fire's crackle is (0..1 before its db), from the fire and the eye's distance. Pure.
 * @param {{ fire: string, level: number, rainy: boolean } } c  campSound
 * @param {number} eyeM  the camera eye's distance from the ring (m)
 * @param {any} L  camp.json loops.fire
 */
export function fireLevel(c, eyeM, L) {
  const by = c.fire === 'lit' ? L.lowShare + (1 - L.lowShare) * clamp01(c.level) : c.fire === 'embers' ? dbToGain(L.embersDb) : 0;
  if (!by) return 0;
  const near = L.refM / Math.max(L.refM, eyeM);
  return by * near * (1 - smooth(L.fadeFromM, L.reachM, eyeM)) * (c.rainy && c.fire === 'lit' ? dbToGain(L.rainDb) : 1);
}

/**
 * How loud the rain on the canvas is (0..1 before its db). Pure.
 * @param {number} rain  0..1 falling now
 * @param {number} youM  the camera target's (you, below) distance from the tent, on the ground (m)
 * @param {number} eyeM  the camera eye's distance from the tent (m): from above it fades away
 * @param {any} L  camp.json loops.canvas
 */
export function canvasLevel(rain, youM, eyeM, L) {
  return smooth(L.rainFrom, L.rainFull, rain) * (1 - smooth(L.nearM, L.reachM, youM)) * (1 - smooth(L.eyeFadeFromM, L.eyeReachM, eyeM));
}

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {any} recipe  recipes/audio/camp.json
 * @param {number} seed  picks the canvas take for this session
 * @param {{ format?: 'ogg'|'m4a' }} [opts]
 */
export function createCampLoops(mixer, recipe, seed, opts = {}) {
  const ctx = mixer.ctx, L = recipe.loops;
  const format = opts.format ?? pickFormat();
  const bus = mixer.input(L.bus ?? 'ambience');

  /** @param {string} file @returns {Promise<AudioBuffer|null>} */
  const load = (file) => fetch(new URL(`${L.root}${file}.${format}`, REPO_ROOT).href)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
    .then((b) => ctx.decodeAudioData(b))
    .catch((e) => { console.warn(`ebb audio: the camp loop "${file}" did not load`, e); return null; });

  /**
   * One held loop: silent until first wanted, then loaded and started at a seeded spot.
   * @param {string} file @param {AudioNode} into
   */
  function held(file, into) {
    const level = ctx.createGain();
    level.gain.value = 0;
    level.connect(into);
    /** @type {AudioBufferSourceNode | null} */ let src = null;
    let asked = false;
    return {
      level,
      /** @param {number} g @param {number} rampS */
      set(g, rampS) {
        if (g > 1e-4 && !asked) {
          asked = true;
          load(file).then((buf) => {
            if (!buf || disposed) return;
            src = ctx.createBufferSource();
            src.buffer = buf; src.loop = true;
            src.connect(level);
            src.start(ctx.currentTime, ((seed >>> 0) % 997) / 997 * buf.duration);
          });
        }
        level.gain.setTargetAtTime(g, ctx.currentTime, rampS / 3);
      },
      dispose() { try { src?.stop(); } catch { /* not started */ } level.disconnect(); },
    };
  }

  let disposed = false;
  const F = L.fire, C = L.canvas;
  const chain = placedChain(ctx, bus, { refDistance: F.refM, rolloff: 0, air: F.air });
  const dull = ctx.createBiquadFilter();
  dull.type = 'lowpass'; dull.Q.value = 0.5; dull.frequency.value = F.litHz;
  dull.connect(chain.input);
  const fire = held(F.file, dull);
  const canvas = held(C.files[(seed >>> 0) % C.files.length], bus);

  return {
    /**
     * Each sound tick. @param {any} s the sound slice @param {any} camp the campSound slice (or null)
     */
    update(s, camp) {
      if (disposed || !s) return;
      const eye = s.eye, you = s.target;
      if (camp?.ring) {
        chain.place(camp.ring, { eye, forward: [0, 0, -1] });
        dull.frequency.setTargetAtTime(camp.fire === 'embers' ? F.embersHz : F.litHz, ctx.currentTime, F.rampS / 3);
        fire.set(dbToGain(F.db) * fireLevel(camp, dist(camp.ring, eye), F), F.rampS);
      } else fire.set(0, F.rampS);
      if (camp?.tent) {
        const t = camp.tent, youM = Math.hypot(you[0] - t[0], you[2] - t[2]);
        canvas.set(dbToGain(C.db) * canvasLevel(s.weather?.rain ?? 0, youM, dist(t, eye), C), C.rampS);
      } else canvas.set(0, C.rampS);
    },
    dispose() { disposed = true; fire.dispose(); canvas.dispose(); chain.dispose(); dull.disconnect(); },
  };
}
