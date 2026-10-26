// @ts-check
// The walker's sketchbook, pure (docs/future/13 P2i I5; the sketchbook brief). Each subject (a
// creature, a plant or a find, by its journal id) fills in stages as the walker sketches it again:
//   1  the first sketch                               the Rough drawing (<art>-1)
//   2  sketched again on a later game day             the Shading study (<art>-2)
//   3  sketched while something is happening          the Detail study (<art>-3)
//      (a journal moment: rain, mist, dusk or dawn, a plant in flower)
//   4  sketched in another season                     a moment drawing (<art>-m-<moment>) when one exists
// A sketch that brings no new stage joins the page's loose sheets (the last few kept), and every
// sketch makes the book more confident. The charcoal sticks wear: one handful for every wearPer
// sketches. The save's `sketchbook` section: { version, made, wear, first, subjects: { id: [entry] } }.
// No picture is stored, only these small records, so every device draws the same page.

/**
 * @typedef {{ stage: number, hour: number, season: number, moment: string | null }} Sketch
 *   stage: 1 to 4, or 0 for a loose sheet; hour: game hour sketched; season: 0 spring .. 3 winter;
 *   moment: what was happening (a journal moment id), or null
 * @typedef {{ version: number, made: number, wear: number, first: number | null, subjects: Record<string, Sketch[]> }} Book
 * @typedef {{ wearPer: number, loose: number, fullConfidence: number }} BookRecipe recipes/world/sketchbook.json
 */

/** @returns {Book} */
export const emptyBook = () => ({ version: 1, made: 0, wear: 0, first: null, subjects: {} });

/** A saved sketchbook section made safe; a missing one is an empty book. @param {any} v @returns {Book} */
export function cleanBook(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyBook();
  const n = (/** @type {any} */ x, /** @type {number} */ d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  /** @type {Record<string, Sketch[]>} */ const subjects = {};
  for (const [id, list] of Object.entries(v.subjects && typeof v.subjects === 'object' ? v.subjects : {})) {
    if (!Array.isArray(list)) continue;
    const ok = list.filter((s) => s && Number.isInteger(s.stage) && s.stage >= 0 && s.stage <= 4)
      .map((s) => ({ stage: s.stage, hour: n(s.hour, 0), season: Math.max(0, Math.min(3, Math.round(n(s.season, 0)))), moment: typeof s.moment === 'string' ? s.moment : null }));
    if (ok.length) subjects[id] = ok;
  }
  return { version: 1, made: Math.max(0, Math.round(n(v.made, 0))), wear: Math.max(0, Math.round(n(v.wear, 0))), first: Number.isFinite(v.first) ? v.first : null, subjects };
}

/** The highest stage a subject has reached (0: never sketched). @param {Book} b @param {string} id */
export const stageOf = (b, id) => Math.max(0, ...(b.subjects[id] ?? []).map((s) => s.stage));

/**
 * The stage a sketch now would bring (0: none new, a loose sheet). A later game day is by the
 * newest drawn stage's day; another season is one no drawn stage was made in.
 * @param {Book} b @param {string} id @param {{ hour: number, season: number, moment: string | null }} at
 */
export function stageFor(b, id, at) {
  const drawn = (b.subjects[id] ?? []).filter((s) => s.stage > 0);
  const top = stageOf(b, id);
  if (top === 0) return 1;
  const newest = drawn.reduce((m, s) => Math.max(m, s.hour), -Infinity);
  if (top === 1) return Math.floor(at.hour / 24) > Math.floor(newest / 24) ? 2 : 0;
  if (top === 2) return at.moment ? 3 : 0;
  if (top === 3) return drawn.some((s) => s.season === at.season) ? 0 : 4;
  return 0;
}

/**
 * A sketch made: its stage (or a loose sheet), the book's count, the sticks' wear. wornHandful says
 * a handful of charcoal sticks is used up by this sketch.
 * @param {Book} b @param {string} id @param {{ hour: number, season: number, moment: string | null }} at @param {BookRecipe} R
 * @returns {{ book: Book, stage: number, wornHandful: boolean }}
 */
export function addSketch(b, id, at, R) {
  const stage = stageFor(b, id, at);
  const entry = { stage, hour: at.hour, season: at.season, moment: at.moment };
  const list = [...(b.subjects[id] ?? []), entry];
  // Loose sheets: only the last few are kept.
  const loose = list.filter((s) => s.stage === 0);
  const keep = stage === 0 && loose.length > R.loose ? list.filter((s) => s !== loose[0]) : list;
  const wear = b.wear + 1, worn = wear >= R.wearPer;
  return { book: { ...b, made: b.made + 1, wear: worn ? 0 : wear, first: b.first ?? at.hour, subjects: { ...b.subjects, [id]: keep } }, stage, wornHandful: worn };
}

/** How sure the book's hand is now, 0..1: from how many sketches it holds, never shown. @param {Book} b @param {BookRecipe} R */
export const confidence = (b, R) => Math.min(1, b.made / Math.max(1, R.fullConfidence));

/**
 * The drawings a page shows, newest stage first: art file names that exist (the manifest), each
 * with its stage. A stage whose drawing is not made yet is left out (the page stays blank paper).
 * @param {Book} b @param {string} id @param {string} art the art id (sketchbook.json art aliases)
 * @param {Record<string, string[]>} manifest assets/sketches/manifest.json art
 * @returns {{ stage: number, file: string }[]}
 */
export function pageDrawings(b, id, art, manifest) {
  const have = new Set(manifest[art] ?? []);
  /** @type {{ stage: number, file: string }[]} */ const out = [];
  for (const s of (b.subjects[id] ?? []).filter((q) => q.stage > 0)) {
    const tier = s.stage === 4 && s.moment ? `m-${s.moment}` : String(Math.min(3, s.stage));
    if (have.has(tier) && !out.some((o) => o.file === `${art}-${tier}`)) out.push({ stage: s.stage, file: `${art}-${tier}` });
  }
  return out.sort((p, q) => q.stage - p.stage);
}
