// @ts-check
// Layout check (S8c): the real game (index.html) in same-origin iframes at narrow window sizes, loaded one
// at a time, and four checks read from each frame's DOM:
//   scroll   the page is no wider than the screen, and no HUD, settings, journal, notes or brush
//            card element runs past the left or right edge;
//   targets  visible, enabled buttons and inputs are at least 44 px both ways;
//   text     visible text is at least 15 px (the desktop floor: the frames use a mouse);
//   overlap  no two visible HUD buttons sit on top of each other by more than 2 px.
// Each frame is a throwaway test island (?seed=1): test links are never saved, so the frames do not
// fight over the saved island's lock. Nothing here touches the game's code.

/** @typedef {{ w: number, h: number, kind: string }} Size */
/** @typedef {{ id: string, name: string, short: string, ok: boolean, lines: string[], more: number }} CheckResult */
/** @typedef {{ label: string, checks: CheckResult[] }} Phase */
/** @typedef {{ size: Size, card: HTMLElement, wrap: HTMLElement, frame: HTMLIFrameElement | null,
 *   state: HTMLElement, results: HTMLElement, btn: HTMLButtonElement, fits: boolean | null, problems: string[] }} Row */

/** @type {Size[]} */
const SIZES = [
  { w: 320, h: 640, kind: 'Portrait' },
  { w: 360, h: 780, kind: 'Portrait' },
  { w: 375, h: 812, kind: 'Portrait' },
  { w: 390, h: 844, kind: 'Portrait' },
  { w: 430, h: 932, kind: 'Portrait' },
  { w: 667, h: 375, kind: 'Landscape' },
  { w: 844, h: 390, kind: 'Landscape' },
  { w: 932, h: 430, kind: 'Landscape' },
];

const GAME_URL = '../index.html?seed=1&hud=keep';
const MOUNT_TIMEOUT_MS = 20000;
const SETTLE_MS = 1500;       // after the HUD mounts: fonts, fade-ins and first layout
const TOOL_SETTLE_MS = 900;   // after opening a tool: the brush card's slide-in
const MIN_TARGET = 44;
const MIN_TEXT = 15;
const MAX_LISTED = 5;

const SVG_HEAD = '<svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
const ICON = {
  ok: `${SVG_HEAD}<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.75 2.75L16 9.5"/></svg>`,
  warn: `${SVG_HEAD}<path d="M12 3.5L21 19.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.25v.01"/></svg>`,
  wait: `${SVG_HEAD}<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>`,
};

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const statusEl = $('#status');
const summaryEl = $('#summary');
const checkAllBtn = /** @type {HTMLButtonElement} */ ($('#check-all'));
const openToolBox = /** @type {HTMLInputElement} */ ($('#open-tool'));
const stopAfterBox = /** @type {HTMLInputElement} */ ($('#stop-after'));
const sizesEl = $('#sizes');

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const sizeName = (/** @type {Size} */ s) => `${s.w} x ${s.h}`;

/** @param {HTMLElement} el @param {'ok'|'warn'|'wait'} kind @param {string} text */
function say(el, kind, text) {
  el.className = el.id ? '' : 'state';
  el.classList.add(kind);
  el.innerHTML = `${ICON[kind]}<span>${esc(text)}</span>`;
}

// ---------------------------------------------------------------- rows

