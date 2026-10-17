// @ts-check
// The drawn icon set (docs/15, "Icon set"): one hidden inline <svg> sprite of
// <symbol id="i-NAME" viewBox="0 0 24 24"> elements, used through <use href>.
// Style: 24 px grid, 2 px padding, stroke 1.75, round caps and joins,
// stroke="currentColor", optional accent fill at 20 percent. See README.md.

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const ACCENT = 'fill="currentColor" fill-opacity="0.2" stroke="none"';

/** Icon bodies, drawn by hand on the 24 px grid. @type {Record<string, string>} */
const ICONS = {
  // Trowel lifting a soft mound.
  sculpt: `
    <path ${ACCENT} d="M2.5 20.5C4.8 20.5 5.5 14.5 8.5 14.5C10.3 14.5 11 17.5 12.5 20.5Z"/>
    <path d="M2.5 20.5C4.8 20.5 5.5 14.5 8.5 14.5C9.4 14.5 10 15.3 10.5 16.3"/>
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M10.5 17.5C10.9 14.6 12.4 11.5 14.2 9.9L18.1 13.8C16.5 15.6 13.4 17.1 10.5 17.5Z"/>
    <path d="M10.5 17.5C10.9 14.6 12.4 11.5 14.2 9.9L18.1 13.8C16.5 15.6 13.4 17.1 10.5 17.5Z"/>
    <path d="M16.2 11.8L17.6 10.4"/>
    <path d="M17.05 9.25L19.55 6.75A1.2 1.2 0 0 1 21.25 8.45L18.75 10.95A1.2 1.2 0 0 1 17.05 9.25Z"/>`,

  // Flat float over a wavy line that straightens.
  smooth: `
    <rect ${ACCENT} x="4.5" y="10" width="15" height="3" rx="1.5"/>
    <rect x="4.5" y="10" width="15" height="3" rx="1.5"/>
    <path d="M9 10V7.6C9 6.7 9.7 6 10.6 6H13.4C14.3 6 15 6.7 15 7.6V10"/>
    <path d="M2.5 17.5C3.3 16 4.2 16 5 17.5S6.7 19 7.5 17.5C8.4 16.6 9.2 16.6 10 17.2C10.8 17.6 11.5 17.6 12.5 17.6H21.5"/>`,

  // Round brush with a leaf-shaped dab.
  paint: `
    <path ${ACCENT} d="M3.5 20.5C3.5 16 6.5 13.5 11 14C11 18.5 8 20.8 3.5 20.5Z"/>
    <path d="M3.5 20.5C3.5 16 6.5 13.5 11 14C11 18.5 8 20.8 3.5 20.5Z"/>
    <path d="M3.5 20.5L8 16.5"/>
    <g transform="translate(13 12.5) rotate(40)">
      <path d="M0 0C-1.2 -1.2 -1.7 -3.2 -1.6 -5.5H1.6C1.7 -3.2 1.2 -1.2 0 0Z"/>
      <rect x="-1.3" y="-8" width="2.6" height="2.5" rx="0.5"/>
      <path d="M0 -8V-11.5"/>
    </g>`,

  // Curved arrow to the left.
  undo: `
    <path d="M8.5 5L4 9.5L8.5 14"/>
    <path d="M4 9.5H14.5C17.5 9.5 20 11.8 20 14.75S17.5 20 14.5 20H9"/>`,

  // Mirror of undo.
  redo: `
    <path d="M15.5 5L20 9.5L15.5 14"/>
    <path d="M20 9.5H9.5C6.5 9.5 4 11.8 4 14.75S6.5 20 9.5 20H15"/>`,

  // Mound with an up stroke.
  raise: `
    <path ${ACCENT} d="M2.5 20C6 20 7.5 13.5 12 13.5S18 20 21.5 20Z"/>
    <path d="M2.5 20C6 20 7.5 13.5 12 13.5S18 20 21.5 20"/>
    <path d="M12 10.5V3.5"/>
    <path d="M9 6.5L12 3.5L15 6.5"/>`,

  // Hollow with a down stroke.
  lower: `
    <path ${ACCENT} d="M2.5 13C6 13 7.5 19 12 19S18 13 21.5 13Z"/>
    <path d="M2.5 13C6 13 7.5 19 12 19S18 13 21.5 13"/>
    <path d="M12 3V10"/>
    <path d="M9 7L12 10L15 7"/>`,

  // A level shelf line over a mound whose top it has cut away.
  flatten: `
    <path ${ACCENT} d="M2.5 20C5 20 6.6 15.5 7.8 12H16.2C17.4 15.5 19 20 21.5 20Z"/>
    <path d="M2.5 20C5 20 6.6 15.5 7.8 12"/>
    <path d="M16.2 12C17.4 15.5 19 20 21.5 20"/>
    <path d="M3.5 12H20.5"/>
    <path d="M8.6 9.6C9.5 8.4 10.6 8 12 8S14.5 8.4 15.4 9.6" stroke-dasharray="0.01 2.9" opacity="0.7"/>`,

  // Time flow: half sun on a horizon, with a flow arc passing over it.
  time: `
    <path ${ACCENT} d="M7.5 16.5A4.5 4.5 0 0 1 16.5 16.5Z"/>
    <path d="M7.5 16.5A4.5 4.5 0 0 1 16.5 16.5"/>
    <path d="M2.5 16.5H21.5"/>
    <path d="M7 20H17"/>
    <path d="M4.6 11.4A8.4 8.4 0 0 1 19 10.8"/>
    <path d="M19.9 7.9L19 10.8L16.1 10.2"/>`,

  // Time-flow states, drawn beside the time icon: one, two or three lit pips (with the unlit
  // ones as faint rings) for 1x, 2x, 4x; two rest bars for pause.
  'flow-1': `
    <circle cx="5" cy="12" r="3" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="2.1" opacity="0.45"/>
    <circle cx="19" cy="12" r="2.1" opacity="0.45"/>`,
  'flow-2': `
    <circle cx="5" cy="12" r="3" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="12" r="2.1" opacity="0.45"/>`,
  'flow-4': `
    <circle cx="5" cy="12" r="3" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="12" r="3" fill="currentColor" stroke="none"/>`,
  'flow-pause': `
    <rect ${ACCENT} x="7" y="6.5" width="3.5" height="11" rx="1.75"/>
    <rect x="7" y="6.5" width="3.5" height="11" rx="1.75"/>
    <rect ${ACCENT} x="13.5" y="6.5" width="3.5" height="11" rx="1.75"/>
    <rect x="13.5" y="6.5" width="3.5" height="11" rx="1.75"/>`,
};

