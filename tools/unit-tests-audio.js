// @ts-check
// Audio tests (docs 17, 24, 25), on their own page until the audio branch merges and folds them
// into tools/unit-tests.html (docs/audio-future-work.md). Same look and runner as that page.

import { addMusicTests } from './unit-tests-music.js';
import { addChordExtraTests } from './unit-tests-chords-extra.js';
import { addSamplerTests } from './unit-tests-sampler.js';
import { addVoicingTests } from './unit-tests-voicing.js';
import { addDirectorTests } from './unit-tests-director.js';
import { addDevelopTests } from './unit-tests-develop.js';
import { addSoundGameTests } from './unit-tests-sound-game.js';
import { addSummerTests } from './unit-tests-summer.js';

/** @type {{group: string, name: string, fn: () => any}[]} */
const tests = [];
/** @param {string} group @param {string} name @param {() => any} fn */
const test = (group, name, fn) => tests.push({ group, name, fn });
/** @param {any} cond @param {string} [msg] */
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
/** @param {any} a @param {any} b @param {string} [msg] */
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${String(b)}, got ${String(a)}`.trim());
}

addMusicTests(test, assert, eq);
addChordExtraTests(test, assert, eq);
addSamplerTests(test, assert, eq);
addVoicingTests(test, assert, eq);
addDirectorTests(test, assert, eq);
addDevelopTests(test, assert, eq);
addSoundGameTests(test, assert, eq);
addSummerTests(test, assert, eq);

const CHECK = '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>';
const WARN = '<path d="M12 3.5L2.8 19.8h18.4z"/><path d="M12 9.5v4.8"/><path d="M12 17.2v.1"/>';
/** @param {boolean} ok */
function icon(ok) {
  const color = ok ? '#5F7F5B' : '#B5654A';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ok ? CHECK : WARN}</svg>`;
}
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

async function main() {
  const list = /** @type {HTMLElement} */ (document.getElementById('results'));
  const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
  let passed = 0;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    let ok = true, detail = '';
    try {
      const r = await t.fn();
      if (typeof r === 'string') detail = r;
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`[audio-tests] ${t.group}: ${t.name}`, e);
    }
    if (ok) passed++;
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'bad';
    li.innerHTML = `${icon(ok)}<span class="text"><span class="word">${ok ? 'passed' : 'failed'}</span> ${esc(t.group)}: ${esc(t.name)}${detail ? `<span class="detail">${esc(detail)}</span>` : ''}</span>`;
    list.appendChild(li);
    summary.textContent = `Running tests: ${passed} of ${i + 1} passed so far`;
  }
  summary.textContent = `${passed} of ${tests.length} passed`;
}

main();