/** @type {Row[]} */
const rows = SIZES.map((size) => {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <h2>${size.kind} ${sizeName(size)}</h2>
    <div class="state wait"></div>
    <div class="frame-wrap"><div class="empty">Not loaded yet</div></div>
    <button type="button">Check this size</button>
    <div class="checks"></div>`;
  sizesEl.appendChild(card);
  /** @type {Row} */
  const row = {
    size, card, frame: null, fits: null, problems: [],
    wrap: /** @type {HTMLElement} */ (card.querySelector('.frame-wrap')),
    state: /** @type {HTMLElement} */ (card.querySelector('.state')),
    results: /** @type {HTMLElement} */ (card.querySelector('.checks')),
    btn: /** @type {HTMLButtonElement} */ (card.querySelector('button')),
  };
  say(row.state, 'wait', 'Not checked yet');
  row.btn.addEventListener('click', () => run([row], false));
  return row;
});

/** Scale every frame down to the column so the page never scrolls sideways. */
function fitFrames() {
  for (const row of rows) {
    const avail = Math.max(1, row.card.clientWidth - 32);
    const s = Math.min(1, avail / row.size.w);
    row.wrap.style.width = `${Math.floor(row.size.w * s)}px`;
    row.wrap.style.height = `${Math.floor(row.size.h * s)}px`;
    if (row.frame) {
      row.frame.style.width = `${row.size.w}px`;
      row.frame.style.height = `${row.size.h}px`;
      row.frame.style.transform = `scale(${s})`;
    }
  }
}
new ResizeObserver(fitFrames).observe(sizesEl);

// ---------------------------------------------------------------- running

let busy = false;

/** @param {Row[]} list @param {boolean} all */
async function run(list, all) {
  if (busy) return;
  busy = true;
  checkAllBtn.disabled = true;
  for (const r of rows) r.btn.disabled = true;
  if (all) summaryEl.hidden = true;
  try {
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      say(statusEl, 'wait', `Loading ${sizeName(row.size)}${list.length > 1 ? ` (${i + 1} of ${list.length})` : ''}`);
      row.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await checkRow(row);
    }
    if (all) showSummary();
    say(statusEl, 'ok', 'Done. Press Check all, or Check this size on any row, to run again.');
  } catch (err) {
    say(statusEl, 'warn', `The check stopped: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    busy = false;
    checkAllBtn.disabled = false;
    for (const r of rows) r.btn.disabled = false;
  }
}

/** @param {Row} row */
async function checkRow(row) {
  row.results.innerHTML = '';
  row.fits = null;
  row.problems = [];
  unload(row);
  row.wrap.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.title = `The game at ${sizeName(row.size)}`;
  frame.src = GAME_URL;
  row.frame = frame;
  row.wrap.appendChild(frame);
  fitFrames();
  say(row.state, 'wait', 'Loading the island');

  const doc = await waitForHud(frame);
  if (!doc) {
    row.fits = false;
    row.problems = ['did not start'];
    say(row.state, 'warn', 'Check this: the island did not show its buttons within 20 seconds, so nothing was checked. Open the game on its own to see why.');
    return;
  }
  say(row.state, 'wait', 'Checking');
  try { await doc.fonts?.ready; } catch { /* fonts are optional */ }
  await sleep(SETTLE_MS);

  /** @type {Phase[]} */
  const phases = [{ label: 'With the island as it opens', checks: runChecks(frame) }];
  if (openToolBox.checked) {
    const toolBtn = /** @type {HTMLElement | null} */ (doc.querySelector('.ebb-tools__btn[data-tool]'));
    if (toolBtn) {
      toolBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: frame.contentWindow }));
      await sleep(TOOL_SETTLE_MS);
      const name = toolBtn.getAttribute('aria-label') || toolBtn.dataset.tool || 'first';
      phases.push({ label: `With the ${name} tool open (brush card)`, checks: runChecks(frame) });
    } else {
      phases.push({ label: 'With a tool open', checks: [{ id: 'tool', name: 'Open a tool', short: 'tool', ok: false, lines: ['No tool button (.ebb-tools__btn[data-tool]) was found.'], more: 0 }] });
    }
  }

  showResults(row, phases);
  if (stopAfterBox.checked) {
    unload(row);
    row.wrap.innerHTML = '<div class="empty">Stopped after its check. Check this size to load it again.</div>';
  }
}

/** @param {Row} row */
function unload(row) {
  if (!row.frame) return;
  try { row.frame.src = 'about:blank'; } catch { /* ignore */ }
  row.frame.remove();
  row.frame = null;
}

/**
 * Poll the frame until the HUD's tool bar exists.
 * @param {HTMLIFrameElement} frame
 * @returns {Promise<Document | null>}
 */
async function waitForHud(frame) {
  const until = performance.now() + MOUNT_TIMEOUT_MS;
  while (performance.now() < until) {
    await sleep(250);
    let doc = null;
    try { doc = frame.contentDocument; } catch { return null; }
    if (doc && doc.location.href !== 'about:blank' && doc.querySelector('#ebb-hud .ebb-tools')) return doc;
  }
  return null;
}

// ---------------------------------------------------------------- checks

/**
 * Run the four checks on a frame.
 * @param {HTMLIFrameElement} frame
 * @returns {CheckResult[]}
 */
