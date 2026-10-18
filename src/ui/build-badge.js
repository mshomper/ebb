// @ts-check
// Corner badge naming the build being looked at, so Matt knows which branch he is click-testing.
// build.json is written by the Pages workflow, or answered by tools/serve.ps1 when running locally
// ({local: true, branch}). Without either, the BUILD string from main.js is shown.

/**
 * @param {string} fallbackBuild
 * @param {{ current: { id: string, name: string }, list: { id: string, name: string }[] } | null} [island]
 *   the island this world started from; with more than one, the badge carries a switch to the next
 * @returns {Promise<string>} the badge text
 */
export async function showBuildBadge(fallbackBuild, island = null) {
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
  // The island switch: starts the next island fresh (each island keeps its own `?island=`).
  if (island && island.list.length > 1) {
    const i = island.list.findIndex((x) => x.id === island.current.id);
    const next = island.list[(i + 1) % island.list.length];
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Island: ${island.current.name}`;
    b.title = `Switch to ${next.name} (starts it fresh)`;
    Object.assign(b.style, {
      pointerEvents: 'auto', appearance: 'none', font: 'inherit', fontWeight: '700', color: 'inherit', cursor: 'pointer',
      padding: '6px 10px', minHeight: '36px', borderRadius: '12px', border: '1.5px solid rgba(244, 238, 228, 0.5)', background: 'transparent',
    });
    b.addEventListener('click', () => {
      const p = new URLSearchParams(location.search);
      p.set('island', next.id);
      location.search = p.toString();
    });
    badge.appendChild(b);
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
