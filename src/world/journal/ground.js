// @ts-check
// The ground in the field journal (docs 13, 15): what a tap on bare ground or water says, the
// Ground pages (soil, sand, rock, moss, fresh water, shore and sea), and where a Ground page's
// Show me goes. Reads the habitat grid (water, moisture, salt, tide band) and the terrain's painted
// materials (grass, sand, rock, soil per 0.25 m texel; terrain/brushes.js LAYER_INDEX). Pure; words
// from recipes/world/journal-island.json ("island").

import { HABITAT_ORIGIN, habitatCell } from '../growth/habitat.js';
import { WORLD_CELLS, WORLD_ORIGIN, CELL } from '../terrain/grid.js';
import { suitability } from '../growth/coarse.js';
import { knownLines, dateOfHour, sketchOf } from './observe.js';
import { amountOf } from './describe.js';

/** Painted weights 0..255 at a world point: [grass, sand, rock, soil], or null off the window. @param {Uint8Array | null} material @param {number} x @param {number} z */
function paintAt(material, x, z) {
  if (!material) return null;
  const i = Math.floor((x - WORLD_ORIGIN) / CELL), j = Math.floor((z - WORLD_ORIGIN) / CELL);
  if (i < 0 || j < 0 || i >= WORLD_CELLS || j >= WORLD_CELLS) return null;
  const o = (j * WORLD_CELLS + i) * 4;
  return [material[o], material[o + 1], material[o + 2], material[o + 3]];
}

/**
 * The kind of ground at a point: 'sea', 'band', 'fresh', 'moss', 'sand', 'rock', 'soil' or 'grass'
 * (painted grass), or null outside the opened island.
 * @param {any} hab @param {Uint8Array | null} material @param {number} x @param {number} z @param {any} island
 */
export function groundKind(hab, material, x, z, island) {
  const k = habitatCell(x, z);
  if (!hab || k < 0 || !hab.open[k]) return null;
  if (hab.sea[k]) return 'sea';
  if (hab.depthCm[k] > 0) return 'fresh';
  if (hab.band?.[k]) return 'band';
  const kind = paintedKind(material, x, z);
  // Moss grows over any damp, fresh ground but sand (the live moss, growth/moss-live.js).
  const mossy = hab.moisture[k] / 255 >= island.mossMoisture && hab.salt[k] / 255 < island.mossSalt;
  if (mossy && kind !== 'sand') return 'moss';
  return kind;
}

/** The painted layer with the most weight at a point: 'grass', 'sand', 'rock' or 'soil'. @param {Uint8Array | null} material @param {number} x @param {number} z */
function paintedKind(material, x, z) {
  const w = paintAt(material, x, z) ?? [0, 0, 0, 255];
  return ['grass', 'sand', 'rock', 'soil'][w.indexOf(Math.max(w[0], w[1], w[2], w[3]))];
}

/** The Ground page a kind of ground belongs to. @param {string} kind */
export const pageOf = (kind) => (kind === 'sea' || kind === 'band' ? 'shore' : kind === 'grass' ? 'soil' : kind);

/** The words of a ladder of [at least, words] steps, from the top. @param {[number, string][]} ladder @param {number} v */
function stepOf(ladder, v) {
  for (const [at, t] of ladder) if (v >= at) return t;
  return ladder[ladder.length - 1][1];
}

/**
 * The card a tap on the ground opens: what the ground is like, and which plants you know would
 * like it (a pencil line when one you have not met would).
 * @param {string} kind groundKind() @param {any} hab @param {number} x @param {number} z
 * @param {{ island: any, flora: Record<string, any>, journal: import('./observe.js').Journal, words: any }} ctx
 */
export function groundCard(kind, hab, x, z, ctx) {
  const { island, flora, journal, words } = ctx;
  const id = pageOf(kind);
  const g = island.ground[id];
  const k = habitatCell(x, z);
  let text;
  if (kind === 'sea') text = island.water.sea;
  else if (kind === 'band') text = island.water.band;
  else if (kind === 'fresh') {
    const depth = hab.depthCm[k] / 100;
    const d = island.depth.find((/** @type {[number, string]} */ s) => depth < s[0])?.[1] ?? island.depth[island.depth.length - 1][1];
    text = `${d}, ${hab.still[k] ? island.water.still : island.water.moving}.`;
  } else {
    const noun = kind === 'grass' ? island.ground.soil.tap : g.tap;
    text = `${stepOf(island.wet, hab.moisture[k] / 255)} ${noun}${stepOf(island.salt, hab.salt[k] / 255)}.`;
  }
  /** @type {string[]} */ const knownNames = [];
  let unknown = false;
  if (kind !== 'sea') {
    for (const sp of words.order) {
      const rec = flora[sp];
      if (!rec?.habitat) continue;
      if (suitability(rec, hab, x, z).suit < island.suitAt) continue;
      if (journal.species[sp]?.ever) knownNames.push(words.species[sp]?.name ?? rec.name);
      else unknown = true;
    }
  }
  const suits = knownNames.length ? island.suits.replace('{names}', knownNames.join(', ')) : island.suitsNone;
  return { sp: id, name: g.name, icon: g.icon, text, suits, suitsPencil: unknown ? island.unknown : null,
    wx: x, wz: z, r: words.identify.grassRingM, stage: -1, ground: true };
}

/**
 * The island's ground, square meter by square meter: how many cells of each Ground page, and the
 * plants growing on each. Cached per habitat, growth state and paint version.
 * @param {any} hab @param {Uint8Array | null} material @param {any} state @param {any} island @param {number} [paintVersion]
 */
