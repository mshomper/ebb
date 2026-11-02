// @ts-check
// The stack's layout and shape (docs/future/19, 'The stack'): where the sea stack stands, its ground
// and paint as it stands (a terraced rock in the Cliff tool's language: a sheer core, ledges stepping
// up one side, a foot apron above every tide on the landward side and a cleft in its face where the
// cave mouth is), the no-build ring round it, and the causeway's shape. Pure: the seed, the land
// recipe's `stack` block and recipes/setpieces/stack.json in, numbers out, so a tools page, a test and
// the game all see the same stack. Uses only hash32, det math and + - * /, Math.sqrt, Math.abs,
// Math.min/max, as the landform does.

import { hash32, det } from '../../core/rng.js';
import { makeFbm, fbm, islandCenter, shoreBearings } from '../terrain/landform.js';
import { WORLD_ORIGIN, WORLD_CELLS, CELL } from '../terrain/grid.js';
import { landBox } from '../islet/layout.js';

const DEG = det.PI / 180;
const WORLD_END = WORLD_ORIGIN + WORLD_CELLS * CELL;
const L_SIDE = 1, L_LOBE = 2, L_DETAIL = 3, L_THRIFT = 4, L_ROAD = 5, L_BOULDER = 6, L_CRAG = 7, L_TIER = 8;

/**
 * @typedef {Object} Box @property {number} x0 @property {number} z0 @property {number} x1 @property {number} z1
 * @typedef {Object} StackLayout
 * @property {number} x @property {number} z     the stack's middle (m)
 * @property {number} ux @property {number} uz   outward, from the island's middle toward it
 * @property {number} vx @property {number} vz   across (ux, uz turned a quarter left)
 * @property {number} sideDeg                    its bearing from the island's middle
 * @property {number} noBuildM                   the no-build ring's radius
 * @property {[number, number]} shore            where the island's own ground first reaches the sea on its line
 * @property {[number, number]} foot             the apron's landward edge, where the causeway ends
 * @property {[number, number]} mouth            the back of the cleft, the cave mouth
 * @property {[number, number]} stand            where you stand at the mouth, facing in
 * @property {number} apronM                     the apron's (and the cleft floor's) height
 * @property {number} reachM                     how far from its middle the rock reaches above the sea (core, ledges, apron)
 * @property {Box} box                           everything it touches, skirt and all
 */

