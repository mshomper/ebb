// @ts-check
// Palette keys (docs/05, "Time of day, season and weather"). Pure functions:
//   keyWeights(keys)          -> weight per key name: five time keys by sun elevation, four season
//                                keys by season position, and three weather weights.
//   blendPalette(palette, w)  -> a resolved palette: base plus weighted key deltas, colors in OKLab,
//                                anchors matched by role, then weather overrides.
//   paramsDistance(a, b)      -> how far two resolved palettes are apart (rebake threshold).
// Blending is done on parameters, never inside the LUT, so keys can never fight there.
// Each family (time, season) adds Σ w · (key value − base value); a key's missing values inherit the
// base, so a key that sets nothing adds nothing. Within one family this is a plain lerp, and time
// and season keys stack instead of overriding each other (a winter night is muted twice).

import { hexToOklab } from '../../color/oklab.js';

/** @typedef {import('../../color/oklab.js').Vec3} Vec3 */

/**
 * @typedef {Object} ResolvedAnchor
 * @property {string} role
 * @property {Vec3} from     OKLab
 * @property {Vec3} to       OKLab
 * @property {number} radius OKLab distance
 * @property {number} strength
 */

/**
 * @typedef {Object} ResolvedPalette
 * @property {string} id
 * @property {number} keepLuminance
 * @property {number} exposureComp   EV
 * @property {number} purkinje       multiplier on the tonemap's Purkinje strength
 * @property {{ slope: number, power: number, saturation: number }} look
 * @property {{ lift: number, gamma: number, gain: number, chroma: number,
 *   shadowTint: Vec3, shadowAmt: number, highlightTint: Vec3, highlightAmt: number }} grade  tints in OKLab
 * @property {{ amount: number, terrainAmount: number, chroma: number }} outline
 * @property {ResolvedAnchor[]} anchors
 */

/** @typedef {Record<string, number>} KeyWeights */

export const TIME_KEYS = /** @type {const} */ (['night', 'blue-hour', 'golden', 'morning', 'day']);
export const SEASON_KEYS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);
export const WEATHER_KEYS = /** @type {const} */ (['overcast', 'mist', 'rain']);
export const MAX_ANCHORS = 32;

/** Key boundaries and blend widths. A palette may override any of these under `keyBlend`. */
export const KEY_DEFAULTS = {
  /** sun elevation boundaries between night | blue hour | golden | morning | day, degrees */
  timeBoundsDeg: [-12, -4, 6, 20],
  /** smoothstep half width across each time boundary, degrees */
  timeBlendDeg: 1.5,
  /** smoothstep half width across each season boundary, in seasons (0.25 = a quarter season) */
  seasonBlend: 0.25,
};

/** Weather overrides applied after the keys. A palette may override any of these under `weather`. */
export const WEATHER_DEFAULTS = {
  /** chroma multiplier at full overcast (lowers chroma by up to 20%) */
  overcastChroma: 0.8,
  /** lift added at full mist (raises the shadows) */
  mistLift: 0.04,
  /** cool tint the highlights move toward at full rain */
  rainHighlightTint: '#C9D5E2',
  /** highlight tint amount reached at full rain */
  rainHighlightAmt: 0.14,
};

/** Values a palette may leave out. */
const BASE_DEFAULTS = {
  keepLuminance: 0.9,
  exposureComp: 0,
  purkinje: 1,
  look: { slope: 1, power: 1, saturation: 1 },
  grade: { lift: 0, gamma: 1, gain: 1, chroma: 1, shadowTint: '#808080', shadowAmt: 0, highlightTint: '#FFFFFF', highlightAmt: 0 },
  outline: { amount: 0.35, terrainAmount: 0.1, chroma: 1.1 },
};

const GRADE_NUM = /** @type {const} */ (['lift', 'gamma', 'gain', 'chroma', 'shadowAmt', 'highlightAmt']);
const GRADE_COL = /** @type {const} */ (['shadowTint', 'highlightTint']);
const LOOK_NUM = /** @type {const} */ (['slope', 'power', 'saturation']);
const OUTLINE_NUM = /** @type {const} */ (['amount', 'terrainAmount', 'chroma']);
const TOP_NUM = /** @type {const} */ (['keepLuminance', 'exposureComp', 'purkinje']);

