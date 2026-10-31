// @ts-check
// The event bus (src/core/events.js). Moved from the test page on October 31, 2026, so it runs in
// workers and in Node (tools/run-tests.mjs).

import { createBus } from '../src/core/events.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addEventsTests(test, assert, eq) {
  test('events', 'listeners run in order and unsubscribe works', () => {
    const bus = createBus();
    /** @type {string[]} */
    const got = [];
    bus.on('a', (p) => got.push(`1:${p}`));
    const un = bus.on('a', (p) => got.push(`2:${p}`));
    const third = (/** @type {any} */ p) => got.push(`3:${p}`);
    bus.on('a', third);
    bus.emit('a', 'x');
    un();
    bus.off('a', third);
    bus.emit('a', 'y');
    eq(got.join(' '), '1:x 2:x 3:x 1:y', 'order');
  });

  test('events', 'deferred events wait for flush and keep their order', () => {
    const bus = createBus();
    /** @type {string[]} */
    const got = [];
    bus.on('e', (p) => {
      got.push(p);
      if (p === 'b') bus.emitDeferred('e', 'late');
    });
    bus.emitDeferred('e', 'a');
    bus.emitDeferred('e', 'b');
    eq(got.length, 0, 'before flush');
    eq(bus.flushDeferred(), 2, 'first flush count');
    eq(got.join(' '), 'a b', 'first flush');
    bus.flushDeferred();
    eq(got.join(' '), 'a b late', 'second flush');
  });
}
