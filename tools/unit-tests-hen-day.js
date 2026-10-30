// @ts-check
// Hen day tests for tools/unit-tests.html (docs/future/15, slice 3): the part of her day follows
// the sun's day length; the distant crow sounds on some mornings, never every one, the same each
// replay; at roost time she goes up into her scrub, or onto the camp perch once Familiar; in rain
// she shelters at a bush; at dawn she drinks and at midday bathes in the dust; a whole day lived on
// a test ground takes her up to roost and down again; her wing patches are skinned to the wing
// bones and open; the perch stands off the pad; where she roosts is saved.

import { readGlb } from '../src/render/gltf.js';
import { buildHen } from '../src/world/hen/rig.js';
import { createHenPoser, stillPose } from '../src/world/hen/motion.js';
import { createHenLife } from '../src/world/hen/life.js';
import { choosePlan } from '../src/world/hen/bands.js';
import { dayPart, sunTimes, crowHour, bushRoost, shelterSpot, findDust, bareAt, raining, dustWeather } from '../src/world/hen/day.js';
import { perchSpot, perchRoost, perchMesh } from '../src/world/hen/perch.js';
import { henRoosted, newHen } from '../src/world/hen/trust.js';

const G = 'hen: her day';
const load = async () => (await fetch(new URL('../recipes/species/hen.json', import.meta.url))).json();
/** @type {Promise<{ R: any, built: ReturnType<typeof buildHen> }> | null} */ let made = null;
const rigged = () => made ?? (made = (async () => {
  const R = await load();
  const glb = readGlb(await (await fetch(new URL(`../${R.model}`, import.meta.url))).arrayBuffer());
  return { R, built: buildHen(glb, R) };
})());

/** Three gorse bushes about the origin, her scrub. */
const SCRUB = [{ sp: 'gorse', x: 0, z: 1, size: 0.8 }, { sp: 'gorse', x: 1.5, z: -1, size: 0.7 }, { sp: 'gorse', x: -1.4, z: -0.8, size: 0.75 }];

/** What choosePlan sees, a quiet day at home with nobody about. @param {any} over */
const see = (over) => ({ band: 0, hen: { x: 3, z: 3 }, home: { x: 0, z: 0 }, walker: null, ring: null, hourOfDay: 12, day: 1, greetedDay: -1,
  treat: null, dig: null, visitDue: false, following: false, ...over });

