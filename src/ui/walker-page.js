// @ts-check
// The Walker page (Matt's mock and the plan approved October 26, 2026; K2). Everything the walker
// wears and carries, in one place, on the journal's paper: the title in Fraunces italic; four kit
// slots down the left (hat, lantern, in hand, coat), the chosen one ringed in ember with its owned
// choices popping out beside it; the walker in the middle (src/ui/walker-portrait.js), drag to turn,
// with the belt under it (shovel, knife, fire steel, sketchbook, the net); the carrier as a strap above
// the pouches, with the same pop-out; the pouches in two columns on the right (under the walker below
// 760 px); Q and E in the portrait's top corners once the Hollow is found; the chosen thing's name and the walker's words
// on a card at the bottom, its actions the item cards' own (src/ui/card-actions.js), so a pouch here
// offers Set down, Empty and the rest as its card does. A choice not owned is a blank outline, never
// named. Opened by I or the walker button at the bottom right, beside the time button; Esc or the
// close button shuts it.
// Reads the store slices `kitView` (src/world/kit) and `packView` (src/world/pack); keeps
// `walkerPageUi` { open, sel, pop }. Answers ui.walkerPage { open | toggle }. Styles: walker-page.css.

import { get, update, subscribe } from '../core/store.js';
import { dispatch, onAction } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { ensureItemSprite, itemIconSvg, itemPouchSvg, chipSvg } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';
import { actionsFor, cardAction, registerCardAction } from './card-actions.js';
import { pouchSvg } from './sketches/pouches.js';
import { pouchesOf } from '../world/pack/model.js';
import { SLOTS } from '../world/kit/model.js';

/** @param {any} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
/** A drawn icon from either family: the item glyphs first, then the interface's. @param {string} name */
const glyph = (name) => (name && !['sketchbook', 'net', 'walker'].includes(name) ? itemIconSvg(name) : iconSvg(name));
/** `?hollow` shows Q and E for a look without the Hollow found (a view only: nothing is set or saved). */
const PEEK_PEGS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('hollow');

/**
 * @typedef {{ kind: 'slot' | 'carrier' | 'pouch' | 'belt', id: string }} Sel
 * @typedef {{ open: boolean, sel: Sel, pop: string | null }} PageUi pop: the slot whose choices show ('carrier' for the strap)
 */

/**
 * Mount the walker button and the page.
 * @param {HTMLElement} parent @param {HTMLElement} buttonParent the HUD layer
 * @param {{ recipe: any, words: any, pack: any, portrait?: (host: HTMLElement) => { start: () => void, stop: () => void } }} o
 *   recipe: recipes/world/kit.json; words: recipes/world/journal.json (the card actions read it);
 *   pack: the live pack (kinds, nameOf, recipe); portrait: makes the walker's own small view in a host
 * @returns {() => void} dispose
 */
