// @ts-check
// The calm screen while the island catches up on time away (S7b; S7c turns it into the reveal): UI
// cream over the scene, one line in the journal's hand, and a thin line that fills as the days run.
// It shows only if catching up takes longer than `afterS`, so a short catch-up passes unseen. It
// covers the toolbar, so nothing is edited while the hours run.

import { calm } from './motion.js';

/**
 * @param {{ afterS: number, plain?: boolean }} opts  afterS 0 shows it at once (the reveal opens from it);
 *   plain: cream only, with no line and no bar (a night's rest in the tent has no away message)
 * @returns {{ progress: (f: number) => void, done: (fadeS?: number) => void }}
 *   done: fade out over fadeS (the reveal's cream opening is slower than the plain screen's)
 */
export function showCatchingUp(opts) {
  ensureStyle();
  const wrap = document.createElement('div');
  wrap.className = 'ebb-catchup';
  wrap.setAttribute('role', 'status');
  wrap.innerHTML = opts.plain ? '<div class="ebb-catchup__bar" aria-hidden="true" style="visibility:hidden"><i></i></div>'
    : '<p class="ebb-catchup__line">The island moved on while you were away</p><div class="ebb-catchup__bar" aria-hidden="true"><i></i></div>';
  const fill = /** @type {HTMLElement} */ (wrap.querySelector('i'));
  document.body.appendChild(wrap);   // blocks input at once; seen only once it fades in
  if (opts.afterS <= 0) { wrap.style.transition = 'none'; wrap.classList.add('is-shown'); }
  const timer = opts.afterS > 0 ? setTimeout(() => wrap.classList.add('is-shown'), opts.afterS * 1000) : 0;
  return {
    progress(f) { fill.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; },
    done(fadeS = 0.4) {
      clearTimeout(timer);
      if (!wrap.classList.contains('is-shown')) { wrap.remove(); return; }
      if (calm()) fadeS = 0;
      wrap.style.pointerEvents = 'none';
      wrap.style.transition = `opacity ${fadeS}s ease`;
      wrap.classList.remove('is-shown');
      setTimeout(() => wrap.remove(), fadeS * 1000 + 50);
    },
  };
}

function ensureStyle() {
  if (document.getElementById('ebb-catchup-style')) return;
  const s = document.createElement('style');
  s.id = 'ebb-catchup-style';
  s.textContent = `
    .ebb-catchup { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column; gap: 18px;
      align-items: center; justify-content: center; text-align: center; background: var(--ui-cream); color: var(--ui-night);
      padding: 24px max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left));
      opacity: 0; transition: opacity 0.4s ease; }
    .ebb-catchup.is-shown { opacity: 1; }
    .ebb-catchup__line { margin: 0; font-family: var(--font-voice, Georgia, serif); font-style: italic; font-weight: 400;
      font-size: calc(24px * var(--text-scale, 1)); line-height: 1.4; max-width: 30ch; overflow-wrap: anywhere; }
    .ebb-catchup__bar { width: min(280px, 80%); height: 6px; border-radius: 3px; background: rgba(30, 38, 36, 0.12); overflow: hidden; }
    .ebb-catchup__bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--wordmark, #5F7F5B); transition: width 0.2s linear; }
    @media (prefers-reduced-motion: reduce) {
      :root:not(.ebb-motion-full) .ebb-catchup, :root:not(.ebb-motion-full) .ebb-catchup__bar i { transition: none; } }
    :root.ebb-motion-calm .ebb-catchup, :root.ebb-motion-calm .ebb-catchup__bar i { transition: none; }
  `;
  document.head.appendChild(s);
}
