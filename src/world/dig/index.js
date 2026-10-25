// @ts-check
// Digging, live (docs/future/13 section 10, P2c). Below, with the shovel, the here-bar offers Dig
// while the walker stands where the ground 0.6 m ahead can be dug (layers.js), and Scoop sand on dry
// sand above the wet line. The ground itself is never clicked. One press, one layer: the walker digs
// (figure.json poses.dig), a hole opens ahead (a piece of kind 'hole', holes.js) with its spoil heap
// on the walker's right, and a card says what came up (finds.js): worms and clay into their pouches,
// a keepsake to keep or leave. Pressing Dig again facing that hole goes a layer deeper. Each spot
// rests a day, each patch thins for a season and the island keeps a daily budget (rest.js); nothing
// is spent. Holes fill by themselves over about three game days; water over one or a stroke across
// one closes it at once. The store slice `dig` (saved) keeps the season's dug events and the firsts.
// Emits dig:dug, dig:layer, dig:found, dig:rested, dig:closed and dig:sound.

import { get, update } from '../../core/store.js';
import { on, emitDeferred } from '../../core/events.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { dayIndexOf } from '../../core/clock.js';
import { onAction } from '../../input/actions.js';
import { offerHere, withdrawHere } from '../../ui/ground-here.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { packMesh } from '../creatures/bodies.js';
import { createPropsPass } from '../../render/passes/props.js';
import { keep as keepShelf, cleanShelf } from '../keepsakes/shelf.js';
import { addFirst } from '../trails.js';
import { groundClass, nextLayer, cellOf } from './layers.js';
import { rested, thinning, budgetLeft, addEvent, seasonEvents, seasonNo, cleanDig } from './rest.js';
import { digFinds } from './finds.js';
import { holeNow, wetSince, closeHole, capHoles, holeAt } from './holes.js';
import { spoilMeshes, spoilBeings, holeMarks, shovelProp } from './draw.js';

/**
 * @param {{ recipe: any, keepsakes: any, seed: number, world: any, walk: any, terrain: any, water: any, pieces: any,
 *   pack: any, gather: any, presence: any, worldT: () => number, test: boolean, propsRecipe: any, shadowBias?: any,
 *   noteKept: (n: any) => void }} o
 *   recipe: dig.json; keepsakes: keepsakes.json; test: the `?shovel` link (the shovel in the kit, unsaved);
 *   propsRecipe: camp.json props (the shovel's own props pass); noteKept: app.js, a keepsake kept (its trail firsts)
 */
