// @ts-check
// Corner badge naming the build being looked at, so Matt knows which branch he is click-testing.
// build.json is written by the Pages workflow, or answered by tools/serve.ps1 when running locally
// ({local: true, branch}). Without either, the BUILD string from main.js is shown.

/**
 * @param {string} fallbackBuild
 * @param {{ current: { id: string, name: string }, list: { id: string, name: string }[] } | null} [island]
 *   the island this world started from; with more than one, the badge carries a switch to the next
 * @param {{ status: string, startAgain: () => Promise<void>, pretend?: any } | null} [save]
 *   this island's save (src/save/autosave.js): the badge says whether it is kept, and its Saves
 *   menu can start the island again; `pretend` is src/sim/away.js's Pretend I was away
 * @returns {Promise<string>} the badge text
 */
export async function showBuildBadge(fallbackBuild, island = null, save = null) {
  let text = `build ${fallbackBuild}`;
  const info = await fetchJson('build.json');
  if (info?.local) text = `local · ${info.branch}`;
  else if (info?.branch === 'main') text = `build ${info.commit}`;
  else if (info?.branch) text = `preview · ${info.branch} · ${info.commit}`;

  const badge = document.createElement('div');
  badge.id = 'ebb-build';
  Object.assign(badge.style, {
    position: 'fixed', left: 'max(12px, env(safe-area-inset-left))', top: 'max(12px, env(safe-area-inset-top))',
    padding: '6px 12px', borderRadius: '18px', fontSize: 'var(--text-small)', lineHeight: '1.3',
    maxWidth: 'min(230px, calc(100% - 140px))', overflowWrap: 'anywhere', pointerEvents: 'none',
    background: 'rgba(30, 38, 36, 0.55)', color: 'var(--ui-cream)', display: 'grid', gap: '4px', justifyItems: 'start',
  });
  const line = document.createElement('span');
  line.textContent = text;
  badge.appendChild(line);
  /** A badge button. @param {string} label @param {string} title */
  const button = (label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      pointerEvents: 'auto', appearance: 'none', font: 'inherit', fontWeight: '700', color: 'inherit', cursor: 'pointer',
      padding: '6px 10px', minHeight: '36px', borderRadius: '12px', border: '1.5px solid rgba(244, 238, 228, 0.5)', background: 'transparent',
    });
    return b;
  };
  // Whether this island is kept (doc 18): test links and tool pages run unsaved test islands.
  const kept = { loaded: 'Your island, kept on this device', fresh: 'Your island, kept on this device',
    test: 'Test island, not saved', failed: 'Not saved: this browser is not keeping data' }[save?.status ?? ''];
  if (kept) {
    const s = document.createElement('span');
    s.textContent = kept;
    badge.appendChild(s);
  }
  // The island switch: each island keeps its own save, so switching opens it where you left it.
  if (island && island.list.length > 1) {
    const i = island.list.findIndex((x) => x.id === island.current.id);
    const next = island.list[(i + 1) % island.list.length];
    const b = button(`Island: ${island.current.name}`, `Switch to ${next.name}`);
    b.addEventListener('click', () => {
      const p = new URLSearchParams(location.search);
      p.set('island', next.id);
      location.search = p.toString();
    });
    badge.appendChild(b);
  }
  // The Saves menu (until S8 brings Settings): start this island again (asked twice, on the page),
  // and pretend you were away (src/sim/away.js), which a test island can do too.
  const kept2 = save?.status === 'loaded' || save?.status === 'fresh';
  if (save && (kept2 || (save.status === 'test' && save.pretend))) {
    const menu = button('Saves', 'Saving this island, and time away');
    menu.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    Object.assign(panel.style, { display: 'grid', gap: '6px', justifyItems: 'start' });
    panel.hidden = true;
    menu.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      menu.setAttribute('aria-expanded', String(!panel.hidden));
    });
    badge.append(menu, panel);
    if (save.pretend) panel.appendChild(pretendRow(save.pretend, button));
    if (!kept2) { document.body.appendChild(badge); return text; }
    const again = button('Start this island again', 'Forget this island and begin it fresh');
    let armed = /** @type {ReturnType<typeof setTimeout> | 0} */ (0);
    again.addEventListener('click', () => {
      if (!armed) {
        again.textContent = 'Tap again to start fresh';
        armed = setTimeout(() => { armed = 0; again.textContent = 'Start this island again'; }, 4000);
        return;
      }
      clearTimeout(armed);
      again.disabled = true;
      again.textContent = 'Starting fresh';
      save.startAgain();
    });
    panel.appendChild(again);
  }
  document.body.appendChild(badge);
  return text;
}

/**
 * "Pretend I was away" and its choices, with a line saying how much time passed.
 * @param {{ pretendHours: number[], pretend: (h: number) => Promise<{ hours: number, why: string }> }} away
 * @param {(label: string, title: string) => HTMLButtonElement} button
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

/** @param {string} url */
async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
