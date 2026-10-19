// @ts-check
// The IndexedDB database `ebb` (doc 18): islands (`slots`), their saved generations (`saves`) and
// the device settings (`prefs`). Thin promise wrappers; only src/save/ touches it.

const DB_NAME = 'ebb';
/** 1: slots, saves, prefs (S7a). 2: quarantine, damaged copies kept aside (S7d). */
const DB_VERSION = 2;

/**
 * @typedef {Object} SlotRecord
 * @property {string} id        the island id (each island in the badge's list keeps its own save)
 * @property {string} island
 * @property {number} seed
 * @property {number} gen       the newest generation
 * @property {number} created   UTC ms
 * @property {number} lastPlayed UTC ms
 * @property {number} [lastBackupAt] UTC ms of the last backup to a file (S7d's reminder)
 */
/**
 * @typedef {Object} SaveRecord
 * @property {string} slot
 * @property {number} gen
 * @property {number} savedAt   UTC ms
 * @property {'ebb'|'raw'} codec  'ebb': .ebb bytes (routine saves); 'raw': the sections as they
 *   are, written at once when the tab hides (no time to pack them)
 * @property {Uint8Array} [bytes]
 * @property {any} [raw]        {header, sections} for codec 'raw'
 */

/** @type {Promise<IDBDatabase> | null} */ let opening = null;

/** @param {IDBRequest} r @returns {Promise<any>} */
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
/** @param {IDBTransaction} tx @returns {Promise<void>} */
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('save transaction aborted'));
});

/** Open (once) the database. @returns {Promise<IDBDatabase>} */
export function openDb() {
  opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: ['slot', 'gen'] });
      if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs');
      if (!db.objectStoreNames.contains('quarantine')) db.createObjectStore('quarantine', { autoIncrement: true });
    };
    r.onsuccess = () => {
      // A newer build in another tab needs a newer database: let it have it.
      r.result.onversionchange = () => { r.result.close(); opening = null; };
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('the save database is blocked by another window'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}

/** @param {IDBDatabase} db @param {string} id @returns {Promise<SlotRecord | undefined>} */
export function getSlot(db, id) {
  return req(db.transaction('slots').objectStore('slots').get(id));
}

/** @param {IDBDatabase} db @param {string} slot @param {number} gen @returns {Promise<SaveRecord | undefined>} */
export function getSave(db, slot, gen) {
  return req(db.transaction('saves').objectStore('saves').get([slot, gen]));
}

/**
 * Write a new generation and point the slot at it in one transaction, then drop generations older
 * than the last `keep`. The transaction starts synchronously, so a save begun as the tab hides
 * gets its data in before the page goes.
 * @param {IDBDatabase} db @param {SlotRecord} slot @param {SaveRecord} save @param {number} keep
 * @returns {Promise<void>}
 */
export function writeGeneration(db, slot, save, keep) {
  const tx = db.transaction(['slots', 'saves'], 'readwrite');
  const saves = tx.objectStore('saves');
  saves.put(save);
  tx.objectStore('slots').put(slot);
  if (save.gen - keep >= 0) saves.delete(IDBKeyRange.bound([save.slot, -Infinity], [save.slot, save.gen - keep]));
  return done(tx);
}

/**
 * Every saved copy of an island, newest first (the Saves menu's earlier saves; recovery).
 * @param {IDBDatabase} db @param {string} slot @returns {Promise<SaveRecord[]>}
 */
export async function listSaves(db, slot) {
  const all = await req(db.transaction('saves').objectStore('saves').getAll(IDBKeyRange.bound([slot, -Infinity], [slot, Infinity])));
  return /** @type {SaveRecord[]} */ (all).sort((a, b) => b.gen - a.gen);
}

/** Point a slot at its newest copy (or keep its backup time). @param {IDBDatabase} db @param {SlotRecord} slot */
export function putSlot(db, slot) {
  const tx = db.transaction('slots', 'readwrite');
  tx.objectStore('slots').put(slot);
  return done(tx);
}

/**
 * Keep a damaged copy aside, with what was wrong. Never deleted; the recovery card can save it.
 * @param {IDBDatabase} db @param {SaveRecord} save @param {string} error
 */
export function quarantine(db, save, error) {
  const tx = db.transaction('quarantine', 'readwrite');
  tx.objectStore('quarantine').add({ ...save, error, keptAt: Date.now() });
  return done(tx);
}

/** The damaged copies kept for an island, newest first. @param {IDBDatabase} db @param {string} slot */
export async function quarantined(db, slot) {
  const all = await req(db.transaction('quarantine').objectStore('quarantine').getAll());
  return /** @type {any[]} */ (all).filter((q) => q.slot === slot).sort((a, b) => b.keptAt - a.keptAt);
}

/** Forget an island: its slot and every generation. @param {IDBDatabase} db @param {string} id */
export function deleteSlot(db, id) {
  const tx = db.transaction(['slots', 'saves'], 'readwrite');
  tx.objectStore('slots').delete(id);
  tx.objectStore('saves').delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
  return done(tx);
}

/** @param {IDBDatabase} db @param {string} key @returns {Promise<any>} */
export function getPref(db, key) {
  return req(db.transaction('prefs').objectStore('prefs').get(key));
}

/** @param {IDBDatabase} db @param {string} key @param {any} value */
export function putPref(db, key, value) {
  const tx = db.transaction('prefs', 'readwrite');
  tx.objectStore('prefs').put(value, key);
  return done(tx);
}
