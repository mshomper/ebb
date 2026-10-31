// @ts-check
// A net's haul (docs/future/12, K6): what one high water left in it. Pure: the same world seed,
// net, tide, place, depth, season and sign give the same haul, so it is rolled only when the net is
// lifted (live or after time away, an hour or a month late) and never saved. Most hauls hold a
// living thing or two; about one in four a keepsake, leaning rarer than the beach's through the
// rarity `lean` hook, with the tide's gates still in force. Depth steers the living kinds (the
// shallows give shrimp, crabs and gobies; deeper water sand eels, flatfish, wrasse and pipefish) and
// the season leans them (moon jellies in summer; fewer living things in winter). Now and then a
// distinctive animal you let go before comes back (N7): it is the same seed, so the same animal, and
// the tray says so. The released list is part of the island's saved state, so this stays pure.
// A fish of the shallow waters (nets.json kinds' fish, docs/future/17) comes up as a glimpse: it
// is shown a moment and slips away, and never comes back as the same animal.

import { hash32 } from '../../core/rng.js';
import { pickIndex, pickRarity } from '../keepsakes/rarity.js';
import { FAMILIES } from '../keepsakes/families/index.js';
import { u01 } from '../keepsakes/families/common.js';
import { catchNumbers, distinctive } from './living/index.js';

/** Salts the haul apart from the strandline's rolls. */
const SALT = 0x4e75;

/**
 * @typedef {{ id: string, n: import('./living/index.js').CatchNumbers, again?: { hour: number }, glimpse?: boolean }} LivingCatch
 *   again: one let go before, at that game hour, caught again; glimpse: a fish, gone through the mesh (F17)
 * @typedef {{ id: string, n: any }} NetKeepsake
 * @typedef {{ netId: number, tideId: number, living: LivingCatch[], keepsake: NetKeepsake | null, weed: number }} Haul
 * @typedef {{ seed: number, net: { id: number, kind: string }, tideId: number, cell: number[], depthM: number,
 *   spring: number, season: string, sign?: string | null, released?: import('./model.js').Released[] }} HaulInput
 *   seed: subSeed(world seed, 'nets'); cell: the net's water cell [i, j]; depthM: the water over it at
 *   that high water; spring: how big that tide was (-1 neap to 1 top spring); sign: a sign in the water
 *   nearby (K8; none yet); released: the catches let go before (the nets' saved list)
 */

/**
 * The weight of a living kind at this depth and season. @param {any} NR @param {string} kind
 * @param {number} depthM @param {string} season
 */
function kindWeight(NR, kind, depthM, season) {
  const k = NR.catches.kinds[kind];
  if (!k) return 0;
  return (depthM < NR.haul.shallowM ? k.weight.shallow : k.weight.deep) * (k.season?.[season] ?? 1);
}

/**
 * The animals let go before that could come back to this net: distinctive ones whose kind lives at
 * this depth in this season. @param {import('./model.js').Released[]} released @param {any} NR
 * @param {number} depthM @param {string} season
 */
export function comeBack(released, NR, depthM, season) {
  return released.filter((r) => r.rarity && !NR.catches.kinds[r.kind]?.fish && kindWeight(NR, r.kind, depthM, season) > 0
    && distinctive(catchNumbers(r.seed, r.kind, r.rarity, NR)));
}

/**
 * Which living kind, by how deep the net fished and the season. @param {number} u
 * @param {any} NR nets.json @param {number} depthM @param {string} season
 */
export function pickKind(u, NR, depthM, season) {
  const kinds = Object.keys(NR.catches.kinds);
  return kinds[pickIndex(u, kinds.map((id) => kindWeight(NR, id, depthM, season)))];
}

/**
 * Many hauls of one net over a run of tides, as one hash (tools/determinism.html: the page and a
 * worker must agree). Worker job. @param {{ seed: number, tides: number, NR: any, K: any }} a
 * @returns {{ hash: number, living: number, keepsakes: number }}
 */
export function haulsJob(a) {
  let hash = 0x811c9dc5, living = 0, keepsakes = 0;
  for (let t = 0; t < a.tides; t++) {
    const hl = haulOf({ seed: a.seed, net: { id: 1, kind: 'general' }, tideId: t, cell: [t % 7, 3], depthM: (t % 5) * 0.15,
      spring: ((t % 9) - 4) / 4, season: ['spring', 'summer', 'autumn', 'winter'][t % 4] }, a.NR, a.K);
    living += hl.living.length;
    if (hl.keepsake) keepsakes++;
    const s = JSON.stringify(hl);
    for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return { hash, living, keepsakes };
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
  const back = comeBack(p.released ?? [], NR, p.depthM, p.season);
  for (let i = 0; i < count; i++) {
    const hk = hash32(h, 10 + i);
    // Now and then, one let go before: the same animal, caught again.
    if (back.length && u01(hash32(hk, 4)) < H.againChance) {
      const r = back[Math.min(back.length - 1, Math.floor(u01(hash32(hk, 5)) * back.length))];
      if (!living.some((c) => c.n.seed === (r.seed >>> 0))) {
        living.push({ id: `${p.net.id}:${p.tideId}:${i}`, n: catchNumbers(r.seed, r.kind, /** @type {string} */ (r.rarity), NR), again: { hour: r.hour } });
        continue;
      }
    }
    const kind = pickKind(u01(hash32(hk, 1)), NR, p.depthM, p.season);
    const rarity = pickRarity(u01(hash32(hk, 2)), K.rarity, cond);
    living.push({ id: `${p.net.id}:${p.tideId}:${i}`, n: catchNumbers(hash32(hk, 3), kind, rarity, NR), ...(NR.catches.kinds[kind]?.fish ? { glimpse: true } : {}) });
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