function runChecks(frame) {
  const win = /** @type {Window & typeof globalThis} */ (frame.contentWindow);
  const doc = /** @type {Document} */ (frame.contentDocument);
  const vw = doc.documentElement.clientWidth || win.innerWidth;
  const vh = doc.documentElement.clientHeight || win.innerHeight;
  return [checkScroll(doc, win, vw, vh), checkTargets(doc, win, vw, vh), checkText(doc, win, vw, vh), checkOverlap(doc, win, vw, vh)];
}

/** @param {Element} el @param {Window} win */
function isShown(el, win) {
  if (el.closest('[inert]')) return false;
  if (el.getClientRects().length === 0) return false;
  const anyEl = /** @type {any} */ (el);
  if (typeof anyEl.checkVisibility === 'function') {
    if (!anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  } else {
    for (let e = /** @type {Element | null} */ (el); e; e = e.parentElement) {
      const cs = win.getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    }
  }
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

/** @param {DOMRect} r @param {number} vw @param {number} vh */
const onScreen = (r, vw, vh) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;

/** A short name for an element: tag, classes and its label or text. @param {Element} el */
function describe(el) {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  const base = el.tagName.toLowerCase() + (cls.length ? `.${cls.join('.')}` : el.id ? `#${el.id}` : '');
  const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ');
  return name ? `${base} "${name.length > 32 ? `${name.slice(0, 32)}...` : name}"` : base;
}

/** @param {string} id @param {string} name @param {string} short @param {string[]} found @param {string[]} [extra] @returns {CheckResult} */
function result(id, name, short, found, extra = []) {
  const lines = [...extra, ...found.slice(0, MAX_LISTED)];
  return { id, name, short, ok: found.length === 0 && extra.length === 0, lines, more: Math.max(0, found.length - MAX_LISTED) };
}

/** (a) Sideways scroll. @param {Document} doc @param {Window} win @param {number} vw @param {number} vh */
function checkScroll(doc, win, vw, vh) {
  /** @type {string[]} */
  const extra = [];
  const root = doc.documentElement;
  const sw = Math.max(root.scrollWidth, doc.body?.scrollWidth ?? 0);
  if (sw > root.clientWidth) extra.push(`The page is ${sw} px wide on a ${root.clientWidth} px screen.`);

  /** @type {Set<Element>} */
  const seen = new Set();
  /** @type {Set<Element>} */
  const flagged = new Set();
  /** @type {string[]} */
  const found = [];
  for (const top of doc.querySelectorAll('#ebb-hud, .ebb-settings, .ebb-journal, .ebb-notes, .ebb-tools__card')) {
    for (const el of [top, ...top.querySelectorAll('*')]) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (!isShown(el, win)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) continue;
      const pastL = -r.left, pastR = r.right - vw;
      if (pastL <= 1 && pastR <= 1) continue;
      const parentFlagged = el.parentElement && flagged.has(el.parentElement);
      flagged.add(el);
      if (parentFlagged) continue;
      const side = pastR > 1 ? `${Math.round(pastR)} px past the right edge` : `${Math.round(pastL)} px past the left edge`;
      found.push(`${describe(el)}: ${side}`);
    }
  }
  return result('scroll', 'No sideways scroll', 'scroll', found, extra);
}

/** (b) Touch targets. @param {Document} doc @param {Window} win @param {number} vw @param {number} vh */
function checkTargets(doc, win, vw, vh) {
  /** @type {string[]} */
  const found = [];
  const els = doc.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [role="button"]');
  for (const el of els) {
    const ctl = /** @type {HTMLButtonElement | HTMLInputElement} */ (el);
    if (ctl.disabled || el.closest('fieldset[disabled]')) continue;
    if (!isShown(el, win)) continue;
    const r = el.getBoundingClientRect();
    if (!onScreen(r, vw, vh)) continue;
    let w = r.width, h = r.height;
    // A checkbox or radio inside its label counts the label's area.
    const labels = /** @type {HTMLInputElement} */ (el).labels;
    if (labels) for (const l of labels) {
      if (!isShown(l, win)) continue;
      const lr = l.getBoundingClientRect();
      w = Math.max(w, lr.width); h = Math.max(h, lr.height);
    }
    if (w + 0.5 >= MIN_TARGET && h + 0.5 >= MIN_TARGET) continue;
    found.push(`${describe(el)}: ${Math.round(w)} x ${Math.round(h)} px`);
  }
  return result('targets', `Buttons at least ${MIN_TARGET} px`, 'buttons', found);
}

/** (c) Text size. @param {Document} doc @param {Window} win @param {number} vw @param {number} vh */
function checkText(doc, win, vw, vh) {
  /** @type {string[]} */
  const found = [];
  if (!doc.body) return result('text', `Text at least ${MIN_TEXT} px`, 'text', found);
  /** @type {Set<Element>} */
  const parents = new Set();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const p = n.parentElement;
    if (!p || parents.has(p)) continue;
    const tag = p.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'title') continue;
    parents.add(p);
  }
  for (const p of parents) {
    if (!isShown(p, win)) continue;
    const r = p.getBoundingClientRect();
    if (!onScreen(r, vw, vh)) continue;
    let fs = parseFloat(win.getComputedStyle(p).fontSize);
    if (!(fs >= 2)) continue; // font-size 0 is a hiding trick, not text
    // SVG text draws at its font size times the drawing's scale.
    const ctm = /** @type {any} */ (p).getScreenCTM?.();
    if (ctm) fs *= Math.hypot(ctm.a, ctm.b);
    if (fs + 0.05 >= MIN_TEXT) continue;
    found.push(`${describe(p)}: ${Math.round(fs * 10) / 10} px`);
  }
  return result('text', `Text at least ${MIN_TEXT} px`, 'text', found);
}

