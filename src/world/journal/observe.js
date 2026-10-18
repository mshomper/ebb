// @ts-check
// The field journal's model (docs 13, 15): what the player has come to know about each living
// thing, and the notes the island writes. Pure, with no DOM, store or events, so live play and a
// later catch-up (S7) build the same journal from the same hours.
//
// observe() looks at the world after each game hour (and after edits) together with that hour's
// tick events: a species is seen once it grows on the island, likes are learned when something
// shows them (it spreads, drowns, or the Plant tool refuses a spot), season boxes fill as the year
// turns, and short notes mark firsts. describe() turns the journal and the world into the words a
// page shows; identify() names the plant under a tapped point. All words come from
// recipes/world/journal.json ("words" below).

import { HABITAT_ORIGIN, habitatCell } from '../growth/habitat.js';
import { STAGE } from '../growth/coarse.js';

/** Season box bits. */
const GROW = 1, FLOWER = 2, DORMANT = 4;

/**
 * @typedef {Object} SpeciesKnowledge
 * @property {boolean} seen       growing on the island at the last look
 * @property {boolean} ever       seen at least once
 * @property {string[]} learned   triggers that have happened (seen, spread, lost:drown, refused:dry, ...)
 * @property {number[]} seasons   per season (spring .. winter): GROW | FLOWER | DORMANT bits seen
 * @property {number[]} counts    plants (or grass share x 1000) at each observed hour, newest last
 * @property {number} flowerYear  the year it last flowered, -1 before
 * @property {boolean} dormant    mostly dormant at the last look
 */

/** @typedef {{ hour: number, date: string, text: string, sp: string | null }} Note */

/**
 * @typedef {Object} Journal
 * @property {number} v
 * @property {number} born   hour the journal started
 * @property {number} last   last hour observed
 * @property {Record<string, SpeciesKnowledge>} species
 * @property {string[]} flags  island-wide things learned (e.g. frogs:settled)
 * @property {Note[]} notes   newest first
 */

/** @param {number} hour @returns {Journal} */
export function initialJournal(hour) {
  return { v: 1, born: hour, last: hour - 1, species: {}, flags: [], notes: [] };
}

/** @returns {SpeciesKnowledge} */
function blank() {
  return { seen: false, ever: false, learned: [], seasons: [0, 0, 0, 0], counts: [], flowerYear: -1, dormant: false };
}

/**
 * "Summer, day 3" (and ", year 2" after the first year) from the seasons state.
 * @param {any} seasons world state.seasons @param {any} words
 */
export function dateText(seasons, words) {
  const s = seasons ?? { index: 0, day: 0, year: 0 };
  const base = `${words.seasonNames[s.index] ?? ''}, day ${s.day + 1}`;
  return s.year > 0 ? `${base}, year ${s.year + 1}` : base;
}

/**
 * What one species looks like on the island now.
 * @param {string} sp @param {any} state @param {any} hab the habitat (or null) @param {any} rec words.species[sp]
 */
export function measure(sp, state, hab, rec) {
  if (rec.kind === 'cover') {
    const g = state?.growth?.grass;
    if (!hab || !g) return { count: 0, value: 0, flowering: 0, dormant: 0, mature: 0, plants: [] };
    let land = 0, covered = 0;
    for (let k = 0; k < hab.n * hab.n; k++) {
      if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0) continue;
      land++;
      if (hab.grass[k] * g[k] > 0.25 * 255 * 255) covered++;
    }
    const share = land ? covered / land : 0;
    return { count: share, value: Math.round(share * 1000), flowering: 0, dormant: 0, mature: 0, plants: [] };
  }
  const plants = (state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === sp);
  let flowering = 0, dormant = 0, mature = 0;
  for (const p of plants) {
    if (p.stage === STAGE.flowering) flowering++;
    if (p.stage === STAGE.dormant) dormant++;
    if (p.stage >= STAGE.mature) mature++;
  }
  return { count: plants.length, value: plants.length, flowering, dormant, mature, plants };
}

/** Is a measured species on the island? @param {any} rec @param {{ count: number }} m */
const present = (rec, m) => (rec.kind === 'cover' ? m.count >= rec.amount[0][0] : m.count > 0);

/**
 * Note `kind` for a species, if its words have one.
 * @param {Note[]} out @param {any} rec @param {string} kind @param {string} sp @param {number} hour @param {string} date
 */
