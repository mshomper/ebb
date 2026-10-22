// @ts-check
// Backups and earlier saves (doc 18; S7d), for the Saves menu: back an island up to a small .ebb
// file (a download), open an island file (checked before
// anything changes; the island it replaces stays as an earlier save), step back to an earlier
// save, and, on previews and local builds, damage a save or set its clock back to test recovery.
// A file or an earlier save is stamped with the time now when it goes in, so the time it spent
// waiting does not count as time away.

import { encode, decode, SaveError } from './world-file.js';
import { migrate, FORMAT } from './migrate.js';
import { restore } from './sections.js';
import { getSlot, getSave, listSaves, writeGeneration, quarantined } from './idb.js';
import { slotFor } from './autosave.js';
import { hashWorldState } from '../sim/tick.js';

/** Files larger than this are not islands (a fully grown world is under 1.5 MB). */
const MAX_FILE_BYTES = 20 << 20;
const DAY_MS = 24 * 3600 * 1000;

/** An island's fingerprint: its world state's hash as eight hex digits. @param {any} world */
export const fingerprint = (world) => hashWorldState(world).toString(16).toUpperCase().padStart(8, '0');

/** @param {Uint8Array} bytes @param {string} name */
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Give a file to the person: always a download. @param {Uint8Array} bytes @param {string} name @returns {Promise<string>} */
async function hand(bytes, name) {
  download(bytes, name);
  return 'downloaded';
}

/**
 * Back this island up to a file.
 * @param {import('./autosave.js').SaveSession} save
 * @returns {Promise<{ how: string, name: string, kb: number, print: string }>}
 */
export async function backUp(save) {
  const { header, sections } = save.snapshotNow();
  const world = sections.find(([id]) => id === 'world')?.[1];
  const h = { ...header, worldHash: hashWorldState(world) };
  const bytes = await encode(h, sections);
  const d = new Date();
  const name = `ebb-${h.island}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.ebb`;
  const how = await hand(bytes, name);
  await save.noteSlot({ lastBackupAt: Date.now() });
  return { how, name, kb: Math.max(1, Math.round(bytes.length / 1024)), print: fingerprint(world) };
}

/**
 * Check an island file before anything changes: it must be an ebb file, whole where it matters,
 * from this format or older, and for an island this build has.
 * @param {File} file @param {{ id: string, name: string }[]} islands
 * @returns {Promise<{ header: any, sections: Record<string, any>, island: { id: string, name: string }, print: string, damaged: string[] }>}
 */
export async function checkIslandFile(file, islands) {
  if (file.size > MAX_FILE_BYTES) throw new SaveError('This file is too large to be an island.');
  let d;
  try { d = await decode(new Uint8Array(await file.arrayBuffer())); }
  catch { throw new SaveError('This is not an ebb island file, or it is damaged.'); }
  if (d.bad.includes('meta') || d.bad.includes('world')) throw new SaveError('This island file is damaged: its island does not read.');
  let sections;
  try { sections = migrate(d.sections, d.header.format); }
  catch { throw new SaveError('This island was saved by a newer version of ebb. Open it there, or update this one.'); }
  const parts = restore(sections);
  if (!parts.meta || !parts.world) throw new SaveError('This island file is damaged: its island does not read.');
  const island = islands.find((i) => i.id === d.header.island);
  if (!island) throw new SaveError('This file is for an island this version of ebb does not have.');
  return { header: d.header, sections, island, print: fingerprint(parts.world), damaged: d.bad };
}

/**
 * Put a checked file in as the island now (its island's newest save), stamped with the time now,
 * then reload there. The island it replaces stays among the earlier saves.
 * @param {import('./autosave.js').SaveSession} save @param {Awaited<ReturnType<typeof checkIslandFile>>} checked
 */
export async function openIslandFile(save, checked) {
  const db = save.db;
  if (!db) throw new SaveError('This browser is not keeping islands, so the file cannot be opened here.');
  const slot = slotFor(checked.island.id);
  const now = Date.now();
  // The sections are already brought up to this build's format, so the header says so (or the
  // next load would upgrade them a second time).
  const header = { ...checked.header, format: FORMAT, worldT: checked.sections.meta?.worldT ?? checked.header.worldT, savedAt: now, wallHighWater: now };
  const bytes = await encode(header, Object.entries(checked.sections));
  if (slot === save.slot) save.stop();
  const rec = slot === save.slot ? save.slotRecord() : await getSlot(db, slot);
  const gen = (rec?.gen ?? -1) + 1;
  await writeGeneration(db, { ...(rec ?? {}), id: slot, island: checked.island.id, seed: header.seed, gen, created: rec?.created ?? now, lastPlayed: now },
    { slot, gen, savedAt: now, codec: 'ebb', bytes }, 4);
  if (slot === save.slot) { location.reload(); return; }
  const p = new URLSearchParams(location.search);
  p.set('island', checked.island.id);
  location.search = p.toString();
}

