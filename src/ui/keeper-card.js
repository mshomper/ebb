// @ts-check
// A keeper page as a centered card on the island (Phase 1 fix F15): on waking from the first rest,
// the keeper's second page (src/world/intro/adapter.js emits `keeper:card { id }`), in the journal's
// italic on paper. One click anywhere on it closes it, and it is then read in the journal, where it
// is kept after the first page (src/ui/journal-keeper.js). Words: recipes/world/keeper-pages.json.

import { on } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { dispatch } from '../input/actions.js';
import { withCacheLetters } from './journal-keeper.js';

const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The card's inner markup: its form, title and paragraphs (an empty line starts a new one). Pure.
 * @param {{ form?: string, title: string, body: string[] }} p @returns {string}
 */
export function keeperCardHtml(p) {
  const paras = p.body.join('\n').split(/\n\s*\n/).map((t) => t.replace(/\n/g, ' ').trim()).filter(Boolean);
  return `${p.form ? `<span class="ebb-kcard__form">${esc(p.form)}</span>` : ''}<h2 class="ebb-kcard__title">${esc(p.title)}</h2>` +
    paras.map((t) => `<p>${esc(t)}</p>`).join('');
}

/** @param {HTMLElement} parent @returns {() => void} dispose */
export function mountKeeperCard(parent) {
  ensureStyle();
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ebb-kcard';
  card.title = 'Close';
  parent.appendChild(card);
  /** @type {string | null} */ let shownId = null;
  function close() {
    if (!shownId) return;
    dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `keeper:${shownId}:read` }));
    shownId = null;
    card.classList.remove('is-shown');
  }
  card.addEventListener('click', close);
  const off = on('keeper:card', async (/** @type {{ id: string }} */ e) => {
    const K = withCacheLetters(await loadRecipe('world/keeper-pages'), await loadRecipe('world/keeper-cache'));
    const p = (K?.pages ?? []).find((/** @type {any} */ x) => x.id === e.id);
    if (!p) return;
    shownId = p.id;
    card.innerHTML = keeperCardHtml(p);
    card.setAttribute('aria-label', `${p.title}. Click to close.`);
    requestAnimationFrame(() => card.classList.add('is-shown'));
  });
  return () => { off(); card.remove(); };
}

function ensureStyle() {
  if (document.getElementById('ebb-kcard-style')) return;
  const s = document.createElement('style');
  s.id = 'ebb-kcard-style';
  s.textContent = `
    .ebb-kcard { position: fixed; left: 50%; top: 50%; z-index: 30; transform: translate(-50%, -46%);
      width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
      padding: 28px 30px 24px; border: 0; border-radius: 18px; text-align: left; cursor: pointer;
      background: var(--jr-paper, #F4EEE4); color: var(--ui-night, #1E2624); box-shadow: 0 18px 60px rgba(10, 14, 13, 0.35);
      font-family: 'Fraunces', Georgia, serif; font-style: italic; font-size: 20px; line-height: 1.5;
      opacity: 0; visibility: hidden; transition: opacity 700ms ease, transform 700ms ease, visibility 0s linear 700ms; }
    .ebb-kcard.is-shown { opacity: 1; visibility: visible; transform: translate(-50%, -50%); transition: opacity 700ms ease, transform 700ms ease, visibility 0s; }
    .ebb-kcard__form { display: block; font-family: 'Nunito', system-ui, sans-serif; font-style: normal; font-weight: 600; font-size: 15px; color: #7B8B84; }
    .ebb-kcard__title { margin: 4px 0 12px; font-weight: 400; font-size: 26px; line-height: 1.25; }
    .ebb-kcard p { margin: 0 0 10px; }
    @media (prefers-reduced-motion: reduce) { :root:not(.ebb-motion-full) .ebb-kcard { transition: none; transform: translate(-50%, -50%); } }
    :root.ebb-motion-calm .ebb-kcard { transition: none; transform: translate(-50%, -50%); }
  `;
  document.head.appendChild(s);
}
