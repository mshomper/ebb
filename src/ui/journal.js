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
import { webView, tiesStrip } from './journal-web.js';
import { nodeOfPage } from '../world/journal/web.js';
import { livingList, cleanChoice } from '../world/journal/list.js';
import { createShelfView } from './journal-shelf.js';
import { trailsView } from './journal-trails.js';


/** Sections, in order, with their drawn icons. Trails spans the whole row above the six (doc 13). */
const VIEWS = [
  { id: 'trails', label: 'Trails', icon: 'trails', wide: true },
  { id: 'living', label: 'Living things', icon: 'plant' },
  { id: 'ground', label: 'Ground', icon: 'soil' },
  { id: 'web', label: 'Web', icon: 'web' },
  { id: 'almanac', label: 'Almanac', icon: 'almanac' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { id: 'shelf', label: 'Shelf', icon: 'shelf' },
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
/** From this width the Trails page shows its three trails side by side, in a wider panel. */
const WIDE = '(min-width: 1100px)';

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
  // The Shelf section (journal-shelf.js): the keepsakes kept, when the app has handed in their recipes.
  const shelfLive = /** @type {any} */ (live).shelf;
  const shelf = shelfLive ? createShelfView({ ...shelfLive, words }) : null;

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
      ${VIEWS.map((v) => `<button type="button" class="ebb-journal__tab${v.wide ? ' is-wide' : ''}" data-view="${v.id}" aria-pressed="false">${iconSvg(v.icon)}<span>${v.label}</span></button>`).join('')}
    </nav>
    <div class="ebb-journal__body" tabindex="-1"></div>`;
  const body = /** @type {HTMLElement} */ (panel.querySelector('.ebb-journal__body'));
  const backBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-act="back"]'));
  const sizeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-act="size"]'));
  const tabs = /** @type {HTMLButtonElement[]} */ ([...panel.querySelectorAll('[data-view]')]);

  // The Web section (journal-web.js): the trail of things tapped there (the last is the one in the
  // middle), the shelf tab open (null follows the middle one's kind), and the thing the journal
  // last showed, which the Web opens on.
  /** @type {string[]} */ let webTrail = [];
  /** @type {string | null} */ let webShelf = null;
  /** @type {string | null} */ let lastShown = null;
  /** The last journalUi.webAtN taken. @type {number | undefined} */ let webAtSeen;
  /** The Living things list's folds, filter and sort (list.js), kept per device in settings. @type {import('../world/journal/list.js').ListChoice | null} */
  let listChoice = null;
  const choice = () => ({ ...(listChoice ??= cleanChoice(get('settings')?.journalList, live.list)) });
  /** Put a thing in the middle of the Web: back along the trail if it is on it, else onto its end. @param {string} id */
  function toTrail(id) {
    const at = webTrail.indexOf(id);
    webTrail = at >= 0 ? webTrail.slice(0, at + 1) : [...webTrail, id].slice(-(live.web.trailMax ?? 4));
  }
  /** Tap a thing in the Web, or a chip on a page: it moves to the middle of the Web. @param {string} id */
  function focusWeb(id) {
    if (lastShown && lastShown !== id) toTrail(lastShown);
    toTrail(id);
    webShelf = null;
    lastShown = null;
    const ui = get('journalUi');
    if (ui?.view !== 'web') dispatch({ type: 'ui.journal', view: 'web', page: null });
    else render();
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const t = /** @type {HTMLElement} */ (e.target);
    if (shelf?.click(t, render)) return;
    const node = /** @type {HTMLElement | null} */ (t.closest('[data-web-node]'));
    if (node?.dataset.webNode) { focusWeb(node.dataset.webNode); return; }
    const crumb = /** @type {HTMLElement | null} */ (t.closest('[data-web-trail]'));
    if (crumb?.dataset.webTrail) { webTrail = webTrail.slice(0, Number(crumb.dataset.webTrail) + 1); webShelf = null; render(); return; }
    const tab = /** @type {HTMLElement | null} */ (t.closest('[data-web-shelf]'));
    if (tab?.dataset.webShelf) { webShelf = tab.dataset.webShelf; render(); return; }
    // The Living things list's folds, filter and sort, kept on this device.
    const lb = /** @type {HTMLElement | null} */ (t.closest('[data-list-fold],[data-list-status],[data-list-place],[data-list-sort]'));
    if (lb && live.list) {
      const c = choice();
      const d = lb.dataset;
      if (d.listFold) c.shut = { ...c.shut, [d.listFold]: !c.shut[d.listFold] };
      else if (d.listStatus) c.status = /** @type {any} */ (d.listStatus);
      else if (d.listPlace) c.place = c.place === d.listPlace ? null : d.listPlace;
      else if (d.listSort) c.sort = /** @type {any} */ (d.listSort);
      listChoice = c;
      dispatch({ type: 'settings.set', patch: { journalList: c } });
      render();
      return;
    }
    const b = /** @type {HTMLElement | null} */ (t.closest('button'));
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
    } else if (b.dataset.view) dispatch(/** @type {any} */ ({ type: 'ui.journal', view: b.dataset.view, page: null, ...(b.dataset.trail ? { trail: b.dataset.trail } : {}) }));
    else if (b.dataset.trail) dispatch(/** @type {any} */ ({ type: 'ui.journal', trail: b.dataset.trail }));
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
    // Trails: on a wide window the panel widens so the three sit side by side (journal-trails.css).
    const wide = ui.view === 'trails' && window.matchMedia(WIDE).matches;
    panel.classList.toggle('is-wide', wide);
    // The Web opens on whatever the journal last showed.
    if (paged) lastShown = nodeOfPage(live.web, ui.page);
    if (ui.view === 'web' && lastShown) { toTrail(lastShown); lastShown = null; webShelf = null; }
    // A note about a thing with no page of its own opens the Web on it.
    if (ui.view === 'web' && ui.webAt && ui.webAtN !== webAtSeen) { webAtSeen = ui.webAtN; toTrail(ui.webAt); webShelf = null; }
    if (ui.view === 'web' && !webTrail.length) webTrail = [live.web.start];
    const L = /** @type {any} */ (live);
    const html = ui.view === 'shelf' && shelf ? shelf.html() : ui.view === 'notes' ? notesView() : ui.view === 'almanac' ? almanacView()
      : ui.view === 'web' ? webView(live.describeWeb(), live.web, { trail: webTrail, shelf: webShelf })
      : ui.view === 'trails' ? trailsView({ live: L, words, R: L.naturalist, B: L.beachcomber, S: L.shaper, which: /** @type {any} */ (ui).trail ?? 'naturalist', wide })
      : paged ? pageView(/** @type {string} */ (ui.page)) : ui.view === 'ground' ? listView(island.groundOrder) : livingView();
    // A new thing in the middle of the Web scrolls back up to its card.
    const key = `${ui.view}|${ui.page}|${ui.view === 'web' ? webTrail[webTrail.length - 1] : ''}`;
    if (html === body.dataset.html) return;
    body.innerHTML = html;
    body.dataset.html = html;
    if (ui.view === 'shelf') shelf?.after(body);
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

  /**
   * Small lives (docs/future/11): the finds you have found, after the living things, with a mark
   * for each. Never the ones still to find: the journal does not list what is missing, so until the
   * first a single pencil line says where to look.
   */
  function smallLivesView() {
    const S = words.smallLives;
    const ids = words.findOrder ?? [];
    if (!S || !ids.length) return '';
    const found = ids.filter((id) => live.describe(id).known);
    const head = `<h4 class="ebb-jlist__group">${esc(S.title)}</h4>`;
    if (!found.length) return `${head}<p class="ebb-journal__voice ebb-jlist__hint">${esc(S.none)}</p>`;
    return head + marksHtml(found) + listView(found);
  }

  /**
   * The way into the trails (journal-trails.js) at the top of Small lives: one row that opens the
   * Trails page on the naturalist's trail, in words. Without the progress module, nothing.
   * @param {string[]} _found
   */
  function marksHtml(_found) {
    const R = /** @type {any} */ (live).naturalist;
    if (!R || !(/** @type {any} */ (live).progress)) return '';
    return `<button type="button" class="ebb-nat-entry" data-view="trails" data-trail="naturalist">
      <span class="ebb-nat-entry__icon">${iconSvg('notes')}</span>
      <span class="ebb-jlist__text"><b>${esc(R.line.title)}</b><span class="ebb-journal__voice">${esc(R.line.entry)}</span></span>
      ${iconSvg('chevron', 'ebb-nat-entry__chev')}</button>`;
  }


  /**
   * Living things, tidied as the island fills (list.js): filter and sort chips, then each group under
   * a header that folds it shut, tinted by kind as in the Web. No counts anywhere.
   */
  function livingView() {
    const L = live.list;
    if (!L) return listView(words.order) + smallLivesView();
    const c = choice();
    const j = live.journal();
    const U = live.unread();
    const groups = livingList(L, words, c, (id) => {
      const d = live.describe(id);
      return { id, known: d.known, name: d.known ? d.name : '' };
    }, (id) => j.species[id]?.first ?? -1, get('unlocks') ?? null);
    /** @param {string} attr @param {string} value @param {string} label @param {boolean} on */
    const pill = (attr, value, label, on) => `<button type="button" class="ebb-jl-chip" data-list-${attr}="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
    const controls = `<div class="ebb-jl-controls">
      <div class="ebb-jl-row" role="group" aria-label="${esc(L.labels.filter)}"><span class="ebb-jl-label">${esc(L.labels.filter)}</span>
        ${Object.entries(L.filters).map(([k, v]) => pill('status', k, /** @type {string} */ (v), c.status === k)).join('')}
        ${Object.entries(L.places).map(([k, v]) => pill('place', k, /** @type {string} */ (v), c.place === k)).join('')}</div>
      <div class="ebb-jl-row" role="group" aria-label="${esc(L.labels.sort)}"><span class="ebb-jl-label">${esc(L.labels.sort)}</span>
        ${Object.entries(L.sorts).map(([k, v]) => pill('sort', k, /** @type {string} */ (v), c.sort === k)).join('')}</div></div>`;
    const body = groups.map((g) => {
      const icon = g.icon ?? live.web?.kinds?.[g.tint]?.icon ?? 'plant';
      // A folded group still says when something in it is new.
      const fresh = g.shut && g.rows.some((id) => U.pages.has(id)) ? NEW : '';
      const head = `<h4 class="ebb-jl-head"><button type="button" class="ebb-jl-fold" data-list-fold="${esc(g.id)}" aria-expanded="${!g.shut}"
        aria-label="${esc(`${g.label}: ${g.shut ? L.labels.open : L.labels.shut}`)}"><span class="ebb-jl-pill">${iconSvg(icon)}<span>${esc(g.label)}</span></span>${fresh}${iconSvg('chevron', 'ebb-jl-chev')}</button></h4>`;
      if (g.shut) return `<section class="ebb-jl-group is-${esc(g.tint)} is-shut">${head}</section>`;
      // Found small lives keep their row of marks (a one-page group such as Shells lists its items instead).
      const marks = g.foundOnly && g.many && g.rows.length && words.smallLives?.marks ? marksHtml(g.rows) : '';
      const inner = g.rows.length ? marks + listView(g.rows) + g.rows.map(itemsView).join('') : `<p class="ebb-journal__voice ebb-jlist__hint">${esc(g.hint ?? L.empty)}</p>`;
      return `<section class="ebb-jl-group is-${esc(g.tint)}">${head}${inner}</section>`;
    }).join('');
    return controls + body;
  }

  /**
   * A collection's found items (the Shells page) under its row in the list: each item's name, rarity
   * and line in one text block, so they wrap as words. Never the ones still to find. @param {string} id
   */
  function itemsView(id) {
    const items = (/** @type {any} */ (live.describe(id)).collection ?? []).filter((/** @type {any} */ c) => c.found);
    if (!items.length) return '';
    return `<ul class="ebb-jl-items">${items.map((/** @type {any} */ c) => `<li><button type="button" class="ebb-jl-item" data-page="${esc(id)}"><span class="ebb-jl-item__text">` +
      `<b>${esc(c.name)}</b> <small class="ebb-jpage__rarity">${esc(c.rarity)}</small> <span class="ebb-journal__voice">${esc(c.text)}</span></span></button></li>`).join('')}</ul>`;
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
      ${tiesStrip(live.describeWeb(), live.web, nodeOfPage(live.web, id))}
      ${d.named?.length ? section('Named', `<ul class="ebb-jpage__list">${d.named.map((/** @type {string} */ n) => `<li>${esc(n)}</li>`).join('')}</ul>`) : ''}
      ${d.collection?.length ? section('Found so far', `<ul class="ebb-jpage__list ebb-jpage__collection">${d.collection.map((/** @type {any} */ c) => c.found
        ? `<li><span><b>${esc(c.name)}</b> <small class="ebb-jpage__rarity">${esc(c.rarity)}</small><br><span class="ebb-journal__voice">${esc(c.text)}</span></span></li>`
        : `<li class="is-pencil"><span class="ebb-journal__voice">${esc(c.text)}</span></li>`).join('')}</ul>`) : ''}
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
      if (n.sp && live.hasPage(n.sp)) return `<li><button type="button" class="ebb-jnotes__row" data-page="${esc(n.sp)}">${inner}</button></li>`;
      // A note about a thing with no page of its own (a rock pool, the wrack) leads to it in the Web.
      if (n.sp && live.web.nodes?.[n.sp]) return `<li><button type="button" class="ebb-jnotes__row" data-web-node="${esc(n.sp)}">${inner}</button></li>`;
      return `<li><div class="ebb-jnotes__row">${inner}</div></li>`;
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
  const unsubs = [subscribe('journal', render), subscribe('journalUi', render), subscribe('keepsakes', render), subscribe('shelfPending', render), subscribe('shelfUi', render),
    // A first written (a keepsake kept, a mark seen, a place made) moves the trails on.
    subscribe('unlocks', () => { if (get('journalUi')?.view === 'trails') render(); })];
  // The Trails page sits side by side or in tabs by the window's width.
  const onResize = () => { if (get('journalUi')?.view === 'trails') render(); };
  window.addEventListener('resize', onResize);
  buttonParent.appendChild(btnRoot);
  parent.appendChild(panel);

  return function dispose() {
    for (const u of unsubs) u();
    window.removeEventListener('resize', onResize);
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
