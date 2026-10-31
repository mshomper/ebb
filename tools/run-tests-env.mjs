// The small piece of a browser worker that the unit test files expect, for Node
// (tools/run-tests.mjs). Import it before any test file.
//   - fetch of a repo file (a relative URL, read from tools/ as the page's test worker does, or a
//     file: URL from import.meta.url) reads it from disk;
//   - self and location, as a worker in tools/ has them;
//   - Worker: a module Web Worker over node:worker_threads, so src/core/workers.js and the tests
//     that start a worker of their own run as they do in the browser.
// Nothing else is faked: a test that needs WebGPU, Web Audio or the DOM stays on the page.

import { readFile } from 'node:fs/promises';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Where a relative URL starts from: the page's test worker lives in tools/. */
const BASE = new URL('./unit-tests-worker.js', import.meta.url);

const g = /** @type {any} */ (globalThis);
g.self ??= globalThis;
g.location ??= BASE;

const MIME = { json: 'application/json', js: 'text/javascript', mjs: 'text/javascript', wgsl: 'text/plain', md: 'text/plain', txt: 'text/plain' };
const netFetch = globalThis.fetch;

/** @param {any} input @param {any} [init] */
g.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input instanceof URL ? input.href : input);
  const url = new URL(raw, BASE);
  if (url.protocol !== 'file:') return netFetch(input, init);
  const ext = /** @type {keyof typeof MIME} */ (url.pathname.split('.').pop() ?? '');
  try {
    const body = await readFile(fileURLToPath(url));
    return new Response(body, { status: 200, headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' } });
  } catch {
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  }
};

// ---- Worker ----

const BOOT = new URL('./run-tests-env-worker.mjs', import.meta.url);

/** A module Web Worker in a worker thread: postMessage, onmessage, onerror, terminate. */
class NodeWebWorker extends EventTarget {
  /** @param {string | URL} url @param {{type?: string}} [opts] */
  constructor(url, opts) {
    super();
    /** @type {((ev: any) => void) | null} */ this.onmessage = null;
    /** @type {((ev: any) => void) | null} */ this.onerror = null;
    const href = new URL(String(url instanceof URL ? url.href : url), BASE).href;
    this.thread = new ThreadWorker(BOOT, { workerData: { href, type: opts?.type ?? 'classic' } });
    // A pool worker must not keep the runner alive after its last test.
    this.thread.unref();
    this.thread.on('message', (data) => {
      const ev = new MessageEvent('message', { data });
      this.onmessage?.(ev);
      this.dispatchEvent(ev);
    });
    this.thread.on('error', (err) => {
      const ev = /** @type {any} */ (new Event('error', { cancelable: true }));
      ev.message = err?.message ?? String(err);
      ev.error = err;
      this.onerror?.(ev);
      this.dispatchEvent(ev);
    });
  }
  /** @param {any} data @param {any} [transfer] */
  postMessage(data, transfer) {
    const list = Array.isArray(transfer) ? transfer : transfer?.transfer;
    this.thread.postMessage(data, list?.filter((/** @type {any} */ t) => t instanceof ArrayBuffer || t instanceof MessagePort));
  }
  terminate() { this.thread.terminate(); }
}

g.Worker ??= NodeWebWorker;

export const TOOLS_URL = new URL('./', import.meta.url);
export const toolsPath = (/** @type {string} */ p) => fileURLToPath(new URL(p, TOOLS_URL));
export { pathToFileURL };
