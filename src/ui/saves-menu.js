// @ts-check
// The badge's Saves menu (doc 18; until S8 brings Settings > Saves): back this island up to a file,
// open an island file, step back to an earlier save, pretend you were away, start the island again,
// a quiet line when there has been no backup for a week, and the island's fingerprint (the same
// island gives the same eight letters on every device). On previews and local builds it adds test
// buttons that damage a save or set its clock back, to check recovery (src/save/backup.js).
// Anything that replaces the island asks twice, on the page.

import { backUp, checkIslandFile, openIslandFile, earlierSaves, openEarlier, damage } from '../save/backup.js';

const DAY_MS = 24 * 3600 * 1000;
const REMIND_DAYS = 7;

/** @typedef {(label: string, title: string) => HTMLButtonElement} MakeButton */

/**
 * Fill the Saves panel. Returns refresh(), for when the menu opens (earlier saves, fingerprint).
 * @param {HTMLElement} panel
 * @param {{ save: any, islands: { id: string, name: string }[], testing: boolean, button: MakeButton }} o
 *   save: the save session (src/save/autosave.js), with `pretend` (src/sim/away.js) and `fingerprint`
 */
export function fillSavesPanel(panel, o) {
  const { save, button } = o;
  const kept = save.status === 'loaded' || save.status === 'fresh';
  /** @param {string} [text] */
  const line = (text = '') => { const s = document.createElement('span'); s.textContent = text; return s; };
  const row = () => { const r = document.createElement('div'); Object.assign(r.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' }); return r; };
  const said = line();
  said.setAttribute('role', 'status');
  /** @param {unknown} err */
  const tell = (err) => { said.textContent = String(/** @type {any} */ (err)?.message ?? err); };

  /** Ask twice on the page before something that replaces the island. @param {HTMLButtonElement} b @param {string} again @param {() => Promise<void>} go */
  function twice(b, again, go) {
    const first = b.textContent;
    /** @type {ReturnType<typeof setTimeout> | 0} */ let armed = 0;
    b.addEventListener('click', async () => {
      if (!armed) { b.textContent = again; armed = setTimeout(() => { armed = 0; b.textContent = first; }, 5000); return; }
      clearTimeout(armed);
      armed = 0;
      b.disabled = true;
      try { await go(); } catch (err) { tell(err); b.disabled = false; b.textContent = first; }
    });
  }

  /** @type {HTMLElement | null} */ let earlierRow = null, printLine = null, remind = null;
  if (kept) {
    const back = button('Back up this island', 'Save this island as a small file, to keep or to open on another device');
    back.addEventListener('click', async () => {
      back.disabled = true;
      try {
        const r = await backUp(save);
        said.textContent = r.how === 'cancelled' ? '' : `Backed up: ${r.name}, ${r.kb} KB. Fingerprint ${r.print}.`;
        renderRemind();
      } catch (err) { tell(err); }
      back.disabled = false;
    });
    // Opening a file: chosen, checked, then asked twice before it replaces this island.
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = '.ebb';
    pick.hidden = true;
    const open = button('Open an island file', 'Open an island saved as a file; this island stays among the earlier saves');
    const confirm = button('', '');
    confirm.hidden = true;
    open.addEventListener('click', () => pick.click());
    /** @type {any} */ let checked = null;
    pick.addEventListener('change', async () => {
      const file = pick.files?.[0];
      pick.value = '';
      if (!file) return;
      try {
        checked = await checkIslandFile(file, o.islands);
        confirm.textContent = `Open ${checked.island.name} from this file`;
        confirm.hidden = false;
        said.textContent = `This file holds ${checked.island.name}, fingerprint ${checked.print}. Your island now stays among the earlier saves.`;
      } catch (err) { confirm.hidden = true; tell(err); }
    });
    twice(confirm, 'Tap again to open it', () => openIslandFile(save, checked));
    panel.append(back, open, confirm, pick);
    panel.append(line('Earlier saves'));
    earlierRow = row();
    panel.appendChild(earlierRow);
  }
  if (save.pretend) panel.appendChild(pretendRow(save.pretend, button));
  if (kept) {
    const again = button('Start this island again', 'Forget this island and begin it fresh');
    twice(again, 'Tap again to start fresh', () => save.startAgain());
    panel.appendChild(again);
    remind = line();
    remind.style.fontStyle = 'italic';
    panel.appendChild(remind);
  }
  panel.appendChild(said);
  if (o.testing && kept) {
    panel.append(line('Tests (previews and local only)'));
    const tests = row();
    for (const [what, label, title] of /** @type {const} */ ([
      ['island', 'Damage the newest save', 'Spoil the newest copy, then reload: the island comes back from the copy before'],
      ['chunk', 'Damage one chunk', 'Spoil one 32 m piece of the newest copy, then reload: only that piece comes from earlier'],
      ['clock', 'Clock back a day', 'As if the device clock went back a day, then reload: nothing rewinds'],
    ])) {
      const b = button(label, title);
      twice(b, 'Tap again to do it', () => damage(save, what));
      tests.appendChild(b);
    }
    panel.appendChild(tests);
  }
  if (save.fingerprint) { printLine = line(); panel.appendChild(printLine); }

  function renderRemind() {
    if (!remind) return;
    const rec = save.slotRecord?.();
    const since = rec?.lastBackupAt ?? null;
    const days = Math.floor((Date.now() - (since ?? rec?.created ?? Date.now())) / DAY_MS);
    remind.textContent = days < REMIND_DAYS ? '' : since ? `Last backed up ${days} days ago` : 'Not backed up yet';
  }

  return {
    /** The menu opened: the earlier saves and the fingerprint as they are now. */
    async refresh() {
      renderRemind();
      if (printLine) printLine.textContent = `Island fingerprint ${save.fingerprint()}`;
      if (!earlierRow) return;
      const list = await earlierSaves(save).catch(() => []);
      earlierRow.replaceChildren();
      if (!list.length) { earlierRow.appendChild(line('None yet')); return; }
      for (const s of list) {
        const b = button(ago(s.savedAt), `Make the save from ${new Date(s.savedAt).toLocaleString()} the island now`);
        twice(b, 'Tap again to open it', () => openEarlier(save, s.gen));
        earlierRow.appendChild(b);
      }
    },
  };
}

/** "3 min ago", "2 hours ago", "4 days ago". @param {number} t UTC ms */
function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m <= 1 ? 'a minute ago' : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

/**
 * "Pretend I was away" and its choices, with a line saying how much time passed.
 * @param {{ pretendHours: number[], pretend: (h: number) => Promise<{ hours: number, why: string }> }} away
 * @param {MakeButton} button
 */
function pretendRow(away, button) {
  const box = document.createElement('div');
  Object.assign(box.style, { display: 'grid', gap: '6px', justifyItems: 'start' });
  const label = document.createElement('span');
  label.textContent = 'Pretend I was away';
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  const said = document.createElement('span');
  said.setAttribute('role', 'status');
  /** @param {number} h */
  const words = (h) => (h % 24 === 0 && h >= 24 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} ${h === 1 ? 'hour' : 'hours'}`);
  for (const h of away.pretendHours) {
    const b = button(words(h), `Catch up as if you had been away for ${words(h)} of game time`);
    b.addEventListener('click', async () => {
      for (const x of row.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = true;
      said.textContent = 'Catching up';
      const a = await away.pretend(h);
      said.textContent = a.why === 'paused' ? 'Time is paused: nothing grew'
        : `${words(a.hours)} passed${a.why === 'capped' ? ' (the 14-day limit)' : ''}`;
      for (const x of row.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = false;
    });
    row.appendChild(b);
  }
  box.append(label, row, said);
  return box;
}
