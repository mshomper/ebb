// @ts-check
// The movement arena's Hollow layer (H0, October 27, 2026; doc 16, Fighting): what the arena adds on
// the Hollow course (?course=hollow). The Hollow camera (the walker camera with recipes/world/hollow.json
// camera numbers; walls in the way fade to an outline, never pulling the camera in), the lantern as
// health (right mouse held raises it), the staff and its swing on left click, Tab lock-on, and the
// floor dot. The logic the game will reuse lives in src/world/hollow/ (lantern, lock, aim, swing,
// occlude, foes); this file is the page's wiring: it reads the walker and the camera, draws the marks
// on the floor and keeps the tallies. The panel (flame, spawns, swing pick) is hollow-panel.js.

import { createLantern } from '../../src/world/hollow/lantern.js';
import { createLock } from '../../src/world/hollow/lock.js';
import { dotRange, walkDot } from '../../src/world/hollow/aim.js';
import { arcHits, hitsDue } from '../../src/world/hollow/swing.js';
import { inTheWay } from '../../src/world/hollow/occlude.js';
import { pushRing, pushArc, pushDisc, pushSolidEdges } from './props.js';

/** Colours of the marks: drawn unlit (negative), so they read in the dark. Paper, ink, ember. */
// Bright enough to stand out on the lantern-lit floor (the stage tonemaps them like light).
const MARK = { paper: [-4, -3.8, -3.2], ink: [-0.12, -0.15, -0.14], ember: [-5, -2.2, -0.6], miss: [-0.45, -0.43, -0.4] };
const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param {{
 *   HR: any, FR: any, walker: any, camera: any, grid: any, ground: (x: number, z: number) => number, course: any,
 *   motion: any, held: any, DS: number, actors: () => any[], head: () => number[], say: (s: string) => void,
 *   lookRates: () => { degPerPx: number, halfLifeS: number },
 * }} o
 */