/** Names of every icon in the sprite. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

const SPRITE_ID = 'ebb-icon-sprite';

/**
 * Inject the hidden icon sprite into document.body once. Safe to call again.
 * @returns {SVGSVGElement} the sprite element
 */
export function ensureIconSprite() {
  const existing = document.getElementById(SPRITE_ID);
  if (existing) return /** @type {SVGSVGElement} */ (/** @type {unknown} */ (existing));
  const symbols = Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24"><g ${STROKE}>${body}</g></symbol>`)
    .join('');
  const holder = document.createElement('div');
  holder.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" id="${SPRITE_ID}" aria-hidden="true" focusable="false" ` +
    `style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`;
  const sprite = /** @type {SVGSVGElement} */ (holder.firstElementChild);
  document.body.prepend(sprite);
  return sprite;
}

/**
 * Markup for one icon, as a string to put in innerHTML:
 * `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-NAME"/></svg>`.
 * Size and color come from CSS (`.icon` width/height, `color`). The sprite must be
 * in the page (ensureIconSprite) for the icon to show.
 * @param {string} name  one of ICON_NAMES
 * @param {string} [extraClass]  added to the svg's class list
 * @returns {string}
 */
export function iconSvg(name, extraClass = '') {
  if (!(name in ICONS)) console.warn(`[icons] unknown icon "${name}"`);
  const cls = extraClass ? `icon ${extraClass}` : 'icon';
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}
