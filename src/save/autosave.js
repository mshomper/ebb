// @ts-check
// Autosave (doc 18): loads this island's newest good copy at boot, and keeps saving quietly with no
// save button: a few seconds after an edit, every game hour, when a frog settles, and at once when
// the tab hides or closes. One tab tends an island at a time (Web Locks); a second tab can take it.
// Routine saves are packed into .ebb bytes in a worker; a save as the tab hides is written as it
// is, at once, since the page may be gone before a worker answers.
//
// Only the game saves (main.js asks for it). Tool pages, and test links (?seed, ?day, ?frogs, ?driftwood),
// run unsaved test islands that never touch your own.

import { on, emit, emitDeferred } from '../core/events.js';
import { subscribe } from '../core/store.js';
import { run } from '../core/workers.js';
import { openDb, getSlot, writeGeneration, deleteSlot, putSlot } from './idb.js';
import { encode } from './world-file.js';
import { snapshot, restore } from './sections.js';
import { loadIsland, setAsideOlder } from './recover.js';

const ENCODE_JOB = { module: './save/world-file.js', fn: 'encodeJob' };
/** URL parameters that start a throwaway test island. */
export const TEST_PARAMS = ['seed', 'day', 'frogs', 'trust', 'plants', 'shells', 'cliffs', 'stones', 'driftwood', 'minnows', 'dragonflies', 'damselflies', 'turtles', 'spring', 'autumn', 'keepsakes', 'nets', 'sandbar', 'hour', 'trails', 'intro', 'nointro', 'camp', 'shovel', 'teas', 'treats', 'sketch', 'planting', 'eggs', 'dig', 'setpiece', 'threads', 'lantern', 'lanterns', 'fishing', 'shape', 'visit'];

/**
 * @typedef {'off'|'test'|'fresh'|'loaded'|'elsewhere'|'failed'|'damaged'} SaveStatus
 *   off: this page does not save (tool pages); test: a test link; fresh: no save yet;
 *   loaded: the island came back from its save; elsewhere: another tab has it; failed: no database;
 *   damaged: there is a save but no copy of it reads (the recovery card offers a file or a new island)
 */
/**
 * @typedef {Object} SaveSession
 * @property {SaveStatus} status
 * @property {string} slot
 * @property {ReturnType<typeof restore> | null} restored  what came back, for app.js to apply once
 * @property {number} restoredGen  which generation loaded (older than the newest if that was damaged)
 * @property {(live: { parts: () => import('./sections.js').IslandParts, recipe: any }) => void} start
 * @property {() => Promise<void>} startAgain  forget this island and reload fresh
 * @property {() => void} takeOver  (status 'elsewhere') ask the other tab to let go, then reload here
 * @property {(reason?: string) => void} saveSoon
 * @property {{ savedAt: number, wallHighWater: number } | null} lastSeen  the loaded save's wall times,
 *   for counting time away (src/sim/away.js)
 * @property {(on: boolean) => void} hold  no saves while catch-up runs: a save then would stamp the old
 *   island with the time now and lose the time away. A loaded island starts held until its
 *   catch-up is done.
 * @property {(ms: number) => void} setHighWater  the clock guard's mark after a catch-up (doc 18)
 * @property {{ from: 'current'|'earlier'|'parts', mended: string[], lost: string[] } | null} restoredFrom
 *   how the island came back (recover.js), for the calm note
 * @property {boolean} setAside  an island from before planting on foot was kept aside, and this
 *   one is new (recover.js setAsideOlder), for its calm line
 * @property {() => Promise<void>} saveNow  a full save now (before a backup or a test)
 * @property {() => void} stop  no more saves from this page (before replacing the island and reloading)
 * @property {() => any} slotRecord  the slot's record (created, lastBackupAt)
 * @property {(patch: Record<string, any>) => Promise<void>} noteSlot  keep something on the slot's record
 * @property {IDBDatabase | null} db
 * @property {() => any} snapshotNow  the island's header and sections now (a backup)
 */

/** @type {SaveSession | null} */ let session = null;

/**
 * The save slot for an island in this build. The live site and every branch preview share one web
 * address (and so one database), so each page folder keeps its own islands: `/ebb/` and
 * `/ebb/preview/<branch>/` never load or overwrite each other's. A page at the root (the local
 * server) keeps the plain island id.
 * @param {string} islandId @param {string} [path] the page's path, location.pathname by default
 */
export function slotFor(islandId, path = location.pathname) {
  const dir = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  return dir === '/' ? islandId : `${dir}${islandId}`;
}

