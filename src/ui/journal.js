// @ts-check
// The field journal panel (docs/13, docs/15): the book button at the top right and the journal it
// opens. Desktop: a 440 px cream panel on the right, so the island stays in view. Phone: a sheet
// from the bottom that stops just under half way (the chevron makes it tall). Four sections:
// Living things and Ground (a page each, filled from what has happened on the island), Almanac
// (today on the island) and Notes. Words only, never numbers or bars.
//
// Reads the store slices `journal` and `journalUi` and the live journal (describe, almanac); never
// writes the store. Every choice goes out as a `ui.journal` or `journal.showMe` action
// (src/world/journal/index.js answers). Styles: journal.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { drawSketch, hasSketch } from './sketches/index.js';
import { webView } from './journal-web.js';

/** Sections, in order, with their drawn icons. */
const VIEWS = [
  { id: 'living', label: 'Living things', icon: 'plant' },
  { id: 'ground', label: 'Ground', icon: 'soil' },
  { id: 'web', label: 'Web', icon: 'web' },
  { id: 'almanac', label: 'Almanac', icon: 'almanac' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
];
/** Season box keys, spring first: each box takes its color and drawn mark from these (journal.css, icons.js). */
const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];
/** The drawn mark for each moment. @type {Record<string, string>} */
const MOMENT_ICON = {
  flower: 'moment-flower', rain: 'moment-rain', dusk: 'moment-dusk', dawn: 'moment-dawn', mist: 'moment-mist',
  summer: 'season-summer', winter: 'season-winter', frost: 'season-winter',
};
/** Under this width the journal is a sheet that covers the island's lower half (journal.css). */
const PHONE = '(max-width: 699px)';

/**
 * Mount the journal button and panel.
 * @param {HTMLElement} parent
 * @param {import('../world/journal/index.js').LiveJournal} live
 * @param {HTMLElement} [buttonParent] where the book button goes (the HUD layer); the panel stays in `parent`
 * @returns {() => void} dispose
 */
