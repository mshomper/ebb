// @ts-check
// The movement arena's Q and E moves (H0b, October 27, 2026; doc 16, Special moves: Q and E, and Q and
// E: tap to fire). Two pegs, Q and E, each holding one of the twelve rank 1 to 3 moves. Tap to fire:
// the move goes at once, at the lock or the floor dot (or where the walker stands). Ready, then click:
// tapping its key shows the mark at the dot, steering moves it, a left click fires, the key again puts
// it away. Each move runs from recipes/world/hollow-moves.json (src/world/hollow/moves.js: the wind-up,
// active and recovery times and the costs), plays its pose's clip, draws its mark on the floor and
// reaches the stand-ins only through their one call (take). The panel is moves-panel.js.

import { createMoves, inRing, onLine, pickTarget } from '../../src/world/hollow/moves.js';
import { pushRing, pushArc, pushLane, pushDisc, pushBox } from './props.js';

/** Mark colours, unlit: the light's ember, its bright beam, the island's green, the paper and ink. */
// Bright enough to stand out on the lantern-lit floor (the stage tonemaps them like light); ink and scorch are dark.
const C = { ember: [-5, -2.2, -0.6], beam: [-7, -6.4, -4.5], green: [-0.9, -4, -0.8], paper: [-4, -3.8, -3.2], ink: [-0.12, -0.15, -0.14], scorch: [-0.08, -0.05, -0.04], moth: [-6, -5.5, -3.5] };
/** A crack: an ember glow with an ink core. @param {number[]} out @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 @param {(x: number, z: number) => number} ground @param {number} k */
const pushCrack = (out, x0, z0, x1, z1, ground, k) => {
  pushLane(out, x0, z0, x1, z1, 0.3, ground, C.ember.map((v) => v * k));
  pushLane(out, x0, z0, x1, z1, 0.08, ground, C.ink, 16, 0.045);
};
const scale = (/** @type {number[]} */ c, /** @type {number} */ k) => c.map((v) => v * k);

/**
 * @param {{ MR: any, hollow: any, walker: any, motion: any, FC: any, FR: any, R: any, ground: (x: number, z: number) => number, say: (s: string) => void }} o
 *   MR: hollow-moves.json; FC: fight-clips.json; FR: figure.json (the kneel's mask); R: walker.json (the roll, for Back step)
 */
