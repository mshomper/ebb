// @ts-check
// The lantern's flame on the HUD, down in the Hollow (H3a; doc 16, The lantern: one thing to watch,
// drawn as the flame itself, with no numbers, hearts or bar). A round badge under the clock dial's
// column with a drawn flame in it: it shrinks and dims as the fuel burns down, warms and wavers when
// low, gutters after a hit, and goes out with the light. Gone on the island. Reads the store slice
// `hollowTrip` ({ share, low, gutter, out } or null; src/world/hollow/zone-live.js). Styles:
// hollow-flame.css.

import { subscribe, get } from '../core/store.js';

/** The flame in the badge's 24-unit box, in the icon family's stroke (src/ui/icons/README.md). */
const FLAME = `
  <path class="ebb-flame__glow" d="M12 21.5C8 21.5 5.5 18.8 5.5 15.4C5.5 11.6 8.6 9.6 9.6 5.8C11.2 7.4 11.6 9.2 11.4 10.8C13 9.6 14.2 6.8 13.8 2.5C17 5.2 18.5 10.2 18.5 15.4C18.5 18.8 16 21.5 12 21.5Z"/>
  <path class="ebb-flame__core" d="M12 21.5C10.2 21.5 9 20.2 9 18.6C9 16.6 10.6 15.6 11.2 13.4C12.8 14.8 15 16.4 15 18.6C15 20.2 13.8 21.5 12 21.5Z"/>`;

/** @param {HTMLElement} parent the HUD layer @returns {() => void} dispose */
export function mountHollowFlame(parent) {
  const root = document.createElement('div');
  root.className = 'ebb-flame';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', "Your lantern's flame");
  root.innerHTML = `<svg class="ebb-flame__svg" viewBox="0 0 24 24" aria-hidden="true">${FLAME}</svg>`;
  const svg = /** @type {SVGSVGElement} */ (root.querySelector('svg'));
  function render() {
    const t = get('hollowTrip');
    root.classList.toggle('is-on', !!t);
    if (!t) return;
    root.classList.toggle('is-low', !!t.low);
    root.classList.toggle('is-gutter', !!t.gutter);
    root.classList.toggle('is-out', !!t.out);
    // The flame's size and brightness follow what is left: never under a third of its full height while it burns.
    const k = t.out ? 0 : 0.35 + 0.65 * Math.max(0, Math.min(1, t.share));
    svg.style.transform = `scale(${(0.45 + 0.55 * k).toFixed(3)})`;
    svg.style.opacity = (t.out ? 0 : 0.45 + 0.55 * k).toFixed(3);
  }
  const unsub = subscribe('hollowTrip', render);
  render();
  parent.appendChild(root);
  return () => { unsub(); root.remove(); };
}
