// @ts-check
// Growing and rendering one piece offline, exactly as the game would play it (tools/music-render.html):
// the composer grows the piece for a season, slot, weather and seed (src/audio/music/develop/), the
// sun's day colour sets its tempo, room and brightness (daycolor.js), the realizer performs it
// (realize.js), and the game's music chain (src/audio/mixer.js: chorus EQ, brightness, the music
// room, the music level, master and limiter, at recipes/audio/mixer.json's numbers) is rebuilt in an
// OfflineAudioContext, which renders as fast as the computer can rather than in real time.

import { grow } from '../../src/audio/music/develop/index.js';
import { realize } from '../../src/audio/music/realize.js';
import { dayColorAt } from '../../src/audio/music/daycolor.js';
import { createInstruments } from '../../src/audio/music/instruments.js';
import { createRoom } from '../../src/audio/reverb.js';

export const SR = 48000;
/** Seconds of silence before the first note, as the game's performer leaves. */
const LEAD_S = 0.2;
/** Seconds rendered after the last sound, for the room's tail (trimmed later). */
const TAIL_S = 8;

/** Fetch a JSON file by its path from the repo root. @param {string} p */
export async function loadJson(p) {
  return (await fetch(new URL(`../../${p}`, import.meta.url), { cache: 'no-cache' })).json();
}

/** Every recipe the render needs, loaded once. */
export async function loadRecipes() {
  const [director, rules, names, rz, vo, mixer, spring, summer] = await Promise.all([
    loadJson('recipes/music/director.json'), loadJson('recipes/music/develop.json'), loadJson('recipes/music/names.json'),
    loadJson('recipes/music/realize.json'), loadJson('recipes/music/voicing.json'), loadJson('recipes/audio/mixer.json'),
    loadJson('recipes/music/material/spring.json'), loadJson('recipes/music/material/summer.json'),
  ]);
  // The instruments that exist, as the realizer's fallback list (a short probe context; no samples load).
  const probe = new OfflineAudioContext(2, SR, SR);
  const available = (await createInstruments(probe, probe.destination)).available();
  return { director, rules, names, recipes: { realize: rz, voicing: vo }, mixer, materials: /** @type {Record<string, any>} */ ({ spring, summer }), available };
}

/** @typedef {Awaited<ReturnType<typeof loadRecipes>>} Recipes */
/** @typedef {{season: string, slot: string, weather: string, seed: number, sun: number}} Choice */

/**
 * Grow and perform a piece (no sound): its title, form, length and the performance.
 * @param {Recipes} R @param {Choice} c
 */
export function compose(R, c) {
  const material = R.materials[c.season] ?? R.materials.spring;
  const piece = grow(material, R.rules, { slot: c.slot, weather: c.weather, seed: c.seed }, R.names).piece;
  const dayColor = dayColorAt(c.sun, R.director.dayColor);
  const perf = realize(piece, { seed: c.seed, dayColor, available: R.available }, R.recipes);
  const tmpl = piece.grown?.template ?? '';
  const form = material.templates?.[tmpl]?.name ?? tmpl;
  return { piece, perf, dayColor, title: /** @type {string} */ (piece.title), form, meter: piece.meter, lengthS: perf.durationS };
}

/**
 * Render a composed piece through the game's music chain.
 * @param {Recipes} R @param {ReturnType<typeof compose>} composed
 * @param {(stage: string, fraction: number) => void} [onProgress]
 * @returns {Promise<{channels: Float32Array[], lastS: number, missing: number}>}
 *   lastS: seconds into the render of the music's last sound (last note or pedal release)
 */
export async function renderPiece(R, composed, onProgress = () => {}) {
  const { perf, dayColor } = composed;
  const M = R.mixer;
  const lastEvent = Math.max(...perf.notes.map((/** @type {any} */ n) => n.t + n.dur), ...perf.pedal.map((/** @type {any} */ p) => p.t));
  const len = Math.ceil((LEAD_S + lastEvent + TAIL_S) * SR);
  const ctx = new OfflineAudioContext(2, len, SR);
  // The mixer's music chain, at the levels the game sets for this sun (src/audio/mixer.js; music/index.js setMusicTone).
  const C = M.compressor;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = C.thresholdDb; limiter.knee.value = C.kneeDb; limiter.ratio.value = C.ratio;
  limiter.attack.value = C.attackS; limiter.release.value = C.releaseS;
  limiter.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = M.master.level; master.connect(limiter);
  const musicIn = ctx.createGain();
  const eq = ctx.createBiquadFilter(); eq.type = 'peaking';
  eq.frequency.value = M.musicTone.chorusEq.hz; eq.Q.value = M.musicTone.chorusEq.q; eq.gain.value = M.musicTone.chorusEq.db;
  const duck = ctx.createGain();
  const bright = ctx.createBiquadFilter(); bright.type = 'lowpass'; bright.Q.value = 0.5; bright.frequency.value = dayColor.brightHz;
  const room = createRoom(ctx, M.musicReverb, M.seed + 1, 1);
  const wet = ctx.createGain(); wet.gain.value = dayColor.wet;
  const level = ctx.createGain(); level.gain.value = M.buses.musicDefault;
  const floor = ctx.createBiquadFilter(); floor.type = 'highpass';
  floor.frequency.value = M.musicTone.floor?.hz ?? 40; floor.Q.value = M.musicTone.floor?.q ?? 0.707;
  musicIn.connect(floor).connect(eq).connect(duck).connect(bright);
  bright.connect(level); bright.connect(room).connect(wet).connect(level); level.connect(master);

  onProgress('Loading the instruments', 0);
  const inst = await createInstruments(ctx, musicIn);
  await inst.prepare(perf);
  // The performer's event order (src/audio/music/perform.js), all scheduled before rendering.
  /** @type {{t: number, kind: number, n?: any, p?: any}[]} */
  const ev = [];
  for (const n of perf.notes) { ev.push({ t: n.t, kind: 2, n }); ev.push({ t: n.t + n.dur, kind: 1, n }); }
  for (const p of perf.pedal) ev.push({ t: p.t, kind: p.down ? 3 : 0, p });
  ev.sort((a, b) => a.t - b.t || a.kind - b.kind);
  let missing = 0;
  for (const e of ev) {
    const at = LEAD_S + e.t;
    if (e.kind === 2) { if (!inst.set[e.n.instrument]?.noteOn(e.n.midi, e.n.vel, at)) missing++; }
    else if (e.kind === 1) inst.set[e.n.instrument]?.noteOff(e.n.midi, at);
    else inst.set[e.p.instrument]?.pedal(e.kind === 3, at);
  }
  // Progress: pause the render every few seconds of audio to report how far it has got.
  const total = len / SR;
  for (let t = 5; t < total - 0.1; t += 5) {
    ctx.suspend(t).then(() => { onProgress('Playing it through', t / total); ctx.resume(); });
  }
  onProgress('Playing it through', 0);
  const buf = await ctx.startRendering();
  return { channels: [buf.getChannelData(0), buf.getChannelData(1)], lastS: LEAD_S + lastEvent, missing };
}
