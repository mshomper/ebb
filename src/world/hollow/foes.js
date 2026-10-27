// @ts-check
// The Hollow's things, as steps (doc 16, the bestiary: how each kind behaves; H0, October 27, 2026).
// Every kind runs the same steps: rest, notice, close in, wind-up (its tell), strike, recover (its
// opening). What differs is what makes it notice, its tell and the opening it leaves, each a recipe
// value (recipes/world/hollow.json foes). Three kinds for the move arena, one of each instinct:
//   lunger (a silt crawler): strikes at movement; rears up (H2: in place of rising claws), then a short lunge; stuck after, its
//     back soft; an armored front, so only side and back hits count;
//   watcher (a hagstone watcher): goes toward light; turns to the lantern, its hole glows for the
//     tell, then it calls everything near to it; it turns slowly to look again;
//   motes (soot motes): shy from light; they keep out of the raised lantern's reach, bunch up, dart
//     in and nip, and scatter.
// Moves and the staff reach a thing through one call, take(effect), never its insides; each move
// presses on the thing's one instinct (K.instinct: movement, toward or shy), as doc 16 says: Feint
// draws a striker's attack, Moth lure leads a light-seeker away, Kindling burst throws the light-shy
// back, Groundline trips what stands on the floor, Taproot bursts by size, and so on. Every choice
// is seeded (src/core/rng.js): no Math.random. Pure: the caller gives where you are, the lantern and
// which ground is open.

import { stream } from '../../core/rng.js';

/** @typedef {'rest' | 'notice' | 'close' | 'wind' | 'strike' | 'recover' | 'broken'} Step */

/**
 * The world as a thing reads it this frame.
 * @typedef {{
 *   you: { x: number, z: number, speed: number },
 *   lamp: { x: number, z: number, reachM: number, raised: boolean, snuffed: boolean },
 *   open: (x: number, z: number) => boolean,
 * }} FoeWorld
 */

/**
 * What a thing did this frame: a strike (and whether it landed on you), or a call (where to).
 * A root's burst (Taproot): broke, or cracked and staggered.
 * @typedef {{ type: 'strike', id: number, hit: boolean } | { type: 'call', id: number, x: number, z: number } | { type: 'notice', id: number }
 *   | { type: 'burst', id: number, broke: boolean }} FoeEvent
 */

/**
 * An effect on a thing (the staff, a move). hit: a staff hit from (fromX, fromZ).
 * @typedef {{ kind: string, fromX?: number, fromZ?: number, [k: string]: any }} Effect
 */

const DEG = Math.PI / 180;
/** How long a hit's knockback slides (s). */
const KNOCK_S = 0.12;
/** The angle between two headings, 0..PI. @param {number} a @param {number} b */
const off = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * Which side of a thing a point is on: front, side or back, by how far it is off its facing.
 * @param {number} yaw the thing's facing (+z forward turned by yaw) @param {number} x @param {number} z the thing
 * @param {number} fromX @param {number} fromZ @param {number} sideDeg @param {number} backDeg
 * @returns {'front' | 'side' | 'back'}
 */
export function sideOf(yaw, x, z, fromX, fromZ, sideDeg, backDeg) {
  const a = off(Math.atan2(fromX - x, fromZ - z), yaw) / DEG;
  return a > backDeg ? 'back' : a > sideDeg ? 'side' : 'front';
}

/**
 * A thing in the Hollow. @param {'lunger' | 'watcher' | 'motes'} kind @param {number} id
 * @param {{ x: number, z: number, yaw?: number }} at @param {any} K recipes/world/hollow.json foes[kind] @param {number} seed
 * @param {{ sideDeg: number, backDeg: number }} sides recipes/world/hollow.json swing
 */
