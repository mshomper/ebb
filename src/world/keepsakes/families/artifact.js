// @ts-check
// Artifact keepsakes (docs/future/12): mysterious, disconnected trinkets, each one a baked base model
// (a bullet, a bowl, a jar and so on; recipes/world/keepsake-artifacts.json) carried through seeded
// numbers that morph its shape (artifact-morph.js), recolour it (artifact-color.js) and give it a
// name and a plain description. The numbers are continuous, so there is no end to the variety; a
// kept artifact saves them (with its name and description) and rebuilds exactly. Rarity widens
// how far the numbers may go and how likely the marks are: broken clean across, grown together with
// a smaller twin, a skin of gold.

import { hash32 } from '../../../core/rng.js';
import { loadFindModel } from '../../finds/models.js';
import { pickIndex } from '../rarity.js';
import { draws, r4 } from './common.js';
import { addTwin, cutPositions, finish, morphPositions, prepareBase } from './artifact-morph.js';
import { colorWord, mix, noise3, recolor } from './artifact-color.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */
/** @typedef {import('./artifact-color.js').Rgb} Rgb */

const TAU = Math.PI * 2;
/** @type {Map<string, import('./artifact-morph.js').Base>} prepared bases by artifact id */
const BASES = new Map();

/**
 * Load the artifact recipe (onto K.artifacts) and every base model, so artifact keepsakes can be
 * made. Call once before rolling or meshing one. @param {any} K keepsakes.json
 * @param {string} [root] where the repo root is from the page, '../' for tools/
 */
export async function loadArtifactBases(K, root = '../') {
  if (!K.artifacts) {
    const r = await fetch(root + 'recipes/world/keepsake-artifacts.json');
    if (!r.ok) throw new Error(`recipes/world/keepsake-artifacts.json: HTTP ${r.status}`);
    K.artifacts = await r.json();
  }
  await Promise.all(K.artifacts.artifacts.map(async (/** @type {any} */ a) => {
    if (!BASES.has(a.id)) BASES.set(a.id, prepareBase(await loadFindModel(root + a.url)));
  }));
}

/** Give the generator a base it has already parsed (for tools that read the files themselves). @param {string} id @param {Parameters<typeof prepareBase>[0]} parts */
export function provideArtifactBase(id, parts) { BASES.set(id, prepareBase(parts)); }

/** @param {any} K */
function recipeOf(K) {
  if (!K.artifacts) throw new Error('artifact recipe not loaded: await loadArtifactBases(K) first');
  return K.artifacts;
}

const clamp = (/** @type {number} */ x, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, x));
const cap = (/** @type {string} */ s) => s[0].toUpperCase() + s.slice(1);

/** @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json with K.artifacts loaded */
export function artifactNumbers(h0, rarity, K) {
  const A = recipeOf(K), T = A.variation.tiers[rarity], d = draws(h0);
  const ri = K.rarity.order.indexOf(rarity);
  const bi = pickIndex(d.u(2), A.artifacts.map((/** @type {any} */ b) => b.weights[ri]));
  const B = A.artifacts[bi];
  const sign = (/** @type {number} */ i) => (d.u(i) < 0.5 ? -1 : 1);
  let sizeM = r4(B.sizeM * d.range(T.size, 3));
  if (B.sizeLimit) sizeM = r4(clamp(sizeM, B.sizeLimit[0], B.sizeLimit[1]));

  // Marks: each has a chance, lifted by the tier; one at most.
  let mark = null, t = d.u(20);
  for (const id of Object.keys(A.marks)) {
    const p = A.marks[id].chance * T.markLean;
    if (t < p) { mark = id; break; }
    t -= p;
  }

  const morph = {
    sx: d.range(T.stretch, 4), sy: d.range(T.stretch, 5), sz: d.range(T.stretch, 6),
    taper: r4(sign(70) * d.range(T.taper, 7)), twist: r4(sign(71) * d.range(T.twist, 8)), bend: r4(sign(72) * d.range(T.bend, 9)),
    lump: d.range(T.lump, 11), lumpSeed: d.int([0, 1e6], 12), smooth: d.int(T.smooth, 13), mirror: d.chance(T.mirrorChance, 14) ? 1 : 0,
    swell: r4(sign(46) * d.range(T.swell, 45)), shear: r4(sign(48) * d.range(T.shear, 47)),
    ripAmp: d.chance(T.rippleChance, 49) ? d.range(T.rippleAmp, 50) : 0, ripFreq: d.range([2.5, 7], 51),
    lobeAmp: d.chance(T.lobeChance, 52) ? d.range(T.lobeAmp, 53) : 0, lobeK: d.int([3, 6], 54), lobePhase: d.range([0, TAU], 55),
  };
  const chipped = d.chance(T.chipChance, 15);
  /** @type {{ theta: number, phi: number, depth: number } | null} */
  let cut = null;
  if (mark === 'broken') cut = { theta: d.range([0, TAU], 16), phi: d.range([0.3, 2.84], 17), depth: d.range(A.marks.broken.depth, 19) };
  else if (chipped) cut = { theta: d.range([0, TAU], 16), phi: d.range([0.3, 2.84], 17), depth: d.range(T.chipDepth, 18) };
  const twin = mark === 'pair' ? { scale: d.range(A.marks.pair.scale, 22), yaw: d.range([0, TAU], 23) } : null;

  const tinted = d.chance(T.tintChance, 27);
  const color = {
    hue: r4((d.range(T.hue, 25) * Math.PI) / 180), chroma: d.range(T.chroma, 26), lightMul: d.range(T.light, 28),
    tintHue: d.range([0, TAU], 29), tintChroma: tinted ? d.range(T.tintChroma, 30) : 0,
    patina: d.chance(T.patina.chance, 31) ? d.range(T.patina.strength, 32) : 0, patinaSeed: d.int([0, 1e6], 33),
    stain: d.chance(T.stain.chance, 34) ? d.range(T.stain.strength, 35) : 0, stainSeed: d.int([0, 1e6], 36),
    bands: d.chance(T.bands.chance, 37) ? d.int(T.bands.count, 38) : 0, bandWidth: d.range(T.bands.width, 39), bandPhase: d.range([0, 1], 40),
    band: d.int([0, A.colors.band.length - 1], 41),
    gilt: mark === 'gilded' ? d.range(A.marks.gilded.strength, 24) : 0,
    grain: d.range(T.grain, 42),
  };

  const n = {
    family: 'artifact', gen: A.gen, rarity, form: B.id, base: B.id, kind: B.kind, sizeM, view: B.view.slice(),
    morph, cut, twin, color, mark,
    observation: d.int([0, B.observations.length - 1], 43), nounPick: d.range([0, 0.9999], 44),
  };
  return { ...n, ...describe(n, B, A) };
}

