// @ts-check
// The S1 tool bar (docs/15, docs/20 step S1): [undo][redo] | [sculpt][smooth][paint] at the
// bottom center, and above it a brush card with mode or layer chips and size and strength
// sliders while a tool is active. S8 grows this into the full HUD palette.
//
// Reads the store slices `tools` and `history` (created by app.js); never writes the store.
// Every user choice goes out as an action through src/input/actions.js. Styles: tools.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** @typedef {'sculpt'|'smooth'|'paint'} ToolId */
/** @typedef {'raise'|'lower'|'flatten'} SculptMode */
/** @typedef {'grass'|'sand'|'soil'|'rock'} PaintLayer */

/**
 * @typedef {Object} ToolsSlice
 * @property {ToolId|null} tool
 * @property {SculptMode} sculptMode
 * @property {PaintLayer} paintLayer
 * @property {number} size        brush radius, meters
 * @property {number} strength    0..1
 * @property {[number, number]} sizeRange  [min, max] meters
 */

/** @type {{id: ToolId, label: string}[]} */
const TOOLS = [
  { id: 'sculpt', label: 'Sculpt' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'paint', label: 'Paint' },
];
/** @type {{id: SculptMode, label: string}[]} */
const MODES = [
  { id: 'raise', label: 'Raise' },
  { id: 'lower', label: 'Lower' },
  { id: 'flatten', label: 'Flatten' },
];
/** @type {{id: PaintLayer, label: string}[]} */
const LAYERS = [
  { id: 'grass', label: 'Grass' },
  { id: 'sand', label: 'Sand' },
  { id: 'soil', label: 'Soil' },
  { id: 'rock', label: 'Rock' },
];
/** Swatch colors per paint layer (tokens.css). */
const SWATCH = { grass: 'var(--moss-3)', sand: 'var(--sand)', soil: 'var(--soil)', rock: 'var(--rock)' };

const DEFAULT_SIZE_RANGE = /** @type {[number, number]} */ ([0.5, 12]);

/**
 * Mount the tool bar and brush card.
 * @param {HTMLElement} [parent]
 * @returns {() => void} dispose: removes the DOM and unsubscribes
 */
