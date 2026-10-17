// @ts-check
// Palette lab, version 1 (docs/05 "Tuning knobs"): the real island with a before and after split,
// an eyedropper for anchor "from" colors, sliders for every anchor and grade number, and Copy or
// Download of the working palette as JSON. The page never writes the recipe file.
//
// Uses from startApp's result: palette.current(), palette.apply(json, fadeS), palette.list(),
// pickColor(cssX, cssY). The split goes through the store slice `preview` (preview.split, 0..1 or
// null); time preview through clock.setDisplayOverride, as in sky-lab.

import * as clock from '../src/core/clock.js';
import { update } from '../src/core/store.js';

const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const ARROW = '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12H19"/><path d="M14 7L19 12L14 17"/></svg>';
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const DAYS_PER_YEAR = clock.DAYS_PER_SEASON * clock.SEASONS_PER_YEAR;
const FALLBACK_LIST = [{ id: 'dusk', name: 'Dusk' }, { id: 'meadow-morning', name: 'Meadow morning' }];
/** Live edits re-bake at most this often (about 10 Hz). */
const APPLY_MS = 100;

/**
 * @typedef {{ role: string, from: string, to: string, radius: number, strength: number }} Anchor
 * @typedef {{ id: string, name?: string, keepLuminance?: number, anchors?: Anchor[],
 *   grade?: Record<string, any>, look?: Record<string, any>, [k: string]: any }} Palette
 * @typedef {{ current: () => Palette, apply: (json: Palette, fadeS?: number) => any,
 *   list: () => {id: string, name: string}[] }} PaletteApi
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const stage = $('stage');
const paletteSel = /** @type {HTMLSelectElement} */ ($('palette'));
const splitOnBtn = /** @type {HTMLButtonElement} */ ($('split-on'));
const splitEl = $('split');
const splitLine = $('split-line');
const splitGrab = $('split-grab');
const splitKnob = $('split-knob');
const hourIn = /** @type {HTMLInputElement} */ ($('hour'));
const dayIn = /** @type {HTMLInputElement} */ ($('day'));
const weatherSel = /** @type {HTMLSelectElement} */ ($('weather'));
const followBtn = /** @type {HTMLButtonElement} */ ($('follow'));
const pickBtn = /** @type {HTMLButtonElement} */ ($('pick'));
const pickLayer = $('pick-layer');
const pickMark = $('pick-mark');
const pickRole = /** @type {HTMLSelectElement} */ ($('pick-role'));
const pickUse = /** @type {HTMLButtonElement} */ ($('pick-use'));
const anchorsEl = $('anchors');
const globalsEl = $('globals');
const copiedEl = $('copied');
const dirtyEl = $('dirty');

/** @type {PaletteApi | null} */
let api = null;
/** @type {((x: number, y: number) => Promise<string>) | null} */
let pickColor = null;
/** The palette being edited. @type {Palette | null} */
let working = null;
/** @type {{id: string, name: string}[]} */
let paletteList = FALLBACK_LIST;
let edited = false;

