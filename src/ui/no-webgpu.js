// @ts-check
// The calm full-page card shown when WebGPU is missing or unusable (docs/03, GPU setup).

const BASE_MESSAGE =
  'ebb needs WebGPU, a graphics feature in modern browsers. It runs in current Chrome and Edge ' +
  'on Windows and Mac, Chrome on Android 12 or newer, Firefox on Windows, and Safari 26 on ' +
  'iPhone, iPad and Mac.';

const REASONS = {
  'missing': '',
  'no-adapter':
    'Your browser has WebGPU but could not use your graphics card. Check that hardware ' +
    'acceleration is turned on.',
  'device-failed':
    'Your browser has WebGPU but could not start it just now. Closing other tabs or ' +
    'restarting the browser usually helps.',
};

/**
 * Replace the canvas with the message card.
 * @param {'missing'|'no-adapter'|'device-failed'} reason
 */
export function showNoWebGPU(reason) {
  document.getElementById('view')?.remove();

  const style = document.createElement('style');
  style.textContent = `
    .ebb-card-wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 24px 16px; background: var(--ui-night); overflow-y: auto; }
    .ebb-card { max-width: 520px; width: 100%; text-align: center; color: var(--ui-cream); }
    .ebb-card img { width: 128px; height: 128px; border-radius: 28px; display: block; margin: 0 auto 20px; }
    .ebb-card h1 { margin: 0; font-weight: 800; font-size: calc(44px * var(--text-scale, 1)); letter-spacing: -0.015em; color: var(--wordmark-dark); }
    .ebb-card .tagline { margin: 2px 0 24px; font-family: var(--font-voice); font-style: italic; font-weight: 400;
      font-size: calc(20px * var(--text-scale, 1)); color: var(--tagline-dark); }
    .ebb-card p { font-size: calc(18px * var(--text-scale, 1)); line-height: 1.55; margin: 0 0 14px; overflow-wrap: anywhere; }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'ebb-card-wrap';
  wrap.setAttribute('role', 'alert');
  const card = document.createElement('div');
  card.className = 'ebb-card';

  const img = document.createElement('img');
  img.src = 'brand/ebb-icon.svg';
  img.alt = '';
  const h1 = document.createElement('h1');
  h1.textContent = 'ebb';
  const tagline = document.createElement('div');
  tagline.className = 'tagline';
  tagline.textContent = 'a tended island';
  card.append(img, h1, tagline);

  for (const text of [BASE_MESSAGE, REASONS[reason]]) {
    if (!text) continue;
    const p = document.createElement('p');
    p.textContent = text;
    card.appendChild(p);
  }
  wrap.appendChild(card);
  document.body.appendChild(wrap);
}

/**
 * A small note while GPU resources are rebuilt after a device loss.
 * @param {boolean} visible
 */
export function showRebuildingNote(visible) {
  let note = document.getElementById('ebb-rebuilding');
  if (!visible) { note?.remove(); return; }
  if (note) return;
  note = document.createElement('div');
  note.id = 'ebb-rebuilding';
  note.textContent = 'Rebuilding your island';
  note.setAttribute('role', 'status');
  Object.assign(note.style, {
    position: 'fixed', left: '50%', top: '24px', transform: 'translateX(-50%)',
    padding: '10px 18px', borderRadius: '999px', fontSize: 'calc(17px * var(--text-scale, 1))', maxWidth: 'calc(100% - 32px)',
    background: 'rgba(30, 38, 36, 0.78)', color: 'var(--ui-cream)',
  });
  document.body.appendChild(note);
}
