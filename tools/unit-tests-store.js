// @ts-check
// The store (src/core/store.js). Moved from the test page on October 31, 2026, so it runs in
// workers and in Node (tools/run-tests.mjs).

import { createStore, initialSlices } from '../src/core/store.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addStoreTests(test, assert, eq) {
  test('store', 'initial slices hold meta and settings', () => {
    const st = createStore();
    eq(st.get('meta').flow, 1, 'meta.flow');
    eq(st.get('settings').palette, 'dusk', 'settings.palette');
    assert(initialSlices().meta !== initialSlices().meta, 'defaults are fresh objects');
  });

  test('store', 'update by mutation or by return value notifies subscribers', () => {
    const st = createStore();
    /** @type {any[]} */
    const seen = [];
    let otherCalls = 0;
    const un = st.subscribe('meta', (v) => seen.push(v.worldT));
    st.subscribe('settings', () => otherCalls++);
    st.update('meta', (m) => { m.worldT = 60; });
    st.update('meta', (m) => ({ ...m, worldT: 120 }));
    eq(st.get('meta').worldT, 120, 'worldT');
    un();
    st.update('meta', (m) => { m.worldT = 999; });
    eq(seen.join(','), '60,120', 'notifications');
    eq(otherCalls, 0, 'other slice subscriber calls');
    st.update('water', () => ({ chunks: 0 }));
    eq(st.get('water').chunks, 0, 'new slice');
  });
}
