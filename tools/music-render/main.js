// @ts-check
// The music render page (tools/music-render.html): pick a season, slot, weather and seed (or a piece
// by name from the list), then Listen or Download WAV. The piece renders offline through the game's
// music chain (render.js), then is finished for sharing (finish.js): silence trimmed, loudness set
// to -18 LUFS with peaks under -1.5 dBFS.

import { SR, loadRecipes, compose, renderPiece } from './render.js';
import { trim, normalize, encodeWav, wavName, samplePeak, toDb } from './finish.js';
import { playIcon, stopIcon, downloadIcon } from './icons.js';

/** The finishing targets. */
const FINISH = { tailS: 2.75, fadeS: 0.3, targetLufs: -18, ceilingDb: -1.5, bits: /** @type {24} */ (24) };
/** How many seeds the list shows. */
const LIST_SEEDS = 40;
const SEASONS = [['spring', 'Spring'], ['summer', 'Summer']];
/** Each slot and the sun height (degrees) it plays at by default. */
const SLOTS = /** @type {[string, string, number][]} */ ([['morning', 'Morning', 20], ['interlude', 'Interlude', 35], ['evening', 'Evening', 6], ['nocturne', 'Nocturne', -20]]);
const WEATHER = [['clear', 'Clear'], ['rain', 'Rain'], ['mist', 'Mist']];

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** 116.4 → "1:56". @param {number} s */
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const url = new URL(location.href);
const state = {
  season: SEASONS.some(([id]) => id === url.searchParams.get('season')) ? /** @type {string} */ (url.searchParams.get('season')) : 'spring',
  slot: SLOTS.some(([id]) => id === url.searchParams.get('slot')) ? /** @type {string} */ (url.searchParams.get('slot')) : 'nocturne',
  weather: WEATHER.some(([id]) => id === url.searchParams.get('weather')) ? /** @type {string} */ (url.searchParams.get('weather')) : 'clear',
  seed: Math.max(1, Math.floor(Number(url.searchParams.get('seed')) || 4)),
  sun: 0,
};
state.sun = url.searchParams.has('sun') ? Number(url.searchParams.get('sun')) : /** @type {number} */ (SLOTS.find(([id]) => id === state.slot)?.[2]);

/** The finished piece for the current choice, kept so Download after Listen does not render again. */
/** @type {null | {key: string, name: string, title: string, form: string, channels: Float32Array[], lufs: number, peakDb: number, lengthS: number, trimmedS: number, missing: number}} */
let finished = null;
let busy = false;
/** @type {AudioContext | null} */ let audio = null;
/** @type {AudioBufferSourceNode | null} */ let source = null;
let raf = 0;

const keyOf = () => `${state.season}|${state.slot}|${state.weather}|${state.seed}|${state.sun}`;

/** @param {string} group @param {string[][]} items @param {string} on */
function segButtons(group, items, on) {
  $(group).innerHTML = items.map(([id, label]) => `<button data-id="${id}" aria-pressed="${id === on}">${label}</button>`).join('');
}

function syncControls() {
  segButtons('season', SEASONS, state.season);
  segButtons('slot', SLOTS.map(([id, label]) => [id, label]), state.slot);
  segButtons('weather', WEATHER, state.weather);
  /** @type {HTMLInputElement} */ ($('seed')).value = String(state.seed);
  /** @type {HTMLInputElement} */ ($('sun')).value = String(state.sun);
  $('sun-out').textContent = `${state.sun} degrees`;
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(state)) u.searchParams.set(k, String(v));
  history.replaceState(null, '', u);
}

/** @type {Awaited<ReturnType<typeof loadRecipes>>} */
let R;
let listToken = 0;

/** The list of seeds for this season, slot and weather: title, form and length, grown a few at a time. */
async function fillList() {
  const token = ++listToken;
  const host = $('list');
  host.innerHTML = '';
  for (let seed = 1; seed <= LIST_SEEDS; seed++) {
    if (token !== listToken) return;
    const c = compose(R, { ...state, seed });
    const b = document.createElement('button');
    b.className = 'piece';
    b.dataset.seed = String(seed);
    b.setAttribute('aria-pressed', String(seed === state.seed));
    b.innerHTML = `<span class="seed">${seed}</span><b>${esc(c.title)}</b><span class="meta">${esc(c.form)}, ${esc(c.meter)}, about ${clock(c.lengthS + FINISH.tailS)}</span>`;
    host.append(b);
    if (seed % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

function markList() {
  for (const b of $('list').querySelectorAll('.piece')) b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.seed) === state.seed));
}

function showChoice() {
  const c = compose(R, state);
  $('title').textContent = c.title;
  $('choice-meta').textContent = `${c.form}, ${c.meter}, seed ${state.seed}, about ${clock(c.lengthS + FINISH.tailS)}`;
  if (finished?.key !== keyOf()) $('result').hidden = true;
}

/** @param {string} text @param {number} [fraction] */
function progress(text, fraction) {
  $('status').textContent = text;
  /** @type {HTMLElement} */ ($('bar').firstElementChild).style.width = fraction === undefined ? '0' : `${Math.round(fraction * 100)}%`;
}

