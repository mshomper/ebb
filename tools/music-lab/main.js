// @ts-check
// Music lab, phase 1: the instrument bench (doc 24, "The music lab"). Two slots, A and B, each
// holding one instrument; the keys, tests and charts play whichever slot is lit. Every setting
// starts from the recipes and changes live; nothing here is saved, Matt notes what he likes.

import { createMixer } from '../../src/audio/mixer.js';
import { createSampler, pickFormat } from '../../src/audio/music/sampler.js';
import { createFmPiano } from '../../src/audio/music/synth.js';
import { loadAudioRecipe, samplerSettingsFor } from '../../src/audio/recipes.js';
import { evenBounds, midiToHz } from '../../src/audio/music/sampler-math.js';
import { createKeyboard, noteName } from './keyboard.js';
import { createLayerChart, createTuningChart } from './charts.js';
import * as T from './tests.js';

const INSTRUMENTS = [
  { id: 'piano-steinway-b', label: 'Steinway B grand' },
  { id: 'fm-piano-code', label: 'FM piano, built in code' },
];

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const tier = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700 ? 'mobile' : 'desktop';

const [mixerRecipe, samplerRecipe, synthRecipe, pedalRecipe] = await Promise.all([
  loadAudioRecipe('audio/mixer'), loadAudioRecipe('music/sampler'), loadAudioRecipe('music/synth'),
  loadAudioRecipe('music/instruments/pedal-knight').catch(() => null),
]);
const mixer = createMixer(mixerRecipe, { tier });
const ctx = mixer.ctx;
const out = mixer.input('music');

$('unlock-btn').addEventListener('click', async () => {
  await mixer.unlock();
  $('unlock').hidden = true;
});

// ---------------- budget options (applied when a slot loads) ----------------

// Phones start light: a full piano decoded is hundreds of megabytes.
// Phones unpack two octaves of pedal recordings by default; desktop all five octaves, both sets.
const budget = { range: tier === 'mobile' ? 'piece' : 'mid', sets: tier === 'mobile' ? 'sus' : 'all' };
for (const [attr, key] of /** @type {const} */ ([['data-range', 'range']])) {
  const btns = [...document.querySelectorAll(`[${attr}]`)];
  for (const o of btns) o.setAttribute('aria-pressed', String(o.getAttribute(attr) === String(/** @type {any} */ (budget)[key])));
  for (const b of btns) b.addEventListener('click', () => {
    for (const o of btns) o.setAttribute('aria-pressed', String(o === b));
    const v = b.getAttribute(attr) ?? '';
    /** @type {any} */ (budget)[key] = key === 'tail' || key === 'mono' ? Number(v) : v;
  });
}

// ---------------- slots ----------------

/** @typedef {{id: string, inst: any, recipe: any|null}} Loaded */
/** @type {{a: Loaded|null, b: Loaded|null}} */
const slots = { a: null, b: null };
let active = /** @type {'a'|'b'} */ ('a');

for (const s of ['a', 'b']) {
  const pick = $(`pick-${s}`);
  for (const i of INSTRUMENTS) pick.add(new Option(i.label, i.id));
  pick.value = s === 'a' ? 'piano-steinway-b' : 'fm-piano-code';
  pick.addEventListener('change', () => loadSlot(/** @type {'a'|'b'} */ (s), pick.value));
}

/** Build an instrument, applying the bench's current settings. @param {string} id @param {(f: number) => void} progress */
async function build(id, progress) {
  if (id === 'fm-piano-code') {
    const synth = createFmPiano(ctx, out, synthRecipe, { tier });
    progress(1);
    return { inst: synth, recipe: null };
  }
  const recipe = await loadAudioRecipe(`music/instruments/${id}`);
  const settings = samplerSettingsFor(samplerRecipe, id);
  // Phones unpack only the pedal recordings, to stay light (the game's phone set comes later).
  if (budget.sets === 'sus' && recipe.sets?.sus) settings.load.sets = ['sus', 'rel'];
  applyLive(settings);
  const inst = createSampler(ctx, out, recipe, settings, { tier, pedalNoise: pedalRecipe });
  const range = budget.range === 'piece' ? { low: 53, high: 79 } : { low: 33, high: 99 };
  await inst.load({ ...range, onProgress: (d, n) => progress(d / n) });
  return { inst, recipe };
}

