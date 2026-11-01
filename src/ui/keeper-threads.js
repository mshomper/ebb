// @ts-check
// The Keeper book's Threads tab (Matt, October 30, 2026; threads-plan): Long threads, the island's big
// stories in the keeper's hand (open ones first, finished ones under their own heading), and Things to
// try, every morning hint once shown, newest first, with its Show me and the done ones pencilled out.
// Hints not yet given never show. A thread's own page is its lines with their dates, in Fraunces
// italic, and one soft pencil line while it is open. Pure string building; words from
// recipes/world/threads.json, the hints from recipes/world/morning-hints.json, the rules from
// src/world/threads/model.js and src/world/hints/morning.js.

import { iconSvg } from './icons/icons.js';
import { dateOfHour } from '../world/journal/observe.js';
import { threadsOf } from '../world/threads/model.js';
import { shownOf, hintDone, showMeOf } from '../world/hints/morning.js';

/** @param {any} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * @typedef {{ T: any, H: any, s: import('../world/hints/morning.js').HintState, st: import('../world/threads/model.js').ThreadsState,
 *   words: any, newDot: string, canShow?: (sp: string) => boolean }} ThreadsInput
 *   T: threads.json; H: morning-hints.json; s: the journal and cook for the tests; st: the save's threads
 *   section; words: recipes/world/journal.json (dates); newDot: the "new" mark; canShow: can Show me ring it
 */

/**
 * Things to try: the hints shown so far, newest first. @param {ThreadsInput} o
 * @returns {{ id: string, text: string, day: number, done: boolean, sp: string | null }[]}
 */
export function triesOf(o) {
  const shown = shownOf(o.H, o.s.journal?.flags ?? []);
  return (o.H?.hints ?? []).filter((/** @type {any} */ h) => shown.has(h.id)).map((/** @type {any} */ h) => {
    const done = hintDone(o.H, h, o.s);
    const sp = done ? null : showMeOf(h, o.s);
    return { id: h.id, text: String(h.text ?? ''), day: /** @type {number} */ (shown.get(h.id)), done, sp: sp && (!o.canShow || o.canShow(sp)) ? sp : null };
  }).sort((a, b) => b.day - a.day);
}

/** The Threads tab's own page. @param {ThreadsInput} o */
export function threadsHtml(o) {
  const W = o.T.words;
  const all = threadsOf(o.T, o.s, o.st);
  const open = all.filter((t) => !t.done).sort((a, b) => b.last - a.last);
  const done = all.filter((t) => t.done).sort((a, b) => b.last - a.last);
  const row = (/** @type {typeof all[number]} */ t) => `<li><button type="button" class="ebb-thr__row${t.done ? ' is-done' : ''}" data-thread="${esc(t.id)}">
      <span class="ebb-thr__icon">${iconSvg(t.icon)}</span>
      <span class="ebb-thr__text"><b>${t.fresh ? o.newDot : ''}${esc(t.title)}</b><span class="ebb-journal__voice">${esc(t.lines[t.lines.length - 1].text)}</span></span>
      ${iconSvg('chevron', 'ebb-thr__chev')}</button></li>`;
  const long = all.length
    ? `${open.length ? `<ul class="ebb-thr__list">${open.map(row).join('')}</ul>` : ''}
       ${done.length ? `<h4 class="ebb-thr__sub">${esc(W.finished)}</h4><ul class="ebb-thr__list">${done.map(row).join('')}</ul>` : ''}`
    : `<p class="ebb-journal__voice ebb-thr__none">${esc(W.longNone)}</p>`;
  const tries = triesOf(o);
  const tryRows = tries.map((h) => `<li class="ebb-thr__try${h.done ? ' is-done' : ''}">
      <span class="ebb-thr__icon">${iconSvg('find')}</span>
      <span class="ebb-thr__text"><span class="ebb-journal__voice">${esc(h.text)}</span>${h.done ? `<span class="ebb-thr__done">${esc(W.done)}</span>` : ''}</span>
      ${h.sp ? `<button type="button" class="ebb-jpage__show ebb-thr__show" data-show="${esc(h.sp)}">${iconSvg('find')}<span>${esc(W.showMe)}</span></button>` : ''}</li>`).join('');
  return `<section class="ebb-thr">
    <h3 class="ebb-thr__head">${esc(W.long)}</h3>${long}
    <h3 class="ebb-thr__head">${esc(W.try)}</h3>
    ${tries.length ? `<ul class="ebb-thr__tries">${tryRows}</ul>` : `<p class="ebb-journal__voice ebb-thr__none">${esc(W.tryNone)}</p>`}</section>`;
}

/** One thread's page, or '' when it has not begun. @param {ThreadsInput} o @param {string} id */
export function threadHtml(o, id) {
  const W = o.T.words;
  const t = threadsOf(o.T, o.s, o.st).find((x) => x.id === id);
  if (!t) return '';
  const back = `<button type="button" class="ebb-shelf__btn" data-thread-back="1">${iconSvg('back')}<span>${esc(W.back)}</span></button>`;
  const lines = t.lines.map((l) => `<li><p class="ebb-journal__voice">${l.fresh ? o.newDot : ''}${esc(l.text)}</p><small class="ebb-thr__date">${esc(dateOfHour(l.h, o.words))}</small></li>`).join('');
  return `<article class="ebb-thr ebb-thr__page">${back}
    <h3 class="ebb-thr__title">${esc(t.title)}</h3>
    <p class="ebb-thr__begun">${esc(String(W.begun ?? '{date}').replace('{date}', dateOfHour(t.begun, o.words)))}</p>
    <ol class="ebb-thr__lines">${lines}</ol>
    ${!t.done && t.pencil ? `<p class="ebb-journal__voice ebb-thr__pencil">${esc(t.pencil)}</p>` : ''}
    ${t.pages ? `<button type="button" class="ebb-shelf__btn ebb-thr__pages" data-view="keeper" data-keeper="">${iconSvg('notes')}<span>${esc(W.pages)}</span></button>` : ''}
  </article>`;
}
