// @ts-check
// A trip into the Hollow (H3a; docs/future/16-the-sea-cave.md, The Hollow, The lantern; src/world/hollow/trip.js)
// for tools/unit-tests.html: the same island seed and trip give the same floors, bit for bit, and
// another trip gives other floors; one fill lasts about 5 floors at 2 to 4 minutes a floor; the low
// line comes once, the light goes out at empty and a hit costs a sip; what is left is said in words;
// a third of the trip's finds is dropped in the dark, seeded, the rest kept in order; the save section
// reads an older save as no trips yet; and the zones fade within a zone (the next floor) and hold the
// dark until its floor is made.

import { floorInputs, floorsPerFill, burn, sip, fuelWord, lightShare, dropInTheDark, cleanHollow, emptyHollow } from '../src/world/hollow/trip.js';
import { buildFloor } from '../src/world/hollow/floor.js';
import { clean9, SECTIONS9 } from '../src/save/migrate-format9.js';
import { createZones } from '../src/world/zones/live.js';

const G = 'hollowTrip';
const hollow = async () => (await fetch(new URL('../recipes/world/hollow.json', import.meta.url))).json();

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addHollowTripTests(test, assert, eq) {
  test(G, 'the same island and trip give the same floors; another trip, other floors', async () => {
    const H = await hollow();
    for (const [trip, floor] of [[1, 1], [2, 1], [3, 4]]) {
      const a = buildFloor(floorInputs(424242, trip, floor), H.floors), b = buildFloor(floorInputs(424242, trip, floor), H.floors);
      eq(a.planHash, b.planHash, `trip ${trip} floor ${floor}: the same plan`);
      eq(a.meshHash, b.meshHash, `trip ${trip} floor ${floor}: the same mesh`);
      assert(a.check.ok, `trip ${trip} floor ${floor}: walks from the way in to the way down`);
    }
    const t1 = buildFloor(floorInputs(424242, 1, 1), H.floors), t2 = buildFloor(floorInputs(424242, 2, 1), H.floors);
    assert(t1.planHash !== t2.planHash, 'the next trip goes down through another first floor');
    const s2 = buildFloor(floorInputs(424243, 1, 1), H.floors);
    assert(t1.planHash !== s2.planHash, 'another island, another floor');
    eq(floorInputs(7, 2, 3).level, 3, 'the level is the floor for now (H4 sets where a trip starts)');
  });

  test(G, 'one fill lasts about 5 floors at 2 to 4 minutes a floor (doc 16)', async () => {
    const T = (await hollow()).trip;
    const at3 = floorsPerFill(T, 180);
    assert(at3 > 4.3 && at3 < 5.5, `at 3 minutes a floor: ${at3.toFixed(2)} floors`);
    assert(floorsPerFill(T, 120) > at3 && floorsPerFill(T, 240) < at3, 'more floors when quicker, fewer when slower');
    assert(floorsPerFill(T, 240) > 3.3 && floorsPerFill(T, 120) < 7.5, `2 to 4 minutes: ${floorsPerFill(T, 240).toFixed(1)} to ${floorsPerFill(T, 120).toFixed(1)} floors`);
  });

  test(G, 'the lantern burns faster each floor down, says low once, goes out at empty, and a hit costs a sip', async () => {
    const T = (await hollow()).trip;
    const one = T.fuel - burn(T.fuel, 10, T, 1).fuel, three = T.fuel - burn(T.fuel, 10, T, 3).fuel;
    assert(three > one, 'floor 3 burns faster than floor 1');
    let fuel = T.fuel, lows = 0, outs = 0;
    for (let i = 0; i < 20000 && fuel > 0; i++) { const b = burn(fuel, 0.5, T, 2); fuel = b.fuel; if (b.low) lows++; if (b.out) outs++; }
    eq(lows, 1, 'the low line once');
    eq(outs, 1, 'out once, at empty');
    eq(burn(0, 1, T, 1).out, false, 'an empty lantern does not go out again');
    eq(sip(T.fuel, T), T.fuel - T.sipFuel, 'a hit costs a sip');
    eq(sip(1, T, 3), 0, 'never below empty');
    eq(lightShare(1, T), 1, 'full light while there is plenty');
    assert(lightShare(T.lowShare * 0.5, T) < 1 && lightShare(T.lowShare * 0.5, T) >= T.lowCdShare, 'the light shrinks when low');
    eq(lightShare(0, T), 0, 'and is gone when out');
  });

  test(G, 'what is left is said in words, never a number', async () => {
    const T = (await hollow()).trip;
    eq(fuelWord(1, T), 'A full light', 'full');
    eq(fuelWord(0.5, T), 'Half a light', 'half');
    eq(fuelWord(0.01, T), 'The last of the light', 'nearly out');
    for (let s = 0; s <= 1; s += 0.05) assert(!/\d/.test(fuelWord(s, T)), `no digits at ${s.toFixed(2)}`);
  });

  test(G, 'the light gone: a seeded third of the finds is dropped, the rest kept in order', () => {
    const finds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const r = dropInTheDark(finds, 99, 4, 1 / 3), again = dropInTheDark(finds, 99, 4, 1 / 3);
    eq(r.dropped.length, 3, 'a third dropped');
    eq(r.kept.length, 6, 'the rest kept');
    eq(r.kept.join(''), again.kept.join(''), 'the same share every time');
    eq(r.kept.join(''), finds.filter((f) => r.kept.includes(f)).join(''), 'kept in the order found');
    assert(dropInTheDark(finds, 99, 5, 1 / 3).kept.join('') !== r.kept.join('') || dropInTheDark(finds, 98, 4, 1 / 3).kept.join('') !== r.kept.join(''), 'another trip or island drops others');
    eq(dropInTheDark([], 1, 1, 1 / 3).kept.length, 0, 'an empty list stays empty');
  });

  test(G, 'the save section: trips and the deepest floor; an older save reads as none yet', () => {
    assert(SECTIONS9.includes('hollow'), 'a format 9 section');
    eq(JSON.stringify(clean9('hollow', undefined)), JSON.stringify(emptyHollow()), 'a save from before the Hollow');
    eq(JSON.stringify(cleanHollow({ version: 1, trips: 3, deepest: 5 })), JSON.stringify({ version: 1, trips: 3, deepest: 5 }), 'kept as saved');
    eq(cleanHollow({ version: 1, trips: -2, deepest: 'x' }).trips, 0, 'nonsense reads as none');
  });

  test(G, 'zones: a fade within a zone runs its own swap, and the dark holds while its floor is made', () => {
    const R = { fadeS: 0.5, holdS: 0.2, color: '#000' };
    const Z = createZones({ R, host: null });
    const log = /** @type {string[]} */ ([]);
    let making = true;
    Z.register({ id: 'h', enter: () => { log.push('in'); return true; }, leave: () => log.push('out'), again: () => log.push('again'), pending: () => making });
    Z.go('h');
    for (let i = 0; i < 120; i++) Z.tick(1 / 60);
    eq(Z.active(), null, 'still dark while the floor is made');
    eq(Z.darkness(), 1, 'the screen stays dark');
    making = false;
    for (let i = 0; i < 120; i++) Z.tick(1 / 60);
    eq(Z.active(), 'h', 'in once it is made');
    Z.again();
    for (let i = 0; i < 120; i++) Z.tick(1 / 60);
    eq(log.join(','), 'in,again', 'the next floor swaps within the zone, never leaving it');
    eq(Z.active(), 'h', 'still in the zone');
    Z.go('h');
    eq(Z.busy(), false, 'going to the zone you are in does nothing');
  });
}
