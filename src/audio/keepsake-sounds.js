// @ts-check
// The keepsake and net sounds (docs/future/12): short recorded takes, played on the tools bus when a
// keepsake is picked up, kept, left to the sea or its letter read, and (for the nets) when a net is
// set, lifted, or a catch flops and slips away. The files are small; the common ones load as the
// sound starts, the rest on first use. Levels and files are in recipes/audio/keepsakes.json.
//
//   keepsake:sound { name, seed? } ──→ buffer (.ogg or .m4a) ──→ gain (db) ──→ tools bus

import { pickFormat } from './music/sampler.js';
import { REPO_ROOT } from './recipes.js';
import { hash32 } from '../core/rng.js';

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {any} recipe  recipes/audio/keepsakes.json
 * @param {{ format?: 'ogg'|'m4a' }} [opts]
 */
export function createKeepsakeSounds(mixer, recipe, opts = {}) {
  const ctx = mixer.ctx;
  const format = opts.format ?? pickFormat();
  /** @type {Map<string, Promise<AudioBuffer|null>>} */
  const buffers = new Map();
  /** @type {Map<string, number>} */
  const turns = new Map();

  /** @param {string} file */
  function load(file) {
    let p = buffers.get(file);
    if (!p) {
      p = fetch(new URL(`${recipe.root}${file}.${format}`, REPO_ROOT).href)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((b) => ctx.decodeAudioData(b))
        .catch((e) => { console.warn(`ebb audio: the keepsake sound "${file}" did not load`, e); return null; });
      buffers.set(file, p);
    }
    return p;
  }

  /** The files a sound can play. @param {string} name @returns {string[]} */
  const filesOf = (name) => {
    const s = recipe.sounds[name];
    return s ? (s.files ?? [s.file]) : [];
  };

  for (const name of recipe.preload ?? []) for (const f of filesOf(name)) load(f);

  /**
   * Play one sound. A sound with several takes picks one from the seed, or takes turns without one.
   * @param {string} name
   * @param {number} [seed]
   */
  async function play(name, seed) {
    const s = recipe.sounds[name];
    const files = filesOf(name);
    if (!s || !files.length) return;
    // The page's first tap both wakes the sound and picks a keepsake up: wait a moment for it.
    if (ctx.state !== 'running') {
      await new Promise((r) => { ctx.addEventListener('statechange', r, { once: true }); setTimeout(r, recipe.wakeWaitMs ?? 400); });
      if (ctx.state !== 'running') return;
    }
    const turn = turns.get(name) ?? 0;
    turns.set(name, turn + 1);
    const n = seed ?? turn;
    const h = hash32(n, 0x6b73);
    const buf = await load(files[(seed === undefined ? n : h) % files.length]);
    if (!buf || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // A take's own pitch (cents, the deeper clay a borrowed clay take set lower) and the recipe's wobble.
    src.detune.value = (s.cents ?? 0) + (((h >>> 8) & 0xffff) / 0xffff * 2 - 1) * (recipe.pitchCents ?? 0);
    const g = ctx.createGain();
    g.gain.value = 10 ** ((s.db ?? 0) / 20);
    // The tools bus, unless the recipe names another (the first evening's far curlew is a creature).
    src.connect(g).connect(mixer.input(recipe.bus ?? 'tools'));
    src.onended = () => g.disconnect();
    src.start();
  }

  return { play, load };
}
