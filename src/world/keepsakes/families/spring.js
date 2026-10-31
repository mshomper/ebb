// @ts-check
// Keepsakes from the spring's pool (the pan finds, Matt, October 31, 2026): new forms in families the
// shelf already has, told apart by gen 'spring'. Stone: a rock crystal (a clear quartz point), garnet
// sand (red grains), a cave pearl (a polished calcite ball, rare) and a fleck of gold (once ever).
// Fossil: crinoid beads (stem pieces of a sea lily). And the old keeper's three lost things (gen
// 'keeper', family artifact): a copper thimble, a bone button, a small iron key. Each is drawn from
// a seed, built in code, and says a plain line. Numbers: recipes/world/keepsakes.json spring. Pure.

import { builder } from '../../finds/procedural.js';
import { hash32 } from '../../../core/rng.js';

/** A seeded share 0..1. @param {number} h @param {number} k */
const u = (h, k) => (hash32(h, k) >>> 8) / 16777216;
/** Which family each spring form belongs to. */
export const SPRING_FAMILY = Object.freeze({ crystal: 'stone', garnet: 'stone', pearl: 'stone', gold: 'stone', crinoid: 'fossil', thimble: 'artifact', button: 'artifact', key: 'artifact' });
const RARITY = Object.freeze({ crystal: 'uncommon', crinoid: 'uncommon', garnet: 'uncommon', pearl: 'rare', gold: 'lifetime', thimble: 'rare', button: 'rare', key: 'rare' });

/**
 * A spring keepsake's numbers. @param {string} form @param {number} h0 a seed @param {any} K keepsakes.json
 * @returns {any}
 */
export function springNumbers(form, h0, K) {
  const S = K.spring[form];
  return { family: SPRING_FAMILY[/** @type {'crystal'} */ (form)], gen: form in { thimble: 1, button: 1, key: 1 } ? 'keeper' : 'spring', form, rarity: RARITY[/** @type {'crystal'} */ (form)],
    sizeM: S.sizeM[0] + (S.sizeM[1] - S.sizeM[0]) * u(h0, 1), seed: hash32(h0, 2) >>> 0, tint: (u(h0, 3) - 0.5) * 0.2, mark: null, view: [20, 50] };
}

/** Is a keepsake one of these? @param {any} n */
export const isSpring = (n) => n?.gen === 'spring' || n?.gen === 'keeper';

/** Its card line. @param {any} n @param {any} K */
export const springWords = (n, K) => K.spring[n.form]?.word ?? '';

/**
 * A lumpy ball (the pearl, a garnet grain, a crinoid bead), sz across at (cx, cy, cz).
 * @param {ReturnType<typeof builder>} b @param {number[]} c centre @param {number[]} r radii @param {number[]} col @param {number} lump @param {number} seed
 */
function ball(b, c, r, col, lump, seed) {
  const LAT = 6, LON = 10, base = [];
  for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) {
    const th = (i / LAT) * Math.PI, ph = (j / LON) * Math.PI * 2;
    const k = 1 + lump * (u(seed, i * 31 + j) - 0.5);
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    base.push(b.vert([c[0] + n[0] * r[0] * k, c[1] + n[1] * r[1] * k, c[2] + n[2] * r[2] * k], n, col));
  }
  for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
    const a = base[i * (LON + 1) + j], q = base[(i + 1) * (LON + 1) + j];
    b.tri(a, q, a + 1); b.tri(a + 1, q, q + 1);
  }
}

/**
 * A prism with a pointed end along +x (the crystal), or flat ends (the key's shank): sides round,
 * from x0 to x1, radius r, tip length tip. @param {ReturnType<typeof builder>} b
 */
