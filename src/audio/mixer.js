// @ts-check
// The sound graph (doc 17, with doc 24's music bus). One AudioContext, created suspended and
// resumed on the player's first touch or key; buses for each kind of sound; a shared outdoor room
// for the island; a separate, darker room for the music, which is stereo and never placed in 3D;
// a gentle limiter on the master. All numbers come from recipes/audio/mixer.json.
//
//   ambience ─┬───────────────────────────────┐
//             └─ send ─┐                      │
//   creatures ┬────────│──────────────────────┤
//             └─ send ─┤→ island room ────────┤
//   tools ────────────────────────────────────┤
//   ui ───────────────────────────────────────┤→ master → limiter → speakers
//   music in → chorus EQ → duck → brightness ─┬─ dry ──┐                  │
//                                             └─ music room ─ wet ┴→ music level ┘

import { createRoom } from './reverb.js';

/** @typedef {'ambience'|'creatures'|'tools'|'ui'|'music'} BusName */

/**
 * @typedef {Object} Mixer
 * @property {AudioContext} ctx
 * @property {(name: BusName) => AudioNode} input   where a sound connects to reach a bus
 * @property {() => Promise<void>} unlock           call on the first gesture; safe to call again
 * @property {(bus: BusName|'master', value: number, rampS?: number) => void} setBusLevel  0..1
 * @property {(eye: number[], forward: number[], up: number[]) => void} setListener
 * @property {(db: number) => void} duckMusic       dip the music (0 = none), e.g. near a calling frog
 * @property {(o: {lowpassHz?: number, wet?: number, chorusDb?: number}, rampS?: number) => void} setMusicTone
 * @property {() => 'locked'|'running'|'suspended'|'closed'} state
 * @property {() => void} dispose
 */

/**
 * Build the graph. The context starts suspended until unlock().
 * @param {any} recipe recipes/audio/mixer.json
 * @param {{tier?: 'desktop'|'mobile', levels?: Partial<Record<BusName|'master', number>>, autoVisibility?: boolean}} [opts]
 * @returns {Mixer}
 */
