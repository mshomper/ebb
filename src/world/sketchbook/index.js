// @ts-check
// The walker's sketchbook, live (docs/future/13 P2i I5). With charcoal sticks in the pack and a
// creature, plant or find within reach and near the middle of the view, Sketch joins the here-bar
// ("Sketch the frog"). The walker sits and draws for a few seconds; sitting still is calm presence,
// so sketching never startles anything. Going up, or walking off, stops it gently and nothing is
// used. Then the subject's page gains a stage (model.js) or a loose sheet, and every wearPer sketches
// a handful of the sticks is worn away. Keeps the store slice `sketchbook` (the save's section).
// Emits sketch:made { id, stage }. Answers sketch.begin.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { onAction } from '../../input/actions.js';
import { offerHere, withdrawHere } from '../../ui/ground-here.js';
import { cleanBook, addSketch } from './model.js';

/**
 * @param {{ recipe: any, walk: any, pack: any, worldT: () => number, season: () => number,
 *   weather: () => { rain: number, mist: number }, subject: () => { id: string, name: string, x: number, z: number } | null }} o
 *   recipe: recipes/world/sketchbook.json; subject: the creature, plant or find nearest the middle of
 *   the view within reach (app.js samples the view through the journal's cards), or null
 */
export function createSketchbook(o) {
  const R = o.recipe, W = R.words;
  update('sketchbook', (v) => cleanBook(v));
  const STICKS = 'charcoal-sticks';
  /** The sketch being drawn: its subject, where you sat, and how long so far. @type {{ id: string, name: string, x: number, z: number, at: number[], t: number } | null} */
  let drawing = null;
  /** @type {{ id: string, name: string, x: number, z: number } | null} */ let subject = null;
  let offerT = 0;

  /** What is happening now that counts as a moment for stage 3 (recipe moments), or null. */
  function momentNow() {
    const M = R.moments, w = o.weather(), h = ((o.worldT() / 3600) % 24 + 24) % 24;
    if (w.rain >= M.rain) return 'rain';
    if (w.mist >= M.mist) return 'mist';
    if (h >= M.dusk[0] && h < M.dusk[1]) return 'dusk';
    if (h >= M.dawn[0] && h < M.dawn[1]) return 'dawn';
    return null;
  }

  function begin() {
    if (drawing || !subject || !o.pack.has(STICKS)) return;
    const you = o.walk.you();
    if (!you) return;
    if (o.walk.spot?.()?.posture !== 'sit') o.walk.posture('sit');
    drawing = { ...subject, at: [you[0], you[2]], t: 0 };
    withdrawHere('sketch');
  }

  /** The sketch done: the page, the sticks' wear, the line. */
  function finish() {
    const d = /** @type {NonNullable<typeof drawing>} */ (drawing);
    drawing = null;
    const r = addSketch(cleanBook(get('sketchbook')), d.id, { hour: o.worldT() / 3600, season: o.season(), moment: momentNow() }, R);
    update('sketchbook', () => r.book);
    if (r.wornHandful) o.pack.take(STICKS, 1);
    const text = !o.pack.has(STICKS) ? `${r.stage ? W.newPage : W.loose} ${W.noSticks}` : r.stage ? W.newPage : W.loose;
    emitDeferred('island:notice', { text, showS: 5 });
    emitDeferred('sketch:made', { id: d.id, stage: r.stage });
  }

  const off = onAction((/** @type {any} */ a) => { if (a.type === 'sketch.begin') begin(); });

  return {
    id: 'sketchbook',
    /** A sim system: each frame. @param {{ realDt: number }} f */
    tick(f) {
      if (drawing) {
        const you = o.walk.below ? o.walk.you() : null;
        // Up, or walked off: it stops, gently, and nothing is used.
        if (!you || Math.hypot(you[0] - drawing.at[0], you[2] - drawing.at[1]) > 0.4) { drawing = null; return; }
        if ((drawing.t += f.realDt) >= R.sketchS) finish();
        return;
      }
      if ((offerT -= f.realDt) > 0) return;
      offerT = R.offerEveryS ?? 0.3;
      subject = o.walk.below && !o.walk.busy() && o.pack.has(STICKS) ? o.subject() : null;
      if (subject) {
        const name = subject.name.charAt(0).toLowerCase() + subject.name.slice(1);
        offerHere({ id: 'sketch', icon: 'sketch', label: W.sketch.replace('{name}', name), order: 20, action: { type: 'sketch.begin' } });
      } else withdrawHere('sketch');
    },
    /** Is the walker drawing now (tests, the walker's look). */
    drawing: () => drawing,
    /** Tests and test links: sketch a subject at once, as finishing would. @param {{ id: string, name: string, x: number, z: number }} s */
    sketchNow(s) { drawing = { ...s, at: [0, 0], t: 0 }; finish(); },
    dispose() { off(); withdrawHere('sketch'); },
  };
}
