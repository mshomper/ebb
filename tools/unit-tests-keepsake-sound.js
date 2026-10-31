// @ts-check
// The keepsake and net one-shots (docs/future/12; src/audio/keepsake-sounds.js,
// recipes/audio/keepsakes.json): every sound the recipe names has both files, and each decodes to
// a short take near the -3 dBFS it was levelled to. The decoding test needs a browser (an
// OfflineAudioContext) and says "skipped" in Node.

import { createKeepsakeSounds } from '../src/audio/keepsake-sounds.js';

/** The test page runs this file on its main thread, where Web Audio is; in Node its decoding check skips itself (tools/index-tests.mjs). */
export const NEEDS = 'web-audio';

const G = 'sound: keepsakes';

/** The recipe, by fetch in the browser and from disk in Node. */
async function recipe() {
  const url = new URL('../recipes/audio/keepsakes.json', import.meta.url);
  if (typeof window === 'undefined') {
    const fs = await import('node:fs');
    return JSON.parse(fs.readFileSync(url, 'utf8'));
  }
  return (await fetch(url, { cache: 'no-cache' })).json();
}

/** Whether a repository file exists. @param {string} path */
async function exists(path) {
  const url = new URL(`../${path}`, import.meta.url);
  if (typeof window === 'undefined') {
    const fs = await import('node:fs');
    return fs.existsSync(url);
  }
  return (await fetch(url, { method: 'HEAD', cache: 'no-cache' })).ok;
}

/** @param {any} s @returns {string[]} */
const filesOf = (s) => s.files ?? [s.file];

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert
 * @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addKeepsakeSoundTests(test, assert, eq) {
  test(G, 'every sound has a file and a level, and every preload is a sound', async () => {
    const R = await recipe();
    for (const [name, s] of Object.entries(R.sounds)) {
      assert(filesOf(s).length > 0 && filesOf(s).every((f) => typeof f === 'string' && f), `${name} has no file`);
      assert(typeof s.db === 'number' && s.db <= 0 && s.db >= -30, `${name} level ${s.db}`);
    }
    for (const p of R.preload) assert(R.sounds[p], `preload ${p} is not a sound`);
    for (const n of ['pickup', 'bottle', 'keep', 'keep-glass', 'leave', 'letter', 'net-set', 'net-lift', 'flop']) assert(R.sounds[n], `${n} missing`);
    eq(filesOf(R.sounds.leave).length, 2, 'leave takes');
  });

  test(G, 'each take is there as .ogg and .m4a', async () => {
    const R = await recipe();
    const missing = [];
    for (const s of Object.values(R.sounds)) {
      for (const f of filesOf(s)) for (const ext of ['ogg', 'm4a']) if (!(await exists(`${R.root}${f}.${ext}`))) missing.push(`${f}.${ext}`);
    }
    assert(missing.length === 0, `missing ${missing.join(', ')}`);
  });

  test(G, 'each take decodes short and near -3 dBFS', async () => {
    if (typeof OfflineAudioContext === 'undefined') return 'skipped (needs a browser)';
    const R = await recipe();
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    const ks = createKeepsakeSounds(/** @type {any} */ ({ ctx, input: () => ctx.destination }), { ...R, preload: [] });
    const lines = [];
    for (const s of Object.values(R.sounds)) {
      for (const f of filesOf(s)) {
        const b = await ks.load(f);
        assert(b, `${f} did not decode`);
        const buf = /** @type {AudioBuffer} */ (b);
        let p = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) p = Math.max(p, Math.abs(v));
        const db = 20 * Math.log10(p);
        assert(buf.duration > 0.2 && buf.duration < 2.2, `${f} lasts ${buf.duration.toFixed(2)} s`);
        assert(db > -6 && db < 0.5, `${f} peaks at ${db.toFixed(1)} dBFS`);
        lines.push(`${f} ${buf.duration.toFixed(2)} s`);
      }
    }
    return lines.join(', ');
  });
}