export function createFoe(kind, id, at, K, seed, sides) {
  const rnd = stream(seed, id);
  const s = {
    x: at.x, z: at.z, yaw: at.yaw ?? rnd.range(-Math.PI, Math.PI),
    /** @type {Step} */ step: 'rest', t: 0, hp: K.hp,
    /** Where it is going (a lunge's end, a call, a lure). @type {[number, number] | null} */ goal: null,
    /** Alerted by a call: it closes in without needing to notice, for this long (s). */ alertS: 0,
    /** Effects with a time on them (s left). */ slowS: 0, stunS: 0, lureS: 0, /** @type {[number, number] | null} */ lure: null,
    /** A Taproot's root, bursting when t runs out; then its cracks (hits land harder) for crackS. */
    /** @type {{ t: number, share: number, crackS: number, staggerS: number } | null} */ root: null, crackS: 0,
    /** A hit's knockback, sliding it back over KNOCK_S; and how long it shows the hit (s left). */
    /** @type {{ vx: number, vz: number, left: number, world?: { open: (x: number, z: number) => boolean } } | null} */ knock: null, hurtS: 0,
    /** How many hits it has taken, by side. */ hits: { front: 0, side: 0, back: 0 },
    /** What it last did, for the arena's log. */ note: 'Resting.',
  };
  /** Its members' phases (the mote cluster), seeded. */
  const members = kind === 'motes' ? Array.from({ length: K.count ?? 7 }, () => [rnd.range(0, 6.283), rnd.range(0.6, 1.4), rnd.range(0.15, 0.45)]) : [];
  /** @param {Step} step @param {string} [note] */
  const go = (step, note) => { s.step = step; s.t = 0; if (note) s.note = note; };
  /** Turn toward a heading by at most degPerS. @param {number} face @param {number} dt @param {number} degPerS */
  const turn = (face, dt, degPerS) => { const d = Math.atan2(Math.sin(face - s.yaw), Math.cos(face - s.yaw)), m = degPerS * DEG * dt; s.yaw += Math.max(-m, Math.min(m, d)); };
  /** Move by (dx, dz) on open ground, sliding along what blocks it. @param {FoeWorld} w @param {number} dx @param {number} dz */
  const move = (w, dx, dz) => {
    for (const [a, b] of [[dx, dz], [dx, 0], [0, dz]]) if ((a || b) && w.open(s.x + a, s.z + b)) { s.x += a; s.z += b; return true; }
    return false;
  };
  /** Head toward a point at a pace, facing it. @param {FoeWorld} w @param {number} tx @param {number} tz @param {number} mps @param {number} dt @param {number} [stopM] */
  const toward = (w, tx, tz, mps, dt, stopM = 0) => {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d > 1e-6) s.yaw = Math.atan2(dx, dz);
    const step = Math.min(mps * dt, Math.max(0, d - stopM));
    if (step > 0) move(w, (dx / d) * step, (dz / d) * step);
    return d;
  };
  /** Half speed while a Spring chorus holds it. */
  const pace = () => (s.slowS > 0 ? 0.5 : 1);

  /** @param {number} dt @param {FoeWorld} w @returns {FoeEvent[]} */
  function update(dt, w) {
    /** @type {FoeEvent[]} */ const ev = [];
    if (s.step === 'broken') return ev;
    s.slowS = Math.max(0, s.slowS - dt);
    s.alertS = Math.max(0, s.alertS - dt);
    s.lureS = Math.max(0, s.lureS - dt);
    s.crackS = Math.max(0, s.crackS - dt);
    s.hurtS = Math.max(0, s.hurtS - dt);
    if (s.knock) {
      const k = s.knock, step = Math.min(dt, k.left);
      move(w, k.vx * step, k.vz * step);
      if ((k.left -= dt) <= 0) s.knock = null;
    }
    if (s.root && (s.root.t -= dt) <= 0) {
      const r = s.root;
      s.root = null;
      if (r.share >= 1) { go('broken', 'The root burst and broke it apart.'); ev.push({ type: 'burst', id, broke: true }); return ev; }
      s.hp = Math.max(1, s.hp - Math.max(1, Math.round(K.hp * r.share)));
      s.crackS = r.crackS; s.stunS = Math.max(s.stunS, r.staggerS);
      s.note = 'The root burst: cracked and staggered; hits land harder while the cracks show.';
      ev.push({ type: 'burst', id, broke: false });
    }
    if (s.stunS > 0) { s.stunS = Math.max(0, s.stunS - dt); return ev; }
    const t = dt * pace();
    s.t += t;
    const you = w.you, d = Math.hypot(you.x - s.x, you.z - s.z), toYou = Math.atan2(you.x - s.x, you.z - s.z);
    const lampD = Math.hypot(w.lamp.x - s.x, w.lamp.z - s.z);
    if (kind === 'lunger') {
      const sees = s.alertS > 0 || (d < K.noticeM && you.speed > K.moveMps);
      switch (s.step) {
        case 'rest': if (sees) { go('notice', 'Noticed you moving.'); ev.push({ type: 'notice', id }); } break;
        case 'notice': if (s.t >= 0.25) go('close', 'Closing in.'); break;
        case 'close':
          if (d > K.noticeM * 1.6 && s.alertS <= 0) { go('rest', 'Lost you.'); break; }
          toward(w, you.x, you.z, K.closeMps * pace(), dt, K.strikeM * 0.8);
          if (d <= K.strikeM) { s.yaw = toYou; go('wind', 'Rearing up: the tell.'); }
          break;
        case 'wind': if (s.t >= K.windS) { s.goal = [s.x + Math.sin(s.yaw) * K.dashM, s.z + Math.cos(s.yaw) * K.dashM]; go('strike', 'Lunged.'); } break;
        case 'strike': {
          const g = /** @type {[number, number]} */ (s.goal);
          toward(w, g[0], g[1], K.dashM / K.strikeS * pace(), dt);
          if (s.t >= K.strikeS) {
            const hit = Math.hypot(you.x - s.x, you.z - s.z) < K.hitM;
            ev.push({ type: 'strike', id, hit });
            go('recover', hit ? 'Its lunge caught you; now it is stuck, its back soft.' : 'Missed; stuck for a moment, its back soft.');
          }
          break;
        }
        case 'recover': if (s.t >= K.recoverS) go(sees ? 'close' : 'rest', sees ? 'Up again, closing in.' : 'Settled.'); break;
      }
    } else if (kind === 'watcher') {
      // Goes toward light: it sees the lantern within noticeM unless it is snuffed (or moths lead it).
      const lure = s.lureS > 0 && s.lure;
      const sees = !lure && !w.lamp.snuffed && w.lamp.reachM > 0 && lampD < K.noticeM;
      const tx = lure ? lure[0] : w.lamp.x, tz = lure ? lure[1] : w.lamp.z;
      switch (s.step) {
        case 'rest':
          if (lure) { toward(w, tx, tz, K.closeMps * pace(), dt, 0.5); s.note = 'Following the moths.'; break; }
          turn(s.yaw + 0.3, dt, K.turnDegPerS * 0.25);
          if (sees) { go('notice', 'Turned toward your light.'); ev.push({ type: 'notice', id }); }
          break;
        case 'notice': case 'close': {
          if (lure) { go('rest', 'Broke off to follow the moths.'); break; }
          if (!sees) { go('rest', w.lamp.snuffed ? 'Lost you: the light went to an ember.' : 'Lost the light.'); break; }
          turn(Math.atan2(tx - s.x, tz - s.z), dt, K.turnDegPerS * pace());
          const dx = tx - s.x, dz = tz - s.z, l = Math.hypot(dx, dz);
          if (l > K.keepM) move(w, (dx / l) * K.closeMps * t, (dz / l) * K.closeMps * t);
          if (off(Math.atan2(dx, dz), s.yaw) < 12 * DEG) go('wind', 'Its hole glows brighter: the tell.');
          else s.step = 'close';
          break;
        }
        case 'wind':
          if (lure) { go('rest', 'Broke off to follow the moths.'); break; }
          if (!sees) { go('rest', 'Lost you before it could call.'); break; }
          turn(Math.atan2(w.lamp.x - s.x, w.lamp.z - s.z), dt, K.turnDegPerS * pace());
          if (s.t >= K.windS) { ev.push({ type: 'call', id, x: you.x, z: you.z }); go('strike', 'Called everything near to it.'); }
          break;
        case 'strike': if (s.t >= K.strikeS) go('recover', 'Turning slowly to look again.'); break;
        case 'recover': turn(s.yaw + 1, dt, K.turnDegPerS * 0.5 * pace()); if (s.t >= K.recoverS) go('rest'); break;
      }
    } else {
      // Motes: shy from light. Held up, the lantern's reach (and keepOutM past it) is closed to them.
      const keep = w.lamp.raised ? w.lamp.reachM + K.keepOutM : 0;
      const sees = s.alertS > 0 || d < K.noticeM;
      /** Back out of the raised light, if they are in it. */
      const shy = () => {
        if (!keep || lampD >= keep) return false;
        const ux = (s.x - w.lamp.x) / (lampD || 1), uz = (s.z - w.lamp.z) / (lampD || 1);
        move(w, ux * K.closeMps * 1.5 * dt, uz * K.closeMps * 1.5 * dt);
        return true;
      };
      switch (s.step) {
        case 'rest': shy(); if (sees) { go('notice', 'Drifting in at the light\'s edge.'); ev.push({ type: 'notice', id }); } break;
        case 'notice': shy(); if (s.t >= 0.2) go('close'); break;
        case 'close': {
          if (!sees) { go('rest', 'Drifted off.'); break; }
          if (shy()) { s.note = 'Shying from the raised light.'; break; }
          // Close in, but never into the raised light.
          const stop = Math.max(K.strikeM * 0.8, keep ? keep - lampD + d : 0);
          toward(w, you.x, you.z, K.closeMps * pace(), dt, stop);
          if (d <= K.strikeM && !keep) { s.yaw = toYou; go('wind', 'Bunching up tight: the tell.'); }
          else s.note = keep ? 'Held off by the raised light.' : 'Closing in.';
          break;
        }
        case 'wind':
          if (keep && lampD < keep + 0.2) { go('recover', 'Scattered from the raised light.'); break; }
          if (s.t >= K.windS) { s.goal = [s.x + Math.sin(s.yaw) * K.dashM, s.z + Math.cos(s.yaw) * K.dashM]; go('strike', 'Darted in to nip.'); }
          break;
        case 'strike': {
          const g = /** @type {[number, number]} */ (s.goal);
          if (keep && lampD < keep) { go('recover', 'Scattered from the raised light.'); break; }
          toward(w, g[0], g[1], K.dashM / K.strikeS * pace(), dt);
          if (s.t >= K.strikeS) {
            const hit = Math.hypot(you.x - s.x, you.z - s.z) < K.hitM;
            ev.push({ type: 'strike', id, hit });
            go('recover', hit ? 'Nipped you, and scattered.' : 'Missed, and scattered.');
          }
          break;
        }
        case 'recover': {
          // Scatter: away from you for a moment.
          const ux = (s.x - you.x) / (d || 1), uz = (s.z - you.z) / (d || 1);
          if (s.t < K.recoverS * 0.5) move(w, ux * K.closeMps * t, uz * K.closeMps * t);
          if (s.t >= K.recoverS) go(sees ? 'close' : 'rest');
          break;
        }
      }
    }
    return ev;
  }

  /**
   * An effect on it. hit (the staff): lands on its front, side or back; an armored front (frontDeg)
   * glances. Returns what happened. @param {Effect} e
   */
  function take(e) {
    if (s.step === 'broken') return { landed: false, broke: false, side: /** @type {'front'|'side'|'back'} */ ('front') };
    if (e.kind === 'hit') {
      const side = sideOf(s.yaw, s.x, s.z, e.fromX ?? s.x, e.fromZ ?? s.z, sides.sideDeg, sides.backDeg);
      const armored = K.frontDeg !== undefined && side === 'front';
      s.hits[side]++;
      // Every hit pushes it back from the swing: a landed one hard, a glance a little.
      const fx = s.x - (e.fromX ?? s.x), fz = s.z - (e.fromZ ?? s.z), fl = Math.hypot(fx, fz) || 1, push = (K.knockM ?? 0.5) * (armored ? 0.35 : 1);
      s.knock = { vx: (fx / fl) * push / KNOCK_S, vz: (fz / fl) * push / KNOCK_S, left: KNOCK_S, world: e.world };
      if (armored) {
        // A glance still breaks a wind-up, but not a lunge already going.
        s.hurtS = 0.12;
        if (s.step === 'wind') go('recover', 'The hit glanced off its armored front and broke its wind-up.');
        else s.note = 'The hit glanced off its armored front.';
        return { landed: false, broke: false, side, glanced: true };
      }
      s.hp -= (e.power ?? 1) * (s.crackS > 0 ? 2 : 1);
      if (s.hp <= 0) { go('broken', 'Broke into grey sand and motes of light.'); return { landed: true, broke: true, side }; }
      // It flinches: a wind-up or a lunge is broken off, and it is open while it recovers.
      s.hurtS = K.flinchS ?? 0.3;
      s.stunS = Math.max(s.stunS, s.hurtS);
      s.goal = null;
      s.note = `Hit on its ${side}: knocked back.`;
      if (kind === 'motes' || s.step === 'wind' || s.step === 'strike') go('recover', s.note);
      return { landed: true, broke: false, side };
    }
    if (e.kind === 'alert') {
      // A watcher's call: come to where it called from.
      if (kind === 'watcher') return { landed: false };
      s.alertS = e.forS ?? 6;
      if (s.step === 'rest') go('close', 'Answered a watcher\'s call.');
      return { landed: true };
    }
    // The moves (doc 16, Clever or instinctive: each presses on one plain instinct, K.instinct).
    switch (e.kind) {
      case 'reel': {
        // Anchor caught its hit: it rocks back, open.
        const d = Math.hypot(s.x - (e.fromX ?? s.x), s.z - (e.fromZ ?? s.z)) || 1;
        s.goal = null;
        for (let i = 0; i < 6; i++) open(e.world, ((s.x - (e.fromX ?? s.x)) / d) * (e.pushM ?? 1) / 6, ((s.z - (e.fromZ ?? s.z)) / d) * (e.pushM ?? 1) / 6);
        s.stunS = e.forS ?? 1; go('recover', 'Its hit was caught: it reeled back, open.');
        return { landed: true };
      }
      case 'turn': {
        // Hook and turn: spun to face away; a lunge already going goes off the wrong way.
        s.yaw += Math.PI;
        if (s.step === 'strike' && s.goal) s.goal = [2 * s.x - s.goal[0], 2 * s.z - s.goal[1]];
        else { s.stunS = e.openS ?? 1.5; if (s.step === 'wind') go('recover'); }
        s.note = 'Spun to face away: its back and sides are open.';
        return { landed: true };
      }
      case 'stumble':
        // Groundline: whatever stands on the line loses its wind-up. A floating thing is untouched.
        if (K.floats) return { landed: false };
        s.stunS = e.forS ?? 0.8;
        if (s.step === 'wind' || s.step === 'strike') go('recover');
        s.note = 'Stumbled on the crack and lost its wind-up.';
        return { landed: true };
      case 'bind':
        s.stunS = e.forS ?? 3; s.note = 'Bound in threads of light.';
        return { landed: true };
      case 'throw':
        // Kindling burst: light-shy things in the beam are thrown back to its end and stunned.
        if (K.instinct !== 'shy') return { landed: false };
        if (e.world?.open(e.toX, e.toZ) ?? true) { s.x = e.toX; s.z = e.toZ; }
        s.stunS = e.forS ?? 1.5; go('recover', 'Thrown back down the beam, stunned.');
        return { landed: true };
      case 'feint':
        // Feint: a thing that strikes at movement throws its attack at the spot, and is open after.
        if (K.instinct !== 'movement' || s.step === 'strike' || s.step === 'recover') return { landed: false };
        s.yaw = Math.atan2(e.x - s.x, e.z - s.z); s.goal = [e.x, e.z];
        go('strike', 'Fell for the feint: struck at the spot.');
        return { landed: true };
      case 'lure':
        // Moth lure: a thing that goes toward light follows the moths.
        if (K.instinct !== 'toward') return { landed: false };
        s.lure = [e.x, e.z]; s.lureS = e.forS ?? 8;
        if (s.step !== 'rest') go('rest');
        s.note = 'Broke off to follow the moths.';
        return { landed: true };
      case 'root':
        // Taproot: one root at a time; it bursts after burstS by the thing's size.
        if (s.root) return { landed: false };
        s.root = { t: e.burstS ?? 3, share: e.share?.[K.size] ?? 1, crackS: e.crackS ?? 5, staggerS: e.staggerS ?? 1 };
        s.note = 'A seed took root: green cracks spread over it.';
        return { landed: true };
      case 'slow':
        s.slowS = e.forS ?? 6; s.note = 'It hears living water: slowed.';
        return { landed: true };
    }
    return { landed: false };
  }
  /** Move a thing on open ground (an effect's push). @param {FoeWorld | undefined} w @param {number} dx @param {number} dz */
  function open(w, dx, dz) { if (!w || w.open(s.x + dx, s.z + dz)) { s.x += dx; s.z += dz; } }

  return {
    id, kind,
    get x() { return s.x; },
    get z() { return s.z; },
    get yaw() { return s.yaw; },
    get step() { return s.step; },
    /** Seconds into its step. */
    get t() { return s.t; },
    get hp() { return s.hp; },
    get hits() { return s.hits; },
    get note() { return s.note; },
    get broken() { return s.step === 'broken'; },
    /** Seconds left of a stun, a slow and a lure; a root's time to burst (or -1); cracks showing. */
    get stunS() { return s.stunS; },
    get rootS() { return s.root ? s.root.t : -1; },
    /** Showing a hit (s left): the page flashes and tips it back. */
    get hurtS() { return s.hurtS; },
    get crackS() { return s.crackS; },
    get slowS() { return s.slowS; },
    get lureS() { return s.lureS; },
    /** Its size for Taproot. */
    get size() { return K.size; },
    /** The cluster's members' seeded phases [phase, speed, radius] (motes). */
    members,
    update, take,
    /** The tuning objects read live, so sliders change it at once. */
    K,
  };
}

/** @typedef {ReturnType<typeof createFoe>} Foe */
