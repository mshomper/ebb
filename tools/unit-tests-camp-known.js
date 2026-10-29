// @ts-check
// The camp becoming a known place (B1 C1; docs/future/13 C-14, C-24, C-36, C-37): the gift stone's
// parts match no other make or build, gifts laid on the stone stay off the gift spot until taken up,
// a species' grant maps to its gift-spot gift, `known` grows a quarter a season of rests and never
// falls, the known ring shrinks comfort rings only near camp, the herb bed's strip and its edging,
// and an older camp section (no gifts, known or bed) reads as before.

import { layout, serves, recordMade, cleanCook } from '../src/world/camp/making.js';
import { cleanCamp } from '../src/world/camp/model.js';
import { hasGiftStone, cleanGifts, leaveGift, takeGift, lying, waitingIds, stoneGiftFor } from '../src/world/camp/gifts.js';
import { noKnown, cleanKnown, noteRest, seasonKey, ringShare, knownRing } from '../src/world/camp/known.js';
import { inBed, bedSpecies, edgingPebbles, cleanBed } from '../src/world/camp/herb-bed.js';
import { padOf, padToWorld } from '../src/world/camp/layout.js';
import { giftStoneMesh, giftTokenMesh } from '../src/world/camp/gift-meshes.js';
import { giftItems } from '../src/world/sowing/model.js';
import { due } from '../src/world/expansion.js';
import { ringScale } from '../src/world/creatures/presence.js';
import { campView } from '../src/ui/journal-camp.js';
import { clean9 } from '../src/save/migrate-format9.js';

