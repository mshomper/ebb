// @ts-check
// The words for plants that went under new ground (docs/future/13 5.2 Terraforming, PR-21, PR-29):
// the island's notice after a stroke that covered a good few gather plants, the session's notice
// once, and the kind journal line written an hour later if the plants are still gone. Never
// blaming, never a count in the journal. Words in recipes/world/journal.json `buried`; the
// numbers in growth.json `bury`. Pure.

import { whereWords } from './describe.js';

/** @param {string} s */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Where a patch is, in the plant page's words: the side of the island and the page's place,
 * "on the east side, in the wet margins". @param {any} rec the page @param {number} x @param {number} z
 * @param {any} hab @param {any} words journal.json
 */
function placeOf(rec, x, z, hab, words) {
  const side = rec?.compass && hab ? whereWords([{ x, z }], hab, words) : '';
  return [side, rec?.place ?? ''].filter(Boolean).join(', ');
}

/**
 * The journal's line for one patch (one species in one stroke) still gone an hour later:
 * "The meadowsweet on the west side, by the water, went under the new ground."
 * @param {string} sp @param {number} x @param {number} z @param {any} hab @param {any} words journal.json
 * @returns {string | null}
 */
export function buriedLine(sp, x, z, hab, words) {
  const rec = words.species?.[sp], W = words.buried;
  if (!rec || !W?.line) return null;
  const where = placeOf(rec, x, z, hab, words);
  return W.line.replace('{name}', lower(rec.name)).replace(' {where}', where ? ` ${where},` : '');
}

/**
 * The island's notice after a burying stroke, or null. The session notice comes once a session,
 * when the session's gather plants reach sessionNotice; otherwise a stroke that covered strokeNotice
 * gather plants or more names the kind with most plants, where it was, and how many other kinds.
 * @param {{ gatherCount: number, bySpecies: Record<string, { count: number, x: number, z: number, gather: boolean }> }} p
 *   the growth:buried payload
 * @param {{ count: number, shown: boolean }} session gather plants buried this session so far (before
 *   this stroke), and whether its notice has shown
 * @param {any} B growth.json bury @param {any} hab @param {any} words journal.json
 * @returns {{ text: string | null, session: { count: number, shown: boolean } }}
 */
export function buriedNotice(p, session, B, hab, words) {
  const W = words.buried ?? {};
  const next = { count: session.count + p.gatherCount, shown: session.shown };
  if (!next.shown && next.count >= B.sessionNotice && W.session) return { text: W.session, session: { ...next, shown: true } };
  if (p.gatherCount < B.strokeNotice || !W.stroke) return { text: null, session: next };
  const kinds = Object.entries(p.bySpecies).filter(([, s]) => s.gather).sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
  const [sp, top] = kinds[0];
  const rec = words.species?.[sp];
  const others = Object.keys(p.bySpecies).length - 1;
  const where = placeOf(rec, top.x, top.z, hab, words);
  const more = others <= 0 ? '' : others === 1 ? W.otherOne : W.others.replace('{n}', W.numbers?.[others - 1] ?? String(others));
  const many = top.count > 1 || others > 0;
  const text = W.stroke.replace('{name}', lower(rec?.name ?? sp)).replace(' {where}', where ? ` ${where}` : '')
    .replace('{others}', more).replace('{back}', many ? W.them : W.it);
  return { text, session: next };
}
