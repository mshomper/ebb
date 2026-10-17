// @ts-check
// Corner badge naming the build being looked at, so Matt knows which branch he is click-testing.
// build.json is written by the Pages workflow, or answered by tools/serve.ps1 when running locally
// ({local: true, branch}). Without either, the BUILD string from main.js is shown.

/**
 * @param {string} fallbackBuild
 * @returns {Promise<string>} the badge text
 */
export async function showBuildBadge(fallbackBuild) {
  let text = `build ${fallbackBuild}`;
  const info = await fetchJson('build.json');
  if (info?.local) text = `local · ${info.branch}`;
  else if (info?.branch === 'main') text = `build ${info.commit}`;
  else if (info?.branch) text = `preview · ${info.branch} · ${info.commit}`;

  const badge = document.createElement('div');
  badge.id = 'ebb-build';
  badge.textContent = text;
  Object.assign(badge.style, {
    position: 'fixed', left: 'max(12px, env(safe-area-inset-left))', top: 'max(12px, env(safe-area-inset-top))',
    padding: '6px 12px', borderRadius: '999px', fontSize: 'var(--text-small)', lineHeight: '1.3',
    maxWidth: 'calc(100% - 24px)', overflowWrap: 'anywhere', pointerEvents: 'none',
    background: 'rgba(30, 38, 36, 0.55)', color: 'var(--ui-cream)',
  });
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
