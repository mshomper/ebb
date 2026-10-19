// @ts-check
// The S1 tool bar (docs/15, docs/20 step S1): [undo][redo] | [sculpt][smooth][paint][water][plant]
// at the bottom center, and above it a brush card with mode or layer chips and size and
// strength sliders while a tool is active (water's spring mode swaps the sliders for flow
// chips, a spring count and Remove; the Plant tool shows species chips, a hint and the last
// tap's result instead). S8 grows this into the full HUD palette.
//
// Reads the store slices `tools`, `history`, `unlocks`, `waterUi` and `plantUi` (created by
// app.js); never writes the store. Every user choice goes out as an action through
// src/input/actions.js. Styles: tools.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** @typedef {'sculpt'|'smooth'|'paint'|'water'|'plant'} ToolId */
/** @typedef {'reeds'|'lilies'|'iris'|'rushes'|'thrift'} PlantSpecies */
/** @typedef {'raise'|'lower'|'flatten'} SculptMode */
/** @typedef {'grass'|'sand'|'soil'|'rock'} PaintLayer */
/** @typedef {'pour'|'drain'|'spring'} WaterMode */
/** @typedef {'trickle'|'brook'|'stream'} SpringRate */

/**
 * @typedef {Object} ToolsSlice
 * @property {ToolId|null} tool
 * @property {SculptMode} sculptMode
 * @property {PaintLayer} paintLayer
 * @property {WaterMode} [waterMode]   undefined reads as 'pour'
 * @property {SpringRate} [springRate] undefined reads as 'brook'
 * @property {PlantSpecies} [plantSpecies] undefined reads as the first of PLANT_SPECIES
 * @property {number} size        brush radius, meters
 * @property {number} strength    0..1
 * @property {[number, number]} sizeRange  [min, max] meters
 */

/**
 * @typedef {Object} WaterUiSlice
 * @property {number} springCount
 * @property {number} maxSprings
 * @property {string|null} selectedId  the selected spring, if any
 */

/**
 * The result of the last Plant tap, written by app.js.
 * @typedef {Object} PlantUiSlice
 * @property {string} message  e.g. "Planted", "Reeds need wetter ground"
 * @property {number} at       when it was written
 */

/** @type {{id: ToolId, label: string}[]} */
const TOOLS = [
  { id: 'sculpt', label: 'Sculpt' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'paint', label: 'Paint' },
  { id: 'water', label: 'Water' },
  { id: 'plant', label: 'Plant' },
];
/**
 * Species the Plant tool offers, in chip order (two to a row; an odd last chip takes the whole row). Each `icon` is a
 * drawn icon of the same name in icons.js; `hint` says where the species grows.
 * @type {{id: PlantSpecies, label: string, icon: string, hint: string}[]}
 */
