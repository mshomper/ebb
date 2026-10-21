// @ts-check
// The nets (docs/future/12, piece K6) for tools/unit-tests.html: where a net may be cast, when it is
// ready, the beachcomber's stop that gives it, and save format 7. The haul and the living catches
// have their own groups below.

import { cleanNets, emptyNets, ensureNets, canCast, cast, bringIn, netState, nextHighTide, readyHour, noteReleased, RELEASED_CAP } from '../src/world/nets/model.js';
import { due, grant, keptFamily } from '../src/world/expansion.js';
import { nets7 } from '../src/save/migrate-nets.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { snapshot, restore } from '../src/save/sections.js';

const G = 'nets';
const TIDE = { periodH: 12, phaseH: 0 };
const RULE = { wadeM: 0.15, coverM: 0.08 };

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addNetsTests(test, assert, eq) {
  test(G, 'a net goes in the shallows of the tide band, never fresh water, high ground or deep water', () => {
    const at = { band: true, depth: 0.05, ground: -0.4, nextHighLevel: 0.6 };
    assert(canCast(at, RULE).ok, 'ankle deep in the band');
    assert(canCast({ ...at, depth: 0 }, RULE).ok, 'bare wet sand the tide will cover');
    eq(/** @type {any} */ (canCast({ ...at, band: false, depth: 0.3 }, RULE)).reason, 'fresh', 'a pond');
    eq(/** @type {any} */ (canCast({ ...at, band: false, depth: 0 }, RULE)).reason, 'dry', 'dry land');
    eq(/** @type {any} */ (canCast({ ...at, ground: 0.55 }, RULE)).reason, 'dry', 'too high for the coming tide');
    eq(/** @type {any} */ (canCast({ ...at, depth: 0.4 }, RULE)).reason, 'deep', 'too deep to wade');
  });

  test(G, 'cast at low water, it fishes the next high water and is ready at the low after it, and waits', () => {
    let s = ensureNets(emptyNets(), { general: true });
    eq(s.nets.length, 1, 'one net once given');
    eq(ensureNets(s, { general: true }).nets.length, 1, 'never a second of the same kind');
    const id = s.nets[0].id;
    eq(netState(s.nets[0], 30, TIDE).state, 'in', 'in until cast');
    s = cast(s, id, 3, 4, 30, TIDE); // low water at hour 30
    eq(/** @type {any} */ (s.nets[0].at).setTide, 3, 'the high water at hour 36');
    eq(nextHighTide(36, TIDE), 4, 'cast right at high water, it waits for the next');
    const fishing = /** @type {any} */ (netState(s.nets[0], 33, TIDE));
    eq(fishing.state, 'fishing', 'fishing through the high water');
    eq(fishing.hoursLeft, 9, 'ready at the low water at hour 42');
    eq(readyHour(3, TIDE), 42, 'the low water after it');
    eq(netState(s.nets[0], 42, TIDE).state, 'ready', 'ready at that low water');
    eq(netState(s.nets[0], 42 + 24 * 30, TIDE).state, 'ready', 'and a month later, still ready (it never spoils)');
    s = bringIn(s, id);
    eq(netState(s.nets[0], 50, TIDE).state, 'in', 'lifting brings it in');
  });

  test(G, 'the test link casts a net that is ready at once', () => {
    const s = cast(ensureNets(emptyNets(), { general: true }), 1, 0, 0, 30, TIDE, { readyNow: true });
    eq(netState(s.nets[0], 30, TIDE).state, 'ready', 'ready at once');
  });

  test(G, 'released catches: the first of each kind, and distinctive ones, up to the cap', () => {
    let s = emptyNets();
    s = noteReleased(s, { kind: 'goby', seed: 1, hour: 5 }, false);
    s = noteReleased(s, { kind: 'goby', seed: 2, hour: 6 }, false);
    eq(s.released.length, 1, 'a second plain goby is not kept');
    s = noteReleased(s, { kind: 'goby', seed: 3, hour: 7 }, true);
    eq(s.released.length, 2, 'a distinctive one is');
    for (let i = 0; i < RELEASED_CAP + 5; i++) s = noteReleased(s, { kind: 'wrasse', seed: 100 + i, hour: 8 + i }, true);
    eq(s.released.length, RELEASED_CAP, 'never more than the cap');
    assert(s.released.some((r) => r.kind === 'goby' && r.seed === 1), "a kind's first is never forgotten");
  });

  test(G, 'nets read back from a save keep only what is readable', () => {
    eq(cleanNets(null).nets.length, 0, 'nothing readable is no nets');
    const c = cleanNets({ nets: [{ id: 2, kind: 'general', at: { x: 1, z: 2, setTide: 5 } }, { id: 'x' }], released: [{ kind: 'goby', seed: 4, hour: 1 }, {}], nextId: 1 });
    eq(c.nets.length, 1, 'the unreadable net goes');
    eq(c.nets[0].wear, 0, 'wear starts at 0 (K7)');
    eq(c.nextId, 3, 'the next id is past the highest');
    eq(c.released.length, 1, 'the unreadable release goes');
  });

  test(G, "the beachcomber's stop: the net at four families kept, once, never taken back", async () => {
    const B = await fetch('../recipes/world/beachcomber.json').then((r) => r.json());
    const ask = (/** @type {any} */ earned) => due({ found: 0, flags: [], earned, rewards: [], gifts: {}, words: {}, giftWords: {}, stops: B.stops });
    let earned = {};
    for (const f of ['shell', 'stone', 'shell', 'feather']) earned = keptFamily(earned, f);
    eq(/** @type {any} */ (earned).kept.length, 3, 'three families, a family counted once');
    eq(ask(earned).length, 0, 'nothing at three');
    earned = keptFamily(earned, 'urchin');
    const g = ask(earned);
    eq(g.length, 1, 'the net at four');
    eq(g[0].id, 'net', 'it is the net');
    earned = grant(earned, g[0]);
    assert(/** @type {any} */ (earned).nets?.general, 'the general net is given');
    eq(ask(earned).length, 0, 'once only');
    eq(keptFamily(earned, 'shell'), earned, 'keeping a family again changes nothing');
  });

  test(G, 'save format 7: the nets come back exactly, and an older island gets none and its kept families', () => {
    eq(FORMAT, 7, 'this build writes format 7');
    let n = ensureNets(emptyNets(), { general: true });
    n = cast(n, 1, 2.5, -3, 30, TIDE);
    n = noteReleased(n, { kind: 'goby', seed: 77, hour: 41 }, false);
    const { sections } = snapshot(/** @type {any} */ ({ build: 't', seed: 1, island: 'x', worldT: 0, flow: 1, world: {}, journal: null, water: null,
      unlocks: {}, view: null, looks: {}, chunks: {}, mirror: null, savedAt: 0, wallHighWater: 0, nets: n }));
    eq(JSON.stringify(restore(Object.fromEntries(sections)).nets), JSON.stringify(n), 'the nets come back exactly');
    const old = { meta: {}, unlocks: { shells: true }, keepsakes: { version: 1, nextId: 3, shelf: [{ id: 1, n: { family: 'shell' }, hour: 1 }, { id: 2, n: { family: 'stone' }, hour: 2 }] } };
    const up = migrate(structuredClone(old), 6);
    eq(JSON.stringify(up.nets), JSON.stringify(emptyNets()), 'no nets yet');
    eq(up.unlocks.kept.join(), 'shell,stone', 'the families on its shelf are kept families');
    assert(up.unlocks.shells, 'the rest of its unlocks stay');
    nets7(old);
    assert(!(/** @type {any} */ (old)).nets, 'the input is not changed');
  });
}
