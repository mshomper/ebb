// @ts-check
// Quality tier pick: high, medium or low (docs/19, heuristic pick).
// M0 runs the heuristic and remembers it per adapter and screen; the 2 s probe arrives with M1 S8.

import { loadRecipe } from '../core/recipes.js';

const STORAGE_KEY = 'ebb.quality';
/** @type {Tier[]} */
const ORDER = ['low', 'medium', 'high'];

/** @typedef {'high'|'medium'|'low'} Tier */

/** @type {Tier} */
let current = 'medium';
/** @type {Record<Tier, any> | null} */
let table = null;

/**
 * Pick a tier for this device, using a remembered pick when the adapter and screen match.
 * @param {GPUAdapter} adapter
 * @returns {Promise<{tier: Tier, settings: any, reasons: string[]}>}
 */
export async function pickTier(adapter) {
  table = (await loadRecipe('quality-tiers')).tiers;
  const identity = adapterIdentity(adapter);
  const forced = new URLSearchParams(location.search).get('tier');
  /** @type {string[]} */
  const reasons = [];

  if (forced && ORDER.includes(/** @type {Tier} */ (forced))) {
    current = /** @type {Tier} */ (forced);
    reasons.push(`forced by ?tier=${forced}`);
  } else {
    const saved = readSaved();
    if (saved && saved.identity === identity && ORDER.includes(saved.tier)) {
      current = saved.tier;
      reasons.push('remembered for this device');
    } else {
      current = heuristic(adapter, reasons);
      writeSaved({ identity, tier: current });
    }
  }
  return { tier: current, settings: /** @type {any} */ (table)[current], reasons };
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
  return ORDER[Math.max(0, Math.min(2, pick))];
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

/** @param {{identity: string, tier: Tier}} v */
function writeSaved(v) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Storage blocked (private window); the pick is simply redone next time.
  }
}
