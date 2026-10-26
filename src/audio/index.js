// @ts-check
// The game's sound (doc 17, doc 25): the one place the game starts audio. Waits for the game's
// first `sound` slice (so nothing loads before the first picture), then builds the mixer, which
// stays silent until the first touch or key, the island's ambience and the animals' voices. About
// ten times a second it reads the `sound` slice the frame loop publishes, turns it into a sound
// state (src/audio/game-state.js) and updates the ambience, the listener and the midges; a few
// dozen times a second it plays the frogs' new calls and plops (src/audio/creatures-game.js); twice
// a second the music (src/audio/music/index.js) decides, and dips while a frog calls close by.
// Volumes follow the player's settings, where full on each slider is the level tuned in
// recipes/audio/mixer.json. Only the game calls this; the tool pages that start the app stay silent.
//
//   frame loop ── store 'sound' ──→ game-state ──→ ambience ──→ mixer ──→ speakers
//   frog agents, midges, minnows, dragonflies ── store 'creatureSound' ──→ voices ──┤
//   director ─→ composer or a tide ─→ performer ─→ music bus ─┤
//   keepsake taps, keepsake:sound ─→ keepsake sounds ─→ tools bus ─┤
//   store 'campSound' + 'sound' ─→ camp loops (fire crackle, rain on canvas) ─→ ambience bus ─┘
//   store 'settings'.audio ───────────────────────────────────→ mixer levels

import { loadAudioRecipe } from './recipes.js';
import { loadRecipe } from '../core/recipes.js';
import { createMixer } from './mixer.js';
import { createAmbience } from './ambience.js';
import { createSoundState } from './game-state.js';
import { createVoices } from './voices.js';
import { createCreatureSound } from './creatures-game.js';
import { wingRecipe } from './voices/dragonfly.js';
import { createMusic } from './music/index.js';
import { createKeepsakeSounds } from './keepsake-sounds.js';
import { createCampLoops } from './camp-loops.js';
import { hash32 } from '../core/rng.js';
import { emit, on } from '../core/events.js';
import { sunMoon } from '../world/sky/sun-moon.js';

const DEG = 180 / Math.PI;

/** This device's music sessions so far, counted up once per load (so each visit plays differently). */
function sessionCount() {
  try {
    const n = (Number.parseInt(localStorage.getItem('ebb.music.sessions') ?? '0', 10) || 0) + 1;
    localStorage.setItem('ebb.music.sessions', String(n));
    return n;
  } catch { return 1; }
}

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
 * @returns {Promise<{ mixer: () => import('./mixer.js').Mixer | null, ambience: () => any, voices: () => any, music: () => any, dispose: () => void }>}
 */
