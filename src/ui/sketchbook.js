// @ts-check
// The walker's sketchbook (docs/future/13 P2i I5): a second drawn book beside the journal's button,
// once the first sketch is made. It opens as a book of its own, two pages a spread, one subject a
// spread in the journal's order (only what has been sketched): on the left its name, when it was
// first drawn and its newest drawing large; on the right the earlier drawings as loose sheets tucked
// in, a margin note from what the journal already knows, and a pressed sprig once the herbarium
// holds one. A stage whose drawing is not made yet stays blank paper, never an empty frame. The
// hand grows surer with every sketch (the lines darken) and the corners wear as the book ages.
// Each journal page of a sketched subject gains a small "In the sketchbook" corner that opens it.
//
// Reads the store slices `sketchbook` (src/world/sketchbook) and `sketchbookUi` { open, page },
// which it keeps; drawings come from assets/sketches (manifest.json). Styles: sketchbook.css.

import { get, update, subscribe } from '../core/store.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { cleanBook, pageDrawings, confidence } from '../world/sketchbook/model.js';
import { dateOfHour } from '../world/journal/observe.js';
import { sprigs } from '../world/forager.js';

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** What the journal's corner reads, once the book is mounted. @type {{ R: any, manifest: Record<string, string[]> } | null} */
let shared = null;
const ART = new URL('../../assets/sketches/', import.meta.url);
const artUrl = (/** @type {string} */ file) => new URL(`${file}.webp`, ART).href;
const artOf = (/** @type {any} */ R, /** @type {string} */ id) => R.art?.[id] ?? id;

/**
 * The journal page's corner for a subject: its newest drawing, small, opening the sketchbook at its
 * page. Empty until it has been sketched. @param {string} id
 */
export function sketchCornerHtml(id) {
  if (!shared) return '';
  const b = cleanBook(get('sketchbook'));
  if (!b.subjects[id]) return '';
  const top = pageDrawings(b, id, artOf(shared.R, id), shared.manifest)[0];
  const W = shared.R.words;
  return `<button type="button" class="ebb-sbcorner" data-sketchbook="${esc(id)}" aria-label="${esc(W.inBook)}">
    ${top ? `<img src="${artUrl(top.file)}" alt="" loading="lazy">` : `<span class="ebb-sbcorner__blank"></span>`}<span>${esc(W.inBook)}</span></button>`;
}

/**
 * Mount the book button and the book.
 * @param {HTMLElement} parent @param {HTMLElement} buttonParent the HUD layer
 * @param {{ recipe: any, words: any, describe: (id: string) => any }} o
 *   recipe: recipes/world/sketchbook.json; words: recipes/world/journal.json (names, dates); describe:
 *   the live journal's page for a subject (its field notes)
 * @returns {() => void} dispose
 */
