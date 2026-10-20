// @ts-check
// The now-playing line (doc 24, "Naming"; Matt, October 20, 2026): about halfway through each
// piece its name fades in softly at the bottom middle of the screen, in a small cream bubble, in the
// journal's Fraunces italic between two drawn notes, rests a few seconds and fades away. The heart
// at its end is the one thing in it you can tap: it hearts the piece (kept with the island; a
// hearted piece plays more often, src/audio/music/hearts.js) or takes the heart back. The rest of
// the bubble never takes a tap from the island. It stays away while the buttons are hidden (H),
// during the reveal, and while a tool is in hand (the tool card sits there); on a phone it waits for
// an island note in its place to go. Listens for music:started and music:ended
// (src/audio/music/index.js). Timing: recipes/audio/game.json `nowPlaying`. Styles: now-playing.css.

import { on } from '../core/events.js';
import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { loadAudioRecipe } from '../audio/recipes.js';
import { heartOf, isHearted } from '../audio/music/hearts.js';

/**
 * Mount the line.
 * @returns {Promise<() => void>} dispose
 */
export async function mountNowPlaying() {
  ensureIconSprite();
  const N = (await loadAudioRecipe('audio/game')).nowPlaying;
  const root = document.createElement('div');
  root.className = 'ebb-nowplaying';
  root.innerHTML = `${iconSvg('note', 'ebb-nowplaying__note')}<span class="ebb-nowplaying__title" role="status" aria-live="polite"></span>${iconSvg('notes2', 'ebb-nowplaying__note')}`
    + '<span class="ebb-nowplaying__rule" aria-hidden="true"></span>'
    + `<button type="button" class="ebb-nowplaying__heart" aria-pressed="false" aria-label="Heart this piece" title="Heart this piece">${iconSvg('heart', 'is-off')}${iconSvg('heart-full', 'is-on')}</button>`;
  root.style.setProperty('--np-in', `${N.fadeInS}s`);
  root.style.setProperty('--np-out', `${N.fadeOutS}s`);
  document.body.appendChild(root);
  const title = /** @type {HTMLElement} */ (root.querySelector('.ebb-nowplaying__title'));
  const heartBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-nowplaying__heart'));

  /** @type {ReturnType<typeof setTimeout>[]} */ let timers = [];
  /** @type {ReturnType<typeof setTimeout> | 0} */ let hideTimer = 0;
  const clear = () => { for (const t of timers) clearTimeout(t); timers = []; if (hideTimer) clearTimeout(hideTimer); hideTimer = 0; };
  const hide = () => root.classList.remove('is-shown');
  /** Hide after `s` seconds (a tap on the heart, or the pointer resting on it, gives it longer). @param {number} s */
  const hideIn = (s) => { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(hide, s * 1000); };
  /** A tool in hand: its card is where the line would be. */
  const toolInHand = () => !!get('tools')?.tool;
  const unTools = subscribe('tools', () => { if (toolInHand()) hide(); });

  /** The heart of the piece playing now, or null. @type {import('../audio/music/hearts.js').Heart | null} */
  let heart = null;
  const showHeart = () => {
    const on = !!heart && isHearted(get('music')?.hearted, heart.key);
    heartBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Hearted. Tap to take the heart back' : 'Heart this piece';
    heartBtn.setAttribute('aria-label', label);
    heartBtn.title = label;
  };
  const unMusic = subscribe('music', showHeart);
  heartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!heart) return;
    dispatch({ type: 'music.heart', heart });
    hideIn(N.holdS);
  });
  heartBtn.addEventListener('pointerenter', () => { if (root.classList.contains('is-shown')) hideIn(N.holdS); });

  /** Would the bubble cover an island note now (on a phone they share the lower left)? */
  function coversANote() {
    const b = root.getBoundingClientRect();
    for (const n of document.querySelectorAll('.ebb-notes > *')) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) return true;
    }
    return false;
  }

  const offStart = on('music:started', (/** @type {any} */ p) => {
    clear();
    hide();
    heart = heartOf(p);
    const dur = p.durationS ?? 60;
    const at = Math.max(0, dur * N.atShare - N.fadeInS);
    // Shown no later than this, so it never lingers past the piece's end.
    const latest = Math.max(at, dur - N.fadeInS - N.holdS - N.fadeOutS);
    let waited = 0;
    const show = () => {
      if (toolInHand()) return;
      title.textContent = p.title;
      showHeart();
      // An island note in the way: wait for it to go, a couple of seconds at a time.
      if (coversANote() && at + waited + 2 <= latest) { waited += 2; timers.push(setTimeout(show, 2000)); return; }
      if (coversANote()) return;
      root.classList.add('is-shown');
      hideIn(N.fadeInS + N.holdS);
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
  const offEnd = on('music:ended', () => { clear(); hide(); heart = null; });

  return () => { clear(); offStart(); offEnd(); unTools(); unMusic(); root.remove(); };
}
