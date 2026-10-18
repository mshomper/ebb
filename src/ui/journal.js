// @ts-check
// The field journal panel (docs/13, docs/15): the book button at the top right and the journal it
// opens. Desktop: a 440 px cream panel on the right, so the island stays in view. Phone: a sheet
// from the bottom that stops half way (the chevron makes it tall). Two sections: Living things (a
// page per species, filled from what has happened on the island) and Notes. Words only, never
// numbers or bars.
//
// Reads the store slices `journal` and `journalUi` and the live journal's describe(); never writes
// the store. Every choice goes out as a `ui.journal` action (src/world/journal/index.js answers).
// Styles: journal.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/**
 * Mount the journal button and panel.
 * @param {HTMLElement} parent
 * @param {import('../world/journal/index.js').LiveJournal} live
 * @returns {() => void} dispose
 */
export function mountJournal(parent, live) {
  ensureIconSprite();
  const words = live.words;

  const btnRoot = document.createElement('div');
  btnRoot.className = 'ebb-jbtn';
  btnRoot.innerHTML = `<button type="button" class="ebb-jbtn__btn" aria-label="Journal" title="Journal (J)"
    aria-expanded="false" aria-controls="ebb-journal">${iconSvg('journal', 'ebb-jbtn__icon')}</button>`;
  const openBtn = /** @type {HTMLButtonElement} */ (btnRoot.querySelector('button'));

  const panel = document.createElement('aside');
  panel.className = 'ebb-journal';
  panel.id = 'ebb-journal';
  panel.setAttribute('aria-label', 'Field journal');
  panel.innerHTML = `
    <header class="ebb-journal__head">
      <button type="button" class="ebb-journal__icon-btn" data-act="back" aria-label="Back to living things" title="Back">${iconSvg('back')}</button>
      <h2 class="ebb-journal__title">Field journal</h2>
      <button type="button" class="ebb-journal__icon-btn ebb-journal__size" data-act="size" aria-label="Make the journal taller" title="Taller">${iconSvg('chevron')}</button>
      <button type="button" class="ebb-journal__icon-btn" data-act="close" aria-label="Close the journal" title="Close (J)">${iconSvg('close')}</button>
    </header>
    <nav class="ebb-journal__nav" aria-label="Journal sections">
      <button type="button" class="ebb-journal__tab" data-view="living" aria-pressed="true">${iconSvg('plant')}<span>Living things</span></button>
      <button type="button" class="ebb-journal__tab" data-view="notes" aria-pressed="false">${iconSvg('notes')}<span>Notes</span></button>
    </nav>
    <div class="ebb-journal__body" tabindex="-1"></div>`;
  const body = /** @type {HTMLElement} */ (panel.querySelector('.ebb-journal__body'));
  const backBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-act="back"]'));
  const sizeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-act="size"]'));
  const tabs = /** @type {HTMLButtonElement[]} */ ([...panel.querySelectorAll('[data-view]')]);

  /** @param {MouseEvent} e */
  function onClick(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    const ui = get('journalUi') ?? {};
    if (b === openBtn) dispatch({ type: 'ui.journal', toggle: true });
    else if (b.dataset.act === 'close') dispatch({ type: 'ui.journal', open: false });
    else if (b.dataset.act === 'back') dispatch({ type: 'ui.journal', page: null });
    else if (b.dataset.act === 'size') dispatch({ type: 'ui.journal', size: ui.size === 'full' ? 'half' : 'full' });
    else if (b.dataset.view) dispatch({ type: 'ui.journal', view: /** @type {'living'|'notes'} */ (b.dataset.view), page: null });
    else if (b.dataset.page) dispatch({ type: 'ui.journal', page: b.dataset.page });
  }
  /** Keep pointer and wheel input on the journal from reaching the island. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const r of [btnRoot, panel]) {
    r.addEventListener('click', onClick);
    r.addEventListener('pointerdown', stop);
    r.addEventListener('pointermove', stop);
    r.addEventListener('wheel', stop, { passive: true });
  }

  /** @type {string} */ let shownKey = '';
  function render() {
    /** @type {import('../world/journal/index.js').JournalUiSlice} */
    const ui = get('journalUi') ?? { open: false, view: 'living', page: null, size: 'half' };
    panel.classList.toggle('is-open', ui.open);
    panel.classList.toggle('is-full', ui.size === 'full');
    panel.inert = !ui.open;
    panel.setAttribute('aria-hidden', String(!ui.open));
    openBtn.setAttribute('aria-expanded', String(ui.open));
    openBtn.classList.toggle('is-on', ui.open);
    sizeBtn.setAttribute('aria-label', ui.size === 'full' ? 'Make the journal shorter' : 'Make the journal taller');
    sizeBtn.title = ui.size === 'full' ? 'Shorter' : 'Taller';
    document.documentElement.classList.toggle('ebb-journal-open', ui.open);
    if (!ui.open) return;
    for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.view === ui.view));
    backBtn.hidden = !(ui.view === 'living' && ui.page);
    const html = ui.view === 'notes' ? notesView() : ui.page ? pageView(ui.page) : listView();
    const key = `${ui.view}|${ui.page}`;
    if (html === body.dataset.html) return;
    body.innerHTML = html;
    body.dataset.html = html;
    if (key !== shownKey) { body.scrollTop = 0; shownKey = key; }
  }

  function listView() {
    const rows = words.order.map((/** @type {string} */ sp) => {
      const d = live.describe(sp);
      const icon = d.known ? iconSvg(d.icon) : iconSvg('unknown');
      const line = d.known ? d.status : d.riddle;
      return `<li><button type="button" class="ebb-jlist__row${d.known ? '' : ' is-pencil'}" data-page="${esc(sp)}">
        <span class="ebb-jlist__icon">${icon}</span>
        <span class="ebb-jlist__text"><b>${esc(d.known ? d.name : 'Not yet seen')}</b><span class="ebb-journal__voice">${esc(line)}</span></span>
      </button></li>`;
    });
    return `<ul class="ebb-jlist">${rows.join('')}</ul>`;
  }

  /** @param {string} sp */
  function pageView(sp) {
    if (!words.species[sp]) return listView();
    const d = live.describe(sp);
    if (!d.known) {
      return `<article class="ebb-jpage">
        <div class="ebb-jpage__top"><span class="ebb-jpage__sketch is-pencil">${iconSvg('unknown')}</span><h3>Not yet seen</h3></div>
        <p class="ebb-jpage__status ebb-journal__voice is-pencil">${esc(d.riddle)}</p></article>`;
    }
    const known = d.likes.filter((l) => l.known);
    const moreToLearn = known.length < d.likes.length;
    const likes = known.map((l) => `<li>${esc(l.text)}</li>`).join('') +
      (moreToLearn ? '<li class="is-pencil">More to learn by watching.</li>' : '');
    const seasons = d.seasons.map((s) => `<div class="ebb-jpage__season${s.text === null ? ' is-empty' : ''}">
      <b>${esc(s.name)}</b><span>${esc(s.text === null ? 'not yet' : s.text)}</span></div>`).join('');
    const gives = d.gives.map((g) => `<li class="${g.known ? '' : 'is-pencil'}">${esc(g.text)}</li>`).join('');
    const notes = d.notes.map((n) => `<li><span class="ebb-journal__voice">${esc(n.text)}</span> <small>${esc(n.date)}</small></li>`).join('');
    return `<article class="ebb-jpage">
      <div class="ebb-jpage__top"><span class="ebb-jpage__sketch">${iconSvg(d.icon)}</span><h3>${esc(d.name)}</h3></div>
      <p class="ebb-jpage__status ebb-journal__voice">${esc(d.status)}</p>
      <section><h4>Likes</h4><ul class="ebb-jpage__list">${likes}</ul></section>
      <section><h4>Seasons</h4><div class="ebb-jpage__seasons">${seasons}</div></section>
      ${gives ? `<section><h4>Gives</h4><ul class="ebb-jpage__list">${gives}</ul></section>` : ''}
      ${notes ? `<section><h4>Notes</h4><ul class="ebb-jpage__notes">${notes}</ul></section>` : ''}
    </article>`;
  }

  function notesView() {
    /** @type {import('../world/journal/observe.js').Journal} */
    const j = get('journal') ?? live.journal();
    if (!j.notes.length) return '<p class="ebb-journal__empty ebb-journal__voice">Nothing written yet. Watch the island for a while.</p>';
    const items = j.notes.map((n) => {
      const inner = `<span class="ebb-journal__voice">${esc(n.text)}</span><small>${esc(n.date)}</small>`;
      return n.sp && words.species[n.sp]
        ? `<li><button type="button" class="ebb-jnotes__row" data-page="${esc(n.sp)}">${inner}</button></li>`
        : `<li><div class="ebb-jnotes__row">${inner}</div></li>`;
    });
    return `<ul class="ebb-jnotes">${items.join('')}</ul>`;
  }

  render();
  const unsubs = [subscribe('journal', render), subscribe('journalUi', render)];
  parent.appendChild(btnRoot);
  parent.appendChild(panel);

  return function dispose() {
    for (const u of unsubs) u();
    btnRoot.remove();
    panel.remove();
    document.documentElement.classList.remove('ebb-journal-open');
  };
}

/** @param {string} s */
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
