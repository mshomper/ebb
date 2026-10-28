// @ts-check
// Settings > Saves and Settings > Tests (doc 18; S8 moved them here from the corner badge).
// Saves: back this island up to a file, open an island file, step back to an earlier save, start the
// island again, a quiet line when there has been no backup for a week, and the island's fingerprint
// (the same island gives the same eight letters on every device).
// Tests (previews and local builds only): pretend you were away, and buttons that damage a save or
// set its clock back, to check recovery (src/save/backup.js).
// Anything that replaces the island asks twice, on the page. Styles: settings.css.

import { backUp, checkIslandFile, openIslandFile, earlierSaves, openEarlier, damage } from '../save/backup.js';

const DAY_MS = 24 * 3600 * 1000;
const REMIND_DAYS = 7;

/** @typedef {(label: string, title: string) => HTMLButtonElement} MakeButton */

/** A line of text. @param {string} [text] */
function line(text = '') {
  const s = document.createElement('p');
  s.className = 'ebb-set__line';
  s.textContent = text;
  return s;
}
/** A wrapping row of buttons. */
function row() {
  const r = document.createElement('div');
  r.className = 'ebb-set__row';
  return r;
}
/** A small heading inside a section. @param {string} text */
function label(text) {
  const s = document.createElement('p');
  s.className = 'ebb-set__label';
  s.textContent = text;
  return s;
}
/** A status line that says what just happened. */
function status() {
  const s = line();
  s.setAttribute('role', 'status');
  return s;
}

/**
 * Ask twice on the page before something that replaces the island.
 * @param {HTMLButtonElement} b @param {string} again @param {() => Promise<void>} go @param {(err: unknown) => void} tell
 */
function twice(b, again, go, tell) {
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

/**
 * Fill the Saves section. Returns refresh(), for when the section opens (earlier saves, fingerprint).
 * @param {HTMLElement} panel
 * @param {{ save: any, island: { current: { id: string, name: string }, list: { id: string, name: string }[] } | null, button: MakeButton }} o
 *   save: the save session (src/save/autosave.js), with `fingerprint`; island: the island switch
 */
export function fillSavesPanel(panel, o) {
  const { save, button } = o;
  const kept = save?.status === 'loaded' || save?.status === 'fresh';
  const said = status();
  /** @param {unknown} err */
  const tell = (err) => { said.textContent = String(/** @type {any} */ (err)?.message ?? err); };

  // Whether this island is kept (doc 18): test links and tool pages run unsaved test islands.
  const keptWords = { loaded: 'Your island, kept on this device', fresh: 'Your island, kept on this device',
    test: 'A test island, not saved', failed: 'Not saved: this browser is not keeping data' }[save?.status ?? ''];
  if (keptWords) panel.appendChild(line(keptWords));

  // The island switch: each island keeps its own save, so switching opens it where you left it.
  if (o.island && o.island.list.length > 1) {
    const isl = /** @type {NonNullable<typeof o.island>} */ (o.island);
    const i = isl.list.findIndex((x) => x.id === isl.current.id);
    const next = isl.list[(i + 1) % isl.list.length];
    const b = button(`Island: ${isl.current.name}`, `Switch to ${next.name}; each island keeps its own save`);
    b.addEventListener('click', () => {
      const p = new URLSearchParams(location.search);
      p.set('island', next.id);
      location.search = p.toString();
    });
    const r = row();
    r.appendChild(b);
    panel.appendChild(r);
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
        checked = await checkIslandFile(file, o.island?.list ?? []);
        confirm.textContent = `Open ${checked.island.name} from this file`;
        confirm.hidden = false;
        said.textContent = `This file holds ${checked.island.name}, fingerprint ${checked.print}. Your island now stays among the earlier saves.`;
      } catch (err) { confirm.hidden = true; tell(err); }
    });
    twice(confirm, 'Tap again to open it', () => openIslandFile(save, checked), tell);
    const files = row();
    files.append(back, open, confirm);
    panel.append(files, pick);

    panel.append(label('Earlier saves'));
    earlierRow = row();
    panel.appendChild(earlierRow);

    const again = button('Start this island again', 'Forget this island and begin it fresh');
    twice(again, 'Tap again to start fresh', () => save.startAgain(), tell);
    const r = row();
    r.appendChild(again);
    panel.appendChild(r);
    remind = line();
    remind.classList.add('ebb-set__quiet');
    panel.appendChild(remind);
  }
  panel.appendChild(said);
  if (save?.fingerprint) { printLine = line(); panel.appendChild(printLine); }

  function renderRemind() {
    if (!remind) return;
    const rec = save.slotRecord?.();
    const since = rec?.lastBackupAt ?? null;
    const days = Math.floor((Date.now() - (since ?? rec?.created ?? Date.now())) / DAY_MS);
    remind.textContent = days < REMIND_DAYS ? '' : since ? `Last backed up ${days} days ago` : 'Not backed up yet';
  }

  return {
    /** The section opened: the earlier saves and the fingerprint as they are now. */
    async refresh() {
      renderRemind();
      if (printLine) printLine.textContent = `Island fingerprint ${save.fingerprint()}`;
      if (!earlierRow) return;
      const list = await earlierSaves(save).catch(() => []);
      earlierRow.replaceChildren();
      if (!list.length) { earlierRow.appendChild(line('None yet')); return; }
      for (const s of list) {
        const b = button(ago(s.savedAt), `Make the save from ${new Date(s.savedAt).toLocaleString()} the island now`);
        twice(b, 'Tap again to open it', () => openEarlier(save, s.gen), tell);
        earlierRow.appendChild(b);
      }
    },
  };
}