function prism(b, sides, x0, x1, r, tip, col, y = 0, z = 0) {
  const ring = (/** @type {number} */ x, /** @type {number} */ rr) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return b.vert([x, y + Math.cos(a) * rr, z + Math.sin(a) * rr], [0, Math.cos(a), Math.sin(a)], col);
  });
  const A = ring(x0, r), B = ring(x1, r);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; b.tri(A[i], B[i], A[j]); b.tri(A[j], B[i], B[j]); }
  const end = b.vert([x1 + tip, y, z], [1, 0, 0], col), start = b.vert([x0, y, z], [-1, 0, 0], col);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; b.tri(B[i], end, B[j]); b.tri(A[j], start, A[i]); }
}

/** A spring keepsake's mesh, its real size. @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function springMesh(n, K) {
  const S = K.spring[n.form], col = S.color.map((/** @type {number} */ c) => c * (1 + n.tint)), b = builder(), s = n.sizeM;
  if (n.form === 'crystal') {
    // A clear six-sided point, a little tipped up, on a broken base.
    prism(b, 6, -s * 0.5, s * 0.25, s * 0.16, s * 0.25, col, s * 0.16);
  } else if (n.form === 'garnet') {
    // A little heap of red grains.
    for (let i = 0; i < 9; i++) {
      const a = u(n.seed, i) * Math.PI * 2, d = u(n.seed, i + 20) * s * 0.35;
      ball(b, [Math.cos(a) * d, s * 0.08 + (i % 3) * s * 0.04, Math.sin(a) * d], [s * 0.12, s * 0.1, s * 0.12], col, 0.4, n.seed + i);
    }
  } else if (n.form === 'pearl') {
    ball(b, [0, s / 2, 0], [s / 2, s / 2, s / 2], col, 0.03, n.seed);
  } else if (n.form === 'gold') {
    // A thin flake, crinkled.
    ball(b, [0, s * 0.06, 0], [s / 2, s * 0.05, s * 0.36], col, 0.5, n.seed);
  } else if (n.form === 'crinoid') {
    // Five stem beads in a row, each a ridged disc with a hole's dimple.
    for (let i = 0; i < 5; i++) ball(b, [(i - 2) * s * 0.2, s * 0.12, 0], [s * 0.08, s * 0.12, s * 0.12], col.map((c) => c * (0.9 + 0.2 * u(n.seed, i))), 0.15, n.seed + i);
  } else if (n.form === 'thimble') {
    // A short dimpled copper cup, mouth down.
    const LAT = 5, LON = 14, base = [];
    for (let i = 0; i <= LAT; i++) for (let j = 0; j <= LON; j++) {
      const t = i / LAT, ph = (j / LON) * Math.PI * 2, r = (s * 0.5) * (t < 0.8 ? 0.8 + 0.2 * (1 - t) : Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2)) * 0.84);
      const dim = 1 - 0.04 * ((i + j) % 2);
      base.push(b.vert([Math.cos(ph) * r * dim, t * s * 0.9, Math.sin(ph) * r * dim], [Math.cos(ph), 0.3, Math.sin(ph)], col));
    }
    for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) { const a = base[i * (LON + 1) + j], q = base[(i + 1) * (LON + 1) + j]; b.tri(a, q, a + 1); b.tri(a + 1, q, q + 1); }
  } else if (n.form === 'button') {
    // A flat bone disc with four holes' dimples.
    ball(b, [0, s * 0.08, 0], [s / 2, s * 0.08, s / 2], col, 0.04, n.seed);
    for (let i = 0; i < 4; i++) ball(b, [Math.cos(i * 1.571) * s * 0.12, s * 0.16, Math.sin(i * 1.571) * s * 0.12], [s * 0.04, s * 0.01, s * 0.04], col.map((c) => c * 0.5), 0, n.seed);
  } else {
    // The key: a ring bow, a shank and a bit.
    ball(b, [-s * 0.38, s * 0.04, 0], [s * 0.14, s * 0.04, s * 0.14], col, 0.05, n.seed);
    prism(b, 6, -s * 0.26, s * 0.4, s * 0.035, 0, col, s * 0.04);
    ball(b, [s * 0.36, s * 0.04, s * 0.07], [s * 0.05, s * 0.035, s * 0.07], col, 0.1, n.seed + 1);
  }
  return b.done();
}