/** Smallest angle between two bearings (degrees). @param {number} a @param {number} b */
const apart = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
/** @param {number} t */
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * Where the stack stands: on the open-sea side farthest round from where the meadow islet rises (it
 * rises late for some players, and the two never crowd one another), offshoreM out from the island's
 * shore on that line (further, up to maxOffshoreM, until its rock clears the open land, so the
 * brushes' ground and the shaped-ground readers never hold it), turned a little by the seed. Null
 * when no side fits.
 * @param {any} S the land recipe's stack block @param {any} land the land recipe
 * @param {number} terrainSeed subSeed(world, 'terrain') @param {number} seed subSeed(world, 'stack')
 * @param {(x: number, z: number) => number} base the island's ground as generated
 * @param {number | null} isletDeg the meadow islet's bearing (src/world/islet/layout.js), null if none
 * @returns {StackLayout | null}
 */
export function stackLayout(S, land, terrainSeed, seed, base, isletDeg) {
  const c = islandCenter(land), m = S.edgeMarginM ?? 2;
  const ledges = S.ledges * S.ledgeM * (1 + (S.ledgeJitter ?? 0)) + S.coreWobbleM * 0.5;
  const reach = S.coreM + S.coreWobbleM + Math.max(ledges, S.apron.outM) + (S.cragM ?? 0), skirt = reach + S.seaFallM;
  const away = shoreBearings(land, terrainSeed), isle = landBox(land);
  const rockR = S.coreM + S.coreWobbleM + Math.max(S.apron.outM, S.ledges * S.ledgeM) + 1;
  /** How far a point lies from the open land's box (m, 0 inside). @param {number} x @param {number} z */
  const fromIsle = (x, z) => Math.hypot(Math.max(isle.x0 - x, 0, x - isle.x1), Math.max(isle.z0 - z, 0, z - isle.z1));
  /** @type {{ deg: number, shoreR: number, out: number, score: number }[]} */ const fits = [];
  S.sidesDeg.forEach((/** @type {number} */ side, /** @type {number} */ i) => {
    const deg = side + S.jitterDeg * ((hash32(seed, L_SIDE, i) >>> 8) / 8388607.5 - 1);
    const ux = det.cos(deg * DEG), uz = det.sin(deg * DEG);
    // The shore on this line: walking in from far out, the first ground at the sea's level.
    let shoreR = 0;
    for (let r = (land.falloffEnd ?? 60) + 10; r > 0; r -= 0.5) if (base(c.x + ux * r, c.z + uz * r) >= 0) { shoreR = r; break; }
    let out = S.offshoreM;
    while (out < S.maxOffshoreM && fromIsle(c.x + ux * (shoreR + out), c.z + uz * (shoreR + out)) < rockR) out += 0.5;
    const clear = fromIsle(c.x + ux * (shoreR + out), c.z + uz * (shoreR + out)) >= rockR;
    const x = c.x + ux * (shoreR + out), z = c.z + uz * (shoreR + out);
    if (x - skirt < WORLD_ORIGIN + m || x + skirt > WORLD_END - m || z - skirt < WORLD_ORIGIN + m || z + skirt > WORLD_END - m) return;
    // Away from the islet first; then, of two as far, the one the camp looks less straight out at.
    const score = (clear ? 1e4 : 0) + (isletDeg === null ? 180 : apart(deg, isletDeg)) * 10 + (away.campDeg === null ? 0 : apart(deg, away.campDeg) / 100);
    fits.push({ deg, shoreR, out, score });
  });
  if (!fits.length) return null;
  fits.sort((a, b) => b.score - a.score);
  const { deg, shoreR, out } = fits[0], ux = det.cos(deg * DEG), uz = det.sin(deg * DEG), vx = -uz, vz = ux;
  const x = c.x + ux * (shoreR + out), z = c.z + uz * (shoreR + out);
  const rFace = S.coreM + lobeWobble(S, seed, det.PI);
  /** @param {number} d @returns {[number, number]} */
  const back = (d) => [x - ux * d, z - uz * d];
  return {
    x, z, ux, uz, vx, vz, sideDeg: deg, noBuildM: S.noBuildM,
    shore: [c.x + ux * shoreR, c.z + uz * shoreR],
    foot: back(rFace + S.apron.outM - 0.4), mouth: back(rFace - S.cleft.depthM + 0.45), stand: back(rFace - S.cleft.depthM + 1.2),
    apronM: S.apron.heightM, reachM: reach,
    box: { x0: Math.max(WORLD_ORIGIN, x - skirt), z0: Math.max(WORLD_ORIGIN, z - skirt), x1: Math.min(WORLD_END, x + skirt), z1: Math.min(WORLD_END, z + skirt) },
  };
}

/** The core's outline wobble at an angle round from seaward (m). @param {any} S @param {number} seed @param {number} phi */
function lobeWobble(S, seed, phi) {
  let w = 0;
  for (let i = 0; i < S.lobes; i++) {
    const a = ((hash32(seed, L_LOBE, i) >>> 8) / 16777216) * det.PI * 2, k = (((hash32(seed, L_LOBE, i, 1) >>> 8) / 16777216) - 0.5) * 2 / (i + 1);
    w += k * det.sin((i + 2) * phi + a);
  }
  return S.coreWobbleM * w;
}

/**
 * The stack as it stands: ground height and paint shares at a world point, or -Infinity where it
 * does not reach (the seabed stays as it is).
 * @param {StackLayout} L @param {any} S the land recipe's stack block @param {number} seed subSeed(world, 'stack') @param {number} seabedM
 */
export function makeStackShape(L, S, seed, seabedM) {
  const detail = makeFbm(seed, L_DETAIL, { scale: 0.35, octaves: 3, lacunarity: 2, gain: 0.5 });
  const thriftN = makeFbm(seed, L_THRIFT, { scale: 0.5, octaves: 2, lacunarity: 2, gain: 0.5 });
  const cragN = makeFbm(seed, L_CRAG, { scale: S.cragScale, octaves: 3, lacunarity: 2.1, gain: 0.55 });
  const u01 = (/** @type {number} */ k, /** @type {number} */ j) => (hash32(seed, L_TIER, k, j) >>> 8) / 16777216;
  // Each ledge its own width, its own height off the even steps, and its own wobble round the rock.
  const tiers = Array.from({ length: S.ledges }, (_, i) => ({
    reach: S.ledgeM * (1 - S.ledgeJitter + 2 * S.ledgeJitter * u01(i, 1)),
    lift: (u01(i, 2) - 0.5) * 2 * S.ledgeLiftM, seed: hash32(seed, L_TIER, i, 3),
  }));
  const reachOf = (/** @type {number} */ k) => tiers.slice(0, k).reduce((s, t) => s + t.reach, 0);
  const N = S.ledges, H = S.heightM, soft = S.faceSoftM, A = S.apron, C = S.cleft;
  const phiL = det.PI - S.ledgeTurnDeg * DEG, cosSpread = det.cos(S.ledgeSpreadDeg * DEG);
  const rFace = S.coreM + lobeWobble(S, seed, det.PI);
  const faceStep = (/** @type {number} */ d) => smooth(-soft / 2, soft / 2, d);
  /** Local frame: a seaward, b across, r out from the middle, phi round from seaward. @param {number} x @param {number} z */
  const local = (x, z) => {
    const dx = x - L.x, dz = z - L.z, a = dx * L.ux + dz * L.uz, b = dx * L.vx + dz * L.vz;
    return { a, b, r: Math.sqrt(a * a + b * b), phi: det.atan2(b, a) };
  };
  /** How far the ledges reach out on this side (0..1). @param {number} phi */
  const ledgeShare = (phi) => smooth(0, 1, clamp01((det.cos(phi - phiL) - cosSpread) / (1 - cosSpread)));
  return {
    /** @param {number} x @param {number} z */
    heightAt(x, z) {
      const { a, b, r, phi } = local(x, z);
      if (r > L.reachM + S.seaFallM + 1) return -Infinity;
      const core = S.coreM + lobeWobble(S, seed, phi), w = ledgeShare(phi);
      // Craggy faces: the outline pushed in and out by noise, never in front of the mouth.
      const quiet = a < 0 && Math.abs(b) < A.halfWidthM + 0.5 ? 0 : 1, rr = r - S.cragM * fbm(cragN, x, z) * quiet;
      const edge = Math.max(core + reachOf(N) * w, a < 0 && Math.abs(b) < A.halfWidthM + 1 ? rFace + A.outM : 0);
      // The skirt: weed-hung rock just under the waves, falling to the seabed.
      let h = S.skirtTopM + (seabedM - S.skirtTopM) * smooth(0, 1, (r - edge) / S.seaFallM);
      if (r <= edge + soft) h = Math.max(h, S.skirtTopM);
      // The apron at the foot of the landward face: above every tide, where the causeway lands.
      const inApron = Math.min(rFace + A.outM - r, A.halfWidthM - Math.abs(b), -a);
      h = h + (A.heightM - h) * faceStep(inApron);
      // The ledges, lowest first, then the core: level shelves with sheer faces between.
      const n = S.detailM * fbm(detail, x, z);
      for (let k = N; k >= 1; k--) {
        const T = tiers[k - 1], hk = (H * (N + 1 - k)) / (N + 1) + T.lift + n;
        const wob = lobeWobble(S, T.seed, phi) * 0.8;
        h = h + (hk - h) * faceStep(core + (reachOf(k) + wob) * w - rr);
      }
      h = h + (H + n - h) * faceStep(core - rr);
      // The cleft in the landward face, down to the apron: the way to the cave mouth.
      const inCleft = Math.min(C.widthM / 2 - Math.abs(b), -a - (rFace - C.depthM), rFace + 0.6 + a);
      h = h + (A.heightM + n * 0.3 - h) * faceStep(inCleft);
      return h;
    },
    /**
     * Paint shares [grass, sand, rock, soil] for ground standing at height h there: bare rock, with
     * thrift and campion (a thin grass) on the ledges' tops, the soot band near the top, sand in the deep skirt.
     * @param {number} x @param {number} z @param {number} h
     */
    paintAt(x, z, h) {
      if (h < seabedM + 1) return [0, 0.6, 0.4, 0];
      if (h < 1.5) return [0, 0.05, 0.95, 0];
      // The band of old soot on the core's face just under its top (only the face stands there: the
      // top ledge is lower), where the light was kept: the dark earth layer, patchy.
      const B = S.soot, band = B ? smooth(H - B.fromM, H - B.fromM + 0.3, h) * (1 - smooth(H - B.toM - 0.2, H - B.toM, h)) : 0;
      if (band > 0) { const k = band * B.share * (0.75 + 0.25 * fbm(thriftN, x * 2, z * 2)); return [0, 0, 1 - k, k]; }
      const t = S.thrift * smooth(-0.1, 0.4, fbm(thriftN, x, z));
      return [t, 0, 1 - t, 0];
    },
    /** Is a point on the stack's own rock (core, ledges, apron, cleft), above the sea? @param {number} x @param {number} z */
    onRock(x, z) {
      const { a, b, r, phi } = local(x, z);
      const edge = S.coreM + lobeWobble(S, seed, phi) + reachOf(N) * ledgeShare(phi) + S.cragM;
      return r <= edge + 0.5 || (a < 0 && Math.abs(b) < A.halfWidthM + 0.5 && r <= rFace + A.outM + 0.5);
    },
  };
}

/**
 * The causeway as it will stand: a spine of weed-covered boulders from the land to the stack's foot,
 * its top above the highest tide, a little uneven, its sides falling to the seabed in lumps.
 * @param {[number, number]} from where it leaves the land @param {[number, number]} to the stack's foot
 * @param {any} R recipes/setpieces/stack.json road @param {number} seed subSeed(world, 'stack') @param {number} seabedM
 */
export function makeCauseway(from, to, R, seed, seabedM) {
  const wander = makeFbm(seed, L_ROAD, { scale: 0.08, octaves: 2, lacunarity: 2, gain: 0.5 });
  const boulder = makeFbm(seed, L_BOULDER, { scale: R.boulderScale, octaves: 2, lacunarity: 2.2, gain: 0.5 });
  const [ax, az] = from, [bx, bz] = to, vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1, len = Math.sqrt(l2);
  const reach = R.halfWidthM * (1 + R.flare) + R.wobbleM + R.shoulderM;
  /** @param {number} x @param {number} z */
  const frame = (x, z) => {
    const along = ((x - ax) * vx + (z - az) * vz) / l2, t = clamp01(along);
    return { along, t, past: (along - t) * len, side: ((x - ax) * vz - (z - az) * vx) / len };
  };
  const pad = reach + 1;
  return {
    reach,
    box: { x0: Math.min(ax, bx) - pad, z0: Math.min(az, bz) - pad, x1: Math.max(ax, bx) + pad, z1: Math.max(az, bz) + pad },
    /** How far along it a point lies, 0 at the land to 1 at the stack (the rise sweeps along this). @param {number} x @param {number} z */
    along: (x, z) => frame(x, z).t,
    /** Is a point on its walking top? @param {number} x @param {number} z @param {number} [extraM] */
    onTop(x, z, extraM = 0) { const f = frame(x, z); return Math.abs(f.past) < 0.5 && Math.abs(f.side) < R.halfWidthM + extraM; },
    /** Its final ground there (m), or -Infinity where it does not reach. @param {number} x @param {number} z */
    heightAt(x, z) {
      const f = frame(x, z);
      if (Math.abs(f.side) > reach || Math.abs(f.past) > reach) return -Infinity;
      const ends = smooth(0, 0.15, f.t) * smooth(1, 0.85, f.t);
      const off = Math.hypot(f.side - R.wobbleM * ends * fbm(wander, f.t * len, 0), f.past);
      const half = R.halfWidthM * (1 + R.flare * (1 - ends));
      const bump = R.boulderM * fbm(boulder, x, z);
      if (off <= half) return R.topM + R.crownM * (1 - (off / half) ** 2) + bump;
      const k = smooth(0, 1, (off - half) / R.shoulderM);
      return R.topM + bump * 2 + (seabedM - R.topM) * k + R.sideLumpM * fbm(boulder, x * 0.7 + 31, z * 0.7) * (1 - k);
    },
    /** Paint shares: wet rock, a little sand at the shoulders' foot. @param {number} x @param {number} z @param {number} h */
    paintAt(x, z, h) { return h < seabedM + 1.2 ? [0, 0.5, 0.5, 0] : [0, 0.08, 0.92, 0]; },
  };
}

/**
 * Where the causeway leaves the land at the moment it rises: walking back from the stack's foot
 * toward the island's middle, the first ground at its top (raised land is kept out of the ring, so
 * that is the island's own shore). @param {StackLayout} L @param {{ x: number, z: number }} c the island's middle
 * @param {(x: number, z: number) => number} ground the ground now @param {number} topM @returns {[number, number]}
 */
export function causewayFrom(L, c, ground, topM) {
  const dx = c.x - L.foot[0], dz = c.z - L.foot[1], d = Math.hypot(dx, dz) || 1;
  for (let s = 1; s < d; s += 0.25) {
    const x = L.foot[0] + (dx / d) * s, z = L.foot[1] + (dz / d) * s;
    if (ground(x, z) >= topM) return [x, z];
  }
  return [L.shore[0], L.shore[1]];
}

/** Is a world point inside a box? @param {Box} b @param {number} x @param {number} z */
export const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
