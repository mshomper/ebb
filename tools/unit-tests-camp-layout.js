// @ts-check
// The camp's corners (Matt, October 30, 2026, option A; docs/future/13 section 3.2): on both starter
// islands no slot touches another, nor a bench's or keep's stand spot, nor the keepsake shelf's room;
// every slot is on the pad but the off-pad ones (the birdbath, by the bed); the gift stone is on the
// landward rim; the nest box takes its rim place toward the hen's bushes, the same each time; an
// older save's pieces keep their slots; the camp page names each piece on hover.

import { padOf, padToWorld, slotFootprint, slotRoom, slotPlaced, rimSpot, clearOf } from '../src/world/camp/layout.js';
import { cleanCamp } from '../src/world/camp/model.js';
import { campView } from '../src/ui/journal-camp.js';

const G = 'camp layout';
const load = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
const LANDS = ['land/starter-island-2', 'land/starter-island'];
/** The slot ids an older save may hold (the layout before the corners). */
const OLD_IDS = ['tent', 'ring', 'hearth', 'cup', 'bowls', 'mortar', 'dyepot', 'pot-cook', 'pot-tea', 'seat', 'rack', 'sticks', 'stones', 'clay',
  'heap1', 'heap2', 'heap3', 'workbench', 'apothecary', 'store', 'gift', 'nest', 'lamp', 'jar', 'bath', 'chime'];
/** The gap kept between any two footprints (m). */
const GAP = 0.08;

/** A footprint as a polygon in the pad's frame. @param {any} f @returns {number[][]} */
const poly = (f) => {
  if (f.r !== undefined) return Array.from({ length: 24 }, (_, i) => [f.u + Math.cos((i / 24) * 2 * Math.PI) * f.r, f.v + Math.sin((i / 24) * 2 * Math.PI) * f.r]);
  const c = Math.cos(f.a), s = Math.sin(f.a);
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [f.u + a * f.hu * c - b * f.hv * s, f.v + a * f.hu * s + b * f.hv * c]);
};
/** Do two convex polygons overlap (separating axes)? @param {number[][]} A @param {number[][]} B */
const overlap = (A, B) => {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length], nx = y2 - y1, ny = x1 - x2;
    const pa = A.map(([x, y]) => x * nx + y * ny), pb = B.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
};
/** @param {any} f @param {number} g */
const grow = (f, g) => (f.r !== undefined ? { ...f, r: f.r + g } : { ...f, hu: f.hu + g, hv: f.hv + g });

/**
 * Every footprint the layout keeps apart: each slot's, the shelf's room, and the stand spots (a bench
 * in front of its work, a keep and the gift stone on the ring's side). @param {any[]} slots @param {number} standM
 */
