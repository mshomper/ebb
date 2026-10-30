// @ts-check
// Device settings (doc 18): the store's `settings` slice, kept on this device and never in an island
// file, so a shared island never changes someone else's settings. Mirrored to localStorage for an
// instant boot, and to the IndexedDB `prefs` store. Quality is left out: render/quality.js keeps
// its own record of what this device can do.

import { subscribe } from '../core/store.js';
import { openDb, putPref } from './idb.js';

const KEY = 'ebb.prefs';
const KEPT = ['palette', 'textSize', 'motion', 'audio', 'hudDim', 'reveal', 'qualityChoice', 'journalList', 'keeperTab'];   // an older `leftHanded` is simply dropped

/**
 * The saved device settings (empty on a new device). The palette alone was kept before S7; motion
 * was 'full' or 'reduced' before S8b, and 'reduced' now reads as 'calm'.
 * @returns {Record<string, any>}
 */
export function loadPrefs() {
  /** @type {Record<string, any>} */ let p = {};
  try {
    const text = localStorage.getItem(KEY);
    if (text) p = JSON.parse(text) ?? {};
    const old = localStorage.getItem('ebb.palette');
    if (old && !p.palette) p.palette = old;
  } catch { /* storage blocked: defaults */ }
  if (!p || typeof p !== 'object') return {};
  if (p.motion === 'reduced') p.motion = 'calm';
  return p;
}

/** Keep the settings slice whenever it changes. Once per page. */
let watching = false;
export function keepPrefs() {
  if (watching) return;
  watching = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let t;
  subscribe('settings', (/** @type {any} */ s) => {
    const p = Object.fromEntries(KEPT.filter((k) => s?.[k] !== undefined).map((k) => [k, s[k]]));
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked: lasts this visit */ }
    clearTimeout(t);
    t = setTimeout(() => openDb().then((db) => putPref(db, 'device', p)).catch(() => {}), 1000);
  });
}
