// @ts-check
// The silt crawler's bits of light and sand (H2, doc 16): the sparks when a hit glances off its shell
// plate, and when it breaks, grey sand that falls and settles and motes of light that rise (never a
// body left behind). Seeded (src/core/rng.js): the same break throws the same sand. Pure: the caller
// gives the ground. Numbers: recipes/world/hollow.json foes.lunger.crawler (motion.glance, breakup;
// look.spark, look.silt).

import { stream } from '../../core/rng.js';

/** Floats a bit for the pass: x, y, z, size; r, g, b, alpha; glow (0 lit, 1 its own light), 0, 0, 0. */
export const DUST_FLOATS = 12;
const GRAVITY = 9.8;

/**
 * @typedef {{ x: number, y: number, z: number, vx: number, vy: number, vz: number, age: number, life: number, size: number,
 *   kind: 'spark' | 'sand' | 'mote', wob: number }} Bit
 */

/** @param {number} seed */
export function createDust(seed) {
  /** @type {Bit[]} */ let bits = [];
  let bursts = 0;

  /**
   * A glance's sparks, flung off the plate at (x, y, z) away along (ox, oz). @param {any} G motion.glance
   * @param {number} x @param {number} y @param {number} z @param {number} ox @param {number} oz
   */
  function sparks(G, x, y, z, ox, oz) {
    const rnd = stream(seed, 0x737061, bursts++);
    for (let i = 0; i < G.sparks; i++) {
      const a = rnd.range(-1.2, 1.2), up = rnd.range(0.2, 1.1), v = G.sparkMps * rnd.range(0.5, 1.2);
      const c = Math.cos(a), s = Math.sin(a);
      bits.push({ x, y, z, vx: (ox * c - oz * s) * v, vy: up * v, vz: (ox * s + oz * c) * v, age: 0, life: G.sparkS * rnd.range(0.6, 1.2), size: G.sparkSizeM * rnd.range(0.6, 1.2), kind: 'spark', wob: 0 });
    }
  }

  /**
   * The break: sand from points of its body (world), and motes of light. @param {any} Bk motion.breakup
   * @param {number[][]} from world points on the body
   */
  function breakup(Bk, from) {
    const rnd = stream(seed, 0x62726b, bursts++);
    for (let i = 0; i < Bk.sand.count; i++) {
      const p = from[rnd.int(from.length)], a = rnd.range(0, Math.PI * 2), v = Bk.sand.mps * rnd.range(0.2, 1);
      bits.push({ x: p[0], y: p[1], z: p[2], vx: Math.sin(a) * v, vy: rnd.range(0, 0.8) * v, vz: Math.cos(a) * v, age: 0, life: Bk.sand.lifeS * rnd.range(0.7, 1.1), size: Bk.sand.sizeM * rnd.range(0.6, 1.3), kind: 'sand', wob: 0 });
    }
    for (let i = 0; i < Bk.motes.count; i++) {
      const p = from[rnd.int(from.length)];
      bits.push({ x: p[0], y: p[1], z: p[2], vx: rnd.range(-0.1, 0.1), vy: Bk.motes.riseMps * rnd.range(0.6, 1.3), vz: rnd.range(-0.1, 0.1), age: -rnd.range(0, 0.4), life: Bk.motes.lifeS * rnd.range(0.7, 1.1), size: Bk.motes.sizeM * rnd.range(0.6, 1.2), kind: 'mote', wob: rnd.range(0, 6.28) });
    }
  }

  /** @param {number} dt @param {(x: number, z: number) => number} ground */
  function update(dt, ground) {
    for (const b of bits) {
      b.age += dt;
      if (b.age < 0) continue;
      if (b.kind === 'mote') {
        b.x += (b.vx + Math.sin(b.age * 2.3 + b.wob) * 0.08) * dt; b.y += b.vy * dt; b.z += (b.vz + Math.cos(b.age * 1.9 + b.wob) * 0.08) * dt;
        continue;
      }
      b.vy -= GRAVITY * dt * (b.kind === 'spark' ? 0.6 : 1);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const g = ground(b.x, b.z) + b.size * 0.3;
      if (b.y < g) {
        // Sand settles where it lands; a spark skips and dies.
        b.y = g; b.vy = b.kind === 'spark' ? -b.vy * 0.3 : 0;
        const f = b.kind === 'sand' ? Math.exp(-dt * 14) : 0.7;
        b.vx *= f; b.vz *= f;
      }
    }
    bits = bits.filter((b) => b.age < b.life);
  }

  /** The bits for the pass, DUST_FLOATS each. @param {any} C foes.lunger.crawler */
  function out(C) {
    const f = new Float32Array(bits.length * DUST_FLOATS), L = C.look;
    bits.forEach((b, i) => {
      const life = Math.max(0, b.age) / b.life;
      const col = b.kind === 'spark' ? L.spark : b.kind === 'mote' ? L.knob.map((/** @type {number} */ v) => v * C.motion.breakup.motes.glowNits) : L.silt.map((/** @type {number} */ v) => v * 1.9 + 0.08);
      const alpha = b.age < 0 ? 0 : b.kind === 'sand' ? Math.min(1, (1 - life) * 3) : b.kind === 'mote' ? Math.sin(Math.PI * life) : 1 - life;
      f.set([b.x, b.y, b.z, b.size * (b.kind === 'spark' ? 1 - life * 0.5 : 1), ...col, alpha, b.kind === 'sand' ? 0 : 1, 0, 0, 0], i * DUST_FLOATS);
    });
    return f;
  }

  return { sparks, breakup, update, out, get count() { return bits.length; }, get bits() { return bits; } };
}