/** @param {number} e0 @param {number} e1 @param {number} x */
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Weights per key name. Time weights sum to 1, season weights sum to 1, weather weights are 0..1.
 * @param {{ sunAltDeg: number, seasonPhase: number, weather?: { cloud?: number, rain?: number, mist?: number } }} keys
 *   seasonPhase is the 0..4 season position (index + phase): 0 spring, 1 summer, 2 autumn, 3 winter
 * @param {Partial<typeof KEY_DEFAULTS>} [opts]
 * @returns {KeyWeights}
 */
export function keyWeights(keys, opts = {}) {
  const o = { ...KEY_DEFAULTS, ...opts };
  /** @type {KeyWeights} */
  const w = {};

  // Time: s_k rises across boundary k; band k gets s_(k-1) - s_k (telescopes to a sum of 1).
  const alt = num(keys.sunAltDeg) ? keys.sunAltDeg : 30;
  const s = o.timeBoundsDeg.map((b) => smoothstep(b - o.timeBlendDeg, b + o.timeBlendDeg, alt));
  for (let k = 0; k < TIME_KEYS.length; k++) {
    const below = k === 0 ? 1 : s[k - 1];
    const above = k === TIME_KEYS.length - 1 ? 0 : s[k];
    w[TIME_KEYS[k]] = Math.max(0, below - above);
  }

  // Season: a plateau inside each season, smoothstep across each boundary, wrapping winter -> spring.
  for (const name of SEASON_KEYS) w[name] = 0;
  const pos = num(keys.seasonPhase) ? keys.seasonPhase : 1.5;
  const x = ((pos % 4) + 4) % 4;
  const i = Math.min(3, Math.floor(x));
  const f = x - i;
  const bw = clamp(o.seasonBlend, 1e-6, 0.5);
  if (f < bw) {
    const t = smoothstep(-bw, bw, f);
    w[SEASON_KEYS[i]] += t;
    w[SEASON_KEYS[(i + 3) % 4]] += 1 - t;
  } else if (f > 1 - bw) {
    const t = smoothstep(-bw, bw, f - 1);
    w[SEASON_KEYS[(i + 1) % 4]] += t;
    w[SEASON_KEYS[i]] += 1 - t;
  } else {
    w[SEASON_KEYS[i]] = 1;
  }

  const wx = keys.weather ?? {};
  w.overcast = clamp(num(wx.cloud) ? /** @type {number} */ (wx.cloud) : 0, 0, 1);
  w.mist = clamp(num(wx.mist) ? /** @type {number} */ (wx.mist) : 0, 0, 1);
  w.rain = clamp(num(wx.rain) ? /** @type {number} */ (wx.rain) : 0, 0, 1);
  return w;
}

/**
 * Parse a palette JSON's base into a resolved palette (defaults filled, colors in OKLab).
 * @param {any} palette
 * @returns {ResolvedPalette}
 */
export function resolveBase(palette) {
  const p = palette ?? {};
  const d = BASE_DEFAULTS;
  const g = { ...d.grade, ...(p.grade ?? {}) };
  return {
    id: String(p.id ?? ''),
    keepLuminance: num(p.keepLuminance) ? p.keepLuminance : d.keepLuminance,
    exposureComp: num(p.exposureComp) ? p.exposureComp : d.exposureComp,
    purkinje: num(p.purkinje) ? p.purkinje : d.purkinje,
    look: { ...d.look, ...(p.look ?? {}) },
    grade: {
      lift: g.lift, gamma: g.gamma, gain: g.gain, chroma: g.chroma,
      shadowTint: hexToOklab(g.shadowTint), shadowAmt: g.shadowAmt,
      highlightTint: hexToOklab(g.highlightTint), highlightAmt: g.highlightAmt,
    },
    outline: { ...d.outline, ...(p.outline ?? {}) },
    anchors: (Array.isArray(p.anchors) ? p.anchors : []).slice(0, MAX_ANCHORS).map(anchorOf),
  };
}