/** (d) HUD buttons on top of each other. @param {Document} doc @param {Window} win @param {number} vw @param {number} vh */
function checkOverlap(doc, win, vw, vh) {
  const all = [...new Set(doc.querySelectorAll('#ebb-hud button, #ebb-hud [role="button"], .ebb-setbtn button'))]
    .filter((el) => isShown(el, win) && onScreen(el.getBoundingClientRect(), vw, vh));
  const rects = all.map((el) => el.getBoundingClientRect());
  /** @type {string[]} */
  const found = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].contains(all[j]) || all[j].contains(all[i])) continue;
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) found.push(`${describe(all[i])} and ${describe(all[j])}: ${Math.round(ox)} x ${Math.round(oy)} px`);
    }
  }
  return result('overlap', 'No buttons on top of each other', 'overlaps', found);
}

// ---------------------------------------------------------------- results

/** @param {Row} row @param {Phase[]} phases */
function showResults(row, phases) {
  /** @type {string[]} */
  const problems = [];
  let html = '';
  for (const phase of phases) {
    if (phases.length > 1) html += `<h3>${esc(phase.label)}</h3>`;
    for (const c of phase.checks) {
      if (!c.ok && !problems.includes(c.short)) problems.push(c.short);
      const list = c.lines.length
        ? `<ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}${c.more ? `<li>and ${c.more} more</li>` : ''}</ul>`
        : '';
      html += `<div class="check"><div class="state ${c.ok ? 'ok' : 'warn'}">${c.ok ? ICON.ok : ICON.warn}<span>${esc(c.name)}: ${c.ok ? 'fits' : 'check this'}</span></div>${list}</div>`;
    }
  }
  row.results.innerHTML = html;
  row.problems = problems;
  row.fits = problems.length === 0;
  if (row.fits) say(row.state, 'ok', `${sizeName(row.size)} fits`);
  else say(row.state, 'warn', `${sizeName(row.size)}: check this (${problems.join(', ')})`);
}

function showSummary() {
  const done = rows.filter((r) => r.fits !== null);
  const fit = done.filter((r) => r.fits);
  const bad = done.filter((r) => !r.fits);
  summaryEl.hidden = false;
  if (bad.length === 0) {
    say(summaryEl, 'ok', `${fit.length} of ${rows.length} sizes fit`);
  } else {
    const which = bad.map((r) => `${sizeName(r.size)} (${r.problems.join(', ')})`).join('; ');
    say(summaryEl, 'warn', `${fit.length} of ${rows.length} sizes fit. Needs work: ${which}.`);
  }
}

checkAllBtn.addEventListener('click', () => run(rows, true));
checkAllBtn.disabled = false;
fitFrames();
say(statusEl, 'ok', 'Ready. Press Check all, or Check this size on any row.');
