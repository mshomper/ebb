// @ts-check
// Extra chord tests (doc 24): chordTones and pitchClasses from src/audio/music/chords.js.
// Run on tools/unit-tests-audio.html, and in Node with tools/run-tests.mjs.

import { parseChord, chordTones, pitchClasses } from '../src/audio/music/chords.js';

const CH = 'music: chord tones';
/** @param {any} a */
const js = (a) => JSON.stringify(a);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addChordExtraTests(test, assert, eq) {
  test(CH, 'chordTones stacks the intervals on a root MIDI note', () => {
    eq(js(chordTones(parseChord('Dmaj9'), 50)), js([50, 54, 57, 61, 64]));
    eq(js(chordTones(parseChord('Am7'), 57)), js([57, 60, 64, 67]));
    eq(js(chordTones(parseChord('C5'), 48)), js([48, 55]));
  });

  test(CH, 'chordTones leaves the slash bass to the voicing', () => {
    eq(js(chordTones(parseChord('G/B'), 55)), js([55, 59, 62]));
  });

  test(CH, 'chordTones and pitchClasses give nothing for no chord or nonsense', () => {
    eq(js(chordTones(parseChord('N.C.'), 60)), js([]));
    eq(js(chordTones(parseChord('Cfoo'), 60)), js([]));
    eq(js(pitchClasses(parseChord('N.C.'))), js([]));
    eq(js(pitchClasses(null)), js([]));
  });

  test(CH, 'pitchClasses are distinct, sorted and wrap past B', () => {
    eq(js(pitchClasses(parseChord('Bb'))), js([2, 5, 10]));
    eq(js(pitchClasses(parseChord('Cmaj9'))), js([0, 2, 4, 7, 11]));
    eq(js(pitchClasses(parseChord('A7b9'))), js([1, 4, 7, 9, 10]));
  });

  test(CH, 'pitchClasses include a slash bass, once', () => {
    eq(js(pitchClasses(parseChord('Am/G'))), js([0, 4, 7, 9]));
    eq(js(pitchClasses(parseChord('C/E'))), js([0, 4, 7]));
    assert(pitchClasses(parseChord('D/F#')).includes(6), 'F# in D/F#');
  });
}
