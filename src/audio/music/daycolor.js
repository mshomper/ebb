// @ts-check
// Day colour for the music (doc 24, "Day color"): continuous values that follow the sun's height
// with the same key boundaries as the island's palette (night, blue hour, golden, morning and
// afternoon, day), blended smoothly. Pure. Numbers from recipes/music/director.json dayColor.

const KEYS = /** @type {const} */ (['night', 'blueHour', 'golden', 'morning', 'day']);

/** @param {number} e0 @param {number} e1 @param {number} x */
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Weights of the five day keys for a sun height, summing to 1.
 * @param {number} sunAltDeg @param {{boundsDeg: number[], blendDeg: number}} c
 * @returns {Record<string, number>}
 */
export function dayKeyWeights(sunAltDeg, c) {
  const s = c.boundsDeg.map((b) => smoothstep(b - c.blendDeg, b + c.blendDeg, sunAltDeg));
  /** @type {Record<string, number>} */
  const w = {};
  for (let k = 0; k < KEYS.length; k++) w[KEYS[k]] = Math.max(0, (k === 0 ? 1 : s[k - 1]) - (k === KEYS.length - 1 ? 0 : s[k]));
  return w;
}

/**
 * The blended day colour: register, density, tempo, wet, brightHz, voices.
 * @param {number} sunAltDeg @param {any} dayColor recipes/music/director.json dayColor
 * @returns {Record<string, number>}
 */
export function dayColorAt(sunAltDeg, dayColor) {
  const w = dayKeyWeights(sunAltDeg, dayColor);
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of KEYS) for (const [name, v] of Object.entries(dayColor.keys[k])) out[name] = (out[name] ?? 0) + w[k] * /** @type {number} */ (v);
  out.voices = Math.round(out.voices);
  return out;
}

/** The day key with the most weight, for labels. @param {number} sunAltDeg @param {any} dayColor */
export function dayKeyName(sunAltDeg, dayColor) {
  const w = dayKeyWeights(sunAltDeg, dayColor);
  return KEYS.reduce((a, b) => (w[b] > w[a] ? b : a));
}
