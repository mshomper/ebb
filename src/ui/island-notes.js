// @ts-check
// Notes on the island (docs/15 HUD): the journal's new notes appear at the bottom left in Fraunces
// italic, at most two at once, and fade after a few seconds; a click opens the journal at that
// species. Notes that never get their turn (a burst past the queue, or written while the tab was
// out of sight) wait in the journal under "You may have missed", and a quiet line here says so. The same file shows the card a tap opens on a living thing: its name, what it is doing
// and a way into its journal page. After a page's Show me (`identify.pinned`), the card rides with
// the ring as the camera moves, and while the ring is out of view a drawn arrow at the screen edge
// points to it. A note that an animal came, stayed or joined (`showMeKinds`) offers Show me too,
// so a player who cannot find what arrived is helped to look; the camera never moves.
//
// Listens for `note:posted`; reads the store slices `identify`, `tools` and `view`; every choice goes out
// as a `ui.journal` or `ui.identify` action. Timings come from recipes/world/journal.json.
// Styles: journal.css.

import { on } from '../core/events.js';
import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { cleanName } from '../world/creatures/trust.js';

/** Notes on screen at once. */
const AT_ONCE = 2;

/**
 * @param {HTMLElement} parent
 * @param {any} words recipes/world/journal.json
 * @param {any} [naturalist] recipes/world/naturalist.json (how long a gift's card stays)
 * @returns {() => void} dispose
 */
