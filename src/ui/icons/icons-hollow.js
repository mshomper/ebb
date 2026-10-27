// @ts-check
// The Hollow's move icons (H0, October 27, 2026; docs/future/16-the-sea-cave.md, On screen: each tablet
// shows its move's drawn icon). Drawn in the shared family's rules (icons.js, README.md): 24 px grid,
// 2 px padding, stroke 1.75, round caps and joins, currentColor, accent fills at 20 percent. Kept apart
// from the game's sprite until the Hollow ships (H3): only the move arena draws them, inline.

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const ACCENT = 'fill="currentColor" fill-opacity="0.2" stroke="none"';

/** The twelve rank 1 to 3 moves' icons, by move id (recipes/world/hollow-moves.json). @type {Record<string, string>} */
export const HOLLOW_ICONS = {
  // Anchor: the staff driven upright into the floor, a small ring round its foot.
  anchor: `
    <ellipse ${ACCENT} cx="12" cy="19" rx="6.5" ry="2"/>
    <ellipse cx="12" cy="19" rx="6.5" ry="2"/>
    <path d="M12 3V19"/>
    <path d="M9.5 6.5L12 4L14.5 6.5"/>`,

  // Hook and turn: a curved arrow round a thing, spinning it to face away.
  hookTurn: `
    <circle ${ACCENT} cx="12" cy="14" r="3"/>
    <circle cx="12" cy="14" r="3"/>
    <path d="M4.5 14A7.5 7.5 0 0 1 19.5 14"/>
    <path d="M17 11.8L19.5 14.4L21.6 11.4"/>`,

  // Groundline: the staff's foot on the floor and a crack racing out ahead.
  groundline: `
    <path d="M5 3.5V16"/>
    <path d="M2.5 20.5H6"/>
    <path d="M5 17.5L8.5 15.5L11 19L14.5 15.5L17 18.5L21.5 16"/>`,

  // Cast the flame: a ball of fire lobbed in an arc to a landing ring.
  castFlame: `
    <path d="M3 18C5 10 11 6.5 15 8" stroke-dasharray="1.5 2.5"/>
    <path ${ACCENT} d="M18 4C16.3 6.2 15.3 7.6 15.3 9.1A2.7 2.7 0 0 0 20.7 9.1C20.7 7.6 19.7 6.2 18 4Z"/>
    <path d="M18 4C16.3 6.2 15.3 7.6 15.3 9.1A2.7 2.7 0 0 0 20.7 9.1C20.7 7.6 19.7 6.2 18 4Z"/>
    <ellipse cx="18" cy="19" rx="3.5" ry="1.5"/>`,

  // Wick snare: a lit wick set on the floor inside a faint circle.
  wickSnare: `
    <ellipse cx="12" cy="18" rx="8.5" ry="2.8" stroke-dasharray="1.5 2.2"/>
    <path d="M12 18V13.5"/>
    <path ${ACCENT} d="M12 6C10.8 7.6 10.2 8.7 10.2 9.7A1.8 1.8 0 0 0 13.8 9.7C13.8 8.7 13.2 7.6 12 6Z"/>
    <path d="M12 6C10.8 7.6 10.2 8.7 10.2 9.7A1.8 1.8 0 0 0 13.8 9.7C13.8 8.7 13.2 7.6 12 6Z"/>`,

  // Kindling burst: the lantern thrust forward and one straight beam leaving it.
  kindlingBurst: `
    <path ${ACCENT} d="M9 10.5L21.5 7V17L9 13.5Z"/>
    <path d="M9 10.5L21.5 7M9 13.5L21.5 17"/>
    <rect x="3" y="9" width="5" height="6" rx="1.2"/>
    <path d="M4 9V7.5A1.5 1.5 0 0 1 7 7.5V9"/>`,

  // Back step: an arrow back from where you stood, and two scuff marks.
  backStep: `
    <path d="M18 11H5"/>
    <path d="M8.5 7.5L5 11L8.5 14.5"/>
    <path d="M14.5 18.5H17.5M18.5 15.5H21.5"/>`,

  // Feint: a half swing cut short, its faint arc where it would have landed.
  feint: `
    <path d="M4 16A8 8 0 0 1 20 16" stroke-dasharray="1.5 2.5"/>
    <path d="M9 20L13.5 9.5"/>
    <path d="M12 13.5L15.5 12.5"/>`,

  // Snuff: a hand cupped over the lantern's glass, the light pulled in to an ember.
  snuff: `
    <rect ${ACCENT} x="8" y="10" width="8" height="10" rx="1.5"/>
    <rect x="8" y="10" width="8" height="10" rx="1.5"/>
    <circle cx="12" cy="15.5" r="1"/>
    <path d="M5.5 10C5.5 6 9 4 12 4S18.5 6 18.5 10"/>
    <path d="M5.5 10H8M16 10H18.5"/>`,

  // Taproot: a seed rooting, green cracks spreading down from it.
  taproot: `
    <ellipse ${ACCENT} cx="12" cy="7.5" rx="3" ry="4" transform="rotate(20 12 7.5)"/>
    <ellipse cx="12" cy="7.5" rx="3" ry="4" transform="rotate(20 12 7.5)"/>
    <path d="M11.5 11.5V20.5"/>
    <path d="M11.5 15L7.5 18.5M11.5 16.5L16 19.5M7.5 18.5L6 21M16 19.5L18 21"/>`,

  // Spring chorus: soft ripples spreading across the floor, as on a pond.
  springChorus: `
    <ellipse ${ACCENT} cx="12" cy="16" rx="2.5" ry="1"/>
    <ellipse cx="12" cy="16" rx="2.5" ry="1"/>
    <path d="M5.5 16C5.5 14.4 8.4 13 12 13S18.5 14.4 18.5 16"/>
    <path d="M2.5 16C2.5 13.2 6.8 10.5 12 10.5S21.5 13.2 21.5 16"/>
    <path d="M12 7V4M10.5 5.5L12 4L13.5 5.5"/>`,

  // Moth lure: an island moth, glowing, drifting out.
  mothLure: `
    <path ${ACCENT} d="M12 11C9 6 4 6 4 9.5S8 14 12 12C16 14 20 13 20 9.5S15 6 12 11Z"/>
    <path d="M12 11C9 6 4 6 4 9.5S8 14 12 12C16 14 20 13 20 9.5S15 6 12 11Z"/>
    <path d="M12 9.5V17"/>
    <path d="M12 9.5C11.2 7.5 10 6 8.5 5.5M12 9.5C12.8 7.5 14 6 15.5 5.5"/>
    <path d="M6.5 18.5H6.6M17.5 19.5H17.6M9 21H9.1"/>`,
};

/**
 * One move's icon as inline SVG markup. @param {string} id a move id @param {number} [px] its size
 */
export function hollowIconSvg(id, px = 40) {
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" focusable="false"><g ${STROKE}>${HOLLOW_ICONS[id] ?? ''}</g></svg>`;
}
