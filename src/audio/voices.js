// @ts-check
// Creature voices (doc 17 "Procedural creature voices", doc 25 "Creature voices"). The behaviour
// system decides who calls and when; this module only renders the sound. Every call is its own
// voice placed at the creature (doc 17 "Finding creatures by ear"), with distance air absorption.
// A voice cap keeps the nearest calls (12). Midge swarms hum only within about 3 m, nearest two only; a dragonfly's wings rattle
// only within about 2 m, nearest two only; a minnow's sip is heard near the school.
//
//   call() ─→ frog pulse-croak ─→ placed chain (air lowpass, panner) ─────────┐
//   plop(), sip() ─→ bubbles ─→ placed chain ─────────────────────────────────┤
//   spring purr (distant callers) ────────────────────────────────────────────┤→ 'creatures' bus
//   setSwarms() ─→ midge hum per swarm (panner, reach) ───────────────────────┤
//   setFlyers() ─→ wing rattle per dragonfly (panner, reach) ─────────────────┘
//
// Calls are scheduled on the audio clock: pass `when` (audio time) for look-ahead scheduling, or
// leave it out for "now". A call's start is when the game starts swelling the throat sac.

import { stream, hash32 } from '../core/rng.js';
import { placedChain } from './spatial.js';
import { individualOf, seasonVoice, planCall, renderCall, createPurr, idHash } from './voices/frog.js';
import { createSwarmVoice } from './voices/midge.js';
import { createWingVoice } from './voices/dragonfly.js';
import { normBlend } from './ambience/curves.js';
import { plop as plopSound, dropWith } from './procedural/one-shots.js';
import { henCall } from './voices/hen.js';

/**
 * @typedef {Object} VoiceRecipes
 * @property {any} frog   recipes/species/frog.json `voice`
 * @property {any} [midge] recipes/species/midge.json `voice`
 * @property {any} [dragonfly] recipes/species/dragonfly.json `voice`, with its motion's wingHz and dartMps
 * @property {any} [minnow] recipes/species/minnow.json `voice` (the sip needs `proc` too)
 * @property {any} [hen]   recipes/audio/hen.json (the hen's murmur, alarm and the distant crow)
 * @property {any} [proc]  recipes/audio/procedural.json, for the frog's plop into water
 * @property {{sizeCm: number[], gainDb: number[]}} [plop]  the plop's size and level ranges
 */

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {VoiceRecipes} voiceRecipes
 * @param {number} seed world seed
 * @param {{dest?: AudioNode}} [opts]
 */
