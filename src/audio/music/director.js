// @ts-check
// The music director (doc 24, "The shape of a day", "Anti-repetition"): the quiet musician who
// decides when to play and what. Slots follow the sun of each game day (morning after sunrise,
// interludes through the day, evening as the light goes gold, silence while the frogs call,
// perhaps a nocturne late at night); every slot rolls its chance once a day; every piece is
// followed by a rest of a few real minutes; recently played pieces wait their turn; the weather
// picks its own pool. It never plays, it only decides: update() returns what to start, and the
// caller realizes and plays it, then reports back. The same code drives the game and the lab's
// day simulator, so the simulator shows exactly what the game would do.
//
// The four tides (the island themes, doc 24 "Motifs") are pieces with a `theme` field. Each season
// has a home tide (recipes/music/director.json tides.home): the first morning of a season always
// plays it, and homeTide() hands it to the return reveal and the gift bloom. All four tides also
// sit in the ordinary pools, in each season's setting, weighted by tides.weight.
//
// Pure apart from its own seeded stream (src/core/rng.js, the 'music' system), and it never reads
// world state: the caller passes the sun height as a function of game time and the rest as data.

import { stream, hash32 } from '../../core/rng.js';
import { DAYS_PER_SEASON } from '../../core/clock.js';

const H = 3600;
const DAY = 24 * H;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/**
 * @typedef {Object} DirectorState  what the caller tells the director each update
 * @property {number} realS        real seconds since the session began (rests and history use this)
 * @property {number} gameT        game time in seconds (display time)
 * @property {'clear'|'cloud'|'rain'|'mist'} weather
 * @property {boolean} frogsAwake  any frog not dormant
 * @property {boolean} frogsCalling a frog is calling now
 * @property {string[]} residents  settled species ids
 * @property {'often'|'now-and-then'|'rarely'|'off'} frequency
 * @property {boolean} [previewing] the time or season preview is open: no new piece starts
 */

/**
 * @typedef {Object} Decision
 * @property {any} piece
 * @property {number} seed
 * @property {string} slot
 * @property {boolean} shortForm
 * @property {string|undefined} key
 * @property {number} windowEndRealS  real time by which the slot closes (the piece should end by then)
 */

/**
 * The sun's timeline for one game day: sunrise, sunset, dawn and dusk (sun at -6 degrees), and when
 * the falling sun crosses each listed height. Hours from the day's midnight; NaN if not reached.
 * @param {(t: number) => number} sunAltDeg @param {number} dayStart @param {number[]} falling
 * @returns {{dawn: number, sunrise: number, sunset: number, dusk: number, nextDawn: number, falling: Record<number, number>}}
 */
export function sunDay(sunAltDeg, dayStart, falling) {
  const step = 120;
  const out = { dawn: NaN, sunrise: NaN, sunset: NaN, dusk: NaN, nextDawn: NaN };
  /** @type {Record<number, number>} */
  const fall = {};
  let prev = sunAltDeg(dayStart);
  for (let s = step; s <= DAY + 12 * H; s += step) {
    const a = sunAltDeg(dayStart + s);
    // The hour the sun crossed a height inside this step, interpolated.
    const at = (/** @type {number} */ x) => (s - step + (step * (x - prev)) / (a - prev)) / H;
    if (s <= DAY) {
      if (prev < -6 && a >= -6) out.dawn = at(-6);
      if (prev < 0 && a >= 0) out.sunrise = at(0);
      if (prev >= 0 && a < 0) out.sunset = at(0);
      if (prev >= -6 && a < -6) out.dusk = at(-6);
      for (const d of falling) if (prev >= d && a < d && !(d in fall)) fall[d] = at(d);
    } else if (prev < -6 && a >= -6 && Number.isNaN(out.nextDawn)) out.nextDawn = at(-6) - 24;
    prev = a;
  }
  return { ...out, falling: fall };
}

/**
 * @param {{director: any, seasons: Record<string, any>}} recipes recipes/music/director.json and seasons
 * @param {any[]} pieces recipes/music/pieces/*.json
 * @param {{seed: number, sunAltDeg: (t: number) => number, history?: {id: string, day: number, realS: number, key?: string}[]}} opts
 */
