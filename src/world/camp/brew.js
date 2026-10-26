// @ts-check
// Brewing tea, pure (docs/future/13 section 7; P2e): the herbs laid at the tea pot in, the tea out.
// One herb (or two of the same) is its single cup; a pair that is a blend in cook.json boons is the
// blend, if it has the dried herbs it asks for (Deep rest wants one off the rack); any other pair is
// the stronger herb's single cup (teas.strength), with a taste line the first time. A herb laid
// dried off the rack comes as 'dried:<kind>'. Nothing here touches the world: a tea only names a boon
// (boons.js holds it).

/**
 * @typedef {{ herbs: Record<string, string>, strength: string[] }} Teas cook.json teas
 * @typedef {{ id: string, herbs: string[], pair: string | null, blend: boolean, taste: string | null }} Tea
 *   id: the boon's key in cook.json boons; herbs: the short names laid (one or two); pair: the pair's
 *   key when two different herbs were laid (for the camp page's tried pairs), else null; blend: id is
 *   a blend; taste: a pair that came to nothing more, the line it leaves (else null)
 */

/** A laid kind without its dried mark. @param {string} kind */
export const undried = (kind) => (kind.startsWith('dried:') ? kind.slice(6) : kind);

/**
 * A pack kind's tea herb short name ('watermint.leaves' -> 'watermint'), dried or not, or null when
 * it makes no tea. @param {string} kind @param {Teas} T
 */
export function herbOf(kind, T) {
  const k = undried(kind);
  for (const [name, id] of Object.entries(T.herbs)) if (id === k) return name;
  return null;
}

/**
 * A blend's key in the boons table for two herbs, in either order, or null; boons only given on
 * waking (after) are never brewed. @param {string} a @param {string} b @param {Record<string, any>} B
 */
export function blendKey(a, b, B) {
  for (const k of [`${a}+${b}`, `${b}+${a}`]) if (B[k] && !B[k].after) return k;
  return null;
}

/** Two herbs' pair key, the same in either order (the stronger first). @param {string} a @param {string} b @param {Teas} T */
export const pairKey = (a, b, T) => (strengthOf(a, T) <= strengthOf(b, T) ? `${a}+${b}` : `${b}+${a}`);

/** A herb's place in the strength order (0 strongest). @param {string} h @param {Teas} T */
const strengthOf = (h, T) => { const i = T.strength.indexOf(h); return i < 0 ? T.strength.length : i; };

/**
 * The tea the laid herbs make, or null when none of them is a tea herb.
 * @param {string[]} laid the laid kinds, one or two @param {{ boons: Record<string, any>, teas: Teas }} C cook.json
 * @returns {Tea | null}
 */
export function brew(laid, C) {
  const T = C.teas, B = C.boons;
  const herbs = laid.map((k) => herbOf(k, T));
  if (!herbs.length || herbs.some((h) => !h)) return null;
  const hs = /** @type {string[]} */ (herbs);
  if (hs.length === 1 || hs[0] === hs[1]) return { id: hs[0], herbs: [hs[0]], pair: null, blend: false, taste: null };
  const [a, b] = hs, pair = pairKey(a, b, T), key = blendKey(a, b, B);
  const dried = laid.filter((k) => k.startsWith('dried:')).length;
  if (key && dried >= (B[key].dried ?? 0)) return { id: key, herbs: key.split('+'), pair, blend: true, taste: null };
  // Any other pair, or a blend without its dried herb: the stronger herb's single cup.
  const strong = pair.split('+')[0];
  return { id: strong, herbs: [strong], pair, blend: false, taste: key ? 'dry' : 'plain' };
}

/**
 * A pair's taste line, in the walker's words ("Mint and gorse. Pleasant. Nothing more."): a blend
 * missing its dried herb says so (words.tasteDry); any other pair takes one of words.taste, chosen
 * by the pair so it is always the same. @param {Tea} tea @param {any} W cook.json words
 */
export function tasteLine(tea, W) {
  if (!tea.pair || !tea.taste) return null;
  if (tea.taste === 'dry' && W.tasteDry?.[tea.pair]) return W.tasteDry[tea.pair];
  const [a, b] = tea.pair.split('+');
  const lines = W.taste ?? [];
  if (!lines.length) return null;
  let h = 0;
  for (const ch of tea.pair) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const A = W.tasteNames?.[a] ?? a, bb = W.tasteNames?.[b] ?? b;
  return lines[h % lines.length].replace('{A}', A.charAt(0).toUpperCase() + A.slice(1)).replace('{b}', bb);
}

/**
 * @typedef {{ found: Record<string, number>, tried: Record<string, number>, tastes: Record<string, string> }} TeaNotes
 *   found: each tea first drunk, by boon id, and the hour; tried: each pair of two herbs first
 *   brewed, and the hour; tastes: a pair's taste line, as it was said
 */

/** The cook section's tea notes made safe. @param {any} v @returns {TeaNotes} */
export function cleanTeaNotes(v) {
  const t = v && typeof v === 'object' ? v : {};
  /** @param {any} m @param {(x: any) => boolean} ok */
  const map = (m, ok) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([, x]) => ok(x)));
  return { found: map(t.found, Number.isFinite), tried: map(t.tried, Number.isFinite), tastes: map(t.tastes, (x) => typeof x === 'string') };
}

/**
 * A cup written into the notes: its boon found (once), its pair tried (once), with its taste line.
 * @param {TeaNotes} n @param {Tea} tea @param {number} hour @param {string | null} taste
 * @returns {TeaNotes}
 */
export function noteTea(n, tea, hour, taste) {
  const out = { found: { ...n.found }, tried: { ...n.tried }, tastes: { ...n.tastes } };
  if (out.found[tea.id] === undefined) out.found[tea.id] = hour;
  if (tea.pair && out.tried[tea.pair] === undefined) out.tried[tea.pair] = hour;
  if (tea.pair && taste && !out.tastes[tea.pair]) out.tastes[tea.pair] = taste;
  return out;
}

/** The line said when a cup is drunk ("Water mint tea. Light on your feet."). @param {Tea} tea @param {any} W */
export function drankLine(tea, W) {
  const tea0 = tea.herbs.map((h, i) => (i ? W.tasteNames?.[h] : W.teaNames?.[h]) ?? h).join(' and ');
  return String(W.drank ?? '{tea} tea. {name}.').replace('{tea}', tea0).replace('{name}', W.boonNames?.[tea.id] ?? tea.id);
}
