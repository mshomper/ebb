// @ts-check
// Holes (docs/future/13 10.8): a hole is a piece in the pieces list, never a change to the land's
// height, and it fills back in by itself. Its stage is worked out from when it was dug and the rain
// since: a third of the way each hoursPerThird game hours, each hour of rain counting rainWeight
// times, through open, slumped, settled and closed; a closed hole's darker patch then fades over
// darkDays, and its record goes. A hole closes at once when capped, when water comes over it (a tide,
// a flood), or when a stroke of Sculpt, Paint or Water crosses it. Nothing ticks per hole. Pure.
//
// A record: { id, kind: 'hole', x, z, yaw, seed, size, placedHour, depth, layer, cls, dugHour,
// closedHour (-1 while open), wetH (rain hours since it was dug, banked as days pass), seep, side }.

/** The stages. */
export const STAGES = /** @type {const} */ (['open', 'slumped', 'settled', 'closed']);

/**
 * The rain hours of a day record that fall in [h0, h1) (game hours). @param {any} rec a weather DayRecord
 * @param {number} h0 @param {number} h1
 */
export function rainHoursIn(rec, h0, h1) {
  if (!rec || !(rec.rainHours > 0)) return 0;
  const a = rec.day * 24 + rec.rainStartH, b = a + rec.rainHours;
  return Math.max(0, Math.min(b, h1) - Math.max(a, h0));
}

/**
 * Rain hours since a hole was dug, from the day records the weather keeps (today and yesterday):
 * never less than what the hole has banked. @param {any} hole @param {number} nowH @param {any[]} records
 */
export function wetSince(hole, nowH, records) {
  let w = 0;
  for (const r of records) w += rainHoursIn(r, hole.dugHour, nowH);
  return Math.max(hole.wetH ?? 0, w);
}

/**
 * A hole now: its stage (0 open .. 3 closed), how far it has filled (0..3, thirds), and its darker
 * patch (1 fresh .. 0 faded, gone). @param {any} hole @param {number} nowH @param {number} wetH rain hours since dug
 * @param {any} R recipes/world/dig.json
 * @returns {{ stage: number, fill: number, dark: number, closedAt: number, gone: boolean }}
 */
export function holeNow(hole, nowH, wetH, R) {
  const F = R.fill;
  const dry = Math.max(0, nowH - hole.dugHour - wetH);
  const fill = Math.min(3, (dry + Math.max(0, wetH) * F.rainWeight) / F.hoursPerThird);
  // When it closed by filling: back out the hour the fill reached three thirds (rain counted as it fell).
  const filledAt = fill >= 3 ? hole.dugHour + 3 * F.hoursPerThird - Math.max(0, wetH) * (F.rainWeight - 1) : Infinity;
  const closedAt = Math.min(hole.closedHour >= 0 ? hole.closedHour : Infinity, filledAt);
  if (closedAt <= nowH) {
    const fade = 1 - (nowH - closedAt) / (F.darkDays * 24);
    return { stage: 3, fill: 3, dark: Math.max(0, fade), closedAt, gone: fade <= 0 };
  }
  return { stage: Math.min(2, Math.floor(fill)), fill, dark: 1, closedAt, gone: false };
}

/**
 * Close a hole now (capped, water, a stroke): its closedHour set if it is still open. Pure.
 * @param {any} hole @param {number} nowH
 */
export const closeHole = (hole, nowH) => (hole.closedHour >= 0 ? hole : { ...hole, closedHour: nowH });

/**
 * The holes after one more is opened: at most openCap open (the oldest open settle closed at once)
 * and listCap records (the oldest closed go first, then the oldest of all). Each element of `list`
 * is a hole record; `stageOf` says whether each is open now. Returns the holes to keep, and the ids
 * capped closed and dropped. @param {any[]} list holes, oldest first @param {(h: any) => boolean} isOpen
 * @param {number} nowH @param {any} R
 */
export function capHoles(list, isOpen, nowH, R) {
  const F = R.fill;
  let holes = list.slice();
  /** @type {string[]} */ const capped = [];
  const open = holes.filter(isOpen);
  for (let i = 0; i < open.length - F.openCap; i++) {
    capped.push(open[i].id);
    holes = holes.map((h) => (h.id === open[i].id ? closeHole(h, nowH) : h));
  }
  /** @type {string[]} */ const dropped = [];
  while (holes.length > F.listCap) {
    const shut = holes.find((h) => !isOpen(h) || capped.includes(h.id)) ?? holes[0];
    dropped.push(shut.id);
    holes = holes.filter((h) => h !== shut);
  }
  return { holes, capped, dropped };
}

/**
 * The open hole a press at the dig point goes into (within spacingM, nearest), or null.
 * @param {any[]} holes @param {number} x @param {number} z @param {(h: any) => boolean} isOpen @param {any} R
 */
export function holeAt(holes, x, z, isOpen, R) {
  let best = null, bd = R.hole.spacingM * R.hole.spacingM;
  for (const h of holes) {
    if (!isOpen(h)) continue;
    const d = (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

/**
 * A hole record as saved, made safe, or null (left out) when a field is bad. cleanPieces keeps the
 * common fields; this keeps a hole's own. @param {any} r
 */
export function cleanHoleFields(r) {
  const fin = (/** @type {any} */ n) => typeof n === 'number' && Number.isFinite(n);
  if (!Number.isInteger(r.depth) || r.depth < 1 || typeof r.layer !== 'string' || typeof r.cls !== 'string' || !fin(r.dugHour)) return null;
  return { depth: r.depth, layer: r.layer, cls: r.cls, dugHour: r.dugHour, closedHour: fin(r.closedHour) ? r.closedHour : -1,
    wetH: fin(r.wetH) ? Math.max(0, r.wetH) : 0, seep: !!r.seep, side: r.side === -1 ? -1 : 1 };
}