/**
 * The earlier saves of this island (all but the newest), newest first.
 * @param {import('./autosave.js').SaveSession} save @returns {Promise<{ gen: number, savedAt: number }[]>}
 */
export async function earlierSaves(save) {
  if (!save.db) return [];
  const newest = save.slotRecord()?.gen;
  return (await listSaves(save.db, save.slot)).filter((s) => s.gen !== newest).map((s) => ({ gen: s.gen, savedAt: s.savedAt }));
}

/**
 * Make an earlier save the island now (a new newest copy; nothing is deleted), stamped with the
 * time now, then reload.
 * @param {import('./autosave.js').SaveSession} save @param {number} gen
 */
export async function openEarlier(save, gen) {
  const db = save.db;
  const rec = db ? await getSave(db, save.slot, gen) : null;
  if (!db || !rec) throw new SaveError('That save is no longer here.');
  save.stop();
  const restamped = await restamp(rec, Date.now());
  const slotRec = save.slotRecord();
  const next = (slotRec?.gen ?? gen) + 1;
  await writeGeneration(db, { ...slotRec, gen: next, lastPlayed: Date.now() }, { ...restamped, gen: next }, 4);
  location.reload();
}

/**
 * A stored copy with its header's times set to `t` (a raw copy in place; an .ebb copy repacked).
 * @param {import('./idb.js').SaveRecord} rec @param {number} t @param {number} [highWater]
 */
async function restamp(rec, t, highWater = t) {
  if (rec.codec === 'raw') return { ...rec, savedAt: t, raw: { ...rec.raw, header: { ...rec.raw.header, savedAt: t, wallHighWater: highWater } } };
  const d = await decode(/** @type {Uint8Array} */ (rec.bytes));
  const { sections: table, ...header } = d.header;
  void table;
  return { ...rec, savedAt: t, bytes: await encode({ ...header, savedAt: t, wallHighWater: highWater }, Object.entries(d.sections)) };
}

/**
 * Save a damaged copy kept aside, as a file to look into (the recovery card).
 * @param {import('./autosave.js').SaveSession} save
 */
export async function saveDamagedCopy(save) {
  const q = save.db ? (await quarantined(save.db, save.slot))[0] : null;
  if (!q) return 'none';
  const bytes = q.codec === 'raw' ? await encode(q.raw.header, q.raw.sections) : q.bytes;
  return hand(bytes, `ebb-damaged-${q.slot.replace(/[^A-Za-z0-9-]/g, '-')}-${q.gen}.ebb`);
}

// ---- tests (previews and local builds only) ----

/**
 * Damage the newest save on purpose, then reload: 'island' spoils its world, 'chunk' one 32 m
 * chunk (an edited one if any), 'clock' moves its saved time a day ahead (as if the device clock
 * went back a day).
 * @param {import('./autosave.js').SaveSession} save @param {'island'|'chunk'|'clock'} what
 */
export async function damage(save, what) {
  const db = save.db;
  if (!db) return;
  await save.saveNow();   // a packed copy to spoil
  save.stop();
  const slotRec = save.slotRecord();
  let rec = await getSave(db, save.slot, slotRec.gen);
  if (!rec) return;
  if (what === 'clock') rec = await restamp(rec, rec.savedAt + DAY_MS);
  else if (rec.codec === 'raw') {
    const pick = pickSection(rec.raw.sections.map((/** @type {any} */ [id, v]) => ({ id, edited: !!v?.edited })), what);
    // A copy written as the tab hid has no checksums: the spoiled part goes missing instead (the
    // island is then unreadable; a chunk takes the wrong shape and counts as damaged).
    const spoiled = rec.raw.sections.map((/** @type {any} */ s) => (s[0] === pick ? [s[0], { spoiled: true }] : s));
    rec = { ...rec, raw: { ...rec.raw, sections: pick === 'world' ? spoiled.filter((/** @type {any} */ s) => s[0] !== 'world') : spoiled } };
  } else {
    const bytes = /** @type {Uint8Array} */ (rec.bytes).slice();
    const dv = new DataView(bytes.buffer);
    const headLen = dv.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headLen)));
    const d = await decode(bytes);
    const pick = pickSection(header.sections.map((/** @type {any} */ s) => ({ id: s.id, edited: !!d.sections[s.id]?.edited })), what);
    const s = header.sections.find((/** @type {any} */ x) => x.id === pick);
    if (s) for (let i = 0; i < Math.min(8, s.length); i++) bytes[12 + headLen + s.offset + Math.floor(s.length / 2) + i] ^= 0x5a;
    rec = { ...rec, bytes };
  }
  await writeGeneration(db, slotRec, rec, 4);
  location.reload();
}

/** @param {{ id: string, edited: boolean }[]} list @param {'island'|'chunk'} what */
function pickSection(list, what) {
  if (what === 'island') return 'world';
  const chunks = list.filter((s) => s.id.startsWith('chunk:'));
  return (chunks.find((s) => s.edited) ?? chunks[0])?.id ?? 'world';
}