function note(out, rec, kind, sp, hour, date) {
  const text = rec.notes?.[kind];
  if (text) out.push({ hour, date, text, sp });
}

/**
 * Learn a trigger for a species. Returns true if it was new.
 * @param {SpeciesKnowledge} k @param {string} trigger
 */
function learnTrigger(k, trigger) {
  if (k.learned.includes(trigger)) return false;
  k.learned.push(trigger);
  return true;
}

/** Copy a journal deep enough to change it. @param {Journal} j @returns {Journal} */
function copy(j) {
  /** @type {Record<string, SpeciesKnowledge>} */ const species = {};
  for (const [sp, k] of Object.entries(j.species)) species[sp] = { ...k, learned: k.learned.slice(), seasons: k.seasons.slice(), counts: k.counts.slice() };
  return { ...j, species, flags: j.flags.slice(), notes: j.notes.slice() };
}

/**
 * Add new notes to the journal, newest first, keeping words.notesKept.
 * @param {Journal} j @param {Note[]} notes @param {any} words
 */
function keep(j, notes, words) {
  if (!notes.length) return;
  j.notes = [...notes.slice().reverse(), ...j.notes].slice(0, words.notesKept);
}

/**
 * Look at the island after an hour (or an edit) and update the journal.
 * @param {Journal} journal
 * @param {{ state: any, events?: { name: string, payload: any }[], hour: number, habitat: any, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }} the new journal and the notes written now (oldest first)
 */
export function observe(journal, ctx) {
  const { state, hour, habitat: hab, words } = ctx;
  const j = copy(journal);
  /** @type {Note[]} */ const out = [];
  const date = dateText(state?.seasons, words);
  const newHour = hour > j.last;
  const season = Math.min(3, Math.max(0, state?.seasons?.index ?? 0));
  const year = state?.seasons?.year ?? 0;

  for (const sp of words.order) {
    const rec = words.species[sp];
    if (!rec) continue;
    const k = j.species[sp] ?? (j.species[sp] = blank());
    const m = measure(sp, state, hab, rec);
    const here = present(rec, m);
    if (here && !k.seen) {
      note(out, rec, !k.ever && hour - j.born <= words.arrivedHours ? 'arrived' : 'seen', sp, hour, date);
      k.seen = true;
      k.ever = true;
      learnTrigger(k, 'seen');
    } else if (!here && k.seen) {
      note(out, rec, 'gone', sp, hour, date);
      k.seen = false;
    }
    if (here) {
      const isDormant = m.dormant > 0 && m.dormant * 2 >= m.count;
      k.seasons[season] |= GROW;
      if (m.flowering > 0) k.seasons[season] |= FLOWER;
      if (isDormant) k.seasons[season] |= DORMANT;
      if (m.flowering > 0 && k.flowerYear !== year) {
        note(out, rec, 'flower', sp, hour, date);
        k.flowerYear = year;
        learnTrigger(k, 'flower');
      }
      if (isDormant && !k.dormant) note(out, rec, 'dormant', sp, hour, date);
      else if (!isDormant && k.dormant) note(out, rec, 'woke', sp, hour, date);
      k.dormant = isDormant;
    }
    if (newHour) {
      k.counts.push(m.value);
      if (k.counts.length > words.trend.hours + 1) k.counts.splice(0, k.counts.length - words.trend.hours - 1);
    }
    // Grass learns that it drowns once water comes to stand over growing grass (cover still high
    // where the water now is; a new island's cover starts at none under its ponds).
    const cover = state?.growth?.grass;
    if (rec.kind === 'cover' && hab && cover && !k.learned.includes('grass:flooded')) {
      let flooded = 0;
      for (let c = 0; c < hab.n * hab.n && flooded < 4; c++) if (hab.depthCm[c] > 0 && hab.grass[c] > 128 && cover[c] > 128 && hab.open[c]) flooded++;
      if (flooded >= 4) { learnTrigger(k, 'grass:flooded'); note(out, rec, 'flooded', sp, hour, date); }
    }
  }

  for (const e of ctx.events ?? []) {
    if (e.name === 'growth:spread') {
      for (const sp of Object.keys(e.payload?.bySpecies ?? {})) {
        const rec = words.species[sp], k = j.species[sp];
        if (rec && k && learnTrigger(k, 'spread')) note(out, rec, 'spread', sp, hour, date);
      }
    } else if (e.name === 'growth:lost') {
      const sp = e.payload?.species, why = e.payload?.why;
      const rec = words.species[sp], k = j.species[sp];
      if (rec && k && (why === 'drown' || why === 'seed') && learnTrigger(k, `lost:${why}`)) note(out, rec, why, sp, hour, date);
    } else if (e.name === 'season:changed') {
      const text = words.seasonNotes?.[e.payload?.index];
      if (text) out.push({ hour, date, text, sp: null });
    }
  }

  if (newHour) j.last = hour;
  keep(j, out, words);
  return { journal: j, notes: out };
}

