// @ts-check
// What the hen does at each word (docs/future/15, slice 2): the plan she takes up next, from her band
// (0 Wary .. 4 Fond, trust.js), the walker, the fire ring, the time of day, a treat set out and a
// hole just dug. life.js asks for a plan every so often and walks it with her code clips; this file
// only chooses, and picks the spots, so it is pure and tested on its own. Numbers: recipes/species/hen.json bands.
// Slice 3 adds her day (day.js finds the spots): roosting in the scrub or on the camp perch, a
// shelter in rain, the dawn drink and the midday dust bath.
//
//   Wary      keeps to the scrub; the walker inside her ring sends her running (life.js wary)
//   Tolerant  forages in the open near you, keeping about 3 m
//   Curious   comes to see you now and then; waits at the edge of soil you dig
//   Familiar  follows you on short walks at a loose 2 to 4 m; at dusk settles by the fire ring
//   Fond      greets you at dawn; settles beside you when you sit by the fire

/** Her band words in order, as recipes/species/hen.json bands names them. */
export const BAND_KEYS = /** @type {const} */ (['wary', 'tolerant', 'curious', 'familiar', 'fond']);

/**
 * @typedef {{ purpose: 'aside'|'treat'|'ring'|'roost'|'shelter'|'greet'|'beside'|'dig'|'drink'|'follow'|'dust'|'visit', x: number, z: number, pace: number,
 *   h?: number, yaw?: number, look?: { x: number, z: number } }} Plan
 *   purpose: why she goes (higher ones win, PRIORITY); x, z: where; pace: m/s; h: a roost's height
 *   off the ground (m); yaw: how she sits on it; look: what she faces there (the water she drinks)
 */

/** Which plan gives way to which: a plan in hand is dropped only for a higher one. */
export const PRIORITY = { aside: 9, treat: 8, ring: 7, roost: 7, shelter: 6.5, greet: 6, beside: 6, dig: 5, drink: 4.5, follow: 4, dust: 3.5, visit: 3 };

/**
 * @typedef {Object} HenSee what she takes in when she chooses
 * @property {number} band 0 Wary .. 4 Fond
 * @property {{ x: number, z: number }} hen where she is
 * @property {{ x: number, z: number }} home her scrub's middle
 * @property {{ x: number, z: number, speed: number, sit: boolean } | null} walker you on foot, or null
 * @property {{ x: number, z: number } | null} ring the laid fire ring, or null
 * @property {number} hourOfDay 0..24
 * @property {number} day the game day (for one greeting a day)
 * @property {number} greetedDay the last day she greeted you
 * @property {{ x: number, z: number } | null} treat a treat she is going for
 * @property {{ x: number, z: number } | null} dig a fresh hole she has noticed
 * @property {boolean} visitDue Curious and past: time to come and see you
 * @property {boolean} following already following (so she lets you get a little further first)
 * @property {boolean} [roosting] her roost time (day.js dayPart)
 * @property {{ x: number, z: number, h: number } | null} [roost] her bush roost, or null with no scrub
 * @property {{ x: number, z: number, h: number, yaw: number } | null} [perch] the camp perch (Familiar on), or null
 * @property {{ x: number, z: number } | null} [shelter] raining: her place under a bush
 * @property {{ x: number, z: number, look: { x: number, z: number } } | null} [drink] dawn: the water's edge, while a drink is due
 * @property {{ x: number, z: number } | null} [dust] midday: the dust-bath patch, while a bath is due
 */

/** The band's own numbers. @param {any} B recipes/species/hen.json bands @param {number} band */
export const bandRec = (B, band) => B[BAND_KEYS[Math.max(0, Math.min(4, band))]];

/** Dusk (Familiar on): from dusk.fromH until dusk.untilH. @param {any} B @param {number} h hour of day */
export const isDusk = (B, h) => h >= B.dusk.fromH || h < B.dusk.untilH;

