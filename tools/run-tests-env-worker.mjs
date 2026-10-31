// Inside one of run-tests-env.mjs's worker threads: makes the thread look like a browser module
// worker (self, postMessage, onmessage, WorkerGlobalScope), then loads the worker's script.

import { parentPort, workerData } from 'node:worker_threads';

const g = /** @type {any} */ (globalThis);
class WorkerGlobalScope extends EventTarget {}
g.WorkerGlobalScope = WorkerGlobalScope;
Object.setPrototypeOf(globalThis, Object.assign(Object.create(WorkerGlobalScope.prototype), Object.getPrototypeOf(globalThis)));
g.self = globalThis;
g.onmessage = null;
const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);
/** @param {any} data @param {any} [transfer] */
g.postMessage = (data, transfer) => {
  const list = Array.isArray(transfer) ? transfer : transfer?.transfer;
  port.postMessage(data, list?.filter((/** @type {any} */ t) => t instanceof ArrayBuffer || t instanceof MessagePort));
};
port.on('message', (data) => {
  const ev = new MessageEvent('message', { data });
  g.onmessage?.(ev);
});

await import('./run-tests-env.mjs');
await import(workerData.href);
