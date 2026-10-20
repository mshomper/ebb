// @ts-check
// The game's sound (doc 17, doc 25): the one place the game starts audio. Waits for the game's
// first `sound` slice (so nothing loads before the first picture), then builds the mixer, which
// stays silent until the first touch or key, the island's ambience and the animals' voices. About
// ten times a second it reads the `sound` slice the frame loop publishes, turns it into a sound
// state (src/audio/game-state.js) and updates the ambience, the listener and the midges; a few
// dozen times a second it plays the frogs' new calls and plops (src/audio/creatures-game.js).
// Volumes follow the player's settings, where full on each slider is the level tuned in
// recipes/audio/mixer.json. Only the game calls this; the tool pages that start the app stay silent.
//
//   frame loop ── store 'sound' ──→ game-state ──→ ambience ──→ mixer ──→ speakers
//   frog agents, midges ── store 'creatureSound' ──→ voices ──┘
//   store 'settings'.audio ───────────────────────────────────→ mixer levels

import { loadAudioRecipe } from './recipes.js';
import { loadRecipe } from '../core/recipes.js';
import { createMixer } from './mixer.js';
import { createAmbience } from './ambience.js';
import { createSoundState } from './game-state.js';
import { createVoices } from './voices.js';
import { createCreatureSound } from './creatures-game.js';
import { sunMoon } from '../world/sky/sun-moon.js';

const DEG = 180 / Math.PI;

// A tap or key while the island is still loading counts as the first touch: the sound unlocks as
// soon as it is built (the browser remembers the page was touched; iOS may still want one more).
let touched = false;
if (typeof window !== 'undefined') {
  const onTouch = () => { touched = true; };
  window.addEventListener('pointerdown', onTouch, { capture: true, once: true });
  window.addEventListener('keydown', onTouch, { capture: true, once: true });
}

/**
 * @param {{ get: (slice: string) => any, subscribe: (slice: string, fn: (v: any) => void) => () => void }} store
 * @returns {Promise<{ mixer: () => import('./mixer.js').Mixer | null, ambience: () => any, voices: () => any, dispose: () => void }>}
 */
export async function startAudio(store) {
  const [mixerRecipe, ambRecipe, procRecipe, gameRecipe, skyRecipe, frogRecipe, midgeRecipe] = await Promise.all([
    loadAudioRecipe('audio/mixer'), loadAudioRecipe('audio/ambience'), loadAudioRecipe('audio/procedural'),
    loadAudioRecipe('audio/game'), loadRecipe('world/sky'), loadRecipe('species/frog'), loadRecipe('species/midge'),
  ]);
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < gameRecipe.mobile.phoneMaxSidePx;
  const tier = phone ? 'mobile' : 'desktop';

  /** @type {import('./mixer.js').Mixer | null} */ let mixer = null;
  /** @type {ReturnType<typeof createAmbience> | null} */ let ambience = null;
  /** @type {ReturnType<typeof createSoundState> | null} */ let soundState = null;
  /** @type {ReturnType<typeof createVoices> | null} */ let voices = null;
  /** @type {ReturnType<typeof createCreatureSound> | null} */ let animals = null;
  /** @type {ReturnType<typeof setInterval> | 0} */ let timer = 0;
  /** @type {ReturnType<typeof setInterval> | 0} */ let callTimer = 0;
  let last = 0;
  let disposed = false;
  /** @type {(() => void)[]} */ const unsubs = [];

  /** Volumes from the settings: each slider scales its bus's tuned level. */
  function applySettings() {
    if (!mixer) return;
    const a = store.get('settings')?.audio ?? {};
    const lv = (/** @type {number | undefined} */ v) => Math.max(0, Math.min(1, v ?? 1));
    mixer.setBusLevel('master', mixerRecipe.master.level * lv(a.master));
    mixer.setBusLevel('ambience', mixerRecipe.buses.ambience * lv(a.ambience));
    mixer.setBusLevel('creatures', mixerRecipe.buses.creatures * lv(a.creatures));
    mixer.setBusLevel('tools', mixerRecipe.buses.tools * lv(a.tools));
    mixer.setBusLevel('ui', mixerRecipe.buses.ui * lv(a.ui));
    mixer.setBackgroundMute(a.muteInBackground !== false);
  }

  function tick() {
    const s = store.get('sound');
    if (!s || !ambience || !soundState || !mixer || !animals) return;
    const now = performance.now();
    const dtS = last ? Math.min(1, (now - last) / 1000) : 1 / gameRecipe.updateHz;
    last = now;
    const state = soundState.build(s, dtS);
    ambience.update(state);
    animals.update(/** @type {number[]} */ (state.eye), /** @type {number[]} */ (state.forward), ambience.blend());
  }

  /** Build the sound once the game has drawn and published its first sound slice. */
  function begin() {
    if (mixer || disposed) return;
    const seed = store.get('meta')?.seed ?? 1;
    mixer = createMixer(mixerRecipe, { tier });
    ambience = createAmbience(mixer, ambRecipe, procRecipe, seed, { tier });
    voices = createVoices(mixer, { frog: frogRecipe.voice, midge: midgeRecipe.voice, proc: procRecipe, plop: gameRecipe.frogs.plop }, seed, { tier });
    animals = createCreatureSound(mixer, voices, store, gameRecipe.frogs);
    soundState = createSoundState(gameRecipe, seed, (t) => sunMoon(t, skyRecipe.orbit).sunAlt * DEG, ambRecipe.seasonEdge);
    applySettings();
    unsubs.push(store.subscribe('settings', applySettings));
    if (touched) mixer.unlock().catch(() => { /* the next touch unlocks it */ });
    tick();
    timer = setInterval(() => {
      try { tick(); } catch (e) { console.error('ebb audio: the sound update failed', e); }
    }, 1000 / gameRecipe.updateHz);
    callTimer = setInterval(() => {
      try { animals?.poll(); } catch (e) { console.error('ebb audio: the frog calls failed', e); }
    }, gameRecipe.frogs.pollS * 1000);
  }

  if (store.get('sound')) begin();
  else {
    const un = store.subscribe('sound', () => { un(); begin(); });
    unsubs.push(un);
  }

  return {
    mixer: () => mixer,
    ambience: () => ambience,
    voices: () => voices,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      if (callTimer) clearInterval(callTimer);
      for (const u of unsubs) u();
      voices?.dispose();
      ambience?.dispose();
      mixer?.dispose();
    },
  };
}
