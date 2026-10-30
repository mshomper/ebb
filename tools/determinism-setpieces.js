// @ts-check
// The set pieces card on tools/determinism.html (docs/future/14): two seeded years of seasons, the
// cairn builder and the passing boat, with a player's choices written in and nights away when the
// boat's dusk must wait; run straight, with the island saved and read back every game day, again,
// and on a worker (src/world/setpieces/check.js).

import { setpieceCheckJob } from '../src/world/setpieces/check.js';
import { initWorkers, run, dispose } from '../src/core/workers.js';

const JOB = { module: './world/setpieces/check.js', fn: 'setpieceCheckJob' };

/** @param {number} worldSeed */
export async function runSetpieces(worldSeed) {
  const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
  const world = await get('world/setpieces');
  const list = Object.fromEntries(await Promise.all(world.order.map(async (/** @type {string} */ id) => [id, await get(`setpieces/${id}`)])));
  const args = { worldSeed, days: 112, recipes: { seasons: await get('world/seasons'), sky: await get('world/sky'), setpieces: { list, order: world.order, world } } };
  const main = setpieceCheckJob(args);
  initWorkers({ size: 1 });
  let worker;
  try { worker = await run(JOB, args); } finally { dispose(); }
  return { main, worker };
}

/**
 * @param {Awaited<ReturnType<typeof runSetpieces>>} g @param {HTMLElement} after the card it follows
 * @param {(h: number) => string} hex @param {(ok: boolean) => string} icon
 */
export function showSetpieces(g, after, hex, icon) {
  let card = document.getElementById('setpiecesCard');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'setpiecesCard';
    after.after(card);
  }
  const { main, worker } = g;
  /** @param {string} label @param {number} a @param {number} b @param {string} [an] @param {string} [bn] */
  const row = (label, a, b, an = 'Main thread', bn = '1 worker') => {
    const ok = a === b;
    return `<div class="row total"><span class="label">${label}</span><span class="hash">${hex(a)}<small>${an}</small></span>` +
      `<span class="hash">${hex(b)}<small>${bn}</small></span><span class="v ${ok ? 'ok' : 'bad'}">${icon(ok)}${ok ? 'match' : 'differ'}</span></div>`;
  };
  const c = main.first.counts;
  card.innerHTML = '<h2>Set pieces</h2>' +
    row('Every beat at its hour, two years', main.first.timeline, worker.first.timeline) +
    row('Saved and read back every day', main.first.timeline, main.saved.timeline, 'Straight through', 'Saved daily') +
    row('The set pieces at the end', main.first.end, main.saved.end, 'Straight through', 'Saved daily') +
    row('The same two years, run again', main.first.timeline, main.again.timeline, 'First run', 'Second run') +
    `<p class="muted">Over 112 game days: the cairn builder played out ${c.cairns ?? 0} time and the passing boat came ${c.boat ?? 0} times, waiting for a dusk you were there.</p>`;
}
