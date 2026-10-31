// @ts-check
// Terrain undo tiles and the action history (src/world/terrain/undo.js, src/input/actions.js).
// Moved from the test page on October 31, 2026, so it runs in workers and in Node
// (tools/run-tests.mjs).

import { hash32 } from '../src/core/rng.js';
import { tilesOf, copyTiles, pasteTiles } from '../src/world/terrain/undo.js';
import { createHistory } from '../src/input/actions.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addUndoTests(test, assert, eq) {
  test('undo', 'tiles copied before an edit restore the mirror exactly', () => {
    const N = 768;
    const mirror = { heightQ: new Uint16Array(N * N), heightF: new Float32Array(N * N), material: new Uint8Array(N * N * 4) };
    for (let k = 0; k < N * N; k++) { mirror.heightQ[k] = hash32(k) & 0xffff; mirror.material[k * 4] = k & 255; }
    const rect = { x: 300, y: 310, w: 50, h: 20 };
    const ids = tilesOf(rect);
    eq(ids.length, 4, 'a 50 x 20 rect at (300, 310) overlaps 2 x 2 tiles of 32 cells');
    const before = copyTiles(mirror, ids);
    const orig = mirror.heightQ.slice();
    const origM = mirror.material.slice();
    for (let j = rect.y; j < rect.y + rect.h; j++) for (let i = rect.x; i < rect.x + rect.w; i++) { mirror.heightQ[j * N + i] = 7; mirror.material[(j * N + i) * 4 + 2] = 99; }
    const after = copyTiles(mirror, ids);
    pasteTiles(mirror, before);
    for (let k = 0; k < N * N; k++) if (mirror.heightQ[k] !== orig[k]) throw new Error(`height differs at cell ${k}`);
    for (let k = 0; k < N * N * 4; k++) if (mirror.material[k] !== origM[k]) throw new Error(`material differs at byte ${k}`);
    pasteTiles(mirror, after);
    eq(mirror.heightQ[(rect.y + 5) * N + rect.x + 5], 7, 'redo puts the edit back');
  });

  test('undo', 'history steps back and forth, clears redo on a new edit and drops the oldest past its budget', () => {
    const h = createHistory({ budgetBytes: 1000 });
    /** @type {string[]} */
    const log = [];
    h.setApplier('t', (cmd, dir) => { log.push(`${dir}:${cmd.id}`); return true; });
    h.push({ kind: 't', bytes: 400, id: 1 });
    h.push({ kind: 't', bytes: 400, id: 2 });
    assert(h.undo() && h.undo(), 'two undos');
    eq(h.canUndo(), false, 'nothing left to undo');
    assert(h.redo(), 'redo');
    h.push({ kind: 't', bytes: 400, id: 3 });
    eq(h.canRedo(), false, 'a new edit clears redo');
    h.push({ kind: 't', bytes: 400, id: 4 });
    eq(h.depth().undo, 2, 'budget of 1000 bytes keeps the newest two 400-byte steps');
    eq(log.join(' '), 'undo:2 undo:1 redo:1', 'applier calls');
    const busy = createHistory({ budgetBytes: 1000 });
    busy.setApplier('t', () => false);
    busy.push({ kind: 't', bytes: 1 });
    eq(busy.undo(), false, 'a busy owner refuses');
    eq(busy.canUndo(), true, 'and the step stays on the stack');
  });
}