export function mountJournal(parent, live, buttonParent = parent) {
  ensureIconSprite();
  const { words, island } = live;

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
      <button type="button" class="ebb-journal__icon-btn" data-act="back" aria-label="Back to the list" title="Back">${iconSvg('back')}</button>
      <h2 class="ebb-journal__title">Field journal</h2>
      <button type="button" class="ebb-journal__icon-btn ebb-journal__size" data-act="size" aria-label="Make the journal taller" title="Taller">${iconSvg('chevron')}</button>
      <button type="button" class="ebb-journal__icon-btn" data-act="close" aria-label="Close the journal" title="Close (J)">${iconSvg('close')}</button>
    </header>
    <nav class="ebb-journal__nav" aria-label="Journal sections">
      ${VIEWS.map((v) => `<button type="button" class="ebb-journal__tab" data-view="${v.id}" aria-pressed="false">${iconSvg(v.icon)}<span>${v.label}</span></button>`).join('')}
    </nav>
    <div class="ebb-journal__body" tabindex="-1"></div>`;
  const body = /** @type {HTMLElement} */ (panel.querySelector('.ebb-journal__body'));
  const backBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-act="back"]'));
  const sizeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-act="size"]'));
  const tabs = /** @type {HTMLButtonElement[]} */ ([...panel.querySelectorAll('[data-view]')]);

  /** The name tapped in the Web section, whose links stand out (null for the whole web). @type {string | null} */
  let webFocus = null;
  /** Tap a name in the web: bring its links forward, or let go if it was already chosen. @param {string} id */
  function focusWeb(id) {
    webFocus = webFocus === id ? null : id;
    render();
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const node = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-web-node]'));
    if (node?.dataset.webNode) { focusWeb(node.dataset.webNode); return; }
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    const ui = get('journalUi') ?? {};
    if (b === openBtn) dispatch({ type: 'ui.journal', toggle: true });
    else if (b.dataset.act === 'close') dispatch({ type: 'ui.journal', open: false });
    else if (b.dataset.act === 'back') dispatch({ type: 'ui.journal', page: null });
    else if (b.dataset.act === 'size') dispatch({ type: 'ui.journal', size: ui.size === 'full' ? 'half' : 'full' });
    else if (b.dataset.show) {
      dispatch({ type: 'journal.showMe', sp: b.dataset.show });
      // On a phone the sheet would hide what the camera goes to; it closes, and the card leads back.
      if (window.matchMedia(PHONE).matches) dispatch({ type: 'ui.journal', open: false });
    } else if (b.dataset.view) dispatch({ type: 'ui.journal', view: /** @type {any} */ (b.dataset.view), page: null });
    else if (b.dataset.page) dispatch({ type: 'ui.journal', page: b.dataset.page });
  }
  /** Keep pointer and wheel input on the journal from reaching the island. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  // Names in the web are focusable: Enter or Space chooses one.
  panel.addEventListener('keydown', (e) => {
    const node = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('[data-web-node]'));
    if (node?.dataset.webNode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); focusWeb(node.dataset.webNode); }
  });
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
    // Read marks: a dot on the book while anything is unread, and on each section that holds it.
    const U = live.unread();
    const inSection = (/** @type {string[]} */ ids) => ids.some((id) => U.pages.has(id));
    dot(openBtn, U.notes > 0 || U.pages.size > 0);
    for (const t of tabs) {
      const v = t.dataset.view;
      dot(t, v === 'notes' ? U.notes > 0 : v === 'living' ? inSection(words.order) : v === 'ground' ? inSection(island.groundOrder) : false);
    }
    if (!ui.open) return;
    for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.view === ui.view));
    const paged = (ui.view === 'living' || ui.view === 'ground') && !!ui.page && live.hasPage(ui.page);
    backBtn.hidden = !paged;
    const html = ui.view === 'notes' ? notesView() : ui.view === 'almanac' ? almanacView()
      : ui.view === 'web' ? webView(live.describeWeb(), live.web, webFocus)
      : paged ? pageView(/** @type {string} */ (ui.page)) : ui.view === 'ground' ? listView(island.groundOrder) : listView(words.order);
    const key = `${ui.view}|${ui.page}`;
    if (html === body.dataset.html) return;
    body.innerHTML = html;
    body.dataset.html = html;
    if (key !== shownKey) { body.scrollTop = 0; shownKey = key; }
  }

  /** A small ink dot that says "new" (read marks), on a button or in a row. @param {HTMLElement} el @param {boolean} on */
  function dot(el, on) {
    let d = /** @type {HTMLElement | null} */ (el.querySelector(':scope > .ebb-new'));
    if (on && !d) {
      d = document.createElement('span');
      d.className = 'ebb-new';
      d.setAttribute('role', 'img');
      d.setAttribute('aria-label', 'New');
      el.appendChild(d);
    } else if (!on && d) d.remove();
  }
  const NEW = '<span class="ebb-new" role="img" aria-label="New"></span>';

  /** A list of pages. @param {string[]} ids */
  function listView(ids) {
    const U = live.unread();
    const rows = ids.map((id) => {
      const d = live.describe(id);
      const icon = d.known ? iconSvg(d.icon) : iconSvg('unknown');
      const line = d.known ? d.status : /** @type {any} */ (d).riddle;
      return `<li><button type="button" class="ebb-jlist__row${d.known ? '' : ' is-pencil'}" data-page="${esc(id)}">
        <span class="ebb-jlist__icon">${icon}</span>
        <span class="ebb-jlist__text"><b>${U.pages.has(id) ? NEW : ''}${esc(d.known ? d.name : 'Not yet seen')}</b><span class="ebb-journal__voice">${esc(line)}</span></span>
      </button></li>`;
    });
    return `<ul class="ebb-jlist">${rows.join('')}</ul>`;
  }

  /** A list of lines, inked or in pencil. @param {{ text: string, known: boolean }[]} lines @param {string} [hint] pencil line when some are unknown */
  function lines(lines, hint) {
    const known = lines.filter((l) => l.known);
    return known.map((l) => `<li>${esc(l.text)}</li>`).join('') +
      (known.length < lines.length && hint ? `<li class="is-pencil">${esc(hint)}</li>` : '');
  }

  /** @param {{ id: string, label: string, date: string | null }[]} moments @param {string} icon the page's own icon */
  function momentsHtml(moments, icon) {
    return `<div class="ebb-jpage__moments">${moments.map((m) => (m.date === null
      ? '<div class="ebb-jpage__moment is-empty" aria-label="A moment not yet seen"><span class="ebb-jpage__q">?</span></div>'
      : `<div class="ebb-jpage__moment"><span class="ebb-jpage__mart">${iconSvg(icon, 'ebb-jpage__mmain')}${iconSvg(MOMENT_ICON[m.id] ?? 'notes', 'ebb-jpage__mmark')}</span>
          <span class="ebb-jpage__mlabel">${esc(m.label)}</span><small>${esc(m.date)}</small></div>`)).join('')}</div>`;
  }

  /** A living thing's or a ground's page. @param {string} id */
  function pageView(id) {
    const d = /** @type {any} */ (live.describe(id));
    // The field sketch across the top of the page (J1.6), in the stage the page has reached.
    const art = hasSketch(id) && d.sketch ? `<figure class="ebb-jpage__art">${drawSketch(id, d.sketch)}</figure>` : '';
    if (!d.known) {
      return `<article class="ebb-jpage">
        <div class="ebb-jpage__top">${art ? '' : `<span class="ebb-jpage__sketch is-pencil">${iconSvg('unknown')}</span>`}<h3>Not yet seen</h3></div>
        ${art}
        <p class="ebb-jpage__status ebb-journal__voice is-pencil">${esc(d.riddle)}</p></article>`;
    }
    const show = d.canShow ? `<button type="button" class="ebb-jpage__show" data-show="${esc(id)}">${iconSvg('find')}<span>Show me</span></button>` : '';
    const since = get('journalUi')?.pageSince ?? Infinity;
    const notes = d.notes.map((/** @type {any} */ n) => `<li>${n.n > since ? NEW : ''}<span class="ebb-journal__voice">${esc(n.text)}</span> <small>${esc(n.date)}</small></li>`).join('');
    /** @param {string} title @param {string} inner */
    const section = (title, inner) => (inner ? `<section><h4>${title}</h4>${inner}</section>` : '');
    let middle;
    if (d.kind === 'ground') {
      middle = section('What grows here', `<ul class="ebb-jpage__list">${d.grows.length
        ? `<li>${esc(d.grows.join(', '))}</li>` : '<li class="is-pencil">Nothing you know grows here yet.</li>'}</ul>`);
    } else {
      const seasons = d.seasons.map((/** @type {any} */ s, /** @type {number} */ i) => `<div class="ebb-jpage__season is-${SEASON_KEYS[i]}${s.text === null ? ' is-empty' : ''}">
        <b>${iconSvg(`season-${SEASON_KEYS[i]}`)}${esc(s.name)}</b><span>${esc(s.text === null ? 'not yet' : s.text)}</span></div>`).join('');
      middle = section('Likes', `<ul class="ebb-jpage__list">${lines(d.likes, 'More to learn by watching.')}</ul>`) +
        section('Seasons', `<div class="ebb-jpage__seasons">${seasons}</div>`);
    }
    const story = d.story?.length ? section("Your island's story", `<ul class="ebb-jpage__list ebb-jpage__story">${d.story.map((/** @type {string} */ s) => `<li>${esc(s)}</li>`).join('')}</ul>`) : '';
    const gives = d.gives?.length ? section('Gives', `<ul class="ebb-jpage__list">${d.gives.map((/** @type {any} */ g) => `<li class="${g.known ? '' : 'is-pencil'}">${esc(g.text)}</li>`).join('')}</ul>`) : '';
    return `<article class="ebb-jpage">
      <div class="ebb-jpage__top">${art ? '' : `<span class="ebb-jpage__sketch">${iconSvg(d.icon)}</span>`}<h3>${esc(d.name)}</h3>${show}</div>
      ${art}
      <p class="ebb-jpage__status ebb-journal__voice">${esc(d.status)}</p>
      ${middle}
      ${section('Field notes', `<ul class="ebb-jpage__list ebb-jpage__field">${lines(d.field, d.fieldHint)}</ul>`)}
      ${story}
      ${section('Moments', momentsHtml(d.moments, d.icon))}
      ${gives}
      ${section('Notes', notes ? `<ul class="ebb-jpage__notes">${notes}</ul>` : '')}
    </article>`;
  }

  function almanacView() {
    const rows = live.almanac();
    return `<dl class="ebb-jalm">${rows.map((r) => `<div class="ebb-jalm__row is-${esc(r.id)}"><dt>${esc(r.label)}</dt><dd class="ebb-journal__voice">${esc(r.text)}</dd></div>`).join('')}</dl>`;
  }

  function notesView() {
    /** @type {import('../world/journal/observe.js').Journal} */
    const j = get('journal') ?? live.journal();
    if (!j.notes.length) return '<p class="ebb-journal__empty ebb-journal__voice">Nothing written yet. Watch the island for a while.</p>';
    // Read marks: notes that never showed on the island come first, under their own heading;
    // the rest in order, the new ones (since Notes was last opened) with a dot.
    const since = get('journalUi')?.notesSince ?? Infinity;
    const R = words.readMarks;
    const item = (/** @type {any} */ n, /** @type {boolean} */ isNew) => {
      const inner = `<span class="ebb-journal__voice">${isNew ? NEW : ''}${esc(n.text)}</span><small>${esc(n.date)}</small>`;
      return n.sp && live.hasPage(n.sp)
        ? `<li><button type="button" class="ebb-jnotes__row" data-page="${esc(n.sp)}">${inner}</button></li>`
        : `<li><div class="ebb-jnotes__row">${inner}</div></li>`;
    };
    const missed = j.notes.filter((n) => live.noteState(n, since) === 'missed');
    const rest = j.notes.filter((n) => live.noteState(n, since) !== 'missed');
    const all = `<ul class="ebb-jnotes">${rest.map((n) => item(n, live.noteState(n, since) === 'new')).join('')}</ul>`;
    return missed.length
      ? `<h4 class="ebb-jnotes__head">${esc(R.missed)}</h4><ul class="ebb-jnotes">${missed.map((n) => item(n, true)).join('')}</ul>
         ${rest.length ? `<h4 class="ebb-jnotes__head">${esc(R.rest)}</h4>${all}` : ''}`
      : all;
  }

  render();
  // The almanac follows the time shown; refresh it now and then while it is open.
  const timer = setInterval(() => { const u = get('journalUi'); if (u?.open && u.view === 'almanac') render(); }, 2000);
  const unsubs = [subscribe('journal', render), subscribe('journalUi', render)];
  buttonParent.appendChild(btnRoot);
  parent.appendChild(panel);

  return function dispose() {
    for (const u of unsubs) u();
    clearInterval(timer);
    btnRoot.remove();
    panel.remove();
    document.documentElement.classList.remove('ebb-journal-open');
  };
}

/** @param {string} s */
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
