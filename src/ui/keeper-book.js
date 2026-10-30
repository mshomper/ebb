// @ts-check
// The Keeper book (Matt, October 30, 2026; menus-plan option B): the journal keeps the island, and
// this book keeps the keeper. Once the Walker page, now on the same paper and binding with a tab row:
// Kit (the walker's things, src/ui/walker-page.js), Threads (src/ui/keeper-threads.js), Trails with
// the herbarium, Shelf with its letters, and Camp (journal-trails.js, journal-herbarium.js,
// journal-shelf.js, journal-camp.js, moved here from the journal). Opened by I or the Keeper button at
// the bottom right, beside the time button; Esc or the close button shuts it. It remembers the last
// tab (on this device, in settings). On a wide window Trails widens the book so the four trails sit
// two by two, or side by side.
// Reads `keeperUi`, `journal`, `threads`, the camp and shelf slices; answers `ui.keeper`
// (src/world/keeper/route.js) and the older `ui.walkerPage`. One book open at a time: opening it
// shuts the journal and the sketchbook, and they (or a station) shut it. Styles: walker-page.css,
// keeper-book.css.

import { get, update, subscribe } from '../core/store.js';
import { dispatch, onAction } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { mountKitPage } from './walker-page.js';
import { createShelfView } from './journal-shelf.js';
import { trailsView } from './journal-trails.js';
import { herbariumView } from './journal-herbarium.js';
import { keeperView, keeperShown, keeperUnread } from './journal-keeper.js';
import { campView } from './journal-camp.js';
import { KEEPER_TABS, keeperUi0, nextKeeperUi } from '../world/keeper/route.js';

/** Each tab's drawn icon. @type {Record<string, string>} */
const TAB_ICON = { kit: 'walker', threads: 'threads', trails: 'trails', shelf: 'shelf', camp: 'pitch' };
/** Under this window width the book covers the island, so Show me shuts it. */
const NARROW = '(max-width: 699px)';
/** From this width Trails shows its four trails two by two in a wider book; from WIDE4, side by side. */
const WIDE = '(min-width: 1100px)';
const WIDE4 = '(min-width: 1400px)';
const NEW = '<span class="ebb-new" role="img" aria-label="New"></span>';

/** @param {any} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Mount the Keeper button and book.
 * @param {HTMLElement} parent @param {HTMLElement} buttonParent the HUD layer
 * @param {{ live: any, words: any, W: any, T: any, H: any, kit?: { recipe: any, pack: any, portrait?: (host: HTMLElement) => { start: () => void, stop: () => void } } | null }} o
 *   live: the live journal with the trails' recipes, shelf, keeper pages and cook recipe (as main.js
 *   hands the journal); words: recipes/world/journal.json; W: the book's words (recipes/world/kit.json
 *   words); T: recipes/world/threads.json; H: recipes/world/morning-hints.json; kit: the Kit page's
 *   recipe, pack and portrait, or none (the Kit tab then stays hidden)
 * @returns {() => void} dispose
 */
