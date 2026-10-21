// @ts-check
// A net's haul (docs/future/12, K6): what one high water left in it. Pure: the same world seed,
// net, tide, place, depth, season and sign give the same haul, so it is rolled only when the net is
// lifted (live or after time away, an hour or a month late) and never saved. Most hauls hold a
// living thing or two; about one in four a keepsake, leaning rarer than the beach's through the
// rarity `lean` hook, with the tide's gates still in force. Depth steers the living kinds (the
// shallows give shrimp, crabs and gobies; deeper water sand eels, flatfish, wrasse and pipefish) and
// the season leans them (moon jellies in summer; fewer living things in winter).

import { hash32 } from '../../core/rng.js';
import { pickIndex, pickRarity } from '../keepsakes/rarity.js';
import { FAMILIES } from '../keepsakes/families/index.js';
import { u01 } from '../keepsakes/families/common.js';
import { catchNumbers } from './living/index.js';

/** Salts the haul apart from the strandline's rolls. */
const SALT = 0x4e75;

/**
 * @typedef {{ id: string, n: import('./living/index.js').CatchNumbers }} LivingCatch
 * @typedef {{ id: string, n: any }} NetKeepsake
 * @typedef {{ netId: number, tideId: number, living: LivingCatch[], keepsake: NetKeepsake | null, weed: number }} Haul
 * @typedef {{ seed: number, net: { id: number, kind: string }, tideId: number, cell: number[], depthM: number,
 *   spring: number, season: string, sign?: string | null }} HaulInput seed: subSeed(world seed, 'nets');
 *   cell: the net's water cell [i, j]; depthM: the water over it at that high water; spring: how big that
 *   tide was (-1 neap to 1 top spring); sign: a sign in the water nearby (K8; none yet)
 */

/**
 * Which living kind, by how deep the net fished and the season. @param {number} u
 * @param {any} NR nets.json @param {number} depthM @param {string} season
 */
export function pickKind(u, NR, depthM, season) {
  const kinds = Object.keys(NR.catches.kinds);
  const shallow = depthM < NR.haul.shallowM;
  const w = kinds.map((id) => {
    const k = NR.catches.kinds[id];
    return (shallow ? k.weight.shallow : k.weight.deep) * (k.season?.[season] ?? 1);
  });
  return kinds[pickIndex(u, w)];
}

/**
 * The haul. @param {HaulInput} p @param {any} NR recipes/world/nets.json @param {any} K keepsakes.json
 * @returns {Haul}
 */
export function haulOf(p, NR, K) {
  const H = NR.haul;
  const h = hash32(p.seed, p.net.id, p.tideId, p.cell[0] & 0xffff, p.cell[1] & 0xffff, SALT);
  const winter = p.season === 'winter';
  const cond = { spring: p.spring, season: p.season };
  const count = pickIndex(u01(hash32(h, 1)), winter ? H.winterLiving : H.living);
  /** @type {LivingCatch[]} */ const living = [];
  for (let i = 0; i < count; i++) {
    const hk = hash32(h, 10 + i);
    const kind = pickKind(u01(hash32(hk, 1)), NR, p.depthM, p.season);
    const rarity = pickRarity(u01(hash32(hk, 2)), K.rarity, cond);
    living.push({ id: `${p.net.id}:${p.tideId}:${i}`, n: catchNumbers(hash32(hk, 3), kind, rarity, NR) });
  }
  /** @type {NetKeepsake | null} */ let keepsake = null;
  if (u01(hash32(h, 2)) < (winter ? H.winterKeepsake : H.keepsakeChance)) {
    const fams = Object.keys(H.families).filter((f) => FAMILIES[f]);
    const family = fams[pickIndex(u01(hash32(h, 3)), fams.map((f) => H.families[f]))];
    const rarity = pickRarity(u01(hash32(h, 4)), K.rarity, { ...cond, lean: H.lean });
    keepsake = { id: `net:${p.net.id}:${p.tideId}`, n: FAMILIES[family].numbers(hash32(h, 5, FAMILIES[family].salt), rarity, K) };
  }
  return { netId: p.net.id, tideId: p.tideId, living, keepsake, weed: hash32(h, 6) };
}
