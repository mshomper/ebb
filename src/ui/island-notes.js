// @ts-check
// Notes on the island (docs/15 HUD): the journal's new notes appear at the bottom left in Fraunces
// italic, at most two at once, and fade after a few seconds; a click opens the journal at that
// species. Notes that never get their turn (a burst past the queue, or written while the tab was
// out of sight) wait in the journal under "You may have missed", and a quiet line here says so. The same file shows the card a tap opens on a living thing: its name, what it is doing
// and a way into its journal page. After a page's Show me (`identify.pinned`), the card rides with
// the ring as the camera moves, and while the ring is out of view a drawn arrow at the screen edge
// points to it.
//
// Listens for `note:posted`; reads the store slices `identify`, `tools` and `view`; every choice goes out
// as a `ui.journal` or `ui.identify` action. Timings come from recipes/world/journal.json.
// Styles: journal.css.

import { on } from '../core/events.js';
import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** Notes on screen at once. */
const AT_ONCE = 2;

/**
 * @param {HTMLElement} parent
 * @param {any} words recipes/world/journal.json
 * @returns {() => void} dispose
 */
export function mountIslandNotes(parent, words) {
  ensureIconSprite();
  const N = words.islandNote;

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
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ebb-notes__note';
    b.textContent = n.text;
    b.title = 'Open the journal';
    b.addEventListener('click', () => dispatch(n.sp ? { type: 'ui.journal', open: true, page: n.sp } : { type: 'ui.journal', open: true, view: 'notes' }));
    root.insertBefore(b, moreBtn.isConnected ? moreBtn : null);
    requestAnimationFrame(() => b.classList.add('is-shown'));
    setTimeout(() => {
      b.classList.add('is-leaving');
      b.classList.remove('is-shown');
      setTimeout(() => b.remove(), 700);
      pump();
    }, N.showS * 1000);
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
  const offRevealEnd = on('reveal:ended', (/** @type {{ missed: number }} */ p) => { if (p.missed > 0) { more += p.missed; renderMore(); } });
  /** A reveal note: shown at once for showS seconds, marked as shown. @param {any} n @param {number} showS */
  function showNow(n, showS) {
    if (n.n) dispatch(/** @type {any} */ ({ type: 'journal.noteShown', n: n.n }));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ebb-notes__note';
    b.textContent = n.text;
    b.title = 'Open the journal';
    b.addEventListener('click', () => dispatch(n.sp ? { type: 'ui.journal', open: true, page: n.sp } : { type: 'ui.journal', open: true, view: 'notes' }));
    root.insertBefore(b, moreBtn.isConnected ? moreBtn : null);
    requestAnimationFrame(() => b.classList.add('is-shown'));
    setTimeout(() => {
      b.classList.add('is-leaving');
      b.classList.remove('is-shown');
      setTimeout(() => b.remove(), 700);
    }, showS * 1000);
  }
  // Opening Notes reads them all: the line goes.
  const offUi = subscribe('journalUi', (/** @type {any} */ u) => { if (u?.open && u.view === 'notes' && more) { more = 0; renderMore(); } });

  // --- the tap card ---
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let cardTimer;
  function renderCard() {
    const id = get('identify');
    clearTimeout(cardTimer);
    if (!id) { card.classList.remove('is-open'); card.inert = true; follow(); return; }
    card.innerHTML = `
      <div class="ebb-idcard__head"><span class="ebb-idcard__icon">${iconSvg(id.icon)}</span><b>${esc(id.name)}</b>
        <button type="button" class="ebb-idcard__close" data-act="close" aria-label="Close" title="Close">${iconSvg('close')}</button></div>
      <p class="ebb-idcard__text">${esc(id.text)}</p>
      ${id.suits ? `<p class="ebb-idcard__suits">${esc(id.suits)}</p>` : ''}
      ${id.suitsPencil ? `<p class="ebb-idcard__suits is-pencil">${esc(id.suitsPencil)}</p>` : ''}
      <button type="button" class="ebb-idcard__open" data-act="open">${iconSvg('journal')}<span>Open its page</span></button>`;
    card.inert = false;
    card.classList.add('is-open');
    place(id.x, id.y);
    cardTimer = setTimeout(() => dispatch({ type: 'ui.identify' }), (id.pinned ? words.showMe.showS : words.identify.showS) * 1000);
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
  card.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    const id = get('identify');
    if (b.dataset.act === 'open' && id) dispatch({ type: 'ui.journal', open: true, page: id.sp });
    else if (b.dataset.act === 'close') dispatch({ type: 'ui.identify' });
  });
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