export function groundSurvey(hab, material, state, island, paintVersion = 0) {
  const key = `${hab?.hash}|${paintVersion}`;
  if (cache && cache.hab === hab && cache.growth === state?.growth && cache.key === key) return cache.survey;
  /** @type {Record<string, { cells: number, plants: Record<string, number>, sx: number, sz: number }>} */
  const by = {};
  for (const id of island.groundOrder) by[id] = { cells: 0, plants: {}, sx: 0, sz: 0 };
  let land = 0, stream = 0, mossOnRock = 0;
  /**
   * The Ground pages a square counts toward: grass-painted land toward none (it has its own page
   * under Living things), the sea toward none (only its band), and a sandy tide band toward both
   * the shore and sand.
   * @param {string | null} kind @param {number} x @param {number} z
   */
  const pagesOf = (kind, x, z) => {
    if (!kind || kind === 'sea' || kind === 'grass') return [];
    if (kind === 'band') return paintedKind(material, x, z) === 'sand' ? ['shore', 'sand'] : ['shore'];
    return by[kind] ? [kind] : [];
  };
  if (hab) {
    for (let k = 0; k < hab.n * hab.n; k++) {
      if (!hab.open[k]) continue;
      const x = HABITAT_ORIGIN + (k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5;
      const kind = groundKind(hab, material, x, z, island);
      if (!kind) continue;
      if (kind !== 'sea' && kind !== 'fresh') land++;
      if (kind === 'fresh' && !hab.still[k]) stream++;
      if (kind === 'moss' && paintedKind(material, x, z) === 'rock') mossOnRock++;
      for (const id of pagesOf(kind, x, z)) {
        const b = by[id];
        b.cells++; b.sx += x; b.sz += z;
      }
    }
    // A plant on grass-painted ground grows in the soil under the grass.
    for (const p of state?.growth?.plants ?? []) {
      const kind = groundKind(hab, material, p.x, p.z, island);
      for (const id of kind === 'grass' ? ['soil'] : pagesOf(kind, p.x, p.z)) by[id].plants[p.sp] = (by[id].plants[p.sp] ?? 0) + 1;
    }
  }
  const survey = { by, land, stream, mossOnRock };
  cache = { hab, growth: state?.growth, key, survey };
  return survey;
}
/** @type {{ hab: any, growth: any, key: string, survey: any } | null} */
let cache = null;

/**
 * Everything a Ground page shows, in words.
 * @param {import('./observe.js').Journal} journal @param {string} id a Ground page @param {any} survey groundSurvey()
 * @param {any} island @param {any} words
 */
export function describeGround(journal, id, survey, island, words) {
  const g = island.ground[id];
  const b = survey.by[id] ?? { cells: 0, plants: {} };
  const value = g.measure === 'share' ? (survey.land ? b.cells / survey.land : 0) : b.cells;
  let status = amountOf(g.amount, value);
  if (id === 'fresh' && survey.stream > 0 && g.stream) status = `${status} ${g.stream}`;
  const k = journal.species[id];
  // The ground is known as soon as it is on the island; the rest is learned like a plant's.
  const learned = { learned: [...(k?.learned ?? []), ...(b.cells > 0 ? ['seen'] : [])] };
  const fieldKnown = knownLines(/** @type {any} */ (learned), g.field);
  const field = (g.field ?? []).map((/** @type {any} */ l, /** @type {number} */ i) => ({ text: l.text, known: fieldKnown[i] }));
  const grows = Object.entries(b.plants)
    .filter(([sp]) => journal.species[sp]?.ever && words.species[sp])
    .sort((p, q) => q[1] - p[1])
    .map(([sp]) => words.species[sp].name);
  const moments = words.moments.ground.map((/** @type {any} */ x) => {
    const at = k?.moments?.[x.id];
    return { id: x.id, label: x.label, date: at === undefined ? null : dateOfHour(at, words) };
  });
  const notes = journal.notes.filter((n) => n.sp === id).slice(0, words.pageNotes);
  return { sp: id, kind: 'ground', name: g.name, icon: g.icon, known: true, status, grows, field, fieldHint: g.fieldHint,
    moments, notes, canShow: b.cells > 0, sketch: sketchOf(learned, true, g.sketch) };
}

/**
 * What a Ground page's Show me rings: the square of that ground nearest `near` (the middle of your
 * view), or without it the square nearest the middle of all of it.
 * @param {string} id @param {any} hab @param {Uint8Array | null} material @param {any} survey @param {any} island
 * @param {number[] | null} [near] a world point [x, z]
 * @returns {{ x: number, z: number, kind: string } | null} the point and its kind, for groundCard()
 */
export function groundSpot(id, hab, material, survey, island, near = null) {
  const b = survey.by[id];
  if (!b || !b.cells || !hab) return null;
  const cx = near ? near[0] : b.sx / b.cells, cz = near ? near[1] : b.sz / b.cells;
  let best = null, bestD = Infinity;
  for (let k = 0; k < hab.n * hab.n; k++) {
    if (!hab.open[k]) continue;
    const x = HABITAT_ORIGIN + (k % hab.n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5;
    const kind = groundKind(hab, material, x, z, island);
    if (!kind || kind === 'sea' || kind === 'grass') continue;
    if (pageOf(kind) !== id && !(id === 'sand' && kind === 'band' && paintedKind(material, x, z) === 'sand')) continue;
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    if (d < bestD) { bestD = d; best = { x, z, kind }; }
  }
  return best;
}
