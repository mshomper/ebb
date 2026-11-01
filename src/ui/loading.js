// @ts-check
// The loading screen (index.html, loading.css): the wordmark on the dusk colour while the island is
// made. src/app.js emits `boot:step` as each start-up step begins; the line under the wordmark follows
// the share of steps done (recipes/world/loading.json). It fades out once the island shows, and goes
// at once when the start ends another way (no WebGPU, the save open elsewhere, a damaged save).

import { on } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';

/** @type {[number, string][]} */
let lines = [[0, 'Raising the island']];
let fadeS = 0.9;
loadRecipe('world/loading').then((r) => { lines = r.lines ?? lines; fadeS = r.fadeS ?? fadeS; }).catch(() => { /* the first line stands */ });

const el = () => document.getElementById('ebb-loading');
let shown = '';

/** @param {string} text */
function setLine(text) {
  const p = el()?.querySelector('.ebb-loading__line');
  if (!p || text === shown) return;
  shown = text;
  p.textContent = text;
}

const off = on('boot:step', (/** @type {{ i: number, n: number }} */ e) => {
  const done = e.n > 0 ? e.i / e.n : 0;
  let text = lines[0][1];
  for (const [at, t] of lines) if (done >= at) text = t;
  setLine(text);
});

/** The island shows: fade the screen out, then take it away. */
export function hideLoading() {
  off?.();
  const e = el();
  if (!e) return;
  let begun = false;
  const fade = () => {
    if (begun) return;
    begun = true;
    e.classList.add('ebb-loading--gone');
    setTimeout(() => e.remove(), fadeS * 1000 + 100);
  };
  // Two frames, so the island's first frame is on screen before the fade begins; a timer in case
  // frames are held back (a page in the background).
  requestAnimationFrame(() => requestAnimationFrame(fade));
  setTimeout(fade, 500);
}

/** The start ended without an island: take the screen away at once, so the card behind it shows. */
export function dropLoading() {
  off?.();
  el()?.remove();
}