const G = 'camp: known place';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addCampKnownTests(test, assert, eq) {
  test(G, 'the gift stone is a flat stone and two handfuls of shells, into the gift slot; no other make or build takes the same parts', async () => {
    const C = await load('world/cook'), s = cleanCook(null), m = C.makes['gift-stone'];
    eq(JSON.stringify(m.parts), JSON.stringify(['flat-stones', 'shells', 'shells']), 'its parts (Matt, October 29, 2026)');
    eq(m.out, 'slot', 'it stands in a camp slot');
    eq(m.slot, 'gift', 'the gift slot');
    eq(m.max, 1, 'only one');
    const laid = ['shells', 'flat-stones', 'shells'];
    const L = layout(C, 'workbench', laid, s, { filled: () => true });
    assert(L.complete && L.make === 'gift-stone', 'laid in any order, it is the gift stone and nothing else');
    assert(layout(C, 'workbench', laid, recordMade(s, 'gift-stone', 4), { filled: () => true }).make !== 'gift-stone', 'once made it is not offered again');
    // Its parts complete no other make: every other make's parts filled by exactly these handfuls.
    const fills = (/** @type {any[]} */ parts) => {
      if (parts.length !== laid.length) return false;
      const used = laid.map(() => false);
      return parts.every((p) => { const i = laid.findIndex((k, j) => !used[j] && serves(p, k)); if (i < 0) return false; used[i] = true; return true; });
    };
    for (const [id, other] of Object.entries(C.makes)) {
      if (id === 'gift-stone') continue;
      assert(!fills(/** @type {any} */ (other).parts), `${id} does not take a flat stone and two handfuls of shells`);
    }
    for (const [id, b] of Object.entries(C.builds)) {
      const parts = /** @type {any} */ (b).parts.flatMap((/** @type {[string, number]} */ [k, n]) => Array(n).fill(k));
      assert(!fills(parts), `the ${id} build takes other parts`);
    }
    for (const k of ['pageNames', 'pageParts', 'made']) assert(C.words[k]['gift-stone'], `the camp page's ${k} has the gift stone`);
  });

  test(G, 'a gift is laid once on the stone, kept off the gift spot while it lies there, and on the spot once taken up', async () => {
    const S = await load('world/sowing');
    const unlocks = { seeds: { pondweed: true }, raft: true, earned: {} };
    eq(giftItems(S, unlocks).map((g) => g.id).join(), 'pondweed,raft', 'before the stone: both on the spot');
    let gifts = /** @type {any} */ (leaveGift([], { kind: 'pondweed', from: 'minnows', hour: 10, seed: 3 }));
    eq(gifts.length, 1, 'laid');
    eq(leaveGift(gifts, { kind: 'pondweed', from: 'minnows', hour: 11, seed: 4 }), null, 'the same gift from the same creature is laid once, ever');
    eq(waitingIds(gifts, S).join(), 'pondweed', 'it waits on the stone');
    eq(giftItems(S, unlocks, waitingIds(gifts, S)).map((g) => g.id).join(), 'raft', 'so the spot holds only the raft');
    gifts = takeGift(gifts, 0, 12);
    eq(gifts[0].taken, 12, 'taken up at that hour, and kept for the camp page');
    eq(lying(gifts).length, 0, 'nothing lies there now');
    eq(takeGift(gifts, 0, 13), null, 'it cannot be taken twice');
    eq(giftItems(S, unlocks, waitingIds(gifts, S)).map((g) => g.id).join(), 'pondweed,raft', 'on the spot again');
    const hen = leaveGift(gifts, { kind: 'hen-feather', from: 'hen', hour: 20, seed: 5, name: 'A tail feather' });
    eq(waitingIds(/** @type {any} */ (hen), S).length, 0, "another system's gift (the hen's feather) is not a gift-spot gift");
    eq(cleanGifts([{ kind: 'raft', from: 'turtles', hour: 'x' }, null, { from: 'x' }]).length, 1, 'cleaning keeps only gifts with a kind');
  });

  test(G, "a species' grant gives its gift-spot gift; a tool gift gives nothing to carry; the card says the stone once it stands", async () => {
    const S = await load('world/sowing'), N = await load('world/naturalist'), words = await load('world/journal');
    eq(stoneGiftFor({ kind: 'gift', give: { seeds: { pondweed: true } } }, S), 'pondweed', "the minnows' seeds");
    eq(stoneGiftFor({ kind: 'gift', give: { raft: true } }, S), 'raft', "the turtles' raft");
    eq(stoneGiftFor({ kind: 'gift', give: { cliffs: true } }, S), null, "the frogs' Cliff tool comes as it does today");
    eq(stoneGiftFor({ kind: 'reward', give: { raft: true } }, S), null, 'only a species gift');
    const p = { found: 0, flags: ['minnows:known'], earned: {}, rewards: [], gifts: { minnows: { kind: 'seed', id: 'pondweed' } }, words, giftWords: N.gifts };
    const before = due(p)[0], after = due({ ...p, stone: true })[0];
    assert(/gift spot/.test(before.line) && !/gift stone/.test(before.line), 'before the stone: waiting on your gift spot');
    assert(/gift stone/.test(after.line), 'after: left on the gift stone');
    eq(JSON.stringify(after.give), JSON.stringify(before.give), 'the gift itself is the same');
    assert(!hasGiftStone({ slots: [] }) && hasGiftStone({ slots: [{ slot: 'gift', kind: 'gift-stone' }] }), 'the stone stands once its slot is filled');
  });

  test(G, 'known grows a quarter for each season with six rests at camp, never more than once a season, to 1, and never falls', async () => {
    const R = (await load('world/camp')).known;
    eq(R.restsPerSeason, 6, 'six rests');
    eq(R.perSeason, 0.25, 'a quarter a season');
    let k = noKnown(), rises = 0;
    for (let i = 0; i < 5; i++) { const r = noteRest(k, 0, R); k = r.known; rises += Number(r.rose); }
    eq(k.level, 0, 'five rests in spring: nothing yet');
    let r = noteRest(k, 0, R);
    assert(r.rose && r.known.level === 0.25, 'the sixth rest raises it');
    k = r.known;
    for (let i = 0; i < 10; i++) k = noteRest(k, 0, R).known;
    eq(k.level, 0.25, 'more rests that season add nothing');
    k = noteRest(k, 1, R).known;
    eq(k.rests, 1, 'a new season counts again');
    eq(k.level, 0.25, 'and nothing falls with a new season');
    for (let season = 1; season < 8; season++) for (let i = 0; i < 6; i++) k = noteRest(k, season, R).known;
    eq(k.level, 1, 'four counted seasons reach 1, and it stops there');
    eq(seasonKey({ year: 2, index: 3 }), 11, 'seasons are counted across the years');
    eq(JSON.stringify(cleanKnown(k)), JSON.stringify(k), 'cleaning twice changes nothing');
    eq(cleanKnown({ level: 5 }).level, 1, 'a level is kept within 0..1');
  });

  test(G, 'the known ring shrinks a comfort ring only near camp: by 15% at full, through the walker', async () => {
    const R = (await load('world/camp')).known;
    eq(ringShare(1, R), 0.85, 'at full: 0.85');
    eq(ringShare(0.5, R), 1 - 0.15 * 0.5, 'half known: half the shrink');
    eq(knownRing({ x: 0, z: 0 }, noKnown(), R), null, 'nothing known: no ring');
    const ring = /** @type {any} */ (knownRing({ x: 10, z: 0 }, { level: 1, season: 0, rests: 6, counted: true }, R));
    const M = { posture: { stand: 1 }, gaze: { watch: 1, away: 1 }, gazeConeDeg: 30 };
    const you = /** @type {any} */ ({ posture: 'stand', gaze: null, pos: [10, 1, 0], known: ring });
    eq(ringScale(you, 12, 0, M), 0.85, 'a creature 2 m from the pad lets you closer');
    eq(ringScale(you, 10 + R.reachM + 1, 0, M), 1, 'one beyond reach does not');
    eq(ringScale({ ...you, known: null }, 12, 0, M), 1, 'without a known place nothing changes');
  });

  test(G, 'the herb bed lies off the pad, edging pebbles go round it, and it names what grows there', async () => {
    const land = await load('land/starter-island-2'), pad = /** @type {any} */ (padOf(land));
    const b = land.camp.offPad.bed, [cx, cz] = padToWorld(pad, b.u, b.v);
    assert(inBed(pad, cx, cz), 'its middle is in the bed');
    assert(Math.hypot(cx - pad.x, cz - pad.z) - b.d / 2 > pad.r, 'the whole strip lies off the pad');
    const [ox, oz] = padToWorld(pad, b.u, b.v + b.d);
    assert(!inBed(pad, ox, oz), 'a step beyond is not');
    const plants = [{ id: 9, sp: 'watermint', x: cx + 0.3 * pad.fx, z: cz + 0.3 * pad.fz }, { id: 4, sp: 'chamomile', x: cx, z: cz }, { id: 5, sp: 'thrift', x: ox, z: oz }, { id: 6, sp: 'chamomile', x: cx, z: cz }];
    eq(bedSpecies(pad, plants).join(), 'chamomile,watermint', 'what grows there, each once, first planted first');
    const E = (await load('world/camp')).bed.edging, peb = edgingPebbles(pad, 7, E);
    assert(peb.length >= 16, `pebbles all round (${peb.length})`);
    assert(peb.every((p) => !inBed(pad, p.x, p.z) && inBed(pad, p.x, p.z, E.outM + E.jitterM + 0.01)), 'each just outside the strip');
    eq(JSON.stringify(edgingPebbles(pad, 7, E)), JSON.stringify(peb), 'the same seed, the same pebbles');
    eq(cleanBed({ edged: 'x' }).edged, null, 'a bad hour reads as not edged');
  });

  test(G, 'an older camp section reads with no gifts, nothing known and no bed; the new fields survive the save', () => {
    const old = { version: 1, kit: { tent: 'pitched', lantern: 'pole' }, slots: [{ slot: 'tent', kind: 'tent', seed: 1, placedHour: 2 }], later: 3 };
    const c = cleanCamp(old);
    eq(c.gifts.length, 0, 'no gifts');
    eq(c.known.level, 0, 'nothing known');
    eq(c.bed.edged, null, 'no edging');
    eq(/** @type {any} */ (c).later, 3, 'a later field is kept');
    const now = cleanCamp({ ...old, gifts: [{ kind: 'raft', from: 'turtles', hour: 30, seed: 2, taken: null }], known: { level: 0.5, season: 6, rests: 2, counted: false }, bed: { edged: 40 } });
    eq(JSON.stringify(cleanCamp(JSON.parse(JSON.stringify(now)))), JSON.stringify(now), 'saved and read back unchanged');
    eq(JSON.stringify(clean9('camp', now)), JSON.stringify(now), 'format 9 cleans the camp the same way');
  });

  test(G, 'the stone and its gifts are made in code: a low stone with shells, each gift its own small shape', async () => {
    const GS = (await load('world/camp')).giftStone;
    const s = giftStoneMesh(5, GS);
    assert(s.mesh.count > 100 && s.mesh.indices.length % 3 === 0, 'a mesh');
    assert(s.topM > 0.04 && s.topM < 0.12, `low (${s.topM.toFixed(3)} m)`);
    for (const [k, t] of Object.entries(GS.tokens)) {
      const m = giftTokenMesh(3, t);
      assert(m.count > 10 && Array.from(m.vertices).every(Number.isFinite), `${k} is a finite mesh`);
    }
  });

  test(G, 'the camp page writes each gift with the creature that left it, and what grows in the herb bed', async () => {
    const C = await load('world/cook'), words = await load('world/journal');
    const camp = cleanCamp({ slots: [{ slot: 'ring', kind: 'ring', placedHour: 1 }, { slot: 'gift', kind: 'gift-stone', placedHour: 5 }],
      gifts: [{ kind: 'pondweed', from: 'minnows', hour: 30, seed: 1, taken: 31 }], bed: { edged: 40 } });
    const html = campView(C, camp, { made: { 'gift-stone': 5 } }, null, words, { grows: ['chamomile'] });
    assert(html.includes('Gift stone'), 'the gift stone among the firsts');
    assert(/Pondweed seeds from the minnows/i.test(html), 'the gift and who left it');
    assert(html.includes(words.species.chamomile.name), 'chamomile in the herb bed');
    assert(!campView(C, cleanCamp({ slots: [{ slot: 'ring', kind: 'ring' }] }), {}, null, words).includes(C.words.page.bed), 'no herb bed line before the edging');
  });
}