/**
 * Fill the Tests section (previews and local builds only): Pretend I was away, and the buttons that
 * damage a kept save or set its clock back.
 * @param {HTMLElement} panel
 * @param {{ save: any, button: MakeButton }} o  save: with `pretend` (src/sim/away.js)
 */
export function fillTestsPanel(panel, o) {
  const { save, button } = o;
  const kept = save?.status === 'loaded' || save?.status === 'fresh';
  if (save?.pretend) panel.appendChild(pretendRow(save.pretend, button));
  if (kept) {
    const said = status();
    panel.append(label('Check recovery'));
    const tests = row();
    for (const [what, text, title] of /** @type {const} */ ([
      ['island', 'Damage the newest save', 'Spoil the newest copy, then reload: the island comes back from the copy before'],
      ['chunk', 'Damage one chunk', 'Spoil one 32 m piece of the newest copy, then reload: only that piece comes from earlier'],
      ['clock', 'Clock back a day', 'As if the device clock went back a day, then reload: nothing rewinds'],
    ])) {
      const b = button(text, title);
      twice(b, 'Tap again to do it', () => damage(save, what), (err) => { said.textContent = String(/** @type {any} */ (err)?.message ?? err); });
      tests.appendChild(b);
    }
    panel.append(tests, said);
  }
}

/**
 * A test link's island only (quick fixes, October 28, 2026): Next morning and Skip a day, run through
 * the hourly tick (src/sim/away.js advance), with a line saying when it is now.
 * @param {HTMLElement} panel
 * @param {{ away: { advance: (what: 'morning'|'day') => Promise<void> }, button: MakeButton, when: () => string }} o
 */
export function fillTimeTests(panel, o) {
  const r = row();
  const said = status();
  for (const [what, text, title] of /** @type {const} */ ([
    ['morning', 'Next morning', 'Run on to 6 in the morning tomorrow, hour by hour, as time away does'],
    ['day', 'Skip a day', 'Run on a whole day, hour by hour, as time away does'],
  ])) {
    const b = o.button(text, title);
    b.addEventListener('click', async () => {
      for (const x of r.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = true;
      await o.away.advance(what);
      said.textContent = `Now ${o.when()}`;
      for (const x of r.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = false;
    });
    r.appendChild(b);
  }
  panel.append(label('Move time on'), r, said);
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
 * @param {{ pretendHours: number[], capHours?: number, pretend: (h: number) => Promise<{ hours: number, why: string }> }} away
 * @param {MakeButton} button
 */
function pretendRow(away, button) {
  const box = document.createElement('div');
  box.className = 'ebb-set__group';
  const r = row();
  const said = status();
  /** @param {number} h */
  const words = (h) => (h % 24 === 0 && h >= 24 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} ${h === 1 ? 'hour' : 'hours'}`);
  /** "7-day" @param {number} h */
  const limit = (h) => (h % 24 === 0 && h >= 24 ? `${h / 24}-day` : `${h}-hour`);
  for (const h of away.pretendHours) {
    const b = button(words(h), `Catch up as if you had been away for ${words(h)} of game time`);
    b.addEventListener('click', async () => {
      for (const x of r.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = true;
      said.textContent = 'Catching up';
      const a = await away.pretend(h);
      said.textContent = a.why === 'paused' ? 'Time is paused: nothing grew'
        : `${words(a.hours)} passed${a.why === 'capped' ? ` (the ${limit(away.capHours ?? a.hours)} limit)` : ''}`;
      for (const x of r.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (x).disabled = false;
    });
    r.appendChild(b);
  }
  box.append(label('Pretend I was away'), r, said);
  return box;
}
