// @ts-check
// Settings (docs/15 "Settings", S8): the drawn sliders button at the top right corner opens it.
// Desktop: a 600 px panel on the right with its sections listed down the left. Phone (under 700 px
// wide): a full-screen sheet with the sections stacked, each opening on a tap.
//   Time      speed, keep growing while away (this island), show what changed on return
//   Look      palette, text size, motion
//   Sound     volume and quiet in the background (src/audio/index.js applies them)
//   Controls  dimming the buttons when idle
//   Quality   Auto or a tier, switched with no reload (when the app offers it)
//   Saves     back up, open a file, earlier saves, start again, the island switch (saves-menu.js)
//   Tests     previews and local builds only: Pretend I was away, damage and clock tests
// The build line sits at the foot. Reads the store slices `meta` and `settings`; every change goes
// out as an action (time.flow, time.keepGrowing, look.palette, settings.set), except the quality
// switch, which calls the app's quality API. Styles: settings.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { fillSavesPanel, fillTestsPanel } from './saves-menu.js';

/** Under this width Settings is a full-screen sheet with stacked sections. */
const PHONE = '(max-width: 699px)';

const FLOWS = [{ id: 0, label: 'Pause' }, { id: 1, label: 'Normal' }, { id: 2, label: '2 times' }, { id: 4, label: '4 times' }];
const TEXT_SIZES = [100, 115, 130, 160].map((v) => ({ id: v, label: `${v}%` }));
const MOTIONS = [{ id: 'device', label: 'Like my device' }, { id: 'full', label: 'Full' }, { id: 'calm', label: 'Calm' }];
const TIERS = [{ id: 'auto', label: 'Auto' }, { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'ultra', label: 'Ultra' }];

/**
 * @typedef {Object} SettingsOptions
 * @property {HTMLElement} hudLayer   the HUD layer (src/ui/hud.js): the button joins it
 * @property {{ id: string, name: string }[]} palettes
 * @property {any} save               the save session (src/save/autosave.js), with pretend and fingerprint
 * @property {{ current: { id: string, name: string }, list: { id: string, name: string }[] } | null} island
 * @property {{ text: string, testing: boolean }} build
 * @property {{ set: (t: string) => boolean, tier: () => string } | null} quality  the app's live tier switch
 * @property {string} autoTier        the tier this device picked for itself
 */

/**
 * Mount the Settings button and panel.
 * @param {SettingsOptions} o
 * @returns {() => void} dispose
 */
