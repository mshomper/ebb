// @ts-check
// Drawn icons the music lab needs that the game's set (src/ui/icons/icons.js) does not have.
// Same style as that set: 24 px grid, 2 px padding, stroke 1.75, round caps and joins,
// stroke="currentColor", an accent fill of currentColor at 20 percent. Inline SVG strings; size
// and color come from CSS (.icon width/height, color on the parent).

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const ACCENT = 'fill="currentColor" fill-opacity="0.2" stroke="none"';

// A five-pointed star with softened points: a favourite.
const STAR = 'M12 3.1L14.53 9.42L21.32 9.87L16.09 14.23L17.76 20.83L12 17.2L6.24 20.83L7.91 14.23L2.68 9.87L9.47 9.42Z';

/** The favourite star, as markup for innerHTML. @returns {string} */
export function starIcon() {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g ${STROKE}><path class="star-fill" ${ACCENT} d="${STAR}"/><path d="${STAR}"/></g></svg>`;
}
