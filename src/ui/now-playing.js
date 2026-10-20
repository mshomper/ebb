// @ts-check
// The now-playing line (doc 24, "Naming"; Matt, October 20, 2026): about halfway through each
// piece its name fades in softly at the bottom middle of the screen, in a small cream bubble, in the
// journal's Fraunces italic between two drawn notes, with a heart at its end, rests a few seconds and fades away. It never takes a tap from the
// island (the heart becomes a button when hearted pieces are wired in). It stays away while the
// buttons are hidden (H), during the reveal, and while a tool is in hand (the tool card sits there);
// on a phone it waits for an island note in its place to go.
// Listens for music:started and music:ended (src/audio/music/index.js). Timing:
// recipes/audio/game.json `nowPlaying`. Styles: now-playing.css.

import { on } from '../core/events.js';
import { get, subscribe } from '../core/store.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { loadAudioRecipe } from '../audio/recipes.js';

/**
 * Mount the line.
 * @returns {Promise<() => void>} dispose
 */
export async function mountNowPlaying() {
  ensureIconSprite();
  const N = (await loadAudioRecipe('audio/game')).nowPlaying;
  const root = document.createElement('div');
  root.className = 'ebb-nowplaying';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `${iconSvg('note', 'ebb-nowplaying__note')}<span class="ebb-nowplaying__title"></span>${iconSvg('notes2', 'ebb-nowplaying__note')}`
    + `<span class="ebb-nowplaying__rule" aria-hidden="true"></span>${iconSvg('heart', 'ebb-nowplaying__heart')}`;
  root.style.setProperty('--np-in', `${N.fadeInS}s`);
  root.style.setProperty('--np-out', `${N.fadeOutS}s`);
  document.body.appendChild(root);
  const title = /** @type {HTMLElement} */ (root.querySelector('.ebb-nowplaying__title'));

  /** @type {ReturnType<typeof setTimeout>[]} */ let timers = [];
  const clear = () => { for (const t of timers) clearTimeout(t); timers = []; };
  const hide = () => root.classList.remove('is-shown');
  /** A tool in hand: its card is where the line would be. */
  const toolInHand = () => !!get('tools')?.tool;
  const unTools = subscribe('tools', () => { if (toolInHand()) hide(); });

  /** Would the bubble cover an island note now (on a phone they share the lower left)? */
  function coversANote() {
    const b = root.getBoundingClientRect();
    for (const n of document.querySelectorAll('.ebb-notes > *')) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) return true;
    }
    return false;
  }

  const offStart = on('music:started', (/** @type {{ title: string, durationS: number }} */ p) => {
    clear();
    hide();
    const dur = p.durationS ?? 60;
    const at = Math.max(0, dur * N.atShare - N.fadeInS);
    // Shown no later than this, so it never lingers past the piece's end.
    const latest = Math.max(at, dur - N.fadeInS - N.holdS - N.fadeOutS);
    let waited = 0;
    const show = () => {
      if (toolInHand()) return;
      title.textContent = p.title;
      // An island note in the way: wait for it to go, a couple of seconds at a time.
      if (coversANote() && at + waited + 2 <= latest) { waited += 2; timers.push(setTimeout(show, 2000)); return; }
      if (coversANote()) return;
      root.classList.add('is-shown');
      timers.push(setTimeout(hide, (N.fadeInS + N.holdS) * 1000));
      // A note that arrives under the bubble while it shows: the bubble steps aside early.
      const watch = () => {
        if (!root.classList.contains('is-shown')) return;
        if (coversANote()) { hide(); return; }
        timers.push(setTimeout(watch, 500));
      };
      timers.push(setTimeout(watch, 500));
    };
    timers.push(setTimeout(show, at * 1000));
  });
  const offEnd = on('music:ended', () => { clear(); hide(); });

  return () => { clear(); offStart(); offEnd(); unTools(); root.remove(); };
}
