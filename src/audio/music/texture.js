// @ts-check
// Left-hand textures (doc 24, Realizing a piece): how a generated accompaniment plays each chord.
// A pianist mostly strikes a chord's notes together. Some chords become an unhurried arpeggio in
// time, every note held under the pedal; now and then a chord is rolled quickly, close to the
// melody; rarely a choppier figure. Each phrase (section) picks a main texture and single chords
// vary from it, so a piece is never all one thing. Pure: numbers from recipes/music/realize.json
// "textures".

/** @typedef {{next(): number}} Rng */

/** @param {Record<string, number>} w @param {Rng} r @returns {string} */
function weighted(w, r) {
  const ks = Object.keys(w).filter((k) => w[k] > 0);
  const tot = ks.reduce((a, k) => a + w[k], 0);
  if (!tot) return 'struck';
  let x = r.next() * tot;
  for (const k of ks) { x -= w[k]; if (x < 0) return k; }
  return ks[ks.length - 1];
}

/** @param {Record<string, number>} w @param {string[]} keep */
const only = (w, keep) => Object.fromEntries(Object.entries(w).filter(([k]) => keep.includes(k)));

/**
 * The texture of every chord that needs a generated accompaniment.
 * @param {{section: number, first: boolean, last: boolean}[]} chords in order
 * @param {string[]} names the path's section names, by section index
 * @param {Record<string, number>} weights texture weights (the recipe's, or the piece's own)
 * @param {any} T recipes/music/realize.json textures
 * @param {Rng} r
 * @param {(texture: string) => boolean} fits false when a texture would break the day's density ceiling
 * @returns {string[]}
 */
export function planTextures(chords, names, weights, T, r, fits) {
  const ok = Object.fromEntries(Object.entries(weights).filter(([k]) => fits(k)));
  if (!Object.keys(ok).length) ok.struck = 1;
  /** @type {Record<number, string>} */
  const main = {};
  let prevName = '', prevMain = '';
  for (const si of [...new Set(chords.map((c) => c.section))]) {
    const name = names[si] ?? '';
    let w = name === 'coda' ? only(ok, T.coda) : { ...ok };
    // A repeat (A after A, or A' after A) usually takes a different main texture.
    if (prevMain && name.replace(/'+$/, '') === prevName.replace(/'+$/, '') && r.next() < T.varyRepeat) w = { ...w, [prevMain]: 0 };
    main[si] = weighted(Object.keys(w).length ? w : ok, r);
    prevName = name;
    prevMain = main[si];
  }
  return chords.map((c) => {
    const name = names[c.section] ?? '';
    if (c.last) return weighted(only(ok, name === 'coda' ? T.coda : T.cadence), r);
    if (r.next() < T.phraseMain) return main[c.section];
    const w = name === 'coda' ? only(ok, T.coda) : { ...ok };
    if (c.first && w.roll) w.roll *= T.phraseStartRollBoost;
    return weighted(w, r);
  });
}

/**
 * Play one chord in a texture.
 * @param {string} texture
 * @param {{tick: number, end: number, bass: number, upper: number[], Q: number, beatTicks: number, barTicks: number, compound: boolean, arpStep: number}} c
 * @param {(tick: number, dur: number, midi: number, voice: string, offsetMs?: number, velOffset?: number) => void} push
 * @param {any} T recipes/music/realize.json textures
 * @param {Rng} r
 */
export function playTexture(texture, c, push, T, r) {
  const { tick, end, bass, upper, Q } = c;
  const len = end - tick;
  const hold = Math.max(Q / 4, len - Q / 8);
  const held = (/** @type {number} */ t) => Math.max(Q / 4, end - t - Q / 8);
  if (texture === 'roll') {
    // Quick, close to the melody: landing with it, around it, or just after.
    const all = [bass, ...upper];
    const [a, b] = T.roll.stepMs;
    const s = a + r.next() * (b - a);
    const place = T.roll.place[Math.floor(r.next() * T.roll.place.length)];
    const start = place === 'before' ? -(all.length - 1) * s : place === 'centred' ? (-(all.length - 1) * s) / 2 : 0;
    all.forEach((m, k) => push(tick, hold, m, k ? 'acc' : 'bass', start + k * s, k ? -2 : 0));
  } else if (texture === 'arpeggio' && upper.length) {
    // In time with the meter, every note held to the chord's end under the pedal.
    push(tick, hold, bass, 'bass');
    const shape = T.arpeggio.shapes[Math.floor(r.next() * T.arpeggio.shapes.length)];
    const n = upper.length;
    const order = shape === 'up-down' && n > 2 ? [...upper.keys(), ...[...upper.keys()].slice(1, -1).reverse()] : [...upper.keys()];
    let k = 0;
    for (let t = tick + c.arpStep; t < end - c.arpStep / 4; t += c.arpStep, k++) {
      push(t, held(t), upper[order[k % order.length]], 'acc', 0, k === 0 ? -2 : T.arpeggio.velStep);
    }
  } else if (texture === 'bass-then-chord' && len > c.beatTicks) {
    push(tick, hold, bass, 'bass');
    for (const m of upper) push(tick + c.beatTicks, held(tick + c.beatTicks), m, 'acc', 0, -3);
  } else if (texture === 'broken' && upper.length) {
    // The choppier figure: short eighths, up and back.
    push(tick, hold, bass, 'bass');
    const order = upper.length > 2 ? [0, 1, 2, 1] : [0, 1];
    let k = 0;
    for (let t = tick + Q / 2; t < end; t += Q / 2, k++) push(t, (Q / 2) * 0.95, upper[Math.min(order[k % order.length], upper.length - 1)], 'acc', 0, -6);
  } else if (texture === 'offbeat-dyads' && upper.length) {
    push(tick, hold, bass, 'bass');
    push(tick, hold, upper[0], 'acc', 0, -4);
    const dyad = upper.slice(-2);
    const offs = c.compound ? [Q / 2, Q / 2 + c.beatTicks] : Array.from({ length: Math.round(c.barTicks / c.beatTicks) }, (_, b) => b * c.beatTicks + c.beatTicks / 2);
    for (let bt = tick; bt < end; bt += c.barTicks) for (const o of offs) if (bt + o < end) for (const m of dyad) push(bt + o, Q / 2, m, 'acc', 0, -8);
  } else {
    // Struck: all together.
    push(tick, hold, bass, 'bass');
    for (const m of upper) push(tick, hold, m, 'acc');
  }
}

/**
 * A short description of the textures played, for the lab: "mostly struck, some arpeggio, roll".
 * @param {string[]} used
 */
export function describeTextures(used) {
  if (!used.length) return 'written';
  /** @type {Record<string, number>} */
  const n = {};
  for (const t of used) n[t] = (n[t] ?? 0) + 1;
  const ks = Object.keys(n).sort((a, b) => n[b] - n[a]);
  const head = n[ks[0]] / used.length > 0.5 && ks.length > 1 ? `mostly ${ks[0]}` : ks[0];
  return ks.length > 1 ? `${head}, some ${ks.slice(1).join(', ')}` : head;
}