export function mountIslandNotes(parent, words, naturalist = null) {
  ensureIconSprite();
  const N = words.islandNote;
  const cardS = naturalist?.card?.showS;

  const root = document.createElement('div');
  root.className = 'ebb-notes';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const card = document.createElement('div');
  card.className = 'ebb-idcard';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'What grows here');

  /** @type {import('../world/journal/observe.js').Note[]} */ let waiting = [];
  let lastShown = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let pumpTimer;

  function pump() {
    clearTimeout(pumpTimer);
    if (!waiting.length) return;
    const now = performance.now();
    const showing = root.querySelectorAll('.ebb-notes__note:not(.is-leaving)').length;
    const wait = Math.max(0, lastShown + N.gapS * 1000 - now);
    if (showing >= AT_ONCE || wait > 0) { pumpTimer = setTimeout(pump, showing >= AT_ONCE ? 400 : wait); return; }
    const n = /** @type {any} */ (waiting.shift());
    lastShown = now;
    // Shown: it is no longer one you may have missed (src/world/journal/read.js).
    if (n.n) dispatch(/** @type {any} */ ({ type: 'journal.noteShown', n: n.n }));
    const b = noteEl(n);
    root.insertBefore(b, moreBtn.isConnected ? moreBtn : null);
    requestAnimationFrame(() => b.classList.add('is-shown'));
    setTimeout(() => {
      b.classList.add('is-leaving');
      b.classList.remove('is-shown');
      setTimeout(() => b.remove(), 700);
      pump();
    }, (canShow(n) ? N.showMeS ?? N.showS : N.showS) * 1000);
    if (waiting.length) pumpTimer = setTimeout(pump, N.gapS * 1000);
  }

  // More notes than the queue holds, or notes written while the tab is out of sight, are never
  // shown on the island: the journal keeps them under "You may have missed", and a quiet line here
  // says how many wait there.
  let more = 0;
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'ebb-notes__more';
  moreBtn.addEventListener('click', () => { more = 0; renderMore(); dispatch({ type: 'ui.journal', open: true, view: 'notes', page: null }); });
  function renderMore() {
    moreBtn.textContent = more ? (more === 1 ? N.moreOne : N.more.replace('{n}', String(more))) : '';
    moreBtn.classList.toggle('is-shown', more > 0);
    if (more && !moreBtn.isConnected) root.appendChild(moreBtn);
    if (more) root.appendChild(moreBtn);   // keep it last, under the notes
  }
  /** Is this note still unread in the journal (not, say, part of the island you started with)? @param {any} n */
  const unreadNote = (n) => !!n.n && n.n > (get('journal')?.read?.notes ?? 0);
  const offNote = on('note:posted', (/** @type {import('../world/journal/observe.js').Note} */ n) => {
    if (document.hidden) { if (unreadNote(n)) { more++; renderMore(); } return; }
    // A gift (src/world/expansion.js) is its own quiet card, not a passing note.
    if (/** @type {any} */ (n).kind === 'gift') { showGift(n); return; }
    waiting.push(n);
    if (waiting.length > N.queue) {
      const dropped = waiting.slice(0, waiting.length - N.queue);
      waiting = waiting.slice(waiting.length - N.queue);
      more += dropped.filter(unreadNote).length;
      renderMore();
    }
    pump();
  });
  // Notes written while the island caught up on time away (src/sim/away.js) are never shown here:
  // the line says how many wait in the journal.
  const offAway = on('world:caught-up', (/** @type {{ notes: any[], reveal?: boolean }} */ p) => {
    if (p.reveal) return;   // the reveal shows the best of them, then says how many are left (below)
    const n = (p.notes ?? []).filter(unreadNote).length;
    if (n) { more += n; renderMore(); }
  });
  // The reveal on return (src/ui/reveal.js) shows its notes here one at a time, now; when it ends,
  // the line says how many more wait in the journal.
  const offRevealNote = on('reveal:note', (/** @type {{ note: any, showS: number }} */ p) => showNow(p.note, p.showS));
  // A calm word from the island itself, not a journal note (a save that came back from earlier).
  const offNotice = on('island:notice', (/** @type {{ text: string, showS: number }} */ p) => showNow({ text: p.text, notice: true }, p.showS));
  const offRevealEnd = on('reveal:ended', (/** @type {{ missed: number }} */ p) => { if (p.missed > 0) { more += p.missed; renderMore(); } });
  /**
   * A gift's card (the naturalist's notes, a species' gift): its drawn icon, its title and line,
   * low in the middle; it fades by itself after a while, or closes on a tap, which opens its page.
   * One at a time: a second waits for the first to go. @param {any} n
   */
  const gifts = /** @type {any[]} */ ([]);
  function showGift(n) {
    gifts.push(n);
    if (gifts.length === 1) nextGift();
  }
  function nextGift() {
    const n = gifts[0];
    if (!n) return;
    if (n.n) dispatch(/** @type {any} */ ({ type: 'journal.noteShown', n: n.n }));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ebb-gift';
    b.title = 'Open the journal';
    b.innerHTML = `<span class="ebb-gift__icon">${iconSvg(n.icon ?? 'find')}</span><span class="ebb-gift__text"><b></b><span class="ebb-journal__voice"></span></span>`;
    /** @type {HTMLElement} */ (b.querySelector('b')).textContent = n.title ?? '';
    /** @type {HTMLElement} */ (b.querySelector('.ebb-journal__voice')).textContent = n.line ?? n.text;
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      b.classList.remove('is-shown');
      setTimeout(() => { b.remove(); gifts.shift(); nextGift(); }, 900);
    };
    b.addEventListener('click', () => { leave(); dispatch(n.sp ? { type: 'ui.journal', open: true, page: n.sp } : { type: 'ui.journal', open: true, view: 'notes' }); });
    parent.appendChild(b);
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('is-shown')));
    setTimeout(leave, (cardS ?? 10) * 1000);
  }

  /** A reveal note: shown at once for showS seconds, marked as shown. @param {any} n @param {number} showS */
  function showNow(n, showS) {
    if (n.n) dispatch(/** @type {any} */ ({ type: 'journal.noteShown', n: n.n }));
    const b = noteEl(n);
    root.insertBefore(b, moreBtn.isConnected ? moreBtn : null);
    requestAnimationFrame(() => b.classList.add('is-shown'));
    setTimeout(() => {
      b.classList.add('is-leaving');
      b.classList.remove('is-shown');
      setTimeout(() => b.remove(), 700);
    }, Math.max(showS, canShow(n) ? N.showMeS ?? 0 : 0) * 1000);
  }

  /**
   * Does this note say an animal came, stayed or joined? Then it offers Show me, which rings the
   * nearest one without moving the camera (src/world/journal/index.js showMe), so a player who
   * cannot find what arrived is helped to look.
   * @param {any} n
   */
  const canShow = (n) => !n.notice && !!n.sp && (N.showMeKinds ?? []).includes(n.kind);
  /** A note on the island: a button that opens the journal, with Show me beside it when it offers one. @param {any} n */
  function noteEl(n) {
    const open = () => dispatch(n.sp ? { type: 'ui.journal', open: true, page: n.sp } : { type: 'ui.journal', open: true, view: 'notes' });
    const text = document.createElement('button');
    text.type = 'button';
    text.textContent = n.text;
    if (n.notice) text.tabIndex = -1;
    else { text.title = 'Open the journal'; text.addEventListener('click', open); }
    if (!canShow(n)) { text.className = 'ebb-notes__note'; return text; }
    const row = document.createElement('div');
    row.className = 'ebb-notes__note has-show';
    text.className = 'ebb-notes__text';
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'ebb-notes__show';
    show.innerHTML = `${iconSvg('find')}<span>${esc(words.showMe?.button ?? 'Show me')}</span>`;
    show.addEventListener('click', () => dispatch({ type: 'journal.showMe', sp: n.sp }));
    row.append(text, show);
    return row;
  }
  // Opening Notes reads them all: the line goes.
  const offUi = subscribe('journalUi', (/** @type {any} */ u) => { if (u?.open && u.view === 'notes' && more) { more = 0; renderMore(); } });

  // --- the tap card ---
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let cardTimer;
  function renderCard() {
    const id = get('identify');
    clearTimeout(cardTimer);
    if (!id) { card.classList.remove('is-open'); card.inert = true; follow(); return; }
    // A stone's or a log's card, with the turtles' gift: Carry; while carried, a calm hint and Put it
    // back (a tap anywhere on the card puts it back too).
    const C = words.pieces?.carry;
    const text = id.carrying ? C?.[id.carryNote ?? 'hint'] ?? '' : id.carryNote ? C?.[id.carryNote] ?? id.text : id.text;
    const carryBtn = !C || !id.canCarry ? ''
      : id.carrying ? `<button type="button" class="ebb-idcard__open" data-act="uncarry">${iconSvg('close')}<span>${esc(C.cancel)}</span></button>`
      : `<button type="button" class="ebb-idcard__open" data-act="carry">${iconSvg('carry')}<span>${esc(C.button)}</span></button>`;
    card.innerHTML = `
      <div class="ebb-idcard__head"><span class="ebb-idcard__icon">${iconSvg(id.icon)}</span><b>${esc(id.name)}</b>
        ${id.word ? `<span class="ebb-idcard__word">${esc(id.word)}</span>` : ''}
        <button type="button" class="ebb-idcard__close" data-act="close" aria-label="Close" title="Close">${iconSvg('close')}</button></div>
      ${id.sub ? `<p class="ebb-idcard__sub">${esc(id.sub)}</p>` : ''}
      <p class="ebb-idcard__text">${esc(text)}</p>
      ${id.suits ? `<p class="ebb-idcard__suits">${esc(id.suits)}</p>` : ''}
      ${id.suitsPencil ? `<p class="ebb-idcard__suits is-pencil">${esc(id.suitsPencil)}</p>` : ''}
      ${id.canName ? `<button type="button" class="ebb-idcard__open" data-act="name">${iconSvg('name-tag')}<span>Give it a name</span></button>
      <form class="ebb-idcard__name" hidden>
        <label class="ebb-idcard__label" for="ebb-idcard-name">A name for this frog</label>
        <div class="ebb-idcard__row">
          <input class="ebb-idcard__input" id="ebb-idcard-name" maxlength="24" autocomplete="off" spellcheck="false">
          <button type="button" class="ebb-idcard__chip" data-act="suggest">Suggest one</button>
        </div>
        <p class="ebb-idcard__error" role="alert"></p>
        <button type="submit" class="ebb-idcard__give">${iconSvg('name-tag')}<span>Give it this name</span></button>
      </form>` : ''}
      ${carryBtn}
      ${id.noPage ? '' : `<button type="button" class="ebb-idcard__open" data-act="open">${iconSvg('journal')}<span>Open its page</span></button>`}`;
    card.inert = false;
    card.classList.add('is-open');
    place(id.x, id.y);
    // While a piece is carried the card stays, holding the hint, until it is set down or put back.
    if (!id.carrying) cardTimer = setTimeout(() => dispatch({ type: 'ui.identify' }), (id.pinned ? words.showMe.showS : words.identify.showS) * 1000);
    if (id.pinned) follow();
  }
  /** Put the card beside a screen point, kept on screen. @param {number} px @param {number} py */
  function place(px, py) {
    const w = card.offsetWidth, h = card.offsetHeight;
    const x = Math.min(window.innerWidth - w - 12, Math.max(12, px + 24));
    const y = Math.min(window.innerHeight - h - 12, Math.max(12, py - h - 24));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // --- Show me: the card rides with the ring; out of view, an arrow at the edge points to it ---
  const arrow = document.createElement('div');
  arrow.className = 'ebb-pointer';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = iconSvg('back');
  // The ground ring is small from far away, so a screen-sized ring marks the spot as well.
  const mark = document.createElement('div');
  mark.className = 'ebb-mark';
  mark.setAttribute('aria-hidden', 'true');
  let following = 0;
  /** The part of the screen the island shows in: the window, less an open journal. */
  function clearRect() {
    const r = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
    const panel = document.querySelector('.ebb-journal.is-open');
    if (panel) {
      const p = panel.getBoundingClientRect();
      if (p.width >= r.r - 2) r.b = Math.min(r.b, p.top); else r.r = Math.min(r.r, p.left);
    }
    return r;
  }
  function follow() {
    cancelAnimationFrame(following);
    const id = get('identify'), view = get('view');
    if (!id?.pinned || !view) { arrow.classList.remove('is-on'); mark.classList.remove('is-on'); card.classList.remove('is-away'); return; }
    const p = view.project(id.wx, id.wz), r = clearRect(), M = 28;
    const inside = !p.behind && p.x > r.l + M && p.x < r.r - M && p.y > r.t + M && p.y < r.b - M;
    card.classList.toggle('is-away', !inside);
    arrow.classList.toggle('is-on', !inside);
    mark.classList.toggle('is-on', inside);
    if (inside) {
      place(p.x, p.y);
      mark.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
    else {
      // From the middle of the clear part toward the ring, stopped at its edge.
      const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2, dx = p.x - cx, dy = p.y - cy;
      const k = Math.min((r.r - r.l) / 2 - M, (r.b - r.t) / 2 - M) > 0
        ? Math.min(((r.r - r.l) / 2 - M) / Math.max(Math.abs(dx), 1e-3), ((r.b - r.t) / 2 - M) / Math.max(Math.abs(dy), 1e-3)) : 0;
      const deg = Math.atan2(dy, dx) * 180 / Math.PI + 180;   // the drawn chevron points left
      arrow.style.transform = `translate(${Math.round(cx + dx * k - 22)}px, ${Math.round(cy + dy * k - 22)}px) rotate(${deg.toFixed(1)}deg)`;
    }
    following = requestAnimationFrame(follow);
  }
  // Naming a frog (S6c-3): the field opens on the card itself, which then stays until you close it;
  // Suggest one steps through names no other frog has; an empty name says so instead of going on.
  let suggestAt = 0;
  card.addEventListener('click', (e) => {
    const id = get('identify');
    // Carrying: a tap anywhere on the card puts the piece back.
    if (id?.carrying) { dispatch({ type: 'pieces.carryCancel' }); return; }
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    if (b.dataset.act === 'carry' && id?.piece) { dispatch({ type: 'pieces.carry', id: id.piece }); return; }
    const form = /** @type {HTMLFormElement | null} */ (card.querySelector('.ebb-idcard__name'));
    const input = /** @type {HTMLInputElement | null} */ (card.querySelector('.ebb-idcard__input'));
    if (b.dataset.act === 'open' && id) dispatch({ type: 'ui.journal', open: true, page: id.sp });
    else if (b.dataset.act === 'close') dispatch({ type: 'ui.identify' });
    else if (b.dataset.act === 'name' && form && input) {
      clearTimeout(cardTimer);
      b.hidden = true;
      form.hidden = false;
      suggestAt = 0;
      input.focus();
      if (id?.pinned) follow(); else place(id?.x ?? 0, id?.y ?? 0);
    } else if (b.dataset.act === 'suggest' && input && id?.suggest?.length) {
      input.value = id.suggest[suggestAt++ % id.suggest.length];
      nameError('');
    }
  });
  /** @param {string} text */
  const nameError = (text) => { const p = card.querySelector('.ebb-idcard__error'); if (p) p.textContent = text; };
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = get('identify');
    const input = /** @type {HTMLInputElement | null} */ (card.querySelector('.ebb-idcard__input'));
    const name = (input?.value ?? '').trim();
    if (!name) { nameError('Type a name first, or tap Suggest one.'); input?.focus(); return; }
    if (!cleanName(name)) { nameError('A name needs letters.'); input?.focus(); return; }
    if (id?.id != null) dispatch({ type: 'creature.name', id: id.id, name });
  });
  card.addEventListener('input', () => nameError(''));
  /** @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const r of [root, card]) {
    r.addEventListener('pointerdown', stop);
    r.addEventListener('pointermove', stop);
    r.addEventListener('wheel', stop, { passive: true });
  }

  /** Notes step aside while a tool's card is open on narrower screens (journal.css). */
  function renderTool() { root.classList.toggle('has-tool', !!get('tools')?.tool); }

  renderCard();
  renderTool();
  const unsubs = [subscribe('identify', renderCard), subscribe('tools', renderTool)];
  parent.appendChild(root);
  parent.appendChild(card);
  parent.appendChild(arrow);
  parent.appendChild(mark);

  return function dispose() {
    offNote();
    offAway();
    offRevealNote();
    offRevealEnd();
    offNotice();
    offUi();
    for (const u of unsubs) u();
    clearTimeout(pumpTimer);
    clearTimeout(cardTimer);
    cancelAnimationFrame(following);
    root.remove();
    card.remove();
    arrow.remove();
    mark.remove();
  };
}

/** @param {string} s */
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