export function createVoices(mixer, voiceRecipes, seed, opts = {}) {
  const ctx = mixer.ctx;
  const out = ctx.createGain();
  out.connect(opts.dest ?? mixer.input('creatures'));
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  out.connect(meter);
  const meterBuf = new Float32Array(meter.fftSize);
  const F = voiceRecipes.frog;
  const M = voiceRecipes.midge;
  let maxVoices = (typeof F.maxVoices === 'number' ? F.maxVoices : F.maxVoices?.desktop) ?? 12;
  let blend = [0, 1, 0, 0];
  /** @type {{eye: number[], forward: number[]}} */
  let ear = { eye: [0, 1.6, 0], forward: [0, 0, -1] };
  const spatial = { refDistance: F.spatial.refDistance, rolloff: F.spatial.rolloff, air: F.spatial.air };

  /** @type {Map<string|number, {pitch: number, rhythm: number, key: number, calls: number}>} */
  const individuals = new Map();
  /** @type {{id: string|number, end: number, dist: number, stop(): void, chain: ReturnType<typeof placedChain>}[]} */
  let live = [];
  const stats = { calls: 0, dropped: 0, stolen: 0, plops: 0, sips: 0 };
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

  /**
   * A frog going into the water (doc 25 "Frog body sounds"): a plop placed where it went in.
   * @param {string|number} creatureId @param {number[]} pos [x, y, z] @param {number} [when] audio time
   * @returns {boolean} whether it sounds (false without the procedural recipe)
   */
  function plop(creatureId, pos, when) {
    const P = voiceRecipes.plop, proc = voiceRecipes.proc;
    if (!P || !proc) return false;
    const ind = individual(creatureId);
    const rng = stream(ind.key, 200, ind.calls++);
    const chain = placedChain(ctx, out, spatial);
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    chain.place(pos, ear, t);
    plopSound(ctx, chain.input, proc, rng, { when: t, sizeCm: rng.range(P.sizeCm[0], P.sizeCm[1]), gainDb: rng.range(P.gainDb[0], P.gainDb[1]) });
    setTimeout(() => chain.dispose(), (t - ctx.currentTime + 2) * 1000);
    stats.plops++;
    return true;
  }

  // ---- Minnows ---------------------------------------------------------------------------------
  const W = voiceRecipes.minnow;
  const sipSpatial = W ? { ...spatial, refDistance: W.refDistance, rolloff: W.rolloff } : spatial;
  let sipCount = 0;

  /**
   * A minnow rising to sip at the surface: a tiny soft plop at the ring, heard near the school.
   * @param {number[]} pos [x, y, z] the ring @param {number} [when] audio time
   * @returns {boolean} whether it sounds (false without the recipe, or too far to hear)
   */
  function sip(pos, when) {
    const proc = voiceRecipes.proc;
    if (!W || !proc) return false;
    const d = Math.hypot(pos[0] - ear.eye[0], pos[1] - ear.eye[1], pos[2] - ear.eye[2]);
    if (d >= W.reachM) return false;
    const fade = d <= W.fadeFromM ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (d - W.fadeFromM) / (W.reachM - W.fadeFromM));
    const rng = stream(hash32(seed >>> 0, 0x5197), sipCount++);
    const chain = placedChain(ctx, out, sipSpatial);
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    chain.place(pos, ear, t);
    const fadeDb = 20 * Math.log10(Math.max(1e-4, fade));
    dropWith(ctx, chain.input, proc, W.sip, rng, { when: t, gainDb: rng.range(W.gainDb[0], W.gainDb[1]) + fadeDb });
    setTimeout(() => chain.dispose(), (t - ctx.currentTime + 1) * 1000);
    stats.sips++;
    return true;
  }

  // ---- The hen (docs/future/15 slice 3) ---------------------------------------------------------
  const HN = voiceRecipes.hen;
  let henCount = 0;

  /**
   * One of the hen's sounds, placed where it comes from: her murmur, her alarm, or the distant crow.
   * @param {'murmur'|'alarm'|'crow'|'song'} kind @param {number[]} pos [x, y, z] @param {number} [when] audio time
   * @returns {boolean} whether it sounds (false without her recipe)
   */
  function hen(kind, pos, when) {
    if (!HN) return false;
    const S = HN.spatial;
    const chain = placedChain(ctx, out, { ...spatial, refDistance: kind === 'crow' ? S.crowRefDistance : S.refDistance, rolloff: S.rolloff });
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    chain.place(pos, ear, t);
    const end = henCall(ctx, chain.input, kind, HN, stream(hash32(seed >>> 0, 0x4e4), henCount++), t);
    setTimeout(() => chain.dispose(), (end - ctx.currentTime + 1) * 1000);
    return true;
  }

  // ---- Dragonflies -----------------------------------------------------------------------------
  const D = voiceRecipes.dragonfly;
  /** @type {Map<string|number, ReturnType<typeof createWingVoice>>} */
  const wingVoices = new Map();
  /** @type {{id: string|number, dist: number, speed: number}[]} */
  let wingInfo = [];
  /** When (audio time) each voiced one landed. @type {Map<string|number, number>} */
  const landedAt = new Map();

  /**
   * The dragonflies on the wing (call at the ambience rate). Perched ones are silent; only the
   * nearest within reach get a voice.
   * @param {{id: string|number, pos: number[], speed: number, flying: boolean}[]} flyers
   */
  function setFlyers(flyers) {
    if (!D) return;
    const reach = D.reachM + 0.3;
    const ranked = flyers
      .filter((f) => f.flying)
      .map((f) => ({ f, d: Math.hypot(f.pos[0] - ear.eye[0], f.pos[1] - ear.eye[1], f.pos[2] - ear.eye[2]) }))
      .filter((x) => x.d < reach)
      .sort((a, b) => a.d - b.d)
      .slice(0, D.nearest);
    const keep = new Set(ranked.map((x) => x.f.id));
    // One that has just landed keeps its voice a moment so the wings fade rather than cut.
    const now = ctx.currentTime;
    for (const f of flyers) {
      if (f.flying) { landedAt.delete(f.id); continue; }
      const v = wingVoices.get(f.id);
      if (!v) continue;
      if (!landedAt.has(f.id)) landedAt.set(f.id, now);
      if (now - /** @type {number} */ (landedAt.get(f.id)) < D.perchRampS * 4) { keep.add(f.id); v.set(f.pos, ear.eye, 0, false); }
    }
    for (const [id, v] of wingVoices) if (!keep.has(id)) { v.stop(); wingVoices.delete(id); landedAt.delete(id); }
    wingInfo = [];
    for (const { f } of ranked) {
      let v = wingVoices.get(f.id);
      if (!v) {
        v = createWingVoice(ctx, out, D, hash32(seed >>> 0, idHash(f.id), 0x44524146));
        wingVoices.set(f.id, v);
      }
      const dist = v.set(f.pos, ear.eye, f.speed, true);
      wingInfo.push({ id: f.id, dist, speed: f.speed });
    }
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
        v = createSwarmVoice(ctx, out, M, hash32(seed >>> 0, idHash(s.id), 0x4d494447));
        swarmVoices.set(s.id, v);
      }
      const dist = v.set(s.pos, ear.eye, s.density);
      swarmInfo.push({ id: s.id, dist, density: s.density });
    }
  }

  return {
    call,
    plop,
    setSwarms,
    sip,
    setFlyers,
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
    hen,
    /** Calls sounding now. */
    liveCount: () => { prune(); return live.length; },
    /** Midge swarms heard now: id, distance from the eye, density. */
    swarmsHeard: () => swarmInfo.slice(),
    /** Dragonflies whose wings are heard now: id, distance from the eye, speed. */
    flyersHeard: () => wingInfo.slice(),
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
      for (const v of wingVoices.values()) v.stop();
      purr.stop();
      setTimeout(() => out.disconnect(), 500);
    },
  };
}
