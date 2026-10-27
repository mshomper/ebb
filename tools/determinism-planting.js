// @ts-check
// The planting card on tools/determinism.html (P2g): a seed, a seed ball's cluster, a clump lifted
// and set again and a willow cutting, all through the growth system's planting path, then three game
// days; run straight, from a copy as a save holds it, again, and on a worker (src/world/sowing/check.js).

import { plantingCheckJob } from '../src/world/sowing/check.js';
import { initWorkers, run, dispose } from '../src/core/workers.js';

const JOB = { module: './world/sowing/check.js', fn: 'plantingCheckJob' };

/** @param {number} worldSeed */
export async function runPlanting(worldSeed) {
  const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
  const growth = await get('world/growth');
  const flora = Object.fromEntries(await Promise.all(growth.species.map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
  const covers = Object.fromEntries(await Promise.all((growth.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
  const args = { worldSeed, sowing: await get('world/sowing'), seasons: await get('world/seasons'), growth, flora, covers };
  const main = plantingCheckJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(JOB, args); } finally { dispose(); }
  return { main, worker };
}

/**
 * @param {Awaited<ReturnType<typeof runPlanting>>} g @param {HTMLElement} after the card it follows
 * @param {(h: number) => string} hex @param {(ok: boolean) => string} icon
 */
export function showPlanting(g, after, hex, icon) {
  let card = document.getElementById('plantingCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'plantingCard';
    after.after(card);
  }
  const { main, worker } = g;
  /** @param {string} label @param {number} a @param {number} b @param {string} [an] @param {string} [bn] */
  const row = (label, a, b, an = 'Main thread', bn = '1 worker') => {
    const ok = a === b;
    return `<div class="row total"><span class="label">${label}</span><span class="hash">${hex(a)}<small>${an}</small></span>` +
      `<span class="hash">${hex(b)}<small>${bn}</small></span><span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  card.innerHTML = '<h2>Planting from below</h2>' +
    row('Sown, set and cut, then 3 days', main.straight, worker.straight) +
    row('Played straight, against read back from the save', main.straight, main.fromSave, 'Straight on', 'From the save') +
    row('The same edits, run again', main.straight, main.again, 'First run', 'Second run') +
    `<p class="muted">A water mint seed, a seed ball of three, an iris clump lifted and set again with a good start, and a willow cutting: ${main.planted} of 7 went in. After three summer days the island's ${main.sizes.length} plants stand at sizes up to ${Math.max(0, ...main.sizes).toFixed(3)}.</p>`;
}
