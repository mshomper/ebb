// @ts-check
// Creature voices (doc 17 "Procedural creature voices", doc 25 "Creature voices"). The behaviour
// system decides who calls and when; this module only renders the sound. Every call is its own
// voice placed at the creature (doc 17 "Finding creatures by ear"), with distance air absorption
// and, on mobile, a muffle behind the view. A voice cap keeps the nearest calls (12 desktop,
// 6 mobile). Midge swarms hum only within about 3 m, nearest two only.
//
//   call() ─→ frog pulse-croak ─→ placed chain (air lowpass, behind, panner) ─┐
//   spring purr (distant callers) ────────────────────────────────────────────┤→ 'creatures' bus
//   setSwarms() ─→ midge hum per swarm (panner, reach) ───────────────────────┘
//
// Calls are scheduled on the audio clock: pass `when` (audio time) for look-ahead scheduling, or
// leave it out for "now". A call's start is when the game starts swelling the throat sac.

import { stream, hash32 } from '../core/rng.js';
import { placedChain } from './spatial.js';
import { individualOf, seasonVoice, planCall, renderCall, createPurr, idHash } from './voices/frog.js';
import { createSwarmVoice } from './voices/midge.js';
import { normBlend } from './ambience/curves.js';

/**
 * @typedef {Object} VoiceRecipes
 * @property {any} frog   recipes/audio/voices/frog.json
 * @property {any} [midge] recipes/audio/voices/midge.json
 */

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {VoiceRecipes} voiceRecipes
 * @param {number} seed world seed
 * @param {{tier?: 'desktop'|'mobile', dest?: AudioNode}} [opts]
 */
