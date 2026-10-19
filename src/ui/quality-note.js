// @ts-check
// The calm note after the one automatic quality step down (docs 19): night glass at the top centre,
// under the safe area, one line and an Undo button. It fades by itself after a while; Undo puts the
// tier back (the caller also stops further automatic steps this session). Mounted by
// src/render/quality-live.js only when a step down happens.

const ID = 'ebb-quality-note';

/** @type {{ el: HTMLElement, timer: number } | null} */
let shown = null;

/**
 * @param {{ text: string, undoLabel: string, seconds: number, onUndo: () => void }} opts
 */
export function showQualityNote(opts) {
  hideQualityNote(true);
  ensureStyle();
  const el = document.createElement('div');
  el.id = ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const p = document.createElement('p');
  p.textContent = opts.text;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = opts.undoLabel;
  b.addEventListener('click', () => {
    hideQualityNote();
    opts.onUndo();
  });
  el.append(p, b);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-shown'));
  shown = { el, timer: window.setTimeout(() => hideQualityNote(), Math.max(1, opts.seconds) * 1000) };
}

/** @param {boolean} [now] remove at once, without the fade */
export function hideQualityNote(now = false) {
  if (!shown) return;
  const { el, timer } = shown;
  shown = null;
  clearTimeout(timer);
  if (now || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
  el.style.pointerEvents = 'none';
  el.classList.remove('is-shown');
  setTimeout(() => el.remove(), 450);
}

function ensureStyle() {
  if (document.getElementById(`${ID}-style`)) return;
  const s = document.createElement('style');
  s.id = `${ID}-style`;
  s.textContent = `
    #${ID} { position: fixed; z-index: 45; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 12px);
      transform: translate(-50%, -6px); width: max-content; max-width: calc(100vw - 32px);
      display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 14px;
      padding: 10px 10px 10px 18px; border-radius: 18px; background: rgba(30, 38, 36, 0.72); color: #F4EEE4;
      font-family: 'Nunito', system-ui, sans-serif; font-weight: 600; font-size: 17px; line-height: 1.4;
      opacity: 0; transition: opacity 0.4s ease, transform 0.4s ease; }
    #${ID}.is-shown { opacity: 1; transform: translate(-50%, 0); }
    #${ID} p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    #${ID} button { appearance: none; font: inherit; font-weight: 800; min-height: 44px; min-width: 44px;
      padding: 8px 18px; border: 0; border-radius: 12px; background: #F4EEE4; color: #1E2624; cursor: pointer; }
    #${ID} button:focus-visible { outline: 3px solid #BFD5A8; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { #${ID} { transition: none; } }
  `;
  document.head.appendChild(s);
}
