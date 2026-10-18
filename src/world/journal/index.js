// @ts-check
// Live side of the field journal (docs 13, 15): keeps the store slice `journal` current by looking at
// the world after every game hour (the `world:ticked` event with that hour's tick events), after
// edits and plantings, and when the Plant tool refuses a spot. It also posts the journal's new notes
// as `note:posted`, names the living thing under a tap (store slice `identify`), and opens and
// closes the journal on the `ui.journal` action (store slice `journalUi`). The model is pure
// (observe.js); this file only wires it to the bus, the store and the actions.

import { on, emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { hourIndex } from '../../core/clock.js';
import { onAction } from '../../input/actions.js';
import { initialJournal, observe, learn, describe, identify } from './observe.js';

/**
 * @typedef {Object} JournalUiSlice
 * @property {boolean} open
 * @property {'living'|'notes'} view
 * @property {string|null} page   the species page shown in the living view, or null for the list
 * @property {'half'|'full'} size  the phone sheet's height
 */

/**
 * @param {{ world: { state: any, env: any }, words: any }} opts
 *   world: the live world (state and env of the hourly tick); words: recipes/world/journal.json
 */
export function createJournal(opts) {
  const { world, words } = opts;
  /** @type {import('./observe.js').Journal} */
  let journal = get('journal') ?? initialJournal(hourIndex());
  update('journal', () => journal);
  update('journalUi', (u) => u ?? { open: false, view: 'living', page: null, size: 'half' });

  const habitat = () => world.env.habitat?.() ?? null;
  /** @param {{ journal: import('./observe.js').Journal, notes: import('./observe.js').Note[] }} r */
  function commit(r) {
    if (r.journal !== journal) {
      journal = r.journal;
      update('journal', () => journal);
    }
    for (const n of r.notes) emitDeferred('note:posted', n);
  }
  /** @param {any[]} events @param {number} hour @param {any} [state] */
  const look = (events, hour, state = world.state) => commit(observe(journal, { state, events, hour, habitat: habitat(), words }));

  const offs = [
    on('world:ticked', (/** @type {{ hour: number, events: any[], state: any }} */ p) => look(p.events ?? [], p.hour, p.state)),
    // Edits move water and plants between hours: look again (the habitat is rebuilt first).
    on('water:summary-updated', () => look([], hourIndex())),
    on('growth:planted', () => look([], hourIndex())),
    on('plant:refused', (/** @type {{ species: string, reason: string }} */ p) =>
      commit(learn(journal, p.species, `refused:${p.reason}`, { state: world.state, hour: hourIndex(), words }))),
    on('look:tapped', (/** @type {{ x: number, y: number, point: number[] | null }} */ p) => {
      const id = p.point ? identify(world.state, habitat(), p.point[0], p.point[2], words) : null;
      update('identify', () => (id ? { ...id, x: p.x, y: p.y, at: performance.now() } : null));
    }),
    onAction((a) => {
      // Choosing a tool or closing the card puts the tap card away.
      if (a.type === 'tool.select' || a.type === 'ui.identify') { if (get('identify')) update('identify', () => null); return; }
      if (a.type !== 'ui.journal') return;
      /** @type {JournalUiSlice} */ const u = get('journalUi');
      const open = a.toggle ? !u.open : a.open ?? u.open;
      /** @type {Partial<JournalUiSlice>} */ const patch = { open };
      if (a.view) patch.view = a.view;
      if (a.page !== undefined) { patch.page = a.page; if (a.page) patch.view = 'living'; }
      if (a.size) patch.size = a.size;
      if (open && !u.open && get('identify')) update('identify', () => null);
      update('journalUi', (s) => ({ ...s, ...patch }));
      if (open !== u.open) emitDeferred(open ? 'ui:panel-opened' : 'ui:panel-closed', { panel: 'journal' });
    }),
  ];
  look([], hourIndex());

  return {
    words,
    /** The journal now. */
    journal: () => journal,
    /** A species page in words. @param {string} sp */
    describe: (sp) => describe(journal, sp, world.state, habitat(), words),
    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createJournal>} LiveJournal */