/**
 * Learn something outside the hourly look, such as a Plant tool refusal ('refused:dry'). Writes a
 * note only when it teaches a like line the page did not show yet.
 * @param {Journal} journal @param {string} sp @param {string} trigger
 * @param {{ state: any, hour: number, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function learn(journal, sp, trigger, ctx) {
  const rec = ctx.words.species[sp];
  if (!rec) return { journal, notes: [] };
  const before = knownLikes(journal.species[sp], rec);
  const j = copy(journal);
  const k = j.species[sp] ?? (j.species[sp] = blank());
  if (!learnTrigger(k, trigger)) return { journal, notes: [] };
  /** @type {Note[]} */ const out = [];
  const after = knownLikes(k, rec);
  for (let i = 0; i < after.length; i++) {
    if (after[i] && !before[i]) out.push({ hour: ctx.hour, date: dateText(ctx.state?.seasons, ctx.words), text: `${rec.name}: ${lower(rec.likes[i].text)}.`, sp });
  }
  keep(j, out, ctx.words);
  return { journal: j, notes: out };
}

/** @param {string} s */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Which like lines are known. @param {SpeciesKnowledge | undefined} k @param {any} rec */
function knownLikes(k, rec) {
  return (rec.likes ?? []).map((/** @type {any} */ l) => !!k && l.learn.some((/** @type {string} */ t) => k.learned.includes(t)));
}

/**
 * Mark an island-wide happening (e.g. 'frogs:settled') so give lines can ink in.
 * @param {Journal} journal @param {string} flag
 */
export function flag(journal, flag) {
  if (journal.flags.includes(flag)) return journal;
  return { ...journal, flags: [...journal.flags, flag] };
}

/** The island's middle and size from the habitat, cached per habitat. @type {WeakMap<object, { x: number, z: number, r: number }>} */
const shapes = new WeakMap();
/** @param {any} hab */
function islandShape(hab) {
  let s = shapes.get(hab);
  if (s) return s;
  let n = 0, sx = 0, sz = 0;
  for (let k = 0; k < hab.n * hab.n; k++) {
    if (!hab.open[k] || hab.sea[k]) continue;
    n++; sx += k % hab.n; sz += Math.floor(k / hab.n);
  }
  s = n ? { x: HABITAT_ORIGIN + sx / n + 0.5, z: HABITAT_ORIGIN + sz / n + 0.5, r: Math.sqrt(n / Math.PI) } : { x: 0, z: 0, r: 1 };
  shapes.set(hab, s);
  return s;
}

/**
 * Where a set of plants sits: "on the west side", "all around the island", "in the middle of the island".
 * @param {{ x: number, z: number }[]} plants @param {any} hab @param {any} words
 */
export function whereWords(plants, hab, words) {
  if (!plants.length || !hab) return '';
  const isl = islandShape(hab);
  let cx = 0, cz = 0;
  for (const p of plants) { cx += p.x; cz += p.z; }
  cx /= plants.length; cz /= plants.length;
  let spread = 0;
  for (const p of plants) spread += Math.hypot(p.x - cx, p.z - cz);
  spread /= plants.length;
  if (plants.length > 2 && spread > words.where.spreadOut * isl.r) return 'all around the island';
  const dx = cx - isl.x, dz = cz - isl.z;
  if (Math.hypot(dx, dz) < words.where.centerShare * isl.r) return 'in the middle of the island';
  // North is -z (docs/08); sectors run counterclockwise from east.
  const a = Math.atan2(-dz, dx);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return `on the ${words.compass[i]} side`;
}

