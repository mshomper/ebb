// @ts-check
// Quality tier pick: ultra, high, medium or low (docs/19). A heuristic picks high, medium or low
// from the adapter and screen; a discrete desktop GPU starts on ultra and keeps it only if the
// startup probe passes (the app measures GPU time while the island fades in and calls
// probeResult). The pick is remembered per adapter and screen.

import { loadRecipe } from '../core/recipes.js';

const STORAGE_KEY = 'ebb.quality';
/** @type {Tier[]} */
const ORDER = ['low', 'medium', 'high', 'ultra'];

/** @typedef {'ultra'|'high'|'medium'|'low'} Tier */

/** @type {Tier} */
let current = 'medium';
/** @type {Record<Tier, any> | null} */
let table = null;

let identityNow = '';

/**
 * Pick a tier for this device, using a remembered pick when the adapter and screen match.
 * `probe` is set when the pick still has to prove itself: the app measures GPU p95 over
 * `seconds` (after `settleFrames`) and calls probeResult.
 * @param {GPUAdapter} adapter
 * @returns {Promise<{tier: Tier, settings: any, reasons: string[], probe: null | { maxMs: number, seconds: number, settleFrames: number, fallback: Tier }}>}
 */
export async function pickTier(adapter) {
  const recipe = await loadRecipe('quality-tiers');
  table = recipe.tiers;
  const identity = adapterIdentity(adapter);
  identityNow = identity;
  const forced = new URLSearchParams(location.search).get('tier');
  /** @type {string[]} */
  const reasons = [];
  let probe = null;

  if (forced && ORDER.includes(/** @type {Tier} */ (forced))) {
    current = /** @type {Tier} */ (forced);
    reasons.push(`forced by ?tier=${forced}`);
  } else {
    const saved = readSaved();
    if (saved && saved.identity === identity && ORDER.includes(saved.tier) && saved.probed) {
      current = saved.tier;
      reasons.push('remembered for this device');
    } else {
      current = heuristic(adapter, reasons);
      if (current === 'high') {
        // A discrete desktop GPU tries ultra first; the probe keeps it or steps back to high.
        current = 'ultra';
        reasons.push('trying ultra: measuring the GPU while the island fades in');
        probe = { maxMs: /** @type {any} */ (table).ultra.probeMaxMs, seconds: recipe.probe.seconds, settleFrames: recipe.probe.settleFrames, fallback: /** @type {Tier} */ ('high') };
        writeSaved({ identity, tier: 'high', probed: false });
      } else {
        writeSaved({ identity, tier: current, probed: true });
      }
    }
  }
  return { tier: current, settings: /** @type {any} */ (table)[current], reasons, probe };
}

/**
 * The startup probe's verdict: keep the tier, or step to `fallback`. Remembered for this device.
 * @param {boolean} passed @param {Tier} fallback
 * @returns {Tier} the tier to use from now on
 */
export function probeResult(passed, fallback) {
  if (!passed) current = fallback;
  writeSaved({ identity: identityNow, tier: current, probed: true });
  return current;
}

/** Settings for any tier (after pickTier). @param {Tier} t */
export function settingsFor(t) {
  return table ? table[t] : null;
}

/** @returns {Tier} */
export function tier() {
  return current;
}

export function tierSettings() {
  return table ? table[current] : null;
}

/** @param {Tier} t */
export function setTier(t) {
  current = t;
}

/**
 * @param {GPUAdapter} adapter
 * @param {string[]} reasons
 * @returns {Tier}
 */
function heuristic(adapter, reasons) {
  const info = adapter.info ?? /** @type {any} */ ({});
  const vendor = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.toLowerCase();
  const coarse = matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width, screen.height);

  if (info.isFallbackAdapter) {
    reasons.push('software (fallback) graphics adapter');
    return 'low';
  }
  let pick = 1;
  if (coarse && shortSide < 900) {
    pick = 0;
    reasons.push('touch screen, phone size');
  } else if (/nvidia|amd|radeon|geforce|rtx/.test(vendor) && !/integrated|apu/.test(vendor)) {
    pick = 2;
    reasons.push(`discrete GPU (${vendor.trim() || 'unknown'})`);
  } else {
    reasons.push(`integrated or unknown GPU (${vendor.trim() || 'unknown'})`);
  }
  if (!coarse && adapter.limits.maxStorageBuffersPerShaderStage <= 8 && adapter.limits.maxTextureDimension2D <= 8192) {
    pick -= 1;
    reasons.push('baseline limits');
  }
  if ((navigator.hardwareConcurrency ?? 8) < 6) {
    pick -= 1;
    reasons.push('fewer than 6 CPU threads');
  }
  const mem = /** @type {any} */ (navigator).deviceMemory;
  if (typeof mem === 'number' && mem < 4) {
    pick -= 1;
    reasons.push('under 4 GB memory');
  }
  return ORDER[Math.max(0, Math.min(2, pick))]; // ultra is never a guess: only the probe grants it
}

/** @param {GPUAdapter} adapter */
function adapterIdentity(adapter) {
  const i = adapter.info ?? /** @type {any} */ ({});
  return [i.vendor, i.architecture, i.device, screen.width, screen.height].join('|');
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** @param {{identity: string, tier: Tier, probed: boolean}} v */
function writeSaved(v) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Storage blocked (private window); the pick is simply redone next time.
  }
}