/** @param {any} a @returns {ResolvedAnchor} */
function anchorOf(a) {
  return {
    role: String(a.role ?? ''),
    from: hexToOklab(a.from),
    to: hexToOklab(a.to ?? a.from),
    radius: num(a.radius) ? a.radius : 0.1,
    strength: num(a.strength) ? a.strength : 0.35,
  };
}

/**
 * Blend a palette's keys by weight and apply the weather overrides.
 * @param {any} palette  parsed palette JSON (docs/05 "Palette file")
 * @param {KeyWeights} weights  from keyWeights(); missing names count as 0
 * @returns {ResolvedPalette}
 */
export function blendPalette(palette, weights) {
  const base = resolveBase(palette);
  const out = cloneResolved(base);
  const keys = palette?.keys ?? {};

  for (const name of [...TIME_KEYS, ...SEASON_KEYS]) {
    const w = weights[name] ?? 0;
    const key = keys[name];
    if (!(w > 0) || !key) continue;
    for (const f of TOP_NUM) if (num(key[f])) out[f] += w * (key[f] - base[f]);
    addNums(out.look, base.look, key.look, LOOK_NUM, w);
    addNums(out.outline, base.outline, key.outline, OUTLINE_NUM, w);
    if (key.grade) {
      addNums(out.grade, base.grade, key.grade, GRADE_NUM, w);
      for (const f of GRADE_COL) if (typeof key.grade[f] === 'string') addLab(out.grade[f], base.grade[f], hexToOklab(key.grade[f]), w);
    }
    if (Array.isArray(key.anchors)) {
      for (const ka of key.anchors) {
        const role = String(ka.role ?? '');
        let bi = base.anchors.findIndex((a) => a.role === role);
        if (bi < 0) {
          // A role the base lacks: it fades in from strength 0, using this key's colors.
          if (base.anchors.length >= MAX_ANCHORS) continue;
          const fresh = anchorOf({ ...ka, strength: 0 });
          base.anchors.push(fresh);
          out.anchors.push(cloneAnchor(fresh));
          bi = base.anchors.length - 1;
        }
        const b = base.anchors[bi], o = out.anchors[bi];
        if (num(ka.radius)) o.radius += w * (ka.radius - b.radius);
        if (num(ka.strength)) o.strength += w * (ka.strength - b.strength);
        if (typeof ka.from === 'string') addLab(o.from, b.from, hexToOklab(ka.from), w);
        if (typeof ka.to === 'string') addLab(o.to, b.to, hexToOklab(ka.to), w);
      }
    }
  }

  // Weather overrides, after the keys.
  const wx = { ...WEATHER_DEFAULTS, ...(palette?.weather ?? {}) };
  const overcast = clamp(weights.overcast ?? 0, 0, 1);
  const mist = clamp(weights.mist ?? 0, 0, 1);
  const rain = clamp(weights.rain ?? 0, 0, 1);
  out.grade.chroma *= 1 + (wx.overcastChroma - 1) * overcast;
  out.grade.lift += wx.mistLift * mist;
  if (rain > 0) {
    const cool = hexToOklab(wx.rainHighlightTint);
    for (let k = 0; k < 3; k++) out.grade.highlightTint[k] += (cool[k] - out.grade.highlightTint[k]) * rain;
    out.grade.highlightAmt += (Math.max(out.grade.highlightAmt, wx.rainHighlightAmt) - out.grade.highlightAmt) * rain;
  }

  // Keep everything in a sane range.
  out.keepLuminance = clamp(out.keepLuminance, 0, 1);
  out.purkinje = Math.max(0, out.purkinje);
  const g = out.grade;
  g.gamma = Math.max(0.05, g.gamma);
  g.chroma = Math.max(0, g.chroma);
  g.shadowAmt = clamp(g.shadowAmt, 0, 1);
  g.highlightAmt = clamp(g.highlightAmt, 0, 1);
  out.look.slope = Math.max(0, out.look.slope);
  out.look.power = Math.max(0.05, out.look.power);
  out.look.saturation = Math.max(0, out.look.saturation);
  for (const f of OUTLINE_NUM) out.outline[f] = Math.max(0, out.outline[f]);
  for (const a of out.anchors) { a.radius = Math.max(1e-4, a.radius); a.strength = clamp(a.strength, 0, 4); }
  return out;
}