export function createDirector(recipes, pieces, opts) {
  const D = recipes.director;
  const r = stream(opts.seed >>> 0, 0x6d75, 0xd1);
  /** @type {{id: string, day: number, realS: number, key?: string}[]} */
  const history = opts.history ? [...opts.history] : [];
  /** @type {Map<number, any>} */
  const days = new Map();
  let playing = false;
  let restUntilRealS = 0;
  /** @type {Map<string, boolean>} rolled slot instances, keyed day:slot:n */
  const rolls = new Map();
  /** @type {Map<string, number>} chances used per slot instance (a piece started, or a roll of no) */
  const counts = new Map();
  /** @type {Map<string, number>} real time before which a slot's next chance may not roll */
  const retryAt = new Map();
  /** @type {Map<string, any>} slots that rolled yes during a rest, waiting for it to end */
  const pending = new Map();
  let lastKey = /** @type {string|undefined} */ (undefined);
  /** @type {{realS: number, slot: string, decision: string}[]} */
  const log = [];

  /** @param {number} day */
  function dayInfo(day) {
    let d = days.get(day);
    if (!d) {
      const sun = sunDay(opts.sunAltDeg, day * DAY, [D.slots.interlude.toSunDeg, ...D.slots.evening.sunDeg]);
      d = { day, ...sun };
      days.set(day, d);
      if (days.size > 8) days.delete(Math.min(...days.keys()));
    }
    return d;
  }

  /**
   * Which slot is open at a game time, and the hour (from that day's midnight) it closes.
   * Nocturnes after midnight belong to the previous day's night.
   * @param {number} gameT @param {DirectorState} st
   * @returns {{slot: string, day: number, closeH: number, reason?: string} | null}
   */
  function slotAt(gameT, st) {
    const day = Math.floor(gameT / DAY);
    const h = (gameT - day * DAY) / H;
    const d = dayInfo(day);
    const S = D.slots;
    const evTop = d.falling[S.evening.sunDeg[0]], evLow = d.falling[S.evening.sunDeg[1]];
    const frogFrom = d.dusk + S.frogWindow.fromDuskH, frogTo = d.dusk + S.frogWindow.toDuskH;
    if (h < d.sunrise - S.preDawnHushH || Number.isNaN(d.sunrise)) {
      // Before the pre-dawn hush: still last night's nocturne window?
      const prev = dayInfo(day - 1);
      const from = prev.dusk + S.nocturne.fromDuskH - 24, to = d.dawn + S.nocturne.toDawnH;
      if (h >= from && h < to) return { slot: 'nocturne', day: day - 1, closeH: to };
      return null;
    }
    if (h < d.sunrise) return { slot: 'hush', day, closeH: d.sunrise, reason: 'pre-dawn hush' };
    if (h < d.sunrise + S.morning.withinH) return { slot: 'morning', day, closeH: d.sunrise + S.morning.withinH };
    if (h >= d.sunrise + S.interlude.fromSunriseH && h < (d.falling[S.interlude.toSunDeg] ?? 24)) return { slot: 'interlude', day, closeH: d.falling[S.interlude.toSunDeg] };
    if (h >= evTop && h < Math.min(evLow, frogFrom)) return { slot: 'evening', day, closeH: Math.min(evLow, frogFrom) };
    if (h >= frogFrom && h < frogTo) return st.frogsAwake ? { slot: 'frogs', day, closeH: frogTo, reason: 'frogs own dusk' } : { slot: 'early-nocturne', day, closeH: frogTo };
    if (h >= d.dusk + S.nocturne.fromDuskH) return { slot: 'nocturne', day, closeH: 24 + d.nextDawn + S.nocturne.toDawnH };
    return null;
  }

  /** @param {string} slot */
  function slotRules(slot) {
    if (slot === 'early-nocturne') return { ...D.slots.nocturne, chance: D.slots.frogWindow.elseNocturneChance, max: 1 };
    return D.slots[slot];
  }

  /**
   * Choose a piece for a slot: right slot, season, weather and residents; not played too
   * recently (unless every piece has been, then the least recently played); weighted by freshness.
   * @param {string} slot @param {number} gameT @param {DirectorState} st
   */
  /** The season at a game time. @param {number} gameT */
  const seasonAt = (gameT) => SEASONS[Math.floor(gameT / (DAYS_PER_SEASON * DAY)) % 4];
  /** Whether a game day is the first of its season. @param {number} day */
  const firstDayOfSeason = (day) => day % DAYS_PER_SEASON === 0;

  /**
   * The season's home tide, in that season's setting.
   * @param {number} gameT
   */
  function homeTide(gameT) {
    const season = seasonAt(gameT);
    const n = D.tides?.home?.[season];
    return pieces.find((p) => p.theme && p.theme.candidate === n && p.theme.season === season) ?? null;
  }

  function choose(slot, gameT, st) {
    const season = seasonAt(gameT);
    // The first morning of a season plays its home tide (doc 24, Special moments).
    if (slot === 'morning' && firstDayOfSeason(Math.floor(gameT / DAY)) && D.tides?.firstMorning) {
      const home = homeTide(gameT);
      if (home) return { piece: home, key: undefined, exhausted: false };
    }
    const slotName = slot === 'early-nocturne' ? 'nocturne' : slot;
    const wet = st.weather === 'rain' || st.weather === 'mist';
    const fits = (/** @type {any} */ p) => p.seasons.includes(season)
      && (p.slots.includes(slotName) || (wet && p.slots.includes(st.weather)))
      && (!p.requires?.settled || p.requires.settled.every((/** @type {string} */ s) => st.residents.includes(s)));
    let pool = pieces.filter(fits);
    // On rain and mist days, a piece written for that weather wins over the ordinary pool.
    if (wet) { const w = pool.filter((p) => p.slots.includes(st.weather) || p.weather?.includes(st.weather)); if (w.length) pool = w; }
    else pool = pool.filter((p) => !p.weather || p.weather.includes(st.weather) || p.weather.includes('clear'));
    if (!pool.length) return null;
    const day = Math.floor(gameT / DAY);
    const H_ = D.history;
    const lastOf = (/** @type {string} */ id) => history.filter((x) => x.id === id).pop();
    const ok = pool.filter((p) => { const l = lastOf(p.id); return !l || (day - l.day >= H_.minGapDays && st.realS - l.realS >= H_.minGapRealMin * 60); });
    let exhausted = false;
    if (!ok.length) { exhausted = true; ok.push(pool.slice().sort((a, b) => (lastOf(a.id)?.realS ?? -1) - (lastOf(b.id)?.realS ?? -1))[0]); }
    const weights = ok.map((p) => { const l = lastOf(p.id); const fresh = l ? Math.min(1, (st.realS - l.realS) / (H_.freshnessRealMin * 60)) : 1; return (p.weight ?? (p.theme ? D.tides?.weight ?? 1 : 1)) * (0.2 + 0.8 * fresh); });
    let x = r.next() * weights.reduce((a, b) => a + b, 0);
    let piece = ok[ok.length - 1];
    for (let i = 0; i < ok.length; i++) { x -= weights[i]; if (x <= 0) { piece = ok[i]; break; } }
    // Key drift: avoid the same key twice running, where the piece allows another.
    let key;
    if (D.keyDrift && lastKey && piece.keys.length > 1 && piece.keys[0] === lastKey) key = piece.keys.find((/** @type {string} */ k) => k !== lastKey);
    return { piece, key, exhausted };
  }

  return {
    /**
     * Call a few times a second. Returns a piece to start now, or null.
     * @param {DirectorState} st
     * @returns {Decision | null}
     */
    update(st) {
      if (st.previewing || st.frequency === 'off') return null;
      const open = slotAt(st.gameT, st);
      const busy = playing || st.realS < restUntilRealS;
      // A slot that opens while the musician is playing or resting rolls its chance anyway; a yes
      // waits, and starts when the rest ends if that is within the slot's grace (doc 24's windows
      // are a real minute or two long at 1x, shorter than a rest).
      if (busy) {
        if (open && open.slot !== 'hush' && open.slot !== 'frogs' && !pending.has(`${open.day}:${open.slot}`)) {
          const first = open.slot === 'morning' && firstDayOfSeason(open.day) && !!D.tides?.firstMorning && !!homeTide(st.gameT);
          const rules = slotRules(open.slot);
          const key = `${open.day}:${open.slot}`;
          const tries = counts.get(key) ?? 0;
          if (tries < (rules.max ?? 1) && !rolls.has(`${key}:${tries}`) && (rules.graceH ?? 0) > 0) {
            const yes = first || r.next() < Math.min(1, rules.chance * (D.frequency[st.frequency]?.chanceScale ?? 1));
            rolls.set(`${key}:${tries}`, yes);
            log.push({ realS: st.realS, slot: open.slot, decision: yes ? 'rolled yes while resting: waits' : 'rolled no' });
            const grace = first ? Math.max(rules.graceH, D.tides.firstMorningGraceH ?? 0) : rules.graceH;
            if (yes) pending.set(key, { ...open, untilGameT: open.day * DAY + (open.closeH + grace) * H });
            else counts.set(key, tries + 1);
          }
        }
        return null;
      }
      let s = open;
      // A piece that waited through a rest starts now, if its grace has not run out.
      for (const [k, p] of pending) {
        pending.delete(k);
        if (st.gameT < p.untilGameT && !(st.frogsCalling && p.slot !== 'nocturne')) { s = { ...p, closeH: (p.untilGameT - p.day * DAY) / H }; break; }
        log.push({ realS: st.realS, slot: p.slot, decision: 'waited too long: skipped' });
      }
      if (!s || s.slot === 'hush' || s.slot === 'frogs') return null;
      if (st.frogsCalling && s.slot !== 'nocturne') return null;
      const first = s.slot === 'morning' && firstDayOfSeason(s.day) && !!D.tides?.firstMorning && !!homeTide(st.gameT);
      const rules = first ? { ...slotRules(s.slot), chance: 1 } : slotRules(s.slot);
      const key = `${s.day}:${s.slot}`;
      // Each slot gets up to `max` chances a day (doc 24: interludes "up to 2, each 0.6"). A chance
      // that rolls no is spent, and the next one waits a rest's length before it is rolled.
      const tries = counts.get(key) ?? 0;
      if (tries >= (rules.max ?? 1)) return null;
      if (st.realS < (retryAt.get(key) ?? 0)) return null;
      const rollKey = `${key}:${tries}`;
      if (!rolls.has(rollKey)) {
        const scale = first ? 1 : D.frequency[st.frequency]?.chanceScale ?? 1;
        const yes = r.next() < Math.min(1, rules.chance * scale);
        rolls.set(rollKey, yes);
        log.push({ realS: st.realS, slot: s.slot, decision: yes ? 'rolled yes' : 'rolled no' });
        if (rolls.size > 200) rolls.delete(rolls.keys().next().value ?? '');
        if (!yes) {
          counts.set(key, tries + 1);
          const [a, b] = D.restRealMin;
          retryAt.set(key, st.realS + (a + r.next() * (b - a)) * 60);
          return null;
        }
      }
      if (!rolls.get(rollKey)) return null;
      const c = choose(s.slot, st.gameT, st);
      if (!c) { log.push({ realS: st.realS, slot: s.slot, decision: 'no piece fits' }); rolls.set(rollKey, false); return null; }
      counts.set(key, tries + 1);
      // The slot's close, in real seconds at the current flow, for the short-form choice.
      const gameLeftS = (s.closeH - (st.gameT - s.day * DAY) / H) * H;
      return {
        piece: c.piece,
        seed: hash32(opts.seed >>> 0, Math.floor(st.realS), history.length),
        slot: s.slot,
        shortForm: false,
        key: c.key,
        windowEndRealS: st.realS + gameLeftS / 60,
        ...(c.exhausted ? { note: 'pool spent: least recently played' } : {}),
      };
    },
    /** The caller started a piece. @param {Decision} d @param {DirectorState} st @param {string} keyPlayed */
    started(d, st, keyPlayed) {
      playing = true;
      lastKey = keyPlayed;
      history.push({ id: d.piece.id, day: Math.floor(st.gameT / DAY), realS: st.realS, key: keyPlayed });
      while (history.length > D.history.keep) history.shift();
      log.push({ realS: st.realS, slot: d.slot, decision: `started ${d.piece.id}` });
    },
    /** The piece has finished: rest a few real minutes. @param {DirectorState} st */
    ended(st) {
      playing = false;
      const [a, b] = D.restRealMin;
      const scale = D.frequency[st.frequency]?.restScale ?? 1;
      const rest = (a + r.next() * (b - a)) * 60 * scale;
      restUntilRealS = st.realS + rest;
      log.push({ realS: st.realS, slot: '', decision: `rest ${(rest / 60).toFixed(1)} min` });
      return rest;
    },
    /** For the lab: the slot open at a game time. @param {number} gameT @param {DirectorState} st */
    slotAt,
    dayInfo,
    homeTide,
    history: () => history.slice(),
    log: () => log.slice(),
    get restUntilRealS() { return restUntilRealS; },
  };
}
