// @ts-check
// Opening an island from its saved copies, coming through damage calmly (doc 18; S7d). The newest
// copy whose island (meta and world) reads cleanly is the island; any other part of it that is
// damaged (the journal, the springs, one 32 m chunk) comes from the newest older copy holding a
// good one, so a damaged chunk of your hill comes back from a minute earlier while the rest stays
// current. With no copy of a part left, a chunk regrows from the seed and the journal starts fresh.
// Damaged copies are kept aside in the database's quarantine, never deleted.

import { listSaves, quarantine, quarantined, deleteSlot } from './idb.js';
import { decode } from './world-file.js';
import { migrate, setAsideFormat } from './migrate.js';
import { restore } from './sections.js';

/** How many saved copies to look back through. */
const LOOK_BACK = 8;
/** Parts an island cannot be without: they must come whole from one copy. */
const CORE = ['meta', 'world'];

/**
 * @typedef {Object} Copy  one saved copy, read
 * @property {number} gen
 * @property {any} header
 * @property {Record<string, any>} sections  at this build's format
 * @property {string[]} bad   sections that did not read (checksum, size or shape)
 * @property {boolean} ok     its island (meta, world) reads
 * @property {string} [error]
 * @property {any} [record]   the stored record, to keep aside if damaged
 */

/**
 * Read one stored copy without throwing.
 * @param {import('./idb.js').SaveRecord} rec @returns {Promise<Copy>}
 */
export async function readCopy(rec) {
  try {
    /** @type {any} */ let header; /** @type {Record<string, any>} */ let sections; /** @type {string[]} */ let bad = [];
    if (rec.codec === 'raw') {
      header = rec.raw?.header;
      sections = Object.fromEntries(rec.raw?.sections ?? []);
    } else {
      const d = await decode(/** @type {Uint8Array} */ (rec.bytes));
      header = d.header; sections = d.sections; bad = d.bad;
    }
    if (!header) throw new Error('no header');
    sections = migrate(sections, header.format);
    // A part that read but has the wrong shape (a chunk of the wrong size) counts as damaged too.
    bad = [...new Set([...bad, ...restore(sections).bad])];
    const ok = CORE.every((id) => sections[id] && !bad.includes(id));
    return { gen: rec.gen, header, sections, bad, ok, record: rec, error: ok ? undefined : 'its island did not read' };
  } catch (err) {
    return { gen: rec.gen, header: null, sections: {}, bad: [], ok: false, record: rec, error: String(/** @type {any} */ (err)?.message ?? err) };
  }
}

/**
 * Put an island together from its copies, newest first. Pure.
 * @param {Copy[]} copies newest first
 * @returns {null | { base: Copy, parts: ReturnType<typeof restore>, from: 'current'|'earlier'|'parts', mended: string[], lost: string[], damaged: Copy[] }}
 *   from: 'earlier' when the newest copy's island was damaged, 'parts' when only some parts came
 *   from earlier copies; mended: parts taken from an older copy; lost: parts no copy had (a chunk
 *   regrows, the journal starts fresh); damaged: copies to keep aside
 */
export function assemble(copies) {
  const i = copies.findIndex((c) => c.ok);
  if (i < 0) return null;
  const base = copies[i];
  const sections = { ...base.sections };
  /** @type {string[]} */ const mended = [], lost = [];
  for (const id of base.bad) {
    const older = copies.slice(i + 1).find((c) => c.sections[id] !== undefined && !c.bad.includes(id));
    if (older) { sections[id] = older.sections[id]; mended.push(id); }
    else { delete sections[id]; lost.push(id); }
  }
  const damaged = copies.slice(0, i).concat(base.bad.length ? [base] : []);
  return { base, parts: restore(sections), from: i > 0 ? 'earlier' : mended.length || lost.length ? 'parts' : 'current', mended, lost, damaged };
}

/**
 * An island saved before FRESH_FROM (D1a: planting moved on foot) is set aside: every copy goes to
 * the quarantine, kept and never deleted, and the slot is cleared so a new island opens. Returns
 * whether it was. Copies that do not read are left to loadIsland.
 * @param {IDBDatabase} db @param {string} slot @returns {Promise<boolean>}
 */
export async function setAsideOlder(db, slot) {
  const saves = await listSaves(db, slot);
  if (!saves.length) return false;
  const newest = await readCopy(saves[0]);
  if (!newest.header || !setAsideFormat(newest.header.format)) return false;
  for (const rec of saves) await quarantine(db, rec, `set aside: saved before planting on foot (format ${newest.header.format})`).catch(() => {});
  await deleteSlot(db, slot);
  console.info(`save: ${slot} was saved before planting on foot (format ${newest.header.format}); kept aside, and a new island begins`);
  return true;
}

/**
 * Open an island from the database: read its copies, put it together, keep damaged ones aside.
 * @param {IDBDatabase} db @param {string} slot
 */
export async function loadIsland(db, slot) {
  const saves = (await listSaves(db, slot)).slice(0, LOOK_BACK);
  const copies = await Promise.all(saves.map(readCopy));
  const got = assemble(copies);
  const damaged = got ? got.damaged : copies;
  // Each damaged copy is kept aside once (it stays among the saves until newer ones replace it).
  const kept = damaged.length ? await quarantined(db, slot) : [];
  for (const c of damaged) {
    if (!c.record || kept.some((q) => q.gen === c.gen && q.savedAt === c.record.savedAt)) continue;
    quarantine(db, c.record, c.error ?? `damaged parts: ${c.bad.join(', ')}`).catch(() => {});
  }
  if (got && got.from !== 'current') console.info(`save: ${slot} came back ${got.from === 'earlier' ? 'from an earlier copy' : 'with parts from earlier copies'}`, { mended: got.mended, lost: got.lost });
  return got;
}
