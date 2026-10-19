// @ts-check
// The island's ambience (doc 17 "Ambience that reacts", doc 25). Reads a SoundState about ten
// times a second and turns it into the level, tone and season blend of each bed, plus a seeded
// scatter of small one-shot sounds placed around the camera target. All curves come from
// recipes/audio/ambience.json; the made-in-code sounds from recipes/audio/procedural.json.
//
//   beds (stereo slots) ─→ width (mid/side) ─┐
//   one-shots (each panned, PannerNode) ─────┴→ mist lowpass ─→ frost high shelf ─→ level ─→ 'ambience' bus
//
// Beds play recordings once they exist (src/audio/ambience/slot.js) and the procedural stand-ins
// until then. Randomness is seeded through src/core/rng.js, never Math.random.

import { stream, hash32 } from '../core/rng.js';
import * as proc from './procedural.js';
import { surf, windEq, rainOn, run } from './ambience/fallbacks.js';
import { createSlot } from './ambience/slot.js';
import { placedChain } from './spatial.js';
import {
  SEASONS, value, sumDb, product, dbToGain, clamp01, lerp, normBlend, blendFromPosition, standardHour,
} from './ambience/curves.js';

/**
 * Doc 17's sound state with doc 25's additions. Fields after `listener` are optional extras the
 * game can pass when it has them; the ambience guesses them from the rest otherwise.
 * @typedef {Object} SoundState
 * @property {{still: number, slow: number, running: number}} waterNear  0..1, water within 12 m
 * @property {number} tidePhase    0..1 through the tide cycle (0 high water, 0.5 low; tide.js phase01)
 * @property {number} wind         0..1
 * @property {number} gust         0..1
 * @property {number} hour         0..24 display time
 * @property {number} season       0 spring .. 3 winter
 * @property {number} seasonPhase  0..1 through the season
 * @property {number[]} [seasonBlend]  weights of the four seasons (doc 25); from season and phase if absent
 * @property {'clear'|'cloud'|'rain'|'mist'} weather
 * @property {number} camHeight    meters above the camera target
 * @property {number} life         0..1
 * @property {number} [frost]      0..1
 * @property {string[]} [residents]   settled species ids
 * @property {'dry'|'wet'|'frost'} [groundState]
 * @property {{x: number, y: number, z: number}} [listener]  the camera target, meters
 * @property {number} [rain]       0..1 rain intensity (default: 1 when weather is 'rain')
 * @property {number} [mist]       0..1 mist density (default: 1 when weather is 'mist')
 * @property {number} [afterRain]  0..1, 1 just after rain stopped (kept here if absent)
 * @property {number} [rainOnset]  0..1, 1 in the first minute of rain (kept here if absent)
 * @property {number} [sunriseH]   display hour of sunrise (default 6)
 * @property {number} [sunsetH]    display hour of sunset (default 18)
 * @property {{water?: number, pads?: number, reeds?: number, grass?: number}} [surfaceNear]  0..1
 * @property {number[]} [eye]      camera eye [x, y, z] (default: above the target by camHeight)
 * @property {number[]} [forward]  view direction (default: looking down and north)
 */

/** @typedef {ReturnType<typeof createSlot>} Slot */

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {any} recipe recipes/audio/ambience.json
 * @param {any} procRecipe recipes/audio/procedural.json
 * @param {number} seed world seed
 * @param {{tier?: 'desktop'|'mobile', dest?: AudioNode, recorded?: boolean}} [opts]
 */