/** @param {'a'|'b'} s @param {string} id */
async function loadSlot(s, id) {
  slots[s]?.inst.stopAll(0.2);
  slots[s] = null;
  $(`state-${s}`).textContent = 'loading';
  $(`prog-${s}`).style.width = '0%';
  try {
    const r = await build(id, (f) => { $(`prog-${s}`).style.width = `${Math.round(f * 100)}%`; });
    if ($(`pick-${s}`).value !== id) return; // changed again while loading
    slots[s] = { id, ...r };
    $(`state-${s}`).textContent = 'ready';
    showProblems();
    if (s === active) refreshCharts();
  } catch (e) {
    console.error(e);
    $(`state-${s}`).textContent = 'could not load (see the note below)';
    showProblem(`${INSTRUMENTS.find((i) => i.id === id)?.label}: ${e instanceof Error ? e.message : e}. The samples may not be prepared yet.`);
  }
}

function setActive(/** @type {'a'|'b'} */ s) {
  slots[active]?.inst.stopAll(0.15);
  active = s;
  $('slot-a').classList.toggle('on', s === 'a');
  $('slot-b').classList.toggle('on', s === 'b');
  $('swap').textContent = s === 'a' ? 'Switch to B' : 'Switch to A';
  refreshCharts();
}
$('swap').addEventListener('click', () => setActive(active === 'a' ? 'b' : 'a'));
$('slot-a').addEventListener('click', (/** @type {Event} */ e) => { if (!(e.target instanceof HTMLSelectElement)) setActive('a'); });
$('slot-b').addEventListener('click', (/** @type {Event} */ e) => { if (!(e.target instanceof HTMLSelectElement)) setActive('b'); });

/** The instrument in the lit slot, or a silent stand-in while it loads. */
function cur() {
  return slots[active]?.inst ?? { noteOn() { return 0; }, noteOff() {}, pedal() {}, stopAll() {}, settings: null, zones: () => [], stats: () => null };
}

// ---------------- live settings from the sliders ----------------

/** @param {any} s sampler settings, changed in place */
function applyLive(s) {
  s.layers.fadeWidth = Number($('fade').value);
  s.layers.law = Number($('law').value);
  if (blendMode) s.layers.blend = blendMode;
  s.velocity.floorDb = Number($('v-floor').value);
  s.velocity.topDb = Number($('v-top').value);
  s.velocity.gamma = Number($('v-gamma').value);
  if (s.dampers.undampedFromMidi < 128) {
    s.dampers.bassS = Number($('d-bass').value);
    s.dampers.trebleS = Number($('d-treble').value);
  }
  s.release.db = Number($('rel-db').value);
  s.pedalNoise = { ...(s.pedalNoise ?? {}), on: pedalNoiseOn, db: Number($('pn-db').value) };
  s.tuning.policy = tuningPolicy;
}
function pushLive() {
  for (const s of /** @type {const} */ (['a', 'b'])) {
    const L = slots[s];
    if (!L || !L.recipe) continue;
    const next = structuredClone(L.inst.settings);
    applyLive(next);
    L.inst.setSettings(next);
  }
  refreshCharts();
}

