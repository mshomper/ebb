// @ts-check
// The game's sound (doc 17, doc 25): the one place the game starts audio. Waits for the game's
// first `sound` slice (so nothing loads before the first picture), then builds the mixer, which
// stays silent until the first touch or key, and the island's ambience. About ten times a second it
// reads the `sound` slice the frame loop publishes, turns it into a sound state
// (src/audio/game-state.js) and updates the ambience and the listener. Volumes follow the
// player's settings, where full on each slider is the level tuned in recipes/audio/mixer.json.
// Only the game calls this; the tool pages that start the app stay silent.
//
//   frame loop ── store 'sound' ──→ game-state ──→ ambience ──→ mixer ──→ speakers
//   store 'settings'.audio ───────────────────────────────────→ mixer levels

import { loadAudioRecipe } from './recipes.js';
import { loadRecipe } from '../core/recipes.js';
import { createMixer } from './mixer.js';
import { createAmbience } from './ambience.js';
import { createSoundState } from './game-state.js';
import { sunMoon } from '../world/sky/sun-moon.js';

const DEG = 180 / Math.PI;

/**
 * @param {{ get: (slice: string) => any, subscribe: (slice: string, fn: (v: any) => void) => () => void }} store
 * @returns {Promise<{ mixer: () => import('./mixer.js').Mixer | null, ambience: () => any, dispose: () => void }>}
 */
export async function startAudio(store) {
  const [mixerRecipe, ambRecipe, procRecipe, gameRecipe, skyRecipe] = await Promise.all([
    loadAudioRecipe('audio/mixer'), loadAudioRecipe('audio/ambience'), loadAudioRecipe('audio/procedural'),
    loadAudioRecipe('audio/game'), loadRecipe('world/sky'),
  ]);
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < gameRecipe.mobile.phoneMaxSidePx;
  const tier = phone ? 'mobile' : 'desktop';

  /** @type {import('./mixer.js').Mixer | null} */ let mixer = null;
  /** @type {ReturnType<typeof createAmbience> | null} */ let ambience = null;
  /** @type {ReturnType<typeof createSoundState> | null} */ let soundState = null;
  /** @type {ReturnType<typeof setInterval> | 0} */ let timer = 0;
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
    if (!s || !ambience || !soundState || !mixer) return;
    const now = performance.now();
    const dtS = last ? Math.min(1, (now - last) / 1000) : 1 / gameRecipe.updateHz;
    last = now;
    const state = soundState.build(s, dtS);
    mixer.setListener(/** @type {number[]} */ (state.eye), /** @type {number[]} */ (state.forward), [0, 1, 0]);
    ambience.update(state);
  }

  /** Build the sound once the game has drawn and published its first sound slice. */
  function begin() {
    if (mixer || disposed) return;
    const seed = store.get('meta')?.seed ?? 1;
    mixer = createMixer(mixerRecipe, { tier });
    ambience = createAmbience(mixer, ambRecipe, procRecipe, seed, { tier });
    soundState = createSoundState(gameRecipe, seed, (t) => sunMoon(t, skyRecipe.orbit).sunAlt * DEG, ambRecipe.seasonEdge);
    applySettings();
    unsubs.push(store.subscribe('settings', applySettings));
    tick();
    timer = setInterval(() => {
      try { tick(); } catch (e) { console.error('ebb audio: the sound update failed', e); }
    }, 1000 / gameRecipe.updateHz);
  }

  if (store.get('sound')) begin();
  else {
    const un = store.subscribe('sound', () => { un(); begin(); });
    unsubs.push(un);
  }

  return {
    mixer: () => mixer,
    ambience: () => ambience,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      for (const u of unsubs) u();
      ambience?.dispose();
      mixer?.dispose();
    },
  };
}