/**
 * Largest change between two resolved palettes: numbers by absolute difference, colors by OKLab
 * distance, anchors matched by index. A change in anchor count counts as a full change (1).
 * @param {ResolvedPalette} a
 * @param {ResolvedPalette} b
 */
export function paramsDistance(a, b) {
  if (a.anchors.length !== b.anchors.length) return 1;
  let d = 0;
  for (const f of TOP_NUM) d = Math.max(d, Math.abs(a[f] - b[f]));
  for (const f of LOOK_NUM) d = Math.max(d, Math.abs(a.look[f] - b.look[f]));
  for (const f of OUTLINE_NUM) d = Math.max(d, Math.abs(a.outline[f] - b.outline[f]));
  for (const f of GRADE_NUM) d = Math.max(d, Math.abs(a.grade[f] - b.grade[f]));
  for (const f of GRADE_COL) d = Math.max(d, labDist(a.grade[f], b.grade[f]));
  for (let i = 0; i < a.anchors.length; i++) {
    const x = a.anchors[i], y = b.anchors[i];
    d = Math.max(d, labDist(x.from, y.from), labDist(x.to, y.to), Math.abs(x.radius - y.radius), Math.abs(x.strength - y.strength));
  }
  return d;
}

/**
 * Mix two resolved palettes' tonemap-side numbers (look, outline, exposureComp, purkinje) by t.
 * Used during a crossfade; the LUT contents fade on the GPU.
 * @param {ResolvedPalette} a @param {ResolvedPalette} b @param {number} t
 */
export function mixTonemapParams(a, b, t) {
  /** @param {number} x @param {number} y */
  const m = (x, y) => x + (y - x) * t;
  return {
    look: { slope: m(a.look.slope, b.look.slope), power: m(a.look.power, b.look.power), saturation: m(a.look.saturation, b.look.saturation) },
    exposureComp: m(a.exposureComp, b.exposureComp),
    outline: { amount: m(a.outline.amount, b.outline.amount), terrainAmount: m(a.outline.terrainAmount, b.outline.terrainAmount), chroma: m(a.outline.chroma, b.outline.chroma) },
    purkinje: m(a.purkinje, b.purkinje),
  };
}

/**
 * @param {Record<string, any>} out @param {Record<string, any>} base @param {Record<string, any> | undefined} key
 * @param {readonly string[]} fields @param {number} w
 */
function addNums(out, base, key, fields, w) {
  if (!key) return;
  for (const f of fields) if (num(key[f])) out[f] += w * (key[f] - base[f]);
}

/** @param {Vec3} out @param {Vec3} base @param {Vec3} key @param {number} w */
function addLab(out, base, key, w) {
  for (let k = 0; k < 3; k++) out[k] += w * (key[k] - base[k]);
}

/** @param {Vec3} a @param {Vec3} b */
function labDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** @param {ResolvedAnchor} a @returns {ResolvedAnchor} */
function cloneAnchor(a) {
  return { role: a.role, from: [...a.from], to: [...a.to], radius: a.radius, strength: a.strength };
}

/** @param {ResolvedPalette} p @returns {ResolvedPalette} */
export function cloneResolved(p) {
  return {
    id: p.id,
    keepLuminance: p.keepLuminance,
    exposureComp: p.exposureComp,
    purkinje: p.purkinje,
    look: { ...p.look },
    grade: { ...p.grade, shadowTint: [...p.grade.shadowTint], highlightTint: [...p.grade.highlightTint] },
    outline: { ...p.outline },
    anchors: p.anchors.map(cloneAnchor),
  };
}
