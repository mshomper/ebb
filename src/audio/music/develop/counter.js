// @ts-check
// The development engine, step 5 (doc 24, "counter"): a counter-line under a grown melody, the
// guitar's third job (Matt: strum, melody, then counter-harmony). It sings only in the answer
// phrases, one note a chord (two in a long 4/4 bar), on chord tones a third, sixth or tenth under
// the melody, mostly moving the other way, small steps, no parallel fifths or octaves with it, and
// it waits out the first bar now and then so it enters as an answer. Rules: develop.json
// melody.counter.
//
// Global eighths, MIDI notes (it may take a borrowed chord's tone). Pure and seeded.

/** @typedef {import('./motifs.js').MNote} MNote */
/** @typedef {import('./timeline.js').TEvent} TEvent */
/** @typedef {{t: number, d: number, midi: number}} CNote */

const SWEET = new Set([3, 4, 8, 9, 15, 16]);

/**
 * @param {MNote[]} mel global eighths, sorted
 * @param {{scale: {midi: (d: number) => number}, events: TEvent[], len: number, meter: string, phrases: {start: number, end: number, role: string}[]}} C
 * @param {any} R rules.melody.counter
 * @param {ReturnType<typeof import('../../../core/rng.js').stream>} r
 * @returns {CNote[]}
 */
export function counterLine(mel, C, R, r) {
  const [lo, hi] = R.register ?? [53, 69];
  const melAt = (/** @type {number} */ t) => {
    const n = mel.find((x) => x.t <= t && x.t + x.d > t) ?? mel.filter((x) => x.t <= t).pop();
    return n ? C.scale.midi(n.deg) : null;
  };
  /** @type {CNote[]} */
  const out = [];
  for (const ph of C.phrases) {
    if (!/answer/.test(ph.role)) continue;
    // Segments: each chord of the phrase, a long 4/4 chord split in two.
    /** @type {[number, number, TEvent][]} */
    const segs = [];
    const evs = C.events.filter((e, i) => e.t < ph.end && (i + 1 < C.events.length ? C.events[i + 1].t : Infinity) > ph.start);
    evs.forEach((e, i) => {
      const a = Math.max(ph.start, e.t), b = Math.min(ph.end, i + 1 < evs.length ? evs[i + 1].t : ph.end);
      if (b - a >= 2 * C.len && C.meter === '4/4') { segs.push([a, a + C.len, e], [a + C.len, b, e]); return; }
      if (b - a >= C.len && C.meter === '4/4') { const h = a + Math.round((b - a) / 2); segs.push([a, h, e], [h, b, e]); return; }
      if (b > a) segs.push([a, b, e]);
    });
    /** @type {number|null} */
    let prev = null;
    /** @type {number|null} */
    let prevMel = null;
    const late = r.next() < (R.enterLate ?? 0.5);
    segs.forEach(([a, b, e], si) => {
      if (late && a < ph.start + C.len) return;
      const m = melAt(a);
      if (m === null) return;
      const last = si === segs.length - 1;
      let best = -1, score = -Infinity;
      for (let x = lo; x <= hi; x++) {
        if (!e.pcs.includes(x % 12) || x > m - 3) continue;
        let s = SWEET.has(m - x) ? 2 : (m - x) % 12 === 0 || (m - x) % 12 === 7 ? -1 : 0;
        if (prev !== null) {
          const st = Math.abs(x - prev);
          s += st === 0 ? 0.3 : st <= 2 ? 1.5 : st <= 4 ? 0.6 : st > 7 ? -2 : 0;
          if (prevMel !== null && m !== prevMel) {
            const md = Math.sign(m - prevMel), cd = Math.sign(x - prev);
            if (cd === -md) s += 1.5;
            const was = (prevMel - prev) % 12, now = (m - x) % 12;
            if ((was === 0 || was === 7) && was === now && cd !== 0) s -= 4;
          }
        }
        if (x % 12 === e.bass && !last) s -= 0.4;
        if (last && x % 12 === e.root) s += 0.5;
        s += r.next() * 0.2;
        if (s > score) { score = s; best = x; }
      }
      if (best < 0) return;
      const d = last ? Math.max(1, b - a - (R.breath ?? 1)) : b - a;
      const tail = out[out.length - 1];
      // The same note on: held, not struck again.
      if (tail && tail.midi === best && tail.t + tail.d === a) tail.d += d;
      else out.push({ t: a, d, midi: best });
      prev = best; prevMel = m;
    });
  }
  return out;
}