/** @param {string} id @param {(v: number) => string} fmt @param {() => void} [after] */
function slider(id, fmt, after = pushLive) {
  const i = $(id), o = $(`${id}-out`);
  const show = () => { o.textContent = fmt(Number(i.value)); };
  i.addEventListener('input', () => { show(); after(); });
  show();
}
const DYN = (/** @type {number} */ v) => (v < 25 ? 'pp' : v < 41 ? 'p' : v < 57 ? 'mp' : v < 73 ? 'mf' : v < 89 ? 'f' : 'ff');
$('law').value = String(samplerRecipe.defaults.layers.law ?? 0.5);
slider('vel', (v) => `${v}, ${DYN(v)}`, () => {});
slider('fade', (v) => `${v} steps`);
slider('law', (v) => v.toFixed(2));
slider('v-floor', (v) => `${v} dB`);
slider('v-top', (v) => `${v} dB`);
slider('v-gamma', (v) => v.toFixed(2));
slider('d-bass', (v) => `${v.toFixed(2)} s`);
slider('d-treble', (v) => `${v.toFixed(2)} s`);
slider('rel-db', (v) => `${v} dB`);
slider('m-vol', (v) => v.toFixed(2), () => mixer.setBusLevel('music', Number($('m-vol').value)));
slider('m-wet', (v) => v.toFixed(2), () => mixer.setMusicTone({ wet: Number($('m-wet').value) }, 0.2));
slider('m-bright', (v) => `${(v / 1000).toFixed(1)} kHz`, () => mixer.setMusicTone({ lowpassHz: Number($('m-bright').value) }, 0.2));
slider('pn-db', (v) => `${v} dB`);

/** @param {string[]} ids @param {(id: string) => void} fn */
function seg(ids, fn) {
  for (const id of ids) $(id).addEventListener('click', () => { for (const o of ids) $(o).setAttribute('aria-pressed', String(o === id)); fn(id); });
}
let velFromHeight = false;
/** @type {'mix'|'pick'|null} null keeps each instrument's own setting until the switch is used */
let blendMode = null;
seg(['bl-mix', 'bl-pick'], (id) => { blendMode = id === 'bl-mix' ? 'mix' : 'pick'; pushLive(); });
seg(['touch-fixed', 'touch-height'], (id) => { velFromHeight = id === 'touch-height'; });
let tuningPolicy = /** @type {'recorded'|'equal'|'stretch'} */ (samplerRecipe.defaults.tuning.policy);
for (const p of ['recorded', 'equal', 'stretch']) $(`tu-${p}`).setAttribute('aria-pressed', String(p === tuningPolicy));
seg(['tu-recorded', 'tu-equal', 'tu-stretch'], (id) => { tuningPolicy = /** @type {any} */ (id.slice(3)); pushLive(); });

// ---------------- pedal mechanism sound (from the Knight upright's recordings) ----------------

// The pedal mechanism's sound lives in the sampler (recipe pedalNoise); these switch it live.
let pedalNoiseOn = samplerRecipe.defaults.pedalNoise?.on ?? false;
$('pn-off').setAttribute('aria-pressed', String(!pedalNoiseOn));
$('pn-on').setAttribute('aria-pressed', String(pedalNoiseOn));
seg(['pn-off', 'pn-on'], (id) => { pedalNoiseOn = id === 'pn-on'; pushLive(); });

/** The lit instrument, with the pedal noise following its pedal. */
const playable = {
  noteOn: (/** @type {number} */ m, /** @type {number} */ v, /** @type {number|undefined} */ w) => cur().noteOn(m, v, w),
  noteOff: (/** @type {number} */ m, /** @type {number|undefined} */ w) => cur().noteOff(m, w),
  pedal: (/** @type {boolean} */ d, /** @type {number|undefined} */ w) => cur().pedal(d, w),
  stopAll: (/** @type {number|undefined} */ f) => cur().stopAll(f),
};

// ---------------- keys and pedal ----------------

