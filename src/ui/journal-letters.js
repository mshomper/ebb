// @ts-check
// Bottle letters on paper (docs/future/12): the Shelf section's Letters list and its reader. A
// letter's body uses light markup (recipes/world/bottle-messages.json): **bold**, ~~struck~~,
// *italic*, and lines starting with # as headings; an empty line starts a new paragraph. A haiku
// sits centred; a newspaper clipping gets a masthead. Pure string building.

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Inline markup after escaping. @param {string} s */
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/~~(.+?)~~/g, '<s>$1</s>')
  .replace(/\*(.+?)\*/g, '<i>$1</i>');

/**
 * A letter's paper as HTML. @param {import('../world/keepsakes/letters.js').Letter} L
 * @returns {string}
 */
export function letterHtml(L) {
  // A keeper page (docs/future/13 section 2.4) is in the walker's own hand.
  const kind = /haiku/i.test(L.form) ? 'is-haiku' : /newspaper/i.test(L.form) ? 'is-paper' : /keeper/i.test(L.form) ? 'is-keeper' : '';
  /** @type {string[]} */ const out = [];
  let para = /** @type {string[]} */ ([]);
  const flush = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  for (const line of L.body) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); out.push(`<p class="ebb-letter__h${Math.min(h[1].length, 4)}">${inline(h[2])}</p>`); continue; }
    if (!line.trim()) { flush(); continue; }
    para.push(inline(line));
  }
  flush();
  return `<article class="ebb-letter ${kind}">
    <p class="ebb-letter__form">${esc(L.form)}</p>
    ${L.preface.length ? `<p class="ebb-letter__preface">${L.preface.map(inline).join('<br>')}</p>` : ''}
    <div class="ebb-letter__body">${out.join('')}</div>
  </article>`;
}
