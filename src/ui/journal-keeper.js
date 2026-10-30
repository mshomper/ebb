// @ts-check
// The keeper's own pages (docs/future/13 section 2.4): pages in the walker's hand, kept in the
// journal. The first opens by itself at the spring on the first evening; afterwards a row at the
// top of Notes leads back to it ("The first page"), with any later keeper pages after it. A page
// is had once the journal holds the flag keeper:<id>, and read once it holds keeper:<id>:read.
// Pure string building; recipes/world/keeper-pages.json holds the words.

import { letterHtml } from './journal-letters.js';
import { iconSvg } from './icons/icons.js';

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The keeper's pages with the caches' letters after them (recipes/world/keeper-cache.json, B1 D1):
 * each letter a page cache-<key>, had once the journal holds keeper:cache-<key>. Pure.
 * @param {any} K keeper-pages.json @param {any} C keeper-cache.json
 */
export function withCacheLetters(K, C) {
  if (!K || !C?.letters) return K;
  return { ...K, pages: [...(K.pages ?? []), ...Object.entries(C.letters).map(([key, l]) => ({ id: `cache-${key}`, ...(/** @type {any} */ (l)) }))] };
}

/** The pages had, in the recipe's order. @param {any} K recipes/world/keeper-pages.json @param {string[]} flags */
export const keeperPagesHad = (K, flags) => (K?.pages ?? []).filter((/** @type {any} */ p) => flags.includes(`keeper:${p.id}`));

/** Is any page had and not read? @param {any} K @param {string[]} flags */
export const keeperUnread = (K, flags) => keeperPagesHad(K, flags).some((/** @type {any} */ p) => !flags.includes(`keeper:${p.id}:read`));

/**
 * The row at the top of Notes that leads to the keeper's pages, or '' before the first.
 * @param {any} K @param {string[]} flags @param {string} newDot the journal's "new" mark
 */
export function keeperEntry(K, flags, newDot) {
  const had = keeperPagesHad(K, flags);
  if (!had.length) return '';
  const W = K.words;
  const id = had.length === 1 ? had[0].id : '';
  return `<button type="button" class="ebb-nat-entry" data-view="keeper" data-keeper="${esc(id)}">
    <span class="ebb-nat-entry__icon">${iconSvg('notes')}</span>
    <span class="ebb-jlist__text"><b>${keeperUnread(K, flags) ? newDot : ''}${esc(id ? W.entry : W.title)}</b><span class="ebb-journal__voice">${esc(id ? W.entryLine : W.entryLineMany ?? W.entryLine)}</span></span>
    ${iconSvg('chevron', 'ebb-nat-entry__chev')}</button>`;
}

/**
 * A keeper page on its paper, or the list of them. @param {any} K @param {string[]} flags
 * @param {string | null | undefined} id @param {string} newDot
 */
export function keeperView(K, flags, id, newDot) {
  const W = K.words;
  const had = keeperPagesHad(K, flags);
  const page = had.find((/** @type {any} */ p) => p.id === id) ?? (had.length === 1 ? had[0] : null);
  const back = `<button type="button" class="ebb-shelf__btn" data-view="notes">${iconSvg('back')}<span>${esc(W.back)}</span></button>`;
  if (page) {
    return `<section class="ebb-shelf">${back}
      <h3 class="ebb-shelf__title">${esc(page.title)}</h3>
      ${letterHtml({ ...page, preface: page.preface ?? [] })}</section>`;
  }
  return `<section class="ebb-shelf">${back}<h3 class="ebb-shelf__title">${esc(W.title)}</h3>
    <ul class="ebb-letters">${had.map((/** @type {any} */ p) => `<li><button type="button" class="ebb-letters__row" data-view="keeper" data-keeper="${esc(p.id)}">
      <b>${flags.includes(`keeper:${p.id}:read`) ? '' : newDot}${esc(p.title)}</b><span>${esc(p.form)}</span></button></li>`).join('')}</ul></section>`;
}

/** The page shown for a view, so it can be marked read. @param {any} K @param {string[]} flags @param {string | null | undefined} id */
export function keeperShown(K, flags, id) {
  const had = keeperPagesHad(K, flags);
  return (had.find((/** @type {any} */ p) => p.id === id) ?? (had.length === 1 ? had[0] : null))?.id ?? null;
}
