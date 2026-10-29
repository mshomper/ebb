// @ts-check
// Page words for the field journal's living things (docs 13, 15): turns the journal (observe.js)
// and the world into what a species page shows (status, likes, field notes, its story on your
// island, seasons, moments, gives, notes), names the plant under a tap, and picks the plant a page's
// Show me goes to. Pure; words from recipes/world/journal.json.

import { HABITAT_ORIGIN, habitatCell } from '../growth/habitat.js';
import { measure, present, knownLines, dateOfHour, sketchOf, coverShare, hasCover, isAnimal, COVER_HAS, COVER_FULL, FLOWER, DORMANT } from './observe.js';
import { trustWord } from '../creatures/trust.js';
import { bondOf, turtleTrust, namedTurtles } from '../creatures/bonds.js';
import { springSpots } from '../creatures/spring.js';
import { henCard, namedHen } from './hen.js';
import { openBox } from '../ecology/fields.js';

/** The island's middle and size from the habitat, cached per habitat. @type {WeakMap<object, { x: number, z: number, r: number }>} */
const shapes = new WeakMap();
/** @param {any} hab */
export function islandShape(hab) {
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
 * Where a set of points sits: "on the west side", "all around the island", "in the middle of the island".
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
 * @param {import('./observe.js').SpeciesKnowledge | undefined} k @param {any} words
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
export function amountOf(ladder, v) {
  let text = ladder[0][1];
  for (const [at, t] of ladder) if (v >= at) text = t;
  return text;
}

/** @param {string} s */
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The species' story on this island, in a few lines.
 * @param {import('./observe.js').SpeciesKnowledge} k @param {any} rec @param {{ count: number, value: number, plants: any[] }} m
 * @param {number} hour now @param {import('./observe.js').Journal} journal @param {any} words
 */
function storyOf(k, rec, m, hour, journal, words) {
  const S = words.story;
  // Inside a sentence the date reads "on summer, day 3".
  const date = (/** @type {number} */ h) => { const d = dateOfHour(h, words); return d.charAt(0).toLowerCase() + d.slice(1); };
  const fill = (/** @type {string} */ t, /** @type {number} */ h = -1) =>
    t.replace('{Plural}', upper(rec.plural ?? rec.name)).replace('{plural}', rec.plural ?? rec.name).replace('{date}', h >= 0 ? date(h) : '');
  /** @type {string[]} */ const lines = [];
  if (isAnimal(rec) || rec.kind === 'find') {
    if (k.first >= 0) lines.push(fill(rec.foundLine ?? S.firstSeen, k.first));
  } else if (rec.kind === 'cover') {
    lines.push(k.arrived ? rec.notes.arrived : fill(S.firstSeen, k.first));
  } else {
    lines.push(k.arrived ? fill(S.arrived) : fill(S.firstSeen, k.first));
    if (k.planted > 0) {
      lines.push(fill(S.planted, k.plantedAt));
      if (m.count > 0) lines.push(k.planted >= m.count ? S.ownFew : k.planted * 2 >= m.count ? S.ownHalf : S.ownMost);
    }
    let oldest = 0;
    for (const p of m.plants) if (p.age > oldest) oldest = p.age;
    if (oldest > 0) lines.push(hour - oldest <= journal.born ? S.oldestArrived : fill(S.oldest, hour - oldest));
  }
  if (k.peakAt >= 0 && m.value < S.peakShare * k.peak && k.peak >= 2) lines.push(fill(rec.peakLine ?? S.peak, k.peakAt));
  return lines;
}

/**
 * Everything a species page shows, in words.
 * @param {import('./observe.js').Journal} journal @param {string} sp @param {any} state @param {any} hab @param {any} words
 * @param {number} [hour] now (for the story's ages; the journal's last look when left out)
 */
export function describe(journal, sp, state, hab, words, hour = journal.last) {
  const rec = words.species[sp];
  const k = journal.species[sp];
  const known = !!k?.ever;
  const m = measure(sp, state, hab, rec);
  let status = '';
  // A find (docs/future/11) has no count: once found, its page says where it lives.
  if (known && rec.kind === 'find') status = rec.place;
  else if (known) {
    if (!present(rec, m)) status = rec.none;
    else {
      const t = trendOf(k, words);
      const trend = t > 0 ? rec.spreading : t < 0 ? rec.receding : '';
      // Still resting in spring: the season's plain words, not "for winter".
      const resting = (state?.seasons?.index ?? 0) === 0 ? rec.seasons?.dormant ?? rec.dormant : rec.dormant;
      if (isAnimal(rec)) {
        const where = rec.compass ? whereWords(rec.kind === 'swarm' ? m.spots ?? [] : m.plants, hab, words) : '';
        const clause = m.dormant > 0 && rec.dormant ? resting : trend;
        status = `${amountOf(rec.amount, m.count)} ${rec.place}${where ? ` ${where}` : ''}${clause ? `, ${clause}` : ''}.`;
      } else if (rec.kind === 'cover') {
        const where = rec.compass ? whereWords(m.spots ?? [], hab, words) : '';
        status = `${amountOf(rec.amount, m.count)}${rec.place ? ` ${rec.place}` : ''}${where ? ` ${where}` : ''}${trend ? `, ${trend}` : ''}.`;
      }
      else {
        const where = rec.compass ? whereWords(m.plants, hab, words) : '';
        const isDormant = m.dormant > 0 && m.dormant * 2 >= m.count;
        const clause = isDormant ? resting : m.flowering > 0 && m.flowering * 2 >= m.mature ? rec.flowering : trend;
        status = `${amountOf(rec.amount, m.count)} ${rec.place}${where ? ` ${where}` : ''}${clause ? `, ${clause}` : ''}.`;
      }
    }
  }
  // A9: while a group's pool is failing it, the page says why (the same words as the note).
  if (known && rec.uneasy) {
    const g = (state?.creatures?.[sp]?.groups ?? []).find((/** @type {any} */ x) => x.uneasy !== undefined);
    const U = rec.uneasy;
    const text = g ? ((state?.seasons?.index === 1 && U[`${g.why}Summer`]) || U[g.why] || U.habitat) : '';
    if (text) status = status ? `${status} ${text}` : text;
  }
  const likeKnown = knownLines(k, rec.likes);
  const likes = (rec.likes ?? []).map((/** @type {any} */ l, /** @type {number} */ i) => ({ text: l.text, known: likeKnown[i] }));
  const fieldKnown = knownLines(k, rec.field);
  const field = (rec.field ?? []).map((/** @type {any} */ l, /** @type {number} */ i) => ({ text: l.text, known: fieldKnown[i] }));
  const seasons = [0, 1, 2, 3].map((i) => {
    const bits = k?.seasons[i] ?? 0;
    const S = rec.seasons ?? {};
    const text = bits & FLOWER && S.flower ? S.flower : bits & DORMANT && S.dormant ? S.dormant : bits ? S.grow?.[i] ?? '' : null;
    return { name: words.seasonNames[i], text };
  });
  const list = words.moments[momentKind(rec)];
  const moments = list.map((/** @type {any} */ x) => {
    const at = k?.moments?.[x.id];
    return { id: x.id, label: x.label, date: at === undefined ? null : dateOfHour(at, words) };
  });
  const gives = (rec.gives ?? []).map((/** @type {any} */ g) => {
    const inked = journal.flags.includes(g.when);
    return { text: inked ? g.ink : g.pencil, known: inked };
  });
  const story = known && k ? storyOf(k, rec, m, hour, journal, words) : [];
  const notes = journal.notes.filter((n) => n.sp === sp).slice(0, words.pageNotes);
  // An animal not yet found: the latest hint the island has given, else its riddle.
  let riddle = rec.riddle;
  for (const h of rec.hints ?? []) if (journal.flags.includes(h.when)) riddle = h.text;
  // The ones you have named (S6c-3), oldest first: "Pip, here since Spring, day 4".
  // A named turtle (bonds.js) is dated from the day you named it.
  const named = known && rec.trust?.namedLine
    ? [...(state?.creatures?.[sp]?.frogs ?? []).filter((/** @type {any} */ f) => f.name).map((/** @type {any} */ f) => ({ name: f.name, at: f.since })),
      ...namedTurtles(sp === 'turtles' ? state?.creatures?.turtles : null).map((b) => ({ name: b.name, at: b.namedAt })),
      ...(sp === 'hens' ? namedHen(state) : [])]
      .map((f) => rec.trust.namedLine.replace('{name}', f.name).replace('{date}', dateOfHour(f.at ?? 0, words)))
    : [];
  // A collection (shells): the ones found, in the recipe's order, and pencil hints for the rest.
  const collection = (rec.collection ?? []).map((/** @type {any} */ c) => {
    const got = !!k?.learned.includes(`item:${c.id}`);
    return { id: c.id, found: got, name: got ? c.name : null, rarity: c.rarity, text: got ? c.line : c.hint };
  });
  return { sp, kind: 'living', name: rec.name, icon: rec.icon, known, riddle, status, likes, field, named, collection,
    fieldHint: rec.fieldHint, story, seasons, moments, gives, notes, canShow: known && present(rec, m), sketch: sketchOf(k, known, rec.sketch) };
}

/** Which moments list a page uses. @param {any} rec words.species[sp] */
export const momentKind = (rec) => (isAnimal(rec) || rec.kind === 'find' ? 'creature' : rec.kind === 'cover' ? 'cover' : 'plant');

/**
 * The card for one frog (a tap on it, or Show me): how well it knows you as a word (S6c), and a line
 * that goes with the word.
 * @param {{ x: number, z: number, id?: number }} f @param {any} state @param {any} words
 * @param {any} [presence] recipes/species/frog.json presence (its trust bands)
 */
export function frogCard(f, state, words, presence) {
  const rec = words.species.frogs;
  const asleep = !!state?.creatures?.frogs?.dormant;
  const all = state?.creatures?.frogs?.frogs ?? [];
  const frog = all.find((/** @type {any} */ g) => g.id === f.id);
  const T = rec.trust;
  const w = frog && presence && T ? trustWord(frog.trust ?? 0, presence.bands) : null;
  // Names (S6c-3): a named frog goes by its name, with what it is and since when; a frog that
  // knows you well enough can be named, with a few names to suggest that no other frog has.
  const sub = frog?.name ? T?.since?.replace('{card}', rec.card).replace('{date}', dateOfHour(frog.since, words)) ?? rec.card : null;
  const canName = !!frog && !frog.name && !asleep && !!presence && (frog.trust ?? 0) >= presence.namingTrust;
  const taken = new Set(all.map((/** @type {any} */ g) => g.name).filter(Boolean));
  const pool = (T?.names ?? []).filter((/** @type {string} */ n) => !taken.has(n));
  const start = pool.length ? (frog?.id ?? 0) % pool.length : 0;
  return { sp: 'frogs', name: frog?.name ?? rec.card, sub, icon: rec.icon, text: w && !asleep ? T.lines[w] : rec.stages[asleep ? 1 : 0],
    word: w ? T.words[w] : null, id: f.id ?? null, canName, suggest: canName ? [...pool.slice(start), ...pool.slice(0, start)] : [],
    wx: f.x, wz: f.z, r: words.identify.grassRingM, stage: -1 };
}

/**
 * The card for one turtle (a tap on it): how well it knows you as a word, its group's and its own
 * (bonds.js), and, once that reaches presence.namingTrust, a name to give it, as a frog's.
 * @param {{ x: number, z: number, id: number }} t the turtle tapped (id: group x 1000 + its place)
 * @param {any} state @param {any} words @param {any} [presence] recipes/species/turtle.json presence
 */
export function turtleCard(t, state, words, presence) {
  const rec = words.species.turtles;
  const S = state?.creatures?.turtles;
  const asleep = !!S?.dormant;
  const T = rec.trust;
  const b = bondOf(S, t.id);
  const trust = presence ? turtleTrust(S, t.id, presence) : 0;
  const w = presence?.bands && T?.words ? trustWord(trust, presence.bands) : null;
  const sub = b?.name ? T?.since?.replace('{card}', rec.card).replace('{date}', dateOfHour(b.namedAt ?? 0, words)) ?? rec.card : null;
  const canName = !b?.name && !asleep && !!presence?.namingTrust && trust >= presence.namingTrust;
  const taken = new Set(namedTurtles(S).map((x) => x.name));
  const pool = (T?.names ?? []).filter((/** @type {string} */ n) => !taken.has(n));
  const start = pool.length ? t.id % pool.length : 0;
  return { sp: 'turtles', name: b?.name ?? rec.card, sub, icon: rec.icon, text: w && !asleep ? T.lines?.[w] ?? rec.stages[0] : rec.stages[asleep ? 1 : 0],
    word: w ? T.words[w] : null, id: t.id, canName, suggest: canName ? [...pool.slice(start), ...pool.slice(0, start)] : [],
    wx: t.x, wz: t.z, r: 0.5, stage: -1 };
}

/**
 * The plant nearest a tapped ground point, within words.identify.radiusM (or its species' own tapM), or the cover plant (grass,
 * rushes) where it grows.
 * @param {any} state @param {any} hab @param {number} x @param {number} z @param {any} words
 * @returns {{ sp: string, name: string, icon: string, text: string, wx: number, wz: number, r: number, stage: number } | null}
 *   wx, wz, r: where to ring the selection on the ground (the plant's middle, or the tap on grass)
 */
export function identify(state, hab, x, z, words) {
  const I = words.identify;
  // Nearest by the share of each species' reach (a shrub's tapM is wider, for its crown).
  let best = null, bestD = 1;
  for (const p of state?.growth?.plants ?? []) {
    const rec = words.species[p.sp];
    if (!rec) continue;
    const r = rec.tapM ?? I.radiusM;
    const d = ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)) / (r * r);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) return plantCard(best, words);
  // Else the cover plant (grass, rushes) that fills most of the tapped square, if any holds it.
  const c = habitatCell(x, z);
  if (!hab || c < 0) return null;
  let cover = null, most = COVER_HAS;
  for (const sp of words.order) {
    if (words.species[sp]?.kind !== 'cover') continue;
    const s = coverShare(sp, state, hab, c);
    if (s > most) { most = s; cover = sp; }
  }
  if (!cover) return null;
  const rec = words.species[cover];
  return { sp: cover, name: rec.name, icon: rec.icon, text: rec.stages[0], wx: x, wz: z, r: I.grassRingM, stage: -1 };
}