export function createMixer(recipe, opts = {}) {
  const tier = opts.tier ?? 'desktop';
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  // Created suspended by the browser's autoplay rules on most platforms; make it explicit.
  if (ctx.state === 'running') ctx.suspend();
  const lengthScale = tier === 'mobile' ? recipe.mobile.reverbLength : 1;
  let unlocked = false;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = recipe.compressor.thresholdDb;
  limiter.knee.value = recipe.compressor.kneeDb;
  limiter.ratio.value = recipe.compressor.ratio;
  limiter.attack.value = recipe.compressor.attackS;
  limiter.release.value = recipe.compressor.releaseS;
  limiter.connect(ctx.destination);

  // The master starts at zero and fades in on unlock, so the first sound never pops.
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(limiter);
  let masterLevel = opts.levels?.master ?? recipe.master.level;

  // Island room, shared by ambience and creatures.
  const islandRoom = createRoom(ctx, recipe.islandReverb, recipe.seed, lengthScale);
  islandRoom.connect(master);

  /** @type {Record<string, GainNode>} */
  const level = {};
  /** @type {Record<string, AudioNode>} */
  const inputs = {};
  for (const name of /** @type {const} */ (['ambience', 'creatures', 'tools', 'ui'])) {
    const g = ctx.createGain();
    g.gain.value = opts.levels?.[name] ?? recipe.buses[name];
    g.connect(master);
    const send = recipe.islandReverb.sends[name];
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(islandRoom);
    }
    level[name] = g;
    inputs[name] = g;
  }

  // Music chain.
  const musicIn = ctx.createGain();
  const chorusEq = ctx.createBiquadFilter();
  chorusEq.type = 'peaking';
  chorusEq.frequency.value = recipe.musicTone.chorusEq.hz;
  chorusEq.Q.value = recipe.musicTone.chorusEq.q;
  chorusEq.gain.value = recipe.musicTone.chorusEq.db;
  const duck = ctx.createGain();
  const bright = ctx.createBiquadFilter();
  bright.type = 'lowpass';
  bright.frequency.value = recipe.musicTone.lowpassHz;
  bright.Q.value = 0.5;
  const musicRoom = createRoom(ctx, recipe.musicReverb, recipe.seed + 1, lengthScale);
  const wet = ctx.createGain();
  wet.gain.value = recipe.musicReverb.wet;
  const musicLevel = ctx.createGain();
  musicLevel.gain.value = opts.levels?.music ?? recipe.buses.musicDefault;
  musicIn.connect(chorusEq).connect(duck).connect(bright);
  bright.connect(musicLevel);
  bright.connect(musicRoom).connect(wet).connect(musicLevel);
  musicLevel.connect(master);
  level.music = musicLevel;
  inputs.music = musicIn;

  /** @param {AudioParam} p @param {number} v @param {number} s */
  function glide(p, v, s) {
    const t = ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    if (s <= 0) p.setValueAtTime(v, t);
    else p.setTargetAtTime(v, t, s / 3);
  }

  async function unlock() {
    if (ctx.state === 'closed') return;
    if (ctx.state !== 'running') await ctx.resume();
    if (!unlocked) {
      unlocked = true;
      glide(master.gain, masterLevel, recipe.fades.unlockS);
    }
  }

  // iOS can leave the context 'interrupted' after a call; the next gesture resumes it.
  const onGesture = () => { if (ctx.state !== 'running') unlock(); };
  window.addEventListener('pointerdown', onGesture, { capture: true });
  window.addEventListener('keydown', onGesture, { capture: true });

  /** @type {ReturnType<typeof setTimeout> | null} */
  let hideTimer = null;
  const onVisibility = () => {
    if (!unlocked) return;
    if (document.hidden) {
      glide(master.gain, 0, recipe.fades.hideS);
      hideTimer = setTimeout(() => { if (document.hidden) ctx.suspend(); }, recipe.fades.hideS * 1000 + 50);
    } else {
      if (hideTimer) clearTimeout(hideTimer);
      ctx.resume().then(() => glide(master.gain, masterLevel, recipe.fades.showS));
    }
  };
  if (opts.autoVisibility !== false) document.addEventListener('visibilitychange', onVisibility);

  return {
    ctx,
    input: (name) => inputs[name],
    unlock,
    setBusLevel(bus, value, rampS = 0.3) {
      const v = Math.max(0, Math.min(1.5, value));
      if (bus === 'master') {
        masterLevel = v;
        if (unlocked) glide(master.gain, v, rampS);
        return;
      }
      glide(level[bus].gain, v, rampS);
    },
    setListener(eye, forward, up) {
      const l = ctx.listener;
      const t = ctx.currentTime;
      if (l.positionX) {
        l.positionX.setTargetAtTime(eye[0], t, 0.02);
        l.positionY.setTargetAtTime(eye[1], t, 0.02);
        l.positionZ.setTargetAtTime(eye[2], t, 0.02);
        l.forwardX.setTargetAtTime(forward[0], t, 0.02);
        l.forwardY.setTargetAtTime(forward[1], t, 0.02);
        l.forwardZ.setTargetAtTime(forward[2], t, 0.02);
        l.upX.setTargetAtTime(up[0], t, 0.02);
        l.upY.setTargetAtTime(up[1], t, 0.02);
        l.upZ.setTargetAtTime(up[2], t, 0.02);
      } else {
        l.setPosition(eye[0], eye[1], eye[2]);
        l.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
      }
    },
    duckMusic(db) {
      const g = Math.pow(10, Math.min(0, db) / 20);
      const s = g < duck.gain.value ? recipe.duck.attackS : recipe.duck.releaseS;
      glide(duck.gain, g, s);
    },
    setMusicTone(o, rampS = 2) {
      if (o.lowpassHz !== undefined) glide(bright.frequency, o.lowpassHz, rampS);
      if (o.wet !== undefined) glide(wet.gain, o.wet, rampS);
      if (o.chorusDb !== undefined) glide(chorusEq.gain, o.chorusDb, rampS);
    },
    state: () => (unlocked ? /** @type {any} */ (ctx.state) : 'locked'),
    dispose() {
      window.removeEventListener('pointerdown', onGesture, { capture: true });
      window.removeEventListener('keydown', onGesture, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      ctx.close();
    },
  };
}
