// @ts-check
// The gentle full-page notice shown instead of the game on a touch-first device (phones, and
// tablets used by touch). ebb is made for a desktop or laptop with a mouse and keyboard
// (October 21, 2026). Words from recipes/world/desktop-only.json, with these as a fallback.

import { loadRecipe } from '../core/recipes.js';

const FALLBACK = {
  tagline: 'a tended island',
  line: 'ebb is made for a desktop or laptop with a mouse and keyboard. Come and visit from one of those.',
  linkText: 'More about ebb',
  link: 'https://notarobot-eng.com/ebb',
};

/**
 * True when the primary pointer is coarse: a phone, or a tablet used by touch. A tablet with a
 * trackpad or mouse reports a fine pointer and plays.
 * @returns {boolean}
 */
export function isTouchFirst() {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Replace the canvas with the notice. Nothing of the game is started.
 * @returns {Promise<void>}
 */
export async function showDesktopOnly() {
  document.getElementById('view')?.remove();
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('./desktop-only.css', import.meta.url).href;
  document.head.appendChild(css);

  /** @type {typeof FALLBACK} */
  let words = FALLBACK;
  try { words = { ...FALLBACK, ...(await loadRecipe('world/desktop-only')) }; } catch { /* the fallback words stand */ }

  const wrap = document.createElement('main');
  wrap.className = 'ebb-desk';
  const card = document.createElement('div');
  card.className = 'ebb-desk__card';

  const img = document.createElement('img');
  img.src = 'brand/ebb-icon.svg';
  img.alt = '';
  const h1 = document.createElement('h1');
  h1.textContent = 'ebb';
  const tagline = document.createElement('p');
  tagline.className = 'ebb-desk__tagline';
  tagline.textContent = words.tagline;
  const line = document.createElement('p');
  line.className = 'ebb-desk__line';
  line.textContent = words.line;
  const link = document.createElement('a');
  link.className = 'ebb-desk__link';
  link.href = words.link;
  link.textContent = words.linkText;

  card.append(img, h1, tagline, line, link);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
}