export function mountWalkerPage(parent, buttonParent, o) {
  ensureIconSprite();
  ensureItemSprite();
  const R = o.recipe, W = R.words, PW = o.pack.recipe.words;

  // The page's own card actions: wear a kit thing, put one away, open the sketchbook.
  const offActs = [
    registerCardAction({ id: 'kitwear', icon: 'wear', order: 4, main: true, label: W.wear,
      when: (c) => !!c?.kitSlot && !!c.kitId && !c.worn, action: (c) => ({ type: 'kit.wear', slot: c.kitSlot, id: c.kitId }) }),
    registerCardAction({ id: 'kitoff', icon: 'release', order: 5, label: (c) => R.off?.[c.kitSlot] ?? W.wear,
      when: (c) => (c?.kitSlot === 'lantern' || c?.kitSlot === 'hand') && !!c.kitId && !!c.worn, action: (c) => ({ type: 'kit.wear', slot: c.kitSlot, id: null }) }),
    registerCardAction({ id: 'kitbook', icon: 'sketchbook', order: 6, main: true, label: W.openBook,
      when: (c) => c?.belt === 'sketchbook' && !!c.owned, action: () => ({ type: 'kit.openBook' }) }),
  ];

  const btnRoot = document.createElement('div');
  btnRoot.className = 'ebb-wpbtn';
  btnRoot.innerHTML = `<button type="button" class="ebb-jbtn__btn" aria-label="${esc(W.open)}" title="${esc(W.open)} (I)" aria-expanded="false">${iconSvg('walker', 'ebb-jbtn__icon')}</button>`;
  const openBtn = /** @type {HTMLButtonElement} */ (btnRoot.querySelector('button'));

  const root = document.createElement('div');
  root.className = 'ebb-wp';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', W.title);
  root.inert = true;
  root.innerHTML = `
    <div class="ebb-wp__head">
      <h2 class="ebb-wp__title">${esc(W.title)}</h2>
      <button type="button" class="ebb-wp__close" data-close="1" aria-label="${esc(W.close)}" title="${esc(W.close)}">${iconSvg('close')}</button>
    </div>
    <div class="ebb-wp__body">
      <div class="ebb-wp__kit" data-kit></div>
      <div class="ebb-wp__middle">
        <div class="ebb-wp__portrait" data-portrait><span class="ebb-wp__turn">${esc(W.dragToTurn)}</span><div class="ebb-wp__pegs" data-pegs hidden></div></div>
        <div class="ebb-wp__belt" data-belt role="group" aria-label="${esc(W.belt)}"></div>
      </div>
      <div class="ebb-wp__side">
        <div data-strap></div>
        <div class="ebb-wp__pouches" data-pouches role="group" aria-label="${esc(W.pouches)}"></div>
      </div>
      <div class="ebb-wp__pop" data-pop hidden></div>
    </div>
    <div class="ebb-wp__about" data-about></div>`;
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s));
  const kitEl = $('[data-kit]'), beltEl = $('[data-belt]'), strapEl = $('[data-strap]'), pouchEl = $('[data-pouches]'),
    popEl = $('[data-pop]'), aboutEl = $('[data-about]'), pegsEl = $('[data-pegs]'), bodyEl = $('.ebb-wp__body');

  /** @returns {PageUi} */
  const ui = () => get('walkerPageUi') ?? { open: false, sel: { kind: 'slot', id: 'hat' }, pop: 'hat' };
  /** @param {Partial<PageUi>} p */
  const setUi = (p) => update('walkerPageUi', () => ({ ...ui(), ...p }));

  const portrait = o.portrait ? o.portrait($('[data-portrait]')) : null;
  let portraitOn = false;

  /** A kit thing's words from the recipe: its name, the walker's words, its icon. @param {string} slot @param {string | null} id */
  const item = (slot, id) => (id === null ? { name: R.none?.[slot]?.name ?? '', line: R.none?.[slot]?.line ?? '', icon: '' }
    : R.items[slot]?.[id] ?? { name: id, line: '', icon: '' });
  /** The carrier worn's id as the recipe names it ('pack' for the starting pack). @param {any} k */
  const carrierId = (k) => k.carrier ?? 'pack';
  /** The carriers owned, the starting pack first. @param {any} k */
  const carriersOwned = (k) => ['pack', ...k.owned.carrier];

  /** A tile for a kit slot or a choice. @param {string} attrs @param {string} face @param {string} cls @param {string} label */
  const tile = (attrs, face, cls, label) => `<button type="button" class="${cls}" ${attrs} aria-label="${esc(label)}">${face}</button>`;

  function renderKit(/** @type {any} */ v, /** @type {PageUi} */ u) {
    const k = v.kit;
    kitEl.innerHTML = SLOTS.map((s) => {
      const id = k[s], it = item(s, id);
      const sel = u.sel.kind === 'slot' && u.sel.id === s;
      return tile(`data-slot="${s}" aria-pressed="${sel}"`, id ? glyph(it.icon) : '', `ebb-wp__slot${sel ? ' is-sel' : ''}${id ? '' : ' is-empty'}`,
        `${W.slots[s]}: ${id ? it.name : item(s, null).name}`);
    }).join('');
  }

  function renderPop(/** @type {any} */ v, /** @type {PageUi} */ u) {
    const slot = u.pop;
    if (!slot) { popEl.hidden = true; return; }
    const k = v.kit;
    const owned = slot === 'carrier' ? carriersOwned(k) : k.owned[slot];
    const worn = slot === 'carrier' ? carrierId(k) : k[slot];
    const blanks = Math.max(0, (R.popSlots ?? 4) - owned.length);
    popEl.innerHTML = owned.map((/** @type {string} */ id) => {
      const it = item(slot, id), on = id === worn;
      return tile(`data-choice="${esc(id)}" data-for="${slot}" aria-pressed="${on}"`, glyph(it.icon), `ebb-wp__opt${on ? ' is-on' : ''}`, it.name);
    }).join('') + Array.from({ length: blanks }, () => `<span class="ebb-wp__opt is-blank" role="img" aria-label="${esc(W.notFound)}"></span>`).join('');
    popEl.hidden = false;
    popEl.classList.toggle('is-strap', slot === 'carrier');
    // Beside its slot (over the portrait's edge), or under the strap; kept inside the page.
    const anchor = /** @type {HTMLElement | null} */ (slot === 'carrier' ? strapEl.firstElementChild : kitEl.querySelector(`[data-slot="${slot}"]`));
    if (!anchor) return;
    const b = bodyEl.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const w = popEl.offsetWidth;
    if (slot === 'carrier') {
      const left = Math.max(0, Math.min(b.width - w, a.right - b.left - w));
      popEl.style.left = `${left}px`;
      popEl.style.top = `${a.bottom - b.top + 10}px`;
      // Its pointer under the strap's middle.
      popEl.style.setProperty('--wp-arrow', `${Math.max(14, Math.min(w - 28, a.left + a.width / 2 - b.left - left - 7))}px`);
    } else {
      popEl.style.left = `${Math.min(b.width - w, a.right - b.left + 14)}px`;
      popEl.style.top = `${Math.max(0, a.top - b.top - 6)}px`;
    }
  }

  function renderBelt(/** @type {any} */ v, /** @type {PageUi} */ u) {
    beltEl.innerHTML = v.belt.map((/** @type {{ id: string, owned: boolean }} */ t) => {
      const T = R.belt.find((/** @type {any} */ q) => q.id === t.id);
      const sel = u.sel.kind === 'belt' && u.sel.id === t.id;
      return t.owned ? tile(`data-belt="${t.id}" aria-pressed="${sel}"`, glyph(T.icon), `ebb-wp__tool${sel ? ' is-sel' : ''}`, T.name)
        : `<span class="ebb-wp__tool is-blank" role="img" aria-label="${esc(W.notFound)}"></span>`;
    }).join('');
  }

  function renderSide(/** @type {any} */ v, /** @type {any} */ pv, /** @type {PageUi} */ u) {
    const k = v.kit, cid = carrierId(k), it = item('carrier', cid);
    const sel = u.sel.kind === 'carrier';
    strapEl.innerHTML = tile('data-strap="1"', `${glyph(it.icon)}<span>${esc(it.name)}</span>`, `ebb-wp__strap${sel ? ' is-sel' : ''}`, `${W.slots.carrier}: ${it.name}`);
    const size = pv?.size ?? 0, list = pv?.pouches ?? [];
    // Pouches beyond the carrier show as faint dashed squares only once a bigger carrier is known.
    const most = Math.max(size, ...carriersOwned(k).map((id) => pouchesOf(id === 'pack' ? null : id, o.pack.recipe)));
    const cells = [];
    for (let i = 0; i < Math.max(size, list.length); i++) {
      const p = list[i];
      if (!p) { cells.push(`<span class="ebb-wp__pouch is-flat" role="img" aria-label="${esc(W.emptyPouch)}">${itemPouchSvg(null, 0)}</span>`); continue; }
      const icon = itemIconFor(p.kind), on = u.sel.kind === 'pouch' && Number(u.sel.id) === i;
      cells.push(tile(`data-pouch="${i}" aria-pressed="${on}"`, icon ? itemPouchSvg(icon, p.handfuls) : pouchSvg(p.handfuls, p.sketch),
        `ebb-wp__pouch${on ? ' is-sel' : ''}`, `${p.name}, ${PW.stage?.[p.handfuls] ?? ''}`));
    }
    for (let i = cells.length; i < most; i++) cells.push('<span class="ebb-wp__pouch is-locked" aria-hidden="true"></span>');
    pouchEl.innerHTML = cells.join('');
  }

  function renderPegs(/** @type {any} */ v) {
    // In the portrait's top corners (Q left, E right), floating over it so the page never changes size.
    // Hidden until the Hollow is found, so nothing hints at what is not found yet; ?hollow shows them for a look.
    const show = v.hollow || PEEK_PEGS;
    pegsEl.hidden = !show;
    // No Hollow moves exist yet, so both are empty pegs; a move's drawn icon goes inside once it does.
    pegsEl.innerHTML = show ? [['q', W.q], ['e', W.e]].map(([k, label]) =>
      `<span class="ebb-wp__peg is-${k} is-empty" role="img" aria-label="${esc(label)}"><i></i><b>${esc(label)}</b></span>`).join('') : '';
  }

  /** The card the bottom shows for what is chosen: the item cards' shape, so their actions fit it. @param {any} v @param {any} pv @param {Sel} sel */
  function cardFor(v, pv, sel) {
    const k = v.kit;
    if (sel.kind === 'slot') {
      const id = k[sel.id], it = item(sel.id, id);
      // The hat's bands (the hen's feather) are worn on whatever hat is worn: their words follow its own.
      const bands = sel.id === 'hat' ? (k.bands ?? []).map((/** @type {string} */ b) => R.bands?.[b]?.worn).filter(Boolean) : [];
      return { kitSlot: sel.id, kitId: id, worn: true, owned: true, name: it.name, icon: it.icon, text: [it.line, ...bands].join(' '), noPage: true };
    }
    if (sel.kind === 'carrier') {
      const id = carrierId(k), it = item('carrier', id);
      return { kitSlot: 'carrier', kitId: id, worn: true, owned: true, name: it.name, icon: it.icon, text: it.line, noPage: true };
    }
    if (sel.kind === 'belt') {
      const T = R.belt.find((/** @type {any} */ q) => q.id === sel.id);
      return { belt: sel.id, owned: v.belt.find((/** @type {any} */ t) => t.id === sel.id)?.owned, name: T?.name ?? '', icon: T?.icon ?? '', text: T?.line ?? '', noPage: true };
    }
    const i = Number(sel.id), p = pv?.pouches?.[i];
    if (!p) return null;
    const line = o.pack.kinds.lineOf(p.kind);
    // A pouch's own card, as src/world/pack/index.js open() builds it, so Set down, Empty and the rest fit.
    return { sp: 'pouch', pouch: i, kindId: p.kind, name: p.name, icon: 'gather', pouchSketch: p.sketch, pouchStage: p.handfuls,
      text: `${line ? `${line} ` : ''}${PW.stage?.[p.handfuls] ?? ''}`.trim(), noPage: true, stage: -1, r: 0, atCamp: v.atCamp };
  }
  /** A kit choice the pop-out offers, as its card (not worn). @param {any} v @param {string} slot @param {string} id */
  function choiceCard(v, slot, id) {
    const it = item(slot, id), k = v.kit;
    const worn = slot === 'carrier' ? carrierId(k) === id : k[slot] === id;
    return { kitSlot: slot, kitId: id, worn, owned: true, name: it.name, icon: it.icon, text: it.line, noPage: true };
  }
  /** The choice whose words the bottom shows while its pop-out is open, if not the worn one. @type {{ slot: string, id: string } | null} */
  let peek = null;
  /** The card shown now, for its action buttons. @type {any} */
  let shownCard = null;

  function renderAbout(/** @type {any} */ v, /** @type {any} */ pv, /** @type {PageUi} */ u) {
    const c = peek && u.pop === peek.slot ? choiceCard(v, peek.slot, peek.id) : cardFor(v, pv, u.sel);
    shownCard = c;
    // Every part is always there, empty when unused, so the card (and the page) never changes height.
    if (!c) { aboutEl.innerHTML = `<div class="ebb-wp__name"><span class="ebb-wp__nameicon"></span><b></b></div><p class="ebb-wp__words is-hint">${esc(W.pick)}</p><div class="ebb-wp__acts"></div>`; return; }
    // A carrier's Wear works at camp only: elsewhere the card says so instead.
    const away = c.kitSlot === 'carrier' && !c.worn && !v.atCamp;
    const acts = away ? [] : actionsFor(c, o.words);
    // The action row is always one 48 px row: the icons, the camp-only note, or nothing.
    const row = `<div class="ebb-idcard__acts ebb-wp__acts">${away ? `<p class="ebb-wp__note">${esc(W.campOnly)}</p>` : acts.map(({ a, label, main, mark, kind }) => {
      const it = kind ? itemIconFor(kind) : null;
      const face = it ? `${itemIconSvg(it)}${a.chip ? chipSvg(a.chip) : ''}` : `${iconSvg(a.icon)}${mark ? `<span class="ebb-idcard__mark">${mark}</span>` : ''}`;
      return `<button type="button" class="ebb-idcard__act${main ? ' is-main' : ''}${it && a.chip ? ' has-chip' : ''}" data-cact="${esc(a.id)}" aria-label="${esc(label)}" data-label="${esc(label)}">${face}</button>`;
    }).join('')}</div>`;
    const head = c.pouchSketch ? (itemIconFor(c.kindId) ? itemPouchSvg(/** @type {string} */ (itemIconFor(c.kindId)), c.pouchStage ?? 0) : pouchSvg(c.pouchStage ?? 0, c.pouchSketch))
      : c.icon ? glyph(c.icon) : '';
    aboutEl.innerHTML = `<div class="ebb-wp__name"><span class="ebb-wp__nameicon" aria-hidden="true">${head}</span><b>${esc(c.name)}</b>
        ${c.worn && c.kitSlot && c.kitId ? `<span class="ebb-wp__worn">${esc(W.wearing)}</span>` : ''}</div>
      <p class="ebb-wp__words">${esc(c.text)}</p>
      ${row}`;
  }

  function render() {
    const u = ui(), v = get('kitView');
    root.classList.toggle('is-open', u.open);
    root.inert = !u.open;
    openBtn.classList.toggle('is-on', u.open);
    openBtn.setAttribute('aria-expanded', String(u.open));
    // The portrait draws only while the page is open (K3: its cost is the page's alone).
    if (u.open !== portraitOn && portrait) { portraitOn = u.open; if (u.open) portrait.start(); else portrait.stop(); }
    if (!u.open || !v) return;
    const pv = get('packView');
    // A pouch chosen that is gone now (set down, emptied): nothing chosen there any more.
    if (u.sel.kind === 'pouch' && !pv?.pouches?.[Number(u.sel.id)]) { setUi({ sel: { kind: 'slot', id: 'hat' }, pop: null }); return; }
    renderPegs(v);
    renderKit(v, u);
    renderBelt(v, u);
    renderSide(v, pv, u);
    renderAbout(v, pv, u);
    renderPop(v, u);
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (b === openBtn) { dispatch({ type: 'ui.walkerPage', toggle: true }); return; }
    if (!b || /** @type {HTMLButtonElement} */ (b).disabled) {
      // A click on the page outside the pop-out closes it.
      if (ui().pop && !(/** @type {HTMLElement} */ (e.target).closest('[data-pop]'))) { peek = null; setUi({ pop: null }); }
      return;
    }
    const d = b.dataset;
    if (d.close) { setUi({ open: false }); return; }
    if (d.slot) { peek = null; const u = ui(); setUi({ sel: { kind: 'slot', id: d.slot }, pop: u.pop === d.slot ? null : d.slot }); return; }
    if (d.strap) { peek = null; const u = ui(); setUi({ sel: { kind: 'carrier', id: 'carrier' }, pop: u.pop === 'carrier' ? null : 'carrier' }); return; }
    if (d.choice && d.for) {
      // A choice: worn at once (a carrier through the camp's Wear, at camp only); its words below.
      const slot = d.for, id = d.choice;
      peek = { slot, id };
      const v = get('kitView');
      const worn = slot === 'carrier' ? carrierId(v.kit) === id : v.kit[slot] === id;
      if (!worn && (slot !== 'carrier' || v.atCamp)) dispatch({ type: 'kit.wear', slot, id });
      render();
      return;
    }
    if (d.pouch !== undefined) { peek = null; setUi({ sel: { kind: 'pouch', id: d.pouch }, pop: null }); return; }
    if (d.belt) { peek = null; setUi({ sel: { kind: 'belt', id: d.belt }, pop: null }); return; }
    if (d.cact) {
      const a = cardAction(d.cact);
      if (a?.action && shownCard) dispatch(a.action(shownCard));
      // The pouch card's actions close the island card they were made for; here the page stays.
      update('identify', () => null);
      render();
    }
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
    if (a.type === 'ui.walkerPage') {
      const open = a.toggle ? !ui().open : !!a.open;
      // Opening it closes the journal and the sketchbook: one book open at a time.
      if (open && get('journalUi')?.open) dispatch({ type: 'ui.journal', open: false });
      if (open && get('sketchbookUi')?.open) update('sketchbookUi', (s) => ({ ...s, open: false }));
      setUi({ open });
    }
    else if (a.type === 'kit.openBook') { setUi({ open: false }); update('sketchbookUi', (s) => ({ ...(s ?? { page: null }), open: true })); }
  });
  // Another panel opening closes this one (the journal, the sketchbook, a station).
  const closeFor = (/** @type {any} */ x) => { if (x?.open && ui().open) setUi({ open: false }); };
  const onResize = () => { if (ui().open) render(); };
  addEventListener('resize', onResize);
  // The button sits just left of the time button, whose width changes with its pips.
  const timeBtn = document.querySelector('.ebb-time__btn');
  const fit = () => { if (timeBtn) btnRoot.style.setProperty('--wp-time-w', `${/** @type {HTMLElement} */ (timeBtn).offsetWidth}px`); };
  const timeObs = timeBtn && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  if (timeBtn) timeObs?.observe(timeBtn);
  fit();
  document.documentElement.classList.add('ebb-has-walker-btn');

  const unsubs = [subscribe('walkerPageUi', render), subscribe('kitView', render), subscribe('packView', render),
    subscribe('journalUi', closeFor), subscribe('sketchbookUi', closeFor), subscribe('stationView', (x) => { if (x && ui().open) setUi({ open: false }); })];
  render();
  buttonParent.appendChild(btnRoot);
  parent.appendChild(root);
  return () => {
    for (const u of unsubs) u();
    for (const off of offActs) off();
    offAction();
    removeEventListener('resize', onResize);
    timeObs?.disconnect();
    document.documentElement.classList.remove('ebb-has-walker-btn');
    portrait?.stop();
    btnRoot.remove(); root.remove();
  };
}
