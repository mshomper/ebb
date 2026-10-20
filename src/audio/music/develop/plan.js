// @ts-check
// The development engine, step 1 (doc 24, "How a grown piece is made"): choose a form template for
// the slot and weather, then plan its phrases: each phrase's length, the cadence it ends on and its
// tension target. The last phrase always ends on a cadence that may close a piece.
//
// Pure and seeded: the same material, rules and stream always give the same plan.

/** @typedef {ReturnType<typeof import('../../../core/rng.js').stream>} Stream */

/**
 * @typedef {Object} PhrasePlan
 * @property {string} role
 * @property {number} bars
 * @property {string} cadence       a key of material.cadences
 * @property {[number, number]} tension  target at the phrase's start and end, 0..1
 * @property {number} [from]      a return: the earlier phrase it brings back (its length is that phrase's)
 * @property {number} [keep]      bars of that phrase kept as they were before it goes its own way
 */

/**
 * Draw one key from a weights object.
 * @param {Record<string, number>} weights @param {Stream} r
 * @returns {string|null}
 */
export function pickWeighted(weights, r) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  if (!keys.length || total <= 0) return null;
  let x = r.next() * total;
  for (const k of keys) { x -= weights[k]; if (x < 0) return k; }
  return keys[keys.length - 1];
}

/**
 * The templates that fit a slot and weather, with their weights for that slot.
 * @param {any} material @param {{slot: string, weather?: string}} where
 * @returns {Record<string, number>}
 */
export function fittingTemplates(material, where) {
  const weather = where.weather ?? 'clear';
  /** @type {Record<string, number>} */
  const out = {};
  for (const [id, t] of Object.entries(material.templates)) {
    const w = t.slots?.[where.slot] ?? 0;
    if (w > 0 && (t.weather ?? ['clear']).includes(weather)) out[id] = w;
  }
  // No template for this weather in this slot: fall back to the clear-weather ones.
  if (!Object.keys(out).length && weather !== 'clear') return fittingTemplates(material, { slot: where.slot, weather: 'clear' });
  return out;
}

/**
 * Plan a template's phrases.
 * @param {any} material @param {any} rules recipes/music/develop.json
 * @param {string} templateId @param {Stream} r
 * @returns {PhrasePlan[]}
 */
export function planPhrases(material, rules, templateId, r) {
  const t = material.templates[templateId];
  const mult = rules.harmony?.cadenceWeights ?? {};
  /** @type {PhrasePlan[]} */
  const out = [];
  t.phrases.forEach((/** @type {any} */ ph, /** @type {number} */ i) => {
    const last = i === t.phrases.length - 1;
    const [lo, hi] = ph.bars;
    // A return is as long as the phrase it brings back.
    const ret = Number.isInteger(ph.from) && ph.from >= 0 && ph.from < i ? ph.from : undefined;
    const bars = ret !== undefined ? out[ret].bars : lo + r.int(hi - lo + 1);
    /** @type {Record<string, number>} */
    const w = {};
    for (const [c, v] of Object.entries(ph.cadence)) {
      if (!material.cadences[c]) continue;
      if (last && !material.cadences[c].final) continue;
      w[c] = /** @type {number} */ (v) * (mult[c] ?? 1);
      // A return changes its ending: its source's cadence is less likely.
      if (ret !== undefined && out[ret].cadence === c) w[c] *= rules.harmony?.returnSameCadence ?? 0.3;
    }
    // A last phrase whose offered cadences were all tuned away still has to close.
    const cadence = pickWeighted(w, r)
      ?? (last ? Object.keys(material.cadences).find((c) => material.cadences[c].final) : Object.keys(ph.cadence)[0]);
    /** @type {PhrasePlan} */
    const plan = { role: ph.role, bars, cadence: /** @type {string} */ (cadence), tension: /** @type {[number, number]} */ ([...ph.tension]) };
    if (ret !== undefined) { plan.from = ret; plan.keep = Math.max(1, Math.min(ph.keep ?? 2, bars - 2)); }
    out.push(plan);
  });
  return out;
}