export function mountKeeperBook(parent, buttonParent, o) {
  ensureIconSprite();
  const { live, words, W, T, H } = o;
  const L = /** @type {any} */ (live);
  const shelf = L.shelf ? createShelfView({ ...L.shelf, words }) : null;
  const keeper = L.keeper ?? null, cookR = L.cook ?? null;
  const tabsShown = KEEPER_TABS.filter((t) => t !== 'kit' || !!o.kit);
  const kindOf = (/** @type {string} */ sp) => words?.species?.[sp]?.kind;
  const label = (/** @type {string} */ t) => W.tabs?.[t] ?? t;

  if (!get('keeperUi')) {
    const last = get('settings')?.keeperTab;
    update('keeperUi', () => keeperUi0(tabsShown.includes(last) ? last : tabsShown[0]));
  }
  /** @returns {import('../world/keeper/route.js').KeeperUi} */
  const ui = () => get('keeperUi') ?? keeperUi0(tabsShown[0]);

  const btnRoot = document.createElement('div');
  btnRoot.className = 'ebb-wpbtn';
  btnRoot.innerHTML = `<button type="button" class="ebb-jbtn__btn" aria-label="${esc(W.open)}" title="${esc(W.open)} (I)" aria-expanded="false">${iconSvg('keeper', 'ebb-jbtn__icon')}</button>`;
  const openBtn = /** @type {HTMLButtonElement} */ (btnRoot.querySelector('button'));

  const root = document.createElement('div');
  root.className = 'ebb-wp ebb-kb';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', W.title);
  root.inert = true;
  root.innerHTML = `
    <div class="ebb-wp__head">
      <h2 class="ebb-wp__title">${esc(W.title)}</h2>
      <button type="button" class="ebb-wp__close" data-close="1" aria-label="${esc(W.close)}" title="${esc(W.close)} (I)">${iconSvg('close')}</button>
    </div>
    <nav class="ebb-kb__nav" aria-label="${esc(W.sections ?? W.title)}">
      ${tabsShown.map((t) => `<button type="button" class="ebb-kb__tab" data-tab="${t}" aria-pressed="false">${iconSvg(TAB_ICON[t])}<span>${esc(label(t))}</span></button>`).join('')}
    </nav>
    <div class="ebb-kb__kit" data-kit-pane></div>
    <div class="ebb-kb__page" data-page-pane tabindex="-1"></div>`;
  const kitPane = /** @type {HTMLElement} */ (root.querySelector('[data-kit-pane]'));
  const body = /** @type {HTMLElement} */ (root.querySelector('[data-page-pane]'));
  const tabs = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-tab]')]);
  const offKit = o.kit ? mountKitPage(kitPane, { recipe: o.kit.recipe, words, pack: o.kit.pack, portrait: o.kit.portrait }) : null;

  /** The page a tab shows now, as HTML. @param {import('../world/keeper/route.js').KeeperUi} u @param {boolean} wide @param {boolean} four */
  function pageHtml(u, wide, four) {
    const flags = get('journal')?.flags ?? [];
    const earned = get('unlocks')?.earned ?? {};
    if (u.tab === 'trails') {
      // The herbarium (the forager's trail): opened from its trail, once given.
      if (u.page === 'herbarium' && L.forager && earned.forage?.herbarium) {
        return herbariumView({ earned, F: L.forager, words, gather: L.gatherRecipe, partName: L.partName ?? ((/** @type {string} */ k) => k) });
      }
      return trailsView({ live: L, words, R: L.naturalist, B: L.beachcomber, S: L.shaper, F: L.forager, which: /** @type {any} */ (u.trail ?? 'naturalist'), wide, four,
        herbarium: !!earned.forage?.herbarium });
    }
    if (u.tab === 'shelf') return shelf ? shelf.html() : '';
    if (u.tab === 'camp') return cookR ? campView(cookR, get('camp'), get('cook'), get('campPad'), words, get('campBed'), false) : '';
    // Threads: a keeper page (the old keeper's thread opens them), a thread, or the tab's own page.
    if (u.page?.startsWith('keeper:') && keeper) return keeperView(keeper, flags, u.page.slice(7) || null, NEW);
    // Until Threads is written, the tab holds the keeper's pages.
    return keeper ? keeperView(keeper, flags, null, NEW) : '';
  }

  /** @type {string} */ let shownKey = '';
  function render() {
    const u = ui();
    root.classList.toggle('is-open', u.open);
    root.inert = !u.open;
    openBtn.classList.toggle('is-on', u.open);
    openBtn.setAttribute('aria-expanded', String(u.open));
    // New marks: a keeper page unread, or a thread line not yet seen, on Threads and on the button.
    const flags = get('journal')?.flags ?? [];
    const threadsNew = keeperUnread(keeper, flags);
    dot(openBtn, threadsNew);
    for (const t of tabs) {
      dot(t, t.dataset.tab === 'threads' && threadsNew);
      t.setAttribute('aria-pressed', String(t.dataset.tab === u.tab));
    }
    const kit = u.tab === 'kit';
    root.classList.toggle('is-kit', kit);
    kitPane.hidden = !kit;
    body.hidden = kit;
    const wide = u.open && u.tab === 'trails' && !u.page && window.matchMedia(WIDE).matches;
    const four = wide && window.matchMedia(WIDE4).matches;
    root.classList.toggle('is-wide', wide);
    root.classList.toggle('is-four', four);
    if (!u.open || kit) return;
    // A keeper page open: it shows, and counts as read from now on.
    if (u.tab === 'threads' && u.page?.startsWith('keeper:') && keeper) {
      const id = keeperShown(keeper, flags, u.page.slice(7) || null);
      if (id && !flags.includes(`keeper:${id}:read`)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `keeper:${id}:read` }));
    }
    const html = pageHtml(u, wide, four);
    const key = `${u.tab}|${u.page}`;
    if (html !== body.dataset.html) {
      body.innerHTML = html;
      body.dataset.html = html;
      if (u.tab === 'shelf') shelf?.after(body);
    }
    if (key !== shownKey) { body.scrollTop = 0; shownKey = key; }
  }

  /** A small ink dot that says "new", on a button. @param {HTMLElement} el @param {boolean} on */
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

  /** @param {any} a */
  const go = (a) => dispatch(/** @type {any} */ ({ type: 'ui.keeper', ...a }));

  /** @param {MouseEvent} e */
  function onClick(e) {
    const t = /** @type {HTMLElement} */ (e.target);
    if (ui().tab === 'shelf' && shelf?.click(t, render)) return;
    const b = /** @type {HTMLElement | null} */ (t.closest('button'));
    if (!b) return;
    const d = b.dataset;
    if (b === openBtn) go({ toggle: true });
    else if (d.close) go({ open: false });
    else if (d.tab) go({ tab: d.tab, page: null });
    else if (d.thread) go({ tab: 'threads', page: `thread:${d.thread}` });
    else if (d.threadBack) go({ tab: 'threads', page: null });
    else if (d.show) {
      dispatch({ type: 'journal.showMe', sp: d.show });
      // In a narrow window the book would hide what the camera goes to; it shuts.
      if (window.matchMedia(NARROW).matches) go({ open: false });
    }
    // The links the moved pages carry from the journal: within the book where they now live.
    else if (d.view === 'herbarium') go({ tab: 'trails', page: 'herbarium' });
    else if (d.view === 'trails') go({ tab: 'trails', page: null, ...(d.trail ? { trail: d.trail } : {}) });
    else if (d.view === 'shelf' || d.view === 'camp') go({ tab: d.view, page: null });
    else if (d.view === 'keeper') go({ tab: 'threads', page: `keeper:${d.keeper ?? ''}` });
    // A keeper page's way back goes to the old keeper's thread.
    else if (d.view === 'notes') go({ tab: 'threads', page: 'thread:keeper' });
    else if (d.trail) go({ trail: d.trail });
    // A living thing or a ground named on a trail: its page in the journal (which shuts this book).
    else if (d.page) dispatch({ type: 'ui.journal', open: true, page: d.page });
  }
  /** @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const r of [btnRoot, root]) {
    r.addEventListener('click', onClick);
    r.addEventListener('pointerdown', stop);
    r.addEventListener('pointermove', stop);
    r.addEventListener('wheel', stop, { passive: true });
  }

  const offAction = onAction((/** @type {any} */ a) => {
    if (a.type !== 'ui.keeper' && a.type !== 'ui.walkerPage') return;
    const u = ui();
    // The Walker page's own action, from before the book: open or toggle, as it was.
    const next = nextKeeperUi(u, a.type === 'ui.walkerPage' ? { open: a.open, toggle: a.toggle } : a);
    if (!tabsShown.includes(next.tab)) next.tab = tabsShown[0];
    // One book at a time: opening this shuts the journal and the sketchbook.
    if (next.open && get('journalUi')?.open) dispatch({ type: 'ui.journal', open: false });
    if (next.open && get('sketchbookUi')?.open) update('sketchbookUi', (s) => ({ ...s, open: false }));
    // Leaving Threads: its lines count as seen from now on.
    // Opening it puts the tap card away.
    if (next.open && !u.open && get('identify')) update('identify', () => null);
    update('keeperUi', () => next);
    if (next.tab !== get('settings')?.keeperTab) dispatch({ type: 'settings.set', patch: { keeperTab: next.tab } });
  });
  // Another panel opening shuts this one (the journal, the sketchbook, a station).
  const shut = () => { if (ui().open) go({ open: false }); };
  const closeFor = (/** @type {any} */ x) => { if (x?.open) shut(); };
  const onResize = () => { if (ui().open && ui().tab === 'trails') render(); };
  addEventListener('resize', onResize);
  // The button sits just left of the time button, whose width changes with its pips.
  const timeBtn = document.querySelector('.ebb-time__btn');
  const fit = () => { if (timeBtn) btnRoot.style.setProperty('--wp-time-w', `${/** @type {HTMLElement} */ (timeBtn).offsetWidth}px`); };
  const timeObs = timeBtn && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  if (timeBtn) timeObs?.observe(timeBtn);
  fit();
  document.documentElement.classList.add('ebb-has-walker-btn');

  /** Re-render when a slice changes that the shown tab reads. @param {string[]} on */
  const when = (on) => () => { if (on.includes(ui().tab)) render(); };
  const unsubs = [subscribe('keeperUi', render), subscribe('journal', render),
    subscribe('keepsakes', when(['shelf'])), subscribe('shelfPending', when(['shelf'])), subscribe('shelfUi', when(['shelf'])),
    subscribe('unlocks', when(['trails'])), subscribe('cook', when(['camp', 'threads'])), subscribe('camp', when(['camp'])), subscribe('campBed', when(['camp'])),
    subscribe('journalUi', closeFor), subscribe('sketchbookUi', closeFor), subscribe('stationView', (x) => { if (x) shut(); })];
  render();
  buttonParent.appendChild(btnRoot);
  parent.appendChild(root);
  return () => {
    for (const u of unsubs) u();
    offAction();
    offKit?.();
    removeEventListener('resize', onResize);
    timeObs?.disconnect();
    document.documentElement.classList.remove('ebb-has-walker-btn');
    btnRoot.remove(); root.remove();
  };
}
