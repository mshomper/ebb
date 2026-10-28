// @ts-check
// The Hollow's fighting logic (H0, the move arena; docs/future/16-the-sea-cave.md, Fighting) for
// tools/unit-tests.html: the floor dot's range from the camera's tilt and its walk along the walk grid
// stopping before a wall or a drop; Tab lock-on (nearest the middle, left to right, off after the last,
// moving on when a target breaks, dropping after 2 s out of the light); the lantern as health; the
// staff's arc and which side a hit lands on; walls in the way; and the stand-ins' steps (a lunger's
// tell and lunge, a watcher's call, motes held off by the raised light), seeded and repeatable. H0b:
// the Q and E moves' timings and costs (waits, the gentler Hollow, once a floor, seeds, Snuff cut
// short) and how each reaches a thing by its instinct. H2: Matt's soot mote as loaded, and its swarm's
// shader inputs (the tell, the dart, the nip, the trail, the eyes), seeded and never in lockstep.

import { dotRange, walkDot } from '../src/world/hollow/aim.js';
import { createLock } from '../src/world/hollow/lock.js';
import { createLantern } from '../src/world/hollow/lantern.js';
import { arcHits, hitsDue, createSwingChain } from '../src/world/hollow/swing.js';
import { inTheWay } from '../src/world/hollow/occlude.js';
import { createFoe, sideOf } from '../src/world/hollow/foes.js';
import { createMoves } from '../src/world/hollow/moves.js';
import { createMoveFx } from '../src/world/hollow/move-fx.js';
import { MAX_FX_LIGHTS, MAX_MOTHS } from '../src/world/hollow/fx-layout.js';
import { loadMoteModel } from '../src/world/hollow/mote-model.js';
import { createSwarm, MOTE_FLOATS, PUFF_FLOATS } from '../src/world/hollow/mote-swarm.js';
import { HOLLOW_ICONS } from '../src/ui/icons/icons-hollow.js';
import { createWalkGrid } from '../src/world/walk/grid.js';
import { createSolids } from '../src/world/walk/solids.js';

