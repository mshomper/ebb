// @ts-check
// Writes a grown piece as an ordinary piece file (doc 24, "Piece file"), so it plays through the same
// realizer as the authored anchors: one section per phrase plus a short coda, chord symbols on every
// bar, in the material's home key. In phase 4a the melody is rests, so only the harmony sounds (the
// left hand and the bed); phase 4b writes the melody into the same sections.

/** Bar length in eighth notes, per meter (the ABC unit is an eighth). */
const BAR_EIGHTHS = /** @type {Record<string, number>} */ ({ '3/4': 6, '4/4': 8, '6/8': 6, '2/4': 4, '9/8': 9 });

/**
 * One bar of ABC: chord symbols over rests (the melody line comes in 4b).
 * @param {import('./harmony.js').HChord[]} chords @param {number} len eighths @param {boolean} fermata
 */
function abcBar(chords, len, fermata) {
  if (chords.length === 1) return `"${chords[0].symbol}"${fermata ? '!fermata!' : ''}z${len}`;
  const first = Math.round(len * chords[1].at);
  return `"${chords[0].symbol}"z${first} "${chords[1].symbol}"z${len - first}`;
}

/** @param {string} meter @param {string} key @param {string} body */
const abc = (meter, key, body) => `X:1\nM:${meter}\nL:1/8\nK:${key}\nV:mel\n${body}\n`;

/**
 * @param {any} material
 * @param {{bars: import('./harmony.js').HBar[]}} walked
 * @param {import('./plan.js').PhrasePlan[]} plan
 * @param {{id: string, title: string, slot: string, weather: string, meter: string, tempo: [number, number], template: string, seed: number, report: any}} o
 * @returns {any} a piece, recipes/music/pieces/<id>.json shape, plus a 'grown' block for the lab
 */
export function writePiece(material, walked, plan, o) {
  const len = BAR_EIGHTHS[o.meter] ?? 8;
  /** @type {Record<string, any>} */
  const sections = {};
  /** @type {Record<string, string>} */
  const bed = {};
  const names = plan.map((_, i) => `p${i + 1}`);
  plan.forEach((ph, i) => {
    const bars = walked.bars.filter((b) => b.phrase === i);
    sections[names[i]] = { abc: abc(o.meter, material.home, bars.map((b) => abcBar(b.chords, len, false)).join(' | ') + ' |'), bars: bars.length };
    const rise = ph.tension[1] - ph.tension[0];
    bed[names[i]] = i === 0 ? 'in' : rise > 0.15 ? 'swell' : 'steady';
  });
  const coda = material.coda.map((/** @type {string} */ p, /** @type {number} */ k) => {
    const sym = material.chords[p].symbol;
    return k === material.coda.length - 1 ? `"${sym}"!fermata!z${len}` : `"${sym}"z${len}`;
  });
  sections.coda = { abc: abc(o.meter, material.home, coda.join(' | ') + ' |'), bars: material.coda.length };
  bed.coda = 'thin';

  return {
    id: o.id,
    title: o.title,
    version: 1,
    slots: [o.slot],
    seasons: [material.season],
    weather: [o.weather],
    requires: {},
    avoidWhen: {},
    keys: [material.home],
    mode: material.mode,
    meter: o.meter,
    tempo: o.tempo,
    palette: { melody: ['piano'], accomp: ['piano'], bed: ['strings', 'pad'] },
    layers: { bed: { style: 'warm', sections: bed } },
    form: { grammar: `${names.join(' ')} coda`, short: `${names[0]} coda`, optional: {} },
    sections,
    variation: { octave: [0], paraphrase: 0, ornament: 0, textures: { struck: 0.7, arpeggio: 0.2, roll: 0.1 } },
    notes: `Grown by the development engine (phase 4a, harmony only): the ${o.template} template, seed ${o.seed}.`,
    grown: { season: material.season, slot: o.slot, weather: o.weather, seed: o.seed, template: o.template, report: o.report },
  };
}
