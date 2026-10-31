// @ts-check
// Photo mode's bar and guide (B2 P1; src/render/photo-mode.js owns the camera, lens and shot).
// While photo mode is open the body has the class ebb-photo: the HUD, the island notes, cards and
// tags step aside (photo.css) and a slim bar of drawn icons comes up along the bottom:
//   Close | Frame: shape, thirds guide, paper margin | Aperture | Hour and exposure | Filter | Shot
// Over the view, a guide shows the frame shape (dimmed outside), the paper margin, the thirds and
// the point focus follows. None of it is in the picture: the shot is drawn offscreen.
// Reads the store slice `photo`; sends photo.close, photo.set { patch } and photo.shot.
// Words and choices: recipes/world/photo.json. Styles: photo.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { cropRect, marginPx } from '../render/passes/post/photo.js';
import { display, SECONDS_PER_DAY, SECONDS_PER_HOUR } from '../core/clock.js';

/** 'h:mm' for an hour of the day. @param {number} h */
const clockText = (h) => {
  const m = Math.round(h * 60) % (24 * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
/** f/2.8, f/11. @param {number} n */
const stopText = (n) => `f/${n}`;
/** +0.5, -1, 0 stops. @param {number} ev */
const evText = (ev) => (ev > 0 ? `+${ev}` : `${ev}`);

/**
 * @param {HTMLElement} parent document.body
 * @param {any} R recipes/world/photo.json
 * @returns {() => void} dispose
 */
export function mountPhoto(parent, R) {
  ensureIconSprite();
  const W = R.words;
  const btn = (/** @type {string} */ icon, /** @type {string} */ label, /** @type {string} */ extra = '') =>
    `<button type="button" class="ebb-photo__btn" aria-label="${label}" data-label="${label}"${extra}>${iconSvg(icon)}</button>`;
  const slider = (/** @type {string} */ icon, /** @type {string} */ label, /** @type {string} */ name, /** @type {string} */ range) =>
    `<label class="ebb-photo__slider" data-label="${label}"><span class="ebb-photo__sicon">${iconSvg(icon)}</span>`
    + `<input type="range" aria-label="${label}" data-slider="${name}" ${range}><output data-out="${name}"></output></label>`;

  const bar = document.createElement('div');
  bar.className = 'ebb-photo';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', W.photo);
  bar.innerHTML = `<div class="ebb-photo__group">${btn('close', W.close, ' data-act="close"')}</div>`
    + `<div class="ebb-photo__group">${btn('aspect', W.aspect, ' data-act="aspect"')}`
    + btn('thirds', W.thirds, ' data-act="thirds" aria-pressed="false"') + btn('margin', W.margin, ' data-act="margin" aria-pressed="false"') + '</div>'
    + `<div class="ebb-photo__group">${slider('aperture', W.aperture, 'stop', `min="0" max="${R.dof.fStops.length - 1}" step="1"`)}</div>`
    + `<div class="ebb-photo__group">${slider('time', W.hour, 'hour', 'min="0" max="23.75" step="0.25"')}`
    + `${slider('exposure', W.exposure, 'ev', `min="${R.light.evRange[0]}" max="${R.light.evRange[1]}" step="${R.light.evStep}"`)}</div>`
    + `<div class="ebb-photo__group" role="radiogroup" aria-label="Filter">${R.filters.list.map((/** @type {string} */ f) =>
      btn(f === 'none' ? 'picture' : `filter-${f}`, W.filter[f], ` data-filter="${f}" role="radio" aria-checked="false"`)).join('')}</div>`
    + `<div class="ebb-photo__group">${btn('shot', W.shot, ' data-act="shot"').replace('ebb-photo__btn', 'ebb-photo__btn ebb-photo__shot')}</div>`;

  const guide = document.createElement('div');
  guide.className = 'ebb-photo-guide';
  guide.hidden = true;
  guide.innerHTML = '<div class="ebb-photo-guide__frame"><div class="ebb-photo-guide__pic"></div></div><div class="ebb-photo-guide__focus"></div>';
  const frameEl = /** @type {HTMLElement} */ (guide.querySelector('.ebb-photo-guide__frame'));
  const picEl = /** @type {HTMLElement} */ (guide.querySelector('.ebb-photo-guide__pic'));
  const focusEl = /** @type {HTMLElement} */ (guide.querySelector('.ebb-photo-guide__focus'));
  frameEl.style.setProperty('--paper', R.frame.paperHex);

  const help = document.createElement('div');
  help.className = 'ebb-photo-help';
  help.hidden = true;

  const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (bar.querySelector(s));
  const input = (/** @type {string} */ n) => /** @type {HTMLInputElement} */ (bar.querySelector(`[data-slider="${n}"]`));
  const out = (/** @type {string} */ n) => /** @type {HTMLOutputElement} */ (bar.querySelector(`[data-out="${n}"]`));

  /** The hour shown now: the dial's, or the paused world's. */
  const hourNow = (/** @type {any} */ s) => (typeof s.hour === 'number' ? s.hour : (display() % SECONDS_PER_DAY) / SECONDS_PER_HOUR);

  let wasOpen = false, helpTimer = 0, savedSeen = 0;
  function layout() {
    const s = get('photo');
    if (!s?.open) return;
    const w = innerWidth, h = innerHeight;
    const crop = cropRect(w, h, R.frame.aspects[s.aspect]);
    const m = s.margin ? marginPx(crop, R.frame.marginK) : 0;
    Object.assign(frameEl.style, { left: `${crop.x}px`, top: `${crop.y}px`, width: `${crop.w}px`, height: `${crop.h}px` });
    frameEl.style.setProperty('--m', `${m}px`);
    picEl.classList.toggle('is-thirds', !!s.thirds);
    focusEl.style.left = `${s.focusUv[0] * w}px`;
    focusEl.style.top = `${s.focusUv[1] * h}px`;
  }

  function render() {
    const s = get('photo');
    const open = !!s?.open;
    document.body.classList.toggle('ebb-photo-open', open);
    bar.hidden = !open;
    guide.hidden = !open;
    if (open && !wasOpen) {
      // The keys, once, each time it opens; then the view is yours.
      help.textContent = W.help;
      help.hidden = false;
      clearTimeout(helpTimer);
      helpTimer = setTimeout(() => { help.hidden = true; }, 6000);
      savedSeen = s.saved ?? 0;
    }
    if (!open) { help.hidden = true; clearTimeout(helpTimer); }
    wasOpen = open;
    if (!open) return;
    if (s.saved && s.saved !== savedSeen) {
      savedSeen = s.saved;
      help.textContent = W.saved;
      help.hidden = false;
      clearTimeout(helpTimer);
      helpTimer = setTimeout(() => { help.hidden = true; }, 3000);
    }
    const a = R.frame.aspects[s.aspect] ?? R.frame.aspects[0];
    // The shape's name rides on the button's hover word, so the bar stays one slim row.
    const aspectBtn = q('[data-act="aspect"]');
    aspectBtn.dataset.label = `${W.aspect}: ${a.label}`;
    aspectBtn.setAttribute('aria-label', `${W.aspect}: ${a.label}`);
    q('[data-act="thirds"]').setAttribute('aria-pressed', String(!!s.thirds));
    q('[data-act="margin"]').setAttribute('aria-pressed', String(!!s.margin));
    for (const b of bar.querySelectorAll('[data-filter]')) b.setAttribute('aria-checked', String(/** @type {HTMLElement} */ (b).dataset.filter === s.filter));
    const stop = R.dof.fStops[s.stop] ?? 4, hour = hourNow(s);
    if (document.activeElement !== input('stop')) input('stop').value = String(s.stop);
    if (document.activeElement !== input('hour')) input('hour').value = String(Math.round(hour * 4) / 4);
    if (document.activeElement !== input('ev')) input('ev').value = String(s.ev);
    out('stop').textContent = stopText(stop);
    out('hour').textContent = clockText(hour);
    out('ev').textContent = evText(s.ev);
    const shot = q('[data-act="shot"]');
    shot.toggleAttribute('disabled', !!s.busy);
    layout();
  }

  /** @param {Event} e */
  function onClick(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    const s = get('photo') ?? {};
    if (b.dataset.filter) dispatch({ type: 'photo.set', patch: { filter: b.dataset.filter } });
    else if (b.dataset.act === 'close') dispatch({ type: 'photo.close', source: 'mouse' });
    else if (b.dataset.act === 'shot') dispatch({ type: 'photo.shot', source: 'mouse' });
    else if (b.dataset.act === 'aspect') dispatch({ type: 'photo.set', patch: { aspect: ((s.aspect ?? 0) + 1) % R.frame.aspects.length } });
    else if (b.dataset.act === 'thirds') dispatch({ type: 'photo.set', patch: { thirds: !s.thirds } });
    else if (b.dataset.act === 'margin') dispatch({ type: 'photo.set', patch: { margin: !s.margin } });
  }
  /** @param {Event} e */
  function onInput(e) {
    const el = /** @type {HTMLInputElement} */ (e.target);
    const v = Number(el.value);
    if (el.dataset.slider === 'stop') dispatch({ type: 'photo.set', patch: { stop: v } });
    else if (el.dataset.slider === 'hour') dispatch({ type: 'photo.set', patch: { hour: v } });
    else if (el.dataset.slider === 'ev') dispatch({ type: 'photo.set', patch: { ev: v } });
  }
  /** Keep pointer and wheel input on the bar from reaching the island below. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  bar.addEventListener('click', onClick);
  bar.addEventListener('input', onInput);
  for (const t of ['pointerdown', 'pointerup', 'pointermove']) bar.addEventListener(t, stop);
  bar.addEventListener('wheel', stop, { passive: true });
  // A slider keeps the keys it uses (arrows); W A S D still fly once the pointer is back on the view.
  bar.addEventListener('keydown', (e) => { if (e.target instanceof HTMLInputElement && e.key.startsWith('Arrow')) e.stopPropagation(); });

  parent.appendChild(guide);
  parent.appendChild(bar);
  parent.appendChild(help);
  const off = subscribe('photo', render);
  addEventListener('resize', layout);
  render();
  return () => {
    off();
    removeEventListener('resize', layout);
    clearTimeout(helpTimer);
    document.body.classList.remove('ebb-photo-open');
    bar.remove(); guide.remove(); help.remove();
  };
}
