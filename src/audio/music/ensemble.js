// @ts-check
// A section of several sampled instruments played as one (doc 24, Instruments: "strings"). Each
// note goes to the part whose register it falls in (basses, then celli, violas, violins, split
// by the roster's "below" notes); a part that is missing, or has no recording within reach of the
// note, hands it to the next part up or down. It looks like one sampler to the rest of the music
// code: noteOn, noteOff, filesFor and loadFiles for per-piece unpacking, trim, stopAll, stats.

/** @typedef {import('./sampler.js').Sampler} Sampler */

/**
 * @param {{sampler: Sampler, below: number}[]} parts low to high; the last part's below is ignored
 */
export function createEnsemble(parts) {
  const ranges = parts.map((p) => {
    const z = /** @type {any[]} */ (Object.values(p.sampler.instrument.sets ?? {}).flatMap((s) => /** @type {any} */ (s).zones ?? []));
    const m = z.map((x) => x.midi);
    return { low: Math.min(...m) - 2, high: Math.max(...m) + 2 };
  });
  /** @type {Map<number, number>} which part each sounding key went to */
  const sounding = new Map();

  /** The part for a note: by the split points, then the nearest part that reaches it. @param {number} midi */
  function partFor(midi) {
    let i = parts.findIndex((p, k) => k === parts.length - 1 || midi < p.below);
    if (i < 0) i = parts.length - 1;
    if (midi >= ranges[i].low && midi <= ranges[i].high) return i;
    let best = i, dist = Infinity;
    ranges.forEach((r, k) => {
      const d = midi < r.low ? r.low - midi : midi > r.high ? midi - r.high : 0;
      if (d < dist) { dist = d; best = k; }
    });
    return best;
  }

  return {
    /** @param {number} midi @param {number} velocity @param {number} [when] */
    noteOn(midi, velocity, when) {
      const i = partFor(midi);
      sounding.set(midi, i);
      return parts[i].sampler.noteOn(midi, velocity, when);
    },
    /** @param {number} midi @param {number} [when] */
    noteOff(midi, when) {
      const i = sounding.get(midi);
      if (i !== undefined) parts[i].sampler.noteOff(midi, when);
    },
    /** Strings have no sustain pedal. */
    pedal() {},
    /** @param {number} midi @param {number} velocity @param {boolean} pedalDown */
    filesFor(midi, velocity, pedalDown) {
      const i = partFor(midi);
      return parts[i].sampler.filesFor(midi, velocity, pedalDown).map((f) => `${i}|${f}`);
    },
    /** @param {string[]} files */
    async loadFiles(files) {
      /** @type {Map<number, string[]>} */
      const by = new Map();
      for (const f of files) {
        const bar = f.indexOf('|');
        const i = Number(f.slice(0, bar));
        by.set(i, [...(by.get(i) ?? []), f.slice(bar + 1)]);
      }
      await Promise.all([...by].map(([i, fs]) => parts[i].sampler.loadFiles(fs)));
    },
    /** @param {{low?: number, high?: number}} [o] */
    async load(o = {}) {
      await Promise.all(parts.map((p, i) => p.sampler.load({ ...o, low: Math.max(o.low ?? 0, ranges[i].low), high: Math.min(o.high ?? 127, ranges[i].high) })));
    },
    /** @param {number} budgetMB @param {{low: number, high: number}[]} [protect] */
    trim(budgetMB, protect = []) {
      let n = 0;
      for (const p of parts) n += p.sampler.trim(budgetMB / parts.length, protect);
      return n;
    },
    /** @param {number} [fadeS] */
    stopAll(fadeS) { for (const p of parts) p.sampler.stopAll(fadeS); sounding.clear(); },
    stats() {
      const s = parts.map((p) => p.sampler.stats());
      return {
        voices: s.reduce((n, x) => n + x.voices, 0),
        files: s.reduce((n, x) => n + x.files, 0),
        decodedMB: s.reduce((n, x) => n + x.decodedMB, 0),
        downloadedMB: s.reduce((n, x) => n + x.downloadedMB, 0),
        format: s[0]?.format,
      };
    },
    /** The parts' recipes, low to high. */
    parts: parts.map((p) => p.sampler.instrument),
  };
}