export function mountTools(parent = document.body) {
  ensureIconSprite();

  const root = el('div', 'ebb-tools');
  root.innerHTML = `
    <div class="ebb-tools__card" role="group" aria-label="Brush" aria-hidden="true">
      <div class="ebb-tools__chips ebb-tools__chips--sculpt" role="group" aria-label="Sculpt mode" hidden>
        ${MODES.map((m) => `<button type="button" class="ebb-tools__chip" data-mode="${m.id}"
          aria-pressed="false" title="${m.label}">${iconSvg(m.id)}<span>${m.label}</span></button>`).join('')}
      </div>
      <div class="ebb-tools__chips ebb-tools__chips--paint" role="group" aria-label="Paint layer" hidden>
        ${LAYERS.map((l) => `<button type="button" class="ebb-tools__chip" data-layer="${l.id}"
          aria-pressed="false" title="${l.label}">${swatchSvg(SWATCH[l.id])}<span>${l.label}</span></button>`).join('')}
      </div>
      <div class="ebb-tools__slider">
        <label for="ebb-tools-size">Size</label>
        <output for="ebb-tools-size" data-out="size"></output>
        <input class="ebb-tools__range" id="ebb-tools-size" type="range" data-range="size">
      </div>
      <div class="ebb-tools__slider">
        <label for="ebb-tools-strength">Strength</label>
        <output for="ebb-tools-strength" data-out="strength"></output>
        <input class="ebb-tools__range" id="ebb-tools-strength" type="range" min="0" max="100" step="1" data-range="strength">
      </div>
    </div>
    <div class="ebb-tools__bar" role="toolbar" aria-label="Tools">
      ${barButton('undo', 'Undo', 'data-history="undo"')}
      ${barButton('redo', 'Redo', 'data-history="redo"')}
      <div class="ebb-tools__divider" role="separator" aria-orientation="vertical"></div>
      ${TOOLS.map((t) => barButton(t.id, t.label, `data-tool="${t.id}" aria-pressed="false"`)).join('')}
    </div>`;

  const card = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__card'));
  const sculptChips = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__chips--sculpt'));
  const paintChips = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__chips--paint'));
  const sizeRange = /** @type {HTMLInputElement} */ (root.querySelector('[data-range="size"]'));
  const strengthRange = /** @type {HTMLInputElement} */ (root.querySelector('[data-range="strength"]'));
  const sizeOut = /** @type {HTMLOutputElement} */ (root.querySelector('[data-out="size"]'));
  const strengthOut = /** @type {HTMLOutputElement} */ (root.querySelector('[data-out="strength"]'));
  const undoBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-history="undo"]'));
  const redoBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-history="redo"]'));
  const toolBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-tool]')]);
  const modeBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-mode]')]);
  const layerBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-layer]')]);

  // --- user input -> actions ---
  /** @param {MouseEvent} e */
  function onClick(e) {
    const btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!btn || !root.contains(btn)) return;
    const { tool, mode, layer, history } = btn.dataset;
    if (tool) dispatch(/** @type {any} */ ({ type: 'tool.select', toolId: tool }));
    else if (mode) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { sculptMode: mode } }));
    else if (layer) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { paintLayer: layer } }));
    else if (history && btn.getAttribute('aria-disabled') !== 'true') {
      dispatch(/** @type {any} */ ({ type: history === 'undo' ? 'history.undo' : 'history.redo', source: 'mouse' }));
    }
  }
  function onSize() {
    const v = Number(sizeRange.value);
    paintRange(sizeRange);
    dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { size: v } }));
  }
  function onStrength() {
    const v = Number(strengthRange.value) / 100;
    paintRange(strengthRange);
    dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { strength: v } }));
  }
  /** Keep pointer and wheel input on the panels from reaching anything below. @param {Event} e */
  const stop = (e) => e.stopPropagation();

  root.addEventListener('click', onClick);
  sizeRange.addEventListener('input', onSize);
  strengthRange.addEventListener('input', onStrength);
  for (const panel of [card, /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__bar'))]) {
    panel.addEventListener('pointerdown', stop);
    panel.addEventListener('pointermove', stop);
    panel.addEventListener('wheel', stop, { passive: true });
    panel.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // --- store -> view (only on slice updates, never per frame) ---
  /** @type {ToolId|null|undefined} */
  let shownTool;

  function renderTools() {
    /** @type {Partial<ToolsSlice>} */
    const t = get('tools') ?? {};
    const tool = t.tool ?? null;
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === t.sculptMode));
    for (const b of layerBtns) b.setAttribute('aria-pressed', String(b.dataset.layer === t.paintLayer));

    if (tool !== shownTool) {
      shownTool = tool;
      const open = tool === 'sculpt' || tool === 'smooth' || tool === 'paint';
      card.classList.toggle('is-open', open);
      card.setAttribute('aria-hidden', String(!open));
      card.inert = !open;
      // Keep the last chips while the card fades out, so it does not jump.
      if (open) {
        sculptChips.hidden = tool !== 'sculpt';
        paintChips.hidden = tool !== 'paint';
      }
    }

    const [min, max] = validRange(t.sizeRange);
    const step = max - min > 20 ? 0.5 : 0.1;
    setAttr(sizeRange, 'min', String(min));
    setAttr(sizeRange, 'max', String(max));
    setAttr(sizeRange, 'step', String(step));
    const size = clamp(Number.isFinite(t.size) ? /** @type {number} */ (t.size) : (min + max) / 2, min, max);
    syncRange(sizeRange, size);
    sizeOut.textContent = `${formatMeters(size)} m`;

    const strength = clamp(Number.isFinite(t.strength) ? /** @type {number} */ (t.strength) : 0.5, 0, 1);
    syncRange(strengthRange, Math.round(strength * 100));
    strengthOut.textContent = `${Math.round(strength * 100)}%`;
  }

  function renderHistory() {
    const h = get('history') ?? {};
    setDisabled(undoBtn, !h.canUndo);
    setDisabled(redoBtn, !h.canRedo);
  }

  renderTools();
  renderHistory();
  const unsubs = [subscribe('tools', renderTools), subscribe('history', renderHistory)];
  parent.appendChild(root);

  return function dispose() {
    for (const u of unsubs) u();
    root.removeEventListener('click', onClick);
    root.remove();
  };
}

// --- helpers ---

/** @param {string} tag @param {string} cls */
function el(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** @param {string} icon @param {string} label @param {string} attrs */
function barButton(icon, label, attrs) {
  return `<button type="button" class="ebb-tools__btn" aria-label="${label}" title="${label}" ${attrs}>${iconSvg(icon)}</button>`;
}

/** A small drawn round swatch in the icon style. @param {string} color */
function swatchSvg(color) {
  return `<svg class="ebb-tools__swatch" viewBox="0 0 18 18" aria-hidden="true" focusable="false">` +
    `<circle cx="9" cy="9" r="7.5" fill="${color}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/></svg>`;
}

/** @param {unknown} r @returns {[number, number]} */
function validRange(r) {
  if (Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]) {
    return [r[0], r[1]];
  }
  return DEFAULT_SIZE_RANGE;
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** "2.5" under 10 m, "12" from 10 m. @param {number} m */
function formatMeters(m) {
  return m < 10 ? m.toFixed(1) : m.toFixed(0);
}

/** @param {Element} e @param {string} name @param {string} value */
function setAttr(e, name, value) {
  if (e.getAttribute(name) !== value) e.setAttribute(name, value);
}

/** @param {HTMLButtonElement} b @param {boolean} off */
function setDisabled(b, off) {
  setAttr(b, 'aria-disabled', String(off));
}

/** Set a range's value from the store without fighting an active drag. @param {HTMLInputElement} r @param {number} v */
function syncRange(r, v) {
  if (Math.abs(Number(r.value) - v) > 1e-6) r.value = String(v);
  paintRange(r);
}

/** Update the filled part of the track. @param {HTMLInputElement} r */
function paintRange(r) {
  const min = Number(r.min) || 0;
  const max = Number(r.max) || 100;
  const pct = max > min ? ((Number(r.value) - min) / (max - min)) * 100 : 0;
  r.style.setProperty('--fill', `${pct.toFixed(1)}%`);
}
