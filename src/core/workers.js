// @ts-check
// Worker pool (main thread) and worker entry (inside each worker) in one file (doc 03).
// A job names a module path relative to src/ and an exported function; the worker
// imports it dynamically and posts the result back. Data moves by transferring
// ArrayBuffers; no SharedArrayBuffer.

/**
 * @typedef {Object} Job
 * @property {string} module  path relative to src/, e.g. './core/jobs-selftest.js'
 * @property {string} fn      exported function name
 */
/** @typedef {'interactive'|'background'|'catchup'} Lane */
/**
 * @typedef {Object} RunOptions
 * @property {Transferable[]} [transfer]  buffers in args to transfer to the worker
 * @property {Lane} [lane]                default 'background'
 * @property {string} [key]               a newer queued job with the same key cancels this one
 */

/** True when this module is running inside a worker. */
export const IS_WORKER = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

/** Base URL that job module paths resolve against (the src/ folder). */
const SRC_URL = new URL('../', import.meta.url);

// ---------------------------------------------------------------------------
// Worker side

if (IS_WORKER) {
  const scope = /** @type {any} */ (self);
  scope.onmessage = async (/** @type {MessageEvent} */ e) => {
    const { id, url, fn, args } = e.data;
    try {
      const mod = await import(url);
      if (typeof mod[fn] !== 'function') throw new Error(`workers: ${url} has no export "${fn}"`);
      let result = await mod[fn](args);
      /** @type {Transferable[]} */
      let transfer = [];
      if (result && typeof result === 'object' && Array.isArray(result.__transfer)) {
        transfer = result.__transfer;
        result = { ...result };
        delete result.__transfer;
      }
      scope.postMessage({ id, ok: true, result }, transfer);
    } catch (err) {
      const e2 = /** @type {Error} */ (err);
      scope.postMessage({ id, ok: false, error: { name: e2?.name ?? 'Error', message: String(e2?.message ?? err), stack: e2?.stack } });
    }
  };
}

// ---------------------------------------------------------------------------
// Pool side

/**
 * @typedef {Object} Pending
 * @property {number} id
 * @property {string} url
 * @property {string} fn
 * @property {any} args
 * @property {Transferable[]} transfer
 * @property {Lane} lane
 * @property {string|undefined} key
 * @property {(v: any) => void} resolve
 * @property {(e: Error) => void} reject
 */

/** Lanes in dispatch priority order. */
const LANES = /** @type {Lane[]} */ (['interactive', 'catchup', 'background']);

/** @type {Worker[]} */
let workers = [];
/** @type {Worker[]} */
let idle = [];
/** @type {Map<Worker, Pending>} */
const busy = new Map();
/** @type {Record<Lane, Pending[]>} */
let queues = { interactive: [], catchup: [], background: [] };
let nextId = 1;

/** @param {string} name @param {string} message */
function namedError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

/** Default pool size: hardwareConcurrency - 2, clamped to 1..14. */
export function defaultPoolSize() {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(14, hc - 2));
}

/**
 * Start the pool. Calling it again with a different size rebuilds the pool.
 * @param {{size?: number}} [opts]
 */
export function initWorkers(opts = {}) {
  const size = Math.max(1, Math.floor(opts.size ?? defaultPoolSize()));
  if (workers.length === size) return;
  if (workers.length > 0) dispose();
  for (let i = 0; i < size; i++) {
    const w = new Worker(import.meta.url, { type: 'module' });
    w.onmessage = (e) => onResult(w, e.data);
    w.onerror = (e) => {
      e.preventDefault();
      onResult(w, { ok: false, error: { name: 'WorkerError', message: e.message || 'worker failed to load or crashed' } });
    };
    workers.push(w);
    idle.push(w);
  }
}

/** Number of workers in the pool (0 before initWorkers). */
export function poolSize() {
  return workers.length;
}

/**
 * Run a job on the pool. Starts the pool with default size if needed.
 * @param {Job} job
 * @param {any} args
 * @param {RunOptions} [opts]
 * @returns {Promise<any>}
 */
export function run(job, args, opts = {}) {
  if (workers.length === 0) initWorkers();
  const lane = opts.lane ?? 'background';
  if (!queues[lane]) throw new Error(`workers: unknown lane "${lane}"`);
  if (opts.key !== undefined) cancelQueued(opts.key);
  return new Promise((resolve, reject) => {
    queues[lane].push({
      id: nextId++,
      url: new URL(job.module, SRC_URL).href,
      fn: job.fn,
      args,
      transfer: opts.transfer ?? [],
      lane,
      key: opts.key,
      resolve,
      reject,
    });
    pump();
  });
}

/** Reject queued (not yet running) jobs with this key. @param {string} key */
function cancelQueued(key) {
  for (const lane of LANES) {
    queues[lane] = queues[lane].filter((p) => {
      if (p.key !== key) return true;
      p.reject(namedError('Cancelled', `workers: job "${key}" replaced by a newer one`));
      return false;
    });
  }
}

function pump() {
  while (idle.length > 0) {
    let job;
    for (const lane of LANES) if ((job = queues[lane].shift())) break;
    if (!job) return;
    const w = /** @type {Worker} */ (idle.pop());
    busy.set(w, job);
    w.postMessage({ id: job.id, url: job.url, fn: job.fn, args: job.args }, job.transfer);
  }
}

/** @param {Worker} w @param {any} msg */
function onResult(w, msg) {
  const job = busy.get(w);
  if (!job) return;
  busy.delete(w);
  idle.push(w);
  if (msg.ok) job.resolve(msg.result);
  else {
    const err = namedError(msg.error.name, msg.error.message);
    if (msg.error.stack) err.stack = msg.error.stack;
    job.reject(err);
  }
  pump();
}

/** Stop all workers; queued and running jobs reject with an Error named 'Disposed'. */
export function dispose() {
  for (const w of workers) w.terminate();
  for (const job of busy.values()) job.reject(namedError('Disposed', 'workers: pool disposed'));
  for (const lane of LANES) for (const job of queues[lane]) job.reject(namedError('Disposed', 'workers: pool disposed'));
  workers = [];
  idle = [];
  busy.clear();
  queues = { interactive: [], catchup: [], background: [] };
}