const kb = createKeyboard($('keys'), {
  onDown: (m, v) => playable.noteOn(m, v),
  onUp: (m) => playable.noteOff(m),
  onPedal: (d) => { $('pedal').classList.toggle('down', d); playable.pedal(d); },
  velocity: () => Number($('vel').value),
  velocityFromHeight: () => velFromHeight,
  onVelocityNudge: (d) => { $('vel').value = String(Math.max(1, Math.min(127, Number($('vel').value) + d))); $('vel').dispatchEvent(new Event('input')); },
  onOctave: (low) => { $('oct-label').textContent = `Lowest key shown: ${noteName(low)}`; },
  onSwap: () => setActive(active === 'a' ? 'b' : 'a'),
});
$('oct-down').addEventListener('click', () => kb.shift(-12));
$('oct-up').addEventListener('click', () => kb.shift(12));
const pedalBtn = $('pedal');
pedalBtn.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { pedalBtn.setPointerCapture(e.pointerId); pedalBtn.classList.add('down'); playable.pedal(true); });
for (const ev of ['pointerup', 'pointercancel']) pedalBtn.addEventListener(ev, () => { pedalBtn.classList.remove('down'); playable.pedal(false); });

// ---------------- charts ----------------

const layerChart = createLayerChart($('layer-chart'));
const tuneChart = createTuningChart($('tune-chart'), (z) => referenceTone(z));
const player = createPlayer();

function refreshCharts() {
  const L = slots[active];
  const s = L?.inst.settings;
  if (s?.layers?.blend) for (const [id, m] of [['bl-mix', 'mix'], ['bl-pick', 'pick']]) $(id).setAttribute('aria-pressed', String(s.layers.blend === m));
  const layers = L?.recipe?.layers ?? 3;
  const bounds = s?.layers?.bounds?.length === layers - 1 ? s.layers.bounds : evenBounds(layers);
  layerChart.draw(layers, bounds, Number($('fade').value), Number($('law').value));
  if (!L?.recipe) {
    tuneChart.draw([], tuningPolicy, samplerRecipe.defaults.tuning);
    $('tune-summary').textContent = L ? 'Built in code: tuned exactly by design.' : '';
    return;
  }
  const set = L.recipe.sets.sus ? 'sus' : Object.keys(L.recipe.sets)[0];
  const zones = L.recipe.sets[set].zones;
  tuneChart.draw(zones, tuningPolicy, s.tuning);
  const ms = zones.map((/** @type {any} */ z) => z.measuredCents).filter(Number.isFinite);
  if (ms.length) {
    const abs = ms.map(Math.abs).sort((a, b) => a - b);
    const within = ms.filter((/** @type {number} */ c) => Math.abs(c) <= 3).length;
    $('tune-summary').textContent = `As recorded: ${within} of ${ms.length} notes within 3 cents of equal temperament; typical offset ${abs[Math.floor(abs.length / 2)].toFixed(1)} cents, largest ${abs[abs.length - 1].toFixed(1)}.`;
  }
}

/** Play a recorded note with a pure sine at its exact equal-tempered pitch: any beating is mistuning. @param {any} z */
function referenceTone(z) {
  const t = ctx.currentTime + 0.05;
  playable.noteOn(z.midi, 64, t);
  playable.noteOff(z.midi, t + 2.5);
  const o = ctx.createOscillator();
  o.frequency.value = midiToHz(z.midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t + 0.6);
  g.gain.linearRampToValueAtTime(0.05, t + 0.8);
  g.gain.setTargetAtTime(0, t + 3, 0.1);
  o.connect(g).connect(out);
  o.start(t + 0.6);
  o.stop(t + 3.6);
}

// ---------------- tests ----------------