function feetOf(slots, standM) {
  const ring = slots.find((s) => s.id === 'ring');
  /** @type {{ id: string, f: any }[]} */ const out = [];
  for (const s of slots) {
    const f = slotFootprint(s, slots), room = slotRoom(s);
    if (f) out.push({ id: s.id, f });
    if (room) out.push({ id: `${s.id}:room`, f: room });
    let st = null;
    if (s.faces) {
      const t = slots.find((q) => q.id === s.faces), l = Math.hypot(s.u - t.u, s.v - t.v), o = (s.d ?? 0.6) / 2 + standM;
      st = [s.u - ((s.u - t.u) / l) * o, s.v - ((s.v - t.v) / l) * o];
    } else if (['store', 'rack', 'gift'].includes(s.id)) {
      const l = Math.hypot(ring.u - s.u, ring.v - s.v), o = (s.r ?? (s.d ?? 0.5) / 2) + standM;
      st = [s.u + ((ring.u - s.u) / l) * o, s.v + ((ring.v - s.v) / l) * o];
    }
    if (st) out.push({ id: `${s.id}:stand`, f: { u: st[0], v: st[1], r: 0.25 } });
  }
  return out;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampLayoutTests(test, assert, eq) {
  test(G, 'no slot touches another, a stand spot or the shelf\'s room, on either starter island', async () => {
    const standM = (await load('world/camp')).stations.standM;
    for (const id of LANDS) {
      const slots = (await load(id)).camp.slots, feet = feetOf(slots, standM), bad = [];
      for (let i = 0; i < feet.length; i++) for (let j = i + 1; j < feet.length; j++) {
        const A = feet[i], B = feet[j], a = A.id.split(':')[0], b = B.id.split(':')[0];
        // A thing and its own stand or room; the hearth's pot sits in the ring; two stand spots may meet.
        if (a === b || [a, b].sort().join() === 'hearth,ring' || (A.id.includes(':') && B.id.includes(':'))) continue;
        if (overlap(poly(grow(A.f, GAP / 2)), poly(grow(B.f, GAP / 2)))) bad.push(`${A.id} x ${B.id}`);
      }
      eq(bad.join(', '), '', `${id}: nothing touches`);
    }
  });

  test(G, 'every slot is on the pad but the birdbath, which stands by the herb bed', async () => {
    for (const id of LANDS) {
      const C = (await load(id)).camp, R = C.radiusM;
      for (const s of C.slots) {
        const f = slotFootprint(s, C.slots);
        if (!f) continue;
        const far = Math.max(...poly(f).map(([u, v]) => Math.hypot(u, v)));
        if (s.offPad) assert(Math.hypot(s.u, s.v) - (s.r ?? 0) > R, `${id}: ${s.id} is off the pad`);
        else assert(far <= R - 0.05, `${id}: ${s.id} on the pad (${far.toFixed(2)} m out)`);
      }
      const bath = C.slots.find((/** @type {any} */ s) => s.id === 'bath'), b = C.offPad.bed;
      const du = Math.max(Math.abs(bath.u - b.u) - b.w / 2, 0), dv = Math.max(Math.abs(bath.v - b.v) - b.d / 2, 0);
      assert(Math.hypot(du, dv) - bath.r < 1.2, `${id}: the birdbath by the bed`);
    }
  });

  test(G, 'the gift stone is on the landward rim; the keepsake shelf faces the middle beside the tent', async () => {
    for (const id of LANDS) {
      const S = (await load(id)).camp.slots, g = S.find((/** @type {any} */ s) => s.id === 'gift'), t = S.find((/** @type {any} */ s) => s.id === 'tent');
      assert(g.u < -2.5 && Math.hypot(g.u, g.v) > 3, `${id}: landward rim (${g.u}, ${g.v})`);
      const sh = S.find((/** @type {any} */ s) => s.id === 'shelf');
      assert(sh && sh.yaw === 'inward' && sh.frontM >= 1 && Math.abs(sh.w - 1.3) < 0.1 && Math.abs(sh.d - 0.45) < 0.05, `${id}: the shelf slot, turned in, with a meter of room`);
      assert(Math.hypot(sh.u - t.u, sh.v - t.v) < 3, `${id}: beside the tent`);
      assert(sh.blocks && (await load('world/cook')).makes['keepsake-shelf']?.slot === 'shelf', 'the keepsake shelf is made into it, and you walk round it (B2)');
    }
  });

  test(G, "the nest box goes on the rim toward the hen's bushes, clear of everything, the same each time", async () => {
    const land = await load('land/starter-island-2'), pad = /** @type {any} */ (padOf(land));
    const nest = pad.camp.slots.find((/** @type {any} */ s) => s.id === 'nest');
    const others = pad.camp.slots.filter((/** @type {any} */ s) => s.id !== 'nest');
    const clearOfAll = (/** @type {{ u: number, v: number }} */ p) => others.every((/** @type {any} */ s) => {
      const f = slotFootprint(s, pad.camp.slots), room = slotRoom(s);
      return (!f || clearOf(f, p.u, p.v, nest.r) >= nest.rim.gapM - 1e-6) && (!room || clearOf(room, p.u, p.v, nest.r) >= nest.rim.gapM - 1e-6);
    });
    eq(rimSpot(pad, nest, null), null, 'no bushes: none (it keeps the home corner)');
    for (const [bu, bv] of [[0, 12], [-12, 0], [-8, -8], [10, -3]]) {
      const [x, z] = padToWorld(pad, bu, bv), p = rimSpot(pad, nest, { x, z });
      assert(p, `a place toward (${bu}, ${bv})`);
      if (!p) continue;
      assert(Math.abs(Math.hypot(p.u, p.v) - nest.rim.rM) < 0.02, 'on the rim');
      assert(clearOfAll(p), `clear of every other slot toward (${bu}, ${bv}): (${p.u}, ${p.v})`);
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(p.v, p.u) - Math.atan2(bv, bu)), Math.cos(Math.atan2(p.v, p.u) - Math.atan2(bv, bu))));
      assert(off <= (nest.rim.maxDeg * Math.PI) / 180 + 1e-6, 'on their side');
      eq(JSON.stringify(rimSpot(pad, nest, { x, z })), JSON.stringify(p), 'the same bushes, the same place');
    }
    const [x, z] = padToWorld(pad, 0, 12), p = /** @type {any} */ (rimSpot(pad, nest, { x, z }));
    assert(p.v > 3, 'bushes to the left: the box on the left rim');
  });

  test(G, "an older save's pieces keep their slots; the nest box's own place survives a save", async () => {
    for (const id of LANDS) {
      const S = (await load(id)).camp.slots;
      for (const o of OLD_IDS) assert(S.some((/** @type {any} */ s) => s.id === o), `${id}: slot ${o} still there`);
    }
    const old = { version: 1, kit: { tent: 'pitched', lantern: 'pole' }, slots: OLD_IDS.filter((s) => !['hearth', 'seat', 'lamp', 'jar', 'bath', 'chime'].includes(s))
      .map((s, i) => ({ slot: s, kind: s, seed: i, placedHour: 1 })) };
    const c = cleanCamp(old);
    eq(c.slots.length, old.slots.length, 'nothing lost');
    const S = (await load('land/starter-island-2')).camp.slots, nest = S.find((/** @type {any} */ s) => s.id === 'nest');
    const rec = c.slots.find((s) => s.slot === 'nest');
    eq(JSON.stringify([slotPlaced(nest, rec).u, slotPlaced(nest, rec).v]), JSON.stringify([nest.u, nest.v]), 'an older nest box stands in the home corner');
    const placed = cleanCamp({ ...old, slots: [{ slot: 'nest', kind: 'nest-box', seed: 1, placedHour: 2, u: 2.1, v: 2.86 }] });
    const p = slotPlaced(nest, placed.slots[0]);
    eq(JSON.stringify([p.u, p.v, p.id]), JSON.stringify([2.1, 2.86, 'nest']), 'its rim place is kept');
    eq(slotPlaced(nest, { slot: 'nest', u: 'x' }).u, nest.u, 'a bad place reads as none');
  });

  test(G, 'the camp page names each piece in the sketch on hover', async () => {
    const C = await load('world/cook'), land = await load('land/starter-island-2'), pad = padOf(land);
    const camp = cleanCamp({ kit: { tent: 'pitched' }, slots: ['tent', 'ring', 'workbench', 'store', 'gift', 'nest'].map((s, i) => ({ slot: s, kind: s, seed: i, placedHour: 1 })) });
    const html = campView(C, camp, {}, pad, await load('world/journal'), null, false);
    for (const id of ['tent', 'ring', 'workbench', 'store', 'gift', 'nest', 'sticks']) {
      const name = C.words.page.sketchNames[id];
      assert(name && html.includes(`aria-label="${name}"`) && html.includes(`ebb-camppage__tip">${name}<`), `${id}: ${name}`);
    }
    assert(!html.includes('aria-label="Apothecary bench"'), 'only what stands');
  });
}