/** The card for one plant. @param {any} p @param {any} words */
function plantCard(p, words) {
  const rec = words.species[p.sp];
  return { sp: p.sp, name: rec.name, icon: rec.icon, text: rec.stages?.[p.stage] ?? rec.name,
    wx: p.x, wz: p.z, r: (rec.ringM ?? words.identify.ringM) * (0.6 + 0.4 * Math.max(0, Math.min(1, p.size))), stage: p.stage };
}

/**
 * What a page's Show me rings: the plant of the species nearest `near` (the middle of your view;
 * ties go to the larger, then older, then first planted), or for a cover plant (grass, rushes) the
 * covered square nearest it. Without `near`, the finest plant, or the cover nearest the island's
 * middle. With its card.
 * @param {string} sp @param {any} state @param {any} hab @param {any} words
 * @param {number[] | null} [near] a world point [x, z]
 */
export function showMeSpot(sp, state, hab, words, near = null) {
  const rec = words.species[sp];
  if (!rec) return null;
  if (rec.spring) {
    // Spring's lives (frogspawn's clumps, the toad on its walk; src/world/creatures/spring.js): the
    // one nearest the middle of your view. The toad's ring takes in its whole walk.
    const from = near ? { x: near[0], z: near[1] } : hab ? islandShape(hab) : { x: 0, z: 0 };
    let best = null, bestD = Infinity;
    for (const p of springSpots(sp, state)) {
      const d = Math.round(((p.x - from.x) ** 2 + (p.z - from.z) ** 2) * 100);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return null;
    return { sp, name: rec.card ?? rec.name, icon: rec.icon, text: rec.cardLine ?? '', wx: best.x, wz: best.z, r: best.r ?? rec.ringM ?? words.identify.ringM, stage: -1 };
  }
  if (isAnimal(rec)) {
    // The frog, or the midge cloud's square, nearest the middle of your view.
    const m = measure(sp, state, hab, rec);
    const list = rec.kind === 'swarm' ? m.spots ?? [] : m.plants;
    const from = near ? { x: near[0], z: near[1] } : hab ? islandShape(hab) : { x: 0, z: 0 };
    let best = null, bestD = Infinity;
    for (const p of list) {
      const d = Math.round(((p.x - from.x) ** 2 + (p.z - from.z) ** 2) * 100);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return null;
    if (rec.kind === 'creature') return frogCard(best, state, words);
    if (rec.kind === 'hen') return henCard(best, state, words);
    return { sp, name: rec.name, icon: rec.icon, text: rec.stages[0], wx: best.x, wz: best.z, r: words.identify.ringM, stage: -1 };
  }
  if (rec.kind === 'cover') {
    if (!hab || !hasCover(sp, state)) return null;
    const isl = near ? { x: near[0], z: near[1] } : islandShape(hab);
    // Grass is shown on dry ground; rushes stand in the shallows too.
    const dryOnly = rec.amountBy !== 'area';
    let best = -1, bestD = Infinity;
    // Cover counts only on open squares (coverShare): the opened island's box, in grid order.
    const B = openBox(hab);
    for (let j = B.j0; j <= B.j1; j++) for (let k = j * hab.n + B.i0; k <= j * hab.n + B.i1; k++) {
      if ((dryOnly && hab.depthCm[k] > 0) || coverShare(sp, state, hab, k) <= COVER_FULL) continue;
      const x = HABITAT_ORIGIN + (k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5;
      const d = (x - isl.x) ** 2 + (z - isl.z) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) return null;
    const x = HABITAT_ORIGIN + (best % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(best / hab.n) + 0.5;
    return { sp, name: rec.name, icon: rec.icon, text: rec.stages[0], wx: x, wz: z, r: words.identify.grassRingM, stage: -1 };
  }
  let best = null, bestD = Infinity;
  for (const p of state?.growth?.plants ?? []) {
    if (p.sp !== sp) continue;
    const d = near ? Math.round(((p.x - near[0]) ** 2 + (p.z - near[1]) ** 2) * 100) : 0;   // cm² steps, so ties are real
    if (!best || d < bestD || (d === bestD && (p.size > best.size || (p.size === best.size && (p.age > best.age || (p.age === best.age && p.id < best.id)))))) { best = p; bestD = d; }
  }
  return best ? plantCard(best, words) : null;
}