/**
 * The finished colour of a base's mean colour through a variant's colour numbers, roughly: what the
 * piece reads as overall, for its name. @param {any} n @param {any} B @param {any} A @returns {Rgb}
 */
function meanColor(n, B, A) {
  const c = n.color, K = A.kinds[B.kind];
  let m = recolor(/** @type {Rgb} */ (B.stats.mean), { hue: c.hue, chroma: c.chroma, lightMul: c.lightMul, lightAdd: 0, tintHue: c.tintHue, tintChroma: c.tintChroma });
  if (c.patina) m = mix(m, K.patina.color, 0.3 * c.patina);
  if (c.stain) m = mix(m, K.stain.color, 0.22 * c.stain);
  if (c.gilt) m = mix(m, A.colors.gold, 0.35 * c.gilt);
  return m;
}

/** Name and description from the numbers, saved with them. @param {any} n @param {any} B @param {any} A */
function describe(n, B, A) {
  const m = n.morph, c = n.color, S = B.stats.dims, W = A.conditions;
  const aspect = (S[1] * m.sy) / Math.max(S[0] * m.sx, S[2] * m.sz);
  const words = B.nouns.find((/** @type {[number, string[]]} */ x) => aspect <= x[0])[1];
  const noun = words[Math.min(words.length - 1, Math.floor((n.nounPick ?? 0) * words.length))];
  const colour = colorWord(meanColor(n, B, A));
  const cond = n.mark === 'broken' ? 'broken' : n.mark === 'pair' ? 'twinned' : n.mark === 'gilded' ? 'gilded'
    : n.cut ? 'chipped' : Math.abs(m.twist) > W.twisted ? 'twisted' : Math.abs(m.bend) > W.bent ? 'bent' : Math.abs(m.shear ?? 0) > W.leaning ? 'leaning'
      : (m.ripAmp ?? 0) > W.ringed ? 'ringed' : (m.lobeAmp ?? 0) > W.lobed ? 'lobed' : (m.swell ?? 0) > W.swollen ? 'swollen' : (m.swell ?? 0) < -W.pinched ? 'pinched'
        : m.lump > W.lumpy ? 'lumpy' : m.smooth >= W.worn ? 'worn' : m.taper > W.flared ? 'flared' : m.taper < -W.narrowing ? 'narrowing' : '';
  const kind = A.kinds[B.kind];
  /** @type {string[]} */ const details = [];
  if (c.bands) details.push(`banded in ${A.colors.bandNames[c.band]}`);
  if (c.patina > 0.4) details.push(kind.patina.word);
  if (c.stain > 0.45) details.push(kind.stain.word);
  if (n.cut && !n.mark && cond !== 'chipped') details.push('with a chip out of one edge');
  if (n.mark && n.mark !== 'gilded') details.push(A.marks[n.mark].word);
  // A pattern word for the name: bands first, then crust, then stains.
  const pattern = c.bands ? `${A.colors.bandNames[c.band]}-banded` : c.patina > 0.4 ? kind.patina.short : c.stain > 0.45 ? kind.stain.short : '';
  const name = cap(`${cond ? cond + ' ' : ''}${pattern ? pattern + ' ' : ''}${colour} ${noun}`);
  const desc = `${cap(`${/^[aeiou]/.test(cond || colour) ? 'an' : 'a'} ${cond ? cond + ' ' : ''}${colour} ${noun}`)}${details.length ? ', ' + details.join(', ') : ''}. ${B.observations[n.observation]}`;
  return { name, noun, colorName: colour, desc };
}