export async function startAudio(store) {
  const [mixerRecipe, ambRecipe, procRecipe, gameRecipe, skyRecipe, frogRecipe, midgeRecipe, dragonflyRecipe, minnowRecipe, keepsakeRecipe, introRecipe, campRecipe, gatherRecipe, digRecipe] = await Promise.all([
    loadAudioRecipe('audio/mixer'), loadAudioRecipe('audio/ambience'), loadAudioRecipe('audio/procedural'),
    loadAudioRecipe('audio/game'), loadRecipe('world/sky'), loadRecipe('species/frog'), loadRecipe('species/midge'),
    loadRecipe('species/dragonfly'), loadRecipe('species/minnow'), loadAudioRecipe('audio/keepsakes'), loadAudioRecipe('audio/intro'),
    loadAudioRecipe('audio/camp'), loadAudioRecipe('audio/gather'), loadAudioRecipe('audio/dig'),
  ]);

  /** @type {import('./mixer.js').Mixer | null} */ let mixer = null;
  /** @type {ReturnType<typeof createAmbience> | null} */ let ambience = null;
  /** @type {ReturnType<typeof createSoundState> | null} */ let soundState = null;
  /** @type {ReturnType<typeof createVoices> | null} */ let voices = null;
  /** @type {ReturnType<typeof createCreatureSound> | null} */ let animals = null;
  /** @type {ReturnType<typeof setInterval> | 0} */ let timer = 0;
  /** @type {ReturnType<typeof setInterval> | 0} */ let callTimer = 0;
  /** @type {Awaited<ReturnType<typeof createMusic>> | null} */ let music = null;
  /** @type {ReturnType<typeof createKeepsakeSounds> | null} */ let keepsakeSounds = null;
  /** The camp fire's one-shots (recipes/audio/camp.json): the strike, the catch, rain's hiss. @type {ReturnType<typeof createKeepsakeSounds> | null} */ let campSounds = null;
  /** The camp's held sounds: the fire's crackle, rain on the canvas. @type {ReturnType<typeof createCampLoops> | null} */ let campLoops = null;
  /** Gathering's soft sounds by group (recipes/audio/gather.json). @type {ReturnType<typeof createKeepsakeSounds> | null} */ let gatherSounds = null;
  /** The spade's sounds by layer (recipes/audio/dig.json). @type {ReturnType<typeof createKeepsakeSounds> | null} */ let digSounds = null;
  const t0 = performance.now();
  const asked = new URLSearchParams(location.search).get('music');
  let testNow = asked === 'now' ? 'morning' : ['morning', 'interlude', 'evening', 'nocturne'].includes(asked ?? '') ? /** @type {string} */ (asked) : '';
  let ticks = 0;
  let last = 0;
  let disposed = false;
  /** @type {(() => void)[]} */ const unsubs = [];

  /** While a full reveal plays, the island's buses follow it (revealSound) rather than the settings. */
  let revealHold = false;

  /** Volumes from the settings: each slider scales its bus's tuned level. @param {number} [rampS] */
  function applySettings(rampS = 0.3) {
    if (!mixer) return;
    const a = store.get('settings')?.audio ?? {};
    const lv = (/** @type {number | undefined} */ v) => Math.max(0, Math.min(1, v ?? 1));
    mixer.setBusLevel('master', mixerRecipe.master.level * lv(a.master));
    if (!revealHold) {
      mixer.setBusLevel('ambience', mixerRecipe.buses.ambience * lv(a.ambience), rampS);
      mixer.setBusLevel('creatures', mixerRecipe.buses.creatures * lv(a.creatures), rampS);
    }
    mixer.setBusLevel('tools', mixerRecipe.buses.tools * lv(a.tools));
    mixer.setBusLevel('ui', mixerRecipe.buses.ui * lv(a.ui));
    mixer.setBusLevel('music', mixerRecipe.buses.musicDefault * lv(a.music));
    mixer.setBackgroundMute(a.muteInBackground !== false);
    music?.setFrequency(a.musicOften ?? 'now-and-then');
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
    campLoops?.update(s, store.get('campSound'));
    // The music decides twice a second (doc 24), and dips while a frog calls close by.
    if (music && ticks++ % Math.max(1, Math.round(gameRecipe.updateHz / gameRecipe.music.updateHz)) === 0) {
      mixer.duckMusic(animals.nearCall() ? mixerRecipe.duck.db : 0);
      // `?music=now` (testing): the composer grows and plays a piece right after the first touch.
      if (testNow && mixer.ctx.state === 'running' && music.playNow({ slot: testNow })) testNow = '';
      music.update({
        realS: (now - t0) / 1000, gameT: s.displayT, sunAltDeg: s.sunAltDeg, weather: state.weather,
        frogsAwake: !!s.frogsAwake, frogsCalling: !!s.frogsCalling, residents: s.residents ?? [],
        previewing: Math.abs(s.displayT - s.worldT) > 60,
        flow: store.get('meta')?.flow ?? 1,
        freshIsland: !!s.freshIsland,
      });
    }
  }

  /** Build the sound once the game has drawn and published its first sound slice. */
  function begin() {
    if (mixer || disposed) return;
    const seed = store.get('meta')?.seed ?? 1;
    mixer = createMixer(mixerRecipe);
    ambience = createAmbience(mixer, ambRecipe, procRecipe, seed);
    voices = createVoices(mixer, { frog: frogRecipe.voice, midge: midgeRecipe.voice, proc: procRecipe, plop: gameRecipe.frogs.plop,
      dragonfly: wingRecipe(dragonflyRecipe), minnow: minnowRecipe.voice }, seed);
    animals = createCreatureSound(mixer, voices, store, gameRecipe.frogs, gameRecipe.pond);
    soundState = createSoundState(gameRecipe, seed, (t) => sunMoon(t, skyRecipe.orbit).sunAlt * DEG, ambRecipe.seasonEdge);
    keepsakeSounds = createKeepsakeSounds(mixer, keepsakeRecipe);
    campSounds = createKeepsakeSounds(mixer, campRecipe);
    campLoops = createCampLoops(mixer, campRecipe, hash32(seed >>> 0, 0x6370));
    gatherSounds = createKeepsakeSounds(mixer, gatherRecipe);
    digSounds = createKeepsakeSounds(mixer, digRecipe);
    applySettings();
    unsubs.push(store.subscribe('settings', () => applySettings()));
    if (touched) mixer.unlock().catch(() => { /* the next touch unlocks it */ });
    tick();
    timer = setInterval(() => {
      try { tick(); } catch (e) { console.error('ebb audio: the sound update failed', e); }
    }, 1000 / gameRecipe.updateHz);
    callTimer = setInterval(() => {
      try { animals?.poll(); } catch (e) { console.error('ebb audio: the frog calls failed', e); }
    }, gameRecipe.frogs.pollS * 1000);
    // The music: its own seed, from the world and this device's session count (doc 24, Algorithms).
    createMusic(mixer, { emit, seed: hash32(seed >>> 0, sessionCount(), 0x6d75), sunAltDeg: (t) => sunMoon(t, skyRecipe.orbit).sunAlt * DEG })
      .then((m) => {
        if (disposed) { m.dispose(); return; }
        music = m;
        applySettings();
        m.setHearted(store.get('music')?.hearted ?? []);
        m.setPassed(store.get('music')?.passed ?? []);
        unsubs.push(store.subscribe('music', (v) => { m.setHearted(v?.hearted ?? []); m.setPassed(v?.passed ?? []); }));
        if (revealing) m.revealStarted({ full: revealFull });
      })
      .catch((e) => console.warn('ebb music: the music did not start', e));
  }

  // The return reveal (doc 17, doc 25 "The reveal"; recipes/audio/game.json reveal): for a full reveal
  // the wind and the water lap rise first, the creatures as the animals come back, the rest as it
  // ends; the music plays the home tide (src/audio/music/index.js). A short return just fades in.
  let revealing = false, revealFull = false;
  /** @type {ReturnType<typeof setTimeout>[]} */ let revealTimers = [];
  unsubs.push(on('reveal:started', (/** @type {{ hours?: number }} */ p) => {
    revealing = true;
    revealFull = (p?.hours ?? 0) >= gameRecipe.reveal.fullFromH;
    music?.revealStarted({ full: revealFull });
    if (!revealFull || !mixer) return;
    const R = gameRecipe.reveal, a = store.get('settings')?.audio ?? {};
    revealHold = true;
    mixer.setBusLevel('ambience', 0, 0.05);
    mixer.setBusLevel('creatures', 0, 0.05);
    mixer.setBusLevel('ambience', mixerRecipe.buses.ambience * (a.ambience ?? 1), R.ambienceInS);
    revealTimers.push(setTimeout(() => mixer?.setBusLevel('creatures', mixerRecipe.buses.creatures * (a.creatures ?? 1), R.creaturesInS), R.creaturesAtS * 1000));
  }));
  unsubs.push(on('reveal:ended', () => {
    revealing = false;
    for (const tm of revealTimers) clearTimeout(tm);
    revealTimers = [];
    music?.revealEnded();
    if (revealHold) { revealHold = false; applySettings(gameRecipe.reveal.endInS); }
  }));

  // Keepsakes (docs/future/12; recipes/audio/keepsakes.json): tapping one picks it up off the sand
  // (a bottle rolls on the stones); keeping, leaving and reading say so through keepsake:sound,
  // as the nets will.
  let heldKeepsake = '';
  unsubs.push(store.subscribe('identify', (/** @type {any} */ c) => {
    const id = c?.keepsake ?? '';
    if (id && id !== heldKeepsake) keepsakeSounds?.play(c.family === 'bottle' ? 'bottle' : 'pickup');
    heldKeepsake = id;
  }));
  unsubs.push(on('keepsake:sound', (/** @type {{ name: string, seed?: number }} */ p) => keepsakeSounds?.play(p.name, p.seed)));
  // The first evening (src/world/intro): lighting the fire brings one call far out over the water,
  // the frog voice (Matt's choice; recipes/audio/intro.json), outM along the camp pad's seaward line.
  unsubs.push(on('intro:curlew', () => {
    const C = introRecipe.call, pad = store.get('campPad');
    if (pad) voices?.call('intro:dusk-call', C.species, [pad.x + pad.fx * C.outM, 0, pad.z + pad.fz * C.outM], C.intensity);
  }));
  // A long, slow look (P2e, src/world/creatures/tea-reveal.js): a frog not yet found calls once from where it sits.
  unsubs.push(on('creature:reveal', (/** @type {{ species: string, x: number, y: number, z: number }} */ p) => {
    if (p.species === 'frogs') voices?.call('tea:reveal', 'frog', [p.x, p.y, p.z], 0.6);
  }));
  // The camp's fire (src/world/camp): the steel's strike, the twigs catching, rain's hiss on a fire.
  unsubs.push(on('camp:sound', (/** @type {{ name: string }} */ p) => campSounds?.play(p.name)));
  // Digging (docs/future/13 10.4.3, P2c): the spade's bite by layer, the lift and the pour, timed to the dig's motion.
  unsubs.push(on('dig:sound', (/** @type {{ name: string, seed?: number }} */ p) => digSounds?.play(p.name, p.seed)));
  // Gathering (docs/future/13 gather:done): a soft sound by the group gathered, the spot seeding the take.
  unsubs.push(on('gather:done', (/** @type {{ group: string, x: number, z: number }} */ p) => {
    const name = gatherRecipe.groups?.[p.group];
    if (name) gatherSounds?.play(name, hash32(Math.round(p.x * 10), Math.round(p.z * 10)));
  }));

  if (store.get('sound')) begin();
  else {
    const un = store.subscribe('sound', () => { un(); begin(); });
    unsubs.push(un);
  }

  return {
    mixer: () => mixer,
    ambience: () => ambience,
    voices: () => voices,
    music: () => music,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      if (callTimer) clearInterval(callTimer);
      for (const u of unsubs) u();
      music?.dispose();
      campLoops?.dispose();
      voices?.dispose();
      ambience?.dispose();
      mixer?.dispose();
    },
  };
}