export function createMoveLayer(o) {
  const { MR, hollow, walker, motion, FC, FR, R, ground } = o;
  const moves = createMoves(MR);
  /** @type {Record<'Q' | 'E', string>} */ const pegs = { Q: MR.pegs.Q, E: MR.pegs.E };
  /** 'tap': the key fires; 'ready': the key readies, a click fires. */
  let mode = /** @type {'tap' | 'ready'} */ ('tap');
  /** The peg readied (ready, then click), or null. @type {'Q' | 'E' | null} */
  let readied = null;
  /** The wick snare on the floor (one at a time). @type {{ x: number, z: number } | null} */
  let wick = null;
  /** Moths in the air: where they are, where they go, how long left. @type {{ x: number, z: number, tx: number, tz: number, left: number }[]} */
  let swarms = [];
  /** A crack racing out (Groundline): from, way, how far it has gone, what it already tripped. */
  /** @type {{ x: number, z: number, ux: number, uz: number, m: number, to: number, done: Set<number> } | null} */
  let crack = null;
  /** Anchor's brace is up. */
  let bracing = false;
  /** Back step under way: the facing kept and the roll it borrowed. @type {{ yaw: number, roll: any } | null} */
  let back = null;
  let snuffing = false;

  const M = (/** @type {string} */ id) => MR.moves[id];
  const foes = () => hollow.foes();
  const world = () => ({ open: hollow.youExtra().open });

  /** Where moves aim from here: the lock or the floor dot, and the way to it. */
  function aim() {
    const d = hollow.dot(), dx = d.x - walker.x, dz = d.z - walker.z, l = Math.hypot(dx, dz);
    const ux = l > 0.05 ? dx / l : Math.sin(walker.yaw), uz = l > 0.05 ? dz / l : Math.cos(walker.yaw);
    return { x: d.x, z: d.z, ux, uz, m: l, locked: d.locked };
  }

  /** Where a move would go now: its place, and for a targeted move its target. @param {string} id */
  function placeFor(id) {
    const m = M(id), a = aim();
    if (m.at === 'self') return { x: walker.x, z: walker.z, ux: a.ux, uz: a.uz, target: null };
    if (m.at === 'target') {
      const t = pickTarget(foes(), hollow.lock.target, a, walker, m.reachM, 1.5);
      return { x: t ? t.x : a.x, z: t ? t.z : a.z, ux: a.ux, uz: a.uz, target: t ? t.id : null };
    }
    if (m.at === 'dot') {
      const k = Math.min(1, m.reachM / Math.max(a.m, 1e-6));
      return { x: walker.x + (a.x - walker.x) * k, z: walker.z + (a.z - walker.z) * k, ux: a.ux, uz: a.uz, target: null };
    }
    return { x: walker.x + a.ux * m.reachM, z: walker.z + a.uz * m.reachM, ux: a.ux, uz: a.uz, target: null };
  }

  /** Play a move's clip over its whole time. @param {string} id */
  function playClip(id) {
    const m = M(id), fc = FC.clips[m.clip];
    const mask = fc ? (fc.mask ? FC.mask : undefined) : m.clip === 'squat' ? FR.clips?.shots?.kneel?.mask : undefined;
    motion.shoot(m.clip, { span: m.span, lenS: moves.lengthS(id), mask, feet: fc?.feet ?? true, easeS: Math.min(FC.easeS, moves.lengthS(id) / 3) });
  }

  /** Fire the move on a peg now. @param {'Q' | 'E'} key */
  function fire(key) {
    const id = pegs[key], m = M(id), why = moves.why(id);
    if (why || hollow.lantern.out || hollow.reeling) return false;   // greyed: no buzzer
    const at = placeFor(id);
    if (m.at === 'target' && at.target === null && m.seeds) { o.say(`${m.name}: nothing in reach to take the seed.`); return false; }
    moves.start(id, at);
    if (m.sips) hollow.lantern.sip(m.sips);
    // Face the way it goes (not Back step, which keeps your facing).
    if (id !== 'backStep' && m.at !== 'self') walker.face(Math.atan2(at.ux, at.uz));
    playClip(id);
    readied = null;
    o.say(`${m.name}.`);
    return true;
  }

  /** Its active part begins: what it does. @param {string} id @param {any} at */
  function act(id, at) {
    const m = M(id), all = foes(), sz = (/** @type {any} */ a) => a.size;
    switch (id) {
      case 'anchor': bracing = true; break;
      case 'hookTurn': {
        const t = all.find((a) => a.id === at.target);
        if (t && Math.hypot(t.x - walker.x, t.z - walker.z) <= m.reachM) {
          t.foe.take({ kind: 'turn', openS: m.openS });
          const yaw = Math.atan2(t.x - walker.x, t.z - walker.z) + Math.PI;
          hollow.mark(0.9, (/** @type {number[]} */ out, /** @type {number} */ k) => {
            pushArc(out, t.x, t.z, t.size + 0.35, t.size + 0.48, yaw, 220, ground, scale(C.paper, k));
            const ea = yaw + (110 * Math.PI) / 180, r = t.size + 0.42, ex = t.x + Math.sin(ea) * r, ez = t.z + Math.cos(ea) * r;
            pushLane(out, ex, ez, ex + Math.sin(ea + 2.4) * 0.35, ez + Math.cos(ea + 2.4) * 0.35, 0.1, ground, scale(C.paper, k), 2);
            pushLane(out, ex, ez, ex + Math.sin(ea - 0.8) * 0.35, ez + Math.cos(ea - 0.8) * 0.35, 0.1, ground, scale(C.paper, k), 2);
          });
        } else o.say('Hook and turn: nothing close enough.');
        break;
      }
      case 'groundline': crack = { x: walker.x, z: walker.z, ux: at.ux, uz: at.uz, m: 0, to: m.reachM, done: new Set() }; break;
      case 'castFlame': hollow.mark(m.activeS, (/** @type {number[]} */ out) => pushRing(out, at.x, at.z, m.ringM, ground, C.ember, 0.05)); break;
      case 'wickSnare': wick = { x: walker.x, z: walker.z }; break;
      case 'kindlingBurst': {
        const ex = walker.x + at.ux * m.reachM, ez = walker.z + at.uz * m.reachM;
        for (const { thing } of onLine(all, walker.x, walker.z, ex, ez, m.widthM)) thing.foe.take({ kind: 'throw', toX: ex, toZ: ez, forS: m.stunS, world: world() });
        const x0 = walker.x, z0 = walker.z;
        hollow.mark(m.fadeS, (/** @type {number[]} */ out, /** @type {number} */ k) => pushLane(out, x0, z0, ex, ez, m.widthM, ground, scale(C.beam, k)));
        break;
      }
      case 'backStep': {
        const x0 = walker.x, z0 = walker.z, yaw = walker.yaw;
        back = { yaw, roll: R.steer.roll };
        R.steer.roll = { distM: m.reachM, durS: m.activeS, waitS: 0, carryS: 0 };
        if (!walker.roll(-Math.sin(yaw), -Math.cos(yaw))) { R.steer.roll = back.roll; back = null; }
        const s = Math.sin(yaw + Math.PI / 2) * 0.12, c = Math.cos(yaw + Math.PI / 2) * 0.12;
        hollow.mark(1.2, (/** @type {number[]} */ out, /** @type {number} */ k) => {
          for (const side of [-1, 1]) pushLane(out, x0 + s * side, z0 + c * side, x0 + s * side + Math.sin(yaw) * 0.3, z0 + c * side + Math.cos(yaw) * 0.3, 0.08, ground, scale(C.paper, k), 2);
        });
        break;
      }
      case 'feint': {
        const fx = walker.x + at.ux * m.reachM * 0.6, fz = walker.z + at.uz * m.reachM * 0.6;
        for (const t of inRing(all, walker.x, walker.z, m.drawM, sz)) t.foe.take({ kind: 'feint', x: fx, z: fz });
        const x0 = walker.x, z0 = walker.z, yaw = Math.atan2(at.ux, at.uz);
        hollow.mark(0.7, (/** @type {number[]} */ out, /** @type {number} */ k) => pushArc(out, x0, z0, m.reachM - 0.1, m.reachM, yaw, m.arcDeg, ground, scale(C.paper, 0.6 * k)));
        break;
      }
      case 'snuff': snuffing = true; hollow.lantern.snuff(true); break;
      case 'taproot': break;   // lands when its flight ends
      case 'springChorus': {
        for (const t of inRing(all, walker.x, walker.z, m.reachM, sz)) t.foe.take({ kind: 'slow', forS: m.slowS });
        const x0 = walker.x, z0 = walker.z;
        for (let i = 0; i < 3; i++) hollow.mark(1.6, (/** @type {number[]} */ out, /** @type {number} */ k) => {
          const r = Math.max(0.2, (1 - k) * m.reachM * (1 - i * 0.22));
          pushRing(out, x0, z0, r, ground, scale(C.green, k * 0.8), 0.04);
        });
        break;
      }
      case 'mothLure': swarms.push({ x: walker.x, z: walker.z, tx: at.x, tz: at.z, left: m.lureS }); break;
    }
  }

  /** Its active part ends (a flight lands). @param {string} id @param {any} at */
  function ended(id, at) {
    const m = M(id);
    if (id === 'anchor') bracing = false;
    if (id === 'snuff') endSnuff();
    if (id === 'castFlame') {
      let n = 0;
      for (const t of inRing(foes(), at.x, at.z, m.ringM, (a) => a.size)) { t.foe.take({ kind: 'hit', fromX: at.x, fromZ: at.z }); n++; }
      hollow.mark(m.scorchS, (/** @type {number[]} */ out, /** @type {number} */ k) => pushDisc(out, at.x, at.z, m.ringM * 0.8, ground, scale(C.scorch, k)));
      o.say(n ? `Cast the flame: it burst on ${n}.` : 'Cast the flame: it burst on the floor.');
    }
    if (id === 'taproot') {
      const t = foes().find((a) => a.id === at.target);
      if (t) t.foe.take({ kind: 'root', burstS: m.burstS, share: m.share, crackS: m.crackS, staggerS: m.staggerS });
      else o.say('Taproot: the seed fell and did nothing.');
    }
  }

  function endSnuff() { if (snuffing) { snuffing = false; hollow.lantern.snuff(false); } }

  /** A hit on you during Anchor's brace is caught, and the attacker reels back. @param {any} e */
  hollow.hooks.catchHit = (e) => {
    if (snuffing) { moves.cut(); endSnuff(); }
    if (!bracing) return false;
    const a = foes().find((f) => f.id === e.id);
    a?.foe.take({ kind: 'reel', fromX: walker.x, fromZ: walker.z, forS: M('anchor').reelS, pushM: M('anchor').reelM, world: world() });
    const x0 = walker.x, z0 = walker.z;
    hollow.mark(0.5, (/** @type {number[]} */ out, /** @type {number} */ k) => pushRing(out, x0, z0, M('anchor').ringM, ground, scale(C.ember, 1.4 * k), 0.08));
    o.say('Anchor caught the hit: no fuel lost, and it reeled back open.');
    return true;
  };

  return {
    moves, pegs,
    get mode() { return mode; },
    set mode(m) { mode = m; readied = null; },
    get readied() { return readied; },
    /** Back step under way: the figure plays its own reversed roll, not the walk's. */
    get backStepping() { return !!back; },
    /** Plant and Kneel hold you still while they play (Snuff doesn't: moving ends it). */
    get holdsStill() { const p = moves.playing; return !!p && ['Plant', 'Kneel'].includes(M(p).pose); },
    /** Q or E. @param {KeyboardEvent} e */
    onKey(e) {
      const key = e.code === 'KeyQ' ? 'Q' : e.code === 'KeyE' ? 'E' : null;
      if (!key || e.repeat) return;
      if (mode === 'tap') { fire(key); return; }
      readied = readied === key ? null : moves.why(pegs[key]) ? null : key;
    },
    /** A left click: fires a readied move (and is used up), else false (the staff swings). */
    click() { if (!readied) return false; fire(readied); return true; },
    /** Right after the walker moves: Back step keeps your facing; moving ends Snuff. */
    afterWalker() {
      if (back) walker.face(back.yaw);
      if (snuffing && walker.speed > M('snuff').moveMps) { moves.cut(); endSnuff(); o.say('Snuff ended: you moved.'); }
    },
    /** @param {number} dt */
    update(dt) {
      for (const e of moves.update(dt)) {
        if (e.type === 'active') act(e.id, e.at);
        else if (e.type === 'ended') ended(e.id, e.at);
        else if (e.type === 'done' && e.id === 'backStep' && back) { R.steer.roll = back.roll; back = null; }
      }
      if (crack) {
        const m = M('groundline');
        crack.m = Math.min(crack.to, crack.m + (crack.to / m.activeS) * dt);
        const ex = crack.x + crack.ux * crack.m, ez = crack.z + crack.uz * crack.m;
        for (const { thing } of onLine(foes(), crack.x, crack.z, ex, ez, m.widthM)) if (!crack.done.has(thing.id)) { crack.done.add(thing.id); thing.foe.take({ kind: 'stumble', forS: m.stumbleS }); }
        if (crack.m >= crack.to) {
          const c = crack;
          hollow.mark(1.0, (/** @type {number[]} */ out, /** @type {number} */ k) => pushCrack(out, c.x, c.z, c.x + c.ux * c.to, c.z + c.uz * c.to, ground, k));
          crack = null;
        }
      }
      if (wick) {
        const t = inRing(foes(), wick.x, wick.z, M('wickSnare').ringM, (a) => a.size)[0];
        if (t) {
          t.foe.take({ kind: 'bind', forS: M('wickSnare').bindS });
          const tt = t;
          hollow.mark(M('wickSnare').bindS, (/** @type {number[]} */ out, /** @type {number} */ k) => { for (const r of [0.2, 0.35, 0.5]) pushRing(out, tt.x, tt.z, tt.size + r, ground, scale(C.beam, 0.7 * k), 0.025); });
          o.say('The wick snare caught it: bound in threads of light.');
          wick = null;
        }
      }
      for (const s of swarms) {
        const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz), step = Math.min(d, M('mothLure').driftMps * dt);
        if (d > 1e-3) { s.x += (dx / d) * step; s.z += (dz / d) * step; }
        // Things that go toward light break off and follow the moths.
        for (const a of foes()) if (Math.hypot(a.x - s.x, a.z - s.z) < 14 && (a.foe.lureS ?? 0) < 0.2) a.foe.take({ kind: 'lure', x: s.x, z: s.z, forS: s.left });
        s.left -= dt;
      }
      swarms = swarms.filter((s) => s.left > 0);
    },
    /** The moves' own marks: the wick, the moths, the crack racing out, roots, and a readied move's mark. @param {number[]} out */
    draw(out) {
      const now = performance.now() / 1000;
      if (wick) {
        pushRing(out, wick.x, wick.z, M('wickSnare').ringM, ground, scale(C.ember, 0.45), 0.025);
        const y = ground(wick.x, wick.z);
        pushBox(out, [wick.x, y + 0.1, wick.z], [0.025, 0.1, 0.025], 0, [0.35, 0.3, 0.25]);
        pushBox(out, [wick.x, y + 0.24, wick.z], [0.04, 0.05, 0.04], 0.6, C.ember);
      }
      for (const s of swarms) for (let i = 0; i < 9; i++) {
        const a = now * (1.3 + i * 0.17) + i * 2.1, r = 0.25 + 0.15 * Math.sin(now * 0.9 + i);
        pushBox(out, [s.x + Math.sin(a) * r, ground(s.x, s.z) + 0.9 + Math.sin(a * 1.6 + i) * 0.2, s.z + Math.cos(a) * r], [0.035, 0.012, 0.035], a, C.moth);
      }
      if (crack) pushCrack(out, crack.x, crack.z, crack.x + crack.ux * crack.m, crack.z + crack.uz * crack.m, ground, 1);
      for (const a of foes()) {
        // Taproot's green cracks across the thing, while the root grows and after it bursts.
        if (a.foe.rootS >= 0 || a.foe.crackS > 0) for (let i = 0; i < 5; i++) {
          const ang = i * 1.256 + 0.3, r0 = a.size * 0.3, r1 = a.size + 0.25;
          pushLane(out, a.x + Math.sin(ang) * r0, a.z + Math.cos(ang) * r0, a.x + Math.sin(ang + 0.3) * r1, a.z + Math.cos(ang + 0.3) * r1, 0.05, ground, C.green, 3);
        }
      }
      if (snuffing) pushRing(out, walker.x, walker.z, hollow.lantern.reach(), ground, scale(C.ember, 0.5), 0.03);
      if (bracing) pushRing(out, walker.x, walker.z, M('anchor').ringM, ground, C.paper, 0.05);
      if (readied) {
        // Ready, then click: the mark where it would go, following the dot as you steer.
        const id = pegs[readied], m = M(id), p = placeFor(id);
        if (m.at === 'ahead') pushLane(out, walker.x, walker.z, walker.x + p.ux * m.reachM, walker.z + p.uz * m.reachM, m.widthM ?? 0.5, ground, scale(C.paper, 0.5));
        else if (m.at === 'self') pushRing(out, walker.x, walker.z, m.ringM ?? (m.reachM || 0.8), ground, scale(C.paper, 0.7), 0.04);
        else pushRing(out, p.x, p.z, m.ringM ?? 0.8, ground, scale(C.paper, 0.7), 0.05);
      }
    },
    /** A new floor: once-a-floor moves, seeds, and the floor's wick come back. */
    newFloor() { moves.newFloor(); wick = null; swarms = []; endSnuff(); },
  };
}