/**
 * Spreading (+1), receding (-1) or steady (0), from the counts over the last trend.hours hours.
 * @param {SpeciesKnowledge} k @param {any} words
 */
export function trendOf(k, words) {
  const T = words.trend;
  if (!k || k.counts.length <= T.hours) return 0;
  const now = k.counts[k.counts.length - 1], then = k.counts[k.counts.length - 1 - T.hours];
  if (now - then >= Math.max(T.upMin, T.upShare * then)) return 1;
  if (then - now >= Math.max(T.downMin, T.downShare * then)) return -1;
  return 0;
}

/** The words of an amount ladder for a value. @param {[number, string][]} ladder @param {number} v */
function amountOf(ladder, v) {
  let text = ladder[0][1];
  for (const [at, t] of ladder) if (v >= at) text = t;
  return text;
}

/**
 * Everything a species page shows, in words.
 * @param {Journal} journal @param {string} sp @param {any} state @param {any} hab @param {any} words
 */
export function describe(journal, sp, state, hab, words) {
  const rec = words.species[sp];
  const k = journal.species[sp];
  const known = !!k?.ever;
  const m = measure(sp, state, hab, rec);
  let status = '';
  if (known) {
    if (!present(rec, m)) status = rec.none;
    else {
      const t = trendOf(k, words);
      const trend = t > 0 ? rec.spreading : t < 0 ? rec.receding : '';
      if (rec.kind === 'cover') status = `${amountOf(rec.amount, m.count)}${trend ? `, ${trend}` : ''}.`;
      else {
        const where = rec.compass ? whereWords(m.plants, hab, words) : '';
        const isDormant = m.dormant > 0 && m.dormant * 2 >= m.count;
        const clause = isDormant ? rec.dormant : m.flowering > 0 && m.flowering * 2 >= m.mature ? rec.flowering : trend;
        status = `${amountOf(rec.amount, m.count)} ${rec.place}${where ? ` ${where}` : ''}${clause ? `, ${clause}` : ''}.`;
      }
    }
  }
  const likes = (rec.likes ?? []).map((/** @type {any} */ l, /** @type {number} */ i) => ({ text: l.text, known: knownLikes(k, rec)[i] }));
  const seasons = [0, 1, 2, 3].map((i) => {
    const bits = k?.seasons[i] ?? 0;
    const S = rec.seasons ?? {};
    const text = bits & FLOWER && S.flower ? S.flower : bits & DORMANT && S.dormant ? S.dormant : bits ? S.grow?.[i] ?? '' : null;
    return { name: words.seasonNames[i], text };
  });
  const gives = (rec.gives ?? []).map((/** @type {any} */ g) => {
    const inked = journal.flags.includes(g.when);
    return { text: inked ? g.ink : g.pencil, known: inked };
  });
  const notes = journal.notes.filter((n) => n.sp === sp).slice(0, words.pageNotes);
  return { sp, name: rec.name, icon: rec.icon, known, riddle: rec.riddle, status, likes, seasons, gives, notes };
}

/**
 * The plant nearest a tapped ground point, within words.identify.radiusM, or grass where it grows.
 * @param {any} state @param {any} hab @param {number} x @param {number} z @param {any} words
 * @returns {{ sp: string, name: string, icon: string, text: string, wx: number, wz: number, r: number } | null}
 *   wx, wz, r: where to ring the selection on the ground (the plant's middle, or the tap on grass)
 */
export function identify(state, hab, x, z, words) {
  const I = words.identify;
  let best = null, bestD = I.radiusM * I.radiusM;
  for (const p of state?.growth?.plants ?? []) {
    if (!words.species[p.sp]) continue;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) {
    const rec = words.species[best.sp];
    return { sp: best.sp, name: rec.name, icon: rec.icon, text: rec.stages?.[best.stage] ?? rec.name,
      wx: best.x, wz: best.z, r: I.ringM * (0.6 + 0.4 * Math.max(0, Math.min(1, best.size))) };
  }
  const g = state?.growth?.grass, grass = words.species.grass;
  const c = habitatCell(x, z);
  if (grass && g && hab && c >= 0 && hab.open[c] && hab.grass[c] * g[c] > 0.25 * 255 * 255) {
    return { sp: 'grass', name: grass.name, icon: grass.icon, text: grass.stages[0], wx: x, wz: z, r: I.grassRingM };
  }
  return null;
}
