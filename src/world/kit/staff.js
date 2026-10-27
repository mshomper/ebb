// @ts-check
// The driftwood staff's look (C2, October 27, 2026): Matt's two staves are two looks of the one
// staff, and each island draws one from its seed (recipes/world/staff.json looks). Worked out from the
// world seed whenever it is needed, so the save keeps nothing for it and its format stays as it is.
// Pure.

import { subSeed } from '../../core/rng.js';

/**
 * This island's staff look. @param {number} worldSeed @param {any} R recipes/world/staff.json
 * @returns {{ id: string, model: string, name: string }}
 */
export function staffLook(worldSeed, R) {
  const looks = R.looks;
  return looks[(subSeed(worldSeed, 'staff') >>> 0) % looks.length];
}
