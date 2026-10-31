// @ts-check
// The fish generator's species and individuals (docs/future/17, catch gen 2; worked out in
// tools/fish-lab.html). A species is a region of a body-plan space drawn from its seed and its
// water: a growth grid (D'Arcy Thompson's transformed coordinates: depth, head-to-tail profile,
// shear, back arch, head droop) on one of four body plans, colours, a grown or drawn pattern and
// where it lies, fins, a tail, its colour phases, the worm it takes and its rarity. A rare type
// (ghost fish, lionfish, stonefish, anglerfish) overlays its signature form, and each of the twelve
// rare species its own tweaks (recipes/world/fishing.json rare). An individual nudges the grid and
// colours, falls in one phase, and now and then is a rarer morph. Seeded through src/core/rng.js,
// so a species and an individual rebuild the same from their seeds anywhere. Pure.

import { stream } from '../../../core/rng.js';

/** @param {{ next: () => number }} r @param {number} a @param {number} b */
const R = (r, a, b) => a + (b - a) * r.next();
/** @param {{ next: () => number }} r @param {number[]} ab */
const RR = (r, ab) => R(r, ab[0], ab[1]);
/** @template T @param {{ next: () => number }} r @param {T[]} arr @returns {T} */
const pick = (r, arr) => arr[Math.floor(r.next() * arr.length)];
/** @param {number} x @param {number} a @param {number} b */
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/** @param {number} a @param {number} b @param {number} x */
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** sRGB 0..255 from hue, saturation and lightness (degrees, percent). @param {number} h @param {number} s @param {number} l */
export function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (/** @type {number} */ t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * @typedef {{ a: number, b: number, k: number, depth: number, top: number, bot: number, shear: number, arch: number, droop: number,
 *   lumpy?: number, lp?: number }} Grid the growth grid's numbers
 * @typedef {Object} Species
 * @property {number} seed @property {string} water @property {string} plan @property {Grid} g
 * @property {string} rarity common, uncommon, rare or veryRare
 * @property {number} hue @property {number} sat @property {number} light @property {number} h2 @property {number} s2 @property {number} l2
 * @property {string} pattern @property {any} pp the pattern's own numbers
 * @property {number} pscale @property {number} strength @property {any[]} phases @property {'small' | 'big' | 'either'} bait
 * @property {'full' | 'back' | 'rear'} zone @property {number} ds @property {number} aniso
 * @property {string} tail @property {any} fin @property {boolean} finUseH2 @property {number} eye @property {number} counter
 * @property {number[]} accent @property {number[]} size typical length range (cm)
 * @property {number[]} iris @property {string} name @property {string[]} when its conditions
 * @property {string} [special] ghost, lion, stone or angler @property {boolean} [whip] @property {number} [gape]
 */

/**
 * A species from its seed and water. Pure.
 * @param {number} seed @param {string} water reef, sand, kelp, open or deep @param {any} G fishing.json gen
 * @returns {Species}
 */
export function baseSpecies(seed, water, G) {
  const r = stream(seed, 0x5bec), H = G.waters[water];
  const plan = pick(r, H.plans), P = G.plans[plan];
  const j = (/** @type {number} */ x, /** @type {number} */ a) => x * (1 + R(r, -a, a));
  /** @type {Grid} */
  const g = { a: j(P.a, 0.15), b: j(P.b, 0.2), k: clamp(j(P.k, 0.03), 0.78, 0.92), depth: j(P.depth, 0.15), top: j(P.top, 0.08), bot: j(P.bot, 0.08),
    shear: R(r, -0.25, 0.25), arch: R(r, -0.6, 1), droop: R(r, -0.5, 0.8) };
  let rr = r.next() * 100, rarity = G.rarity[0][0];
  for (const [id, w] of G.rarity) { if (rr < w) { rarity = id; break; } rr -= w; }
  const rare = rarity === 'rare' || rarity === 'veryRare';
  const hue = RR(r, pick(r, H.hues)), sat = RR(r, H.sat) + (rare ? 10 : 0), light = RR(r, H.light);
  let h2 = hue, s2 = sat, l2 = light;
  if (water === 'reef') { h2 = hue + pick(r, [180, 150, -150, 40, 0]); l2 = light + pick(r, [-28, 24]); }
  else if (water === 'open') { l2 = light - 28; s2 = sat + 10; }
  else if (water === 'kelp') { h2 = hue + R(r, -20, 20); l2 = light - 18; }
  else if (water === 'sand') { h2 = hue + R(r, -10, 10); l2 = light - 26; }
  else { l2 = light + R(r, 10, 20); s2 = sat + 10; }
  const pattern = pick(r, H.pats);
  /** @type {any} */ const pp = {};
  if (pattern === 'bars') { pp.n = R(r, 3, 7); pp.ph = r.next(); pp.t = R(r, -0.2, 0.4); pp.tilt = R(r, -0.6, 0.6); }
  if (pattern === 'stripes') { pp.n = R(r, 3, 7); pp.ph = r.next(); }
  if (pattern === 'ocellus') { pp.uc = R(r, 0.72, 0.86); pp.vc = R(r, -0.45, -0.1); pp.r = R(r, 0.06, 0.09); }
  if (pattern === 'photophores') { pp.rows = [R(r, 0.5, 0.75)]; if (r.next() < 0.6) pp.rows.push(R(r, 0.1, 0.3)); pp.n = Math.round(R(r, 9, 15)); pp.r = R(r, 0.008, 0.012); }
  const elong = plan === 'elongate';
  const fin = { d0: elong ? R(r, 0.25, 0.4) : R(r, 0.28, 0.4), d1: elong ? 0.97 : R(r, 0.6, 0.8), dh: R(r, 0.08, 0.18) * (plan === 'compressed' ? 1.3 : 1) * (elong ? 0.7 : 1),
    spiny: r.next() < 0.4, a0: elong ? R(r, 0.5, 0.6) : R(r, 0.55, 0.65), a1: elong ? 0.97 : R(r, 0.78, 0.88), ah: 0 };
  fin.ah = fin.dh * R(r, 0.55, 0.85);
  const finUseH2 = r.next() < 0.5;
  let accent = hsl(hue, sat * 0.5, Math.min(92, light + 32));
  if (pattern === 'photophores') accent = [150, 240, 255];
  if (pattern === 'ocellus') accent = hsl(48, 80, 78);
  const sizeMid = RR(r, H.size);
  /** @type {Record<string, () => any>} */
  const PH = {
    hue: () => ({ name: pick(r, G.phaseNames), dh: (r.next() < 0.5 ? -1 : 1) * R(r, 25, 70) }),
    dusky: () => ({ name: 'Dusky', dl: -R(r, 10, 18), ds: -8 }), pale: () => ({ name: 'Pale', dl: R(r, 8, 14), ds: -R(r, 15, 30) }),
    swap: () => ({ name: 'Reversed', swap: true }), bold: () => ({ name: 'Bold', ps: 1.5, ds: 12 }), faint: () => ({ name: 'Faint', ps: 0.35 }),
    finned: () => ({ name: 'Bright-finned', fh: R(r, 90, 200) }),
  };
  const keys = Object.keys(PH), phases = [{ name: 'Typical', w: R(r, 2, 4) }];
  const np = 1 + Math.floor(r.next() * 3);
  for (let i = 0; i < np; i++) { const k = keys.splice(Math.floor(r.next() * keys.length), 1)[0]; phases.push({ ...PH[k](), w: R(r, 0.6, 1.8) }); }
  const baitW = G.baitLean[water], br = r.next();
  const bait = br < baitW[0] ? 'small' : br < baitW[0] + baitW[1] ? 'big' : 'either';
  const zr = r.next(), zone = zr < 0.7 ? 'full' : zr < 0.85 ? 'back' : 'rear';
  return {
    seed, water, plan, g, rarity, hue, sat, light, h2, s2, l2, pattern, pp, pscale: R(r, 0.7, 1.5), strength: R(r, 0.65, 1), phases,
    bait: /** @type {'small' | 'big' | 'either'} */ (bait), zone: /** @type {'full' | 'back' | 'rear'} */ (zone), ds: R(r, 0.11, 0.25), aniso: r.next() < 0.4 ? 0.5 : R(r, 0.25, 0.75),
    tail: pick(r, H.tails), fin, finUseH2, eye: RR(r, H.eye), counter: RR(r, H.counter), accent, size: [sizeMid * 0.8, sizeMid * 1.15], iris: H.iris,
    name: `${pick(r, G.names.adj[pattern])} ${pick(r, G.names.noun[plan])}`, when: [],
  };
}

/**
 * An ordinary species: base, with about 4 in 10 given one condition (G.whenShare). Pure.
 * @param {number} seed @param {string} water @param {any} G
 */
export function ordinarySpecies(seed, water, G) {
  const sp = baseSpecies(seed, water, G);
  const r = stream(seed, 0x3a7e);
  sp.when = r.next() < G.whenShare ? [pick(r, G.commonWhen)] : [];
  return sp;
}

/**
 * A rare species (fishing.json rare, one of twelve): its type's signature form over a base drawn in
 * the type's water, then the species' own tweaks. The same on every island. Pure.
 * @param {any} rare one fishing.json rare entry @param {any} G
 * @returns {Species}
 */
export function rareSpecies(rare, G) {
  const sp = baseSpecies(rare.seed, rare.water, G);
  const r = stream(rare.seed, 0x7a9e);
  const kind = rare.type;
  /** @type {Species} */ const s = { ...sp, special: kind, rarity: 'veryRare', zone: 'full', finUseH2: false, pscale: 1, when: rare.when.slice() };
  const j = (/** @type {number} */ x, /** @type {number} */ a) => x * (1 + R(r, -a, a));
  const ph = (/** @type {any[]} */ ...a) => a.map(([name, w, o]) => ({ name, w, ...(o || {}) }));
  if (kind === 'ghost') {
    const hue = R(r, 185, 205);
    Object.assign(s, { plan: 'fusiform', g: { ...sp.g, depth: j(0.2, 0.1), a: 0.8, b: 1.3, k: 0.9, top: 1, bot: 1, shear: 0, arch: R(r, 0, 0.4), droop: 0 },
      hue, sat: 25, light: 86, h2: hue + 10, s2: 20, l2: 76, pattern: 'plain', pp: {}, strength: 0.4, tail: 'forked', counter: 0.1, eye: 1.25, accent: [230, 245, 255], size: [5, 12],
      phases: ph(['Typical', 3], ['Iridescent', 1, { fh: R(r, 60, 140) }], ['Faint', 1, { ps: 0.3 }]), bait: 'small' });
    s.fin = { ...sp.fin, dh: 0.12, spiny: false, d0: 0.35, d1: 0.7, ah: 0.1, a0: 0.6, a1: 0.85 };
  } else if (kind === 'lion') {
    Object.assign(s, { plan: 'compressed', g: { ...sp.g, depth: j(0.36, 0.08), a: 0.75, b: 1.2, k: 0.88, top: 1, bot: 0.95, shear: R(r, -0.1, 0.1), arch: R(r, 0, 0.5), droop: R(r, 0, 0.4) },
      hue: R(r, 2, 16), sat: 68, light: 46, h2: R(r, 20, 35), s2: 20, l2: 92, pattern: 'bars', pp: { n: R(r, 9, 13), ph: r.next(), t: R(r, -0.1, 0.2), tilt: R(r, -0.4, 0.4) },
      strength: 1, tail: 'rounded', counter: 0.15, eye: 1.1, size: [18, 38], accent: hsl(10, 40, 85),
      phases: ph(['Typical', 3], ['Maroon', 1, { dl: -12 }], ['Golden', 0.6, { dh: 25, dl: 6 }]), bait: 'big' });
    s.fin = { ...sp.fin, dh: 0.9, spiny: true, d0: 0.22, d1: 0.75, ah: 0.4, a0: 0.6, a1: 0.85 };
  } else if (kind === 'stone') {
    Object.assign(s, { plan: 'globose', g: { ...sp.g, depth: j(0.42, 0.08), a: 0.45, b: 1.5, k: 0.85, top: 1.05, bot: 1, shear: 0, arch: R(r, 0.2, 0.8), droop: R(r, -0.3, 0), lumpy: R(r, 0.08, 0.14), lp: r.next() * 6 },
      hue: R(r, 18, 40), sat: 22, light: 46, h2: R(r, 10, 45), s2: 28, l2: 30, pattern: 'mottle', pp: {}, strength: 1, tail: 'rounded', counter: 0.2, eye: 0.75, size: [18, 40],
      accent: hsl(R(r, 5, 25), 55, 55), phases: ph(['Typical', 3], ['Pale', 1, { dl: 12, ds: -6 }], ['Rust', 0.8, { dh: -15, ds: 15 }], ['Mossy', 0.8, { dh: 40, ds: 8 }]), bait: 'either' });
    s.fin = { ...sp.fin, dh: 0.18, spiny: true, d0: 0.25, d1: 0.85, ah: 0.12 };
  } else if (kind === 'angler') {
    const hue = R(r, 15, 35);
    Object.assign(s, { plan: 'globose', g: { ...sp.g, depth: j(0.48, 0.08), a: 0.42, b: 1.4, k: 0.88, top: 1.05, bot: 1, shear: 0, arch: R(r, 0, 0.4), droop: 0 },
      hue, sat: 22, light: 20, h2: hue, s2: 20, l2: 12, pattern: 'speckle', pp: {}, strength: 0.7, tail: 'rounded', counter: 0.05, eye: 0.55, size: [15, 60],
      accent: pick(r, [[255, 228, 150], [150, 240, 255]]), phases: ph(['Typical', 3], ['Pale', 1, { dl: 10 }], ['Rust', 0.7, { dh: -15, ds: 12 }]), bait: 'big' });
    s.fin = { ...sp.fin, dh: 0.08, spiny: false, ah: 0.06 };
  }
  s.water = G.rareTypes[kind].water;
  s.iris = G.waters[s.water].iris;
  s.name = rare.name;
  const V = rare.form ?? {};
  if (V.plan) { s.plan = V.plan; s.g = { ...s.g, ...G.rarePlans[V.plan] }; }
  if (V.hue) { s.hue = R(r, V.hue[0], V.hue[1]); if (kind !== 'lion') s.h2 = s.hue + R(r, -12, 12); }
  if (V.h2) s.h2 = R(r, V.h2[0], V.h2[1]);
  if (V.l2) s.l2 = V.l2;
  if (V.sat !== undefined) s.sat = V.sat;
  if (V.light !== undefined) s.light = V.light;
  if (V.eye) s.eye = V.eye;
  if (V.size) s.size = V.size;
  if (V.spine) s.fin = { ...s.fin, dh: s.fin.dh * V.spine };
  if (V.flat) s.g = { ...s.g, depth: s.g.depth * 0.75, lumpy: (s.g.lumpy ?? 0) * 1.4 };
  if (V.lure) s.accent = V.lure;
  s.whip = !!V.whip;
  s.gape = V.gape ?? 1;
  return s;
}

/**
 * A fixed, named member of the shallow waters (fishing.json named: the five net fish): drawn as an
 * ordinary species of its water, with the shape and look the recipe pins. Pure.
 * @param {any} named one fishing.json named entry @param {any} G
 * @returns {Species}
 */
export function namedSpecies(named, G) {
  const sp = baseSpecies(named.seed, named.water, G);
  const f = named.form ?? {};
  /** @type {Species} */ const s = { ...sp, name: named.name, rarity: named.rarity ?? 'common', bait: named.bait ?? sp.bait, when: named.when ?? [] };
  if (f.plan) { s.plan = f.plan; s.g = { ...s.g, ...G.plans[f.plan], shear: sp.g.shear * 0.4, arch: sp.g.arch * 0.4, droop: sp.g.droop * 0.4 }; }
  for (const k of ['hue', 'sat', 'light', 'h2', 's2', 'l2', 'pattern', 'tail', 'counter', 'strength']) if (f[k] !== undefined) /** @type {any} */ (s)[k] = f[k];
  if (f.size) s.size = f.size;
  if (f.depth) s.g = { ...s.g, depth: f.depth };
  if (f.pattern === 'bars' && !s.pp.n) s.pp = { n: 5, ph: 0.3, t: 0.1, tilt: 0 };
  if (f.pattern === 'stripes' && !s.pp.n) s.pp = { n: 4, ph: 0.2 };
  return s;
}

/**
 * The growth grid as a map from (u nose to tail 0..1, v top -1 .. bottom 1) to the side view
 * (x along, y down), the lab's makeMap. Pure.
 * @param {Grid} g @returns {(u: number, v: number) => number[]}
 */
export function makeMap(g) {
  let mx = 0;
  for (let i = 1; i < 200; i++) { const x = i / 200; mx = Math.max(mx, Math.pow(x, g.a) * Math.pow(1 - g.k * x, g.b)); }
  const N = 1 / mx;
  const hn = (/** @type {number} */ u) => { const x = clamp(u, 0, 1); return N * Math.pow(x, g.a) * Math.pow(1 - g.k * x, g.b); };
  const lump = (/** @type {number} */ u, /** @type {number} */ v) => (g.lumpy
    ? 1 + g.lumpy * (0.5 * Math.sin(u * 31 + (g.lp ?? 0) + (v < 0 ? 0 : 2.1)) + 0.35 * Math.sin(u * 67 + (g.lp ?? 0) * 2 + (v < 0 ? 1 : 3)) + 0.2 * Math.sin(u * 113 + (g.lp ?? 0) * 3))
    : 1);
  return (u, v) => {
    const h = hn(u) * g.depth * (v < 0 ? g.top : g.bot) * lump(u, v);
    let y = v * h;
    const x = u + g.shear * y * 0.5;
    y += -g.arch * Math.sin(Math.PI * u) * 0.04 + g.droop * Math.pow(1 - u, 2) * 0.05;
    return [x, y];
  };
}

/** Its rarer morph, if any (fishing.json gen.morph, far rarer than the lab's). @param {number} seed individual @param {any} G */
export function morphOf(seed, G) {
  const m = stream(seed, 0x30a1).next(), M = G.morph;
  let t = 0;
  for (const id of ['leucistic', 'golden', 'melanistic', 'giant']) { t += M[id]; if (m < t) return id; }
  return null;
}

/**
 * @typedef {Object} Individual
 * @property {number} seed @property {Grid} g @property {any} col its colours @property {number} sizeCm
 * @property {string | null} morph @property {string} phase @property {any} geo fin and tail sizes
 * @property {number[][]} [warts] a stonefish's warts [u, v, r, light]
 */

/**
 * One individual of a species. Pure.
 * @param {Species} sp @param {number} seed @param {any} G
 * @returns {Individual}
 */
export function fishIndividual(sp, seed, G) {
  const r = stream(seed, 0x14d1);
  const g = { ...sp.g };
  g.depth *= R(r, 0.96, 1.04); g.a *= R(r, 0.96, 1.04); g.shear += R(r, -0.04, 0.04); g.arch += R(r, -0.1, 0.1);
  const col = { h: sp.hue + R(r, -10, 10), s: sp.sat + R(r, -6, 6), l: sp.light + R(r, -6, 6), h2: sp.h2 + R(r, -12, 12), s2: sp.s2 + R(r, -6, 6), l2: sp.l2 + R(r, -5, 5),
    counter: sp.counter, strength: sp.strength * R(r, 0.8, 1.15), accent: sp.accent, iris: sp.iris, fh: /** @type {number | null} */ (null) };
  let tot = 0;
  for (const p of sp.phases) tot += p.w;
  let pr = r.next() * tot, phase = sp.phases[0];
  for (const p of sp.phases) { if (pr < p.w) { phase = p; break; } pr -= p.w; }
  if (phase.dh) { col.h += phase.dh; col.h2 += phase.dh * 0.6; }
  if (phase.dl) { col.l += phase.dl; col.l2 += phase.dl; }
  if (phase.ds) { col.s += phase.ds; col.s2 += phase.ds; }
  if (phase.ps) col.strength *= phase.ps;
  if (phase.swap) { [col.h, col.h2] = [col.h2, col.h]; [col.s, col.s2] = [col.s2, col.s]; [col.l, col.l2] = [col.l2, col.l]; }
  if (phase.fh) col.fh = col.h + phase.fh;
  const morph = morphOf(seed, G);
  const sr = stream(seed, 0x512e);
  const sizeCm = R(sr, sp.size[0], sp.size[1]) * (morph === 'giant' ? G.morph.giantSize : 1);
  if (morph === 'leucistic') { col.s *= 0.15; col.l = 82; col.s2 *= 0.15; col.l2 = 72; col.strength *= 0.5; col.iris = [350, 40, 70]; }
  else if (morph === 'golden') { col.h = 44; col.s = 85; col.l = 60; col.h2 = 30; col.s2 = 80; col.l2 = 48; col.strength *= 0.6; }
  else if (morph === 'melanistic') { col.l = 14; col.l2 = 7; col.s *= 0.6; col.strength *= 0.6; }
  const deep = g.depth + 0.08;
  const geo = { dh: sp.fin.dh * deep, ah: sp.fin.ah * deep, tl: (0.15 + 0.12 * g.depth) * (sp.tail === 'forked' || sp.tail === 'lunate' ? 1.2 : 1),
    spread: 0.55 * g.depth + 0.06, gu: sp.plan === 'elongate' ? 0.13 : 0.2 };
  /** @type {Individual} */ const ind = { seed, g, col, sizeCm, morph, phase: phase.name, geo };
  if (sp.special === 'stone') { ind.warts = []; for (let i = 0; i < 46; i++) ind.warts.push([R(r, 0.08, 0.95), R(r, -0.95, 0.6), R(r, 0.006, 0.018), r.next() < 0.55 ? 1 : 0]); }
  return ind;
}
