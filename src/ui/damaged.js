// @ts-check
// When a save was damaged (doc 18; S7d). Usually the island simply comes back, from a few minutes
// earlier or with one part from an earlier copy, and a calm note says so in the notes corner. If no
// copy reads at all, a calm card offers what can be done: open an island file, or start a new
// island. It never deletes the damaged copies. On previews and local builds only, the card also
// keeps the broken save as a file, so it can be looked into and fixed (Matt: players have no use
// for it).

import { emit } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { checkIslandFile, openIslandFile, saveDamagedCopy } from '../save/backup.js';

/**
 * The calm note for an island that came back from earlier copies (recover.js), if it did.
 * @param {any} save the save session
 */
export async function noticeRecovered(save) {
  // An island from before planting on foot was kept aside, and this one is new (D1a).
  if (save?.setAside) {
    const W = (await loadRecipe('world/save')).recovered;
    emit('island:notice', { text: W.setAside, showS: W.setAsideS ?? W.showS });
    return;
  }
  const r = save?.restoredFrom;
  if (!r || r.from === 'current') return;
  const W = (await loadRecipe('world/save')).recovered;
  const lines = [r.from === 'earlier' ? W.earlier : W.parts];
  if (r.lost.some((/** @type {string} */ id) => id.startsWith('chunk:'))) lines.push(W.landRegrew);
  if (r.lost.includes('journal')) lines.push(W.journalFresh);
  emit('island:notice', { text: lines.join(' '), showS: W.showS });
}

/**
 * The card when no copy of the save reads.
 * @param {any} save the save session @param {{ id: string, name: string }[]} islands
 */
export async function showDamaged(save, islands) {
  // The live site answers build.json with branch main; previews name their branch, the local server says so.
  const info = await fetch('build.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const testing = !info || !!info.local || (!!info.branch && info.branch !== 'main');
  const style = document.createElement('style');
  style.textContent = `
    #ebb-damaged { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
      padding: 24px max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left));
      background: var(--ui-night); color: var(--ui-cream); overflow-y: auto; }
    #ebb-damaged .card { max-width: 480px; width: 100%; text-align: center; display: grid; gap: 16px; justify-items: center; }
    #ebb-damaged img { width: 96px; height: 96px; border-radius: 22px; }
    #ebb-damaged p { margin: 0; font-size: calc(19px * var(--text-scale, 1)); line-height: 1.5; overflow-wrap: anywhere; }
    #ebb-damaged .said { font-size: calc(17px * var(--text-scale, 1)); min-height: 1.5em; }
    #ebb-damaged .row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    #ebb-damaged button, #ebb-damaged label { appearance: none; font: inherit; font-weight: 800; font-size: calc(18px * var(--text-scale, 1)); min-height: 48px; max-width: 100%;
      padding: 10px 18px; border-radius: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-align: center; }
    #ebb-damaged .main { border: 0; background: var(--ui-cream); color: var(--ui-night); }
    #ebb-damaged .quiet { border: 1.5px solid rgba(244, 238, 228, 0.5); background: transparent; color: inherit; }
    #ebb-damaged input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    #ebb-damaged :focus-visible { outline: 3px solid var(--wordmark-dark, #BFD5A8); outline-offset: 3px; }
  `;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.id = 'ebb-damaged';
  wrap.setAttribute('role', 'alert');
  wrap.innerHTML = `<div class="card">
      <img src="brand/ebb-icon.svg" alt="">
      <p>Your island's save could not be opened on this device. Nothing has been deleted.</p>
      <div class="row">
        <label class="main" for="ebb-damaged-file">Open an island file</label>
        <button type="button" class="quiet" data-act="new">Start a new island</button>
      </div>
      ${testing ? '<button type="button" class="quiet" data-act="copy">Keep the broken save for fixing</button>' : ''}
      <p class="said" role="status"></p>
      <input id="ebb-damaged-file" type="file" accept=".ebb">
    </div>`;
  document.body.appendChild(wrap);
  const said = /** @type {HTMLElement} */ (wrap.querySelector('.said'));
  const input = /** @type {HTMLInputElement} */ (wrap.querySelector('input'));
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      said.textContent = 'Opening the island';
      await openIslandFile(save, await checkIslandFile(file, islands));
    } catch (err) { said.textContent = String(/** @type {any} */ (err)?.message ?? err); }
  });
  let armed = false;
  wrap.addEventListener('click', async (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!b) return;
    if (b.dataset.act === 'copy') {
      const how = await saveDamagedCopy(save);
      said.textContent = how === 'none' ? 'There is no broken save to keep.' : 'The broken save is kept as a file.';
    } else if (b.dataset.act === 'new') {
      if (!armed) { armed = true; b.textContent = 'Tap again to start a new island'; return; }
      save.startAgain();
    }
  });
}
