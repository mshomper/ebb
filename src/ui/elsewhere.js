// @ts-check
// One island, one window (doc 18): the calm card shown when this island is open in another tab,
// either from the start or because another tab took it over. "Bring it here" asks the other tab to
// save and let go, then starts the island here from that save.

/**
 * @param {() => void} takeOver
 * @param {boolean} moved true when this tab had the island and another took it
 */
export function showElsewhere(takeOver, moved) {
  if (document.getElementById('ebb-elsewhere')) return;
  const style = document.createElement('style');
  style.textContent = `
    #ebb-elsewhere { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
      padding: 24px max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left));
      background: rgba(30, 38, 36, 0.82); overflow-y: auto; }
    #ebb-elsewhere .card { max-width: 460px; width: 100%; text-align: center; color: var(--ui-cream);
      display: grid; gap: 16px; justify-items: center; }
    #ebb-elsewhere img { width: 96px; height: 96px; border-radius: 22px; }
    #ebb-elsewhere p { margin: 0; font-size: 19px; line-height: 1.5; overflow-wrap: anywhere; }
    #ebb-elsewhere button { appearance: none; font: inherit; font-weight: 800; font-size: 18px; min-height: 48px;
      padding: 10px 22px; border: 0; border-radius: 14px; background: var(--ui-cream); color: var(--ui-night); cursor: pointer; }
    #ebb-elsewhere button:focus-visible { outline: 3px solid var(--wordmark-dark, #BFD5A8); outline-offset: 3px; }
  `;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.id = 'ebb-elsewhere';
  wrap.setAttribute('role', 'alert');
  const card = document.createElement('div');
  card.className = 'card';
  const img = document.createElement('img');
  img.src = 'brand/ebb-icon.svg';
  img.alt = '';
  const p = document.createElement('p');
  p.textContent = moved
    ? 'Your island is now open in another window, and is kept there. Nothing here is saved.'
    : 'Your island is open in another window. One window tends it at a time, so nothing is lost.';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Bring it here';
  b.addEventListener('click', () => { b.disabled = true; b.textContent = 'Bringing it here'; takeOver(); });
  card.append(img, p, b);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  b.focus();
}
