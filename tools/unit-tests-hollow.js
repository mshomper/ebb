// @ts-check
// The Hollow's fighting logic (H0, the move arena; docs/future/16-the-sea-cave.md, Fighting) for
// tools/unit-tests.html: the floor dot's range from the camera's tilt and its walk along the walk grid
// stopping before a wall or a drop; Tab lock-on (nearest the middle, left to right, off after the last,
// moving on when a target breaks, dropping after 2 s out of the light); the lantern as health; the
// staff's arc and which side a hit lands on; walls in the way; and the stand-ins' steps (a lunger's
// tell and lunge, a watcher's call, motes held off by the raised light), seeded and repeatable. H0b:
// the Q and E moves' timings and costs (waits, the gentler Hollow, once a floor, seeds, Snuff cut
// short) and how each reaches a thing by its instinct.

import { dotRange, walkDot } from '../src/world/hollow/aim.js';
import { createLock } from '../src/world/hollow/lock.js';
import { createLantern } from '../src/world/hollow/lantern.js';
import { arcHits, hitsDue } from '../src/world/hollow/swing.js';
import { inTheWay } from '../src/world/hollow/occlude.js';
import { createFoe, sideOf } from '../src/world/hollow/foes.js';
import { createMoves } from '../src/world/hollow/moves.js';
import { HOLLOW_ICONS } from '../src/ui/icons/icons-hollow.js';
import { createWalkGrid } from '../src/world/walk/grid.js';
import { createSolids } from '../src/world/walk/solids.js';

const G = 'hollow';
const DT = 1 / 60;
const recipe = async () => (await fetch('../recipes/world/hollow.json')).json();
const moveRecipe = async () => (await fetch('../recipes/world/hollow-moves.json')).json();

/** A flat floor 20 m square with a wall across it at x = 4 and a drop (a pit) at z = -4. */
function floor() {
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => (z < -4 ? -2 : 0.3);
  const grid = createWalkGrid({ ground, minX: -10, minZ: -10, maxX: 10, maxZ: 10, cellM: 0.5, maxSlopeDeg: 35 });
  const solids = createSolids(0.2);
  solids.set([{ x: 4.2, z: 0, hw: 0.2, hd: 6, yaw: 0, id: 'wall' }]);
  solids.mark(grid);
  const rules = { depth: () => 0, wadeM: 0.4, wadeCost: 2, maxStepM: 0.45, snapM: 3 };
  const open = (/** @type {number} */ x, /** @type {number} */ z) => { const k = grid.cellAt(x, z); return k >= 0 && !grid.blocked[k] && !grid.steep[k]; };
  return { ground, grid, rules, open };
}