/**
 * The same artifact with its name and description made again from its numbers, for tools that move
 * the numbers by hand (a kept one never needs this: it keeps the name it was given).
 * @param {any} n @param {any} K
 */
export function redescribe(n, K) {
  const A = recipeOf(K);
  return { ...n, ...describe(n, A.artifacts.find((/** @type {any} */ a) => a.id === n.base), A) };
}

/** The card line: the description saved with the numbers. @param {any} n @param {any} _K */
export const artifactWords = (n, _K) => n.desc;

/** @type {Map<string, { vertices: Float32Array, count: number, indices: Uint32Array }>} */
const MEMO = new Map();

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function artifactMesh(n, K) {
  const key = JSON.stringify(n);
  const hit = MEMO.get(key);
  if (hit) return hit;
  const A = recipeOf(K), B = BASES.get(n.base), R = A.artifacts.find((/** @type {any} */ a) => a.id === n.base);
  if (!B) throw new Error(`artifact base ${n.base} not loaded: await loadArtifactBases(K) first`);
  const kind = A.kinds[R.kind], c = n.color;
  const N = B.n;
  // Colours first, on the base's own vertices.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], B.pos[i * 3 + k]); hi[k] = Math.max(hi[k], B.pos[i * 3 + k]); }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
  const moves = { hue: c.hue, chroma: c.chroma, lightMul: c.lightMul, lightAdd: 0, tintHue: c.tintHue, tintChroma: c.tintChroma };
  const ss = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bandC = /** @type {Rgb} */ (A.colors.band[c.band]);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const x = (B.pos[i * 3] - lo[0]) / ext, y = (B.pos[i * 3 + 1] - lo[1]) / ext, z = (B.pos[i * 3 + 2] - lo[2]) / ext;
    /** @type {Rgb} */
    let v = recolor([B.col[i * 3], B.col[i * 3 + 1], B.col[i * 3 + 2]], moves);
    const grain = 1 + c.grain * (((hash32(n.morph.lumpSeed, 999, i) >>> 8) / 16777216) - 0.5);
    v = [v[0] * grain, v[1] * grain, v[2] * grain];
    if (c.patina) v = mix(v, kind.patina.color, ss(0.45, 0.7, noise3(x * 6, y * 6, z * 6, c.patinaSeed)) * c.patina);
    // Stains run in streaks down the piece.
    if (c.stain) v = mix(v, kind.stain.color, ss(0.5, 0.78, noise3(x * 7, y * 1.6, z * 7, c.stainSeed)) * c.stain);
    if (c.bands) {
      const h = (B.pos[i * 3 + 1] - lo[1]) / Math.max(hi[1] - lo[1], 1e-9);
      for (let k = 0; k < c.bands; k++) {
        const at = (((k + 0.5) / c.bands + c.bandPhase * 0.4) % 1);
        if (Math.abs(h - at) < c.bandWidth * 0.5) { v = mix(v, bandC, 0.9); break; }
      }
    }
    if (c.gilt) v = mix(v, A.colors.gold, ss(0.45, 0.85, B.nrm[i * 3 + 1] * 0.5 + 0.5 + (noise3(x * 8, y * 8, z * 8, 77) - 0.5) * 0.5) * c.gilt);
    col[i * 3] = clamp(v[0], 0, 1); col[i * 3 + 1] = clamp(v[1], 0, 1); col[i * 3 + 2] = clamp(v[2], 0, 1);
  }
  // Shape.
  let P = morphPositions(B, n.morph);
  let idx = B.idx, flag = new Uint8Array(N), cutInfo = null;
  if (n.cut) {
    cutInfo = cutPositions(P, n.cut);
    flag = cutInfo.flag;
    for (let i = 0; i < N; i++) if (flag[i]) { const fresh = /** @type {Rgb} */ (kind.fresh), p = mix([col[i * 3], col[i * 3 + 1], col[i * 3 + 2]], fresh, 0.7); col.set(p, i * 3); }
  }
  let colors = col;
  if (n.twin) {
    const w = addTwin(P, col, idx, flag, n.twin.scale, n.twin.yaw);
    P = w.P; colors = w.col; idx = w.idx; flag = w.flag;
    if (cutInfo) cutInfo = { flag, normal: cutInfo.normal };
  }
  const mesh = finish(P, colors, idx, n.sizeM, cutInfo);
  if (MEMO.size > 48) MEMO.delete(/** @type {string} */ (MEMO.keys().next().value));
  MEMO.set(key, mesh);
  return mesh;
}
