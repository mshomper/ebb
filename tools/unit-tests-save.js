// @ts-check
// Save tests for tools/unit-tests.html (S7a, doc 18): checksums, the .ebb file, a damaged section
// staying alone, and a real island coming back from its save exactly as it was.

import { crc32 } from '../src/save/crc32.js';
import { encode, decode, packValue, unpackValue, SaveError } from '../src/save/world-file.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { snapshot, restore, copyChunk } from '../src/save/sections.js';
import { hashWorldState, runHour } from '../src/sim/tick.js';
import { createMirror } from '../src/world/terrain/heightfield.js';
import { CHUNK_CELLS } from '../src/world/terrain/grid.js';
import { slotFor } from '../src/save/autosave.js';
import { readCopy, assemble } from '../src/save/recover.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const SAVE = 'save';

/** A small island's parts, as app.js hands them to the autosave. @param {any} world @param {any} [mirror] */
function parts(world, mirror = null) {
  return {
    build: 'test', seed: 7, island: 'starter-island', worldT: 36000.5, flow: /** @type {1} */ (1),
    world, journal: { v: 1, notes: [{ hour: 10, text: 'The reeds are up.', n: 1, shown: true }], noteSeq: 1, read: { notes: 1, pages: { reeds: 1 } } },
    water: { springs: [{ id: 's1', x: 3.5, z: -2, rateLps: 0.4 }], version: 1 }, unlocks: { springs: true },
    view: { target: [1, 0.5, -2], yaw: 0.7, pitch: 0.5, distance: 40 }, looks: {},
    chunks: { '0,0': { state: 'open', land: 'land/starter-island', edited: true }, '1,0': { state: 'open', land: 'land/starter-island', edited: false } },
    mirror, savedAt: 1760000000000, wallHighWater: 1760000000000,
  };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSaveTests(test, assert, eq) {
  test(SAVE, 'the live site, each preview and the local server keep their own islands', () => {
    const live = slotFor('starter-island', '/ebb/');
    const preview = slotFor('starter-island', '/ebb/preview/m1-s7a-save/index.html');
    const other = slotFor('starter-island', '/ebb/preview/m1-s7b-catchup/');
    eq(slotFor('starter-island', '/'), 'starter-island', 'local server');
    eq(slotFor('starter-island', '/index.html'), 'starter-island', 'local server, index.html');
    eq(live, '/ebb/starter-island', 'live site');
    assert(live !== preview && preview !== other, 'previews are apart from the live site and each other');
    eq(slotFor('two-ponds', '/ebb/index.html'), '/ebb/two-ponds', 'another island on the live site');
  });

  test(SAVE, 'a damaged save comes back part by part from earlier copies (S7d)', async () => {
    const m = createMirror();
    for (let k = 0; k < m.heightQ.length; k++) m.heightQ[k] = (k * 3) & 0xffff;
    /** Pack a copy, optionally spoiling one section. @param {number} gen @param {number} worldT @param {string} [spoil] */
    async function copy(gen, worldT, spoil) {
      const { header, sections } = snapshot({ ...parts({ tide: { level: worldT } }, m), worldT });
      const bytes = await encode({ ...header, savedAt: 1000 + gen }, sections);
      if (spoil) {
        const head = new DataView(bytes.buffer).getUint32(8, true);
        const s = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + head))).sections.find((/** @type {any} */ x) => x.id === spoil);
        bytes[12 + head + s.offset + Math.floor(s.length / 2)] ^= 0xff;
      }
      return readCopy({ slot: 's', gen, savedAt: 1000 + gen, codec: 'ebb', bytes });
    }
    // The newest copy's island is damaged: the one before opens.
    const a = assemble([await copy(5, 500, 'world'), await copy(4, 400)]);
    eq(a?.from, 'earlier', 'from');
    eq(a?.base.gen, 4, 'the copy before');
    eq(a?.damaged.length, 1, 'the damaged copy is kept aside');
    // One chunk of the newest copy is damaged: only it comes from the copy before.
    const b = assemble([await copy(5, 500, 'chunk:0,0'), await copy(4, 400)]);
    eq(b?.from, 'parts', 'from');
    eq(b?.parts.meta.worldT, 500, 'the island is the newest');
    eq(b?.mended.join(','), 'chunk:0,0', 'mended');
    assert(b?.parts.chunks.some((c) => c.cx === 0 && c.cz === 0 && c.heightQ), 'the chunk is back, with its heights');
    // The journal is damaged in every copy: it starts fresh, said plainly.
    const c = assemble([await copy(5, 500, 'journal'), await copy(4, 400, 'journal')]);
    eq(c?.lost.join(','), 'journal', 'lost');
    eq(c?.parts.journal, null, 'a fresh journal');
    // Nothing reads: no island.
    eq(assemble([await copy(5, 500, 'world')]), null, 'nothing to open');
  });

  test(SAVE, 'crc32 matches the standard check value', () => {
    eq(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'crc32("123456789")');
  });

  test(SAVE, 'a value with typed arrays packs and unpacks unchanged', () => {
    const v = { a: 1.25, s: 'x', list: [1, { u8: new Uint8Array([1, 2, 255]) }], f: new Float32Array([0.5, -2]), u16: new Uint16Array([65535, 3]), none: null };
    const back = unpackValue(packValue(v));
    eq(JSON.stringify(Array.from(back.list[1].u8)), '[1,2,255]', 'Uint8Array');
    assert(back.f instanceof Float32Array && back.f[1] === -2, 'Float32Array');
    assert(back.u16 instanceof Uint16Array && back.u16[0] === 65535, 'Uint16Array');
    eq(back.none, null, 'null');
  });

  test(SAVE, 'the .ebb file reads back, and a damaged section stays alone', async () => {
    const bytes = await encode({ format: FORMAT, seed: 7 }, [['meta', { worldT: 5 }], ['journal', { notes: ['a'] }], ['chunk:0,0', { heights: new Uint16Array(64).fill(9) }]]);
    const d = await decode(bytes);
    assert(d.fileOk, 'file checksum');
    eq(d.bad.length, 0, 'bad sections');
    eq(d.header.seed, 7, 'header');
    eq(d.sections['chunk:0,0'].heights[63], 9, 'chunk heights');
    // Spoil one byte inside the journal section: it alone is lost.
    const j = d.header.sections.find((/** @type {any} */ s) => s.id === 'journal');
    const head = new DataView(bytes.buffer).getUint32(8, true);
    const spoiled = bytes.slice();
    spoiled[12 + head + j.offset + 2] ^= 0xff;
    const d2 = await decode(spoiled);
    assert(!d2.fileOk, 'the file checksum notices');
    eq(d2.bad.join(','), 'journal', 'only the journal is bad');
    eq(d2.sections.meta.worldT, 5, 'meta still reads');
    let threw = false;
    try { await decode(new Uint8Array(40)); } catch (e) { threw = e instanceof SaveError; }
    assert(threw, 'not an island file is refused');
    return `${bytes.length} bytes`;
  });

  test(SAVE, 'a newer save format is refused, the current one passes', () => {
    const s = { meta: {} };
    eq(migrate(s, FORMAT), s, 'same format');
    let threw = false;
    try { migrate(s, FORMAT + 1); } catch { threw = true; }
    assert(threw, 'newer format refused');
  });

  test(SAVE, 'an edited chunk keeps its heights and paint; an untouched one keeps none', async () => {
    const m = createMirror();
    for (let k = 0; k < m.heightQ.length; k++) { m.heightQ[k] = (k * 7) & 0xffff; m.material[4 * k + 2] = k & 0xff; }
    const { header, sections } = snapshot(parts({ tide: { level: 0 } }, m));
    const d = await decode(await encode(header, sections));
    const r = restore(d.sections);
    eq(r.chunks.length, 2, 'two open chunks');
    const edited = r.chunks.find((c) => c.edited), plain = r.chunks.find((c) => !c.edited);
    const want = copyChunk(m, 0, 0);
    assert(edited?.heightQ && edited.heightQ.length === CHUNK_CELLS * CHUNK_CELLS, 'edited heights');
    assert(edited?.heightQ?.every((q, i) => q === want.heightQ[i]), 'heights match');
    assert(edited?.material?.every((q, i) => q === want.material[i]), 'paint matches');
    assert(plain && !plain.heightQ, 'untouched chunk carries no heights');
    eq(r.view.distance, 40, 'view');
    eq(r.journal.read.pages.reeds, 1, 'read marks');
    eq(r.water.springs[0].id, 's1', 'springs');
  });

  test(SAVE, 'a real island after two game days comes back from its save exactly', async () => {
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1, 6);
    let state = w.state;
    for (let h = w.h0 + 1; h <= w.h0 + 48; h++) state = runHour(state, h, w.env).state;
    const before = hashWorldState(state);
    const { header, sections } = snapshot(parts(state));
    const bytes = await encode(header, sections);
    const r = restore((await decode(bytes)).sections);
    eq(hashWorldState(r.world), before, 'world hash after load');
    // Saving the loaded island again gives the same bytes.
    const again = await encode(header, snapshot({ ...parts(r.world) }).sections);
    eq(again.length, bytes.length, 'same size saved again');
    assert(again.every((b, i) => b === bytes[i]), 'same bytes saved again');
    // And the next hour runs the same from the loaded copy.
    eq(hashWorldState(runHour(r.world, w.h0 + 49, w.env).state), hashWorldState(runHour(state, w.h0 + 49, w.env).state), 'next hour');
    return `world ${before.toString(16)}, ${(bytes.length / 1024).toFixed(0)} KB saved`;
  });
}
