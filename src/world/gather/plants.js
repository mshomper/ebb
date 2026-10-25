// @ts-check
// Picking a plant (docs/future/13 4.2, regrowth model B). A pick takes size: size becomes
// max(floor x best, size x (1 - share)). A plant can be picked when it has been mature (best at
// least matureSize), its size is back to readyShare x best, and the part is in its season window.
// Recovery is ordinary growth, slowed while the plant rests (growth/coarse.js recoverFactor), so
// no new per-plant state is kept. Pure: works on a plant record of world.state.growth.plants and
// returns a new one.

/**
 * A part's numbers: the gather.json plants.defaults of its type, overridden by its own entry
 * under plants.parts['<species>.<part>']. null when the species has no such part.
 * @param {string} sp @param {string} part @param {any} recipe gather.json
 * @returns {{ type: string, share: number, readyShare: number, window: number[] | number[][] } | null}
 */
export function partOf(sp, part, recipe) {
  const P = recipe.plants?.parts?.[`${sp}.${part}`];
  if (!P) return null;
  const D = recipe.plants.defaults?.[P.type] ?? {};
  return { type: P.type, share: P.share ?? D.share ?? 0, readyShare: P.readyShare ?? D.readyShare ?? 1, window: P.window ?? [0, 4] };
}

/** The parts a species gives, by part name. @param {string} sp @param {any} recipe @returns {string[]} */
export function partsOf(sp, recipe) {
  const pre = `${sp}.`;
  return Object.keys(recipe.plants?.parts ?? {}).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
}

/** Season position (0 spring .. 4) inside a [from, to) window, wrapping. @param {number} pos @param {number[]} w */
export const inWindow = (pos, w) => (w[1] > w[0] ? pos >= w[0] && pos < w[1] : pos >= w[0] || pos < w[1]);

/**
 * Can this part be picked now? why: 'young' (never yet mature: "Still small. Let it grow first."),
 * 'season' (the part is out of its window; asleep in winter), 'rest' (picked and not grown back:
 * "Let it rest a while."), or null when it can.
 * @param {{ id: number, sp: string, size: number, best: number }} plant a growth plant
 * @param {string} part e.g. 'down'
 * @param {{ flora: any, pos: number }} env flora: the species recipe; pos: the world's season position (seasons index + phase)
 * @param {any} recipe gather.json
 * @returns {{ ok: boolean, why: 'young' | 'rest' | 'season' | null }}
 */
export function pickable(plant, part, env, recipe) {
  const P = partOf(plant.sp, part, recipe);
  if (!P) return { ok: false, why: 'season' };
  if (plant.best < env.flora.growth.stages.matureSize) return { ok: false, why: 'young' };
  // On the world's calendar, the one the island shows, so the card's words never disagree with it
  // (Matt's click test, October 24: a plant's own few days ahead or behind left gaps at the edges).
  // A part may have two windows in the year (nettle tops: spring, and again in autumn).
  if (!windowsOf(P.window).some((w) => inWindow(env.pos, w))) return { ok: false, why: 'season' };
  if (plant.size < P.readyShare * plant.best) return { ok: false, why: 'rest' };
  return { ok: true, why: null };
}

/**
 * The card's line for a part out of season (docs/future/13 5.2, PR-42): a dormant plant is resting
 * for winter; otherwise nothing to pick now, and when the part comes, said against the season the
 * island shows: within soonDays, "in a few days"; later in this same season, "later this autumn";
 * else the third of the season its window opens in ("It flowers in high summer."). Never names the
 * season it is now as one still to come.
 * @param {{ stage: number }} plant @param {string} sp @param {string} part @param {any} recipe gather.json
 * @param {number} pos the world's season position now (0 spring .. 4)
 */
export function outOfSeasonLine(plant, sp, part, recipe, pos) {
  const W = recipe.words ?? {};
  if (plant.stage === DORMANT && W.resting) return W.resting;
  const now = ((pos % 4) + 4) % 4;
  // The start of the next window from now (a part with two windows names the nearer one).
  const ahead = (/** @type {number} */ s) => ((((s % 4) + 4) % 4 - now) % 4 + 4) % 4;
  const start = windowsOf(partOf(sp, part, recipe)?.window ?? [0, 4]).map((w) => ((w[0] % 4) + 4) % 4)
    .reduce((a, b) => (ahead(b) < ahead(a) ? b : a));
  const days = ahead(start) * 14;
  const thirds = /** @type {string[]} */ (W.when ?? []);
  let when = thirds[Math.floor(start * 3) % 12];
  if (days <= (W.soonDays ?? 3)) when = W.soon;
  else if (Math.floor(start) === Math.floor(now) && start > now) when = W.later?.replace('{season}', W.seasons?.[Math.floor(now)] ?? '');
  const tpl = W.comes?.[part] ?? W.comes?.default;
  return [W.nothingNow, tpl && when ? tpl.replace('{when}', when) : null].filter(Boolean).join(' ');
}

/**
 * A part's windows as a list: one [from, to) or several ([[from, to), [from, to)]).
 * @param {number[] | number[][]} w @returns {number[][]}
 */
export const windowsOf = (w) => (Array.isArray(w[0]) ? /** @type {number[][]} */ (w) : [/** @type {number[]} */ (w)]);

/**
 * Can a cover plant's cell be picked now (docs/future/13 4.2, rushes)? Its share must be at least
 * readyShare of what the ground there supports (its target) and at least minShare of full, and the
 * cover's part in its window (gather.json cover.<sp>.window). why as pickable's.
 * @param {number} share the cell's cover 0..255 @param {number} target its target 0..255
 * @param {string} sp @param {number} pos the world's season position @param {any} recipe gather.json
 * @returns {{ ok: boolean, why: 'rest' | 'season' | null, part: string | null }}
 */
export function coverPickable(share, target, sp, pos, recipe) {
  const C = recipe.cover, P = C?.species?.[sp];
  if (!P) return { ok: false, why: 'season', part: null };
  if (!windowsOf(P.window).some((w) => inWindow(pos, w))) return { ok: false, why: 'season', part: P.part };
  if (share < 255 * (C.minShare ?? 0) || share < (C.readyShare ?? 0.9) * target) return { ok: false, why: 'rest', part: P.part };
  return { ok: true, why: null, part: P.part };
}

/** A cover cell's share after one pick: lowered by coverShare of full. @param {number} share @param {any} recipe gather.json */
export const coverPick = (share, recipe) => Math.max(0, share - Math.round(255 * (recipe.cover?.coverShare ?? 0.25)));

/** The dormant stage, as growth/coarse.js STAGE.dormant. */
const DORMANT = 5;

/**
 * The plant after one pick: size = max(floor x best, size x (1 - share)). Best and stage stay.
 * @template {{ sp: string, size: number, best: number }} T
 * @param {T} plant @param {string} part @param {{ flora: any }} env flora: the species recipe @param {any} recipe gather.json
 * @returns {T}
 */
export function pick(plant, part, env, recipe) {
  const P = partOf(plant.sp, part, recipe);
  if (!P) return plant;
  return { ...plant, size: Math.max(env.flora.growth.floor * plant.best, plant.size * (1 - P.share)) };
}