const PLANT_SPECIES = [
  { id: 'reeds', label: 'Reeds', icon: 'reeds', hint: 'Reeds like wet banks and shallow fresh water. Tap the ground to plant a seed.' },
  { id: 'lilies', label: 'Water lilies', icon: 'lilies', hint: 'Water lilies like still fresh water 0.3 to 1.5 m deep. Tap the water to plant one.' },
  { id: 'iris', label: 'Yellow iris', icon: 'iris', hint: 'Yellow flag iris likes the wet bank just above the water. Tap the ground to plant a seed.' },
  { id: 'rushes', label: 'Rushes', icon: 'rushes', hint: 'Rushes like soaked ground and still, shallow fresh water. Tap to start a tussock; it spreads from there.' },
  { id: 'thrift', label: 'Sea thrift', icon: 'thrift', hint: 'Sea thrift likes the salty shore by the sea. Tap the ground to plant a seed.' },
];
/** How long a Plant tap's result stays before it fades, ms. */
const PLANT_MESSAGE_MS = 2500;
/** Water modes; 'spring' shows only once `unlocks.springs` is true. @type {{id: WaterMode, label: string, icon: string}[]} */
const WATER_MODES = [
  { id: 'pour', label: 'Pour', icon: 'pour' },
  { id: 'drain', label: 'Drain', icon: 'drain' },
  { id: 'spring', label: 'Spring', icon: 'wellspring' },
];
/** @type {{id: SpringRate, label: string}[]} */
const SPRING_RATES = [
  { id: 'trickle', label: 'Trickle' },
  { id: 'brook', label: 'Brook' },
  { id: 'stream', label: 'Stream' },
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
      <div class="ebb-tools__chips ebb-tools__chips--water" role="group" aria-label="Water mode" hidden>
        ${WATER_MODES.map((m) => `<button type="button" class="ebb-tools__chip" data-water-mode="${m.id}"
          aria-pressed="false" title="${m.label}">${iconSvg(m.icon)}<span>${m.label}</span></button>`).join('')}
      </div>
      <div class="ebb-tools__spring" role="group" aria-label="Spring" hidden>
        <div class="ebb-tools__chips ebb-tools__chips--rate" role="group" aria-label="Spring flow">
          ${SPRING_RATES.map((r) => `<button type="button" class="ebb-tools__chip" data-rate="${r.id}"
            aria-pressed="false" title="${r.label}">${iconSvg(`rate-${r.id}`)}<span>${r.label}</span></button>`).join('')}
        </div>
        <div class="ebb-tools__spring-row">
          <span class="ebb-tools__count" data-out="springs" aria-live="polite"></span>
          <button type="button" class="ebb-tools__chip ebb-tools__remove" data-spring-remove="true"
            title="Remove spring">${iconSvg('spring-remove')}<span>Remove</span></button>
        </div>
        <p class="ebb-tools__hint">Tap to place a spring. Tap one to select it.</p>
      </div>
      <div class="ebb-tools__plant" role="group" aria-label="Plant" hidden>
        <div class="ebb-tools__chips ebb-tools__chips--species" role="group" aria-label="Species"
          style="--tb-cols: ${Math.min(2, PLANT_SPECIES.length)}">
          ${PLANT_SPECIES.map((s) => `<button type="button" class="ebb-tools__chip" data-species="${s.id}"
            aria-pressed="false" title="${s.label}">${iconSvg(s.icon)}<span>${s.label}</span></button>`).join('')}
        </div>
        <p class="ebb-tools__hint" data-out="plant-hint"></p>
        <p class="ebb-tools__message" data-out="plant-message" role="status" aria-live="polite"></p>
      </div>
      <div class="ebb-tools__slider" data-slider="size">
        <label for="ebb-tools-size">Size</label>
        <output for="ebb-tools-size" data-out="size"></output>
        <input class="ebb-tools__range" id="ebb-tools-size" type="range" data-range="size">
      </div>
      <div class="ebb-tools__slider" data-slider="strength">
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
  const waterChips = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__chips--water'));
  const springPanel = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__spring'));
  const springRow = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__spring-row'));
  const springCount = /** @type {HTMLElement} */ (root.querySelector('[data-out="springs"]'));
  const springHint = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__hint'));
  const removeBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-spring-remove]'));
  const sliders = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-slider]')]);
  const sizeRange = /** @type {HTMLInputElement} */ (root.querySelector('[data-range="size"]'));
  const strengthRange = /** @type {HTMLInputElement} */ (root.querySelector('[data-range="strength"]'));
  const sizeOut = /** @type {HTMLOutputElement} */ (root.querySelector('[data-out="size"]'));
  const strengthOut = /** @type {HTMLOutputElement} */ (root.querySelector('[data-out="strength"]'));
  const undoBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-history="undo"]'));
  const redoBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-history="redo"]'));
  const toolBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-tool]')]);
  const modeBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-mode]')]);
  const layerBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-layer]')]);
  const waterModeBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-water-mode]')]);
  const springModeBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-water-mode="spring"]'));
  const rateBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-rate]')]);
  const plantPanel = /** @type {HTMLElement} */ (root.querySelector('.ebb-tools__plant'));
  const speciesBtns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-species]')]);
  const plantHint = /** @type {HTMLElement} */ (root.querySelector('[data-out="plant-hint"]'));
  const plantMessage = /** @type {HTMLElement} */ (root.querySelector('[data-out="plant-message"]'));

  // --- user input -> actions ---
  /** @param {MouseEvent} e */
  function onClick(e) {
    const btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!btn || !root.contains(btn)) return;
    const { tool, mode, layer, waterMode, rate, species, springRemove, history } = btn.dataset;
    if (tool) dispatch(/** @type {any} */ ({ type: 'tool.select', toolId: tool }));
    else if (species) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { plantSpecies: species } }));
    else if (mode) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { sculptMode: mode } }));
    else if (layer) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { paintLayer: layer } }));
    else if (waterMode) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { waterMode } }));
    else if (rate) dispatch(/** @type {any} */ ({ type: 'brush.set', patch: { springRate: rate } }));
    else if (springRemove) {
      /** @type {Partial<WaterUiSlice>} */
      const w = get('waterUi') ?? {};
      if (w.selectedId) dispatch(/** @type {any} */ ({ type: 'water.springRemove', id: w.selectedId }));
    } else if (history && btn.getAttribute('aria-disabled') !== 'true') {
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

    // Water: the spring mode exists only once unlocked; a stored 'spring' reads as 'pour' until then.
    const springsOn = !!get('unlocks')?.springs;
    const storedMode = t.waterMode ?? 'pour';
    const waterMode = storedMode === 'spring' && !springsOn ? 'pour' : storedMode;
    const springRate = t.springRate ?? 'brook';
    springModeBtn.hidden = !springsOn;
    waterChips.style.setProperty('--tb-cols', springsOn ? '3' : '2');
    for (const b of waterModeBtns) b.setAttribute('aria-pressed', String(b.dataset.waterMode === waterMode));
    for (const b of rateBtns) b.setAttribute('aria-pressed', String(b.dataset.rate === springRate));
    renderSprings();

    // Plant: the stored species, or the first offered one if it is not (yet) in the list.
    const species = PLANT_SPECIES.find((s) => s.id === t.plantSpecies) ?? PLANT_SPECIES[0];
    for (const b of speciesBtns) b.setAttribute('aria-pressed', String(b.dataset.species === species.id));
    if (plantHint.textContent !== species.hint) plantHint.textContent = species.hint;

    const open = tool === 'sculpt' || tool === 'smooth' || tool === 'paint' || tool === 'water' || tool === 'plant';
    if (tool !== shownTool) {
      // A result from an earlier visit to the Plant tool does not linger.
      if (tool === 'plant') clearPlantMessage();
      shownTool = tool;
      card.classList.toggle('is-open', open);
      card.setAttribute('aria-hidden', String(!open));
      card.inert = !open;
    }
    // Keep the last chips while the card fades out, so it does not jump.
    if (open) {
      const inSpring = tool === 'water' && waterMode === 'spring';
      const inPlant = tool === 'plant';
      sculptChips.hidden = tool !== 'sculpt';
      paintChips.hidden = tool !== 'paint';
      waterChips.hidden = tool !== 'water';
      springPanel.hidden = !inSpring;
      plantPanel.hidden = !inPlant;
      for (const s of sliders) s.hidden = inSpring || inPlant;
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

  /** Spring count, and Remove when a spring is selected, else the placing hint. */
  function renderSprings() {
    /** @type {Partial<WaterUiSlice>} */
    const w = get('waterUi') ?? {};
    const hasCount = Number.isFinite(w.springCount) && Number.isFinite(w.maxSprings);
    const selected = !!w.selectedId;
    springCount.hidden = !hasCount;
    if (hasCount) {
      const max = /** @type {number} */ (w.maxSprings);
      const text = `${w.springCount} of ${max} ${max === 1 ? 'spring' : 'springs'}`;
      if (springCount.textContent !== text) springCount.textContent = text;
    }
    removeBtn.hidden = !selected;
    springRow.hidden = !hasCount && !selected;
    springHint.hidden = selected;
  }

  function renderHistory() {
    const h = get('history') ?? {};
    setDisabled(undoBtn, !h.canUndo);
    setDisabled(redoBtn, !h.canRedo);
  }

  // The last Plant tap's result: shown at once, faded out after PLANT_MESSAGE_MS. The text stays
  // in place while it fades (and the line keeps its height), so the card does not jump.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let plantTimer;
  function clearPlantMessage() {
    clearTimeout(plantTimer);
    plantMessage.classList.remove('is-shown');
  }
  function renderPlantMessage() {
    /** @type {Partial<PlantUiSlice>} */
    const p = get('plantUi') ?? {};
    const text = typeof p.message === 'string' ? p.message : '';
    clearTimeout(plantTimer);
    if (!text) { plantMessage.classList.remove('is-shown'); return; }
    plantMessage.textContent = text;
    // Restart the fade-in even when the same message comes twice in a row.
    plantMessage.classList.remove('is-shown');
    void plantMessage.offsetWidth;
    plantMessage.classList.add('is-shown');
    plantTimer = setTimeout(() => plantMessage.classList.remove('is-shown'), PLANT_MESSAGE_MS);
  }

  renderTools();
  renderHistory();
  const unsubs = [
    subscribe('tools', renderTools),
    subscribe('unlocks', renderTools),
    subscribe('waterUi', renderSprings),
    subscribe('history', renderHistory),
    subscribe('plantUi', renderPlantMessage),
  ];
  parent.appendChild(root);

  return function dispose() {
    for (const u of unsubs) u();
    clearTimeout(plantTimer);
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