export function createHollow(o) {
  const { HR, FR, walker, camera, grid, ground, course, motion } = o;
  const lantern = createLantern(HR.lantern);
  const lock = createLock(HR.lock);
  /** The marks on the floor, fading: a swing's arc, a move's mark. @type {{ draw: (out: number[], k: number) => void, age: number, life: number }[]} */
  let marks = [];
  /** The swing playing: its clip, length, time and hits. @type {{ clip: string, lenS: number, t: number, hits: number[] } | null} */
  let swing = null;
  let swingClip = Object.keys(HR.swing.clips)[0];
  const tally = { hits: 0, side: 0, back: 0, glanced: 0, misses: 0, broke: 0, taken: 0 };
  /** The walk's hit reaction playing (s left), so a hit isn't stacked on a hit. */
  let reeling = 0;
  /** Things standing in for the game's moves (H0b) hook in here: a brace that catches a hit. */
  const hooks = { /** @type {null | ((e: any) => boolean)} */ catchHit: null };

  /** Live stand-ins (not the frog, not broken). */
  const foes = () => o.actors().filter((a) => a.foe && !a.broken);
  const byId = (/** @type {number | null} */ id) => (id === null ? null : foes().find((a) => a.id === id) ?? null);

  /** The lantern's light, where it hangs or is held up (world m). */
  function lampAt() {
    const k = Math.cos(walker.yaw), s = Math.sin(walker.yaw), lift = lantern.lift;
    // Hanging at the left hand, a little ahead; held up, over the head and forward.
    return [walker.x + k * 0.22 + s * (0.12 + 0.25 * lift), walker.y + 0.55 + 0.75 * lift, walker.z - s * 0.22 + k * (0.12 + 0.25 * lift)];
  }
  /** The lantern as the stand-ins read it. */
  function lampState() {
    const p = lampAt();
    return { x: p[0], z: p[2], reachM: lantern.reach(), raised: lantern.raised && lantern.lift > 0.5, snuffed: lantern.snuffed };
  }
  /** Is this ground open to a stand-in? */
  const open = (/** @type {number} */ x, /** @type {number} */ z) => {
    const k = grid.cellAt(x, z);
    return k >= 0 && !grid.blocked[k] && !grid.steep[k] && grid.height[k] > course.waterY - 0.2;
  };

  /** What the lock may take now: each live stand-in, across the view, how far, and whether it is in the light. */
  function candidates() {
    const m = camera.viewProj, reach = lantern.reach() + HR.lantern.glintM, lp = lampAt();
    return foes().map((a) => {
      const y = ground(a.x, a.z) + 0.5;
      const cx = m[0] * a.x + m[4] * y + m[8] * a.z + m[12], cw = m[3] * a.x + m[7] * y + m[11] * a.z + m[15];
      return { id: a.id, sx: cw > 0.05 ? cx / cw : 99, distM: Math.hypot(a.x - walker.x, a.z - walker.z), lockable: lantern.reach() > 0 && Math.hypot(a.x - lp[0], a.z - lp[2]) <= reach };
    });
  }

  /** Where moves go: the locked target, or the floor dot (world x, z), and how far out the dot is. */
  function dot() {
    const t = byId(lock.target);
    if (t) return { x: t.x, z: t.z, locked: true, m: Math.hypot(t.x - walker.x, t.z - walker.z) };
    const e = camera.eye, g = camera.target, gx = g[0] - e[0], gz = g[2] - e[2];
    const pitchDeg = Math.atan2(e[1] - g[1], Math.hypot(gx, gz)) * 180 / Math.PI;
    const r = walkDot(grid, walker.rules, walker.x, walker.z, gx, gz, dotRange(pitchDeg, HR.dot), HR.dot.stepM);
    return { x: r.x, z: r.z, locked: false, m: r.m };
  }

  /** The Hollow camera (move-arena.js CAMERAS.hollow). */
  const cam = {
    start() {
      camera.setGround(HR.camera, o.head());
      camera.twist(walker.yaw + Math.PI - camera.yaw);
    },
    update(/** @type {number} */ dt) {
      const t = byId(lock.target), h = o.head();
      if (!t) { camera.follow(h); return; }
      // Keep you and the target framed: aim part way to it, and turn so it stays ahead of you.
      const F = HR.camera.lockFrame;
      camera.follow([h[0] + (t.x - h[0]) * F.frameShare, h[1], h[2] + (t.z - h[2]) * F.frameShare]);
      // A little off to one side, so you never stand in front of what you are fighting.
      const want = Math.atan2(walker.x - t.x, walker.z - t.z) + F.sideDeg * Math.PI / 180;
      camera.twist(wrap(want - camera.yaw) * Math.min(1, F.turnPerS * dt));
    },
    /** @param {number} dx @param {number} dy */
    look(dx, dy) { const L = o.lookRates(); camera.look(dx, dy, L.degPerPx, L.halfLifeS); },
  };

  /**
   * The keys' way, turned round the target while locked: W and S toward and away from it, A and D
   * round it. @param {number} forward @param {number} right @param {[number, number]} way the plain way
   * @returns {[number, number]}
   */
  function steerWay(forward, right, way) {
    const t = byId(lock.target);
    if (!t) return way;
    const dx = walker.x - t.x, dz = walker.z - t.z, l = Math.hypot(dx, dz);
    if (l < 0.3) return way;
    const rx = dx / l, rz = dz / l;
    const x = -rx * forward + rz * right, z = -rz * forward - rx * right, m = Math.hypot(x, z);
    return m > 1 ? [x / m, z / m] : [x, z];
  }

  /** Left click: swing the staff (the pick list's clip), facing the target when locked. */
  function swingNow() {
    if (swing || reeling > 0 || lantern.out) return false;
    const t = byId(lock.target);
    if (t) walker.face(Math.atan2(t.x - walker.x, t.z - walker.z));
    const c = FR.clips[swingClip];
    const lenS = motion.shoot(swingClip, { mask: c.mask ? FR.mask : undefined, feet: c.feet ?? true, easeS: FR.easeS });
    if (!lenS) return false;
    swing = { clip: swingClip, lenS, t: 0, hits: HR.swing.clips[swingClip].hits };
    return true;
  }

  /** One hit of the swing: the arc on the floor, and what it lands on. */
  function landHit() {
    const S = HR.swing, x = walker.x, z = walker.z, yaw = walker.yaw;
    const on = arcHits(x, z, yaw, foes(), S.reachM, S.arcDeg, (a) => a.size);
    let landed = false;
    for (const a of on) {
      const r = a.foe.take({ kind: 'hit', fromX: x, fromZ: z });
      if (r.glanced) tally.glanced++;
      else if (r.landed) {
        landed = true;
        tally.hits++;
        if (r.side === 'side') tally.side++;
        if (r.side === 'back') tally.back++;
        if (r.broke) tally.broke++;
      }
    }
    if (!on.length) tally.misses++;
    const col = landed ? MARK.ember : on.length ? MARK.paper : MARK.miss;
    marks.push({ age: 0, life: 0.6, draw: (out, k) => pushArc(out, x, z, 0.45, S.reachM, yaw, S.arcDeg, ground, col.map((v) => v * k)) });
  }

  /** What the stand-ins did this frame: strikes on you, calls. @param {any[]} ev */
  function onEvents(ev) {
    for (const e of ev) {
      if (e.type === 'strike' && e.hit) {
        if (hooks.catchHit?.(e)) continue;
        lantern.sip(1);
        tally.taken++;
        reeling = Math.max(reeling, motion.shoot('hit', { feet: FR.clips.hit.feet ?? true, easeS: FR.easeS }) * 0.6);
        swing = null;
        o.say(`Hit: the flame gutters (${Math.round(lantern.fuel)} of ${HR.lantern.fuel} left).`);
      } else if (e.type === 'call') {
        const w = foes().find((a) => a.id === e.id);
        for (const a of foes()) if (a.id !== e.id && w && Math.hypot(a.x - w.x, a.z - w.z) <= HR.foes.watcher.callM) a.foe.take({ kind: 'alert', forS: 6 });
        o.say('The watcher called: everything near it is coming.');
      }
    }
  }

  /** Each frame, after the walker moves. @param {number} dt */
  function update(dt) {
    lantern.update(dt);
    reeling = Math.max(0, reeling - dt);
    const why = lock.update(dt, candidates());
    if (why === 'moved') o.say('Its target broke: the lock moved to the nearest thing in the light.');
    else if (why === 'off') o.say('Its target broke, and nothing else is in the light: the lock is off.');
    else if (why === 'dropped') o.say('Out of the light for 2 s: the lock dropped.');
    if (swing) {
      const t0 = swing.t;
      swing.t += dt;
      for (const _ of hitsDue(swing.hits, swing.lenS, t0, swing.t)) landHit();
      if (swing.t >= swing.lenS) swing = null;
    }
    for (const m of marks) m.age += dt;
    marks = marks.filter((m) => m.age < m.life);
  }

  /** The walker as the stand-ins read it: the lantern, and which ground is open. */
  const youExtra = () => ({ lamp: lampState(), open });

  /**
   * Draw: the marks, the lock ring and the dot (unlit), and what the walker holds; and which solids
   * stand between the eye and you (or the target), faded. @param {number[]} out @param {any[]} solids the course's
   * @returns {Set<number>} the faded solids' indices
   */
  function draw(out, solids) {
    for (const m of marks) m.draw(out, 1 - m.age / m.life);
    const t = byId(lock.target);
    if (t) {
      // The lock: a ring in the journal's ink on a pale halo, never an arrow or a reticle.
      pushRing(out, t.x, t.z, t.size + 0.28, ground, MARK.paper, 0.07);
      pushRing(out, t.x, t.z, t.size + 0.28, ground, MARK.ink, 0.03);
    } else {
      const d = dot();
      pushDisc(out, d.x, d.z, 0.28, ground, MARK.paper);
      pushDisc(out, d.x, d.z, 0.13, ground, MARK.ink);
    }
    const h = o.head(), eye = camera.eye, F = HR.camera.fade;
    /** @type {Set<number>} */ const faded = new Set();
    solids.forEach((s, i) => {
      const y = ground(s.x, s.z);
      if (inTheWay(s, y, eye, [walker.x, walker.y + 0.6, walker.z], F.marginM) || inTheWay(s, y, eye, h, F.marginM)
        || (t && inTheWay(s, y, eye, [t.x, ground(t.x, t.z) + 0.4, t.z], F.marginM))) faded.add(i);
    });
    return faded;
  }

  /** What the walker holds (the staff, the lantern), in world meters. @param {number[]} place [x, y, z, yaw] */
  function heldTris(/** @type {number[]} */ place, /** @type {string} */ staffLook) {
    const lamp = o.held.held(motion, { lantern: true, look: null }, place), staff = o.held.held(motion, { lantern: false, look: staffLook }, place);
    // The stage draws the figure scaled about where it stands; scale what it holds the same way.
    const lift = lantern.lift, k = Math.cos(place[3]), s = Math.sin(place[3]);
    for (const [tris, isLamp] of /** @type {[Float32Array | null, boolean][]} */ ([[lamp, true], [staff, false]])) {
      if (!tris) continue;
      for (let i = 0; i < tris.length; i += 9) {
        for (let j = 0; j < 3; j++) tris[i + j] = place[j] + (tris[i + j] - place[j]) * o.DS;
        // Held up: the lantern rises over the head and forward.
        if (isLamp && lift > 0) { tris[i] += s * 0.25 * lift; tris[i + 1] += 0.75 * lift; tris[i + 2] += k * 0.25 * lift; }
      }
    }
    return [lamp, staff].filter(Boolean);
  }

  /** The faded solids drawn see-through, with an outline. @param {Float32Array[]} solidTris @param {any[]} solids @param {Set<number>} faded */
  function fadedShapes(solidTris, solids, faded) {
    if (!faded.size) return null;
    const fill = [], lines = /** @type {number[]} */ ([]);
    for (const i of faded) { fill.push(solidTris[i]); pushSolidEdges(lines, solids[i], ground(solids[i].x, solids[i].z) - 0.05, [1, 1, 1]); }
    const f = new Float32Array(fill.reduce((n, p) => n + p.length, 0));
    let k = 0;
    for (const p of fill) { f.set(p, k); k += p.length; }
    return { fill: f, lines: new Float32Array(lines) };
  }

  /** Tab, and Esc. @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.code === 'Tab') {
      e.preventDefault();
      const id = lock.press(candidates());
      const a = byId(id);
      o.say(a ? `Locked on the ${HR.foes[a.kind].name.toLowerCase()}. Tab moves to the next, left to right.` : 'Lock off.');
    } else if (e.code === 'Escape' && lock.target !== null) { lock.drop(); o.say('Lock dropped.'); }
  }

  return {
    lantern, lock, cam, tally, hooks, marks: () => marks, foes, byId, dot, lampAt,
    steerWay, swingNow, onEvents, update, youExtra, draw, heldTris, fadedShapes, onKey,
    get swinging() { return !!swing; },
    get reeling() { return reeling > 0; },
    get swingClip() { return swingClip; },
    set swingClip(c) { swingClip = c; },
    /** Push a mark that fades over life seconds (moves use this). @param {number} life @param {(out: number[], k: number) => void} draw */
    mark(life, draw) { marks.push({ age: 0, life, draw }); },
    MARK,
    /** The stage's lantern light for this frame. */
    lamp() {
      const L = HR.lantern;
      return { at: lampAt(), reachM: Math.max(0.01, lantern.reach()), ambient: L.ambient, strength: lantern.out ? 0 : L.strength * (lantern.snuffed ? 0.4 : 1) };
    },
  };
}