/**
 * Open this island's save, once per page (a GPU rebuild reuses the same session).
 * @param {{ enabled: boolean, islandId: string, test: boolean }} opts
 * @returns {Promise<SaveSession>}
 */
export async function beginSave(opts) {
  if (session) return { ...session, restored: null };
  const slot = slotFor(opts.islandId);
  /** @type {SaveStatus} */ let status = !opts.enabled ? 'off' : opts.test ? 'test' : 'fresh';
  /** @type {IDBDatabase | null} */ let db = null;
  /** @type {any} */ let slotRec = null;
  /** @type {ReturnType<typeof restore> | null} */ let restored = null;
  let restoredGen = -1;
  let wallHighWater = 0;
  /** @type {{ savedAt: number, wallHighWater: number } | null} */ let lastSeen = null;
  /** @type {SaveSession['restoredFrom']} */ let restoredFrom = null;
  let setAside = false;
  /** @type {(() => void) | null} */ let releaseLock = null;

  if (status === 'fresh') {
    const held = await holdLock(slot);
    if (!held) status = 'elsewhere';
    else {
      releaseLock = held.release;
      try {
        db = await openDb();
        slotRec = (await getSlot(db, slot)) ?? null;
        // An island from before planting on foot (D1a) is kept aside, and a new one begins.
        if (slotRec && await setAsideOlder(db, slot)) { slotRec = null; setAside = true; }
        if (slotRec) {
          // The newest copy that reads, any damaged part from an older one (recover.js).
          const got = await loadIsland(db, slot);
          if (got) {
            restored = got.parts;
            restoredGen = got.base.gen;
            wallHighWater = got.base.header.wallHighWater ?? 0;
            lastSeen = { savedAt: got.base.header.savedAt ?? 0, wallHighWater };
            restoredFrom = { from: got.from, mended: got.mended, lost: got.lost };
            status = 'loaded';
          } else status = 'damaged';
        }
      } catch (err) {
        console.warn('save: no save database on this device; this visit will not be kept', err);
        status = 'failed';
      }
    }
  }

  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`ebb-island-${slot}`) : null;
  let stopped = status !== 'fresh' && status !== 'loaded';
  // A loaded island waits for its catch-up before saving again (see `hold`).
  let held = status === 'loaded';
  /** @type {null | { parts: () => import('./sections.js').IslandParts, recipe: any }} */ let live = null;
  let seq = 0, writtenSeq = 0, inFlight = false, dirty = false, lastSave = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;

  // Sections from a newer build ride along unchanged.
  const extra = restored?.extra ?? [];
  /** The parts to save, with the clock guard's high-water mark kept current. */
  function partsNow() {
    const p = /** @type {NonNullable<typeof live>} */ (live).parts();
    const now = Date.now();
    wallHighWater = Math.max(wallHighWater, now);
    return { ...p, savedAt: now, wallHighWater, extra };
  }

  /** Write one snapshot as the next generation, unless a newer one is already written. */
  function write(/** @type {number} */ s, /** @type {any} */ save, /** @type {any} */ p) {
    if (!db || s <= writtenSeq) return Promise.resolve(false);
    writtenSeq = s;
    const gen = (slotRec?.gen ?? -1) + 1;
    slotRec = { ...(slotRec ?? {}), id: slot, island: p.island, seed: p.seed, gen, created: slotRec?.created ?? p.savedAt, lastPlayed: p.savedAt };
    return writeGeneration(db, slotRec, { slot, gen, savedAt: p.savedAt, ...save }, live?.recipe.generationsKept ?? 3).then(() => true);
  }

  async function routineSave() {
    if (stopped || !live || !db) return;
    if (held) { dirty = true; return; }
    if (inFlight) { dirty = true; return; }
    inFlight = true;
    dirty = false;
    const t0 = performance.now();
    try {
      const p = partsNow();
      const s = ++seq;
      const { header, sections } = snapshot(p);
      let bytes;
      try { bytes = (await run(ENCODE_JOB, { header, sections }, { lane: 'background' })).bytes; }
      catch (err) { console.warn('save: packing in a worker failed; packing here', err); bytes = await encode(header, sections); }
      if (stopped) return;
      if (await write(s, { codec: 'ebb', bytes }, p)) emitDeferred('save:written', { generation: slotRec.gen, bytes: bytes.length, ms: performance.now() - t0 });
      lastSave = Date.now();
    } catch (err) {
      console.warn('save failed', err);
      emitDeferred('save:failed', { reason: String(err) });
    } finally {
      inFlight = false;
      if (dirty && !stopped) schedule(0);
    }
  }

  /** Save now, as the tab hides or closes: the snapshot goes into the database as it is. */
  function quickSave() {
    if (stopped || held || !live || !db) return;
    clearTimeout(timer);
    try {
      const p = partsNow();
      write(++seq, { codec: 'raw', raw: snapshot(p) }, p).catch((err) => console.warn('save on leaving failed', err));
      lastSave = Date.now();
      try { localStorage.setItem(`ebb.seen.${slot}`, String(p.savedAt)); } catch { /* storage blocked */ }
    } catch (err) {
      console.warn('save on leaving failed', err);
    }
  }

  /** @param {number} waitMs */
  function schedule(waitMs) {
    clearTimeout(timer);
    const r = live?.recipe;
    const gap = r ? r.minIntervalS * 1000 - (Date.now() - lastSave) : 0;
    timer = setTimeout(routineSave, Math.max(waitMs, gap, 0));
  }

  /** @param {string} [reason] 'edit' waits for the edit to settle; 'hour' and 'event' go next */
  function saveSoon(reason = 'edit') {
    if (stopped || !live) return;
    schedule(reason === 'edit' ? live.recipe.debounceS * 1000 : 0);
  }

  // A second tab asks for the island: save, let go, and say where it went.
  channel?.addEventListener('message', (e) => {
    if (e.data?.type !== 'take' || stopped || !releaseLock) return;
    quickSave();
    stopped = true;
    const release = releaseLock;
    releaseLock = null;
    setTimeout(release, 300);   // let the last write land first
    emit('save:moved-away', {});   // at once: this tab is in the background, with few frames
  });

  session = {
    status, slot, restored, restoredGen,
    start(l) {
      // A GPU rebuild starts the app again with new live objects: save from those from now on.
      const first = !live;
      live = l;
      if (stopped || !first) return;
      // After the first edit, ask the browser to keep the island rather than clear it for space.
      let asked = false;
      const soon = () => {
        saveSoon('edit');
        if (!asked) { asked = true; navigator.storage?.persist?.().catch(() => {}); }
      };
      on('terrain:stroke-ended', soon);
      on('growth:planted', soon);
      on('water:spring-added', soon);
      subscribe('water', () => saveSoon('edit'));
      subscribe('pieces', () => saveSoon('edit'));
      subscribe('keepsakes', () => saveSoon('edit'));
      subscribe('journal', () => saveSoon('edit'));
      on('clock:hour', () => saveSoon('hour'));
      on('creature:settled', () => saveSoon('event'));
      on('creature:joined', () => saveSoon('event'));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') quickSave(); });
      addEventListener('pagehide', quickSave);
      // A new island is kept from the start, so leaving at once still comes back to it.
      if (status === 'fresh') schedule(0);
    },
    async startAgain() {
      stopped = true;
      clearTimeout(timer);
      if (db) await deleteSlot(db, slot);
      try { localStorage.removeItem(`ebb.seen.${slot}`); } catch { /* storage blocked */ }
      location.reload();
    },
    takeOver() {
      channel?.postMessage({ type: 'take' });
      // Once the other tab lets go, start here from its last save.
      navigator.locks?.request(`ebb-island-${slot}`, async () => { location.reload(); });
    },
    saveSoon,
    lastSeen,
    hold(on) {
      held = on;
      if (!on && dirty && !stopped) schedule(0);
    },
    setHighWater(ms) { wallHighWater = ms; },
    restoredFrom,
    setAside,
    async saveNow() {
      clearTimeout(timer);
      while (inFlight) await new Promise((ok) => setTimeout(ok, 30));
      await routineSave();
    },
    stop() { stopped = true; clearTimeout(timer); },
    slotRecord: () => slotRec,
    async noteSlot(patch) {
      if (!db || !slotRec) return;
      slotRec = { ...slotRec, ...patch };
      await putSlot(db, slotRec);
    },
    db,
    snapshotNow: () => snapshot(partsNow()),
  };
  return session;
}

/**
 * Hold this island's Web Lock for the page's life, if no other tab has it.
 * @param {string} slot
 * @returns {Promise<{ release: () => void } | null>}
 */
function holdLock(slot) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve({ release: () => {} });
  return new Promise((resolve) => {
    locks.request(`ebb-island-${slot}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return undefined; }
      return new Promise((let_go) => resolve({ release: () => let_go(undefined) }));
    }).catch(() => resolve({ release: () => {} }));
  });
}

