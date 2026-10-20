// @ts-check
// Motion and text size on this device (docs 15, 16; S8b): the settings slice's `motion` and
// `textSize`, kept on the document root where the CSS can see them.
//   motion 'device' follows the system's reduced-motion setting, 'calm' is always still, 'full'
//   always moves (it overrides the system). CSS reads the root classes `ebb-motion-calm` and
//   `ebb-motion-full` beside each `prefers-reduced-motion` block; JS asks calm().
//   textSize (100, 115, 130, 160) becomes `--text-scale` on the root, which every UI font size is
//   multiplied by (tokens.css). Text only ever grows.

import { get, subscribe } from '../core/store.js';

/** @type {MediaQueryList | null} */
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * Should motion be calm now? True when Settings says Calm, or says Device and the system asks for
 * reduced motion.
 * @returns {boolean}
 */
export function calm() {
  const m = get('settings')?.motion;
  if (m === 'calm') return true;
  if (m === 'full') return false;
  return !!reduce?.matches;
}

/** Keep the root's text scale and motion classes in step with the settings slice. Once per page. */
let applied = false;
export function applyDisplayPrefs() {
  if (applied) return;
  applied = true;
  /** @param {any} s the settings slice */
  const apply = (s) => {
    const root = document.documentElement;
    const size = Number(s?.textSize);
    root.style.setProperty('--text-scale', String((size >= 100 ? size : 100) / 100));
    // From 130 percent, narrow layouts give whole words more room (journal.css).
    root.classList.toggle('ebb-text-large', size >= 130);
    root.classList.toggle('ebb-motion-calm', s?.motion === 'calm');
    root.classList.toggle('ebb-motion-full', s?.motion === 'full');
    // Left-handed: the phone layouts mirror (tools.css, time-flow.css).
    root.classList.toggle('ebb-left-handed', s?.leftHanded === true);
  };
  apply(get('settings'));
  subscribe('settings', apply);
}
