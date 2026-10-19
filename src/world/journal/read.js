// @ts-check
// Read marks (docs 13, 15): which notes are new (written since you last opened Notes, or that page),
// which you may have missed (never shown on the island: a burst of notes, or written while you were
// away from the tab) and which you have seen, so no discovery is lost when a lot happens at once.
// Each note gets a number when it is written; the journal keeps the last number you saw in Notes,
// the last per page, and which notes were shown on the island. Small, and saved with the journal.
// Pure.

/**
 * @typedef {{ notes: number, pages: Record<string, number> }} ReadMarks
 *   notes: the last note number seen in Notes; pages: per page, the last note number seen there
 */

/** @param {any} journal @returns {ReadMarks} */
export const readOf = (journal) => journal.read ?? { notes: journal.noteSeq ?? 0, pages: {} };

/**
 * Number the notes just written (oldest first), on the notes themselves (the journal holds the same
 * notes), and keep the count.
 * @param {any} journal @param {any[]} notes @returns {any} the journal
 */
export function stampNotes(journal, notes) {
  if (!notes.length) return journal;
  let seq = journal.noteSeq ?? 0;
  // A journal from before read marks counts all its notes as seen.
  const read = readOf(journal);
  for (const n of notes) n.n = ++seq;
  return { ...journal, noteSeq: seq, read };
}

/** A note was shown on the island. @param {any} journal @param {number} n @returns {any} */
export function markShown(journal, n) {
  const i = journal.notes.findIndex((/** @type {any} */ x) => x.n === n);
  if (i < 0 || journal.notes[i].shown) return journal;
  const notes = journal.notes.slice();
  notes[i] = { ...notes[i], shown: true };
  return { ...journal, notes };
}

/** Notes opened: every note so far is seen. @param {any} journal @returns {any} */
export function markNotesSeen(journal) {
  const read = readOf(journal), seq = journal.noteSeq ?? 0;
  return read.notes === seq ? journal : { ...journal, read: { ...read, notes: seq } };
}

/** A page opened: its notes so far are seen. @param {any} journal @param {string} id @returns {any} */
export function markPageSeen(journal, id) {
  const read = readOf(journal), seq = journal.noteSeq ?? 0;
  return read.pages[id] === seq ? journal : { ...journal, read: { ...read, pages: { ...read.pages, [id]: seq } } };
}

/**
 * How a note reads against what was seen before: 'missed' (unseen, and never shown on the island),
 * 'new' (unseen) or 'seen'. Notes from before read marks are seen.
 * @param {any} note @param {number} since the last note number seen
 * @returns {'missed' | 'new' | 'seen'}
 */
export function noteState(note, since) {
  if (!note.n || note.n <= since) return 'seen';
  return note.shown ? 'new' : 'missed';
}

/**
 * What is unread now: notes since Notes was last opened, and the pages with notes since each was
 * last opened. @param {any} journal @returns {{ notes: number, pages: Set<string> }}
 */
export function unread(journal) {
  const read = readOf(journal);
  let notes = 0;
  /** @type {Set<string>} */ const pages = new Set();
  for (const n of journal.notes) {
    if (!n.n) continue;
    if (n.n > read.notes) notes++;
    if (n.sp && n.n > pageSince(read, n.sp)) pages.add(n.sp);
  }
  return { notes, pages };
}

/** The last note number seen for a page: there, or in Notes. @param {ReadMarks} read @param {string} id */
export const pageSince = (read, id) => Math.max(read.pages[id] ?? 0, read.notes);