export function createAmbience(mixer, recipe, procRecipe, seed, opts = {}) {
  const ctx = mixer.ctx;
  const tier = opts.tier ?? 'desktop';
  const sysSeed = hash32(seed >>> 0, recipe.seed >>> 0);
  const S = recipe;

  // ---- The ambience chain ---------------------------------------------------------------------
  const levelG = ctx.createGain();
  levelG.gain.value = 1;
  levelG.connect(opts.dest ?? mixer.input('ambience'));
  const frostShelf = ctx.createBiquadFilter();
  frostShelf.type = 'highshelf'; frostShelf.frequency.value = S.frost.hz; frostShelf.gain.value = 0;
  const mistLp = ctx.createBiquadFilter();
  mistLp.type = 'lowpass'; mistLp.Q.value = 0.5; mistLp.frequency.value = Math.min(18000, ctx.sampleRate * 0.45);
  mistLp.connect(frostShelf).connect(levelG);

  // Width on the beds only (one-shots are placed by their panners): mid/side by four gains.
  const bedsIn = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const wLL = ctx.createGain(), wRL = ctx.createGain(), wLR = ctx.createGain(), wRR = ctx.createGain();
  bedsIn.connect(split);
  split.connect(wLL, 0); split.connect(wLR, 0); split.connect(wRL, 1); split.connect(wRR, 1);
  wLL.connect(merge, 0, 0); wRL.connect(merge, 0, 0); wLR.connect(merge, 0, 1); wRR.connect(merge, 0, 1);
  merge.connect(mistLp);
  /** @param {number} w 1 full width, 0 mono @param {number} rampS */
  const setWidth = (w, rampS) => {
    const a = (1 + w) / 2, b = (1 - w) / 2, t = ctx.currentTime, k = Math.max(0.01, rampS) / 3;
    wLL.gain.setTargetAtTime(a, t, k); wRR.gain.setTargetAtTime(a, t, k);
    wRL.gain.setTargetAtTime(b, t, k); wLR.gain.setTargetAtTime(b, t, k);
  };
  setWidth(1, 0.01);

  // One-shots: their own sum (with a meter and the lab's solo and mute) into the mist filter.
  const shotsUser = ctx.createGain();
  const shotsIn = ctx.createGain();
  shotsIn.connect(shotsUser).connect(mistLp);
  const shotsMeter = ctx.createAnalyser();
  shotsMeter.fftSize = 1024;
  shotsUser.connect(shotsMeter);
  const shotsBuf = new Float32Array(shotsMeter.fftSize);
  let lastShotAt = -1;

  // ---- Beds -----------------------------------------------------------------------------------
  let made = 0;
  /** A fresh seeded stream for each bed instance. @param {number} bedIx @param {string} season */
  const bedRng = (bedIx, season) => stream(sysSeed, 100 + bedIx, SEASONS.indexOf(/** @type {any} */ (season)) + 1, made++);

  /**
   * The made-in-code stand-in for one bed in one season.
   * @param {string} kind @param {number} bedIx
   * @returns {(season: string) => import('./ambience/slot.js').Bed}
   */
  function fallbackMaker(kind, bedIx) {
    return (season) => {
      const r = bedRng(bedIx, season);
      if (kind === 'surf') return surf(ctx, bedsIn, S.fallbacks.surf, procRecipe, r);
      if (kind === 'air') return proc.air(ctx, bedsIn, procRecipe, r, { season, level: 1 });
      if (kind === 'lap') return proc.lap(ctx, bedsIn, procRecipe, r, { amount: 0.6, liveliness: 0.5 });
      if (kind === 'trickle') return proc.trickle(ctx, bedsIn, procRecipe, r, { amount: 0.5 });
      if (kind === 'run') return run(ctx, bedsIn, S.fallbacks.run, procRecipe, r);
      if (kind === 'wind') return gustAware(proc.wind(ctx, bedsIn, procRecipe, r, { strength: 0.3 }));
      if (kind === 'reeds' || kind === 'grass') return windEq(ctx, bedsIn, S.fallbacks[kind][season], procRecipe, r);
      if (kind.startsWith('rain:')) {
        const base = S.fallbacks.rain[kind.slice(5)];
        const over = base.seasons?.[season] ?? {};
        return rainOn(ctx, bedsIn, { ...base, ...over, noise: { ...base.noise, ...over.noise }, drops: { ...base.drops, ...over.drops } }, procRecipe, r);
      }
      throw new Error(`ambience: no fallback "${kind}"`);
    };
  }

  /**
   * The procedural wind swells fastest when a gust arrives alone in set(); pass it that way.
   * @param {import('./ambience/slot.js').Bed} bed
   * @returns {import('./ambience/slot.js').Bed}
   */
  function gustAware(bed) {
    let lastGust = -1;
    return {
      output: bed.output,
      stop: bed.stop,
      set(params, rampS) {
        if (params.strength !== undefined) bed.set({ strength: params.strength }, rampS);
        if (params.gust !== undefined && Math.abs(params.gust - lastGust) > 0.02) { lastGust = params.gust; bed.set({ gust: params.gust }); }
      },
    };
  }

  /** @type {{name: string, spec: any, slot: Slot}[]} */
  const beds = Object.entries(S.beds).map(([name, spec], i) => ({
    name,
    spec,
    slot: createSlot(ctx, bedsIn, {
      layer: spec.layer,
      seasonal: !!spec.seasonal,
      makeFallback: fallbackMaker(spec.fallback, i),
      recordedDb: S.slot.recordedDb,
      idleStopS: S.slot.idleStopS,
      crossfadeS: S.slot.crossfadeS,
      takeSwap: S.slot.takeSwap,
      rng: stream(sysSeed, 50, i),
      allowRecorded: opts.recorded !== false,
    }),
  }));

  // ---- Solo and mute (the lab) ----------------------------------------------------------------
  /** @type {string | null} */
  let solo = null;
  /** @type {Set<string>} */
  const muted = new Set();
  const applyUser = () => {
    for (const b of beds) b.slot.setUser((solo ? solo === b.name : true) && !muted.has(b.name) ? 1 : 0);
    const shotsOn = (solo ? solo === 'oneShots' : true) && !muted.has('oneShots');
    shotsUser.gain.setTargetAtTime(shotsOn ? 1 : 0, ctx.currentTime, 0.05);
  };

  // ---- Inputs ---------------------------------------------------------------------------------
  const memory = { raining: false, onsetAt: -1e9, stopAt: -1e9 };
  /** @type {Record<string, number>} */
  let inputs = {};
  let blend = [1, 0, 0, 0];

  /** @param {SoundState} s */
  function readInputs(s) {
    blend = s.seasonBlend ? normBlend(s.seasonBlend) : blendFromPosition((s.season ?? 0) + (s.seasonPhase ?? 0.5), S.seasonEdge ?? 0.15);
    const w = s.waterNear ?? { still: 0, slow: 0, running: 0 };
    const water = Math.max(w.still, w.slow, w.running);
    const tideHigh = (1 + Math.cos(2 * Math.PI * (s.tidePhase ?? 0))) / 2;
    const wet = clamp01(s.rain ?? (s.weather === 'rain' ? 1 : 0));
    const winter = blend[3];
    const now = ctx.currentTime;
    const rm = S.rainMemory;
    const isRaining = wet > 0.05;
    if (isRaining && !memory.raining) memory.onsetAt = now;
    if (!isRaining && memory.raining) memory.stopAt = now;
    memory.raining = isRaining;
    const rainOnset = s.rainOnset ?? (isRaining ? clamp01(1 - (now - memory.onsetAt) / rm.onsetS) : 0);
    const afterRain = s.afterRain ?? (isRaining ? 0 : clamp01(1 - (now - memory.stopAt) / rm.afterRainS));
    const height = Math.max(0.3, s.camHeight ?? 10);
    // What is close: from the state when given, guessed from the water otherwise, and pulled
    // toward an even wash as the camera rises.
    const sn = s.surfaceNear ?? {};
    const D = S.surfaces.defaults;
    const raw = {
      nearWater: sn.water ?? water,
      nearPads: sn.pads ?? w.still * D.pads,
      nearReeds: sn.reeds ?? clamp01(water * 2) * D.reeds,
      nearGrass: sn.grass ?? clamp01(1 - 0.6 * water),
    };
    const m = S.surfaces.mergeHeightM;
    const merge = clamp01((height - m[0]) / (m[1] - m[0]));
    /** @type {Record<string, number>} */
    const near = {};
    for (const [k, v] of Object.entries(raw)) near[k] = lerp(clamp01(v), S.surfaces.mergeTo * (k === 'nearPads' ? D.pads : 1), merge);
    inputs = {
      still: clamp01(w.still), slow: clamp01(w.slow), running: clamp01(w.running), water,
      tideHigh, lowTide: 1 - tideHigh, rising: (s.tidePhase ?? 0) % 1 >= 0.5 ? 1 : 0,
      wind: clamp01(s.wind ?? 0), gust: clamp01(s.gust ?? 0),
      hour: standardHour(s.hour ?? 12, s.sunriseH ?? 6, s.sunsetH ?? 18),
      height,
      rain: wet * (1 - winter), drizzle: wet * winter, rainOnset, afterRain,
      mist: clamp01(s.mist ?? (s.weather === 'mist' ? 1 : 0)),
      frost: clamp01(s.frost ?? 0),
      life: clamp01(s.life ?? 0),
      ...near,
      spring: blend[0], summer: blend[1], autumn: blend[2], winter: blend[3],
    };
    return inputs;
  }

  // ---- One-shots ------------------------------------------------------------------------------
  const O = S.oneShots;
  const pools = Object.entries(O.pools).map(([name, p], i) => ({
    name, p, rng: stream(sysSeed, 200, i), acc: 0, need: 0, last: -1e9, fired: 0,
  }));
  for (const pl of pools) pl.need = -Math.log(1 - pl.rng.next());
  const spatialOpts = { tier, refDistance: O.spatial.refDistance, rolloff: O.spatial.rolloff, air: O.spatial.air, behind: O.spatial.behind };
  /** @type {{eye: number[], forward: number[], target: number[]}} */
  let ear = { eye: [0, 10, 0], forward: [0, -0.9, -0.44], target: [0, 0, 0] };
  const shotRng = stream(sysSeed, 300);

  /**
   * Play one procedural one-shot at a placed spot.
   * @param {any} p pool settings (sound, kind, sizeMm, durationS, gainDb, lowpassHz, ringM, heightM)
   * @param {{next(): number, range(a: number, b: number): number, int(n: number): number}} r
   * @param {number} when audio time
   * @param {number[]} [pos] where; a seeded spot around the camera target if absent
   */
  function play(p, r, when, pos) {
    if (!pos) {
      const a = r.range(0, 2 * Math.PI), d = r.range(p.ringM?.[0] ?? 1, p.ringM?.[1] ?? 4);
      pos = [ear.target[0] + Math.cos(a) * d, ear.target[1] + r.range(p.heightM?.[0] ?? 0, p.heightM?.[1] ?? 0.5), ear.target[2] + Math.sin(a) * d];
    }
    const chain = placedChain(ctx, shotsIn, spatialOpts);
    chain.place(pos, ear, when);
    /** @type {AudioNode} */
    let into = chain.input;
    if (p.lowpassHz) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = p.lowpassHz; lp.Q.value = 0.5;
      lp.connect(chain.input);
      into = lp;
    }
    const gainDb = r.range(p.gainDb?.[0] ?? 0, p.gainDb?.[1] ?? 0);
    const durationS = p.durationS ? r.range(p.durationS[0], p.durationS[1]) : undefined;
    const o = { when, gainDb };
    if (p.sound === 'drop') proc.drop(ctx, into, procRecipe, r, { ...o, sizeMm: r.range(p.sizeMm?.[0] ?? 2, p.sizeMm?.[1] ?? 2) });
    else if (p.sound === 'plop') proc.plop(ctx, into, procRecipe, r, { ...o, sizeCm: r.range(p.sizeCm?.[0] ?? 3, p.sizeCm?.[1] ?? 3) });
    else if (p.sound === 'knock') proc.knock(ctx, into, procRecipe, r, { ...o, kind: p.kind });
    else if (p.sound === 'frostTick') proc.frostTick(ctx, into, procRecipe, r, o);
    else if (p.sound === 'crackle') proc.crackle(ctx, into, procRecipe, r, { ...o, durationS });
    else if (p.sound === 'aeolian') proc.aeolian(ctx, into, procRecipe, r, { ...o, durationS });
    else throw new Error(`ambience: unknown one-shot "${p.sound}"`);
    lastShotAt = when;
    // Free the chain once the sound is surely over.
    const life = (when - ctx.currentTime) + (durationS ?? 1.5) + 2;
    setTimeout(() => chain.dispose(), life * 1000);
    return pos;
  }

  /**
   * Seeded Poisson scatter with a minimum gap: each pool accumulates its rate over time and
   * fires when it passes an exponential draw (an inhomogeneous Poisson process, so the rate can
   * change with the state without restarting anything).
   * @param {number} dtS seconds since the last update
   */
  function scheduleOneShots(dtS) {
    const density = value(O.density, inputs, blend) * (tier === 'mobile' ? O.mobileDensity : 1) * (1 - S.mist.oneShotCut * inputs.mist);
    const now = ctx.currentTime;
    let lastAny = -1e9;
    for (const pl of pools) lastAny = Math.max(lastAny, pl.last);
    for (const pl of pools) {
      const rate = (pl.p.ratePerMin / 60) * product(pl.p.rate, inputs, blend) * density;
      if (!(rate > 0)) continue;
      pl.acc += rate * dtS;
      if (pl.acc < pl.need) continue;
      const when = now + O.lookAheadS + pl.rng.range(0, Math.min(dtS, 0.2));
      if (when - pl.last < pl.p.minGapS || when - lastAny < O.globalGapS) continue;
      pl.acc = 0;
      pl.need = -Math.log(1 - pl.rng.next());
      pl.last = when;
      lastAny = when;
      pl.fired++;
      play(pl.p, pl.rng, when);
    }
  }

  /**
   * Distant visitors (doc 25: a far gull, geese passing, a songbird across the water, an owl):
   * not in this pass, since they need recordings. This hook is where they will be scheduled
   * (two to four a game day, beyond the shoreline, never during the frog window).
   * @param {SoundState} _state
   */
  function distantVisitorsHook(_state) { /* future work: docs/audio-future-work.md */ }

  // ---- Update ---------------------------------------------------------------------------------
  let lastUpdate = -1;
  let first = true;

  /** @param {SoundState} state */
  function update(state) {
    const now = ctx.currentTime;
    const dtS = lastUpdate < 0 ? 0.1 : Math.min(1, Math.max(0, now - lastUpdate));
    lastUpdate = now;
    const inp = readInputs(state);
    const rampS = first ? 0.05 : S.slot.rampS;
    first = false;
    const L = state.listener ?? { x: 0, y: 0, z: 0 };
    ear = {
      target: [L.x, L.y, L.z],
      eye: state.eye ?? [L.x, L.y + inp.height, L.z],
      forward: state.forward ?? [0, -0.9, -0.44],
    };

    for (const b of beds) {
      const db = sumDb(b.spec.gainDb, inp, blend);
      const amount = clamp01(product(b.spec.amount, inp, blend));
      /** @type {Record<string, number>} */
      const params = {};
      for (const [k, v] of Object.entries(b.spec.params ?? {})) params[k] = value(v, inp, blend);
      const lp = b.spec.lowpassHz ? value(b.spec.lowpassHz, inp, blend) : undefined;
      b.slot.update(dbToGain(db) * amount, params, blend, rampS, lp);
    }

    const t = ctx.currentTime, k = Math.max(0.01, rampS) / 3;
    levelG.gain.setTargetAtTime(dbToGain(value(S.level, inp, blend)), t, k);
    mistLp.frequency.setTargetAtTime(Math.min(value(S.mist.lowpassHz, inp, blend), ctx.sampleRate * 0.45), t, k);
    frostShelf.gain.setTargetAtTime(value(S.frost.db, inp, blend), t, k);
    setWidth(clamp01(value(S.width, inp, blend) * (1 - S.mist.widthCut * inp.mist)), rampS);

    if (ctx.state === 'running') scheduleOneShots(dtS);
    distantVisitorsHook(state);
  }

  return {
    update,
    /** The inputs as last read (for the lab). */
    inputs: () => ({ ...inputs }),
    /** The season weights as last read. */
    blend: () => blend.slice(),
    /** Bed names, plus 'oneShots'. */
    names: () => [...beds.map((b) => b.name), 'oneShots'],
    /** What each bed is doing now: RMS dBFS, and whether it plays a recording or the stand-in. */
    levels() {
      /** @type {{name: string, db: number, source: string, live: string[]}[]} */
      const out = beds.map((b) => ({ name: b.name, db: b.slot.levelDb(), source: b.slot.source(), live: b.slot.live() }));
      shotsMeter.getFloatTimeDomainData(shotsBuf);
      let s = 0;
      for (let i = 0; i < shotsBuf.length; i++) s += shotsBuf[i] * shotsBuf[i];
      const rms = Math.sqrt(s / shotsBuf.length);
      out.push({ name: 'oneShots', db: rms > 1e-7 ? 20 * Math.log10(rms) : -120, source: 'made in code', live: [] });
      return out;
    },
    /** How many each pool has fired. */
    poolCounts: () => Object.fromEntries(pools.map((p) => [p.name, p.fired])),
    /** Last one-shot start time (audio clock). */
    lastShotAt: () => lastShotAt,
    /** @param {string | null} name a bed name, 'oneShots', or null for none */
    setSolo(name) { solo = name; applyUser(); },
    /** @param {string} name @param {boolean} on */
    setMute(name, on) { if (on) muted.add(name); else muted.delete(name); applyUser(); },
    /**
     * Fire one procedural one-shot by hand (the lab's buttons), now, near the camera target.
     * @param {string} sound drop | plop | knock | frostTick | crackle | aeolian
     * @param {{kind?: string, pos?: number[]}} [o]
     */
    fire(sound, o = {}) {
      const p = { sound, kind: o.kind, gainDb: [-2, 0], sizeMm: [1.5, 3], sizeCm: [2.5, 4], durationS: [2, 3], ringM: [1.5, 3], heightM: [0, 0.6] };
      return play(p, shotRng, ctx.currentTime + 0.03, o.pos);
    },
    /** Fade everything and free it. */
    dispose() {
      for (const b of beds) b.slot.stop();
      setTimeout(() => levelG.disconnect(), 2000);
    },
  };
}