function createPlayer() {
  return T.createPlayer(ctx, (m) => layerChart.cursor(m));
}
const noteSel = $('sweep-note');
for (const m of [36, 48, 55, 60, 67, 72, 79, 84, 91]) noteSel.add(new Option(noteName(m), String(m)));
noteSel.value = '60';
const run = (/** @type {() => any[]} */ make) => () => player.play(make(), playable);
$('sweep').addEventListener('click', run(() => T.sweep(Number(noteSel.value))));
$('sweep-fine').addEventListener('click', run(() => {
  const L = slots[active];
  const layers = L?.recipe?.layers ?? 3;
  const s = L?.inst.settings;
  return T.sweepFine(Number(noteSel.value), s?.layers?.bounds?.length === layers - 1 ? s.layers.bounds : evenBounds(layers));
}));
$('t-pedal').addEventListener('click', run(T.pedalTest));
$('t-staccato').addEventListener('click', run(T.staccato));
$('t-repeat').addEventListener('click', run(T.repeats));
$('t-register').addEventListener('click', run(T.register));
$('t-steal').addEventListener('click', run(T.cascade));
$('tu-octaves').addEventListener('click', run(T.octaves));
$('tu-chords').addEventListener('click', run(T.wideChords));
$('stop').addEventListener('click', () => player.stop());
$('phrase-a').addEventListener('click', () => { setActive('a'); player.play(T.phrase(), playable); });
$('phrase-b').addEventListener('click', () => { setActive('b'); player.play(T.phrase(), playable); });
$('phrase-ab').addEventListener('click', async () => {
  setActive('a');
  await player.play(T.phrase(), playable);
  await new Promise((r) => setTimeout(r, 900));
  setActive('b');
  await player.play(T.phrase(), playable);
});
$('reload').addEventListener('click', () => { loadSlot('a', $('pick-a').value); loadSlot('b', $('pick-b').value); });

// ---------------- readouts and notes ----------------

setInterval(() => {
  const st = cur().stats?.();
  const all = [slots.a, slots.b].map((s) => s?.inst.stats?.()).filter(Boolean);
  $('t-voices').textContent = st ? String(st.voices) : '0';
  $('t-mem').textContent = `${all.reduce((n, x) => n + x.decodedMB, 0).toFixed(0)} MB`;
  $('t-down').textContent = `${all.reduce((n, x) => n + (x.downloadedMB ?? 0), 0).toFixed(1)} MB`;
  $('t-fmt').textContent = st ? (st.format === 'ogg' ? 'Opus' : st.format === 'm4a' ? 'AAC' : st.format) : '-';
}, 250);

/** @type {Set<string>} */
const problems = new Set();
/** @param {string} p */
function showProblem(p) {
  problems.add(p);
  $('problem-list').replaceChildren(...[...problems].map((x) => Object.assign(document.createElement('li'), { textContent: x })));
  $('problems').hidden = false;
}
function showProblems() {
  for (const s of [slots.a, slots.b]) for (const p of s?.recipe?.problems ?? []) showProblem(`${s?.recipe?.name}: ${p}`);
}

if (pickFormat() === 'm4a') showProblem('This browser cannot play Opus files. The Steinway\'s AAC copies arrive with its game set; until then, please listen in Chrome, Edge or Firefox.');
refreshCharts();
loadSlot('a', $('pick-a').value);
loadSlot('b', $('pick-b').value);

// ---------------- tabs: Instruments, Piece, Day ----------------

/** @type {Record<string, Promise<void> | null>} */
const started = { piece: null, day: null };
/** @param {string} name */
function showTab(name) {
  if (!['bench', 'piece', 'day'].includes(name)) name = 'bench';
  for (const t of ['bench', 'piece', 'day']) {
    $(`tab-${t}`).hidden = t !== name;
    document.querySelector(`[data-tab="${t}"]`)?.setAttribute('aria-pressed', String(t === name));
  }
  if (name !== 'bench') {
    slots.a?.inst.stopAll(0.2);
    slots.b?.inst.stopAll(0.2);
  }
  if (name === 'piece' && !started.piece) started.piece = import('./piece.js').then((m) => m.initPiece($('tab-piece'), { mixer })).catch((e) => showProblem(`Piece tab: ${e.message}`));
  if (name === 'day' && !started.day) started.day = import('./day.js').then((m) => m.initDay($('tab-day'))).catch((e) => showProblem(`Day tab: ${e.message}`));
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
}
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.getAttribute('data-tab') ?? 'bench'));
showTab(location.hash.slice(1) || 'bench');