/** A point `d` from (ax, az) toward (bx, bz) (straight on past b if they meet). */
function toward(/** @type {number} */ ax, /** @type {number} */ az, /** @type {number} */ bx, /** @type {number} */ bz, /** @type {number} */ d) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  return { x: ax + (dx / l) * d, z: az + (dz / l) * d };
}

/**
 * Her place by the ring for the night: dusk.ringM from it, on the side toward her scrub, so she comes
 * in from home and sits facing the fire. @param {any} B @param {{ x: number, z: number }} ring @param {{ x: number, z: number }} home
 */
export const ringSpot = (B, ring, home) => toward(ring.x, ring.z, home.x === ring.x && home.z === ring.z ? ring.x + 1 : home.x, home.z, B.dusk.ringM);

/**
 * Her place beside you as you sit by the fire (Fond): fondDo.sitBesideM from you, a quarter turn
 * round from the ring, so you sit side by side facing it. @param {any} B
 * @param {{ x: number, z: number }} you @param {{ x: number, z: number }} ring
 */
export function besideSpot(B, you, ring) {
  const dx = ring.x - you.x, dz = ring.z - you.z, l = Math.hypot(dx, dz) || 1;
  const d = B.fondDo.sitBesideM;
  return { x: you.x + (dz / l) * d, z: you.z - (dx / l) * d };
}

/** Is the walker sitting by the ring (within fondDo.sitM)? @param {any} B @param {HenSee} s */
export const sitsByFire = (B, s) => !!s.walker?.sit && !!s.ring && Math.hypot(s.walker.x - s.ring.x, s.walker.z - s.ring.z) <= B.fondDo.sitM;

/**
 * The next plan, or null to go on foraging. Pure. @param {any} R recipes/species/hen.json @param {HenSee} s
 * @returns {Plan | null}
 */
