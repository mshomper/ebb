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

  // Water tool (docs/15): a droplet over one ripple line.
  water: `
    <path ${ACCENT} d="M12 2.5C9.5 6 7 9 7 11.8A5 5 0 0 0 17 11.8C17 9 14.5 6 12 2.5Z"/>
    <path d="M12 2.5C9.5 6 7 9 7 11.8A5 5 0 0 0 17 11.8C17 9 14.5 6 12 2.5Z"/>
    <path d="M9.6 12.2A2.4 2.4 0 0 0 11.4 14.3" opacity="0.7"/>
    <path d="M3 20C4.5 18.8 6 18.8 7.5 20S10.5 21.2 12 20S15 18.8 16.5 20S19.5 21.2 21 20"/>`,

  // Pour: a spout bending down, a falling drop, a small pool on the ground line.
  pour: `
    <path d="M2.5 4.5H8.5A3 3 0 0 1 11.5 7.5V8.5"/>
    <path ${ACCENT} d="M11.5 10.5C10.5 12 9.5 13.2 9.5 14.3A2 2 0 0 0 13.5 14.3C13.5 13.2 12.5 12 11.5 10.5Z"/>
    <path d="M11.5 10.5C10.5 12 9.5 13.2 9.5 14.3A2 2 0 0 0 13.5 14.3C13.5 13.2 12.5 12 11.5 10.5Z"/>
    <path ${ACCENT} d="M6.5 20C8 18.6 15 18.6 16.5 20Z"/>
    <path d="M2.5 20H21.5"/>`,

  // Drain: a shallow pool over a gap in the ground line, water leaving downward through it.
  drain: `
    <path ${ACCENT} d="M4.5 9.5C6.5 7.6 17.5 7.6 19.5 9.5Z"/>
    <path d="M4.5 9.5C6.5 7.6 17.5 7.6 19.5 9.5"/>
    <path d="M2.5 9.5H9.5M14.5 9.5H21.5"/>
    <path d="M9.5 9.5V12M14.5 9.5V12"/>
    <path d="M12 12.5V20"/>
    <path d="M9.5 17.5L12 20L14.5 17.5"/>`,

  // Spring: water welling up from the ground and arcing over, a ripple at its foot.
  wellspring: `
    <path ${ACCENT} d="M6.5 20.5C7.5 18.6 16.5 18.6 17.5 20.5Z"/>
    <path d="M6.5 20.5C7.5 18.6 16.5 18.6 17.5 20.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M12 18V10"/>
    <path d="M12 10C12 6.5 8.5 5 6.5 7.8"/>
    <path d="M12 10C12 6.5 15.5 5 17.5 7.8"/>
    <circle cx="6" cy="10.8" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="10.8" r="0.9" fill="currentColor" stroke="none"/>`,

  // Spring flow rates: one, two or three small wave lines.
  'rate-trickle': `
    <path d="M4.5 12C5.75 10.5 7 10.5 8.25 12S10.75 13.5 12 12S14.5 10.5 15.75 12S18.25 13.5 19.5 12"/>`,
  'rate-brook': `
    <path d="M4.5 9.5C5.75 8 7 8 8.25 9.5S10.75 11 12 9.5S14.5 8 15.75 9.5S18.25 11 19.5 9.5"/>
    <path d="M4.5 14.5C5.75 13 7 13 8.25 14.5S10.75 16 12 14.5S14.5 13 15.75 14.5S18.25 16 19.5 14.5"/>`,
  'rate-stream': `
    <path d="M4.5 7C5.75 5.5 7 5.5 8.25 7S10.75 8.5 12 7S14.5 5.5 15.75 7S18.25 8.5 19.5 7"/>
    <path d="M4.5 12C5.75 10.5 7 10.5 8.25 12S10.75 13.5 12 12S14.5 10.5 15.75 12S18.25 13.5 19.5 12"/>
    <path d="M4.5 17C5.75 15.5 7 15.5 8.25 17S10.75 18.5 12 17S14.5 15.5 15.75 17S18.25 18.5 19.5 17"/>`,

  // Remove a spring: a drop with a small cross drawn as two strokes beside its foot.
  'spring-remove': `
    <path ${ACCENT} d="M10 3C7.8 6.2 5.5 8.6 5.5 11.5A4.5 4.5 0 0 0 14.5 11.5C14.5 8.6 12.2 6.2 10 3Z"/>
    <path d="M10 3C7.8 6.2 5.5 8.6 5.5 11.5A4.5 4.5 0 0 0 14.5 11.5C14.5 8.6 12.2 6.2 10 3Z"/>
    <path d="M15.5 15.5L20 20"/>
    <path d="M20 15.5L15.5 20"/>`,

  // Plant tool: a seedling with two leaves rising from a small mound on the ground line.
  plant: `
    <path ${ACCENT} d="M7 20.5C8 18.6 16 18.6 17 20.5Z"/>
    <path d="M7 20.5C8 18.6 16 18.6 17 20.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M12 19V10.5"/>
    <path ${ACCENT} d="M12 14C9.4 14 6.6 12.3 6 8.8C9 8.6 11.6 10.4 12 14Z"/>
    <path d="M12 14C9.4 14 6.6 12.3 6 8.8C9 8.6 11.6 10.4 12 14Z"/>
    <path ${ACCENT} d="M12 11C12.3 7.4 14.8 4.6 18.5 4.5C18.6 8.2 15.8 10.8 12 11Z"/>
    <path d="M12 11C12.3 7.4 14.8 4.6 18.5 4.5C18.6 8.2 15.8 10.8 12 11Z"/>`,

  // Reeds (species chip): a stem with a cattail seed head between two curving blades.
  reeds: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M12 20.5V12"/>
    <rect ${ACCENT} x="10.6" y="5.5" width="2.8" height="6.5" rx="1.4"/>
    <rect x="10.6" y="5.5" width="2.8" height="6.5" rx="1.4"/>
    <path d="M12 5.5V3"/>
    <path d="M9.5 20.5C9.3 15.5 8 11 5.5 7.5"/>
    <path d="M14.5 20.5C14.8 16 16.2 12.5 18.5 10"/>`,

  // Water lilies (species chip): a notched pad seen low on a wavy water line, a cup flower of
  // pointed petals sitting on it (the flower hides the back edge of the pad).
  lilies: `
    <path ${ACCENT} d="M8.5 12.63A8.5 2.6 0 0 0 11.26 17.59L12.6 15.1L16.25 17.25A8.5 2.6 0 0 0 15.5 12.63A8.5 2.6 0 0 0 8.5 12.63Z"/>
    <path d="M8.5 12.63A8.5 2.6 0 0 0 11.26 17.59L12.6 15.1L16.25 17.25A8.5 2.6 0 0 0 15.5 12.63"/>
    <path d="M12 7.5C13.4 9.1 14 11 12 14C10 11 10.6 9.1 12 7.5Z"/>
    <path d="M12 14C9.6 14 7.8 12.3 7.5 9.7C9.6 10.1 11.2 11.5 12 14Z"/>
    <path d="M12 14C14.4 14 16.2 12.3 16.5 9.7C14.4 10.1 12.8 11.5 12 14Z"/>
    <path d="M3 20.5C4.5 19.5 6 19.5 7.5 20.5S10.5 21.5 12 20.5S15 19.5 16.5 20.5S19.5 21.5 21 20.5"/>`,

  // Yellow iris (species chip): a fan of three sword leaves from one base, and a flower on a
  // stalk with three drooping falls and one short upright standard.
  iris: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M9 20.5C7.9 15.5 7.5 10 8 4.5C9.9 9 10.5 15 9 20.5Z"/>
    <path d="M9 20.5C8 16.5 6.4 12.8 4 10C7.3 11.8 9.5 15.6 9 20.5Z"/>
    <path d="M9 20.5C7.6 18 5.6 16.2 2.8 15C6 14.8 8.6 17 9 20.5Z"/>
    <path d="M12 20.5C12.2 17 13.8 14.6 16 13.2"/>
    <path ${ACCENT} d="M16 7.5C13.6 6.4 11.4 7.8 11.4 11.6C13.9 11.6 15.6 9.8 16 7.5ZM16 7.5C18.4 6.4 20.6 7.8 20.6 11.6C18.1 11.6 16.4 9.8 16 7.5ZM16 7.5C17 9.1 17 11.4 16 13.2C15 11.4 15 9.1 16 7.5Z"/>
    <path d="M16 7.5C13.6 6.4 11.4 7.8 11.4 11.6C13.9 11.6 15.6 9.8 16 7.5Z"/>
    <path d="M16 7.5C18.4 6.4 20.6 7.8 20.6 11.6C18.1 11.6 16.4 9.8 16 7.5Z"/>
    <path d="M16 7.5C17 9.1 17 11.4 16 13.2C15 11.4 15 9.1 16 7.5Z"/>
    <path d="M16 7.5C15.4 6 15.6 4.4 16.8 3"/>`,

  // Marsh marigold (species chip): two round, notched leaves on short stalks at a wavy water line,
  // and a five-petalled cup flower above them.
  marigold: `
    <path d="M3 20.5C4.5 19.5 6 19.5 7.5 20.5S10.5 21.5 12 20.5S15 19.5 16.5 20.5S19.5 21.5 21 20.5"/>
    <path d="M8.5 16.4C5.3 18 3.4 14.7 4.6 12.7C5.6 11 7.6 11 8.5 12.4C9.4 11 11.4 11 12.4 12.7C13.6 14.7 11.7 18 8.5 16.4Z"/>
    <path d="M8.5 16.4V20"/>
    <path d="M16.5 17.6C14.2 18.8 12.8 16.4 13.7 15C14.4 13.8 15.9 13.8 16.5 14.8C17.1 13.8 18.6 13.8 19.3 15C20.2 16.4 18.8 18.8 16.5 17.6Z"/>
    <path d="M16.5 17.6V20"/>
    <path d="M13.5 12C13.6 10.2 14.2 8.8 15 7.8"/>
    <path ${ACCENT} d="M15 7.8m-3.4 0a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0"/>
    <path d="M15 4.4C16.2 4.4 17 5.2 17 6.2C18.2 6 19.2 7 18.6 8.2C19.4 9 18.8 10.6 17.6 10.4C17.2 11.6 15.6 11.8 15 10.8C14.4 11.8 12.8 11.6 12.4 10.4C11.2 10.6 10.6 9 11.4 8.2C10.8 7 11.8 6 13 6.2C13 5.2 13.8 4.4 15 4.4Z"/>
    <circle cx="15" cy="7.8" r="1" fill="currentColor" stroke="none"/>`,

  // Sea campion (species chip): a low mat on a rock's back, and a flower on a short stalk: a
  // swollen, veined calyx with spreading petals on top.
  campion: `
    <path ${ACCENT} d="M3.5 20.5C4.2 17.5 7.5 16 11 16.4C14.5 16.8 17 18.3 17.6 20.5Z"/>
    <path d="M3.5 20.5C4.2 17.5 7.5 16 11 16.4C14.5 16.8 17 18.3 17.6 20.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M6 17.6C7.5 16.2 9.4 15.4 11.2 15.4M15.8 18C14.6 16.6 12.9 15.8 11.2 15.4"/>
    <path d="M11.2 15.4C11.6 13.8 12.4 12.6 13.4 11.8"/>
    <path ${ACCENT} d="M13.6 11.8C11.9 11.8 11.2 10.2 11.4 8.6C11.6 7.2 12.6 6.6 13.6 6.6S15.6 7.2 15.8 8.6C16 10.2 15.3 11.8 13.6 11.8Z"/>
    <path d="M13.6 11.8C11.9 11.8 11.2 10.2 11.4 8.6C11.6 7.2 12.6 6.6 13.6 6.6S15.6 7.2 15.8 8.6C16 10.2 15.3 11.8 13.6 11.8Z"/>
    <path d="M13.6 6.6V11.8"/>
    <path d="M13.6 6.6C11.4 6.2 9.8 4.8 9.6 3.2C11.6 3 13 4.4 13.6 6.6ZM13.6 6.6C15.8 6.2 17.4 4.8 17.6 3.2C15.6 3 14.2 4.4 13.6 6.6ZM13.6 6.6C13 4.6 13.2 3 13.6 2.2C14 3 14.2 4.6 13.6 6.6Z"/>`,

  // Sea thrift (species chip): a low rounded cushion on the ground line, three thin stalks each
  // topped by a round pompom.
  thrift: `
    <path ${ACCENT} d="M5 20.5C5 16.8 8 15.5 12 15.5S19 16.8 19 20.5Z"/>
    <path d="M5 20.5C5 16.8 8 15.5 12 15.5S19 16.8 19 20.5"/>
    <path d="M3.5 20.5H20.5"/>
    <path d="M9.5 15.9C9 13.8 8.2 12.8 7.6 12"/>
    <path d="M12 15.5V7.1"/>
    <path d="M14.5 15.9C15 13.8 15.8 12.8 16.4 12"/>
    <circle ${ACCENT} cx="7" cy="10" r="2.1"/>
    <circle cx="7" cy="10" r="2.1"/>
    <circle ${ACCENT} cx="12" cy="5" r="2.1"/>
    <circle cx="12" cy="5" r="2.1"/>
    <circle ${ACCENT} cx="17" cy="10" r="2.1"/>
    <circle cx="17" cy="10" r="2.1"/>`,

  // Grass (journal page): five blades of different heights rising from the ground line.
  grass: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M6 20.5C6 16.5 5 13.5 3.5 11.5"/>
    <path d="M8.5 20.5C8.7 15 9.5 10.5 11 7.5"/>
    <path d="M12 20.5C11.6 16.5 10.6 13.5 9 11.8"/>
    <path d="M14.5 20.5C14.8 16 16 12.5 18 10"/>
    <path d="M17.5 20.5C17.6 17.5 18.6 15.6 20.5 14.2"/>`,

  // Rushes and sedges (journal page): a tussock of stiff straight stems splaying from one base,
  // a small flower tuft on the side of the middle stem near its top.
  rushes: `
    <path ${ACCENT} d="M7.5 20.5C8.5 19 15.5 19 16.5 20.5Z"/>
    <path d="M3.5 20.5H20.5"/>
    <path d="M12 20.5V3.5"/>
    <path d="M10.5 20.5L6.5 5.5"/>
    <path d="M13.5 20.5L17.5 5.5"/>
    <path d="M9 20.5L3.8 11"/>
    <path d="M15 20.5L20.2 11"/>
    <path ${ACCENT} d="M12 7.5C13.4 6.7 14.5 7.4 14.3 9C13.3 9.4 12.3 8.8 12 7.5Z"/>
    <path d="M12 7.5C13.4 6.7 14.5 7.4 14.3 9C13.3 9.4 12.3 8.8 12 7.5Z"/>`,

  // Journal (docs/15): a bound book with a ribbon marker and a pressed leaf on the cover.
  journal: `
    <path ${ACCENT} d="M5 18.5V5.5A1 1 0 0 1 6 4.5H19V17H6.5A1.5 1.5 0 0 0 5 18.5Z"/>
    <path d="M5 18.5V5.5A1 1 0 0 1 6 4.5H19V17H6.5A1.5 1.5 0 0 0 5 18.5A1.5 1.5 0 0 0 6.5 20H19"/>
    <path d="M8 4.5V10L9.5 8.8L11 10V4.5"/>
    <path d="M12.5 14C12.7 11.5 14.3 10 16.5 9.8C16.6 12.1 15 13.8 12.5 14Z"/>
    <path d="M12.5 14L14.6 11.9"/>`,

  // Season marks for the journal's season boxes: a bud, a sun, a falling leaf, a frost star.
  'season-spring': `
    <path d="M7.5 20.5H16.5"/>
    <path d="M12 20.5V11.5"/>
    <path ${ACCENT} d="M12 15C9.5 15 7.5 13.3 7 10.5C9.6 10.4 11.6 12.1 12 15Z"/>
    <path d="M12 15C9.5 15 7.5 13.3 7 10.5C9.6 10.4 11.6 12.1 12 15Z"/>
    <path ${ACCENT} d="M12 11.5C12.4 8.6 14.3 6.6 17 6.5C17 9.3 15 11.3 12 11.5Z"/>
    <path d="M12 11.5C12.4 8.6 14.3 6.6 17 6.5C17 9.3 15 11.3 12 11.5Z"/>`,
  'season-summer': `
    <circle ${ACCENT} cx="12" cy="12" r="3.8"/>
    <circle cx="12" cy="12" r="3.8"/>
    <path d="M12 3.5V5.5M12 18.5V20.5M3.5 12H5.5M18.5 12H20.5M6 6L7.4 7.4M16.6 16.6L18 18M6 18L7.4 16.6M16.6 7.4L18 6"/>`,
  'season-autumn': `
    <path ${ACCENT} d="M5.5 17.5C5.5 11 9.8 6 17.5 5.5C17.5 13 12.5 17.5 5.5 17.5Z"/>
    <path d="M5.5 17.5C5.5 11 9.8 6 17.5 5.5C17.5 13 12.5 17.5 5.5 17.5Z"/>
    <path d="M5.5 17.5L13 10"/>
    <path d="M3.5 21C5 20 6 19.5 7.5 19.8"/>`,
  'season-winter': `
    <path d="M12 3.5V20.5M4.6 7.75L19.4 16.25M4.6 16.25L19.4 7.75"/>
    <path d="M10 5.3L12 7.3L14 5.3M10 18.7L12 16.7L14 18.7"/>
    <path d="M5.4 10.3L8.1 9.6L7.4 6.9M18.6 13.7L15.9 14.4L16.6 17.1"/>
    <path d="M7.4 17.1L8.1 14.4L5.4 13.7M16.6 6.9L15.9 9.6L18.6 10.3"/>`,

  // Ground pages: soil (a low mound with clods), sand (wind ripples), rock (a faceted boulder),
  // moss (soft cushions), shore (waves over a sandy curve).
  soil: `
    <path ${ACCENT} d="M3 17.5C6 13.5 9 12.5 12 12.5S18 13.5 21 17.5Z"/>
    <path d="M3 17.5C6 13.5 9 12.5 12 12.5S18 13.5 21 17.5"/>
    <path d="M2.5 17.5H21.5"/>
    <circle cx="9" cy="15.2" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="13" cy="14.6" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="16.2" cy="16" r="0.9" fill="currentColor" stroke="none"/>
    <path d="M12 12.5V8.5M12 10C10.8 8.6 9.6 8.2 8.5 8.5M12 9.5C13 8 14.3 7.5 15.5 7.8"/>`,
  sand: `
    <path d="M3 8C5 6.5 7 6.5 9 8S13 9.5 15 8S19 6.5 21 8"/>
    <path d="M3 13C5 11.5 7 11.5 9 13S13 14.5 15 13S19 11.5 21 13"/>
    <path d="M3 18C5 16.5 7 16.5 9 18S13 19.5 15 18S19 16.5 21 18"/>
    <circle cx="6" cy="10.4" r="0.7" fill="currentColor" stroke="none"/>
    <circle cx="16.5" cy="15.6" r="0.7" fill="currentColor" stroke="none"/>`,
  rock: `
    <path ${ACCENT} d="M4 19.5L6.5 11.5L11 8L16.5 9.5L20 14.5L19 19.5Z"/>
    <path d="M4 19.5L6.5 11.5L11 8L16.5 9.5L20 14.5L19 19.5Z"/>
    <path d="M11 8L12.5 13.5L20 14.5M12.5 13.5L9.5 19.5"/>
    <path d="M2.5 19.5H21.5"/>`,
  moss: `
    <path ${ACCENT} d="M3 18.5C3 15.5 5.5 14 8 14.5C9 12 12.5 11.5 14 14C16 12.5 20.5 13.5 21 18.5Z"/>
    <path d="M3 18.5C3 15.5 5.5 14 8 14.5C9 12 12.5 11.5 14 14C16 12.5 20.5 13.5 21 18.5"/>
    <path d="M2.5 18.5H21.5"/>
    <path d="M8 14.5V12.5M14 14V11.5M18 14.5V13" />
    <circle cx="8" cy="11.8" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="14" cy="10.8" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="12.3" r="0.8" fill="currentColor" stroke="none"/>`,
  shore: `
    <path d="M3 9C5 7.5 7 7.5 9 9S13 10.5 15 9S19 7.5 21 9"/>
    <path d="M3 13.5C5 12 7 12 9 13.5S13 15 15 13.5S19 12 21 13.5"/>
    <path ${ACCENT} d="M2.5 20.5C8 17.5 16 17.5 21.5 20.5Z"/>
    <path d="M2.5 20.5C8 17.5 16 17.5 21.5 20.5"/>`,

  // Almanac: a calendar page with a crescent moon on it.
  almanac: `
    <rect ${ACCENT} x="4.5" y="5" width="15" height="15.5" rx="2"/>
    <rect x="4.5" y="5" width="15" height="15.5" rx="2"/>
    <path d="M4.5 9H19.5M8.5 3.5V6.5M15.5 3.5V6.5"/>
    <path d="M12.6 11.6A3.4 3.4 0 1 0 15.2 17A2.8 2.8 0 0 1 12.6 11.6Z"/>`,

  // Web (what needs what): three knots on a line above, one below, joined by curving threads.
  web: `
    <path d="M6 8.8C6 12.5 12 12 12 15.4M12 8.8V15.4M18 8.8C18 12.5 12 12 12 15.4"/>
    <circle ${ACCENT} cx="6" cy="6.5" r="2.3"/>
    <circle cx="6" cy="6.5" r="2.3"/>
    <circle ${ACCENT} cx="12" cy="6.5" r="2.3"/>
    <circle cx="12" cy="6.5" r="2.3"/>
    <circle ${ACCENT} cx="18" cy="6.5" r="2.3"/>
    <circle cx="18" cy="6.5" r="2.3"/>
    <circle ${ACCENT} cx="12" cy="18" r="2.6"/>
    <circle cx="12" cy="18" r="2.6"/>`,

  // Show me: a looking glass.
  find: `
    <circle ${ACCENT} cx="10.5" cy="10.5" r="6"/>
    <circle cx="10.5" cy="10.5" r="6"/>
    <path d="M15 15L20.5 20.5"/>`,

  // Moments: a flower, rain, dusk (a sun setting), dawn (a sun rising), mist.
  'moment-flower': `
    <circle cx="12" cy="7.3" r="2.6"/>
    <circle cx="16.5" cy="10.6" r="2.6"/>
    <circle cx="14.8" cy="15.8" r="2.6"/>
    <circle cx="9.2" cy="15.8" r="2.6"/>
    <circle cx="7.5" cy="10.6" r="2.6"/>
    <circle ${ACCENT} cx="12" cy="12" r="2"/>`,
  'moment-rain': `
    <path ${ACCENT} d="M7 14.5A3.5 3.5 0 0 1 7.6 7.6A4.5 4.5 0 0 1 16.2 7A3.6 3.6 0 0 1 17 14.5Z"/>
    <path d="M7 14.5A3.5 3.5 0 0 1 7.6 7.6A4.5 4.5 0 0 1 16.2 7A3.6 3.6 0 0 1 17 14.5Z"/>
    <path d="M8.5 17.5L7.5 20M12.5 17.5L11.5 20M16.5 17.5L15.5 20"/>`,
  'moment-dusk': `
    <path ${ACCENT} d="M7 16A5 5 0 0 1 17 16Z"/>
    <path d="M7 16A5 5 0 0 1 17 16"/>
    <path d="M2.5 16H21.5M6 19.5H18"/>
    <path d="M12 12.5V14.5M9 11.5L10 13M15 11.5L14 13"/>`,
  'moment-dawn': `
    <path ${ACCENT} d="M7 16A5 5 0 0 1 17 16Z"/>
    <path d="M7 16A5 5 0 0 1 17 16"/>
    <path d="M2.5 16H21.5"/>
    <path d="M12 3.5V8.5M9.5 6L12 3.5L14.5 6"/>`,
  'moment-mist': `
    <path d="M3.5 7.5H16.5M6.5 11H20.5M3.5 14.5H15M8 18H18"/>`,

  // Journal notes: a page with a folded corner and three written lines.
  notes: `
    <path ${ACCENT} d="M6 3.5H14.5L18.5 7.5V20.5H6Z"/>
    <path d="M6 3.5H14.5L18.5 7.5V20.5H6Z"/>
    <path d="M14.5 3.5V7.5H18.5"/>
    <path d="M9 11.5H15.5M9 14.5H15.5M9 17.5H13"/>`,

  // A name tag (S6c-3): a luggage-style tag on a short loop of string.
  'name-tag': `
    <path ${ACCENT} d="M4 12.5V5.5C4 4.7 4.7 4 5.5 4H12.5L20.5 12L12 20.5Z"/>
    <path d="M4 12.5V5.5C4 4.7 4.7 4 5.5 4H12.5L20.5 12L12 20.5Z"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="M12 12.5L15 15.5"/>`,

  // Feed (S6c-2): a small scoop tipped over, a pinch of food falling from it.
  feed: `
    <path ${ACCENT} d="M3.5 8.5H15L13.4 14.6C13.1 15.6 12.2 16.2 11.2 16.2H7.3C6.3 16.2 5.4 15.6 5.1 14.6Z"/>
    <path d="M3.5 8.5H15L13.4 14.6C13.1 15.6 12.2 16.2 11.2 16.2H7.3C6.3 16.2 5.4 15.6 5.1 14.6Z"/>
    <path d="M15 9.6L19.5 7.2"/>
    <circle cx="16.6" cy="15.2" r="0.95" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="17.8" r="0.95" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="20.2" r="0.95" fill="currentColor" stroke="none"/>`,

  // Animals (S6a): a frog sitting at the water's edge, in profile, hind leg folded; midges, a loose
  // cloud of dots over a reed tip.
  frog: `
    <path ${ACCENT} d="M4.5 17.5C4.5 13 8.5 10 13.2 9.6C13.8 7.6 16.4 7.2 17.3 9C19.2 9.5 20.6 10.6 20.6 11.8C20.6 13 19.3 13.6 17.8 13.8C16.6 16.3 13.6 17.5 9.8 17.5Z"/>
    <path d="M4.5 17.5C4.5 13 8.5 10 13.2 9.6C13.8 7.6 16.4 7.2 17.3 9C19.2 9.5 20.6 10.6 20.6 11.8C20.6 13 19.3 13.6 17.8 13.8C16.6 16.3 13.6 17.5 9.8 17.5Z"/>
    <circle cx="15.6" cy="9.6" r="0.95" fill="currentColor" stroke="none"/>
    <path d="M6.2 16.2C6.4 13.8 9.6 13 10.8 15.2"/>
    <path d="M15.6 15.3L16.4 19.5H18.6"/>
    <path d="M2.5 19.5H12.5"/>`,
  midges: `
    <path d="M9 21.5C9.4 18.5 9.8 16.5 10.6 14.5"/>
    <path d="M14.5 21.5V14"/>
    <path ${ACCENT} d="M13.6 14.2A0.9 1.6 0 0 1 15.4 14.2V11.6A0.9 1.6 0 0 0 13.6 11.6Z"/>
    <circle cx="6" cy="7" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="10" cy="4.5" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="13" cy="7.5" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="17.5" cy="5" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="19" cy="9.5" r="0.85" fill="currentColor" stroke="none"/>
    <circle cx="8.5" cy="10.5" r="0.85" fill="currentColor" stroke="none"/>
    <path d="M4.5 11.5C5.5 10.5 6.5 12.5 7.5 11.5M15.5 3C16.5 2 17.5 4 18.5 3" opacity="0.7"/>`,

  // A living thing not seen yet: a pencil circle, drawn in short dashes.
  unknown: `
    <circle cx="12" cy="12" r="8" stroke-dasharray="2.4 3"/>`,

  // Close: two crossing strokes.
  close: `
    <path d="M6.5 6.5L17.5 17.5"/>
    <path d="M17.5 6.5L6.5 17.5"/>`,

  // Back: a chevron pointing left.
  back: `
    <path d="M14.5 5.5L8 12L14.5 18.5"/>`,

  // A chevron pointing up (the phone sheet grows); CSS turns it over to point down.
  chevron: `
    <path d="M5.5 15L12 8.5L18.5 15"/>`,

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

  // Look (palette choice): a painter's palette with a thumb notch and three dabs of paint.
  look: `
    <path ${ACCENT} d="M12 3.5C6.9 3.5 3 7.3 3 12C3 16.7 6.8 20.5 11.5 20.5C12.9 20.5 13.8 19.7 13.8 18.6C13.8 17.6 13 17 13 16C13 14.9 13.9 14.2 15 14.2H16.8C19.2 14.2 21 12.5 21 10.2C21 6.4 17 3.5 12 3.5Z"/>
    <path d="M12 3.5C6.9 3.5 3 7.3 3 12C3 16.7 6.8 20.5 11.5 20.5C12.9 20.5 13.8 19.7 13.8 18.6C13.8 17.6 13 17 13 16C13 14.9 13.9 14.2 15 14.2H16.8C19.2 14.2 21 12.5 21 10.2C21 6.4 17 3.5 12 3.5Z"/>
    <circle cx="7.6" cy="12.6" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="9.4" cy="8.1" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="14.4" cy="7.4" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="9.6" cy="16.6" r="1.4" opacity="0.6"/>`,

  // An open eye: brings the hidden HUD buttons back on a touch screen.
  eye: `
    <path ${ACCENT} d="M2.5 12C4.6 8.2 8 6 12 6S19.4 8.2 21.5 12C19.4 15.8 16 18 12 18S4.6 15.8 2.5 12Z"/>
    <path d="M2.5 12C4.6 8.2 8 6 12 6S19.4 8.2 21.5 12C19.4 15.8 16 18 12 18S4.6 15.8 2.5 12Z"/>
    <circle cx="12" cy="12" r="3"/>
    <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>`,

  // Settings: three horizontal sliders with their knobs.
  settings: `
    <path d="M3.5 6.5H20.5"/>
    <path d="M3.5 12H20.5"/>
    <path d="M3.5 17.5H20.5"/>
    <circle cx="9" cy="6.5" r="2.2" fill="currentColor" fill-opacity="0.9"/>
    <circle cx="15.5" cy="12" r="2.2" fill="currentColor" fill-opacity="0.9"/>
    <circle cx="11" cy="17.5" r="2.2" fill="currentColor" fill-opacity="0.9"/>`,

  // Sound: a small speaker with two sound arcs.
  sound: `
    <path ${ACCENT} d="M3.5 9.5H7.5L12 5.5V18.5L7.5 14.5H3.5Z"/>
    <path d="M3.5 9.5H7.5L12 5.5V18.5L7.5 14.5H3.5Z"/>
    <path d="M15.5 9.2C16.3 10 16.7 11 16.7 12S16.3 14 15.5 14.8"/>
    <path d="M18 6.8C19.4 8.2 20.2 10 20.2 12S19.4 15.8 18 17.2"/>`,

  // Controls: a fingertip touching, with two rings spreading from the touch.
  controls: `
    <circle ${ACCENT} cx="12" cy="9" r="2.4"/>
    <circle cx="12" cy="9" r="2.4"/>
    <path d="M12 11.4V20.5"/>
    <path d="M7.6 9A4.4 4.4 0 0 1 16.4 9"/>
    <path d="M4.6 9A7.4 7.4 0 0 1 19.4 9" opacity="0.6"/>`,

  // Quality: two stacked layers, the top one a little raised.
  quality: `
    <path ${ACCENT} d="M12 3.5L20.5 8.2L12 12.9L3.5 8.2Z"/>
    <path d="M12 3.5L20.5 8.2L12 12.9L3.5 8.2Z"/>
    <path d="M3.5 12.6L12 17.3L20.5 12.6"/>
    <path d="M3.5 16.6L12 21.3L20.5 16.6" opacity="0.6"/>`,

  // Saves: a keepsake box with an arrow going in.
  saves: `
    <path ${ACCENT} d="M4 9H20V20H4Z"/>
    <path d="M4 9H20V20H4Z"/>
    <path d="M4 9L6 5H18L20 9"/>
    <path d="M12 11.5V17"/>
    <path d="M9.5 14.5L12 17L14.5 14.5"/>`,

  // Tests: a small flask, a third full.
  tests: `
    <path ${ACCENT} d="M6.8 15H17.2L19.4 19.2C19.8 20 19.2 21 18.3 21H5.7C4.8 21 4.2 20 4.6 19.2Z"/>
    <path d="M9 3H15"/>
    <path d="M10 3V9.5L4.6 19.2C4.2 20 4.8 21 5.7 21H18.3C19.2 21 19.8 20 19.4 19.2L14 9.5V3"/>
    <path d="M6.8 15H17.2"/>`,

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
