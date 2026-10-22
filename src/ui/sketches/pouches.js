// @ts-check
// The pouches on the ground bar (docs/future/13 section 4.1, K-03): a cloth pouch drawn in four
// looks by how full it is (flat, a few, half, full and tied), with a small sketch of what it holds at
// its mouth. Line drawings in currentColor with the icons' stroke and one 20 percent accent, on a
// 32 px grid. A kind names its sketch in recipes/world/pack.json; an unknown one draws plain.

const ACC = 'fill="currentColor" fill-opacity="0.2" stroke="none"';

/** What lies at a pouch's mouth, by the kind's sketch name. Drawn on the 32 grid near the top. */
const CONTENT = {
  sticks: '<path d="M11 9L15 3M15 9.5L19 2.5M18.5 9L21 4"/>',
  drift: '<path d="M10.5 9.5L14 4.5M14.5 9L18.5 3.5M18 9.5L21.5 6" opacity=".75"/>',
  pebbles: '<circle cx="13" cy="7.5" r="2"/><circle cx="17.5" cy="6.5" r="2.3"/><circle cx="21" cy="8" r="1.5"/>',
  flat: '<ellipse cx="14" cy="8" rx="3.4" ry="1.2"/><ellipse cx="19.5" cy="6.4" rx="3" ry="1.1"/>',
  down: '<path d="M12 8C12.5 5 14.5 4 16 5M16 8.5C16.4 5.4 18.6 4 20.5 5.4M14 8C14 6 15.5 3.5 17.5 3" opacity=".8"/>',
  charcoal: '<path ' + ACC.replace('0.2', '0.7') + ' d="M12 9L13.5 5.5L17 6L16 9Z"/><path d="M12 9L13.5 5.5L17 6L16 9Z"/><circle cx="19.5" cy="7.5" r="1.4" fill="currentColor"/>',
  mound: '<path d="M11 9C12.5 5.5 19.5 5.5 21 9"/>',
  plain: '<circle cx="16" cy="7" r="1.6"/>',
};

/**
 * A pouch drawing, as an <svg> string.
 * @param {number} stage 0 flat, 1 a few, 2 half, 3 full and tied
 * @param {string} [sketch] the kind's sketch name (recipes/world/pack.json kinds[].sketch)
 */
export function pouchSvg(stage, sketch = 'plain') {
  const g = '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
  if (stage <= 0) {
    return `<svg class="ebb-pouch__svg" viewBox="0 0 32 32" aria-hidden="true">${g}<path ${ACC} d="M4 26C9 22.5 23 22.5 28 26C25 29 7 29 4 26Z"/><path d="M4 26C9 22.5 23 22.5 28 26C25 29 7 29 4 26Z"/><path d="M9 25.6C13 24.6 19 24.6 23 25.6"/></g></svg>`;
  }
  const s = Math.min(3, stage);
  const top = [0, 20.5, 14.5, 10][s], w = [0, 11.5, 10, 8.5][s];
  const L = 16 - w, R = 16 + w;
  const path = `M${L} ${top + 1}C${L - 3} ${top + 6} ${L - 4} 22 ${L - 1} 26.5C${L + 2} 29.5 ${R - 2} 29.5 ${R + 1} 26.5C${R + 4} 22 ${R + 3} ${top + 6} ${R} ${top + 1}`;
  let body = `<path ${ACC} d="${path}Z"/><path d="${path}"/>`;
  if (s === 3) {
    // Full and tied: the neck gathered, the cloth frilled above the tie, a loose end.
    body += `<path d="M${L} ${top + 1}C13 ${top - 1} 19 ${top - 1} ${R} ${top + 1}"/>`
      + `<path d="M12.5 ${top - 0.5}L11 ${top - 4.5}M19.5 ${top - 0.5}L21 ${top - 4.5}M14.5 ${top - 1}V${top - 5}M17.5 ${top - 1}V${top - 5}"/>`
      + `<path d="M19 ${top + 1}L22 ${top + 3.5}"/>`;
  } else {
    body += `<ellipse cx="16" cy="${top + 1}" rx="${w}" ry="2"/>`;
  }
  const dy = s === 3 ? top - 11.5 : top - 7.5;
  const c = `<g transform="translate(-1.5 ${dy}) scale(0.9)" stroke-width="1.5">${CONTENT[/** @type {keyof typeof CONTENT} */ (sketch)] ?? CONTENT.plain}</g>`;
  return `<svg class="ebb-pouch__svg" viewBox="0 0 32 32" aria-hidden="true">${g}${body}${c}</g></svg>`;
}

/** The small mark of a kind, for a Gather icon's corner (16 px). @param {string} [sketch] */
export function kindMarkSvg(sketch = 'plain') {
  return `<svg viewBox="8 0 16 12" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CONTENT[/** @type {keyof typeof CONTENT} */ (sketch)] ?? CONTENT.plain}</g></svg>`;
}