export function choosePlan(R, s) {
  const B = R.bands, b = s.band, w = s.walker;
  const walkMps = R.life.walkMps, runMps = R.wary.runMps, brisk = B.stepMps;
  const pace = (/** @type {number} */ d) => (d > B.follow.runM ? runMps : d > 1.5 ? brisk : walkMps);
  const dHen = (/** @type {{ x: number, z: number }} */ p) => Math.hypot(p.x - s.hen.x, p.z - s.hen.z);
  // A treat set out (any band: at Wary, life.js waits until you have stepped back from it).
  if (s.treat) return { purpose: 'treat', x: s.treat.x, z: s.treat.z, pace: pace(dHen(s.treat)) };
  // Roost time (slice 3): Fond beside you while you sit by the fire; else up to roost, on the camp
  // perch once Familiar, or in her scrub. With neither, life.js takes her home to stand.
  if (s.roosting) {
    if (b >= 4 && w && s.ring && sitsByFire(B, s)) { const at = besideSpot(B, w, s.ring); return { purpose: 'beside', ...at, pace: pace(dHen(at)) }; }
    const r = b >= 3 && s.perch ? s.perch : s.roost;
    if (r) return { purpose: 'roost', x: r.x, z: r.z, h: r.h, yaw: 'yaw' in r ? r.yaw : undefined, pace: pace(dHen(r)) };
    // A test ground with no scrub: by the ring for the night once Familiar, as slice 2 had it.
    if (b >= 3 && s.ring && isDusk(B, s.hourOfDay)) return { purpose: 'ring', ...ringSpot(B, s.ring, s.home), pace: pace(dHen(ringSpot(B, s.ring, s.home))) };
    return null;
  }
  // Rain: under a bush, fluffed, until it passes.
  if (s.shelter) return { purpose: 'shelter', x: s.shelter.x, z: s.shelter.z, pace: pace(dHen(s.shelter)) };
  // Dawn: to the water's edge for a drink (before anything you are doing).
  if (s.drink && (b < 4 || !w || s.greetedDay === s.day)) return { purpose: 'drink', x: s.drink.x, z: s.drink.z, look: s.drink.look, pace: pace(dHen(s.drink)) };
  if (!w) return s.dust ? { purpose: 'dust', x: s.dust.x, z: s.dust.z, pace: pace(dHen(s.dust)) } : null;
  const dw = Math.hypot(w.x - s.hen.x, w.z - s.hen.z);
  // Fond: the first sight of you at dawn, she comes to greet you.
  const F = B.fondDo;
  if (b >= 4 && s.greetedDay !== s.day && s.hourOfDay >= F.greetH[0] && s.hourOfDay < F.greetH[1] && dw <= F.greetSeeM) {
    const at = toward(w.x, w.z, s.hen.x, s.hen.z, F.greetM);
    return { purpose: 'greet', ...at, pace: pace(dw) };
  }
  // Fond: you sit by the fire, and she settles beside you.
  if (b >= 4 && s.ring && sitsByFire(B, s)) {
    const at = besideSpot(B, w, s.ring);
    return { purpose: 'beside', ...at, pace: pace(dHen(at)) };
  }
  // Curious on: soil you just turned.
  if (b >= 2 && s.dig) {
    const at = toward(s.dig.x, s.dig.z, s.hen.x, s.hen.z, B.dig.waitM);
    return { purpose: 'dig', ...at, pace: pace(dHen(at)) };
  }
  // Familiar on: after you, at a loose few metres, while you stay near her home.
  const fromHome = Math.hypot(w.x - s.home.x, w.z - s.home.z);
  const far = B.follow.farM + (s.following ? 0 : 0.5);
  if (b >= 3 && fromHome <= B.follow.leashM && dw > far) {
    const at = toward(w.x, w.z, s.hen.x, s.hen.z, (B.follow.nearM + B.follow.farM) / 2);
    return { purpose: 'follow', ...at, pace: pace(dw) };
  }
  // Midday: her dust bath, while you are not doing anything she would rather see.
  if (s.dust) return { purpose: 'dust', x: s.dust.x, z: s.dust.z, pace: pace(dHen(s.dust)) };
  // Curious on: now and then she comes to see what you are doing.
  if (b >= 2 && s.visitDue && dw <= B.joinM) {
    const at = toward(w.x, w.z, s.hen.x, s.hen.z, bandRec(B, b).visitM);
    return { purpose: 'visit', ...at, pace: pace(dHen(at)) };
  }
  return null;
}

/**
 * Where to step aside to when the walker comes inside her ring (Tolerant on): straight away from
 * you, out to her keeping distance. @param {any} R @param {number} band
 * @param {{ x: number, z: number }} hen @param {{ x: number, z: number }} you
 */
export function asideSpot(R, band, hen, you) {
  const B = bandRec(R.bands, band);
  const d = Math.max(B.keepM, B.ringM * 1.3);
  const at = Math.hypot(hen.x - you.x, hen.z - you.z) < 1e-3 ? { x: you.x + d, z: you.z } : toward(you.x, you.z, hen.x, hen.z, d);
  return { purpose: /** @type {'aside'} */ ('aside'), ...at, pace: R.bands.stepMps };
}

/**
 * A foraging spot near the walker (Tolerant on, the walker within joinM): in the ring keepM to keepM
 * + 2 m round you, on her side. `u`, `v` are her two draws (0..1). Null when you are too far.
 * @param {any} R @param {number} band @param {{ x: number, z: number }} hen @param {{ x: number, z: number } | null} you
 * @param {number} u @param {number} v
 */
export function nearYouSpot(R, band, hen, you, u, v) {
  if (band < 1 || !you || Math.hypot(hen.x - you.x, hen.z - you.z) > R.bands.joinM) return null;
  const B = bandRec(R.bands, band);
  const a = Math.atan2(hen.x - you.x, hen.z - you.z) + (u - 0.5) * 2.2;
  const r = B.keepM + 2 * v;
  return { x: you.x + Math.sin(a) * r, z: you.z + Math.cos(a) * r };
}
