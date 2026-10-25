// @ts-check
// Save format 9 (docs/future/13 section 12.1), the keeper's camp skeleton, for tools/unit-tests.html:
// the upgrade from 8 adds six empty sections, they come back exactly, and bad ones come back empty.

import { format9, SECTIONS9, empty9, clean9 } from '../src/save/migrate-format9.js';
import { migrate, FORMAT, MIGRATIONS } from '../src/save/migrate.js';
import { snapshot, restore } from '../src/save/sections.js';

const G = 'save format 9';

/** A bare island's parts for snapshot. @param {Record<string, any>} [more] */
const parts = (more = {}) => /** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
  unlocks: {}, view: null, looks: {}, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0, ...more });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFormat9Tests(test, assert, eq) {
  test(G, 'one step from 8 to 9 adds camp, pack, gather, dig, cook and dyes, empty (and the sketchbook, P2i)', () => {
    assert(FORMAT >= 9, 'this build writes format 9 or later (10 since planting on foot, tools/unit-tests-sowing.js)');
    eq(SECTIONS9.join(), 'camp,pack,gather,dig,cook,dyes,sketchbook', 'the six sections of section 12.1, then the sketchbook (P2i)');
    eq(MIGRATIONS.filter((m) => m.from === 8 && m.to === 9).length, 1, 'one step');
    const old = { meta: { worldT: 5 }, unlocks: { shells: true }, nets: { version: 1, nets: [], released: [], nextId: 1 } };
    const up = migrate(structuredClone(old), 8);
    for (const id of SECTIONS9) if (id !== 'camp') eq(JSON.stringify(up[id]), JSON.stringify(empty9(id)), `${id} is empty`);
    eq(JSON.stringify(up.camp), '{"version":1,"stamped":false,"kit":{"tent":"pack","lantern":"pole"}}', 'the camp waits unstamped, the tent in the pack (CP-07)');
    const withJournal = migrate({ ...structuredClone(old), journal: { species: {}, flags: ['frogs:happy'], notes: [] } }, 8);
    eq(withJournal.journal.flags.join(), 'frogs:happy,intro:done,intro:older', 'an older island skips the first evening');
    eq(JSON.stringify(up.gather), '{"version":1,"events":[]}', 'gather starts with no events');
    assert(up.unlocks.shells && up.meta.worldT === 5 && up.nets.nextId === 1, 'the rest of the island stays');
    format9(old);
    assert(!(/** @type {any} */ (old)).camp, 'the input is not changed');
    eq(JSON.stringify(format9(structuredClone(old))), JSON.stringify(format9(structuredClone(old))), 'the same every time');
  });

  test(G, 'an island from format 1 comes all the way up to 9', () => {
    const up = migrate({ meta: { worldT: 10 }, world: null, journal: { species: {}, flags: [], notes: [] }, unlocks: {} }, 1);
    for (const id of SECTIONS9) assert(up[id]?.version === 1, `${id} is there`);
    assert(Array.isArray(up.pieces?.list) && Array.isArray(up.nets?.nets) && Array.isArray(up.unlocks?.firsts), 'the earlier steps ran too');
  });

  test(G, 'the sections come back exactly; missing or unreadable ones come back empty', () => {
    // The pack, gather and cook sections in their real shapes (src/world/pack/model.js, src/world/gather/events.js,
    // src/world/camp/making.js).
    const live = { camp: { version: 1, pad: { x: 1.5, z: -2 } },
      pack: { version: 1, carriers: [], pouches: [['drift-twigs', 3], ['drift-twigs', 1], ['pebbles', 2]], heaps: [['sticks', 1.5, -2, 4, 1]], holding: null },
      gather: { version: 1, events: [3, 4, 50] },
      dig: { version: 1, events: [{ c: 4, d: 2, l: 1, k: 0 }], firsts: ['layer:topsoil'] }, cook: { version: 1, made: { workbench: 4 }, count: { workbench: 1 }, tools: [], found: ['tea'] }, dyes: { version: 1, tent: { color: 'ochre', depth: 1 } },
      sketchbook: { version: 1, made: 2, wear: 2, first: 5, subjects: { frogs: [{ stage: 1, hour: 5, season: 0, moment: null }, { stage: 0, hour: 6, season: 0, moment: 'dusk' }] } } };
    const { sections } = snapshot(parts(live));
    const back = /** @type {any} */ (restore(Object.fromEntries(sections)));
    for (const id of SECTIONS9) eq(JSON.stringify(back[id]), JSON.stringify(live[id]), `${id} comes back exactly`);
    eq(back.extra.length, 0, 'none of them ride along as unknown sections');
    const none = /** @type {any} */ (restore(Object.fromEntries(snapshot(parts()).sections)));
    for (const id of SECTIONS9) eq(JSON.stringify(none[id]), JSON.stringify(empty9(id)), `${id}: a new island writes it empty`);
    for (const bad of [null, 7, [], { version: 2 }, 'x']) eq(JSON.stringify(clean9('camp', bad)), '{"version":1}', `unreadable ${JSON.stringify(bad)} comes back empty`);
    eq(JSON.stringify(clean9('gather', { version: 1 })), '{"version":1,"events":[]}', 'gather without events gets an empty list');
  });
}
