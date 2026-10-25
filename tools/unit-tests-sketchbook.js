// @ts-check
// Sketchbook tests (P2i I5): the stages a subject fills in (first sketch, a later day, a moment,
// another season), loose sheets kept to a few, the charcoal sticks' wear, the book's confidence, which
// drawings a page shows from the art manifest, and the save section round trip (an older save with
// no sketchbook reads as an empty book).

import { emptyBook, cleanBook, stageFor, addSketch, confidence, pageDrawings } from '../src/world/sketchbook/model.js';
import { clean9, empty9, SECTIONS9 } from '../src/save/migrate-format9.js';

const G = 'sketchbook';
const R = { wearPer: 3, loose: 3, fullConfidence: 40 };

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addSketchbookTests(test, assert, eq) {
  test(G, 'a subject fills in: first sketch, a later day, a moment, another season', () => {
    let b = emptyBook();
    const at = (/** @type {number} */ hour, /** @type {number} */ season, /** @type {string | null} */ moment) => ({ hour, season, moment });
    let r = addSketch(b, 'frogs', at(10, 0, null), R); b = r.book;
    eq(r.stage, 1, 'first sketch: stage 1');
    r = addSketch(b, 'frogs', at(15, 0, 'dusk'), R); b = r.book;
    eq(r.stage, 0, 'the same day: a loose sheet');
    r = addSketch(b, 'frogs', at(30, 0, null), R); b = r.book;
    eq(r.stage, 2, 'a later day: stage 2');
    eq(stageFor(b, 'frogs', at(31, 0, null)), 0, 'no moment: nothing new');
    r = addSketch(b, 'frogs', at(32, 0, 'rain'), R); b = r.book;
    eq(r.stage, 3, 'in the rain: stage 3');
    eq(stageFor(b, 'frogs', at(400, 0, null)), 0, 'the same season: nothing new');
    r = addSketch(b, 'frogs', at(400, 1, null), R); b = r.book;
    eq(r.stage, 4, 'another season: stage 4');
    eq(b.made, 5, 'five sketches made');
    eq(b.first, 10, 'the first page hour');
  });

  test(G, 'loose sheets are kept to a few; the sticks wear one handful a three sketches', () => {
    let b = emptyBook(), worn = 0;
    for (let i = 0; i < 9; i++) { const r = addSketch(b, 'lilies', { hour: 5 + i * 0.1, season: 0, moment: null }, R); b = r.book; if (r.wornHandful) worn++; }
    eq(b.subjects.lilies.filter((s) => s.stage === 0).length, 3, 'three loose sheets kept');
    eq(b.subjects.lilies.filter((s) => s.stage === 1).length, 1, 'the first drawing stays');
    eq(worn, 3, 'nine sketches wore three handfuls');
    eq(b.wear, 0, 'the wear counter starts again');
    assert(Math.abs(confidence(b, R) - 9 / 40) < 1e-9, 'confidence from the sketches made');
  });

  test(G, 'a page shows the drawings that exist, newest stage first; the rest stays blank paper', () => {
    let b = emptyBook();
    for (const [h, m] of /** @type {[number, string | null][]} */ ([[1, null], [30, null], [31, 'mist']])) b = addSketch(b, 'frogs', { hour: h, season: 0, moment: m }, R).book;
    const all = pageDrawings(b, 'frogs', 'frog', { frog: ['1', '2', '3'] });
    eq(all.map((d) => d.file).join(','), 'frog-3,frog-2,frog-1', 'newest first');
    eq(pageDrawings(b, 'frogs', 'frog', { frog: ['1'] }).length, 1, 'only the drawing made so far');
    eq(pageDrawings(b, 'frogs', 'frog', {}).length, 0, 'no drawings: blank paper');
  });

  test(G, 'the save section: cleaned, round trip, and missing reads as an empty book', () => {
    let b = emptyBook();
    b = addSketch(b, 'turtles', { hour: 3, season: 2, moment: null }, R).book;
    eq(JSON.stringify(cleanBook(JSON.parse(JSON.stringify(b)))), JSON.stringify(b), 'saved and loaded, the same');
    assert(SECTIONS9.includes('sketchbook'), 'written with the camp sections');
    eq(JSON.stringify(clean9('sketchbook', undefined)), JSON.stringify(emptyBook()), 'missing: an empty book');
    eq(JSON.stringify(empty9('sketchbook')), JSON.stringify(emptyBook()), 'a new island: an empty book');
    eq(Object.keys(cleanBook({ subjects: { x: [{ stage: 9 }], y: 'no' } }).subjects).length, 0, 'bad entries dropped');
  });
}