export function mountSketchbook(parent, buttonParent, o) {
  ensureIconSprite();
  const R = o.recipe, W = R.words;
  shared = { R, manifest: {} };
  fetch(new URL('manifest.json', ART)).then((r) => (r.ok ? r.json() : null)).then((m) => {
    if (shared && m?.art) { shared.manifest = m.art; render(); }
  }).catch(() => {});

  const btnRoot = document.createElement('div');
  btnRoot.className = 'ebb-sbbtn';
  btnRoot.innerHTML = `<button type="button" class="ebb-jbtn__btn" aria-label="${esc(W.open)}" title="${esc(W.book)}" aria-expanded="false">${iconSvg('sketchbook', 'ebb-jbtn__icon')}</button>`;
  const openBtn = /** @type {HTMLButtonElement} */ (btnRoot.querySelector('button'));

  const root = document.createElement('div');
  root.className = 'ebb-sketchbook';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', W.book);
  root.inert = true;

  const ui = () => get('sketchbookUi') ?? { open: false, page: null };
  /** @param {Partial<{ open: boolean, page: string | null }>} p */
  const setUi = (p) => update('sketchbookUi', (u) => ({ ...(u ?? { open: false, page: null }), ...p }));

  /** The sketched subjects, in the journal's order. */
  const pages = () => { const b = cleanBook(get('sketchbook')); return R.subjects.filter((/** @type {string} */ id) => b.subjects[id]); };

  /** The margin note: the first field note the journal has learned about it. @param {string} id */
  function marginNote(id) {
    try {
      const d = o.describe(id);
      const f = (d?.field ?? []).find((/** @type {any} */ n) => n && n.known !== false && typeof n.text === 'string' && n.text);
      return f?.text ?? '';
    } catch { return ''; }
  }

  function render() {
    const b = cleanBook(get('sketchbook'));
    btnRoot.hidden = b.made <= 0;
    // Look moves one slot left while the book button shows (look.css).
    document.documentElement.classList.toggle('ebb-has-sketchbook', !btnRoot.hidden);
    const u = ui();
    root.classList.toggle('is-open', u.open);
    root.inert = !u.open;
    openBtn.classList.toggle('is-on', u.open);
    openBtn.setAttribute('aria-expanded', String(u.open));
    if (!u.open) return;
    const list = pages();
    const id = list.includes(u.page ?? '') ? /** @type {string} */ (u.page) : list[0] ?? null;
    const head = `<div class="ebb-sketchbook__head"><b>${esc(W.book)}</b>
      <button type="button" class="ebb-idcard__close" data-close="1" aria-label="${esc(W.close)}" title="${esc(W.close)}">${iconSvg('close')}</button></div>`;
    if (!id) { root.innerHTML = `${head}<div class="ebb-sketchbook__spread"><div class="ebb-sketchbook__page"><p class="ebb-sketchbook__hand">${esc(W.empty)}</p></div></div>`; return; }
    const i = list.indexOf(id);
    // The page's title: the kind, singular, as its card says it ("Common frog"), without an article.
    const sw = o.words?.species?.[id], name = String(sw?.card ?? sw?.name ?? id).replace(/^(a|an|the) /i, '').replace(/^./, (ch) => ch.toUpperCase());
    const firstHour = Math.min(...b.subjects[id].map((s) => s.hour));
    const draws = pageDrawings(b, id, artOf(R, id), shared?.manifest ?? {});
    const [top, ...earlier] = draws;
    // The hand grows surer (darker lines) with every sketch; the corners wear as the book ages.
    const sure = confidence(b, R);
    // Its age: from its first page to its newest sketch, so every device draws the same page.
    const newest = Math.max(...Object.values(b.subjects).flat().map((s) => s.hour));
    const age = Math.min(1, Math.max(0, ((b.first !== null ? newest - b.first : 0) / 24) / Math.max(1, R.ageDays)));
    const style = `--sb-sure:${(0.78 + 0.32 * sure).toFixed(3)};--sb-age:${age.toFixed(3)}`;
    const tag = R.placeholderArt && top ? `<span class="ebb-sketchbook__tag">${esc(W.placeholder)}</span>` : '';
    const note = marginNote(id);
    const pressed = sprigs(get('unlocks')?.earned ?? {}).some((s) => s.sp === id);
    const icon = o.words?.species?.[id]?.icon;
    root.innerHTML = `${head}
      <div class="ebb-sketchbook__spread" style="${style}">
        <section class="ebb-sketchbook__page is-left">${tag}
          <h3>${esc(name)}</h3>
          <p class="ebb-sketchbook__hand">${esc(W.first.replace('{date}', dateOfHour(firstHour, o.words)))}</p>
          <div class="ebb-sketchbook__draw">${top ? `<img src="${artUrl(top.file)}" alt="${esc(name)}">` : ''}</div>
        </section>
        <section class="ebb-sketchbook__page is-right">
          <div class="ebb-sketchbook__loose">${earlier.map((d, k) => `<img class="is-${k % 2 ? 'b' : 'a'}" src="${artUrl(d.file)}" alt="${esc(name)}">`).join('')}</div>
          ${note ? `<p class="ebb-sketchbook__hand is-margin">${esc(note)}</p>` : ''}
          ${pressed && icon ? `<span class="ebb-sketchbook__pressed" aria-hidden="true">${iconSvg(icon)}</span>` : ''}
        </section>
      </div>
      <div class="ebb-sketchbook__turn">
        <button type="button" class="ebb-idcard__act" data-turn="-1" ${i > 0 ? '' : 'disabled'} aria-label="${esc(W.back)}" data-label="${esc(W.back)}">${iconSvg('back')}</button>
        <button type="button" class="ebb-idcard__act is-on-turn" data-turn="1" ${i < list.length - 1 ? '' : 'disabled'} aria-label="${esc(W.on)}" data-label="${esc(W.on)}">${iconSvg('back')}</button>
      </div>`;
    root.dataset.page = id;
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b || /** @type {HTMLButtonElement} */ (b).disabled) return;
    if (b === openBtn) { setUi({ open: !ui().open }); return; }
    if (b.dataset.close) { setUi({ open: false }); return; }
    if (b.dataset.turn) {
      const list = pages(), at = list.indexOf(root.dataset.page ?? '');
      const next = list[Math.max(0, Math.min(list.length - 1, at + Number(b.dataset.turn)))];
      if (next) setUi({ page: next });
    }
  }
  // The journal page's corner opens the book at its page.
  /** @param {MouseEvent} e */
  const fromJournal = (e) => {
    const c = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('[data-sketchbook]'));
    if (c?.dataset.sketchbook) setUi({ open: true, page: c.dataset.sketchbook });
  };
  /** @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const r of [btnRoot, root]) {
    r.addEventListener('click', onClick);
    r.addEventListener('pointerdown', stop);
    r.addEventListener('pointermove', stop);
    r.addEventListener('wheel', stop, { passive: true });
  }
  document.addEventListener('click', fromJournal);
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape' && ui().open) setUi({ open: false }); };
  addEventListener('keydown', onKey);

  const unsubs = [subscribe('sketchbook', render), subscribe('sketchbookUi', render), subscribe('unlocks', () => { if (ui().open) render(); })];
  render();
  buttonParent.appendChild(btnRoot);
  parent.appendChild(root);
  return () => {
    for (const u of unsubs) u();
    document.removeEventListener('click', fromJournal);
    removeEventListener('keydown', onKey);
    btnRoot.remove(); root.remove(); shared = null;
  };
}