/** @param {(group: string, name: string, fn: () => any) => void} test @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq */
export function addHenDayTests(test, assert, eq) {
  test(G, 'the part of her day follows the sun: roost before sunrise and from just before sunset, dawn, midday, and longer days in summer', async () => {
    const D = (await load()).day;
    for (const len of [9.9, 12, 14.1]) {
      const { rise, set } = sunTimes(len);
      eq(dayPart(D, rise - 0.1, len), 'roost', `${len} h day: before sunrise`);
      eq(dayPart(D, rise + 0.1, len), 'dawn', `${len} h day: just after sunrise`);
      eq(dayPart(D, rise + D.dawnH + 0.1, len), rise + D.dawnH + 0.1 >= D.dustH[0] ? 'midday' : 'day', `${len} h day: after dawn`);
      eq(dayPart(D, 12.5, len), 'midday', `${len} h day: midday`);
      eq(dayPart(D, set - D.roostBeforeSunsetH + 0.05, len), 'roost', `${len} h day: to roost before sunset`);
    }
    eq(dayPart(D, 18.5, 14.1), 'day', 'a summer evening is still day');
    eq(dayPart(D, 18.5, 9.9), 'roost', 'a winter evening is roost');
  });

  test(G, 'the distant crow: on some mornings only, within its hours, the same on every replay', async () => {
    const D = (await load()).day;
    let n = 0, run = 0, longest = 0;
    for (let day = 0; day < 200; day++) {
      const h = crowHour(D, 1234, day);
      eq(h, crowHour(D, 1234, day), 'the same hour on a replay');
      if (h !== null) { n++; run++; assert(h >= D.crowH[0] && h <= D.crowH[1], `within its hours (${h})`); } else run = 0;
      longest = Math.max(longest, run);
    }
    assert(n > 200 * D.crowShare * 0.6 && n < 200 * D.crowShare * 1.4, `about crowShare of mornings (${n} of 200)`);
    assert(longest < 8, `never every morning for long (${longest} in a row)`);
  });

  test(G, 'roost time: up into her scrub; once Familiar with a perch, the perch; Fond beside you while you sit by the fire', async () => {
    const R = await load();
    const roost = bushRoost(R.day, SCRUB[0]);
    assert(roost.h > 0.2 && roost.h <= R.day.roostMaxM, `a roost up in the bush (${roost.h.toFixed(2)} m)`);
    const perch = { x: 5, z: 2, h: 0.53, yaw: 1 };
    const a = choosePlan(R, see({ roosting: true, roost, perch }));
    eq(a?.purpose, 'roost'); eq(a?.x, roost.x, 'Wary: her scrub, not the perch');
    const b = choosePlan(R, see({ band: 3, roosting: true, roost, perch }));
    eq(b?.x, 5, 'Familiar: the perch'); eq(b?.yaw, 1, 'sitting across its bar');
    const ring = { x: 6, z: 0 };
    const c = choosePlan(R, see({ band: 4, roosting: true, roost, perch, ring, walker: { x: 5.2, z: 0, speed: 0, sit: true } }));
    eq(c?.purpose, 'beside', 'Fond: beside you at the fire first');
    eq(choosePlan(R, see({ roosting: true, roost: null, perch: null })), null, 'no scrub, no perch: home to stand');
  });

  test(G, 'rain sends her to shelter at a bush, fluffed; dawn to a drink; midday to a dust bath on a bare patch', async () => {
    const R = await load(), D = R.day;
    assert(raining(D, { rain: 0.5 }) && !raining(D, { rain: 0.05 }), 'rain past rainMin');
    assert(dustWeather(D, { rain: 0, cloud: 0.2 }) && !dustWeather(D, { rain: 0, cloud: 0.95 }) && !dustWeather(D, { rain: 0.3, cloud: 0 }), 'dust weather: dry and sunny');
    const sh = shelterSpot(D, SCRUB[0], { x: 0, z: 5 });
    const crown = D.bushCrownM.gorse * SCRUB[0].size;
    assert(Math.hypot(sh.x - SCRUB[0].x, sh.z - SCRUB[0].z) < crown, 'under the crown');
    eq(choosePlan(R, see({ shelter: sh }))?.purpose, 'shelter');
    eq(choosePlan(R, see({ drink: { x: 4, z: 0, look: { x: 5, z: 0 } } }))?.purpose, 'drink');
    eq(choosePlan(R, see({ dust: { x: -4, z: 0 } }))?.purpose, 'dust');
    // A dust patch is bare: no plant within bareM.
    const at = findDust(D, { x: 0, z: 0 }, (x, z) => bareAt(D, SCRUB, x, z), 0.3);
    assert(at && bareAt(D, SCRUB, at.x, at.z), 'a bare patch found away from the bushes');
    const far = findDust(D, { x: 0, z: 0 }, (x) => x > 10, 0);
    assert(far && far.x > 10 && Math.hypot(far.x, far.z) < 12, 'the nearest that suits');
    eq(findDust(D, { x: 0, z: 0 }, () => false, 0), null, 'none where nothing suits');
  });

  test(G, 'a day lived: at dusk she flaps up into her scrub and roosts tucked; at sunrise she flaps down, shakes and drinks', async () => {
    const R = await load();
    const life = createHenLife({ R, seed: 9, ground: () => 0, wet: (x) => x > 6,
      fresh: () => ({ x: 5.5, z: 0, look: { x: 6.5, z: 0 } }), dustOk: () => true });
    life.setHome({ x: 0, z: 0 }, R.home.rangeM, true, SCRUB);
    const step = (/** @type {number} */ s, /** @type {any} */ c) => { for (let t = 0; t < s; t += 0.05) life.step(0.05, { night: false, sources: [], hourOfDay: 12, day: 3, ...c }); };
    step(5, { part: 'day' });
    step(40, { part: 'roost', hourOfDay: 20 });
    eq(life.hen.mode, 'roost', 'roosting');
    assert(life.hen.lift > 0.2 && life.hen.y > 0.2, `up off the ground (${life.hen.lift.toFixed(2)} m)`);
    assert(life.hen.tuck > 0.5 && life.hen.fluff > 0.5, 'tucked and fluffed');
    eq(life.hen.roostOn, 'scrub');
    /** @type {string[]} */ const seen = [];
    for (let t = 0; t < 40; t += 0.05) {
      life.step(0.05, { night: false, sources: [], hourOfDay: 6.5, day: 4, part: 'dawn' });
      const a = life.hen.mode === 'act' && life.hen.act ? life.hen.act.a : life.hen.mode;
      if (seen[seen.length - 1] !== a) seen.push(a);
    }
    assert(seen.includes('hop'), 'a flap down');
    assert(seen.includes('shake'), 'a shake');
    assert(seen.includes('dip') && seen.includes('tip'), `a drink (${seen.join(', ')})`);
    eq(life.hen.lift, 0, 'on the ground');
    eq(life.hen.drankDay, 4, 'drunk today');
  });

  test(G, 'a load at night puts her straight onto her roost', async () => {
    const R = await load();
    const life = createHenLife({ R, seed: 3, ground: () => 0, wet: () => false });
    life.setHome({ x: 0, z: 0 }, R.home.rangeM, true, SCRUB);
    life.roostInScrub();
    eq(life.hen.mode, 'roost');
    const p = perchRoost(perchSpot(R.perch, { x: 0, z: 0 }, { x: 0, z: 5 }));
    life.roostNow(p);
    eq(life.hen.roostOn, 'perch'); assert(Math.abs(life.hen.lift - p.h) < 1e-9, 'at the bar');
  });

  test(G, 'her wings: each patch skinned whole to its wing bone, and opening moves it out from the body', async () => {
    const { R, built } = await rigged();
    assert(built.wingVerts > 40 && built.wingTris > 40, `wing patches (${built.wingVerts} vertices, ${built.wingTris} triangles)`);
    const u = new Uint8Array(built.data), f = new Float32Array(built.data);
    const wl = built.skeleton.findIndex((b) => b.name === 'wing.l'), wr = built.skeleton.findIndex((b) => b.name === 'wing.r');
    let left = 0, right = 0;
    for (let v = built.count - built.wingVerts; v < built.count; v++) {
      eq(u[v * 44 + 40], 255, 'whole to one bone');
      if (u[v * 44 + 36] === wl) { left++; assert(f[v * 11] > 0, 'the left wing on her left'); }
      else if (u[v * 44 + 36] === wr) { right++; assert(f[v * 11] < 0, 'the right wing on her right'); }
      else assert(false, 'a wing bone');
    }
    assert(left > 10 && right > 10 && Math.abs(left - right) < left * 0.5, `both sides (${left}, ${right})`);
    const poser = createHenPoser(built.skeleton, R.motion, built.idle);
    const shut = poser.pose(stillPose()), open = poser.pose({ ...stillPose(), wing: 1, flap: 1, dust: 1, shake: 1, drink: 1, tuck: 1, crouch: 1, preen: { side: 'l', u: 0.5 } });
    assert(open.every(Number.isFinite), 'every clip poses finite bones');
    const m = open.subarray(wl * 16, wl * 16 + 16), s = shut.subarray(wl * 16, wl * 16 + 16);
    assert(m.some((x, i) => Math.abs(x - s[i]) > 0.05), 'the wing bone turns');
  });

  test(G, 'the perch stands off the pad, its bar facing the fire; a well-formed mesh; where she roosted is saved', async () => {
    const R = await load();
    const ring = { x: 0, z: 0 }, home = { x: 0, z: 10 };
    const pad = (/** @type {number} */ x, /** @type {number} */ z) => x * x + z * z <= 3.5 * 3.5;
    const p = perchSpot(R.perch, ring, home, pad);
    assert(!pad(p.x, p.z), 'off the pad');
    const r = perchRoost(p);
    const toward = Math.atan2(ring.x - r.x, ring.z - r.z);
    assert(Math.abs(Math.atan2(Math.sin(r.yaw - toward), Math.cos(r.yaw - toward))) < 1e-6, 'she sits facing the fire');
    const m = perchMesh(R.perch);
    assert(m.data.every(Number.isFinite) && m.indices.length % 3 === 0 && Math.max(...m.indices) < m.data.length / 8, 'a well-formed perch mesh');
    const s0 = { creatures: { hens: newHen(10) } };
    const s1 = henRoosted(s0, 'perch');
    eq(s1.creatures.hens.roost, 'perch');
    eq(henRoosted(s1, 'perch'), s1, 'unchanged when the same');
    eq(henRoosted({}, 'scrub').creatures, undefined, 'nothing before she is out');
  });
}