/** Run a thing for some seconds against a still world; returns its events. @param {any} f @param {any} w @param {number} s */
function runFor(f, w, s) {
  /** @type {any[]} */ const ev = [];
  for (let i = 0; i < Math.round(s / DT); i++) ev.push(...f.update(DT, w));
  return ev;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addHollowTests(test, assert, eq) {
  test(G, 'the floor dot is 10 m out looking level and 2 m looking down, straight between', async () => {
    const H = await recipe();
    eq(dotRange(H.dot.levelDeg, H.dot), H.dot.farM, 'level');
    eq(dotRange(H.dot.downDeg, H.dot), H.dot.nearM, 'down');
    eq(dotRange(0, H.dot), H.dot.farM, 'past level holds');
    const mid = dotRange((H.dot.levelDeg + H.dot.downDeg) / 2, H.dot);
    assert(Math.abs(mid - (H.dot.farM + H.dot.nearM) / 2) < 1e-9, `half way ${mid}`);
  });

  test(G, 'the floor dot walks the walk grid and stops before a wall and before a drop', () => {
    const { grid, rules } = floor();
    const open = walkDot(grid, rules, 0, 0, 0, 1, 5, 0.25);
    assert(!open.stopped && Math.abs(open.z - 5) < 1e-6, `open floor: all the way (${open.z})`);
    const wall = walkDot(grid, rules, 0, 0, 1, 0, 10, 0.25);
    assert(wall.stopped && wall.x < 4 && wall.x > 3, `stops before the wall (${wall.x})`);
    const drop = walkDot(grid, rules, 0, 0, 0, -1, 10, 0.25);
    assert(drop.stopped && drop.z > -4 && drop.z < -3, `stops before the drop (${drop.z})`);
  });

  test(G, 'Tab locks the nearest the middle, moves left to right, and turns off after the last', () => {
    const lock = createLock({ outOfReachS: 2 });
    const c = [{ id: 1, sx: -0.6, distM: 4, lockable: true }, { id: 2, sx: 0.1, distM: 5, lockable: true }, { id: 3, sx: 0.7, distM: 3, lockable: true },
      { id: 4, sx: -0.05, distM: 2, lockable: false }];
    eq(lock.press(c), 2, 'nearest the middle (not the one out of the light)');
    eq(lock.press(c), 3, 'next to the right');
    eq(lock.press(c), null, 'off after the last');
    eq(lock.press([{ id: 9, sx: 3, distM: 1, lockable: true }]), null, 'off screen is never locked');
  });

  test(G, 'a lock moves on when its target breaks, and drops after 2 s out of the light', () => {
    const lock = createLock({ outOfReachS: 2 });
    const a = { id: 1, sx: 0, distM: 4, lockable: true }, b = { id: 2, sx: 0.5, distM: 6, lockable: true };
    lock.press([a, b]);
    eq(lock.update(DT, [b]), 'moved', 'target broke');
    eq(lock.target, 2, 'onto the nearest left');
    const dim = { ...b, lockable: false };
    let why = null;
    for (let i = 0; i < Math.round(1.9 / DT); i++) why = lock.update(DT, [dim]) ?? why;
    eq(lock.target, 2, 'still held at 1.9 s');
    for (let i = 0; i < Math.round(0.2 / DT); i++) why = lock.update(DT, [dim]) ?? why;
    eq(why, 'dropped', 'dropped past 2 s');
    lock.press([b]);
    eq(lock.update(DT, []), 'off', 'nothing left: off');
  });

  test(G, 'the lantern burns, burns faster held up, costs a sip a hit, and refills', async () => {
    const H = await recipe(), L = createLantern(H.lantern);
    L.update(10);
    assert(Math.abs(L.fuel - (H.lantern.fuel - H.lantern.burnPerS * 10)) < 1e-9, 'hanging burn');
    const before = L.fuel;
    L.raise(true);
    for (let i = 0; i < 60; i++) L.update(DT);
    assert(before - L.fuel > H.lantern.burnPerS * 0.99 && L.lift === 1, 'held up burns faster and is up');
    assert(L.reach() > H.lantern.reachM, 'held up reaches further');
    const f = L.fuel;
    L.sip();
    eq(L.fuel, f - H.lantern.sipFuel, 'a hit costs a sip');
    L.snuff(true);
    const s = L.fuel; L.update(5);
    eq(L.fuel, s, 'snuffed burns nothing');
    eq(L.reach(), H.lantern.emberReachM, 'snuffed is an ember');
    L.refill();
    eq(L.fuel, H.lantern.fuel, 'refilled');
  });

  test(G, 'the staff lands on things in its arc, and a hit knows front, side and back', () => {
    const things = [{ x: 0, z: 1.2 }, { x: 1.2, z: 0 }, { x: 0, z: -1.2 }, { x: 0, z: 3 }];
    const hit = arcHits(0, 0, 0, things, 1.7, 130, () => 0.3);
    eq(hit.length, 1, 'only the one ahead within reach');
    eq(sideOf(0, 0, 0, 0, 2, 60, 120), 'front');
    eq(sideOf(0, 0, 0, 2, 0, 60, 120), 'side');
    eq(sideOf(0, 0, 0, 0, -2, 60, 120), 'back');
    eq(hitsDue([0.3, 0.62], 2, 0.5, 0.7).join(), '0', 'the first hit falls at 0.6 s');
  });

  test(G, 'a wall between the eye and the walker is in the way; one beside the line is not', () => {
    const wall = { x: 0, z: 3, hw: 2, hd: 0.3, yaw: 0, heightM: 3 };
    assert(inTheWay(wall, 0, [0, 4, 7], [0, 1, 0]), 'between');
    assert(!inTheWay(wall, 0, [6, 4, 7], [6, 1, 0]), 'beside');
    assert(!inTheWay(wall, 0, [0, 9, 7], [0, 1, 0]), 'looked over');
  });

  test(G, 'a lunger notices movement, shows its tell for windS, lunges, and is stuck after', async () => {
    const H = await recipe(), { open } = floor(), K = H.foes.lunger;
    const f = createFoe('lunger', 1, { x: 0, z: 3, yaw: Math.PI }, K, 7, H.swing);
    const still = { you: { x: 0, z: 0, speed: 0 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    runFor(f, still, 1);
    eq(f.step, 'rest', 'you standing still: it rests');
    const moving = { ...still, you: { x: 0, z: 0, speed: 2 } };
    let n = 0;
    while (f.step !== 'wind' && n++ < 600) f.update(DT, moving);
    eq(f.step, 'wind', 'closed in and winding up');
    let windT = 0;
    while (f.step === 'wind') { f.update(DT, moving); windT += DT; }
    assert(Math.abs(windT - K.windS) < 2 * DT, `the tell lasts windS (${windT.toFixed(2)})`);
    /** @type {any[]} */ const ev = [];
    while (f.step === 'strike') ev.push(...f.update(DT, moving));
    assert(ev.some((e) => e.type === 'strike' && e.hit), 'the lunge lands on you standing there');
    eq(f.step, 'recover', 'stuck after');
    const front = f.take({ kind: 'hit', fromX: f.x + Math.sin(f.yaw) * 2, fromZ: f.z + Math.cos(f.yaw) * 2 });
    assert(front.glanced && !front.landed, 'its armored front turns a hit');
    const back = f.take({ kind: 'hit', fromX: f.x - Math.sin(f.yaw) * 2, fromZ: f.z - Math.cos(f.yaw) * 2 });
    assert(back.landed && back.side === 'back', 'its back is soft');
  });

  test(G, 'a watcher turns to the light, calls after its 1.5 s tell, and loses you snuffed', async () => {
    const H = await recipe(), { open } = floor(), K = H.foes.watcher;
    const f = createFoe('watcher', 2, { x: 0, z: 5, yaw: 0 }, K, 7, H.swing);
    const lit = { you: { x: 0, z: 0, speed: 0 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    const ev = runFor(f, lit, 8);
    assert(ev.some((e) => e.type === 'call'), 'it called');
    const g = createFoe('watcher', 3, { x: 0, z: 5, yaw: Math.PI }, K, 7, H.swing);
    let n = 0;
    while (g.step !== 'wind' && n++ < 600) g.update(DT, lit);
    eq(g.step, 'wind', 'winding up its call');
    g.update(DT, { ...lit, lamp: { ...lit.lamp, snuffed: true, reachM: 1.5 } });
    eq(g.step, 'rest', 'snuffed: it lost you before it called');
  });

  test(G, 'motes nip with the lantern low and are held out of its reach held up', async () => {
    const H = await recipe(), { open } = floor(), K = H.foes.motes;
    const low = { you: { x: 0, z: 0, speed: 0 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    const f = createFoe('motes', 4, { x: 3, z: 3 }, K, 7, H.swing);
    assert(runFor(f, low, 6).some((e) => e.type === 'strike'), 'they dart in and nip');
    const up = { ...low, lamp: { ...low.lamp, raised: true, reachM: 9 } };
    const g = createFoe('motes', 5, { x: 3, z: 3 }, K, 7, H.swing);
    const ev = runFor(g, up, 8);
    assert(!ev.some((e) => e.type === 'strike'), 'held up: no nips');
    assert(Math.hypot(g.x, g.z) > 7, `held off near the light's edge (${Math.hypot(g.x, g.z).toFixed(1)} m)`);
  });

  test(G, 'a move runs its wind-up, active and recovery times, then waits; the gentler Hollow halves the wait', async () => {
    const MR = await moveRecipe(), m = createMoves(MR), F = MR.moves.castFlame;
    assert(m.start('castFlame', { x: 0, z: 5 }), 'started');
    eq(m.why('anchor'), 'busy', 'one move at a time');
    /** @type {string[]} */ const seen = [];
    let t = 0;
    while (m.playing) { for (const e of m.update(DT)) seen.push(`${e.type}@${(t + DT).toFixed(2)}`); t += DT; }
    eq(seen.map((s) => s.split('@')[0]).join(), 'active,ended,done', 'its parts in order');
    assert(Math.abs(t - (F.windS + F.activeS + F.recoverS)) < 2 * DT, `its whole time (${t.toFixed(2)})`);
    eq(m.why('castFlame'), 'waiting', 'then it waits');
    for (let i = 0; i < Math.round((F.waitS - t) / DT) + 2; i++) m.update(DT);
    eq(m.why('castFlame'), null, `ready after ${F.waitS} s`);
    const g = createMoves(MR, { gentle: true });
    g.start('castFlame', {});
    for (let i = 0; i < Math.round((F.waitS * MR.gentlerWaitK) / DT) + 2; i++) g.update(DT);
    eq(g.why('castFlame'), null, 'the gentler Hollow: ready in half the wait');
  });

  test(G, 'once-a-floor moves spend until a new floor, seeds run out, and Snuff can be cut short', async () => {
    const MR = await moveRecipe(), m = createMoves(MR);
    m.start('kindlingBurst', {});
    while (m.playing) m.update(DT);
    eq(m.why('kindlingBurst'), 'spent', 'once a floor');
    assert(m.spent('kindlingBurst'), 'its wick is spent');
    m.newFloor();
    eq(m.why('kindlingBurst'), null, 'back on a new floor');
    for (let i = 0; i < MR.seeds; i++) { m.newFloor(); const s = m.seeds; m.start('taproot', {}); eq(m.seeds, s - 1, 'a seed from the pack'); }
    const n = createMoves({ ...MR, seeds: 1 });
    n.start('taproot', {}); while (n.playing) n.update(DT);
    for (let i = 0; i < 2000; i++) n.update(DT);
    eq(n.why('taproot'), 'seeds', 'out of seeds: greyed');
    const s = createMoves(MR);
    s.start('snuff', {});
    for (let i = 0; i < 30; i++) s.update(DT);
    s.cut();
    const ev = s.update(DT).map((e) => e.type);
    assert(ev.includes('ended') && !s.playing, `cut short: it ends at once (${ev})`);
  });

  test(G, 'moves reach things by their instinct: feint, lure, throw, stumble, turn, root, slow', async () => {
    const H = await recipe(), { open } = floor(), w = { open };
    const lunger = () => createFoe('lunger', 1, { x: 0, z: 2, yaw: Math.PI }, H.foes.lunger, 3, H.swing);
    const watcher = () => createFoe('watcher', 2, { x: 0, z: 4, yaw: Math.PI }, H.foes.watcher, 3, H.swing);
    const motes = () => createFoe('motes', 3, { x: 0, z: 3 }, H.foes.motes, 3, H.swing);
    assert(lunger().take({ kind: 'feint', x: 1, z: 1 }).landed && !watcher().take({ kind: 'feint', x: 1, z: 1 }).landed, 'Feint draws the striker only');
    const l = lunger(); l.take({ kind: 'feint', x: 1, z: 1 }); eq(l.step, 'strike', 'it strikes at the spot');
    assert(watcher().take({ kind: 'lure', x: 5, z: 5, forS: 8 }).landed && !lunger().take({ kind: 'lure', x: 5, z: 5 }).landed, 'Moth lure leads the light-seeker only');
    const m = motes();
    assert(m.take({ kind: 'throw', toX: 0, toZ: 9, forS: 1.5, world: w }).landed && m.z === 9 && m.stunS > 0, 'Kindling burst throws the light-shy to the beam\'s end, stunned');
    assert(!lunger().take({ kind: 'throw', toX: 0, toZ: 9 }).landed, 'and nothing else');
    assert(lunger().take({ kind: 'stumble', forS: 0.8 }).landed && !watcher().take({ kind: 'stumble' }).landed, 'Groundline passes under a floating thing');
    const t = lunger(), y0 = t.yaw; t.take({ kind: 'turn', openS: 1.5 });
    assert(Math.abs(Math.abs(t.yaw - y0) - Math.PI) < 1e-9, 'Hook and turn spins it to face away');
    const small = motes(), big = watcher(), hp0 = big.hp;
    small.take({ kind: 'root', burstS: 3, share: { small: 1, large: 0.25 } });
    big.take({ kind: 'root', burstS: 3, share: { small: 1, large: 0.25 }, crackS: 5, staggerS: 1 });
    assert(!big.take({ kind: 'root', burstS: 3 }).landed, 'one root at a time');
    const lit = { you: { x: 0, z: -9, speed: 0 }, lamp: { x: 0, z: -9, reachM: 1, raised: false, snuffed: false }, open };
    runFor(small, lit, 3.1); runFor(big, lit, 3.1);
    assert(small.broken, 'Taproot breaks a small thing');
    assert(!big.broken && big.hp < hp0 && big.crackS > 0, 'and only cracks a large one');
    const sl = lunger(); sl.take({ kind: 'slow', forS: 6 });
    eq(sl.slowS, 6, 'Spring chorus slows it');
  });

  test(G, 'the twelve moves are all in the recipe with their timings, costs and icons', async () => {
    const MR = await moveRecipe();
    const ids = ['anchor', 'hookTurn', 'groundline', 'castFlame', 'wickSnare', 'kindlingBurst', 'backStep', 'feint', 'snuff', 'taproot', 'springChorus', 'mothLure'];
    eq(Object.keys(MR.moves).join(), ids.join(), 'ranks 1 to 3 of the four tracks');
    for (const id of ids) {
      const m = MR.moves[id];
      assert(['windS', 'activeS', 'recoverS', 'waitS', 'reachM'].every((k) => Number.isFinite(m[k])), `${id}: its numbers`);
      assert(['self', 'target', 'dot', 'ahead'].includes(m.at), `${id}: where it goes`);
      assert(HOLLOW_ICONS[id], `${id}: a drawn icon`);
    }
  });

  test(G, 'the same seed gives the same stand-in, step for step', async () => {
    const H = await recipe(), { open } = floor();
    const w = { you: { x: 0, z: 0, speed: 2 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    const a = createFoe('motes', 6, { x: 3, z: 2 }, H.foes.motes, 11, H.swing), b = createFoe('motes', 6, { x: 3, z: 2 }, H.foes.motes, 11, H.swing);
    runFor(a, w, 5); runFor(b, w, 5);
    eq(`${a.x},${a.z},${a.yaw},${a.step}`, `${b.x},${b.z},${b.yaw},${b.step}`);
    eq(JSON.stringify(a.members), JSON.stringify(b.members), 'the swarm the same');
  });
}