export function createVoices(mixer, voiceRecipes, seed, opts = {}) {
  const ctx = mixer.ctx;
  const tier = opts.tier ?? 'desktop';
  const out = ctx.createGain();
  out.connect(opts.dest ?? mixer.input('creatures'));
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  out.connect(meter);
  const meterBuf = new Float32Array(meter.fftSize);
  const F = voiceRecipes.frog;
  const M = voiceRecipes.midge;
  let maxVoices = F.maxVoices[tier];
  let blend = [0, 1, 0, 0];
  /** @type {{eye: number[], forward: number[]}} */
  let ear = { eye: [0, 1.6, 0], forward: [0, 0, -1] };
  const spatial = { tier, refDistance: F.spatial.refDistance, rolloff: F.spatial.rolloff, air: F.spatial.air, behind: F.spatial.behind };

  /** @type {Map<string|number, {pitch: number, rhythm: number, key: number, calls: number}>} */
  const individuals = new Map();
  /** @type {{id: string|number, end: number, dist: number, stop(): void, chain: ReturnType<typeof placedChain>}[]} */
  let live = [];
  const stats = { calls: 0, dropped: 0, stolen: 0 };
  const purr = createPurr(ctx, out, F);

  /** @param {string|number} id */
  function individual(id) {
    let ind = individuals.get(id);
    if (!ind) {
      ind = { ...individualOf(seed, id, F), calls: 0 };
      individuals.set(id, ind);
    }
    return ind;
  }

  /** Drop voices that have finished. */
  function prune() {
    const t = ctx.currentTime;
    live = live.filter((v) => {
      if (v.end > t) return true;
      setTimeout(() => v.chain.dispose(), 200);
      return false;
    });
  }

  /**
   * Render one call.
   * @param {string|number} creatureId
   * @param {string} species 'frog' (other species arrive with their own models)
   * @param {number[]} pos [x, y, z] meters
   * @param {number} intensity 0..1 (mood, how happy the chorus is)
   * @param {number} [when] audio time; now if absent
   * @returns {boolean} whether the call sounds (false: winter, unknown species, or capped)
   */
  function call(creatureId, species, pos, intensity = 0.7, when) {
    if (species !== 'frog') return false;
    const season = seasonVoice(F, blend);
    if (season.rate <= 0.01) return false; // winter: dormant
    prune();
    const d = Math.hypot(pos[0] - ear.eye[0], pos[1] - ear.eye[1], pos[2] - ear.eye[2]);
    if (live.length >= maxVoices) {
      // Nearest first: steal the farthest if this one is nearer, otherwise let it go.
      let far = 0;
      for (let i = 1; i < live.length; i++) if (live[i].dist > live[far].dist) far = i;
      if (live[far].dist <= d) { stats.dropped++; return false; }
      live[far].stop();
      live.splice(far, 1);
      stats.stolen++;
    }
    const ind = individual(creatureId);
    const rng = stream(ind.key, 100, ind.calls++);
    const plan = planCall(F, ind, season, rng);
    const chain = placedChain(ctx, out, spatial);
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    chain.place(pos, ear, t);
    const v = renderCall(ctx, chain.input, F, plan, intensity, t, rng);
    live.push({ id: creatureId, end: v.end, dist: d, stop: v.stop, chain });
    stats.calls++;
    if (blend[0] > 0.01) purr.onCall(blend[0]);
    return true;
  }

  // ---- Midges ---------------------------------------------------------------------------------
  /** @type {Map<string|number, ReturnType<typeof createSwarmVoice>>} */
  const swarmVoices = new Map();
  /** @type {{id: string|number, dist: number, density: number}[]} */
  let swarmInfo = [];

  /**
   * The live swarms (call whenever they change, or at the ambience rate).
   * @param {{id: string|number, pos: number[], density: number}[]} swarms
   */
  function setSwarms(swarms) {
    if (!M) return;
    const reach = M.reachM + 0.5;
    const ranked = swarms
      .map((s) => ({ s, d: Math.hypot(s.pos[0] - ear.eye[0], s.pos[1] - ear.eye[1], s.pos[2] - ear.eye[2]) }))
      .filter((x) => x.d < reach && x.s.density > 0.005)
      .sort((a, b) => a.d - b.d)
      .slice(0, M.nearest);
    const keep = new Set(ranked.map((x) => x.s.id));
    for (const [id, v] of swarmVoices) if (!keep.has(id)) { v.stop(); swarmVoices.delete(id); }
    swarmInfo = [];
    for (const { s } of ranked) {
      let v = swarmVoices.get(s.id);
      if (!v) {
        v = createSwarmVoice(ctx, out, M, hash32(seed >>> 0, idHash(s.id), 0x4d494447), tier);
        swarmVoices.set(s.id, v);
      }
      const dist = v.set(s.pos, ear.eye, s.density);
      swarmInfo.push({ id: s.id, dist, density: s.density });
    }
  }

  return {
    call,
    setSwarms,
    /** @param {number[]} seasonBlend four weights: spring, summer, autumn, winter */
    setSeason(seasonBlend) {
      blend = normBlend(seasonBlend);
      if (blend[0] < 0.01) purr.hush();
    },
    /**
     * Where the ears are. The mixer's AudioListener should be set to the same (mixer.setListener).
     * @param {number[]} eye @param {number[]} forward @param {number[]} [up]
     */
    setListener(eye, forward, up = [0, 1, 0]) {
      ear = { eye: eye.slice(), forward: forward.slice() };
      mixer.setListener(eye, forward, up);
    },
    /** @param {number} n */
    setMaxVoices(n) { maxVoices = Math.max(1, Math.round(n)); },
    /** The season's call density factor for the behaviour (spring 1.3, summer 1, autumn 0.5, winter 0). */
    callRateFactor: () => seasonVoice(F, blend).rate,
    /** A frog's lasting pitch and rhythm factors. @param {string|number} id */
    individualOf: (id) => { const i = individual(id); return { pitch: i.pitch, rhythm: i.rhythm }; },
    /** Calls sounding now. */
    liveCount: () => { prune(); return live.length; },
    /** Midge swarms heard now: id, distance from the eye, density. */
    swarmsHeard: () => swarmInfo.slice(),
    stats: () => ({ ...stats }),
    /** RMS of the creature voices now, dBFS. */
    levelDb() {
      meter.getFloatTimeDomainData(meterBuf);
      let s = 0;
      for (let i = 0; i < meterBuf.length; i++) s += meterBuf[i] * meterBuf[i];
      const rms = Math.sqrt(s / meterBuf.length);
      return rms > 1e-7 ? 20 * Math.log10(rms) : -120;
    },
    /** The output, for the lab's solo and mute. */
    output: out,
    dispose() {
      for (const v of live) v.stop();
      for (const v of swarmVoices.values()) v.stop();
      purr.stop();
      setTimeout(() => out.disconnect(), 500);
    },
  };
}