// ---------- small helpers ----------

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** "#abc" or "#AABBCC" or "aabbcc" to "#AABBCC"; null if it is not a hex color. @param {unknown} s */
function normHex(s) {
  if (typeof s !== 'string') return null;
  let h = s.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{8}$/i.test(h)) h = h.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toUpperCase()}` : null;
}

/** sRGB hex to OKLab (Ottosson). @param {string} hex @returns {[number, number, number]} */
function oklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (/** @type {number} */ c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(((n >> 16) & 255) / 255);
  const g = lin(((n >> 8) & 255) / 255);
  const b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @param {string} a @param {string} b */
function labDistance(a, b) {
  const p = oklab(a);
  const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** @param {string} tag @param {string} [cls] @param {string} [html] */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** @param {string} s */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

let uid = 0;

/**
 * A labelled range slider with its value shown beside the label.
 * @param {{ label: string, min: number, max: number, step: number, value: number,
 *   digits?: number, onInput: (v: number) => void }} o
 */
function slider(o) {
  const id = `s${++uid}`;
  const field = el('div', 'field');
  field.innerHTML =
    `<div class="row"><label for="${id}">${esc(o.label)}</label><output for="${id}"></output></div>` +
    `<input id="${id}" type="range" min="${o.min}" max="${o.max}" step="${o.step}">`;
  const input = /** @type {HTMLInputElement} */ (field.querySelector('input'));
  const out = /** @type {HTMLOutputElement} */ (field.querySelector('output'));
  const digits = o.digits ?? 2;
  input.value = String(clamp(o.value, o.min, o.max));
  out.textContent = Number(o.value).toFixed(digits);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(digits);
    o.onInput(v);
  });
  return field;
}

/**
 * A labelled color input with its hex beside it.
 * @param {{ label: string, value: string, onInput: (hex: string) => void }} o
 */
function colorField(o) {
  const id = `c${++uid}`;
  const field = el('div', 'field');
  const hex = normHex(o.value) ?? '#808080';
  field.innerHTML =
    `<label for="${id}">${esc(o.label)}</label>` +
    `<div class="actions"><input id="${id}" type="color" value="${hex.toLowerCase()}"><span class="hex">${hex}</span></div>`;
  const input = /** @type {HTMLInputElement} */ (field.querySelector('input'));
  const text = /** @type {HTMLElement} */ (field.querySelector('.hex'));
  input.addEventListener('input', () => {
    const h = normHex(input.value) ?? hex;
    text.textContent = h;
    o.onInput(h);
  });
  return field;
}

// ---------- applying edits ----------

/** @type {ReturnType<typeof setTimeout> | null} */
let applyTimer = null;

/** Push the working palette to the island at once (fade in seconds). @param {number} fadeS */
function applyNow(fadeS) {
  if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
  if (!api || !working) return;
  try {
    const r = api.apply(structuredClone(working), fadeS);
    if (r && typeof r.catch === 'function') r.catch((/** @type {unknown} */ e) => console.warn('[palette-lab] apply failed', e));
  } catch (err) {
    console.warn('[palette-lab] apply failed', err);
  }
}

/** A live edit: mark the page edited and re-bake, at most about 10 times a second. */
function edit() {
  setEdited(true);
  if (applyTimer) return;
  applyTimer = setTimeout(() => { applyTimer = null; applyNow(0); }, APPLY_MS);
}

/** @param {boolean} on */
function setEdited(on) {
  edited = on;
  dirtyEl.textContent = on
    ? 'Edited in this page. Copy or download the JSON to keep it.'
    : 'Matches the saved palette file.';
}

// ---------- the editor ----------

function buildEditor() {
  anchorsEl.textContent = '';
  globalsEl.textContent = '';
  pickRole.textContent = '';
  if (!working) {
    anchorsEl.append(el('p', 'muted', 'No palette loaded yet.'));
    globalsEl.append(el('p', 'muted', 'No palette loaded yet.'));
    refreshPickUse();
    return;
  }
  const p = working;
  p.anchors = Array.isArray(p.anchors) ? p.anchors : [];
  p.grade = p.grade && typeof p.grade === 'object' ? p.grade : {};
  p.look = p.look && typeof p.look === 'object' ? p.look : {};

  if (!p.anchors.length) anchorsEl.append(el('p', 'muted', 'This palette has no anchors.'));
  p.anchors.forEach((a, i) => {
    const from = normHex(a.from) ?? '#808080';
    const card = el('div', 'anchor');
    card.dataset.index = String(i);
    card.append(el('h3', '', esc(a.role ?? `anchor ${i + 1}`)));
    const colors = el('div', 'anchor__colors');
    colors.innerHTML =
      `<span class="pair"><span class="swatch" data-from-swatch style="background:${from}"></span>` +
      `<span><span class="muted">from</span><br><span class="hex" data-from-hex>${from}</span></span></span>${ARROW}`;
    const toHex = normHex(a.to) ?? '#808080';
    const toId = `c${++uid}`;
    const to = el('span', 'pair',
      `<input id="${toId}" type="color" value="${toHex.toLowerCase()}" aria-label="${esc(a.role ?? 'anchor')} to color">` +
      `<label for="${toId}"><span class="muted">to</span><br><span class="hex">${toHex}</span></label>`);
    const toIn = /** @type {HTMLInputElement} */ (to.querySelector('input'));
    const toTx = /** @type {HTMLElement} */ (to.querySelector('.hex'));
    toIn.addEventListener('input', () => {
      const h = normHex(toIn.value) ?? toHex;
      toTx.textContent = h;
      a.to = h;
      edit();
    });
    colors.append(to);
    card.append(colors);
    card.append(slider({ label: 'Radius', min: 0.01, max: 0.5, step: 0.005, digits: 3, value: num(a.radius, 0.1),
      onInput: (v) => { a.radius = v; edit(); } }));
    card.append(slider({ label: 'Strength', min: 0, max: 1, step: 0.01, value: num(a.strength, 0.35),
      onInput: (v) => { a.strength = v; edit(); } }));
    anchorsEl.append(card);

    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = a.role ?? `anchor ${i + 1}`;
    pickRole.append(opt);
  });

  /** @param {string} title @param {HTMLElement[]} fields */
  const group = (title, fields) => {
    globalsEl.append(el('h3', 'group-title', esc(title)));
    const box = el('div', 'controls');
    box.append(...fields);
    globalsEl.append(box);
  };
  const g = p.grade;
  const lk = p.look;
  group('Light and grade', [
    slider({ label: 'Keep luminance', min: 0, max: 1, step: 0.01, value: num(p.keepLuminance, 0.9),
      onInput: (v) => { p.keepLuminance = v; edit(); } }),
    slider({ label: 'Lift', min: -0.1, max: 0.2, step: 0.005, digits: 3, value: num(g.lift, 0), onInput: (v) => { g.lift = v; edit(); } }),
    slider({ label: 'Gamma', min: 0.5, max: 2, step: 0.01, value: num(g.gamma, 1), onInput: (v) => { g.gamma = v; edit(); } }),
    slider({ label: 'Gain', min: 0.5, max: 1.5, step: 0.01, value: num(g.gain, 1), onInput: (v) => { g.gain = v; edit(); } }),
    slider({ label: 'Chroma', min: 0, max: 2, step: 0.01, value: num(g.chroma, 1), onInput: (v) => { g.chroma = v; edit(); } }),
    slider({ label: 'Shadow tint amount', min: 0, max: 1, step: 0.01, value: num(g.shadowAmt, 0), onInput: (v) => { g.shadowAmt = v; edit(); } }),
    colorField({ label: 'Shadow tint', value: g.shadowTint ?? '#5E6E7D', onInput: (h) => { g.shadowTint = h; edit(); } }),
    slider({ label: 'Highlight tint amount', min: 0, max: 1, step: 0.01, value: num(g.highlightAmt, 0), onInput: (v) => { g.highlightAmt = v; edit(); } }),
    colorField({ label: 'Highlight tint', value: g.highlightTint ?? '#FBF1DC', onInput: (h) => { g.highlightTint = h; edit(); } }),
  ]);
  group('Look (AgX)', [
    slider({ label: 'Slope', min: 0.5, max: 2, step: 0.01, value: num(lk.slope, 1), onInput: (v) => { lk.slope = v; edit(); } }),
    slider({ label: 'Power', min: 0.5, max: 2, step: 0.01, value: num(lk.power, 1), onInput: (v) => { lk.power = v; edit(); } }),
    slider({ label: 'Saturation', min: 0, max: 2, step: 0.01, value: num(lk.saturation, 1), onInput: (v) => { lk.saturation = v; edit(); } }),
  ]);
  refreshPickUse();
}

/** @param {unknown} v @param {number} fallback */
function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Load a palette into the editor and (optionally) onto the island. @param {Palette} json @param {number|null} fadeS */
function loadWorking(json, fadeS) {
  working = structuredClone(json);
  if (working && working.id && ![...paletteSel.options].some((o) => o.value === working?.id)) {
    paletteList = [...paletteList, { id: working.id, name: working.name ?? working.id }];
    fillPaletteSelect();
  }
  if (working?.id) paletteSel.value = working.id;
  buildEditor();
  setEdited(false);
  if (fadeS !== null) applyNow(fadeS);
}

function fillPaletteSelect() {
  const keep = paletteSel.value;
  paletteSel.textContent = '';
  for (const p of paletteList) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name ?? p.id;
    paletteSel.append(o);
  }
  if (keep && paletteList.some((p) => p.id === keep)) paletteSel.value = keep;
}

/** Read a palette's recipe file fresh from disk (no cache). @param {string} id @returns {Promise<Palette>} */
async function fetchSaved(id) {
  const root = new URL('../recipes/', import.meta.url);
  let path = `palettes/${id}.json`;
  try {
    const r = await fetch(new URL('index.json', root), { cache: 'no-store' });
    if (r.ok) path = (await r.json())?.recipes?.[`palettes/${id}`] ?? path;
  } catch { /* use the default path */ }
  const r = await fetch(new URL(path, root), { cache: 'no-store' });
  if (!r.ok) throw new Error(`Could not load recipes/${path} (${r.status})`);
  return r.json();
}

paletteSel.addEventListener('change', async () => {
  const id = paletteSel.value;
  if (edited && !confirm('Switching palettes drops the edits in this page. Switch anyway?')) {
    if (working?.id) paletteSel.value = working.id;
    return;
  }
  try {
    loadWorking(await fetchSaved(id), 0.6);
  } catch (err) {
    showNote(`Could not load the palette "${id}" (${err instanceof Error ? err.message : String(err)}).`);
    if (working?.id) paletteSel.value = working.id;
  }
});

// ---------- before and after split ----------

/** @type {number|null} 0..1, or null when the split is off */
let split = 0.5;

/** @param {number|null} s */
function setSplit(s) {
  split = s === null ? null : clamp(s, 0, 1);
  splitEl.hidden = split === null;
  splitOnBtn.setAttribute('aria-pressed', String(split !== null));
  splitOnBtn.textContent = split === null ? 'Split view off' : 'Split view on';
  if (split !== null) {
    splitLine.style.left = `${(split * 100).toFixed(2)}%`;
    splitKnob.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    splitKnob.setAttribute('aria-valuetext', `${Math.round(split * 100)} percent before`);
  }
  update('preview', (p) => ({ ...(p ?? {}), split }));
}

let lastSplit = 0.5;
splitOnBtn.addEventListener('click', () => {
  if (split === null) setSplit(lastSplit);
  else { lastSplit = split; setSplit(null); }
});

/** @param {PointerEvent} e */
function dragSplit(e) {
  const r = stage.getBoundingClientRect();
  if (r.width > 0) setSplit((e.clientX - r.left) / r.width);
}
for (const handle of [splitGrab, splitKnob]) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    dragSplit(e);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    e.stopPropagation();
    dragSplit(e);
  });
}
splitKnob.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.02;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setSplit((split ?? 0.5) - step);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setSplit((split ?? 0.5) + step);
  else if (e.key === 'Home') setSplit(0);
  else if (e.key === 'End') setSplit(1);
  else return;
  e.preventDefault();
});

// ---------- eyedropper ----------

/** @type {string|null} last "before" color picked */
let pickedFrom = null;

/** @param {boolean} on */
function setPicking(on) {
  pickLayer.hidden = !on;
  pickBtn.setAttribute('aria-pressed', String(on));
  pickBtn.textContent = on ? 'Cancel picking' : 'Pick a color';
  if (on && split === null) setSplit(lastSplit);
}

pickBtn.addEventListener('click', () => {
  if (!pickColor) {
    $('pick-hex').textContent = 'The eyedropper is not available in this build yet.';
    return;
  }
  setPicking(pickLayer.hidden);
  if (!pickLayer.hidden) stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

pickLayer.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  setPicking(false);
  if (!pickColor) return;
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const before = split === null ? false : x < split * r.width;
  pickMark.hidden = false;
  pickMark.style.left = `${x}px`;
  pickMark.style.top = `${y}px`;
  let hex = null;
  try {
    hex = normHex(await pickColor(x, y));
  } catch (err) {
    console.warn('[palette-lab] pickColor failed', err);
  }
  const swatch = $('pick-swatch');
  if (!hex) {
    $('pick-hex').textContent = 'Could not read that pixel. Try again.';
    $('pick-side').textContent = '';
    swatch.style.background = 'transparent';
    pickedFrom = null;
    refreshPickUse();
    return;
  }
  swatch.style.background = hex;
  $('pick-hex').textContent = hex;
  if (before) {
    pickedFrom = hex;
    $('pick-side').textContent = 'Before the palette: ready to use as a "from" color.';
    // Suggest the anchor whose current "from" is nearest in OKLab.
    const anchors = working?.anchors ?? [];
    let best = -1;
    let bestD = Infinity;
    anchors.forEach((a, i) => {
      const f = normHex(a.from);
      if (!f) return;
      const d = labDistance(f, hex);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) pickRole.value = String(best);
  } else {
    pickedFrom = null;
    $('pick-side').textContent = 'After the palette. For a "from" color, pick on the left (before) side.';
  }
  refreshPickUse();
});

function refreshPickUse() {
  pickUse.disabled = !pickedFrom || !working?.anchors?.length;
}

pickUse.addEventListener('click', () => {
  if (!pickedFrom || !working?.anchors) return;
  const i = Number(pickRole.value);
  const a = working.anchors[i];
  if (!a) return;
  a.from = pickedFrom;
  const card = anchorsEl.querySelector(`.anchor[data-index="${i}"]`);
  const sw = /** @type {HTMLElement|null} */ (card?.querySelector('[data-from-swatch]') ?? null);
  const tx = card?.querySelector('[data-from-hex]');
  if (sw) sw.style.background = pickedFrom;
  if (tx) tx.textContent = pickedFrom;
  edit();
  $('pick-side').textContent = `Set as "from" for ${a.role ?? `anchor ${i + 1}`}.`;
});

// ---------- save ----------

function json() {
  return `${JSON.stringify(working, null, 2)}\n`;
}

/** @type {ReturnType<typeof setTimeout> | null} */
let copiedTimer = null;
/** @param {string} text */
function flash(text) {
  copiedEl.textContent = text;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedEl.textContent = ''; }, 2500);
}

$('copy').addEventListener('click', async () => {
  if (!working) return flash('Nothing to copy yet');
  const text = json();
  try {
    await navigator.clipboard.writeText(text);
    flash('Copied');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    flash(ok ? 'Copied' : 'Could not copy here. Use Download JSON.');
  }
});

$('download').addEventListener('click', () => {
  if (!working) return flash('Nothing to download yet');
  const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${working.id ?? 'palette'}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(`Downloaded ${a.download}`);
});

$('reset').addEventListener('click', async () => {
  const id = working?.id ?? paletteSel.value;
  if (!id) return;
  try {
    loadWorking(await fetchSaved(id), 0);
    flash('Reset to the saved file');
  } catch (err) {
    flash(`Could not reload (${err instanceof Error ? err.message : String(err)})`);
  }
});

// ---------- preview time and weather (as in sky-lab) ----------

/** @type {number|null} preview time in game seconds, or null while following the world clock */
let preview = null;

/** @param {number} t @returns {{ day: number, hour: number }} */
function splitTime(t) {
  const yearT = t - Math.floor(t / clock.SECONDS_PER_YEAR) * clock.SECONDS_PER_YEAR;
  const day = Math.floor(yearT / clock.SECONDS_PER_DAY);
  return { day, hour: (yearT - day * clock.SECONDS_PER_DAY) / clock.SECONDS_PER_HOUR };
}
/** @param {number} hour */
function hhmm(hour) {
  const m = Math.round(hour * 60);
  return `${String(Math.floor(m / 60) % 25).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** @param {number} day */
function seasonDay(day) {
  return `${SEASONS[Math.floor(day / clock.DAYS_PER_SEASON) % 4]}, day ${(day % clock.DAYS_PER_SEASON) + 1}`;
}

function applyPreview() {
  preview = (Number(dayIn.value) * 24 + Number(hourIn.value)) * clock.SECONDS_PER_HOUR;
  clock.setDisplayOverride(preview);
  followBtn.setAttribute('aria-pressed', 'false');
  refreshTime();
}
function follow() {
  preview = null;
  clock.setDisplayOverride(null);
  followBtn.setAttribute('aria-pressed', 'true');
  refreshTime();
}
function refreshTime() {
  if (preview === null) {
    const { day, hour } = splitTime(clock.display());
    hourIn.value = String(Math.round(hour * 10) / 10);
    dayIn.value = String(day);
  }
  $('hour-out').textContent = hhmm(Number(hourIn.value));
  $('day-out').textContent = `${seasonDay(Number(dayIn.value))} (${Number(dayIn.value) + 1} of ${DAYS_PER_YEAR})`;
  const w = splitTime(clock.worldT());
  $('world-time').textContent = `World clock: ${seasonDay(w.day)}, ${hhmm(w.hour)}`;
}
hourIn.addEventListener('input', applyPreview);
dayIn.addEventListener('input', applyPreview);
followBtn.addEventListener('click', follow);
weatherSel.addEventListener('change', () => {
  const weather = weatherSel.value || null;
  update('preview', (p) => ({ ...(p ?? {}), weather }));
});

// ---------- boot ----------

const status = $('status');
/** @param {string} icon @param {string} text */
const setStatus = (icon, text) => { status.innerHTML = `${icon}<span>${esc(text)}</span>`; };
/** @param {string} text */
const showNote = (text) => { $('api-note').textContent = text; };

fillPaletteSelect();
setSplit(0.5);
refreshTime();
setInterval(refreshTime, 250);
buildEditor();

/** Without the game's palette hooks, show the saved file so the controls can still be explored. */
async function loadFromFileOnly() {
  try {
    loadWorking(await fetchSaved(paletteSel.value || 'dusk'), null);
  } catch (err) {
    console.warn('[palette-lab] no palette file yet', err);
  }
}

try {
  const { startApp } = await import('../src/app.js');
  const result = /** @type {any} */ (await startApp(canvas));
  if (!result?.ok) {
    setStatus(ICON_WARN, `WebGPU is not available here (${result?.reason ?? 'unknown'}), so the island cannot be drawn. Open this page in current Chrome or Edge.`);
    await loadFromFileOnly();
  } else {
    setStatus(ICON_OK, `The island is running (tier ${result.tier}). Orbit and zoom it while you tune.`);
    const p = result.palette;
    if (p && typeof p.current === 'function' && typeof p.apply === 'function') {
      api = /** @type {PaletteApi} */ (p);
      if (typeof p.list === 'function') {
        const l = p.list();
        if (Array.isArray(l) && l.length) paletteList = l;
      }
      fillPaletteSelect();
      loadWorking(p.current(), null);
    } else {
      showNote('This build does not offer palette editing yet (the game side has not added it). The controls show the saved file but will not change the picture until it lands.');
      await loadFromFileOnly();
    }
    if (typeof result.pickColor === 'function') pickColor = result.pickColor;
    else if (api) showNote('The eyedropper is not available in this build yet; everything else works.');
  }
} catch (err) {
  console.error(err);
  setStatus(ICON_WARN, `The island could not start here (${err instanceof Error ? err.message : String(err)}).`);
  await loadFromFileOnly();
}
// Re-send the split now that the app owns the preview slice.
setSplit(split);
