// @ts-check
// Corner badge naming the build being looked at, so Matt knows which branch he is click-testing.
// build.json is written by the Pages workflow, or answered by tools/serve.ps1 when running locally
// ({local: true, branch}). Without either, the BUILD string from main.js is shown.

import { fillSavesPanel } from './saves-menu.js';

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
  // The Saves menu (src/ui/saves-menu.js; until S8 brings Settings). A test island can still pretend
  // it was away. Test buttons appear on previews and local builds, never on the live site.
  const kept2 = save?.status === 'loaded' || save?.status === 'fresh';
  if (save && (kept2 || (save.status === 'test' && save.pretend))) {
    const menu = button('Saves', 'Saving this island, backups, and time away');
    menu.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    Object.assign(panel.style, { display: 'grid', gap: '6px', justifyItems: 'start' });
    panel.hidden = true;
    const testing = !!info?.local || (!!info?.branch && info.branch !== 'main') || !info;
    const saves = fillSavesPanel(panel, { save, islands: island?.list ?? [], testing, button });
    menu.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      menu.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) saves.refresh();
    });
    badge.append(menu, panel);
  }
  document.body.appendChild(badge);
  return text;
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
