// @ts-check
// Drawn icons for the music render page, in the game set's style (src/ui/icons/README.md): 24 px
// grid, 2 px padding, stroke 1.75, round caps and joins, currentColor, an accent fill at 20 percent.

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const ACCENT = 'fill="currentColor" fill-opacity="0.2" stroke="none"';
const wrap = (/** @type {string} */ body) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g ${STROKE}>${body}</g></svg>`;

const PLAY = 'M8 5.5Q8 4.2 9.2 4.9L18.6 11Q19.6 11.7 18.6 12.4L9.2 18.6Q8 19.3 8 18Z';

/** Listen: a soft play triangle. */
export const playIcon = () => wrap(`<path ${ACCENT} d="${PLAY}"/><path d="${PLAY}"/>`);
/** Stop: a rounded square. */
export const stopIcon = () => wrap(`<rect ${ACCENT} x="6" y="6" width="12" height="12" rx="2.5"/><rect x="6" y="6" width="12" height="12" rx="2.5"/>`);
/** Download: an arrow down into a tray. */
export const downloadIcon = () => wrap(`<path ${ACCENT} d="M4 15.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3.5Z"/><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 15.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3.5"/>`);
