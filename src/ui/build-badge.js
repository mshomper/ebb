// @ts-check
// Which build is being looked at, so Matt knows which branch he is click-testing. build.json is
// written by the Pages workflow, or answered by tools/serve.ps1 when running locally
// ({local: true, branch}). Without either, the BUILD string from main.js is used.
// On previews and local builds a small tag under the clock dial names the branch; the live site
// shows none, and Settings carries the build line at its foot on every build (S8).

/**
 * The build line and whether this is a test build (a preview or a local server).
 * @param {string} fallbackBuild
 * @returns {Promise<{ text: string, testing: boolean }>}
 */
export async function buildInfo(fallbackBuild) {
  const info = await fetchJson('build.json');
  let text = `build ${fallbackBuild}`;
  if (info?.local) text = `local · ${info.branch}`;
  else if (info?.branch === 'main') text = `build ${info.commit}`;
  else if (info?.branch) text = `preview · ${info.branch} · ${info.commit}`;
  const testing = !!info?.local || (!!info?.branch && info.branch !== 'main') || !info;
  return { text, testing };
}

/**
 * The small tag under the clock dial, on test builds only. Takes no input.
 * @param {{ text: string, testing: boolean }} build
 * @param {HTMLElement | null} [hudLayer] the HUD layer (src/ui/hud.js); without it the tag sits in the corner
 */
export function showBuildTag(build, hudLayer = null) {
  if (!build.testing) return;
  const tag = document.createElement('div');
  tag.id = 'ebb-build';
  tag.textContent = build.text;
  Object.assign(tag.style, {
    position: 'fixed', left: 'max(12px, env(safe-area-inset-left))',
    top: hudLayer ? 'calc(max(12px, env(safe-area-inset-top)) + var(--hud-dial) + 8px)' : 'max(12px, env(safe-area-inset-top))',
    padding: '4px 10px', borderRadius: '12px', fontSize: 'var(--text-small)', lineHeight: '1.3',
    maxWidth: 'min(260px, calc(100% - 24px))', overflowWrap: 'anywhere', pointerEvents: 'none',
    background: 'rgba(30, 38, 36, 0.55)', color: 'var(--ui-cream)',
  });
  (hudLayer ?? document.body).appendChild(tag);
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