const G = 'hollow';
const DT = 1 / 60;
const recipe = async () => (await fetch('../recipes/world/hollow.json')).json();
const moveRecipe = async () => (await fetch('../recipes/world/hollow-moves.json')).json();
const fxRecipe = async () => (await fetch('../recipes/world/hollow-move-fx.json')).json();

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

  test(G, 'one swing a click: clicks during a swing chain the next, up to the last, then it starts again', async () => {
    const H = await recipe(), S = H.swing, ch = S.chains.swingTriple, c = createSwingChain(S);
    const first = c.press(ch);
    assert(first && first.seg === 0, 'a click starts the first swing');
    eq(Math.round(first.lenS * 1000), Math.round(((ch.segments[0][1] - ch.segments[0][0]) / S.speed) * 1000), 'played speed times faster');
    eq(c.press(ch), null, 'a click during it queues');
    c.press(ch); c.press(ch);
    /** @type {string[]} */ const ev = [];
    let t = 0;
    while (c.swinging && t < 5) { for (const e of c.update(DT)) ev.push(`${e.type}${e.seg}`); t += DT; }
    eq(ev.join(), 'hit0,start1,hit1,start2,hit2,end2', 'three swings, each with its hit, and no more');
    const again = c.press(ch);
    eq(again?.seg, 0, 'after the last it starts again from the first');
    const d = createSwingChain(S);
    d.press(ch);
    while (d.swinging) d.update(DT);
    d.update(S.chainWindowS / 2);
    eq(d.press(ch)?.seg, 1, 'a click just after a swing ends chains');
    const e = createSwingChain(S);
    e.press(ch);
    while (e.swinging) e.update(DT);
    e.update(S.chainWindowS + 0.1);
    eq(e.press(ch)?.seg, 0, 'a click after the window starts from the first');
  });

  test(G, 'a landed hit knocks a thing back and breaks its lunge; a glance only nudges it', async () => {
    const H = await recipe(), { open } = floor();
    const you = { x: 0, z: 0, speed: 2 };
    const w = { you, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    const f = createFoe('lunger', 1, { x: 0, z: 3, yaw: Math.PI }, H.foes.lunger, 7, H.swing);
    let n = 0;
    while (f.step !== 'strike' && n++ < 600) f.update(DT, w);
    eq(f.step, 'strike', 'lunging');
    const z0 = f.z;
    // From behind it: a landed hit.
    const r = f.take({ kind: 'hit', fromX: f.x, fromZ: f.z + 1, world: w });
    assert(r.landed && r.side === 'back', 'landed on its back');
    eq(f.step, 'recover', 'its lunge is broken off');
    assert(f.hurtS > 0, 'it shows the hit');
    const ev = runFor(f, w, 0.5);
    assert(!ev.some((e) => e.type === 'strike'), 'so its strike never lands');
    assert(z0 - f.z > H.foes.lunger.knockM * 0.9, `knocked back about knockM (${(z0 - f.z).toFixed(2)} m)`);
    const g = createFoe('lunger', 2, { x: 0, z: 3, yaw: Math.PI }, H.foes.lunger, 7, H.swing);
    const gz = g.z;
    assert(g.take({ kind: 'hit', fromX: 0, fromZ: 1, world: w }).glanced, 'its front glances');
    runFor(g, { ...w, you: { x: 0, z: -20, speed: 0 } }, 0.3);
    const pushed = g.z - gz;
    assert(pushed > 0.1 && pushed < H.foes.lunger.knockM * 0.5, `a glance only nudges it (${pushed.toFixed(2)} m)`);
  });

  test(G, 'the same seed gives the same stand-in, step for step', async () => {
    const H = await recipe(), { open } = floor();
    const w = { you: { x: 0, z: 0, speed: 2 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    const a = createFoe('motes', 6, { x: 3, z: 2 }, H.foes.motes, 11, H.swing), b = createFoe('motes', 6, { x: 3, z: 2 }, H.foes.motes, 11, H.swing);
    runFor(a, w, 5); runFor(b, w, 5);
    eq(`${a.x},${a.z},${a.yaw},${a.step}`, `${b.x},${b.z},${b.yaw},${b.step}`);
    eq(JSON.stringify(a.members), JSON.stringify(b.members), 'the swarm the same');
  });

  // H2: Matt's soot mote, drawn round the cluster by mote-swarm.js.
  test(G, "Matt's mote loads as it is: 13,856 triangles, sizeM across, two eyes facing forward", async () => {
    const H = await recipe(), M = H.foes.motes.mote, model = await loadMoteModel('../assets/models/hollow/mote.glb');
    eq(model.triangles, 13856, 'no further cut');
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < model.data.length; i += 6) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], model.data[i + k]); hi[k] = Math.max(hi[k], model.data[i + k]); }
    const across = Math.max(...hi.map((h, k) => h - lo[k]));
    assert(Math.abs(across - model.acrossM) < 1e-3 && Math.abs(model.acrossM - M.sizeM) < 1e-6, `${across.toFixed(3)} m across`);
    eq(model.eyes.length, 2, 'two eyes');
    assert(model.eyes[0].centre[0] > 0 && model.eyes[1].centre[0] < 0, 'left (+x) first');
    for (const e of model.eyes) assert(e.axis[2] > 0.5 && e.centre[2] > 0 && e.radiusM > 0.01 && e.radiusM < 0.04, `an eye on the face (${e.axis}, ${e.radiusM} m)`);
  });

  test(G, 'a swarm of five bunches for its tell, stretches on the dart, squashes on the nip and leaves a trail', async () => {
    const H = await recipe(), { open } = floor(), K = H.foes.motes, M = K.mote;
    const f = createFoe('motes', 4, { x: 3, z: 3 }, K, 7, H.swing), s = createSwarm(f, M, 9, M.sizeM);
    eq(s.count, 5, 'five a swarm');
    const w = { you: { x: 0, z: 0, speed: 0 }, lamp: { x: 0, z: 0, reachM: 6, raised: false, snuffed: false }, open };
    const sw = { ground: () => 0.3, lamp: w.lamp, you: w.you };
    const spread = () => s.motes.reduce((n, m) => n + Math.hypot(m.x - f.x, m.z - f.z), 0) / s.count;
    let clock = 0, loose = 0, tight = Infinity, squash = 0, stretch = 0, nip = 0, puffs = 0;
    for (let i = 0; i < 6 / DT; i++) {
      f.update(DT, w); s.update(DT, clock += DT, sw);
      const inst = s.instances(clock);
      if (f.step === 'close' || f.step === 'rest') loose = Math.max(loose, spread());
      if (f.step === 'wind' && f.t > K.windS * 0.8) { tight = Math.min(tight, spread()); squash = Math.max(squash, inst[MOTE_FLOATS + 8]); }
      if (f.step === 'strike') { stretch = Math.max(stretch, inst[7]); puffs = Math.max(puffs, s.puffs().length / PUFF_FLOATS); }
      if (f.step === 'recover' && f.t < M.dart.nipS) nip = Math.max(nip, inst[8]);
    }
    assert(tight < loose * 0.7, `bunched up (${tight.toFixed(2)} m from ${loose.toFixed(2)} m)`);
    assert(squash > M.tell.squash * 0.8, `squashed in its tell (${squash.toFixed(2)})`);
    assert(stretch > 0.1, `stretched along the dart (${stretch.toFixed(2)})`);
    assert(nip > M.dart.nipSquash * 0.5, `squashed on the nip (${nip.toFixed(2)})`);
    assert(puffs > 0, 'a smoky trail behind the dart');
  });

  test(G, 'motes never move in lockstep, blink on their own, and the same seed draws the same swarm', async () => {
    const H = await recipe(), { open } = floor(), K = H.foes.motes, M = K.mote;
    const w = { you: { x: 9, z: 9, speed: 0 }, lamp: { x: 9, z: 9, reachM: 6, raised: false, snuffed: false }, open };
    const sw = { ground: () => 0.3, lamp: w.lamp, you: w.you };
    const run = () => {
      const f = createFoe('motes', 6, { x: 0, z: 0 }, K, 11, H.swing), s = createSwarm(f, M, 5, M.sizeM);
      let clock = 0;
      for (let i = 0; i < 4 / DT; i++) { f.update(DT, w); s.update(DT, clock += DT, sw); }
      return { s, inst: Array.from(s.instances(clock)) };
    };
    const a = run(), b = run();
    eq(JSON.stringify(a.inst), JSON.stringify(b.inst), 'the same seed, the same swarm');
    const ys = new Set(a.s.motes.map((m) => m.y.toFixed(3))), blinks = new Set(a.s.motes.map((m) => m.blinkAt.toFixed(2)));
    eq(ys.size, 5, 'each at its own height');
    assert(blinks.size >= 4, `blinks of their own (${[...blinks]})`);
  });

  test(G, 'a raised light widens the motes\' eyes quickly, and they settle slowly', async () => {
    const H = await recipe(), K = H.foes.motes, M = K.mote;
    const f = createFoe('motes', 2, { x: 2, z: 0 }, K, 3, H.swing), s = createSwarm(f, M, 1, M.sizeM);
    const lamp = { x: 0, z: 0, reachM: 6, raised: false };
    const sw = { ground: () => 0, lamp, you: { x: 0, z: 0 } };
    let clock = 0;
    const go = (/** @type {number} */ sec) => { for (let i = 0; i < Math.round(sec / DT); i++) s.update(DT, clock += DT, sw); return s.instances(clock)[13]; };
    assert(go(1) < 0.01, 'calm in the hanging light');
    lamp.raised = true;
    assert(go(M.eyes.widenInS + 0.02) > 0.95, 'wide at once');
    assert(go(M.eyes.widenOutS + 0.1) < 0.05, 'settled after');
  });

  // The move effects (October 27, 2026): every move's look runs, stays finite, keeps to its limits and replays the same.
  test(G, 'every move effect runs: lights stay within eight, nothing goes bad, and the same seed looks the same', async () => {
    const FX = await fxRecipe();
    const run = () => {
      const fx = createMoveFx(FX, { seed: 7, ground: (x) => 0.1 * Math.sin(x) });
      fx.cue('anchor.brace', { x: 0, z: 0 }); fx.cue('anchor.catch', { x: 0, z: 0, tx: 1, tz: 1 });
      fx.cue('hookTurn', { x: 1, z: 1, r: 0.8, yaw: 0.3 }); fx.cue('groundline.end', { x0: 0, z0: 0, x1: 6, z1: 0 });
      fx.cue('castFlame.throw', { from: [0, 1, 0], x: 5, z: 2, ringM: 1.3, scorchS: 3 });
      fx.cue('kindlingBurst', { x0: 0, z0: 0, x1: 8, z1: 3 }); fx.cue('backStep', { x: 0, z: 0, yaw: 0 });
      fx.cue('feint', { x: 0, z: 0, yaw: 0, r: 2.5, arcDeg: 120 }); fx.cue('snuff.out', { x: 0, y: 1, z: 0 });
      fx.cue('taproot.throw', { from: [0, 1, 0], x: 3, z: 3 }); fx.cue('springChorus', { x: 0, z: 0, r: 5 });
      for (const [k, kind, p] of /** @type {[string, any, any][]} */ ([['w', 'wick', { x: 1, z: 0 }], ['b', 'bind', { x: 2, z: 0, r: 0.4, forS: 1 }], ['c', 'crackTip', { x: 0, z: 0 }],
        ['r', 'root', { x: 3, z: 3, size: 0.5 }], ['m', 'swarm', { from: [0, 1, 0], x: 6, z: 2 }], ['s', 'snuff', { x: 0, y: 1, z: 0 }]])) fx.start(k, kind, p);
      let most = 0, out = fx.gpu();
      for (let i = 0; i < 3 / DT; i++) {
        fx.update(DT); out = fx.gpu(); most = Math.max(most, out.nLights);
        const live = [out.sparks.subarray(0, out.nSparks * 12), out.lights, out.threads.subarray(0, out.nThreads * 12), out.moths.subarray(0, out.nMoths * 8)];
        assert(live.every((a) => a.every(Number.isFinite)), `finite at frame ${i}`);
      }
      return { most, sparks: Array.from(out.sparks.subarray(0, 24)), marks: fx.marks().length };
    };
    const a = run(), b = run();
    assert(a.most === MAX_FX_LIGHTS, `as many lights as it can draw (${a.most})`);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same seed, the same look');
  });

  test(G, 'moths fly out of the lantern to the lure, circle it, and leave when it ends', async () => {
    const FX = await fxRecipe(), M = FX.mothLure;
    const fx = createMoveFx(FX, { seed: 3, ground: () => 0 });
    fx.start('m', 'swarm', { from: [0, 1, 0], x: 6, z: 0 });
    for (let i = 0; i < 3 / DT; i++) fx.update(DT);
    let o = fx.gpu();
    eq(o.nMoths, Math.min(M.count, MAX_MOTHS), 'every moth out');
    for (let i = 0; i < o.nMoths; i++) {
      const x = o.moths[i * 8], z = o.moths[i * 8 + 2], y = o.moths[i * 8 + 1];
      assert(Math.hypot(x - 6, z) < M.orbitM[1] + 0.8, `moth ${i} round the lure (${x.toFixed(2)}, ${z.toFixed(2)})`);
      assert(y > M.hoverY[0] - 0.5 && y < M.hoverY[1] + 0.5, `moth ${i} at moth height (${y.toFixed(2)})`);
    }
    const phase = o.moths[4];
    fx.update(DT); o = fx.gpu();
    assert(o.moths[4] !== phase, 'wings beating');
    fx.stop('m');
    for (let i = 0; i < (M.leaveS + 0.2) / DT; i++) fx.update(DT);
    eq(fx.gpu().nMoths, 0, 'all gone after leaving');
  });

  test(G, 'a thrown flame flies its arc, then bursts, flashes and leaves a lingering glow and marks', async () => {
    const FX = await fxRecipe(), C = FX.castFlame;
    const fx = createMoveFx(FX, { seed: 5, ground: () => 0 });
    fx.cue('castFlame.throw', { from: [0, 1, 0], x: 6, z: 0, ringM: 1.3, scorchS: 3 });
    for (let i = 0; i < (C.flightS * 0.5) / DT; i++) fx.update(DT);
    const mid = fx.gpu();
    assert(mid.nLights === 1 && mid.lights[0] > 2 && mid.lights[0] < 4, 'the light travels with the flame');
    for (let i = 0; i < (C.flightS * 0.5 + 0.1) / DT; i++) fx.update(DT);
    const hit = fx.gpu();
    assert(hit.nSparks > C.burst.n * 0.8, `burst sparks (${hit.nSparks})`);
    assert(hit.nLights >= 2, 'a flash and a glow');
    assert(fx.marks().some((m) => m.shape === 'disc'), 'a scorch on the floor');
    for (let i = 0; i < 3.2 / DT; i++) fx.update(DT);
    eq(fx.gpu().nLights, 0, 'the glow dies with the scorch');
  });
}