export function mountSettings(o) {
  ensureIconSprite();
  const phone = matchMedia(PHONE);

  const btnRoot = document.createElement('div');
  btnRoot.className = 'ebb-setbtn';
  btnRoot.innerHTML = `<button type="button" class="ebb-setbtn__btn" aria-label="Settings" title="Settings"
    aria-expanded="false" aria-controls="ebb-settings">${iconSvg('settings')}</button>`;
  const openBtn = /** @type {HTMLButtonElement} */ (btnRoot.querySelector('button'));

  const panel = document.createElement('aside');
  panel.className = 'ebb-settings';
  panel.id = 'ebb-settings';
  panel.setAttribute('aria-label', 'Settings');
  panel.inert = true;
  panel.innerHTML = `
    <header class="ebb-settings__head">
      <h2>Settings</h2>
      <button type="button" class="ebb-settings__close" aria-label="Close settings" title="Close (Esc)">${iconSvg('close')}</button>
    </header>
    <div class="ebb-settings__body">
      <nav class="ebb-settings__nav" aria-label="Settings sections"></nav>
      <div class="ebb-settings__sections"></div>
    </div>
    <p class="ebb-settings__foot"></p>`;
  const nav = /** @type {HTMLElement} */ (panel.querySelector('.ebb-settings__nav'));
  const holder = /** @type {HTMLElement} */ (panel.querySelector('.ebb-settings__sections'));
  const closeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('.ebb-settings__close'));
  /** @type {HTMLElement} */ (panel.querySelector('.ebb-settings__foot')).textContent = o.build.text;

  /** Re-render functions for the controls that show store values. @type {(() => void)[]} */
  const renders = [];
  /** @type {{ id: string, el: HTMLElement, navBtn: HTMLButtonElement, headBtn: HTMLButtonElement, onOpen?: () => void }[]} */
  const sections = [];

  // --- control helpers ---
  /**
   * A row of choices, one pressed.
   * @template T
   * @param {string} name @param {{ id: T, label: string }[]} options @param {() => T} current @param {(v: T) => void} pick
   */
  function choices(name, options, current, pick) {
    const box = el('div', 'ebb-set__field');
    const id = `ebb-set-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    box.innerHTML = `<p class="ebb-set__label" id="${id}">${name}</p>`;
    const r = el('div', 'ebb-set__choices');
    r.setAttribute('role', 'group');
    r.setAttribute('aria-labelledby', id);
    const btns = options.map((opt) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'ebb-set__choice'));
      b.type = 'button';
      b.textContent = opt.label;
      b.addEventListener('click', () => pick(opt.id));
      r.appendChild(b);
      return b;
    });
    box.appendChild(r);
    renders.push(() => { const v = current(); btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].id === v))); });
    return box;
  }
  /** An on/off switch. @param {string} text @param {() => boolean} on @param {(v: boolean) => void} set */
  function toggle(text, on, set) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'ebb-set__toggle'));
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.innerHTML = `<span class="ebb-set__toggle-text"></span><span class="ebb-set__switch" aria-hidden="true"></span>`;
    /** @type {HTMLElement} */ (b.firstElementChild).textContent = text;
    b.addEventListener('click', () => set(!on()));
    renders.push(() => b.setAttribute('aria-checked', String(on())));
    return b;
  }
  /** A quiet line of explanation. @param {string} text */
  function hint(text) {
    const p = el('p', 'ebb-set__hint');
    p.textContent = text;
    return p;
  }
  /** @type {import('./saves-menu.js').MakeButton} */
  function button(text, title) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'ebb-set__btn'));
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    return b;
  }

  // --- the sections ---
  /** @param {string} id @param {string} name @param {string} icon @param {HTMLElement[]} parts @param {{ test?: boolean, onOpen?: () => void }} [x] */
  function section(id, name, icon, parts, x = {}) {
    const s = el('section', 'ebb-set');
    s.dataset.id = id;
    if (x.test) s.classList.add('is-test');
    const headBtn = /** @type {HTMLButtonElement} */ (el('button', 'ebb-set__head'));
    headBtn.type = 'button';
    headBtn.innerHTML = `${iconSvg(icon)}<span></span>${iconSvg('chevron', 'ebb-set__chev')}`;
    /** @type {HTMLElement} */ (headBtn.querySelector('span')).textContent = name;
    headBtn.setAttribute('aria-expanded', 'false');
    const body = el('div', 'ebb-set__body');
    body.append(...parts);
    s.append(headBtn, body);
    holder.appendChild(s);

    const navBtn = /** @type {HTMLButtonElement} */ (el('button', `ebb-settings__tab${x.test ? ' is-test' : ''}`));
    navBtn.type = 'button';
    navBtn.innerHTML = `${iconSvg(icon)}<span></span>`;
    /** @type {HTMLElement} */ (navBtn.querySelector('span')).textContent = name;
    nav.appendChild(navBtn);
    const entry = { id, el: s, navBtn, headBtn, onOpen: x.onOpen };
    sections.push(entry);
    navBtn.addEventListener('click', () => show(id));
    headBtn.addEventListener('click', () => {
      if (!phone.matches) return;
      const open = !s.classList.contains('is-open');
      s.classList.toggle('is-open', open);
      headBtn.setAttribute('aria-expanded', String(open));
      if (open) entry.onOpen?.();
    });
  }

  const meta = () => get('meta') ?? {};
  const settings = () => get('settings') ?? {};
  const set = (/** @type {Record<string, any>} */ patch) => dispatch({ type: 'settings.set', patch });

  section('time', 'Time', 'time', [
    choices('Speed', FLOWS, () => meta().flow ?? 1, (flow) => dispatch({ type: 'time.flow', flow: /** @type {0|1|2|4} */ (flow) })),
    toggle('Keep growing while I am away', () => meta().keepGrowing !== false, (on) => dispatch({ type: 'time.keepGrowing', on })),
    toggle('Show what changed when I come back', () => settings().reveal !== false, (on) => set({ reveal: on })),
    hint('An island left paused stays paused while you are away.'),
  ]);
  section('look', 'Look', 'look', [
    choices('Palette', o.palettes.map((p) => ({ id: p.id, label: p.name })), () => settings().palette, (id) => dispatch({ type: 'look.palette', id })),
    choices('Text size', TEXT_SIZES, () => settings().textSize ?? 100, (textSize) => set({ textSize })),
    choices('Motion', MOTIONS, () => motionOf(settings().motion), (motion) => set({ motion })),
    hint('Calm keeps rings and fades still, and the return to the island is a short fade.'),
  ]);
  const volume = el('div', 'ebb-set__field');
  volume.innerHTML = `<label class="ebb-set__label" for="ebb-set-volume">Volume</label>
    <input class="ebb-set__range" id="ebb-set-volume" type="range" min="0" max="100" step="1">`;
  const volRange = /** @type {HTMLInputElement} */ (volume.querySelector('input'));
  volRange.addEventListener('input', () => set({ audio: { ...settings().audio, master: Number(volRange.value) / 100 } }));
  renders.push(() => {
    const v = String(Math.round((settings().audio?.master ?? 1) * 100));
    if (volRange.value !== v) volRange.value = v;
    volRange.style.setProperty('--fill', `${v}%`);
  });
  section('sound', 'Sound', 'sound', [
    hint('Sound starts after your first tap or key. On an iPhone, the silent switch also silences the island.'),
    volume,
    toggle('Quiet when this tab is in the background', () => settings().audio?.muteInBackground !== false,
      (on) => set({ audio: { ...settings().audio, muteInBackground: on } })),
  ]);
  section('controls', 'Controls', 'controls', [
    toggle('Dim the buttons when I am not using them', () => settings().hudDim !== false, (on) => set({ hudDim: on })),
    toggle('Left-handed layout on phones', () => settings().leftHanded === true, (on) => set({ leftHanded: on })),
    hint('H hides the buttons on a keyboard, and H again brings them back. On a touch screen, the eye in the corner brings them back.'),
  ]);
  if (o.quality) {
    const q = /** @type {NonNullable<typeof o.quality>} */ (o.quality);
    const name = (/** @type {string} */ t) => TIERS.find((x) => x.id === t)?.label ?? t;
    section('quality', 'Quality', 'quality', [
      choices('Detail', TIERS, () => settings().qualityChoice ?? 'auto', (t) => {
        set({ qualityChoice: t });
        q.set(t === 'auto' ? o.autoTier : t);
      }),
      hint(`Auto picks ${name(o.autoTier)} for this device.`),
      hint('Changes apply at once; the island never reloads.'),
    ]);
  }
  const savesBody = el('div', 'ebb-set__group');
  const saves = fillSavesPanel(savesBody, { save: o.save, island: o.island, button });
  section('saves', 'Saves', 'saves', [savesBody], { onOpen: () => { saves.refresh(); } });
  if (o.build.testing && o.save) {
    const testsBody = el('div', 'ebb-set__group');
    testsBody.appendChild(hint('Previews and local builds only.'));
    fillTestsPanel(testsBody, { save: o.save, button });
    section('tests', 'Tests', 'tests', [testsBody], { test: true });
  }

  // --- showing, opening and closing ---
  let current = sections[0].id;
  /** Desktop: one section at a time, chosen from the list. @param {string} id */
  function show(id) {
    current = id;
    for (const s of sections) {
      const on = s.id === id;
      s.el.classList.toggle('is-current', on);
      s.navBtn.setAttribute('aria-current', String(on));
      if (on) s.onOpen?.();
    }
  }

  const render = () => { for (const r of renders) r(); };
  /** @param {boolean} open */
  function setOpen(open) {
    if (open === panel.classList.contains('is-open')) return;
    panel.classList.toggle('is-open', open);
    panel.inert = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    openBtn.classList.toggle('is-on', open);
    if (open) {
      if (get('journalUi')?.open) dispatch({ type: 'ui.journal', open: false });
      render();
      show(current);
      closeBtn.focus({ preventScroll: true });
    } else if (panel.contains(document.activeElement)) {
      openBtn.focus({ preventScroll: true });
    }
  }

  openBtn.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  closeBtn.addEventListener('click', () => setOpen(false));
  /** Esc closes Settings before anything else hears it. @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key !== 'Escape' || !panel.classList.contains('is-open')) return;
    e.stopImmediatePropagation();
    setOpen(false);
  };
  addEventListener('keydown', onKey, true);
  /** Keep pointer and wheel input on the panel and button from reaching the island. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const node of [panel, btnRoot]) {
    node.addEventListener('pointerdown', stop);
    node.addEventListener('pointermove', stop);
    node.addEventListener('wheel', stop, { passive: true });
  }

  const unsubs = [
    subscribe('meta', render),
    subscribe('settings', render),
    // The journal and Settings share the right side: opening the journal closes Settings.
    subscribe('journalUi', (/** @type {any} */ u) => { if (u?.open) setOpen(false); }),
  ];
  show(current);
  render();
  o.hudLayer.appendChild(btnRoot);
  document.body.appendChild(panel);

  return function dispose() {
    for (const u of unsubs) u();
    removeEventListener('keydown', onKey, true);
    btnRoot.remove();
    panel.remove();
  };
}

/** The motion setting, reading older saved values. @param {unknown} m */
function motionOf(m) {
  return m === 'calm' || m === 'reduced' ? 'calm' : m === 'full' ? 'full' : 'device';
}

/** @param {string} tag @param {string} cls */
function el(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