export function createDig(o) {
  const R = o.recipe, W = R.words, A = R.act;
  const seed = subSeed(o.seed, 'dig');
  const nowH = () => o.worldT() / 3600;
  const today = () => dayIndexOf(o.worldT());
  const state = () => cleanDig(get('dig'));
  /** @param {(s: ReturnType<typeof cleanDig>) => ReturnType<typeof cleanDig>} fn */
  const change = (fn) => update('dig', () => fn(state()));
  const hab = () => o.world.env.habitat?.() ?? null;
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const weather = () => o.world.state?.weather ?? null;

  // The shovel's own props pass (drawn while it digs) and the spoil heaps' meshes in the pieces pass.
  const props = createPropsPass({ name: 'dig-props', recipe: o.propsRecipe, bias: o.shadowBias });
  props.loadModel('shovel', new URL(`../../../${A.model}`, import.meta.url)).catch((e) => console.warn('ebb dig: the shovel did not load', e));
  for (const [layer, shapes] of Object.entries(spoilMeshes(R))) {
    shapes.forEach((m, i) => o.pieces.pass.setMesh(`spoil-${layer}-${i}`, { data: packMesh(m), indices: m.indices }));
  }

  /** Has the walker the shovel? (S1's workbench makes it, unlocks.shovel; `?shovel` for testing.) */
  const hasShovel = () => { const u = get('unlocks'); return !!(o.test || u?.shovel || u?.earned?.shovel); };

  // ---- holes ----

  const pieceList = () => /** @type {any[]} */ (get('pieces')?.list ?? []);
  const holes = () => pieceList().filter((p) => p.kind === 'hole');
  const records = () => { const w = weather(); return [w?.yesterday, w?.today].filter(Boolean); };
  /** A hole now (holes.js holeNow). @param {any} h */
  const now = (h) => holeNow(h, nowH(), wetSince(h, nowH(), records()), R);
  const isOpen = (/** @type {any} */ h) => now(h).stage < 3;
  /** Change the hole records (in the pieces section). @param {(list: any[]) => any[]} fn */
  function changeHoles(fn) {
    const s = get('pieces');
    if (!s) return;
    const others = s.list.filter((/** @type {any} */ p) => p.kind !== 'hole');
    const next = fn(s.list.filter((/** @type {any} */ p) => p.kind === 'hole'));
    update('pieces', () => ({ ...s, list: [...others, ...next] }));
  }
  /** Close holes now that pass a test, saying why. @param {(h: any) => boolean} test @param {string} why */
  function closeWhere(test, why) {
    const t = nowH();
    const shut = holes().filter((h) => isOpen(h) && test(h));
    if (!shut.length) return;
    const ids = new Set(shut.map((h) => h.id));
    changeHoles((list) => list.map((h) => (ids.has(h.id) ? closeHole(h, t) : h)));
    for (const h of shut) emitDeferred('dig:closed', { holeId: h.id, why });
  }

  /** Each game hour: bank the rain that fell on each hole, let faded ones go, close any under water. */
  function upkeep() {
    const t = nowH(), recs = records();
    const list = holes();
    if (!list.length) return;
    let changed = false;
    const next = [];
    for (const h of list) {
      const wetH = wetSince(h, t, recs);
      const n = holeNow(h, t, wetH, R);
      if (n.gone) { changed = true; continue; }
      if (wetH !== (h.wetH ?? 0)) { changed = true; next.push({ ...h, wetH }); } else next.push(h);
    }
    if (changed) changeHoles(() => next);
    closeWhere((h) => (o.water.sampleLive?.(h.x, h.z)?.depth ?? 0) > R.fill.waterM, 'water');
  }

  // ---- where Dig is offered ----

  /** Placed pieces as footprint circles (holes and the camp's own piles left out). */
  function footprints() {
    /** @type {{ x: number, z: number, r: number }[]} */ const out = [];
    for (const p of pieceList()) {
      if (p.kind === 'hole' || p.kind === 'pile') continue;
      if (p.kind === 'log') {
        const half = (p.length ?? 1) / 2, ax = Math.sin(p.yaw), az = Math.cos(p.yaw);
        for (let k = -2; k <= 2; k++) out.push({ x: p.x + ax * half * k / 2, z: p.z + az * half * k / 2, r: p.size / 2 });
      } else if (p.kind === 'steps') {
        out.push({ x: p.x, z: p.z, r: p.size }, { x: p.x2, z: p.z2, r: p.size }, { x: (p.x + p.x2) / 2, z: (p.z + p.z2) / 2, r: p.size });
      } else out.push({ x: p.x, z: p.z, r: p.size * 0.55 });
    }
    return out;
  }
  /** The ground class at a point, or why not. @param {number} x @param {number} z */
  function classAt(x, z) {
    const h = hab();
    if (!h) return /** @type {const} */ ({ cls: null, k: -1, why: 'outside' });
    return groundClass(x, z, { hab: h, depthAt: (px, pz) => o.water.sampleLive?.(px, pz)?.depth ?? 0, pad: get('campPad') ?? null, pieces: footprints() }, R);
  }

  /** A gather plant's stem near a point (a hole slides off it). @param {number} x @param {number} z */
  const stemNear = (x, z) => (o.world.state?.growth?.plants ?? []).some((/** @type {any} */ p) => (p.x - x) ** 2 + (p.z - z) ** 2 < R.hole.plantClearM ** 2);
  /**
   * Where a new hole would go from the dig point: there, or slid up to slideM off a plant's stem
   * onto ground of the same class; null with 'roots' when there is no clear spot. @param {number} x @param {number} z
   */
  function placeHole(x, z) {
    const c = classAt(x, z);
    if (!c.cls) return { cls: null, why: c.why };
    if (!stemNear(x, z)) return { cls: c.cls, k: c.k, x, z };
    for (let ring = 1; ring <= R.hole.slideSteps; ring++) {
      const d = (R.hole.slideM * ring) / R.hole.slideSteps;
      for (let a = 0; a < 8; a++) {
        const px = x + Math.cos((a * Math.PI) / 4) * d, pz = z + Math.sin((a * Math.PI) / 4) * d;
        const c2 = classAt(px, pz);
        if (c2.cls === c.cls && !stemNear(px, pz)) return { cls: c.cls, k: c2.k, x: px, z: pz };
      }
    }
    return { cls: null, why: 'roots' };
  }

  /** What a press of Dig would do now, or null where Dig is not offered. */
  function plan() {
    if (!o.walk.below || !hasShovel()) return null;
    const p = o.walk.aheadPoint(R.hole.aheadM);
    if (!p) return null;
    const hole = holeAt(holes(), p[0], p[2], isOpen, R);
    if (hole) return { hole, x: hole.x, z: hole.z };
    const at = placeHole(p[0], p[2]);
    if (!at.cls && at.why !== 'roots') return null;
    return { at, x: at.x ?? p[0], z: at.z ?? p[2] };
  }

  let hereT = 0;
  function here() {
    const busy = !!pending || o.walk.busy();
    if (!busy && plan()) offerHere({ id: 'dig', icon: 'dig', label: W.dig, order: 20, action: { type: 'dig.press' } });
    else withdrawHere('dig');
    // Scoop sand: on dry sand at your feet, once there is a use for it (the shovel, for now).
    const you = o.walk.below ? o.walk.you() : null;
    const s = you && hasShovel() && !busy ? o.gather.sandAt(you[0], you[2]) : null;
    if (s) offerHere({ id: 'scoop', icon: 'scoop', label: W.scoop, order: 21, action: { type: 'dig.scoop' } });
    else withdrawHere('scoop');
  }

  // ---- a press ----

  /** @type {{ t: number, at: any, hole: any | null, layer: string, depth: number, cls: string, k: number, x: number, z: number, steps: Set<string> } | null} */
  let pending = null;
  /** A line in the walker's hand, on the island. @param {string} text */
  const say = (text) => emitDeferred('island:notice', { text, showS: 5 });
  /** A first said once for good (dig.firsts). @param {string} id @param {string | undefined} text */
  function first(id, text) {
    if (state().firsts.includes(id)) return false;
    change((s) => ({ ...s, firsts: [...s.firsts, id] }));
    if (text) say(text);
    return true;
  }
  /** A gentle refusal: its line, and no sound of failure. @param {string} why */
  function refuse(why) {
    emitDeferred('dig:rested', { why });
    if (why === 'stones') emitDeferred('dig:sound', { name: 'stones' });
    say(W[why] ?? W.rest);
    if (why === 'stones') first('layer:stones', W.layers.stones);
  }

  function press() {
    if (pending || !o.walk.below || o.walk.busy() || !hasShovel()) return;
    const p = plan();
    if (!p) return;
    const day = today();
    let cls, depth, layer, k, x, z, hole = null;
    if (p.hole) {
      hole = p.hole;
      const next = nextLayer(hole.cls, hole.depth, R);
      if ('bottom' in next) { refuse(next.bottom); return; }
      ({ layer, depth } = next);
      cls = hole.cls; x = hole.x; z = hole.z; k = cellOf(x, z);
    } else {
      if (!p.at.cls) { refuse('roots'); return; }
      cls = p.at.cls; x = p.at.x; z = p.at.z; k = p.at.k;
      const next = nextLayer(cls, 0, R);
      if ('bottom' in next) return;
      ({ layer, depth } = next);
    }
    if (rested(seasonEvents(state().events, day), k, day, depth)) { refuse('rest'); return; }
    o.walk.faceToward(x, z);
    if (!o.walk.act('dig')) return;
    pending = { t: 0, at: p.at ?? null, hole, layer, depth, cls, k, x, z, steps: new Set() };
  }

  /** The beat of the dig's motion: sounds, the hole, then what came up. @param {number} dt real seconds */
  function step(dt) {
    if (!pending) return;
    const P = pending;
    P.t += dt;
    const beat = (/** @type {string} */ id, /** @type {number} */ at, /** @type {() => void} */ fn) => { if (P.t >= at && !P.steps.has(id)) { P.steps.add(id); fn(); } };
    beat('bite', A.biteS, () => { emitDeferred('dig:sound', { name: P.layer, seed: P.k }); o.presence?.edit?.(P.x, P.z); });
    beat('lift', A.liftS, () => emitDeferred('dig:sound', { name: 'lift', seed: P.k }));
    beat('pour', A.pourS, () => emitDeferred('dig:sound', { name: P.layer === 'sand' ? 'pour-sand' : 'pour', seed: P.k }));
    beat('hole', A.holeAtS, () => dig(P));
    if (P.t >= A.cardAtS) pending = null;
  }

  /** The dig itself: the hole opens or deepens, the find is worked out, written and shown. @param {NonNullable<typeof pending>} P */
  function dig(P) {
    const day = today(), t = nowH(), h0 = hab();
    const w = weather(), season = o.world.state?.seasons?.index ?? 0;
    const ev = seasonEvents(state().events, day);
    const th = thinning(ev, P.k, R);
    const at = {
      seed, cell: P.k, day, layer: P.layer, depth: P.depth, season,
      moisture: h0 ? h0.moisture[P.k] / 255 : 0,
      rainBefore: w?.yesterday?.mood === 'rain', frost: season === 3 && (w?.today?.mood === 'clear' || w?.today?.mood === 'mist'),
      thin: th.share, budgetLeft: budgetLeft(ev, seed, day, R),
    };
    const f = digFinds(at, R, o.keepsakes);
    change((s) => ({ ...s, events: addEvent(s.events, { c: P.k, d: day, l: P.depth, k: f.keepsake ? 1 : 0 }, R) }));
    if (th.firstThin) first(`thin:${seasonNo(day)}`, W.thinned);
    // The hole: a new one ahead, or the one faced, a layer deeper.
    let holeId = P.hole?.id;
    if (P.hole) {
      changeHoles((list) => list.map((h) => (h.id === P.hole.id ? { ...h, depth: P.depth, layer: P.layer, seep: h.seep || f.seep } : h)));
    } else {
      const s = get('pieces');
      const n = s?.nextId ?? 1;
      holeId = `p${n}`;
      const you = o.walk.spot();
      const hole = { id: holeId, kind: 'hole', x: P.x, z: P.z, yaw: you?.yaw ?? 0, seed: hash32(seed, n), size: R.hole.sizeM, placedHour: t,
        depth: P.depth, layer: P.layer, cls: P.cls, dugHour: t, closedHour: -1, wetH: 0, seep: f.seep, side: 1 };
      if (s) update('pieces', () => ({ ...s, list: [...s.list, hole], nextId: n + 1 }));
      const capped = capHoles(holes(), isOpen, t, R);
      changeHoles(() => capped.holes);
      for (const id of capped.capped) emitDeferred('dig:closed', { holeId: id, why: 'cap' });
    }
    emitDeferred('dig:dug', { x: P.x, z: P.z, cell: P.k, layer: P.layer, ground: P.cls, holeId });
    // Firsts: the layer's line in the walker's hand, its band on the soil page, its mark on the naturalist's trail.
    if (first(`layer:${P.layer}`, W.layers[P.layer])) {
      emitDeferred('dig:layer', { layer: P.layer, hour: t });
      noteFirst({ trail: 'nature', kind: 'layer', id: P.layer, hour: Math.floor(t) });
    }
    if (f.seep) first('layer:seep', W.layers.seep);
    showFind(P, f, holeId);
  }

  /** @param {any} f */
  function noteFirst(f) {
    update('unlocks', (u) => { const earned = addFirst(u?.earned, f); return earned === u?.earned ? u : { ...u, earned }; });
  }

  /**
   * The card for what came up: the layer in words, the worm and the clay (into their pouches; with
   * no room, the pack's full card), and a keepsake to keep or leave.
   * @param {NonNullable<typeof pending>} P @param {ReturnType<typeof digFinds>} f @param {string | undefined} holeId
   */
  function showFind(P, f, holeId) {
    /** @type {string[]} */ const lines = [W.seen[P.layer] ?? ''];
    /** @type {any} */ let full = null;
    /** @param {string} kind */
    const toPack = (kind) => { if (o.pack.room(kind)) { o.pack.add(kind, 1); return true; } full = { kind, g: { kind, x: P.x, z: P.z } }; emitDeferred('pack:full', { kind }); return false; };
    if (f.worm) {
      lines.push(W.worm[f.worm]);
      if (toPack('worms')) lines.push(W.wormsIn);
      emitDeferred('dig:found', { kind: 'worm', id: f.worm });
      emitDeferred('dig:detail', { id: `worm-${f.worm}` });
    }
    if (f.clay === 'yes') { if (toPack('clay')) lines.push(W.clay1); emitDeferred('dig:found', { kind: 'clay', id: 'clay' }); }
    else if (f.clay === 'winter') lines.push(W.clayWinter);
    let keepsake = null;
    if (f.keepsake) {
      keepsake = { ...f.keepsake, dug: { layer: P.layer, ground: P.cls } };
      lines.push(W.keepsake, o.keepsakes ? keepsakeLine(keepsake) : '');
      emitDeferred('dig:found', { kind: 'keepsake', id: keepsake.family });
      emitDeferred('dig:detail', { id: keepsake.form === 'belemnite' ? 'belemnite' : keepsake.family });
      if (keepsake.mark) emitDeferred('keepsake:seen', { n: keepsake });
    }
    if (!f.worm && f.clay !== 'yes' && !keepsake) { lines.push(W.nothing); emitDeferred('dig:found', { kind: 'none', id: null }); }
    const page = P.cls === 'sand' ? 'sand' : 'soil';
    update('identify', () => ({
      sp: page, name: W.names[P.layer], sub: null, icon: 'dig', text: lines.filter(Boolean).join(' '), wx: P.x, wz: P.z, r: 0.3, stage: -1,
      dig: true, digHole: holeId ?? null, digKeepsake: keepsake, ...(full ? { full, gathers: [] } : {}), at: performance.now(),
    }));
  }
  /** A dug keepsake's card line (its family's words). @param {any} n */
  let keepsakeLine = (/** @type {any} */ n) => '';

  /** Keep the card's keepsake: onto the shelf, or the shelf asks which to let go. */
  function keepIt() {
    const c = get('identify'), n = c?.digKeepsake;
    if (!n) return;
    const k = { n, hour: nowH(), spring: false };
    const r = keepShelf(cleanShelf(get('keepsakes')), k);
    // The beachcomber's trail: the first of each family kept from the ground is dug up.
    noteFirst({ trail: 'beach', kind: 'dug', id: n.family, hour: Math.floor(nowH()) });
    if (r.kept) {
      update('keepsakes', () => r.state);
      o.noteKept(n);
      emitDeferred('keepsake:sound', { name: 'keep' });
      update('identify', () => null);
    } else {
      update('shelfPending', () => ({ shoreId: `dig:${c.digHole ?? ''}`, ...k }));
      update('identify', () => null);
      update('journalUi', (u) => ({ ...(u ?? {}), open: true, view: 'shelf', page: null }));
    }
  }
  /** Leave it: reburied, and that spot's roll for today is spent. */
  function leaveIt() {
    const c = get('identify');
    if (!c?.digKeepsake) return;
    say(W.covered);
    emitDeferred('keepsake:sound', { name: 'leave' });
    update('identify', () => null);
  }

  // ---- Scoop sand ----

  /** @type {{ spot: any, t: number } | null} */ let scooping = null;
  function scoop() {
    if (scooping || pending || !o.walk.below || o.walk.busy()) return;
    const you = o.walk.you();
    const s = you ? o.gather.sandAt(you[0], you[2]) : null;
    if (!s) return;
    if (s.wet) { say(W.wetSand); return; }
    if (s.left <= 0) { say(W.scooped); return; }
    o.walk.kneelToward(s.spot.x, s.spot.z, R.scoop.kneelS, 'gather');
    scooping = { spot: s.spot, t: 0 };
  }

  // ---- cards ----

  const offs = [
    registerCardAction({ id: 'digkeep', icon: 'shelf', order: 21, main: true, label: W.keep, when: (c) => !!c?.dig && !!c.digKeepsake, action: () => ({ type: 'dig.keep' }) }),
    registerCardAction({ id: 'digleave', icon: 'release', order: 22, label: W.leave, when: (c) => !!c?.dig && !!c.digKeepsake, action: () => ({ type: 'dig.leave' }) }),
    registerCardAction({ id: 'digdeeper', icon: 'dig', order: 20, main: true, label: W.deeper,
      when: (c) => !!c?.digHoleCard && !!o.walk.below && hasShovel(), action: () => ({ type: 'dig.press' }) }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'dig.press') { if (get('identify')?.digHoleCard) update('identify', () => null); press(); }
      else if (a.type === 'dig.scoop') scoop();
      else if (a.type === 'dig.keep') keepIt();
      else if (a.type === 'dig.leave') leaveIt();
    }),
    on('world:ticked', upkeep),
    on('world:caught-up', upkeep),
    // A stroke of Sculpt, Paint or Water across an open hole closes it (the land's height never changes for a hole).
    on('terrain:stroke-ended', (/** @type {{ rect: { x0: number, z0: number, x1: number, z1: number } | null }} */ p) => {
      const r = p?.rect;
      if (r) closeWhere((h) => h.x >= r.x0 && h.x <= r.x1 && h.z >= r.z0 && h.z <= r.z1, 'stroke');
    }),
    on('water:pour-ended', (/** @type {{ x: number, z: number }} */ p) => closeWhere((h) => (h.x - p.x) ** 2 + (h.z - p.z) ** 2 < 4, 'stroke')),
  ];

  // The spoil heaps, drawn in the pieces pass.
  o.pieces.addBeings(() => holes().map((h) => ({ hole: h, ...now(h) })).flatMap((e) => spoilBeings([e], ground, R)));

  return {
    id: 'dig',
    props,
    /** For tools and testing: the ground class at a point, and what a press of Dig would do now. */
    classAt, plan,
    /** The words a dug keepsake's card says (its family's line). @param {(n: any) => string} fn */
    setKeepsakeWords(fn) { keepsakeLine = fn; },

    /** Each frame: the here-bar, a dig on its way, a scoop's kneel, the shovel in hand. @param {any} f */
    tick(f) {
      const dt = f.realDt;
      if ((hereT += dt) > 0.25) { hereT = 0; here(); }
      step(dt);
      if (scooping && (scooping.t += dt) >= R.scoop.kneelS * 0.6) {
        const r = o.gather.takeSand(scooping.spot);
        if (r === 'full') say(o.pack.recipe.words.full);
        scooping = null;
      }
      const digging = !!pending && o.walk.acting === 'dig';
      const sh = digging ? shovelProp(o.walk.hand('r'), o.walk.hand('l'), A) : null;
      props.setProps(sh ? [sh] : []);
    },

    /** The holes' marks for the terrain shader near a point. @param {number[]} focus [x, z] */
    marks: (focus) => holeMarks(holes().map((h) => ({ hole: h, ...now(h) })).filter((e) => !e.gone), focus, R),

    /**
     * The card a tap on an open hole opens: the layer it reaches in words, and Dig deeper on foot
     * with the shovel. From above, the card only. @param {number} x @param {number} z
     */
    cardAt(x, z) {
      const h = holes().find((q) => isOpen(q) && (q.x - x) ** 2 + (q.z - z) ** 2 < (q.size * 0.8) ** 2);
      if (!h) return null;
      return { sp: h.cls === 'sand' ? 'sand' : 'soil', name: W.names[h.layer], sub: null, icon: 'dig', text: `${W.hole} ${W.seen[h.layer] ?? ''}`.trim(),
        wx: h.x, wz: h.z, r: h.size * 0.6, stage: -1, dig: true, digHoleCard: h.id, canCarry: false };
    },

    dispose() { for (const off of offs) off(); withdrawHere('dig'); withdrawHere('scoop'); },
  };
}
