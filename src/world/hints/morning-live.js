// @ts-check
// Morning hints in the live game (Matt, October 28, 2026; rules in morning.js): at the first quiet
// daylight moment of each game day, the keeper's one line for the morning goes to the island-notes
// corner as `morning:hint { id, text, sp, at, opens, showS }` (at: where a visitor showed itself), and its flag (`hint:<id>@<day>`) goes into
// journal.flags, so it is kept with the island and never shown again. Quiet means: the first evening
// is over and none of its lines (or the camp's) shows, no keeper card or return reveal is up, the
// tab is in view, and it has been so for quietS seconds. After a rest that is the wake at the flap.
// A day with nothing to say is passed over; what happens later that day waits for the next morning.
//
// It also keeps what the player did as journal flags the tests read (recipe `record`), and two
// from the store: the journal's Web opened (`did:web`) and a gift taken up from the gift spot
// (`did:gift-spot`). A system on the live sim (src/app.js).

import { on, emit } from '../../core/events.js';
import { get, subscribe } from '../../core/store.js';
import { dispatch } from '../../input/actions.js';
import { sunMoon } from '../sky/sun-moon.js';
import { pickHint, shownFlag, shownToday, showMeOf, visitAt } from './morning.js';

const DAY = 86400, HOUR = 3600;

/**
 * @param {{ R: any, clock: { display: () => number }, orbit: any, journalWords: any, enabled?: boolean }} o
 *   journalWords: recipes/world/journal.json (each page's kind); enabled false: a test link, no hints
 */
export function createMorningHints(o) {
  const { R } = o;
  const flags = () => /** @type {string[]} */ (get('journal')?.flags ?? []);
  /** @param {string} f */
  const setFlag = (f) => { if (get('journal') && !flags().includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };
  const kindOf = (/** @type {string} */ sp) => o.journalWords?.species?.[sp]?.kind;

  let introLine = false, revealing = false;
  /** @type {string | null} */ let keeperCard = null;
  let quiet = 0, since = 0;
  /** A day already looked at with nothing to say (not saved: a reload looks again). */
  let passedDay = -1;

  const offs = [
    on('intro:hint', (/** @type {{ text: string | null }} */ p) => { introLine = !!p?.text; }),
    on('reveal:started', () => { revealing = true; }),
    on('reveal:ended', () => { revealing = false; }),
    on('keeper:card', (/** @type {{ id: string }} */ p) => { keeperCard = p?.id ?? null; }),
    ...Object.entries(R.record ?? {}).map(([name, flag]) => on(name, () => setFlag(/** @type {string} */ (flag)))),
    subscribe('journalUi', (/** @type {any} */ u) => { if (u?.open && u.view === 'web') setFlag('did:web'); }),
    subscribe('hand', (/** @type {any} */ h) => { if (h?.kind === 'gift') setFlag('did:gift-spot'); }),
  ];

  /** Is the island quiet enough for the morning's line? */
  function isQuiet() {
    if (o.enabled === false || !get('journal') || revealing || introLine) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (!get('intro')?.done) return false;
    if (keeperCard && !flags().includes(`keeper:${keeperCard}:read`)) return false;
    if (keeperCard) keeperCard = null;
    return sunMoon(o.clock.display(), o.orbit).sunAlt >= 0;
  }

  /** The morning's hint, if today has none yet and there is one to give. */
  function offer() {
    const t = o.clock.display(), day = Math.floor(t / DAY);
    if (day === passedDay || shownToday(R, flags(), day)) return;
    // Seasonal visitors' last visits (src/world/ecology/visits.js), for visit hints.
    const journal = get('journal'), s = { journal, cook: get('cook'), kindOf, visits: get('shaped')?.visits?.by ?? {}, day };
    const age = (t / HOUR - (journal?.born ?? 0)) / 24;
    const h = pickHint(R, s, age);
    if (!h) { passedDay = day; return; }
    setFlag(shownFlag(R, h.id, day));
    emit('morning:hint', { id: h.id, text: h.text, sp: showMeOf(h, s), at: visitAt(h, s), opens: h.opens ?? null, showS: R.showS ?? 40 });
  }

  return {
    id: 'morning-hints',
    /** Each frame. @param {{ realDt: number }} f */
    tick(f) {
      since += f.realDt;
      if (since < 0.5) return;
      const dt = since;
      since = 0;
      if (!isQuiet()) { quiet = 0; return; }
      quiet += dt;
      if (quiet >= (R.quietS ?? 4)) offer();
    },
    dispose() { for (const off of offs) off(); },
  };
}
