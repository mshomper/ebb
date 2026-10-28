// @ts-check
// How the Q and E moves look (doc 16, Special moves: Q and E; the move effects, Matt, October 27,
// 2026: real light on the cave, moths that look like moths, every move). The moves themselves (what
// they do, their times and costs) are moves.js; this only shows them. Four building blocks, filled
// into the flat arrays of fx-layout.js each frame: real point lights, glowing sparks, glowing threads
// and winged moths, plus floor marks that grow in and fade (handed back as shapes for the arena to
// draw). Every number comes from recipes/world/hollow-move-fx.json. Seeded through core/rng.js, so a
// replay looks the same. Pure: no GPU, safe for tools pages and tests.
//
// Two ways in: cue(name, p) for a one-off (a burst, a flash, a thrown flame), and start(key, kind, p),
// set(key, p), stop(key) for something that lasts (the wick's flame, a root growing, a moth swarm).

import { hash32 } from '../../core/rng.js';
import {
  MAX_FX_LIGHTS, LIGHT_FLOATS, MAX_SPARKS, SPARK_FLOATS, MAX_THREADS, THREAD_FLOATS, MAX_MOTHS, MOTH_FLOATS,
} from './fx-layout.js';

/** @typedef {{ n: number, speed: number[], up: number[], lifeS: number[], size: number[], col: number[], gravity: number, drag: number, stretch: number, spread: number, blink?: number }} SparkSpec */
/** @typedef {{ col: number[], reachM: number, lifeS?: number, curve?: 'flash' | 'hold' | 'pulse', fadeS?: number, flicker?: number, y?: number, pulseHz?: number }} LightSpec */
/** A floor mark for the arena to draw: its shape and numbers, and its colour (linear light) already faded. */
/** @typedef {{ shape: 'ring' | 'disc' | 'arc' | 'lane', x: number, z: number, r?: number, r0?: number, r1?: number, yaw?: number, deg?: number, x1?: number, z1?: number, w?: number, col: number[] }} Mark */

const TAU = Math.PI * 2;
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
const clamp01 = (/** @type {number} */ t) => Math.min(1, Math.max(0, t));
const ease = (/** @type {number} */ t) => 1 - (1 - clamp01(t)) ** 3;

/**
 * @param {any} FX recipes/world/hollow-move-fx.json
 * @param {{ seed?: number, ground: (x: number, z: number) => number }} o
 */