/** Render and finish the current choice, or reuse it if nothing changed. */
async function make() {
  if (finished?.key === keyOf()) return finished;
  const key = keyOf();
  const t0 = performance.now();
  const c = compose(R, state);
  const r = await renderPiece(R, c, (stage, f) => progress(`${stage}...`, f));
  progress('Finishing...', 1);
  await new Promise((res) => setTimeout(res, 0));
  const t = trim(r.channels, SR, { lastS: r.lastS, tailS: FINISH.tailS, fadeS: FINISH.fadeS });
  const n = normalize(t.channels, SR, { targetLufs: FINISH.targetLufs, ceilingDb: FINISH.ceilingDb });
  const lengthS = n.channels[0].length / SR;
  finished = {
    key, title: c.title, form: c.form, channels: n.channels, lufs: n.after, peakDb: toDb(samplePeak(n.channels)),
    lengthS, trimmedS: r.channels[0].length / SR - lengthS, missing: r.missing,
    name: wavName({ season: state.season, slot: state.slot, weather: state.weather, seed: state.seed, title: c.title }),
  };
  const took = (performance.now() - t0) / 1000;
  $('lufs').textContent = `${finished.lufs.toFixed(1)} LUFS`;
  $('peak').textContent = `${finished.peakDb.toFixed(1)} dBFS`;
  $('length').textContent = `${clock(lengthS)} (${lengthS.toFixed(1)} s)`;
  $('took').textContent = `${took.toFixed(1)} s`;
  $('fname').textContent = finished.name;
  $('missing').hidden = !finished.missing;
  $('missing').textContent = `${finished.missing} notes had no instrument and were left out.`;
  $('result').hidden = false;
  progress(`Ready: rendered in ${took.toFixed(1)} s.`, 1);
  return finished;
}

function stopPlaying() {
  if (source) { source.onended = null; try { source.stop(); } catch { /* already stopped */ } source = null; }
  cancelAnimationFrame(raf);
  setListenButton(false);
}

/** @param {boolean} playing */
function setListenButton(playing) {
  $('listen').innerHTML = `${playing ? stopIcon() : playIcon()}<span>${playing ? 'Stop' : 'Listen'}</span>`;
}

async function listen() {
  if (source) { stopPlaying(); progress('Stopped.'); return; }
  if (busy) return;
  busy = true; setBusy(true);
  try {
    audio ??= new AudioContext({ sampleRate: SR });
    await audio.resume();
    const f = await make();
    const buf = audio.createBuffer(2, f.channels[0].length, SR);
    buf.getChannelData(0).set(f.channels[0]); buf.getChannelData(1).set(f.channels[1]);
    source = audio.createBufferSource();
    source.buffer = buf;
    source.connect(audio.destination);
    const start = audio.currentTime + 0.05;
    source.start(start);
    source.onended = () => { stopPlaying(); progress(`Played "${f.title}" to the end.`, 1); };
    setListenButton(true);
    const tick = () => {
      if (!source || !audio) return;
      const t = Math.max(0, Math.min(f.lengthS, audio.currentTime - start));
      progress(`Playing "${f.title}": ${clock(t)} of ${clock(f.lengthS)}`, t / f.lengthS);
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    progress(`Something went wrong: ${/** @type {Error} */ (e).message}`);
    console.error(e);
  } finally {
    busy = false; setBusy(false);
  }
}

async function download() {
  if (busy) return;
  busy = true; setBusy(true);
  try {
    const f = await make();
    const blob = new Blob([encodeWav(f.channels, SR, FINISH.bits)], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    progress(`Saved ${f.name} to your downloads folder.`, 1);
  } catch (e) {
    progress(`Something went wrong: ${/** @type {Error} */ (e).message}`);
    console.error(e);
  } finally {
    busy = false; setBusy(false);
  }
}

/** @param {boolean} on */
function setBusy(on) {
  /** @type {HTMLButtonElement} */ ($('download')).disabled = on;
  /** @type {HTMLButtonElement} */ ($('listen')).disabled = on && !source;
}

/** A change to the choice: stop playback, update the page. @param {boolean} refill whether the list changes */
function changed(refill) {
  stopPlaying();
  syncControls();
  showChoice();
  if (refill) fillList(); else markList();
}

async function init() {
  setListenButton(false);
  $('download').innerHTML = `${downloadIcon()}<span>Download WAV</span>`;
  syncControls();
  progress('Loading the music recipes...');
  R = await loadRecipes();
  showChoice();
  progress('Pick a piece, then Listen or Download WAV.');
  fillList();

  $('season').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-id]');
    if (b && !busy) { state.season = /** @type {string} */ (b.getAttribute('data-id')); changed(true); }
  });
  $('slot').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-id]');
    if (!b || busy) return;
    state.slot = /** @type {string} */ (b.getAttribute('data-id'));
    state.sun = /** @type {number} */ (SLOTS.find(([id]) => id === state.slot)?.[2]);
    changed(true);
  });
  $('weather').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-id]');
    if (b && !busy) { state.weather = /** @type {string} */ (b.getAttribute('data-id')); changed(true); }
  });
  $('seed').addEventListener('change', () => {
    const v = Math.max(1, Math.floor(Number(/** @type {HTMLInputElement} */ ($('seed')).value) || 1));
    if (!busy) { state.seed = v; changed(false); } else syncControls();
  });
  // The sun sets the tempo, so the lengths in the list change with it; the list is regrown on release.
  $('sun').addEventListener('input', () => { $('sun-out').textContent = `${/** @type {HTMLInputElement} */ ($('sun')).value} degrees`; });
  $('sun').addEventListener('change', () => {
    if (busy) { syncControls(); return; }
    state.sun = Number(/** @type {HTMLInputElement} */ ($('sun')).value);
    changed(true);
  });
  $('list').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('.piece');
    if (b && !busy) { state.seed = Number(/** @type {HTMLElement} */ (b).dataset.seed); changed(false); }
  });
  $('listen').addEventListener('click', listen);
  $('download').addEventListener('click', download);
}

init().catch((e) => { progress(`Could not start: ${e.message}`); console.error(e); });