export function createMoveFx(FX, o) {
  const ground = o.ground;
  let n = 0;
  const seed = (o.seed ?? 1) >>> 0;
  /** The next random number, 0..1. */
  const rnd = () => hash32(seed, n++) / 4294967296;
  const range = (/** @type {number[]} */ r) => lerp(r[0], r[1], rnd());
  let clock = 0;

  // ---- sparks: a fixed pool, written straight into the array the GPU reads ----
  const sparks = new Float32Array(MAX_SPARKS * SPARK_FLOATS);
  /** Per spark: age, life, gravity, drag, base alpha, blink rate, base r g b. */
  const sp = new Float32Array(MAX_SPARKS * 9);
  let nSparks = 0;

  /**
   * Throw n sparks from a point. dir: a heading (rad) round which spread (deg) opens; omitted, all round.
   * @param {SparkSpec} S @param {number} x @param {number} y @param {number} z @param {number} [dir] @param {number} [count]
   */
  function burst(S, x, y, z, dir, count) {
    const k = count ?? S.n;
    for (let i = 0; i < k && nSparks < MAX_SPARKS; i++) {
      const half = ((S.spread ?? 360) / 2) * Math.PI / 180;
      const a = (dir ?? rnd() * TAU) + (dir === undefined ? 0 : (rnd() * 2 - 1) * half);
      const v = range(S.speed), j = nSparks++, b = j * SPARK_FLOATS, q = j * 9;
      sparks.set([x, y, z, range(S.size), S.col[0], S.col[1], S.col[2], 1, Math.sin(a) * v, range(S.up), Math.cos(a) * v, S.stretch ?? 0], b);
      sp.set([0, range(S.lifeS), S.gravity ?? 0, S.drag ?? 0, 1, S.blink ?? 0, S.col[0], S.col[1], S.col[2]], q);
    }
  }
  /** Sparks at a rate: carry the remainder so a slow rate still emits. @type {Map<string, number>} */
  const carry = new Map();
  /** @param {string} key @param {number} hz @param {number} dt @param {() => void} emit */
  function rate(key, hz, dt, emit) {
    let c = (carry.get(key) ?? rnd()) + hz * dt;
    while (c >= 1) { emit(); c -= 1; }
    carry.set(key, c);
  }
  /** @param {number} dt */
  function stepSparks(dt) {
    let w = 0;
    for (let i = 0; i < nSparks; i++) {
      const b = i * SPARK_FLOATS, q = i * 9;
      sp[q] += dt;
      const age = sp[q], life = sp[q + 1];
      if (age >= life) continue;
      const drag = Math.exp(-sp[q + 3] * dt);
      sparks[b + 8] *= drag; sparks[b + 10] *= drag;
      sparks[b + 9] = sparks[b + 9] * drag - sp[q + 2] * dt;
      sparks[b] += sparks[b + 8] * dt; sparks[b + 1] += sparks[b + 9] * dt; sparks[b + 2] += sparks[b + 10] * dt;
      // Settle on the floor rather than fall through it.
      const g = ground(sparks[b], sparks[b + 2]) + 0.01;
      if (sparks[b + 1] < g) { sparks[b + 1] = g; sparks[b + 9] = Math.abs(sparks[b + 9]) * 0.25; sparks[b + 8] *= 0.5; sparks[b + 10] *= 0.5; }
      // Fade in fast, out slow; a blink rate twinkles it (the chorus's motes).
      const t = age / life, blink = sp[q + 5] > 0 ? 0.55 + 0.45 * Math.sin(age * sp[q + 5] * TAU + i) : 1;
      sparks[b + 7] = Math.min(1, t * 12) * (1 - t) ** 1.5 * blink;
      if (w !== i) { sparks.copyWithin(w * SPARK_FLOATS, b, b + SPARK_FLOATS); sp.copyWithin(w * 9, q, q + 9); }
      w++;
    }
    nSparks = w;
  }

  // ---- lights: as many as are asked for, the brightest eight drawn ----
  /** @type {{ x: number, y: number, z: number, spec: LightSpec, age: number, life: number, k: number, ph: number }[]} */
  let lights = [];
  const lightOut = new Float32Array(MAX_FX_LIGHTS * LIGHT_FLOATS);
  let nLights = 0;
  /** A light for a while (lifeS) at a point. @param {LightSpec} L @param {number} x @param {number} z @param {number} [y] */
  function flash(L, x, z, y) {
    lights.push({ x, y: y ?? ground(x, z) + (L.y ?? 0.5), z, spec: L, age: 0, life: L.lifeS ?? 0.5, k: 1, ph: rnd() * 100 });
  }
  /** How bright a light is now, 0..1, by its curve and flicker. @param {(typeof lights)[number]} l */
  function strength(l) {
    const L = l.spec, t = l.age / Math.max(1e-3, l.life);
    let k = 1;
    if (L.curve === 'flash') k = Math.min(1, l.age * 30) * (1 - t) ** 2;
    else if (L.curve === 'hold') k = Math.min(1, l.age * 20) * clamp01((l.life - l.age) / Math.max(1e-3, L.fadeS ?? 0.5));
    else if (L.curve === 'pulse') k = Math.min(1, l.age * 10) * (1 - t) * (0.6 + 0.4 * Math.cos(l.age * (L.pulseHz ?? 2) * TAU));
    const f = L.flicker ?? 0, tt = clock + l.ph;
    return k * (1 - f * (0.5 + 0.25 * Math.sin(tt * 23.1) + 0.25 * Math.sin(tt * 37.7 + 1.3)));
  }

  // ---- threads: rebuilt each frame from what holds them ----
  const threads = new Float32Array(MAX_THREADS * THREAD_FLOATS);
  let nThreads = 0;
  /** @param {number[]} a @param {number[]} b @param {number} w @param {number} alpha @param {number[]} col */
  function thread(a, b, w, alpha, col) {
    if (nThreads >= MAX_THREADS) return;
    threads.set([a[0], a[1], a[2], w, b[0], b[1], b[2], alpha, col[0], col[1], col[2], 0], nThreads++ * THREAD_FLOATS);
  }

  // ---- moths ----
  const mothOut = new Float32Array(MAX_MOTHS * MOTH_FLOATS);
  let nMoths = 0;

  // ---- floor marks, flights and things that last ----
  /** @type {{ age: number, life: number, draw: (g: number, k: number) => Mark | Mark[] | null }[]} */
  let marks = [];
  /** A thrown flame or seed: its arc, and what it does on landing. */
  /** @type {{ from: number[], to: number[], t: number, dur: number, arcM: number, head: any, trail: SparkSpec, trailHz: number, light: LightSpec | null, land: () => void, key: string, at: number[] }[]} */
  let flights = [];
  /** Beams sweeping out (Kindling burst). */
  /** @type {{ x0: number, z0: number, x1: number, z1: number, t: number, done: number, key: string, at: number[] }[]} */
  let beams = [];
  /** @type {Map<string, any>} */
  const lasting = new Map();
  /** Swarms of moths, and moths still leaving after their swarm ended. */
  /** @type {any[]} */
  let moths = [];

  /** A mark that lives lifeS, growing in over growS. @param {number} lifeS @param {number} growS @param {(g: number, k: number) => Mark | Mark[] | null} draw */
  const mark = (lifeS, growS, draw) => marks.push({ age: 0, life: lifeS, draw: (g, k) => draw(ease(growS > 0 ? g / growS : 1), k) });
  const scale = (/** @type {number[]} */ c, /** @type {number} */ k) => [c[0] * k, c[1] * k, c[2] * k];
  const gy = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ up) => ground(x, z) + up;

  /** Where along a thrown arc it is. @param {(typeof flights)[number]} f @param {number} t 0..1 */
  const arcAt = (f, t) => [lerp(f.from[0], f.to[0], t), lerp(f.from[1], f.to[1], t) + 4 * f.arcM * t * (1 - t), lerp(f.from[2], f.to[2], t)];

  /** @param {any} C */
  function throwIt(C, /** @type {number[]} */ from, /** @type {number} */ x1, /** @type {number} */ z1, /** @type {() => void} */ land, light = null, /** @type {number | undefined} */ durS = undefined) {
    flights.push({ from, to: [x1, gy(x1, z1, 0.1), z1], t: 0, dur: durS ?? C.flightS, arcM: C.arcM, head: C.head, trail: C.trail, trailHz: C.trailHz ?? C.trailRateHz, light, land, key: `f${n}`, at: from.slice() });
  }

  const cues = {
    /** Anchor goes up: dust at the feet and a pale ring drawn in. @param {any} p { x, z } */
    'anchor.brace'(p) {
      const A = FX.anchor;
      burst(A.dust, p.x, gy(p.x, p.z, 0.05), p.z);
      mark(0.8, A.ring.growS, (g, k) => ({ shape: 'ring', x: p.x, z: p.z, r: 0.7 * (0.4 + 0.6 * g), w: A.ring.widthM, col: scale(A.ring.col, k * 0.7) }));
    },
    /** Anchor catches a hit: a flash and sparks toward the one that struck. @param {any} p { x, z, tx, tz } */
    'anchor.catch'(p) {
      const A = FX.anchor, dir = Math.atan2(p.tx - p.x, p.tz - p.z);
      burst(A.catchSparks, p.x + Math.sin(dir) * 0.4, gy(p.x, p.z, 0.9), p.z + Math.cos(dir) * 0.4, dir);
      flash(A.catchLight, p.x, p.z);
      mark(0.5, 0.06, (g, k) => ({ shape: 'ring', x: p.x, z: p.z, r: 0.7 + 0.25 * g, w: 0.08, col: scale(FX.castFlame.ring.col, 1.2 * k) }));
    },
    /** Hook and turn: a pale arc swept round the thing as it turns. @param {any} p { x, z, r, yaw } */
    'hookTurn'(p) {
      const H = FX.hookTurn;
      mark(0.9, H.sweepS, (g, k) => ({ shape: 'arc', x: p.x, z: p.z, r0: p.r, r1: p.r + H.widthM, yaw: p.yaw - (1 - g) * 1.9, deg: 220 * g, col: scale(H.col, k) }));
      burst(H.chips, p.x, gy(p.x, p.z, 0.3), p.z, p.yaw + 1.6);
    },
    /** Groundline's crack has reached its end: it glows a moment along its length. @param {any} p { x0, z0, x1, z1 } */
    'groundline.end'(p) { flash(FX.groundline.glowLight, (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2); },
    /** Cast the flame leaves the hand. @param {any} p { from: [x, y, z], x, z, ringM, scorchS, flightS (else the recipe's) } */
    'castFlame.throw'(p) {
      const C = FX.castFlame;
      throwIt(C, p.from, p.x, p.z, () => cues['castFlame.burst'](p), C.flightLight, p.flightS);
    },
    /** Cast the flame lands: a burst, embers, a flash and a glow that lingers on the scorch. @param {any} p { x, z, ringM, scorchS } */
    'castFlame.burst'(p) {
      const C = FX.castFlame, y = gy(p.x, p.z, 0.15);
      burst(C.burst, p.x, y, p.z); burst(C.embers, p.x, y, p.z);
      flash(C.burstLight, p.x, p.z);
      flash({ ...C.glowLight, lifeS: p.scorchS ?? C.glowLight.lifeS }, p.x, p.z);
      const r = p.ringM ?? 1.3;
      mark(0.6, C.ring.growS, (g, k) => ({ shape: 'ring', x: p.x, z: p.z, r: r * (0.3 + 0.7 * g), w: C.ring.widthM * (1 + g), col: scale(C.ring.col, k) }));
      mark(p.scorchS ?? 3, 0.1, (g, k) => [
        { shape: 'disc', x: p.x, z: p.z, r: r * 0.8 * g, col: scale(C.scorch.col, k) },
        { shape: 'disc', x: p.x, z: p.z, r: r * 0.45 * g, col: scale(C.ring.col, 0.35 * k * k) },
      ]);
    },
    /** Kindling burst: a beam sweeps out from the lantern. @param {any} p { x0, z0, x1, z1, fadeS, widthM } */
    'kindlingBurst'(p) {
      const K = FX.kindlingBurst;
      beams.push({ x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, t: 0, done: 0, key: `b${n}`, at: [] });
      flash(K.originLight, p.x0, p.z0);
      const life = (p.fadeS ?? 1.2) + K.sweepS;
      mark(life, K.sweepS, (g, k) => ({ shape: 'lane', x: p.x0, z: p.z0, x1: lerp(p.x0, p.x1, g), z1: lerp(p.z0, p.z1, g), w: (p.widthM ?? 1.6) * 0.6, col: scale(K.lane.col, 0.5 * k * k) }));
    },
    /** Back step: dust kicked forward of the feet. @param {any} p { x, z, yaw } */
    'backStep'(p) { burst(FX.backStep.dust, p.x, gy(p.x, p.z, 0.05), p.z, p.yaw); },
    /** Feint: a faint arc swept quickly, a few pale motes. @param {any} p { x, z, yaw, r, arcDeg } */
    'feint'(p) {
      const F = FX.feint;
      mark(0.6, F.sweepS, (g, k) => ({ shape: 'arc', x: p.x, z: p.z, r0: p.r - F.widthM, r1: p.r, yaw: p.yaw, deg: p.arcDeg * g, col: scale(F.col, 0.7 * k) }));
      burst(F.motes, p.x + Math.sin(p.yaw) * p.r * 0.8, gy(p.x, p.z, 0.7), p.z + Math.cos(p.yaw) * p.r * 0.8, p.yaw);
    },
    /** Snuff: the flame drops to an ember, a puff of sparks leaves it. @param {any} p { x, y, z } */
    'snuff.out'(p) { burst(FX.snuff.puff, p.x, p.y, p.z); },
    /** Taproot's seed leaves the hand. @param {any} p { from, x, z } */
    'taproot.throw'(p) { throwIt(FX.taproot, p.from, p.x, p.z, () => {}, null, p.flightS); },
    /** Taproot bursts: green sparks, drifting spores and a green flash. @param {any} p { x, z, size } */
    'taproot.burst'(p) {
      const T = FX.taproot, y = gy(p.x, p.z, 0.4);
      burst(T.burst, p.x, y, p.z); burst(T.burstSpores, p.x, y, p.z);
      flash(T.burstLight, p.x, p.z);
      mark(0.7, 0.12, (g, k) => ({ shape: 'ring', x: p.x, z: p.z, r: (p.size ?? 0.5) + 0.9 * g, w: 0.06, col: scale(T.burst.col, 0.5 * k) }));
    },
    /** Spring chorus: green rings roll out, a green pulse of light, motes lift like spring evenings. @param {any} p { x, z, r } */
    'springChorus'(p) {
      const S = FX.springChorus;
      for (let i = 0; i < S.rings; i++) {
        const delay = i * S.ringGapS;
        mark(S.ringS + delay, 0, (_g, k) => {
          const age = (1 - k) * (S.ringS + delay) - delay;
          if (age < 0) return null;
          const t = clamp01(age / S.ringS);
          return { shape: 'ring', x: p.x, z: p.z, r: Math.max(0.2, ease(t) * p.r), w: S.widthM, col: scale(S.col, (1 - t) * 0.9) };
        });
      }
      flash(S.pulseLight, p.x, p.z);
      for (let i = 0; i < S.motes.n; i++) {
        const a = rnd() * TAU, r = Math.sqrt(rnd()) * p.r, x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
        burst(S.motes, x, gy(x, z, 0.1 + rnd() * 0.3), z, undefined, 1);
      }
    },
  };

  /** Things that last: their kinds, what starts them and what each frame does. */
  const kinds = {
    /** Wick snare's little flame on the floor. */
    wick: {
      begin: (/** @type {any} */ p) => ({ ...p }),
      step(/** @type {any} */ s, /** @type {number} */ dt, /** @type {string} */ key) {
        const W = FX.wickSnare;
        rate(key, W.flameRateHz, dt, () => burst(W.flame, s.x, gy(s.x, s.z, 0.25), s.z));
        light(W.flameLight, s.x, s.z, 1, s);
      },
    },
    /** Threads of light wound round a bound thing. */
    bind: {
      begin: (/** @type {any} */ p) => ({ ...p, age: 0 }),
      step(/** @type {any} */ s, /** @type {number} */ dt) {
        const W = FX.wickSnare, T = W.threads;
        s.age += dt;
        const grow = ease(s.age / T.growS), fade = clamp01((s.forS - s.age) / 0.4);
        const h = T.heightM * grow, rr = (s.r ?? 0.5) + 0.15;
        for (let j = 0; j < T.count; j++) {
          let prev = null;
          for (let i = 0; i <= T.segments; i++) {
            const u = i / T.segments, a = (j / T.count) * TAU + u * T.turns * TAU * (j % 2 ? 1 : -1) + s.age * T.spinPerS;
            const r = rr * (1 - 0.25 * Math.sin(u * Math.PI)), x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r;
            const pnt = [x, ground(s.x, s.z) + 0.05 + u * h, z];
            if (prev) thread(prev, pnt, T.widthM, fade * (0.6 + 0.4 * Math.sin(u * Math.PI)), T.col);
            prev = pnt;
          }
        }
        light(W.bindLight, s.x, s.z, fade, s);
        if (s.age >= s.forS) { burst(W.snap, s.x, gy(s.x, s.z, 0.5), s.z); return false; }
        return true;
      },
    },
    /** Groundline's crack tip racing out: sparks and chips, and its light running with it. */
    crackTip: {
      begin: (/** @type {any} */ p) => ({ ...p }),
      step(/** @type {any} */ s, /** @type {number} */ dt, /** @type {string} */ key) {
        const G = FX.groundline;
        rate(key, G.tipRateHz, dt, () => { burst(G.tipSparks, s.x, gy(s.x, s.z, 0.03), s.z); if (rnd() < 0.5) burst(G.chips, s.x, gy(s.x, s.z, 0.03), s.z); });
        light(G.tipLight, s.x, s.z, 1, s);
      },
    },
    /** Snuff: the lantern an ember, shedding the odd spark. */
    snuff: {
      begin: (/** @type {any} */ p) => ({ ...p }),
      step(/** @type {any} */ s, /** @type {number} */ dt, /** @type {string} */ key) { rate(key, FX.snuff.emberRateHz, dt, () => burst(FX.snuff.ember, s.x, s.y, s.z)); },
    },
    /** A Taproot root growing in a thing: spores lifting, a slow green pulse. */
    root: {
      begin: (/** @type {any} */ p) => ({ ...p, age: 0 }),
      step(/** @type {any} */ s, /** @type {number} */ dt, /** @type {string} */ key) {
        const T = FX.taproot;
        s.age += dt;
        rate(key, T.rootRateHz, dt, () => { const a = rnd() * TAU, r = (s.size ?? 0.5) * rnd(); burst(T.spores, s.x + Math.sin(a) * r, gy(s.x, s.z, 0.3), s.z + Math.cos(a) * r); });
        light(T.rootLight, s.x, s.z, 0.55 + 0.45 * Math.sin(s.age * (T.rootLight.pulseHz ?? 1.4) * TAU), s);
      },
    },
    /** A moth swarm drawn out of the lantern to a point. */
    swarm: {
      begin(/** @type {any} */ p) {
        const M = FX.mothLure, s = { ...p, moths: /** @type {any[]} */ ([]) };
        for (let i = 0; i < M.count; i++) {
          const m = {
            x: p.from[0] + (rnd() - 0.5) * 0.2, y: p.from[1] + (rnd() - 0.5) * 0.2, z: p.from[2] + (rnd() - 0.5) * 0.2,
            vx: (rnd() - 0.5) * 2, vy: rnd() * 1.5, vz: (rnd() - 0.5) * 2,
            phase: rnd() * TAU, hz: range(M.flapHz), span: range(M.wingspanM), orbit: range(M.orbitM), ow: range(M.orbitPerS) * (rnd() < 0.5 ? -1 : 1),
            oa: rnd() * TAU, hover: range(M.hoverY), yaw: 0, bank: 0, wob: rnd() * 100, leave: -1, delay: i * 0.035,
          };
          s.moths.push(m); moths.push(m);
        }
        return s;
      },
      step(/** @type {any} */ s, /** @type {number} */ dt, /** @type {string} */ key) {
        const M = FX.mothLure;
        for (const m of s.moths) { m.cx = s.x; m.cz = s.z; }
        rate(key, M.dustRateHz, dt, () => { const m = s.moths[Math.floor(rnd() * s.moths.length)]; if (m) burst(M.dust, m.x, m.y, m.z); });
        light(M.light, s.x, s.z, 1, s);
      },
      end(/** @type {any} */ s) { for (const m of s.moths) m.leave = 0; },
    },
  };

  /** A light held each frame by something lasting (added fresh each frame, life of one frame). */
  /** @param {LightSpec} L @param {number} x @param {number} z @param {number} k @param {any} owner */
  function light(L, x, z, k, owner) {
    owner.ph ??= rnd() * 100;
    lights.push({ x, y: gy(x, z, L.y ?? 0.5), z, spec: { ...L, curve: undefined }, age: 0, life: 1e9, k, ph: owner.ph, held: true });
  }

  /** @param {any} m @param {number} dt */
  function stepMoth(m, dt) {
    const M = FX.mothLure;
    if (m.delay > 0) { m.delay -= dt; return true; }
    m.oa += m.ow * dt;
    let tx, ty, tz;
    if (m.leave >= 0) {
      m.leave += dt;
      // Away and up, out of the light: each flies off its own way.
      tx = m.x + Math.sin(m.wob) * 4; ty = m.y + 2; tz = m.z + Math.cos(m.wob) * 4;
      if (m.leave >= M.leaveS) return false;
    } else {
      const t = clock + m.wob;
      tx = m.cx + Math.sin(m.oa) * m.orbit + Math.sin(t * 1.7) * 0.15 * M.wander;
      ty = gy(m.cx, m.cz, m.hover) + Math.sin(t * 2.3) * 0.18 * M.wander;
      tz = m.cz + Math.cos(m.oa) * m.orbit + Math.cos(t * 1.3) * 0.15 * M.wander;
    }
    const dx = tx - m.x, dy = ty - m.y, dz = tz - m.z, d = Math.hypot(dx, dy, dz) || 1;
    const spd = Math.min(M.flyMps, d * 3 + 0.4);
    const k = Math.min(1, M.turnPerS * dt);
    // A moth's flight: steered toward its spot, with a jitter of its own each beat.
    const j = M.wander * 1.5;
    m.vx += ((dx / d) * spd - m.vx) * k + (rnd() - 0.5) * j * dt * 10;
    m.vy += ((dy / d) * spd - m.vy) * k + (rnd() - 0.5) * j * dt * 10;
    m.vz += ((dz / d) * spd - m.vz) * k + (rnd() - 0.5) * j * dt * 10;
    m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
    m.y = Math.max(m.y, gy(m.x, m.z, 0.2));
    const yaw = Math.atan2(m.vx, m.vz);
    let dyaw = yaw - m.yaw; dyaw -= Math.round(dyaw / TAU) * TAU;
    m.yaw += dyaw * Math.min(1, dt * 12);
    m.bank += (Math.max(-0.7, Math.min(0.7, -dyaw * 4)) - m.bank) * Math.min(1, dt * 6);
    // Faster beats while it flies hard, and a little climb flutter.
    m.phase += m.hz * TAU * dt * (0.8 + 0.4 * Math.min(1, Math.hypot(m.vx, m.vz) / M.flyMps));
    return true;
  }

  return {
    /** A one-off. @param {keyof typeof cues} name @param {any} p */
    cue(name, p) { cues[name]?.(p); },
    /** Something that lasts, under a key of your own. @param {string} key @param {keyof typeof kinds} kind @param {any} p */
    start(key, kind, p) { this.stop(key); lasting.set(key, { kind, s: kinds[kind].begin(p) }); },
    /** Move it (or change its numbers). @param {string} key @param {any} p */
    set(key, p) { const l = lasting.get(key); if (l) Object.assign(l.s, p); },
    /** End it (moths leave; a flame goes out). @param {string} key */
    stop(key) {
      const l = lasting.get(key);
      if (!l) return;
      /** @type {any} */ (kinds[l.kind]).end?.(l.s);
      lasting.delete(key); carry.delete(key);
    },
    /** Is it still going? @param {string} key */
    has: (/** @type {string} */ key) => lasting.has(key),
    /** Everything cleared (a new floor). */
    clear() {
      for (const k of [...lasting.keys()]) this.stop(k);
      nSparks = 0; nThreads = 0; nMoths = 0; nLights = 0; lights = []; marks = []; flights = []; beams = []; moths = []; carry.clear();
    },
    /** @param {number} dt */
    update(dt) {
      clock += dt;
      lights = lights.filter((l) => !(/** @type {any} */ (l).held) && (l.age += dt) < l.life);
      nThreads = 0;
      for (const f of flights) {
        const t0 = f.t;
        f.t = Math.min(1, f.t + dt / f.dur);
        rate(f.key, f.trailHz, dt, () => { const u = lerp(t0, f.t, rnd()), p = arcAt(f, u); burst(f.trail, p[0], p[1], p[2]); });
        f.at = arcAt(f, f.t);
        if (f.t >= 1) { carry.delete(f.key); f.land(); }
      }
      flights = flights.filter((f) => f.t < 1);
      const K = FX.kindlingBurst;
      for (const b of beams) {
        b.t = Math.min(1, b.t + dt / K.sweepS);
        const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), want = len * b.t;
        // Sparks shed along the beam as it reaches each meter.
        while (b.done < want) { const u = b.done / Math.max(len, 1e-3), x = lerp(b.x0, b.x1, u), z = lerp(b.z0, b.z1, u); burst(K.sparks, x, gy(x, z, K.fromY * (1 - u * 0.6)), z, undefined, 1); b.done += 1 / K.sparksPerM; }
        b.at = [lerp(b.x0, b.x1, b.t), 0, lerp(b.z0, b.z1, b.t)];
        if (b.t >= 1) { flash({ ...K.sweepLight, lifeS: 0.5, curve: 'flash' }, b.x1, b.z1); carry.delete(b.key); }
      }
      beams = beams.filter((b) => b.t < 1);
      for (const [key, l] of [...lasting]) {
        const more = /** @type {any} */ (kinds[l.kind]).step(l.s, dt, key);
        if (more === false) { lasting.delete(key); carry.delete(key); }
      }
      stepSparks(dt);
      moths = moths.filter((m) => stepMoth(m, dt));
      for (const m of marks) m.age += dt;
      marks = marks.filter((m) => m.age < m.life);
    },
    /** The frame's lights, sparks, threads and moths, in fx-layout.js's shapes. */
    gpu() {
      // Lights from flights and beams this frame, then the brightest eight.
      const K = FX.kindlingBurst;
      /** @type {{ x: number, y: number, z: number, col: number[], reachM: number, k: number }[]} */
      const all = lights.map((l) => ({ x: l.x, y: l.y, z: l.z, col: l.spec.col, reachM: l.spec.reachM, k: strength(l) * l.k }));
      for (const f of flights) if (f.light) all.push({ x: f.at[0], y: f.at[1], z: f.at[2], col: f.light.col, reachM: f.light.reachM, k: 1 - (f.light.flicker ?? 0) * 0.5 * (1 + Math.sin(clock * 31)) * 0.5 });
      for (const b of beams) if (b.t < 1) all.push({ x: b.at[0], y: gy(b.at[0], b.at[2], K.sweepLight.y), z: b.at[2], col: K.sweepLight.col, reachM: K.sweepLight.reachM, k: 1 });
      all.sort((a, b) => b.k * (b.col[0] + b.col[1] + b.col[2]) * b.reachM - a.k * (a.col[0] + a.col[1] + a.col[2]) * a.reachM);
      lightOut.fill(0);
      nLights = Math.min(MAX_FX_LIGHTS, all.length);
      for (let i = 0; i < nLights; i++) { const l = all[i]; lightOut.set([l.x, l.y, l.z, l.reachM, l.col[0] * l.k, l.col[1] * l.k, l.col[2] * l.k, 0], i * LIGHT_FLOATS); }
      // The thrown heads and the beam are drawn as sparks and threads of their own this frame.
      let ns = nSparks;
      for (const f of flights) if (ns < MAX_SPARKS) {
        const p = f.at, b = ns++ * SPARK_FLOATS, d = arcAt(f, Math.min(1, f.t + 0.05));
        sparks.set([p[0], p[1], p[2], f.head.size, f.head.col[0], f.head.col[1], f.head.col[2], 1, (d[0] - p[0]) * 20, (d[1] - p[1]) * 20, (d[2] - p[2]) * 20, 0.025], b);
      }
      for (const b of beams) {
        const a = [b.x0, gy(b.x0, b.z0, K.fromY), b.z0], e = [b.at[0], gy(b.at[0], b.at[2], K.fromY * 0.5), b.at[2]];
        thread(a, e, K.beam.widthM, 0.8, K.beam.col);
        thread(a, e, K.core.widthM, 1, K.core.col);
      }
      nMoths = 0;
      for (const m of moths) {
        if (nMoths >= MAX_MOTHS || m.delay > 0) continue;
        const shrink = m.leave >= 0 ? 1 - clamp01(m.leave / FX.mothLure.leaveS) : 1;
        mothOut.set([m.x, m.y, m.z, m.yaw, m.phase, m.span * shrink, FX.mothLure.glow * shrink, m.bank], nMoths++ * MOTH_FLOATS);
      }
      return { lights: lightOut, nLights, sparks, nSparks: ns, threads, nThreads, moths: mothOut, nMoths };
    },
    /** The floor marks this frame, faded and grown. @returns {Mark[]} */
    marks() {
      /** @type {Mark[]} */ const out = [];
      for (const m of marks) {
        const k = 1 - m.age / m.life, d = m.draw(m.age, k);
        if (Array.isArray(d)) out.push(...d); else if (d) out.push(d);
      }
      return out;
    },
    /** How much is live (the lab's readout). */
    get counts() { return { sparks: nSparks, lights: lights.length, threads: nThreads, moths: moths.length, marks: marks.length }; },
  };
}
