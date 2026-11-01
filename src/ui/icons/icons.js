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

  // Remove a loose stone: the stone, smaller, with a small cross drawn as two strokes beside it.
  'stone-remove': `
    <path ${ACCENT} d="M3 15C3.3 10.9 6.2 7.8 10 7.6C13.4 7.4 15.8 9.6 16.2 12.7L9.5 15Z"/>
    <path d="M3 15C3.3 10.9 6.2 7.8 10 7.6C13.4 7.4 15.8 9.6 16.2 12.7L9.5 15Z"/>
    <path d="M2.5 17.5H12"/>
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

  // Grey willow (species chip): a rounded, lobed crown on several stems fanning up from one stool
  // on the ground line, two narrow leaves drawn on the crown.
  willow: `
    <path ${ACCENT} d="M6 14.6C4.2 14.6 3.3 12.6 4.5 11.1C4.1 8.9 5.9 7.3 8 7.7C8.6 5.3 11.2 4.1 13.4 5.1C15.3 4 17.8 5.2 18 7.5C20 7.9 20.9 10.1 19.6 11.7C20.3 13.5 19 15 17.4 14.7C15 15.7 9 15.7 6 14.6Z"/>
    <path d="M6 14.6C4.2 14.6 3.3 12.6 4.5 11.1C4.1 8.9 5.9 7.3 8 7.7C8.6 5.3 11.2 4.1 13.4 5.1C15.3 4 17.8 5.2 18 7.5C20 7.9 20.9 10.1 19.6 11.7C20.3 13.5 19 15 17.4 14.7C15 15.7 9 15.7 6 14.6Z"/>
    <path d="M3.5 20.5H20.5"/>
    <path d="M12 20.5V15.3M11.2 20.5C10.9 18.4 9.8 16.6 8.2 15.3M12.8 20.5C13.1 18.4 14.2 16.6 15.8 15.3"/>
    <path d="M8.6 11.6C9.4 10.2 10.6 9.4 12 9.2M13.2 12C14.2 10.8 15.4 10.2 16.6 10.2"/>`,

  // Gorse (species chip): a dense, rounded mound on the ground line, short spines standing off its
  // rim, and three small pea flowers on it.
  gorse: `
    <path ${ACCENT} d="M4 20.5C4 13 7.4 8.6 12 8.6S20 13 20 20.5Z"/>
    <path d="M4 20.5C4 13 7.4 8.6 12 8.6S20 13 20 20.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M4.9 14.6L3.2 14M6.6 11.2L5.3 9.9M9.2 9.3L8.6 7.6M12 8.6V6.8M14.8 9.3L15.4 7.6M17.4 11.2L18.7 9.9M19.1 14.6L20.8 14"/>
    <path d="M8.6 17.6L10 16.4M14 17.8L15.4 16.6"/>
    <circle cx="9.4" cy="13" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="14.6" cy="12.4" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="12.2" cy="15.8" r="1.2" fill="currentColor" stroke="none"/>`,

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

  // Water mint (species chip): a square stem rising from a wavy water line, two pairs of round
  // leaves, and a short lilac flower head at the top.
  watermint: `
    <path d="M3 20.5C4.5 19.5 6 19.5 7.5 20.5S10.5 21.5 12 20.5S15 19.5 16.5 20.5S19.5 21.5 21 20.5"/>
    <path d="M12 19.5V7.6"/>
    <path ${ACCENT} d="M12 15.4C10 17 6.6 16.6 5.8 13.8C8 12.4 10.8 13 12 15.4ZM12 15.4C14 17 17.4 16.6 18.2 13.8C16 12.4 13.2 13 12 15.4Z"/>
    <path d="M12 15.4C10 17 6.6 16.6 5.8 13.8C8 12.4 10.8 13 12 15.4Z"/>
    <path d="M12 15.4C14 17 17.4 16.6 18.2 13.8C16 12.4 13.2 13 12 15.4Z"/>
    <path d="M12 11C10.6 12.2 8.2 11.8 7.6 9.8C9.2 8.8 11.2 9.2 12 11Z"/>
    <path d="M12 11C13.4 12.2 15.8 11.8 16.4 9.8C14.8 8.8 12.8 9.2 12 11Z"/>
    <path ${ACCENT} d="M12 2.6C13.4 2.6 14.1 3.8 14.1 5.1S13.3 7.6 12 7.6S9.9 6.4 9.9 5.1S10.6 2.6 12 2.6Z"/>
    <path d="M12 2.6C13.4 2.6 14.1 3.8 14.1 5.1S13.3 7.6 12 7.6S9.9 6.4 9.9 5.1S10.6 2.6 12 2.6Z"/>`,

  // Meadowsweet (species chip): two tall stems from the ground line, each under a frothy,
  // flat-topped head, one broad leaf low on the stem.
  meadowsweet: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M10 20.5C9.8 15.5 9.6 11 9.6 7.6M9.6 7.6L6.4 6.4M9.6 7.6L12.6 6.2M13.4 20.5C14.4 16 15.4 13.4 16.6 11.6M16.6 11.6L14.6 10.6M16.6 11.6L18.6 10.8"/>
    <circle ${ACCENT} cx="9.4" cy="4.6" r="3.6"/>
    <circle cx="5.6" cy="5.4" r="1.3"/><circle cx="8" cy="3.6" r="1.3"/><circle cx="10.8" cy="3.4" r="1.3"/><circle cx="13.2" cy="5" r="1.3"/>
    <circle ${ACCENT} cx="16.8" cy="9.4" r="2.6"/>
    <circle cx="14.2" cy="9.6" r="1.1"/><circle cx="16.6" cy="8.2" r="1.1"/><circle cx="19" cy="9.4" r="1.1"/>
    <path d="M9.8 16.2C8.2 14.4 5.8 14 4 15C5.4 16.8 7.8 17.2 9.8 16.2Z"/>`,

  // Nettle (species chip): one upright stem from the ground line, pairs of pointed, toothed
  // leaves getting smaller toward the top.
  nettle: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M12 20.5V3"/>
    <path ${ACCENT} d="M12 17Q8 18.5 5 12L6.8 12.2L7.2 13.3L8.6 13L9 14.2L10.4 14L11 15.2ZM12 17Q16 18.5 19 12L17.2 12.2L16.8 13.3L15.4 13L15 14.2L13.6 14L13 15.2Z"/>
    <path d="M12 17Q8 18.5 5 12L6.8 12.2L7.2 13.3L8.6 13L9 14.2L10.4 14L11 15.2Z"/>
    <path d="M12 17Q16 18.5 19 12L17.2 12.2L16.8 13.3L15.4 13L15 14.2L13.6 14L13 15.2Z"/>
    <path d="M12 11.6Q9 12.7 6.8 7.9L8.1 8L8.4 8.8L9.5 8.6L9.8 9.5L10.8 9.4L11.3 10.3Z"/>
    <path d="M12 11.6Q15 12.7 17.2 7.9L15.9 8L15.6 8.8L14.5 8.6L14.2 9.5L13.2 9.4L12.7 10.3Z"/>
    <path d="M12 6.4Q10.2 7.1 8.9 4.2Q10.6 4.4 12 6.4ZM12 6.4Q13.8 7.1 15.1 4.2Q13.4 4.4 12 6.4Z"/>`,

  // Chamomile (species chip): a low feathery mat on the ground line, two daisies on short stems,
  // white petals round a solid gold heart.
  chamomile: `
    <path ${ACCENT} d="M4 20.5C4.6 17.8 8 16.6 12 16.6S19.4 17.8 20 20.5Z"/>
    <path d="M4 20.5C4.6 17.8 8 16.6 12 16.6S19.4 17.8 20 20.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M6.4 18.6L5.6 17.6M9 17.4L8.6 16.2M15 17.4L15.4 16.2M17.6 18.6L18.4 17.6"/>
    <path d="M10.4 16.8C10 14.6 9 12.8 7.8 11.6M13.6 16.8C14 14 15 11.6 16.2 10"/>
    <path d="M7.8 11.6m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M7.8 8.6V7.2M7.8 14.6V16M4.8 11.6H3.4M10.8 11.6H12.2M5.7 9.5L4.7 8.5M9.9 9.5L10.9 8.5M5.7 13.7L4.7 14.7M9.9 13.7L10.9 14.7"/>
    <circle cx="7.8" cy="11.6" r="1.3" fill="currentColor" stroke="none"/>
    <path d="M16.2 7m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M16.2 4V2.6M16.2 10V11.4M13.2 7H11.8M19.2 7H20.6M14.1 4.9L13.1 3.9M18.3 4.9L19.3 3.9M14.1 9.1L13.1 10.1M18.3 9.1L19.3 10.1"/>
    <circle cx="16.2" cy="7" r="1.3" fill="currentColor" stroke="none"/>`,

  // Harebell (species chip): two wiry stems from the ground line arching over at the top, a bell
  // nodding from each, thin stem leaves and one round leaf at the foot.
  harebell: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M11 20.5C11 14.5 10.6 9.6 9.4 6.8C8.6 5 7 4.4 5.6 5.6M12.8 20.5C13 15 13.8 10.6 15.4 7.8C16.4 6.2 18 6.4 18.6 8"/>
    <path d="M10.9 15.8L8.8 14.2M13.2 14.4L15.4 13"/>
    <path d="M11 20.4C9.6 20.4 8.4 19.6 8.2 18.4C9.6 18.2 10.6 19 11 20.4Z"/>
    <path ${ACCENT} d="M4.8 5.6C4 6.4 3.8 8 3.6 9.6L3.2 10.6Q4.4 9.9 5.6 10.6Q6.8 9.9 8 10.6L7.6 9.6C7.4 8 7.2 6.4 6.4 5.6ZM17.8 8C17 8.8 16.8 10.4 16.6 12L16.2 13Q17.4 12.3 18.6 13Q19.8 12.3 21 13L20.6 12C20.4 10.4 20.2 8.8 19.4 8Z"/>
    <path d="M4.8 5.6C4 6.4 3.8 8 3.6 9.6L3.2 10.6Q4.4 9.9 5.6 10.6Q6.8 9.9 8 10.6L7.6 9.6C7.4 8 7.2 6.4 6.4 5.6Z"/>
    <path d="M17.8 8C17 8.8 16.8 10.4 16.6 12L16.2 13Q17.4 12.3 18.6 13Q19.8 12.3 21 13L20.6 12C20.4 10.4 20.2 8.8 19.4 8Z"/>`,

  // Bird's-foot trefoil (species chip): a low mat on the ground line, a crown of three pea flowers
  // on one stalk and, on another, three pods splayed like a bird's toes.
  trefoil: `
    <path ${ACCENT} d="M3.5 20.5C4.4 18.4 7.8 17.4 12 17.4S19.6 18.4 20.5 20.5Z"/>
    <path d="M3.5 20.5C4.4 18.4 7.8 17.4 12 17.4S19.6 18.4 20.5 20.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M9 17.6C8.8 14.6 8.4 12.4 8 10.4M14.6 17.4C15 15 15.6 12.6 16.2 10.6"/>
    <path ${ACCENT} d="M8 10.4C6.6 10.4 4.6 9 3.8 7.4C5.6 6.8 7.4 8.4 8 10.4ZM8 10.4C7.2 9 7.2 6.2 8 4C8.8 6.2 8.8 9 8 10.4ZM8 10.4C8.6 8.4 10.4 6.8 12.2 7.4C11.4 9 9.4 10.4 8 10.4Z"/>
    <path d="M8 10.4C6.6 10.4 4.6 9 3.8 7.4C5.6 6.8 7.4 8.4 8 10.4Z"/>
    <path d="M8 10.4C7.2 9 7.2 6.2 8 4C8.8 6.2 8.8 9 8 10.4Z"/>
    <path d="M8 10.4C8.6 8.4 10.4 6.8 12.2 7.4C11.4 9 9.4 10.4 8 10.4Z"/>
    <path d="M16.2 10.6L13.6 4.6M16.2 10.6L16.8 3.8M16.2 10.6L19.8 5"/>`,

  // Wild thyme (species chip): a woody stem creeping along the ground line, three short upright
  // shoots with paired tiny leaves, a round flower head on each tip.
  thyme: `
    <path ${ACCENT} d="M3 20.5C3 19.4 21 18.4 21 20.5Z"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M3 19.6C5.6 18.8 7 20 9.4 19.2S13.6 18.4 16 19.2S19.4 19.6 21 18.8"/>
    <path d="M5.8 19.4V14.6M12 18.8V11M18.2 19.2V13.6"/>
    <path d="M5.8 17.2L4.4 16.2M5.8 17.2L7.2 16.2M12 16.6L10.6 15.6M12 16.6L13.4 15.6M12 13.8L10.6 12.8M12 13.8L13.4 12.8M18.2 16.8L16.8 15.8M18.2 16.8L19.6 15.8"/>
    <circle ${ACCENT} cx="5.8" cy="12.6" r="2"/>
    <circle cx="5.8" cy="12.6" r="2"/>
    <circle ${ACCENT} cx="12" cy="8.8" r="2.2"/>
    <circle cx="12" cy="8.8" r="2.2"/>
    <circle ${ACCENT} cx="18.2" cy="11.6" r="2"/>
    <circle cx="18.2" cy="11.6" r="2"/>`,

  // Red clover (species chip): a round flower head on a stem with two small leaves under it, and
  // a leaf of three oval leaflets on a long stalk from the foot.
  clover: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M14.4 20.5C14.6 16.4 14.8 13.4 15 10.8M13.4 20.5C12 18.2 9.8 16.2 7.4 15.2"/>
    <path d="M7.4 15.2A2.5 1.2 -165 1 0 2.57 13.91A2.5 1.2 -165 1 0 7.4 15.2ZM7.4 15.2A2.5 1.2 -105 1 0 6.11 10.37A2.5 1.2 -105 1 0 7.4 15.2ZM7.4 15.2A2.5 1.2 -45 1 0 10.94 11.66A2.5 1.2 -45 1 0 7.4 15.2Z"/>
    <path d="M15 10.8C13.8 11.6 12.2 11.4 11.6 10.4C12.8 9.8 14.2 10 15 10.8ZM15 10.8C16.2 11.6 17.8 11.4 18.4 10.4C17.2 9.8 15.8 10 15 10.8Z"/>
    <ellipse ${ACCENT} cx="15" cy="6.4" rx="3.6" ry="3.9"/>
    <ellipse cx="15" cy="6.4" rx="3.6" ry="3.9"/>
    <path d="M12.9 5.2L14 6.2L15 5.2L16 6.2L17.1 5.2M14 7.8L15 8.8L16 7.8" opacity="0.7"/>`,

  // Lady's bedstraw (species chip): an upright wiry stem from the ground line ringed by two whorls
  // of needle leaves, a loose froth of tiny flowers on fine branches at the top.
  bedstraw: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M12 20.5V8.6M12 8.6L8.4 6.4M12 8.6L15.8 6.4M12 8.6V4.8"/>
    <path d="M8.6 15L15.4 17.2M8.6 17.2L15.4 15M9.6 11.2L14.4 12.8M9.6 12.8L14.4 11.2"/>
    <ellipse ${ACCENT} cx="12" cy="5.4" rx="6" ry="3.6"/>
    <circle cx="7.4" cy="6.4" r="1" fill="currentColor" stroke="none"/>
    <circle cx="9.4" cy="4.2" r="1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="3.2" r="1" fill="currentColor" stroke="none"/>
    <circle cx="14.6" cy="4.2" r="1" fill="currentColor" stroke="none"/>
    <circle cx="16.6" cy="6.4" r="1" fill="currentColor" stroke="none"/>
    <circle cx="10.6" cy="6.6" r="1" fill="currentColor" stroke="none"/>
    <circle cx="13.4" cy="6.6" r="1" fill="currentColor" stroke="none"/>`,

  // Flax (species chip, F1): three slender upright stems from the ground line, short narrow leaves
  // up them, a flat five-petal flower on two tips and a round seed boll on the third.
  flax: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M8.6 20.5C8.4 15.6 7.8 11.4 6.8 8.2M12 20.5V5.8M15.6 20.5C15.8 16 16.6 12.6 17.6 10.4"/>
    <path d="M8.3 16.4L6.8 15.2M7.8 12.8L9.2 11.6M12 16.6L10.6 15.4M12 12.6L13.4 11.4M15.9 15.8L17.4 14.8"/>
    <path ${ACCENT} d="M6.8 8.2m-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0M12 5.8m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0"/>
    <path d="M6.8 8.2L6.8 5.8M6.8 8.2L4.5 7.5M6.8 8.2L5.4 10.2M6.8 8.2L8.2 10.2M6.8 8.2L9.1 7.5"/>
    <path d="M12 5.8L12 3.2M12 5.8L9.5 5M12 5.8L10.4 8M12 5.8L13.6 8M12 5.8L14.5 5"/>
    <circle cx="17.6" cy="9.2" r="1.3"/>`,

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

  // Islet: a low mound of land standing out of the sea, a tuft of meadow on it, water lines below.
  islet: `
    <path ${ACCENT} d="M3.5 15.5C6 11.5 9 10 12.5 10S18.5 12 20.5 15.5Z"/>
    <path d="M3.5 15.5C6 11.5 9 10 12.5 10S18.5 12 20.5 15.5"/>
    <path d="M11 10V7.5M11 8.5L9.5 7M11 8.5L12.5 7"/>
    <path d="M2.5 15.5H21.5"/>
    <path d="M5 19C6.5 18 8 18 9.5 19S12.5 20 14 19S17.5 18 19 19"/>`,

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

  // Finds (docs/future/11). Beadlet anemone: a squat column on the ground line with a crown of
  // tentacles open above it.
  anemone: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M8 20.5C7.6 17 8.4 14.5 12 14.5S16.4 17 16 20.5Z"/>
    <path d="M8 20.5C7.6 17 8.4 14.5 12 14.5S16.4 17 16 20.5"/>
    <path d="M8.6 14.8C7 13 5.6 12.4 4.4 12.6M9.6 14.2C8.8 11.6 7.8 10 6.6 9.4M11 14C10.8 11 10.4 8.8 9.6 7.6M13 14C13.2 11 13.6 8.8 14.4 7.6M14.4 14.2C15.2 11.6 16.2 10 17.4 9.4M15.4 14.8C17 13 18.4 12.4 19.6 12.6"/>`,
  // Periwinkle: a round spiral shell resting on the ground line, its whorl drawn in.
  periwinkle: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M5 20.5C4.4 15.8 7.6 12 12 12C15.8 12 18.6 14.6 19 20.5Z"/>
    <path d="M5 20.5C4.4 15.8 7.6 12 12 12C15.8 12 18.6 14.6 19 20.5"/>
    <path d="M12 12C13.8 9.6 16.4 9.2 17.6 10.6C18.4 11.6 18 13.2 16.4 13.6C15 14 13.8 13 14.2 12"/>
    <path d="M8 20.5C8 17.6 9.8 15.6 12.2 15.6C14 15.6 15.2 16.8 15.4 18.4"/>`,
  // Shells: a ribbed fan shell on the ground line and a small spiral one beside it.
  shells: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M4 20.5C3.6 15 6.6 11.5 10 11.5S16.4 15 16 20.5Z"/>
    <path d="M4 20.5C3.6 15 6.6 11.5 10 11.5S16.4 15 16 20.5"/>
    <path d="M10 20.5V12M7 20.5L7.6 13.2M13 20.5L12.4 13.2"/>
    <path d="M17 20.5C16.6 18.4 17.6 16.6 19.2 16.6C20.6 16.6 21.4 17.8 21 19C20.6 20 19.4 20 19.2 19.2C19 18.6 19.6 18.2 20 18.6"/>`,
  // Hermit crab: a spiral shell on the ground line, legs and one big claw reaching out of its mouth.
  hermitcrab: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M4 18C3.6 13.6 6.4 10 10.4 10C13.8 10 15.6 12.4 15.4 15.2C15.2 17.4 13.6 18.6 11.8 18.4Z"/>
    <path d="M4 18C3.6 13.6 6.4 10 10.4 10C13.8 10 15.6 12.4 15.4 15.2C15.2 17.4 13.6 18.6 11.8 18.4L4 18"/>
    <path d="M10.4 10C11.6 11.2 11.8 13 10.6 14C9.6 14.8 8.2 14.2 8.4 13"/>
    <path d="M14.6 17.4L16.6 20.5M13.4 18.2L14.4 20.5"/>
    <path d="M15.2 15.4C17 14.6 18.8 14.8 20 15.8C20.6 16.4 20.2 17.4 19.2 17.2C18.4 17 17.8 16.6 17.2 16.8"/>`,
  // Edible crab: a wide shell, two claws raised, legs splayed to the sides.
  ediblecrab: `
    <path ${ACCENT} d="M6 14.5C6 11.8 8.8 10.5 12 10.5S18 11.8 18 14.5C18 16.6 15.4 17.8 12 17.8S6 16.6 6 14.5Z"/>
    <path d="M6 14.5C6 11.8 8.8 10.5 12 10.5S18 11.8 18 14.5C18 16.6 15.4 17.8 12 17.8S6 16.6 6 14.5Z"/>
    <path d="M8.6 11.2L8 9.2C7.2 7.6 5.6 6.8 4.4 7.6C4 8.8 5 10 6.4 9.8M15.4 11.2L16 9.2C16.8 7.6 18.4 6.8 19.6 7.6C20 8.8 19 10 17.6 9.8"/>
    <path d="M6.4 15.4L3 16.4L2.4 18.6M6.8 16.6L4.2 19M17.6 15.4L21 16.4L21.6 18.6M17.2 16.6L19.8 19"/>
    <path d="M10.4 13.4V13.6M13.6 13.4V13.6"/>`,
  // Lugworm cast: a coil of sand on the ground line, and the small dip of the burrow's other end.
  lugworm: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M5 20.5C5 17.4 7.4 16 10 16S15 17.4 15 20.5Z"/>
    <path d="M5 20.5C5 18 7 16.6 9.6 16.6C12.2 16.6 13.8 18 13.8 19.6C13.8 18.4 12.4 17.6 10.6 17.6C8.6 17.6 7.6 18.6 7.6 19.6C7.6 18.8 8.8 18.4 9.8 18.6C11.2 18.8 11.8 19.6 11.6 20.5"/>
    <path d="M10 16.6C9.8 15.4 10.2 14.4 11 13.8"/>
    <path d="M17 20.5C17.6 19.6 18.8 19.4 19.6 20.5"/>`,
  // Acorn barnacles: three low cones of plates on the ground line, each with the notch of its
  // closed opening at the top.
  barnacles: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M3 20.5L4.4 17.4C4.5 17.1 4.7 17 5 17H5.4C5.7 17 5.9 17.1 6 17.4L7.4 20.5ZM7.6 20.5L10.2 13.2C10.3 12.8 10.6 12.6 11 12.6H13C13.4 12.6 13.7 12.8 13.8 13.2L16.4 20.5ZM16.8 20.5L18.2 17C18.3 16.7 18.5 16.6 18.8 16.6H19.4C19.7 16.6 19.9 16.7 20 17L21.2 20.5Z"/>
    <path d="M3 20.5L4.4 17.4C4.5 17.1 4.7 17 5 17H5.4C5.7 17 5.9 17.1 6 17.4L7.4 20.5"/>
    <path d="M7.6 20.5L10.2 13.2C10.3 12.8 10.6 12.6 11 12.6H13C13.4 12.6 13.7 12.8 13.8 13.2L16.4 20.5"/>
    <path d="M16.8 20.5L18.2 17C18.3 16.7 18.5 16.6 18.8 16.6H19.4C19.7 16.6 19.9 16.7 20 17L21.2 20.5"/>
    <path d="M11 12.6L12 13.8L13 12.6M11.2 15.4L10.4 20.5M12.8 15.4L13.6 20.5"/>`,
  // Pond skater: from above, a slim body, short front legs, four long legs splayed out, and the
  // ring each long foot dimples into the water.
  pondskaters: `
    <path ${ACCENT} d="M12 6.5C12.9 6.5 13.2 8 13.2 10.5V15C13.2 17 12.7 18.5 12 18.5S10.8 17 10.8 15V10.5C10.8 8 11.1 6.5 12 6.5Z"/>
    <path d="M12 6.5C12.9 6.5 13.2 8 13.2 10.5V15C13.2 17 12.7 18.5 12 18.5S10.8 17 10.8 15V10.5C10.8 8 11.1 6.5 12 6.5Z"/>
    <path d="M11.2 8L9.4 5.6M12.8 8L14.6 5.6"/>
    <path d="M10.9 10.6L6 8.2L3.8 6M13.1 10.6L18 8.2L20.2 6M10.9 13L6.4 17L4.6 19.6M13.1 13L17.6 17L19.4 19.6"/>
    <circle cx="3.4" cy="5.4" r="1.4"/>
    <circle cx="20.6" cy="5.4" r="1.4"/>
    <circle cx="4.2" cy="20.2" r="1.4"/>
    <circle cx="19.8" cy="20.2" r="1.4"/>`,
  // Common mussel: a long wedge of shell from the side, hinged at the narrow left end, the seam
  // between its two valves gaping a little at the wide end; growth lines on the upper valve.
  mussels: `
    <path ${ACCENT} d="M3 14.2C4.6 11.2 9.2 8.6 14.4 8.3C18.4 8.1 21 9.6 21 12C21 14.6 18 16.2 13.8 16.6C8.8 17.1 4.6 16.4 3 14.2Z"/>
    <path d="M3 14.2C4.6 11.2 9.2 8.6 14.4 8.3C18.4 8.1 21 9.6 21 12C21 14.6 18 16.2 13.8 16.6C8.8 17.1 4.6 16.4 3 14.2Z"/>
    <path d="M3 14.2C7.4 13.6 13.4 13.2 21 11.6"/>
    <path d="M9 10.8C9.6 11.8 10 12.7 10.2 13.4M13.6 9.6C14.3 10.6 14.8 11.6 15 12.8"/>
    <path d="M2.5 20.5H21.5"/>`,
  // Sand dollar: a round test from above, the five petals of its back around the middle.
  sanddollars: `
    <circle ${ACCENT} cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 10.4Q15 8.1 12 5.8Q9 8.1 12 10.4ZM13.5 11.5Q16.6 13.6 17.9 10.1Q14.8 7.9 13.5 11.5ZM12.9 13.3Q11.9 16.9 15.6 17Q16.7 13.4 12.9 13.3ZM11.1 13.3Q7.3 13.4 8.4 17Q12.1 16.9 11.1 13.3ZM10.5 11.5Q9.2 7.9 6.1 10.1Q7.4 13.6 10.5 11.5Z"/>`,
  // Fungi on logs (autumn): a log lying on the ground line, its end ring showing, two bracket
  // shelves stacked on its near end and a small capped mushroom standing on its top.
  fungi: `
    <rect ${ACCENT} x="2.5" y="15" width="19" height="5.5" rx="2.75"/>
    <rect x="2.5" y="15" width="19" height="5.5" rx="2.75"/>
    <circle cx="18.8" cy="17.75" r="1.1"/>
    <path d="M4.2 15C4.6 12.9 6.6 11.9 10.4 12.4C10 13.8 8.2 14.7 4.2 15Z"/>
    <path d="M4.8 11.8C5.1 10.2 6.8 9.4 9.4 9.8C9 10.9 7.8 11.6 4.8 11.8Z"/>
    <path ${ACCENT} d="M12.8 11.6C13 9.2 14.2 8.2 15.6 8.2S18.2 9.2 18.4 11.6Z"/>
    <path d="M12.8 11.6C13 9.2 14.2 8.2 15.6 8.2S18.2 9.2 18.4 11.6Z"/>
    <path d="M15.2 11.6L15 15M16.2 11.6L16.4 15"/>`,
  // Dewy orb web (autumn): spokes from a hub, two rounds of spiral between them, beads of dew on
  // the outer round.
  orbweb: `
    <path d="M12 11L20.5 11M12 11L18 5M12 11L12 2.5M12 11L6 5M12 11L3.5 11M12 11L6 17M12 11L12 19.5M12 11L18 17"/>
    <path d="M15.4 11L14.5 8.5L12 7.5L9.5 8.5L8.6 11L9.5 13.5L12 14.5L14.5 13.5Z"/>
    <path d="M18.2 11L16.4 6.6L12 4.8L7.6 6.6L5.8 11L7.6 15.4L12 17.2L16.4 15.4Z"/>
    <circle fill="currentColor" stroke="none" cx="14.2" cy="5.7" r="0.9"/>
    <circle fill="currentColor" stroke="none" cx="6.7" cy="8.8" r="0.9"/>
    <circle fill="currentColor" stroke="none" cx="17.3" cy="13.2" r="0.9"/>
    <circle fill="currentColor" stroke="none" cx="9.8" cy="16.3" r="0.9"/>
    <path d="M3 21.5C4 20 4.6 19 4.8 17.4M21 21.5C20 20 19.4 19 19.2 17.4"/>`,
  // Moon jelly: a low glassy bell from above, lying flat on the sand like the sand dollar, its
  // margin scalloped in eight shallow lobes and the four horseshoe rings showing through it.
  moonjelly: `
    <path ${ACCENT} d="M20.3 15.1Q19.3 18.6 15.4 19.5Q12 21.3 8.6 19.5Q4.7 18.6 3.7 15.1Q1.7 12 3.7 8.9Q4.7 5.4 8.6 4.5Q12 2.7 15.4 4.5Q19.3 5.4 20.3 8.9Q22.3 12 20.3 15.1Z"/>
    <path d="M20.3 15.1Q19.3 18.6 15.4 19.5Q12 21.3 8.6 19.5Q4.7 18.6 3.7 15.1Q1.7 12 3.7 8.9Q4.7 5.4 8.6 4.5Q12 2.7 15.4 4.5Q19.3 5.4 20.3 8.9Q22.3 12 20.3 15.1Z"/>
    <path d="M8.4 10.6A2 1.85 0 1 1 10.5 8.7M13.5 8.7A2 1.85 0 1 1 15.6 10.6M10.5 15.3A2 1.85 0 1 1 8.4 13.4M15.6 13.4A2 1.85 0 1 1 13.5 15.3"/>`,
  // Loose stone (a naturalist's reward, src/world/expansion.js): a stone tipped up on one side,
  // the dark gap under it where something might live.
  loosestone: `
    <path ${ACCENT} d="M4 18.5C4.4 13.4 8 9.6 12.6 9.4C16.8 9.2 19.8 11.8 20.2 15.6L12 18.5Z"/>
    <path d="M4 18.5C4.4 13.4 8 9.6 12.6 9.4C16.8 9.2 19.8 11.8 20.2 15.6"/>
    <path d="M4 18.5L20.2 15.6"/>
    <path fill="currentColor" stroke="none" opacity="0.55" d="M12.5 18.6L19.6 16.6C19.9 17.6 20 18.5 20 20.5H12.6Z"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M9.4 13.2C10.2 12.4 11.2 12 12.2 12"/>`,
  // Hand lens (a naturalist's reward): a round glass with a glint, on a short handle.
  lens: `
    <circle ${ACCENT} cx="10" cy="10" r="6.5"/>
    <circle cx="10" cy="10" r="6.5"/>
    <path d="M7 8.4C7.6 7.2 8.6 6.5 9.8 6.3"/>
    <path d="M14.8 14.8L16.2 16.2"/>
    <path d="M16.2 16.2L20.2 20.2A1.1 1.1 0 0 1 18.6 21.8L14.6 17.8A1.1 1.1 0 0 1 16.2 16.2Z"/>`,
  // Driftwood (a naturalist's reward): a bleached, bending branch lying at the water's edge, a
  // broken stub and a knot on it, a ripple beyond.
  driftwood: `
    <path ${ACCENT} d="M2.8 16.2C6.6 14.2 11.4 13.6 15.2 14.2C17.6 14.6 19.6 14.2 21.2 13.2L21.6 15.4C19.6 16.6 17.4 17 15 16.6C11.2 16 6.8 16.6 3.4 18.4Z"/>
    <path d="M2.8 16.2C6.6 14.2 11.4 13.6 15.2 14.2C17.6 14.6 19.6 14.2 21.2 13.2L21.6 15.4C19.6 16.6 17.4 17 15 16.6C11.2 16 6.8 16.6 3.4 18.4Z"/>
    <path d="M9.6 14.4L8.4 10.6L9.8 10.2"/>
    <circle cx="16" cy="15.4" r="0.6"/>
    <path d="M2.5 21C4.2 20.2 5.8 20.2 7.5 21S10.8 21.8 12.5 21"/>`,
  // Carry (src/world/pieces; yours once driftwood washes up): a log lifted off the ground line, an arrow up above it.
  carry: `
    <rect ${ACCENT} x="3.5" y="12" width="17" height="5" rx="2.5"/>
    <rect x="3.5" y="12" width="17" height="5" rx="2.5"/>
    <circle cx="18" cy="14.5" r="1"/>
    <path d="M12 3V9M9.4 5.6L12 3L14.6 5.6"/>
    <path d="M2.5 20.5H21.5"/>`,
  // Lift (L3a, src/world/pieces/lift.js; on foot): a log tipping up off the ground line from its far
  // end, the damp patch it lay on showing beneath, and a small arc where it rolls back.
  lift: `
    <rect ${ACCENT} x="4" y="11.5" width="15" height="4.6" rx="2.3" transform="rotate(-22 19 13.8)"/>
    <rect x="4" y="11.5" width="15" height="4.6" rx="2.3" transform="rotate(-22 19 13.8)"/>
    <path d="M5.5 18.2H15.5"/>
    <path d="M7.5 19.2H13"/>
    <path d="M4.2 8.4C4.8 6.2 6.6 4.8 8.8 4.6M7.2 3.4L8.8 4.6L7.6 6.2"/>
    <path d="M2.5 20.8H21.5"/>`,
  // The shelf (keepsakes, docs/future/12): a plank on two brackets holding a coiled shell, a pebble
  // and a feather leaning up.
  shelf: `
    <path d="M2.5 15.5H21.5"/>
    <path d="M5 15.5V18.5M19 15.5V18.5"/>
    <path ${ACCENT} d="M4.5 15.5C4.5 12.4 6.2 10.5 8.2 10.5C10.2 10.5 11.4 12.2 11.4 13.8C11.4 15 10.6 15.5 9.6 15.5Z"/>
    <path d="M4.5 15.5C4.5 12.4 6.2 10.5 8.2 10.5C10.2 10.5 11.4 12.2 11.4 13.8C11.4 15 10.6 15.5 9.6 15.5Z"/>
    <path d="M8.2 13.2C8.9 13.2 9.3 13.7 9.2 14.3"/>
    <path d="M12.8 15.5C12.8 14.2 13.8 13.4 15 13.4S17 14.2 17 15.5"/>
    <path d="M17.5 15.5C17.9 11.5 19 7.6 20.6 4.5"/>
    <path d="M18.4 11.2C19.6 10.4 20.4 9 20.6 7.4"/>`,
  // Trails (doc 13): a winding line of stops climbing the page, two inked, the next ahead open.
  trails: `
    <path d="M5 20.5C7.5 19 9.5 17.5 9.5 15S6.5 11.5 8 9.5S13 8.5 15.5 7S18 4.5 19 3.5" stroke-dasharray="0.1 3.2"/>
    <circle ${ACCENT} cx="5" cy="20.5" r="2"/><circle cx="5" cy="20.5" r="2"/>
    <circle ${ACCENT} cx="9.4" cy="14.5" r="2"/><circle cx="9.4" cy="14.5" r="2"/>
    <circle cx="17.6" cy="5" r="2.4"/>`,
  // The general net (docs/future/12, K6): two stakes, a sagging top cord and a mesh hanging from it,
  // a float in the middle, over one ripple line.
  // The fishing line on the ground bar (F17): a rod bending out over the water, its float on a ripple.
  line: `
    <path d="M3.5 20.5C7.4 15 12 9.6 18.6 3.5"/>
    <path d="M18.6 3.5C19.2 7.8 19 11.6 18.2 15"/>
    <circle ${ACCENT} cx="18.2" cy="16.4" r="1.7"/>
    <circle cx="18.2" cy="16.4" r="1.7"/>
    <path d="M13.6 19.4C15.4 18.4 19.6 18.4 21.4 19.4"/>
  `,
  // The angler's chart (F17): the Keeper book's Chart tab, a folded sea chart with a coast and a compass point.
  chart: `
    <path d="M3 6.5L8.5 4.5L15.5 6.5L21 4.5V17.5L15.5 19.5L8.5 17.5L3 19.5Z"/>
    <path d="M8.5 4.5V17.5M15.5 6.5V19.5"/>
    <path ${ACCENT} d="M5.5 13C6.5 11 9 10.6 10 12C10.8 13.2 9.4 15 7.4 14.8C6.2 14.7 5.2 14 5.5 13Z"/>
    <path d="M5.5 13C6.5 11 9 10.6 10 12C10.8 13.2 9.4 15 7.4 14.8C6.2 14.7 5.2 14 5.5 13Z"/>
    <path d="M18.3 8.2V12.6M16.6 10.4H20"/>
  `,
  // The chart's riddle marks (F17): the conditions a rare fish comes in, beside each riddle.
  'cond-night': `
    <path d="M15.5 4.5a7.5 7.5 0 1 0 4 12.6A6.2 6.2 0 0 1 15.5 4.5z"/>
  `,
  'cond-dawn': `
    <path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 6.5v2.5M5.2 9.6l1.7 1.7M18.8 9.6l-1.7 1.7"/>
  `,
  'cond-day': `
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>
  `,
  'cond-rain': `
    <path d="M7 14.5a4 4 0 0 1 .6-8 5 5 0 0 1 9.5 1.4 3.3 3.3 0 0 1-.6 6.6z"/>
    <path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>
  `,
  'cond-mist': `
    <path d="M3 8c3-2 6 2 9 0s6 2 9 0M3 12.5c3-2 6 2 9 0s6 2 9 0M3 17c3-2 6 2 9 0s6 2 9 0"/>
  `,
  'cond-storm': `
    <path d="M7 13.5a4 4 0 0 1 .6-8 5 5 0 0 1 9.5 1.4 3.3 3.3 0 0 1-.6 6.6"/>
    <path d="M12.5 12l-2.5 4.5h3.5l-2.5 4.5"/>
  `,
  'cond-low': `
    <path d="M3 9c3-2 6 2 9 0s6 2 9 0"/>
    <path d="M12 12v8M8.5 16.5L12 20l3.5-3.5"/>
  `,
  'cond-high': `
    <path d="M3 17c3-2 6 2 9 0s6 2 9 0"/>
    <path d="M12 13V5M8.5 8.5L12 5l3.5 3.5"/>
  `,
  'cond-sparkle': `
    <path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z"/>
  `,
  net: `
    <path d="M5 4V18.5M19 4V18.5"/>
    <path d="M5 6.5C9.5 8.5 14.5 8.5 19 6.5"/>
    <path d="M5 11C9.5 12.6 14.5 12.6 19 11M5 15C9.5 16.2 14.5 16.2 19 15"/>
    <path d="M9.6 8V16.4M14.4 8V16.4"/>
    <circle ${ACCENT} cx="12" cy="7.6" r="1.6"/>
    <circle cx="12" cy="7.6" r="1.6"/>
    <path d="M2.5 20.5C4 19.4 5.5 19.4 7 20.5S10 21.6 11.5 20.5S14.5 19.4 16 20.5S19 21.6 21.5 20.3"/>`,
  // A fish let go from the net (docs/future/12, K6): a slim fish side on, its tail forked.
  fish: `
    <path ${ACCENT} d="M3 12C5.5 8.6 10 7.6 14 9.2C15.4 9.8 16.6 10.6 17.6 11.4L21 8.5V15.5L17.6 12.6C16.6 13.4 15.4 14.2 14 14.8C10 16.4 5.5 15.4 3 12Z"/>
    <path d="M3 12C5.5 8.6 10 7.6 14 9.2C15.4 9.8 16.6 10.6 17.6 11.4L21 8.5V15.5L17.6 12.6C16.6 13.4 15.4 14.2 14 14.8C10 16.4 5.5 15.4 3 12Z"/>
    <path d="M9.5 8.6C10.2 7.2 11.6 6.4 13 6.6"/>
    <circle cx="6.6" cy="11.4" r="0.6"/>`,
  // A brown shrimp (docs/future/12, K6): an arched body ringed in segments, its tail fan tucked under, long feelers.
  shrimp: `
    <path ${ACCENT} d="M5.5 10.5C8.5 7.5 14 7.5 17 10.5C18.8 12.4 18.6 15.4 16.6 16.8L15.2 15.2C16.2 14.2 16.2 12.8 15.2 11.8C13 9.8 9.4 10 7 11.8Z"/>
    <path d="M5.5 10.5C8.5 7.5 14 7.5 17 10.5C18.8 12.4 18.6 15.4 16.6 16.8L15.2 15.2C16.2 14.2 16.2 12.8 15.2 11.8C13 9.8 9.4 10 7 11.8Z"/>
    <path d="M10 8.6L10.4 10.6M13 8.5L12.8 10.4M15.6 9.6L14.6 11.2"/>
    <path d="M16.6 16.8L18.4 18.6M16.6 16.8L15.4 19"/>
    <path d="M5.5 10.5C4 9 3 7 2.5 4.5M6 11C4.4 10.4 3.2 10.6 2.5 11.6"/>
    <path d="M8 12V14M10.5 11V13.4M13 11V13.2"/>`,
  // Let it go (a living catch from the net, docs/future/12): an arrow down into two ripple lines.
  release: `
    <path d="M12 3V11.5M8.8 8.5L12 11.7L15.2 8.5"/>
    <path d="M2.5 15.5C4 14.4 5.5 14.4 7 15.5S10 16.6 11.5 15.5S14.5 14.4 16 15.5S19 16.6 21.5 15.3"/>
    <path d="M2.5 19.5C4 18.4 5.5 18.4 7 19.5S10 20.6 11.5 19.5S14.5 18.4 16 19.5S19 20.6 21.5 19.3"/>`,
  // A picture saved (the shelf's picture, docs/future/12): a framed print with a hill and a sun,
  // and a short arrow down into a tray.
  picture: `
    <rect ${ACCENT} x="3.5" y="3.5" width="17" height="12" rx="1.5"/>
    <rect x="3.5" y="3.5" width="17" height="12" rx="1.5"/>
    <path d="M3.5 13L8.5 8.5L12 11.5L14.5 9.5L20.5 14"/>
    <circle cx="16.5" cy="7" r="1.3"/>
    <path d="M12 17.5V21M10 19.4L12 21.2L14 19.4"/>`,
  // A cairn (docs/future/14, the cairn builder): four flat stones stacked, smaller toward the top,
  // leaning a little to the right, on the ground line.
  cairn: `
    <path ${ACCENT} d="M5 20.5C5 18.6 7.6 17.6 11.6 17.6S18.6 18.6 18.6 20.5Z"/>
    <path d="M5 20.5C5 18.6 7.6 17.6 11.6 17.6S18.6 18.6 18.6 20.5"/>
    <path d="M6.8 17.6C6.8 15.9 9 15 12 15S17 15.9 17 17.6"/>
    <path d="M8.6 15C8.8 13.5 10.4 12.6 12.6 12.6S16 13.4 15.9 14.9"/>
    <path ${ACCENT} d="M10.4 12.6C10.6 11.1 11.8 10.3 13.4 10.4C14.8 10.5 15.4 11.4 15.2 12.7Z"/>
    <path d="M10.4 12.6C10.6 11.1 11.8 10.3 13.4 10.4C14.8 10.5 15.4 11.4 15.2 12.7"/>
    <path d="M14.6 7.5L16.2 5.9" opacity="0.7"/>
    <path d="M2.5 20.5H21.5"/>`,

  // The passing boat (docs/future/14): a small hull on a wave line, a short mast, and a lantern
  // hanging at the stern with a soft glow.
  'boat-lantern': `
    <path ${ACCENT} d="M3.5 15.5H18.5L16.6 18.5H6.2Z"/>
    <path d="M3.5 15.5H18.5L16.6 18.5H6.2Z"/>
    <path d="M10.5 15.5V5.5"/>
    <path d="M10.5 6.5L15.5 12.5H10.5"/>
    <path d="M5.5 15.5V11.5"/>
    <rect x="4.4" y="9" width="2.2" height="2.5" rx="0.6"/>
    <circle ${ACCENT} cx="5.5" cy="10.2" r="3"/>
    <path d="M2.5 21C4 20 5.5 20 7 21S10 22 11.5 21S14.5 20 16 21S19 22 21.5 21"/>`,

  // Stone, a Sculpt mode (docs/future/10): a rounded boulder resting on the ground, a smaller one against it, and a
  // short drop line above: set a stone here.
  stone: `
    <path ${ACCENT} d="M4.5 19.5C4.5 14.6 7.2 11.5 11 11.5C14.8 11.5 17 14.4 17 19.5Z"/>
    <path d="M4.5 19.5C4.5 14.6 7.2 11.5 11 11.5C14.8 11.5 17 14.4 17 19.5"/>
    <path d="M15.8 19.5C16 17.3 17.4 15.8 19 15.8C20.4 15.8 21.3 17.2 21.3 19.5"/>
    <path d="M8 15C8.8 13.9 9.9 13.4 11 13.4"/>
    <path d="M2.5 19.5H21.5"/>
    <path d="M11 3.5V8M8.8 6L11 8.2L13.2 6"/>`,

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
  // Curled pondweed (M2, the minnows' gift): two stems rising under the water line, narrow wavy
  // leaves along them.
  pondweed: `
    <path d="M2.5 5.5C4 4.5 5.5 6.5 7 5.5S10 4.5 11.5 5.5S14.5 6.5 16 5.5S19 4.5 21.5 5.5"/>
    <path d="M9 21.5C8.4 17 10.2 12.5 9.4 8.5M15 21.5C15.8 17.5 14.2 13 15.4 9.5"/>
    <path ${ACCENT} d="M9.3 17.5C7.2 16.9 5.6 15.6 5 14C7 14.3 8.6 15.4 9.3 17.5Z"/>
    <path d="M9.3 17.5C7.2 16.9 5.6 15.6 5 14C7 14.3 8.6 15.4 9.3 17.5Z"/>
    <path d="M9.6 12.5C11.4 11.6 12.4 10.2 12.6 8.6C11 9.4 10 10.8 9.6 12.5Z"/>
    <path ${ACCENT} d="M15.2 16C17.3 15.6 18.9 14.4 19.6 12.8C17.6 13 16 14 15.2 16Z"/>
    <path d="M15.2 16C17.3 15.6 18.9 14.4 19.6 12.8C17.6 13 16 14 15.2 16Z"/>
    <path d="M14.8 12C13 11.2 12 9.9 11.8 8.4"/>`,
  // Southern hawker (M2): a dragonfly from above, its long body down the middle, four wings out.
  dragonfly: `
    <path ${ACCENT} d="M11.4 8.6C8.4 6.2 4.6 5.6 2.8 6.6C3.4 8.6 7.6 9.6 11.4 9.4Z"/>
    <path ${ACCENT} d="M12.6 8.6C15.6 6.2 19.4 5.6 21.2 6.6C20.6 8.6 16.4 9.6 12.6 9.4Z"/>
    <path d="M11.4 8.6C8.4 6.2 4.6 5.6 2.8 6.6C3.4 8.6 7.6 9.6 11.4 9.4M12.6 8.6C15.6 6.2 19.4 5.6 21.2 6.6C20.6 8.6 16.4 9.6 12.6 9.4"/>
    <path d="M11.4 10.4C8.6 10.8 5 12.2 3.6 13.6C5.2 14.6 9 13 11.4 11.4M12.6 10.4C15.4 10.8 19 12.2 20.4 13.6C18.8 14.6 15 13 12.6 11.4"/>
    <circle cx="12" cy="5.6" r="1.4"/>
    <path d="M12 7V21.5"/>
    <path d="M11 8.2C11 7.4 13 7.4 13 8.2V11.6C13 12.4 11 12.4 11 11.6Z"/>`,
  // Azure damselfly (M2 season marker): from the side, resting on a reed stem, its slim banded body
  // level and its wings folded back together over it.
  damselfly: `
    <path d="M19.8 21.5C19.4 15 19.6 8.5 20.4 2.5"/>
    <path ${ACCENT} d="M14.4 10.4C11.6 8.2 7.4 7.6 5.4 8.4C7 9.6 11 10.4 14.4 10.4Z"/>
    <path d="M14.4 10.4C11.6 8.2 7.4 7.6 5.4 8.4C7 9.6 11 10.4 14.4 10.4"/>
    <circle cx="17.2" cy="11.6" r="1.3"/>
    <path d="M13 11.4C13 10.6 15.6 10.6 15.6 11.6C15.6 12.6 13 12.8 13 12Z"/>
    <path d="M13 11.9H2.5"/>
    <path d="M5 11V12.8M7.6 11V12.8M10.2 11V12.8"/>
    <path d="M14 12.6L16 15.2L19.5 15.6"/>`,
  // European pond turtle (M2): from the side, basking on a stone's flat top, its domed shell
  // marked in plates, head raised toward the sun.
  turtle: `
    <path ${ACCENT} d="M4 15.5C4.5 11 8 8.5 12 8.5S19 11 19.5 15.5Z"/>
    <path d="M4 15.5C4.5 11 8 8.5 12 8.5S19 11 19.5 15.5Z"/>
    <path d="M3 15.5H18.5"/>
    <path d="M18.6 13.4C19.4 11.9 21.2 11.8 21.6 13.1C21.9 14.1 21 14.8 19.4 14.8"/>
    <circle cx="20.6" cy="12.9" r="0.55" fill="currentColor" stroke="none"/>
    <path d="M7 15.5L6.3 17.8M16.4 15.5L17.1 17.8"/>
    <path d="M8.6 11.2L10.2 13.2M12 8.5V12.4M15.4 11.2L13.8 13.2"/>
    <path d="M2.5 20.5H21.5"/>`,
  // The feral hen (docs/future/15): from the side, standing on the ground, a small comb and beak,
  // her short tail raised behind, the wing folded along her flank.
  hen: `
    <path ${ACCENT} d="M15.5 8.6C17.6 9.6 18.6 11.4 18 13.4C17.2 16 14.6 17.2 11.6 17.2C8.4 17.2 6 15.6 5.6 12.8L4 6.8C5.8 7.4 7.6 9 8.6 10.4C10.6 10.8 13 10.4 14.6 8.2Z"/>
    <path d="M15.5 8.6C17.6 9.6 18.6 11.4 18 13.4C17.2 16 14.6 17.2 11.6 17.2C8.4 17.2 6 15.6 5.6 12.8L4 6.8C5.8 7.4 7.6 9 8.6 10.4C10.6 10.8 13 10.4 14.6 8.2"/>
    <circle cx="16.8" cy="6.8" r="1.9"/>
    <path d="M15.6 5.2C15.6 4.2 16.5 3.9 16.9 4.6C17.3 3.9 18.3 4.1 18.2 5.1"/>
    <path d="M18.6 6.3L20.6 7.1L18.6 7.8"/>
    <circle cx="17.3" cy="6.5" r="0.55" fill="currentColor" stroke="none"/>
    <path d="M8.8 12.6C10.8 14.6 13.6 14.6 15.4 12.6"/>
    <path d="M10.5 17.2L10 20.5M13.5 17L14 20.5"/>
    <path d="M2.5 20.5H21.5"/>`,
  // A hen's feather (the hen's gift, docs/future/15): one curved tail feather lying corner to
  // corner, its quill running through the vane and a few barbs drawn off it.
  feather: `
    <path ${ACCENT} d="M6.5 17.5C6 12.5 9.5 6.5 19.5 4.5C18.5 13 13 17.5 6.5 17.5Z"/>
    <path d="M6.5 17.5C6 12.5 9.5 6.5 19.5 4.5C18.5 13 13 17.5 6.5 17.5Z"/>
    <path d="M3.5 20.5C8 16 13 10.5 19.5 4.5"/>
    <path d="M9.5 14.8L8.3 11.6M12.4 11.8L11.8 8.4M10.8 13.5L13.6 15.4M13.8 10.4L16.6 11.8"/>`,
  // Common toad (spring marker): squat and low on the ground, walking, its back dotted with warts.
  toad: `
    <path ${ACCENT} d="M3.5 18C3.8 14.4 7.2 12.2 11.5 12C12.4 10.4 15 10.2 16.2 11.6C18.6 12 20.5 13.4 20.5 15C20.5 16.6 18.8 17.4 16.6 17.6L15 18Z"/>
    <path d="M3.5 18C3.8 14.4 7.2 12.2 11.5 12C12.4 10.4 15 10.2 16.2 11.6C18.6 12 20.5 13.4 20.5 15C20.5 16.6 18.8 17.4 16.6 17.6L15 18Z"/>
    <circle cx="14.4" cy="11.9" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="7.4" cy="15" r="0.55" fill="currentColor" stroke="none"/>
    <circle cx="10" cy="14.2" r="0.55" fill="currentColor" stroke="none"/>
    <circle cx="9.2" cy="16.4" r="0.55" fill="currentColor" stroke="none"/>
    <path d="M5.6 18L4.8 20.5M14 18L14.8 20.5"/>
    <path d="M2.5 20.5H21.5"/>`,
  // Frogspawn (spring marker): jelly eggs in a clump just under the water line, a dark egg in each.
  frogspawn: `
    <path d="M2.5 8C4.2 7.2 5.8 7.2 7.5 8S10.8 8.8 12.5 8S15.8 7.2 17.5 8S20 8.6 21.5 8"/>
    <circle ${ACCENT} cx="8" cy="12.5" r="2.4"/><circle cx="8" cy="12.5" r="2.4"/>
    <circle ${ACCENT} cx="12.5" cy="11.6" r="2.4"/><circle cx="12.5" cy="11.6" r="2.4"/>
    <circle ${ACCENT} cx="17" cy="12.5" r="2.4"/><circle cx="17" cy="12.5" r="2.4"/>
    <circle ${ACCENT} cx="10.2" cy="16.4" r="2.4"/><circle cx="10.2" cy="16.4" r="2.4"/>
    <circle ${ACCENT} cx="14.8" cy="16.4" r="2.4"/><circle cx="14.8" cy="16.4" r="2.4"/>
    <circle cx="8" cy="12.5" r="0.7" fill="currentColor" stroke="none"/>
    <circle cx="12.5" cy="11.6" r="0.7" fill="currentColor" stroke="none"/>
    <circle cx="17" cy="12.5" r="0.7" fill="currentColor" stroke="none"/>
    <circle cx="10.2" cy="16.4" r="0.7" fill="currentColor" stroke="none"/>
    <circle cx="14.8" cy="16.4" r="0.7" fill="currentColor" stroke="none"/>`,
  // Slow worm (a find by the logs): a long smooth body in a gentle S on the ground line, beside a log end.
  slowworm: `
    <circle ${ACCENT} cx="19" cy="15.5" r="2.8"/>
    <circle cx="19" cy="15.5" r="2.8"/>
    <circle cx="19" cy="15.5" r="0.9"/>
    <path d="M3 17.5C5.5 14.5 8.5 14.5 10.5 16.5S15 18.5 16.5 16.8"/>
    <path d="M3.4 18.6C6 15.8 8.4 15.8 10.2 17.6S14.6 19.8 16.2 18.2"/>
    <circle cx="4.6" cy="17" r="0.5" fill="currentColor" stroke="none"/>
    <path d="M2.5 20.5H21.5"/>`,
  // Common lizard (a summer find on stones): from above, flat on a stone, legs splayed, tail curling.
  lizard: `
    <path ${ACCENT} d="M4.5 19C6 16.6 18 16.6 19.5 19Z"/>
    <path d="M4.5 19C6 16.6 18 16.6 19.5 19H4.5Z"/>
    <path d="M12 3.5C13.4 3.5 13.8 5 13.6 6.4L13.4 12.2C13.2 13.6 10.8 13.6 10.6 12.2L10.4 6.4C10.2 5 10.6 3.5 12 3.5Z"/>
    <path d="M12 13.4C12 15 12.6 16 14 16.4"/>
    <path d="M10.6 7.4L8.4 6.4M13.4 7.4L15.6 6.4M10.8 11.2L8.6 12.6M13.2 11.2L15.4 12.6"/>`,
  // Woodlice (L3a, under a kept log): from above, a domed oval of banded plates, two long antennae
  // and the short legs along its sides.
  woodlice: `
    <path ${ACCENT} d="M12 4.6C15 4.6 16.6 8.2 16.6 12.4C16.6 16.8 14.6 19.6 12 19.6S7.4 16.8 7.4 12.4C7.4 8.2 9 4.6 12 4.6Z"/>
    <path d="M12 4.6C15 4.6 16.6 8.2 16.6 12.4C16.6 16.8 14.6 19.6 12 19.6S7.4 16.8 7.4 12.4C7.4 8.2 9 4.6 12 4.6Z"/>
    <path d="M8 9H16M7.5 12H16.5M7.7 15H16.3"/>
    <path d="M10.8 4.9C9.8 3.4 8.4 2.6 6.6 2.4M13.2 4.9C14.2 3.4 15.6 2.6 17.4 2.4"/>
    <path d="M7.6 10.4L5.6 9.8M7.5 13.6L5.4 13.8M8 16.6L6.2 17.6M16.4 10.4L18.4 9.8M16.5 13.6L18.6 13.8M16 16.6L17.8 17.6"/>`,
  // Violet ground beetle (L3a, under a kept log on grass): from above, long oval wing cases split down
  // the middle, a narrower shield and head, six long running legs.
  groundbeetle: `
    <path ${ACCENT} d="M12 9.6C14.8 9.6 16.2 12.4 16.2 15.4C16.2 18.6 14.4 21 12 21S7.8 18.6 7.8 15.4C7.8 12.4 9.2 9.6 12 9.6Z"/>
    <path d="M12 9.6C14.8 9.6 16.2 12.4 16.2 15.4C16.2 18.6 14.4 21 12 21S7.8 18.6 7.8 15.4C7.8 12.4 9.2 9.6 12 9.6Z"/>
    <path d="M12 9.8V20.8"/>
    <path d="M9.6 6.2H14.4L15 9.4H9Z"/>
    <path d="M10.6 6.2C10.6 4.8 13.4 4.8 13.4 6.2"/>
    <path d="M11.2 4.6C10.4 3 9.2 2.2 7.6 2M12.8 4.6C13.6 3 14.8 2.2 16.4 2"/>
    <path d="M9.4 8.2L6.4 6.6L5.2 4.8M14.6 8.2L17.6 6.6L18.8 4.8M8.2 13L5 13.4L3.6 15M15.8 13L19 13.4L20.4 15M8.4 17L5.6 19L5 21M15.6 17L18.4 19L19 21"/>`,
  // The floating reed raft (the turtles' gift): a low mat of reeds on the water, stems standing up.
  raft: `
    <path ${ACCENT} d="M3.5 16C5 14.6 19 14.6 20.5 16C19 17.4 5 17.4 3.5 16Z"/>
    <path d="M3.5 16C5 14.6 19 14.6 20.5 16C19 17.4 5 17.4 3.5 16Z"/>
    <path d="M7 15V8M9.5 15V5.5M15 15V7M17 15V9.5"/>
    <path d="M2.5 20C4.2 19.2 5.8 19.2 7.5 20S10.8 20.8 12.5 20S15.8 19.2 17.5 20S20 20.6 21.5 20"/>`,
  // Minnows (M2): a small fish under the water line, a ring above where one rose.
  minnow: `
    <path d="M2.5 7.5C4 6.5 5.5 8.5 7 7.5S10 6.5 11.5 7.5M15 7.5H21.5"/>
    <path d="M10.6 5.6C11.6 4.9 14.4 4.9 15.4 5.6"/>
    <path ${ACCENT} d="M3.5 15C6 11.8 11 11.4 15 14.2L19.8 11.6V18.4L15 15.8C11 18.6 6 18.2 3.5 15Z"/>
    <path d="M3.5 15C6 11.8 11 11.4 15 14.2L19.8 11.6V18.4L15 15.8C11 18.6 6 18.2 3.5 15Z"/>
    <circle cx="6.9" cy="14.3" r="0.9" fill="currentColor" stroke="none"/>
    <path d="M10.5 13.4C11.2 14.4 11.2 15.6 10.5 16.6"/>`,

  // The Web's shore features (journal-web.json). Rock pool: water held between two rocks.
  pool: `
    <path d="M2.5 19.5H21.5"/>
    <path ${ACCENT} d="M3 19.5L4.5 13L8 11.5L9.8 15.5L8.8 19.5Z"/>
    <path d="M3 19.5L4.5 13L8 11.5L9.8 15.5L8.8 19.5"/>
    <path ${ACCENT} d="M21 19.5L19.5 12.5L16 11.5L14.2 15.5L15.2 19.5Z"/>
    <path d="M21 19.5L19.5 12.5L16 11.5L14.2 15.5L15.2 19.5"/>
    <path ${ACCENT} d="M9.8 15.5C11.2 16.2 12.8 16.2 14.2 15.5L15.2 19.5H8.8Z"/>
    <path d="M9.8 15.5C11.2 16.2 12.8 16.2 14.2 15.5"/>
    <path d="M11 17.8H13"/>`,
  // Strandline: a line of torn litter along the shore, the sea below it.
  strandline: `
    <path d="M3 15.5C6 14 9 14 12 15S18 16 21 14.5"/>
    <path d="M3 20C5 18.8 7 18.8 9 20S13 21.2 15 20S19 18.8 21 20"/>
    <path d="M4 11.5L6.2 10.6M8 11.2L10.6 11.4M12.4 10.2L13.8 11.8M15.8 11.2L18.4 10.6M19.6 12L21 11.2"/>
    <circle cx="11" cy="9" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="17" cy="13" r="0.8" fill="currentColor" stroke="none"/>`,
  // Wrack: a bladderwrack frond forking twice, paired bladders on its straps.
  wrack: `
    <path d="M2.5 20.5H21.5"/>
    <path d="M12 20.5V14.5C12 11.5 9.5 10 8 7M12 14.5C12 11.5 14.5 10 16 7M8 7L6.6 3.8M8 7L9.8 4M16 7L14.2 4M16 7L17.4 3.8"/>
    <circle ${ACCENT} cx="9.6" cy="10.4" r="1.2"/>
    <circle cx="9.6" cy="10.4" r="1.2"/>
    <circle ${ACCENT} cx="14.4" cy="10.4" r="1.2"/>
    <circle cx="14.4" cy="10.4" r="1.2"/>
    <circle cx="12" cy="17.2" r="1.1"/>`,
  // Kelp: two broad blades with a midrib, lying downslope from a holdfast.
  kelp: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M5 19C9 14 15 12 21 12.5C16 15 10 17.5 5 19Z"/>
    <path d="M5 19C9 14 15 12 21 12.5C16 15 10 17.5 5 19Z"/>
    <path d="M5 19C11 15.6 16 13.6 21 12.5"/>
    <path d="M5 19C7.5 11 11.5 6.5 17 4.5C14 9 10 14 5 19Z"/>
    <path d="M3.5 20.5C3.8 19.4 4.4 19 5 19C5.6 19 6.2 19.4 6.5 20.5"/>`,
  // Black lichen: crust patches on a splash rock, a little spray above.
  lichen: `
    <path ${ACCENT} d="M3.5 19.5L6 12.5L12 10L18 12L20.5 19.5Z"/>
    <path d="M3.5 19.5L6 12.5L12 10L18 12L20.5 19.5Z"/>
    <circle cx="8.2" cy="14.4" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="11.6" cy="12.8" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="13.4" r="1.3" fill="currentColor" stroke="none"/>
    <circle cx="10.4" cy="16.8" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="16.8" cy="16.4" r="0.9" fill="currentColor" stroke="none"/>
    <path d="M8 6.5L8.6 5.2M12 5.5V4M16 6.5L15.4 5.2"/>`,
  // Rippled sand: short wave ripples left in the sand, the sea's edge above.
  ripples: `
    <path d="M3 6.5C5 5.3 7 5.3 9 6.5S13 7.7 15 6.5S19 5.3 21 6.5"/>
    <path d="M3 12.5C4.8 11 6.4 11 8 12.5M10 12.5C11.8 11 13.4 11 15 12.5M17 12.5C18.4 11.3 19.6 11.3 21 12.5"/>
    <path d="M4.5 18C6.3 16.5 7.9 16.5 9.5 18M11.5 18C13.3 16.5 14.9 16.5 16.5 18"/>`,
  // Wet sand: firm sand with a sheen, a drop above it.
  wetsand: `
    <path ${ACCENT} d="M2.5 20.5V15.5C8 13.5 16 13.5 21.5 15.5V20.5Z"/>
    <path d="M2.5 15.5C8 13.5 16 13.5 21.5 15.5"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M6 17.8H9.5M12.5 18.2H17"/>
    <path d="M12 3.5C11 5 10 6.2 10 7.3A2 2 0 0 0 14 7.3C14 6.2 13 5 12 3.5Z"/>`,
  // Tidal mud: soft wavy ground that shines, two bubbles rising from it.
  mud: `
    <path ${ACCENT} d="M2.5 20.5V15C5 13.8 7 15.6 9.5 14.6S14 13.6 16.5 14.8S20 15.2 21.5 14.4V20.5Z"/>
    <path d="M2.5 15C5 13.8 7 15.6 9.5 14.6S14 13.6 16.5 14.8S20 15.2 21.5 14.4"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M5 17.6H8M13 18H16.5"/>
    <circle cx="8.5" cy="10.5" r="1.3"/>
    <circle cx="14.5" cy="9" r="0.9"/>`,
  // You: a simple figure, head and shoulders: you, in the Web.
  you: `
    <circle ${ACCENT} cx="12" cy="7.5" r="3.5"/>
    <circle cx="12" cy="7.5" r="3.5"/>
    <path ${ACCENT} d="M4.5 20.5C4.5 15.8 7.8 13.5 12 13.5S19.5 15.8 19.5 20.5Z"/>
    <path d="M4.5 20.5C4.5 15.8 7.8 13.5 12 13.5S19.5 15.8 19.5 20.5"/>`,

  // A living thing not seen yet: a pencil circle, drawn in short dashes.
  unknown: `
    <circle cx="12" cy="12" r="8" stroke-dasharray="2.4 3"/>`,

  // Close: two crossing strokes.
  close: `
    <path d="M6.5 6.5L17.5 17.5"/>
    <path d="M17.5 6.5L6.5 17.5"/>`,

  // Note: a single eighth note, its head lightly filled (the now-playing line, a piece of music).
  note: `
    <ellipse ${ACCENT} cx="9" cy="17" rx="3.2" ry="2.5" transform="rotate(-20 9 17)"/>
    <ellipse cx="9" cy="17" rx="3.2" ry="2.5" transform="rotate(-20 9 17)"/>
    <path d="M12 16.2V4.5"/>
    <path d="M12 4.5C13.5 6.8 17 7.4 17 11"/>`,

  // Notes: two eighth notes beamed together (the other side of the now-playing line).
  notes2: `
    <ellipse ${ACCENT} cx="7" cy="17.5" rx="2.8" ry="2.2" transform="rotate(-20 7 17.5)"/>
    <ellipse ${ACCENT} cx="16" cy="15.5" rx="2.8" ry="2.2" transform="rotate(-20 16 15.5)"/>
    <ellipse cx="7" cy="17.5" rx="2.8" ry="2.2" transform="rotate(-20 7 17.5)"/>
    <ellipse cx="16" cy="15.5" rx="2.8" ry="2.2" transform="rotate(-20 16 15.5)"/>
    <path d="M9.6 16.8V6.5L18.6 4.5V14.8"/>
    <path d="M9.6 9.2L18.6 7.2"/>`,

  // Heart: a soft rounded heart, for the pieces of music you love (doc 24, hearted pieces).
  heart: `
    <path ${ACCENT} d="M12 19.5C12 19.5 4.5 15 4.5 9.6A3.9 3.9 0 0 1 12 7.6A3.9 3.9 0 0 1 19.5 9.6C19.5 15 12 19.5 12 19.5Z"/>
    <path d="M12 19.5C12 19.5 4.5 15 4.5 9.6A3.9 3.9 0 0 1 12 7.6A3.9 3.9 0 0 1 19.5 9.6C19.5 15 12 19.5 12 19.5Z"/>`,

  // Not for me: a thumb pointing down (the cuff on the left, the fist above, the thumb below), for a
  // piece of music you would rather not hear.
  pass: `
    <path ${ACCENT} d="M3.5 4.5H7V13H3.5Z"/>
    <path d="M3.5 4.5H7V13H3.5Z"/>
    <path d="M7 12.5L10.6 19.2A1.6 1.6 0 0 0 13.6 18.4V14.5H18.4A2 2 0 0 0 20.4 12.2L19.3 6.3A2.2 2.2 0 0 0 17.1 4.5H7"/>`,

  // Heart, filled: a piece you have hearted.
  'heart-full': `
    <path fill="currentColor" stroke="none" d="M12 19.5C12 19.5 4.5 15 4.5 9.6A3.9 3.9 0 0 1 12 7.6A3.9 3.9 0 0 1 19.5 9.6C19.5 15 12 19.5 12 19.5Z"/>
    <path d="M12 19.5C12 19.5 4.5 15 4.5 9.6A3.9 3.9 0 0 1 12 7.6A3.9 3.9 0 0 1 19.5 9.6C19.5 15 12 19.5 12 19.5Z"/>`,

  // Back: a chevron pointing left.
  back: `
    <path d="M14.5 5.5L8 12L14.5 18.5"/>`,

  // A chevron pointing up; CSS turns it over to point down (folds in the journal).
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

  // A level shelf raised on a sheer face, rock bands on the face, an up stroke over the shelf.
  terrace: `
    <path ${ACCENT} d="M8.5 20V11.5H15.5C17.5 14.5 19 20 21.5 20Z"/>
    <path d="M2.5 20H8.5V11.5H15.5C17.5 14.5 19 20 21.5 20"/>
    <path d="M10.3 14.6H12.6M10.3 17.4H13.6"/>
    <path d="M12 9V3.5M9.8 5.7L12 3.5L14.2 5.7"/>`,

  // A notch carved down into the ground, sheer walls, the cut-away top dotted, a down stroke in it.
  cut: `
    <path ${ACCENT} d="M2.5 11H7V19H17V11H21.5V21.5H2.5Z"/>
    <path d="M2.5 11H7V19H17V11H21.5"/>
    <path d="M7 11H17" stroke-dasharray="0.01 2.9" opacity="0.7"/>
    <path d="M12 3.5V9M9.8 6.8L12 9L14.2 6.8"/>`,

  // Steps (the shaper's trail): a flight cut down from a shelf to the ground, an up stroke beside it.
  steps: `
    <path ${ACCENT} d="M2.5 20V8.5H8V12H11.5V15.5H15V19H21.5V20Z"/>
    <path d="M2.5 8.5H8V12H11.5V15.5H15V19H21.5"/>
    <path d="M17.5 13V4.5M15.3 6.7L17.5 4.5L19.7 6.7"/>`,

  // Pond stones (the shaper's trail): three flat stones in a line across a ripple of water.
  pondstones: `
    <path ${ACCENT} d="M2.5 15.5C3.4 13.8 5.2 13.2 6.8 13.6C7.9 13.9 8.2 15 7.4 15.5Z"/>
    <path ${ACCENT} d="M9 13.5C10 11.6 12.4 11 14.2 11.6C15.4 12 15.6 13.1 14.8 13.5Z"/>
    <path ${ACCENT} d="M16.5 11.5C17.4 9.8 19.4 9.3 20.8 9.8C21.7 10.2 21.7 11.1 21 11.5Z"/>
    <path d="M2.5 15.5C3.4 13.8 5.2 13.2 6.8 13.6C7.9 13.9 8.2 15 7.4 15.5Z"/>
    <path d="M9 13.5C10 11.6 12.4 11 14.2 11.6C15.4 12 15.6 13.1 14.8 13.5Z"/>
    <path d="M16.5 11.5C17.4 9.8 19.4 9.3 20.8 9.8C21.7 10.2 21.7 11.1 21 11.5Z"/>
    <path d="M2.5 19.5C4 18.3 5.5 18.3 7 19.5S10 20.7 11.5 19.5S14.5 18.3 16 19.5S19 20.7 21.5 19.5"/>`,

  // Reed raft (the turtles' gift): a mat of bundled reeds tied with two bands, afloat on a ripple.
  raft: `
    <rect ${ACCENT} x="3.5" y="9.5" width="17" height="6" rx="3"/>
    <rect x="3.5" y="9.5" width="17" height="6" rx="3"/>
    <path d="M4 12.5H20"/>
    <path d="M9 9.5V15.5M15 9.5V15.5"/>
    <path d="M2.5 19.5C4 18.3 5.5 18.3 7 19.5S10 20.7 11.5 19.5S14.5 18.3 16 19.5S19 20.7 21.5 19.5"/>`,

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

  // Go down (the walker): a small standing figure on the ground, a down stroke beside it.
  'go-down': `
    <path ${ACCENT} d="M13.5 10.6L11.4 17.6H18.6L16.5 10.6Z"/>
    <path d="M13.5 10.6L11.4 17.6H18.6L16.5 10.6"/>
    <path d="M17.6 7.3C16.6 4.8 14.6 2.8 11.8 2.2C12.6 3.8 12.8 5.6 12.6 7.3"/>
    <path d="M9.4 7.7C11.6 6.5 18.4 6.5 20.6 7.7"/>
    <path d="M12.9 7.6A2.1 2.1 0 0 0 17.1 7.6Z" fill="currentColor"/>
    <path d="M13.8 17.6V20.2H12.6M16.2 17.6V20.2H17.4"/>
    <path d="M5 3.5V12.5"/>
    <path d="M2.6 10.1L5 12.5L7.4 10.1"/>`,

  // Go up (back to the view above): the island seen from high, an up stroke rising off it.
  'go-up': `
    <ellipse ${ACCENT} cx="12" cy="17.5" rx="8.5" ry="3.5"/>
    <ellipse cx="12" cy="17.5" rx="8.5" ry="3.5"/>
    <path d="M9 17.6C10 16.6 14 16.6 15 17.6"/>
    <path d="M12 13V3.5"/>
    <path d="M9.6 5.9L12 3.5L14.4 5.9"/>`,

  // Sit (the walker): a small figure sitting on a low stone, knees bent.
  sit: `
    <rect ${ACCENT} x="2.8" y="15.4" width="7.4" height="5.1" rx="1.8"/>
    <rect x="2.8" y="15.4" width="7.4" height="5.1" rx="1.8"/>
    <circle ${ACCENT} cx="5.4" cy="12.9" r="1.3"/>
    <circle cx="5.4" cy="12.9" r="1.3"/>
    <path ${ACCENT} d="M7.8 10.4L6.8 15.4H13.6L10 10.4Z"/>
    <path d="M7.8 10.4L6.8 15.4H13.6L10 10.4"/>
    <path d="M13 15.4V20.2H14.9"/>
    <path d="M7 7.9A2 2 0 0 0 11 7.9Z" fill="currentColor"/>
    <path d="M4.6 7.7C6.6 6.6 11.4 6.6 13.4 7.7"/>
    <path d="M7 7.2C7 4.9 6.2 3.1 4.6 2.1C7.6 2.3 9.8 4.3 11 7.2"/>`,

  // Kneel (the walker): a small figure down on one knee, the other foot planted.
  kneel: `
    <circle ${ACCENT} cx="6.1" cy="11.6" r="1.3"/>
    <circle cx="6.1" cy="11.6" r="1.3"/>
    <path ${ACCENT} d="M8.6 9L7.4 14.6H12.4L10.8 9Z"/>
    <path d="M8.6 9L7.4 14.6H12.4L10.8 9"/>
    <path d="M8.8 14.6L9.6 20.4H5.2"/>
    <path d="M11.4 14.6L14.2 15.2V20.3H16"/>
    <path d="M10.6 11L14.4 12.6"/>
    <path d="M8.2 6.7A2 2 0 0 0 12.2 6.7Z" fill="currentColor"/>
    <path d="M5.8 6.5C7.8 5.4 12.6 5.4 14.6 6.5"/>
    <path d="M8.2 6C8 4.3 7.4 3.1 6 2.3C8.8 2.7 11 4.1 12.2 6"/>`,

  // I'm stuck (the walker): a ring of ground with a gap in it, and a way out through the gap.
  stuck: `
    <path ${ACCENT} d="M12 7.5A4.5 4.5 0 1 1 7.5 12A4.5 4.5 0 0 1 12 7.5Z"/>
    <path d="M17.7 15.5A7 7 0 1 1 18.6 9.6"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
    <path d="M14 10L20.5 4"/>
    <path d="M16.5 4H20.5V8"/>`,

  // The seed tin (D1a, on the walker's bar): a round tin, its lid tipped up on one side, three
  // seeds falling from the gap.
  'seed-tin': `
    <path ${ACCENT} d="M4.5 11.5V18.6C4.5 19.9 7.9 20.8 12 20.8S19.5 19.9 19.5 18.6V11.5Z"/>
    <path d="M4.5 11.5V18.6C4.5 19.9 7.9 20.8 12 20.8S19.5 19.9 19.5 18.6V11.5"/>
    <ellipse cx="12" cy="11.5" rx="7.5" ry="1.9"/>
    <path d="M4.2 9.6L17.6 4.6"/>
    <path d="M4.2 9.6L4.6 11"/>
    <path d="M4.5 15.4C8.6 16.8 15.4 16.8 19.5 15.4" opacity="0.7"/>
    <ellipse cx="19.4" cy="6.2" rx="0.8" ry="1.1" fill="currentColor" stroke="none"/>
    <ellipse cx="21" cy="8.6" rx="0.8" ry="1.1" fill="currentColor" stroke="none"/>
    <ellipse cx="17.6" cy="8.4" rx="0.8" ry="1.1" fill="currentColor" stroke="none"/>`,

  // The gift spot (D1a, on the walker's bar): a bundle wrapped in a broad leaf, tied with twine in
  // a loop, resting on a ground line.
  'gift-spot': `
    <path ${ACCENT} d="M5 19.5C4.3 15.2 6.6 10.6 12 10.6S19.7 15.2 19 19.5Z"/>
    <path d="M5 19.5C4.3 15.2 6.6 10.6 12 10.6S19.7 15.2 19 19.5"/>
    <path d="M12 10.6C10.8 13.4 10.6 16.6 11.4 19.5" opacity="0.7"/>
    <path d="M6.2 14.4C9.8 15.6 14.2 15.6 17.8 14.4"/>
    <path d="M12 10.6C10 8.4 8.2 7.4 7.4 8.4S8.6 10.8 12 10.6Z"/>
    <path d="M12 10.6C14 8.4 15.8 7.4 16.6 8.4S15.4 10.8 12 10.6Z"/>
    <path d="M12 10.6L11 5.2M12 10.6L13.4 5.6"/>
    <path d="M2.5 19.5H21.5"/>`,

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

  // The keeper's camp (docs/future/13, E2): card actions as icons, and the "here" buttons.
  // Gather: a cupped hand with a few stalks rising out of it.
  gather: `
    <path ${ACCENT} d="M3 13.5C5 18 8.5 20 12 20S19 18 21 13.5Z"/>
    <path d="M3 13.5C5 18 8.5 20 12 20S19 18 21 13.5"/>
    <path d="M3 13.5C2.6 12.4 3.6 11.6 4.6 12.2L7 13.5H21"/>
    <path d="M8.5 11L10.5 6M12 11.2L13 5.5M15.5 11L15 6.5"/>`,
  // Set down: a small heap on the ground line, an arrow coming down onto it.
  setdown: `
    <path ${ACCENT} d="M5 19.5C5 16 7.5 14 12 14S19 16 19 19.5Z"/>
    <path d="M5 19.5C5 16 7.5 14 12 14S19 16 19 19.5"/>
    <path d="M2.5 19.5H21.5"/>
    <path d="M12 3V10M9.4 7.4L12 10L14.6 7.4"/>`,
  // Wear (P2f): a carrier standing with its two shoulder straps looped over the top, ready to put on.
  wear: `
    <path ${ACCENT} d="M6 10C6 8 7.4 7 9 7H15C16.6 7 18 8 18 10V18.6C18 19.4 17.4 20 16.6 20H7.4C6.6 20 6 19.4 6 18.6Z"/>
    <path d="M6 10C6 8 7.4 7 9 7H15C16.6 7 18 8 18 10V18.6C18 19.4 17.4 20 16.6 20H7.4C6.6 20 6 19.4 6 18.6Z"/>
    <path d="M9.4 7C9.4 3.4 14.6 3.4 14.6 7M8.4 13H15.6V16.4H8.4Z"/>`,
  // Take up: the same heap, the arrow rising off it.
  takeup: `
    <path ${ACCENT} d="M5 19.5C5 16 7.5 14 12 14S19 16 19 19.5Z"/>
    <path d="M5 19.5C5 16 7.5 14 12 14S19 16 19 19.5"/>
    <path d="M2.5 19.5H21.5"/>
    <path d="M12 10V3M9.4 5.6L12 3L14.6 5.6"/>`,
  // Empty: a pouch tipped over, a few bits falling to the ground.
  tip: `
    <path ${ACCENT} d="M6 4.5H14L16 12H8Z"/>
    <path d="M6 4.5H14L16 12H8Z"/>
    <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="14.5" cy="18.5" r="0.9" fill="currentColor" stroke="none"/>
    <circle cx="10.5" cy="19.5" r="0.9" fill="currentColor" stroke="none"/>
    <path d="M3 21H21"/>`,
  // Pitch: a ridge tent with its guy lines pegged out.
  pitch: `
    <path ${ACCENT} d="M12 5L5 18H19Z"/>
    <path d="M12 5L5 18H19Z"/>
    <path d="M12 5V18"/>
    <path d="M5 18L2.5 20.5M19 18L21.5 20.5"/>
    <path d="M12 5L12 2.5"/>`,
  // Lay: a ring of stones with two sticks crossed inside.
  lay: `
    <ellipse ${ACCENT} cx="12" cy="15" rx="5" ry="2"/>
    <circle cx="5" cy="15" r="1.8"/>
    <circle cx="19" cy="15" r="1.8"/>
    <circle cx="9" cy="18.4" r="1.8"/>
    <circle cx="15" cy="18.4" r="1.8"/>
    <circle cx="9" cy="11.8" r="1.6"/>
    <circle cx="15" cy="11.8" r="1.6"/>
    <path d="M10 15L14 13M10 13L14 15"/>`,
  // Light: a flame over two crossed sticks.
  fire: `
    <path ${ACCENT} d="M12 3.5C14.5 7 17 9 17 13A5 5 0 0 1 7 13C7 10.5 8.6 9 9.6 7.6C10 9.4 11 10.4 12 10.6C11.4 8.4 11.4 5.8 12 3.5Z"/>
    <path d="M12 3.5C14.5 7 17 9 17 13A5 5 0 0 1 7 13C7 10.5 8.6 9 9.6 7.6C10 9.4 11 10.4 12 10.6C11.4 8.4 11.4 5.8 12 3.5Z"/>
    <path d="M4 20.5L20 17.5M4 17.5L20 20.5"/>`,
  // Rest: a tent under a crescent moon.
  rest: `
    <path ${ACCENT} d="M10 8L3.5 20H16.5Z"/>
    <path d="M10 8L3.5 20H16.5Z"/>
    <path d="M10 8V20"/>
    <path d="M2.5 20H21.5"/>
    <path d="M19.5 3.5A3.2 3.2 0 1 0 21 9.5A3.8 3.8 0 0 1 19.5 3.5Z"/>`,
  // Dig: a shovel driven into the ground, a small spoil heap beside it (P2c, the here-bar).
  dig: `
    <path ${ACCENT} d="M13.2 14.4L17.6 12.8L19 17L15.2 18.6Z"/>
    <path d="M13.2 14.4L17.6 12.8L19 17L15.2 18.6Z"/>
    <path d="M15.4 13.6L11.4 3.4M9.6 4.1L13.2 2.7"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M3.6 20.5C4.4 17.6 8.8 17.6 9.8 20.5"/>`,
  // Scoop sand: a cupped hand under a little falling sand, a sand heap on the ground line.
  scoop: `
    <path ${ACCENT} d="M4.5 12.5C6 17 18 17 19.5 12.5Z"/>
    <path d="M4.5 12.5C6 17 18 17 19.5 12.5Z"/>
    <path d="M10 9.6v.1M13 8.2v.1M15.4 10v.1M11.8 5.4v.1"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M8 20.5C9.4 18.6 14.6 18.6 16 20.5"/>`,
  // Marram (species chip): a tussock of stiff rolled blades fanning from the sand, one straw spike.
  marram: `
    <path ${ACCENT} d="M6 20.5C7.4 18.8 16.6 18.8 18 20.5Z"/>
    <path d="M2.5 20.5H21.5"/>
    <path d="M12 19.6C11.2 14 8.6 9 5 5.6M12 19.6C11.6 13.4 11.4 8.4 11.6 3.4M12 19.6C13 14.2 15.4 9.6 19 6.8M12 19.6C10.4 16 7.6 13.4 4 12.4M12 19.6C14 16.4 16.8 14.6 20.2 14"/>
    <path d="M13.6 9.4C13.8 6.6 14.4 4.4 15.4 2.6"/>`,
  // Build: a flat slab laid across two stones (building a bench in its slot, S1).
  build: `
    <path ${ACCENT} d="M3 9.5H21V12.5H3Z"/>
    <path d="M3 9.5H21V12.5H3Z"/>
    <path d="M5 20.5C4.4 17.6 5.4 13.8 7.6 13.4C9.8 13.8 10.6 17.6 10 20.5Z"/>
    <path d="M14 20.5C13.4 17.6 14.4 13.8 16.6 13.4C18.8 13.8 19.6 17.6 19 20.5Z"/>
    <path d="M2.5 20.5H21.5"/>`,
  // Make: a stick bound to a flat stone with cord, the work of the workbench (S1).
  make: `
    <path ${ACCENT} d="M4 17C7 14.6 15 14.6 19 16.4C16.4 19.4 7.4 19.8 4 17Z"/>
    <path d="M4 17C7 14.6 15 14.6 19 16.4C16.4 19.4 7.4 19.8 4 17Z"/>
    <path d="M10.5 15L19.5 3.5"/>
    <path d="M11.2 12.2L14 14.4M12.4 10.6L15.2 12.8M13.6 9L16.4 11.2"/>`,
  // Dry: a herb bunch hung head down from a bar, tied at its stems (the apothecary's Dry, S2).
  dry: `
    <path ${ACCENT} d="M10.2 9.2C7.4 11 7 15.6 9.6 19.4C10.6 20.8 13.4 20.8 14.4 19.4C17 15.6 16.6 11 13.8 9.2Z"/>
    <path d="M10.2 9.2C7.4 11 7 15.6 9.6 19.4C10.6 20.8 13.4 20.8 14.4 19.4C17 15.6 16.6 11 13.8 9.2Z"/>
    <path d="M2.5 3.5H21.5M12 3.5V7.2M10 7.2H14M10.2 9.2V7.2M13.8 9.2V7.2"/>
    <path d="M12 10.4V19M12 13.4L10.2 15.4M12 15.8L13.8 17.6"/>`,
  // Grind: a pestle standing in a stone mortar (the apothecary's Grind, S2).
  grind: `
    <path ${ACCENT} d="M3.6 12.4H20.4C20.4 17 16.6 20.4 12 20.4S3.6 17 3.6 12.4Z"/>
    <path d="M3.6 12.4H20.4C20.4 17 16.6 20.4 12 20.4S3.6 17 3.6 12.4Z"/>
    <path d="M10.8 13.6L15.6 3.8C16 3 17.4 3.6 17.1 4.4L13 14.2"/>
    <path d="M7 15.2C8.4 16.2 9.8 16.6 11.2 16.6"/>`,
  // Smelt: a clay chimney narrowing up, a flame in its arch, a wisp leaving the top (the furnace's Smelt).
  smelt: `
    <path ${ACCENT} d="M10.4 20.4V17.8C10.4 16.6 11.1 15.8 12 15.8S13.6 16.6 13.6 17.8V20.4Z"/>
    <path d="M6 20.4L8 7.4C8.2 6.6 9.2 6 12 6S15.8 6.6 16 7.4L18 20.4Z"/>
    <path d="M10.4 20.4V17.8C10.4 16.6 11.1 15.8 12 15.8S13.6 16.6 13.6 17.8V20.4M3.5 20.4H20.5"/>
    <path d="M12 4.4C11 3.4 12.6 2.6 11.8 1.6"/>`,
  // Draw out: a hammer over a nail drawn long on a small anvil stone (the furnace's nails).
  draw: `
    <path ${ACCENT} d="M4 20.4C4.4 17.8 6.6 16.6 9 16.6H15C17.4 16.6 19.6 17.8 20 20.4Z"/>
    <path d="M4 20.4C4.4 17.8 6.6 16.6 9 16.6H15C17.4 16.6 19.6 17.8 20 20.4ZM7 14.6H17"/>
    <path d="M13.4 3.4L18.6 8.6M16 6L8.4 13.6"/>`,
  // Weave: three warp threads hung from a bar, the weft passing over and under them (the
  // workbench's Weave, F1 cloth).
  weave: `
    <path ${ACCENT} d="M5 7H19V18.6H5Z"/>
    <path d="M3 4.4H21M7 4.4V20.4M12 4.4V20.4M17 4.4V20.4"/>
    <path d="M4.6 9.4C5.8 9.4 6 8.4 7 8.4S8.4 10.4 12 10.4S15.8 8.4 17 8.4S18.2 9.4 19.4 9.4"/>
    <path d="M4.6 13.4C5.8 13.4 6 14.4 7 14.4S8.4 12.4 12 12.4S15.8 14.4 17 14.4S18.2 13.4 19.4 13.4"/>
    <path d="M4.6 17.4C5.8 17.4 6 16.4 7 16.4S8.4 18.4 12 18.4S15.8 16.4 17 16.4S18.2 17.4 19.4 17.4"/>`,
  // Steep: a bundle of stems lying on a pond's bed under a stone, the water line above (F1 retting).
  steep: `
    <path ${ACCENT} d="M2.5 9.6C4.4 8.6 6.2 8.6 8 9.6S11.6 10.6 13.4 9.6S17.2 8.6 21.5 9.4V20.4H2.5Z"/>
    <path d="M2.5 9.6C4.4 8.6 6.2 8.6 8 9.6S11.6 10.6 13.4 9.6S17.2 8.6 21.5 9.4"/>
    <path d="M4 18.4H20M4.6 16.4H19.4M2.5 20.4H21.5"/>
    <path d="M9 15.6C9 13.4 10.4 12.4 12 12.4S15 13.4 15 15.6Z"/>`,
  // Pan: a shallow pan tipped over water, a few grains settled in its well (the spring pool, Pan).
  pan: `
    <path ${ACCENT} d="M3.6 10.6C3.6 8.8 7.4 7.6 12 7.6S20.4 8.8 20.4 10.6C20.4 13.8 16.6 16 12 16S3.6 13.8 3.6 10.6Z"/>
    <path d="M3.6 10.6C3.6 8.8 7.4 7.6 12 7.6S20.4 8.8 20.4 10.6C20.4 13.8 16.6 16 12 16S3.6 13.8 3.6 10.6Z"/>
    <path d="M2.5 19.6C4.4 18.4 6.2 18.4 8 19.6S11.6 20.8 13.4 19.6S17.2 18.4 21.5 19.4"/>
    <circle cx="11" cy="11.6" r=".6" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r=".6" fill="currentColor" stroke="none"/>`,
  // The well shrimp (the pan finds): a pale, eyeless groundwater shrimp, curled on its side, its feelers long.
  wellshrimp: `
    <path ${ACCENT} d="M5 14.6C5 9.6 9 6.4 13.6 6.8C17.6 7.2 19.8 10.4 19.4 13.6C17.6 12.2 15.6 11.6 13.6 12.2C11.4 12.8 10.4 15 11 17.6C8.4 18.4 5 17.6 5 14.6Z"/>
    <path d="M5 14.6C5 9.6 9 6.4 13.6 6.8C17.6 7.2 19.8 10.4 19.4 13.6C17.6 12.2 15.6 11.6 13.6 12.2C11.4 12.8 10.4 15 11 17.6C8.4 18.4 5 17.6 5 14.6Z"/>
    <path d="M8.4 9.4L9.8 11.4M11.4 7.6L12.2 10M14.6 7.2L14.6 9.8M11 17.6L9.6 20.2M11 17.6L12.8 20M19.4 13.6C20.8 11.2 21.6 8.4 21.4 4.6M19.4 13.6C21.2 13 22 11.4 22 9.8"/>`,
  // Climb down: a dark hole in the ground, a rope ladder hanging into it, an arrow going down.
  climbdown: `
    <path ${ACCENT} d="M3 16.6C3 14.6 7 13.2 12 13.2S21 14.6 21 16.6S17 20 12 20S3 18.6 3 16.6Z"/>
    <path d="M3 16.6C3 14.6 7 13.2 12 13.2S21 14.6 21 16.6S17 20 12 20S3 18.6 3 16.6Z"/>
    <path d="M9.6 3.6V17.6M14.4 3.6V17.6M9.6 7H14.4M9.6 10.4H14.4M9.6 13.8H14.4"/>
    <path d="M18.4 4V10.4M16.6 8.6L18.4 10.4L20.2 8.6"/>`,
  // Climb up: the rope ladder rising into a round of daylight, an arrow going up.
  climbup: `
    <circle ${ACCENT} cx="12" cy="6" r="4.2"/><circle cx="12" cy="6" r="4.2"/>
    <path d="M9.6 9.4V20.6M14.4 9.4V20.6M9.6 12.4H14.4M9.6 15.6H14.4M9.6 18.8H14.4"/>
    <path d="M18.4 20V13.6M16.6 15.4L18.4 13.6L20.2 15.4"/>`,
  // Brew: a round tea pot with its spout and lid, two curls of steam rising off it (the tea pot's Brew, P2e).
  brew: `
    <path ${ACCENT} d="M5.4 14.6C5.4 11.6 8.2 9.8 11.6 9.8S17.8 11.6 17.8 14.6C17.8 18 15.4 20.4 11.6 20.4S5.4 18 5.4 14.6Z"/>
    <path d="M5.4 14.6C5.4 11.6 8.2 9.8 11.6 9.8S17.8 11.6 17.8 14.6C17.8 18 15.4 20.4 11.6 20.4S5.4 18 5.4 14.6Z"/>
    <path d="M17.4 13.2L20.6 10.8M5.6 13.4C3.6 13.4 3 15.6 4.6 16.8"/>
    <path d="M9.4 9.8C9.6 8.8 10.4 8.4 11.6 8.4S13.6 8.8 13.8 9.8"/>
    <path d="M9.8 6.2C9 5 10.6 4.2 9.8 3M13.4 6.2C12.6 5 14.2 4.2 13.4 3"/>`,
  // Cook: a round-bellied pot with two lugs, an egg in it, steam rising (the cooking pot's Cook, the hen's slice 4).
  cook: `
    <path ${ACCENT} d="M4.6 11.4H19.4C19.4 16.4 16.4 19.8 12 19.8S4.6 16.4 4.6 11.4Z"/>
    <path d="M4.6 11.4H19.4C19.4 16.4 16.4 19.8 12 19.8S4.6 16.4 4.6 11.4Z"/>
    <path d="M4.6 12.6H2.8M19.4 12.6H21.2M3.5 21H20.5"/>
    <path d="M10 11.4C10 9.4 10.9 8.2 12 8.2S14 9.4 14 11.4"/>
    <path d="M8.6 6C7.8 4.8 9.4 4 8.6 2.8M15.4 6C14.6 4.8 16.2 4 15.4 2.8"/>`,
  // Hand: an open hand, the pointer over something a click can use (below).
  hand: `
    <path ${ACCENT} d="M8 12V5.5A1.5 1.5 0 0 1 11 5.5V11V4A1.5 1.5 0 0 1 14 4V11V5.5A1.5 1.5 0 0 1 17 5.5V14C17 18 15 20.5 11.5 20.5C8.5 20.5 7 18.5 5.5 15.5L4.5 13.5A1.4 1.4 0 0 1 7 12.3Z"/>
    <path d="M8 12V5.5A1.5 1.5 0 0 1 11 5.5V11V4A1.5 1.5 0 0 1 14 4V11V5.5A1.5 1.5 0 0 1 17 5.5V14C17 18 15 20.5 11.5 20.5C8.5 20.5 7 18.5 5.5 15.5L4.5 13.5A1.4 1.4 0 0 1 7 12.3Z"/>`,
  // Spread: a handful tipped from a cupped palm, flecks falling onto a low pale patch (the ash
  // pouch's Spread here, P2i).
  spread: `
    <path ${ACCENT} d="M3.5 8.5C6.2 6.4 10.6 6 13.6 7.6L15.2 10.6C11.6 11.6 6.8 11.2 3.5 8.5Z"/>
    <path d="M3.5 8.5C6.2 6.4 10.6 6 13.6 7.6L15.2 10.6C11.6 11.6 6.8 11.2 3.5 8.5Z"/>
    <path d="M15.8 13.2v.1M13.6 14.8v.1M17.6 15.6v.1M15.2 17.2v.1"/>
    <path d="M8.4 20C11 18.4 17 18.4 20.4 20"/>
    <path d="M2.5 20.5H21.5"/>`,
  // Sketch: a charcoal stick drawing a loose line on a sheet (the here-bar's Sketch, P2i).
  sketch: `
    <path ${ACCENT} d="M3.5 6.5H15.5V20.5H3.5Z"/>
    <path d="M3.5 6.5H15.5V20.5H3.5Z"/>
    <path d="M6 16.4C7.4 13.4 8.8 17.2 10.4 14.4S12.6 12.6 13.2 11.8"/>
    <path d="M13.2 12.6L20 4.4C20.6 3.7 21.6 4.5 21.1 5.3L14.6 13.8Z"/>`,
  // Sketchbook: a bound book, its binding down the left, a drawing on the cover (P2i).
  sketchbook: `
    <path ${ACCENT} d="M5.5 3.5H19.5V20.5H5.5Z"/>
    <path d="M5.5 3.5H19.5V20.5H5.5Z"/>
    <path d="M3.5 6.5H7.5M3.5 10H7.5M3.5 13.5H7.5M3.5 17H7.5"/>
    <path d="M10 15.5C10.4 12.6 12.4 11 15 11.6C16.6 12 17 13.8 16.2 15.2"/>
    <path d="M9.6 15.6H17"/>`,
  // The walker: a figure in a tall soft hat with a wide brim and a long coat (the Walker page's button).
  walker: `
    <path ${ACCENT} d="M8.4 20.5L9.4 12.2H14.6L15.6 20.5Z"/>
    <path d="M8.4 20.5L9.4 12.2H14.6L15.6 20.5Z"/>
    <path d="M10.2 9.6C10.6 6.8 11.6 4.4 13.2 3C14 2.4 15.2 2.6 15.8 3.4C14.8 3.8 14.4 5 14.6 6.6L14.8 9.6"/>
    <path d="M5.8 10.4C7.6 9.2 16.4 9.2 18.2 10.4C16.4 11.6 7.6 11.6 5.8 10.4Z"/>
    <path d="M12 12.2V20.5M10.6 14.6H11.4M12.6 14.6H13.4"/>`,
  // The Keeper book (Matt, October 30, 2026): a field book with a soft cover, its binding down the
  // left, a cord wound round it and tied in a loop at the edge, a ribbon marker hanging below.
  keeper: `
    <path ${ACCENT} d="M5.5 3.5H18.5V19H5.5Z"/>
    <path d="M5.5 3.5H18.5V19H5.5Z"/>
    <path d="M8 3.5V19"/>
    <path d="M5.5 11.2H18.5"/>
    <path d="M18.5 11.2C20.6 10 21.6 11.4 20.4 12.4C19.8 12.9 19 12.6 18.5 12.2"/>
    <path d="M13.5 19V21.5L14.7 20.6L15.9 21.5V19"/>`,
  // Threads (the Keeper book's tab): a wooden spool, thread wound round it, its loose end curling away.
  threads: `
    <path ${ACCENT} d="M6.5 6H13.5V14H6.5Z"/>
    <path d="M4.5 4H15.5M4.5 16H15.5"/>
    <path d="M6.5 4V16M13.5 4V16"/>
    <path d="M6.5 8L13.5 6.6M6.5 11L13.5 9.6M6.5 14L13.5 12.6"/>
    <path d="M13.5 12.6C16.4 12.6 18.4 14 17.6 16.4C16.9 18.4 14.6 18.8 15.6 20.2C16.4 21.2 18.6 21 20 20"/>`,
  // Photo mode (B2 P1): a small camera, its body, the hump of the finder, the lens.
  photo: `
    <path ${ACCENT} d="M3.5 8.5H7.5L9 6H15L16.5 8.5H20.5V19H3.5Z"/>
    <path d="M3.5 8.5H7.5L9 6H15L16.5 8.5H20.5V19H3.5Z"/>
    <circle cx="12" cy="13.5" r="3.4"/>
    <path d="M17.6 11H18.4"/>`,
  // Take the picture: a round shutter button, pressed in.
  shot: `
    <circle cx="12" cy="12" r="8.5"/>
    <circle ${ACCENT} cx="12" cy="12" r="5"/>
    <circle cx="12" cy="12" r="5"/>`,
  // Aperture: a lens ring with six blades closing toward an open middle.
  aperture: `
    <circle cx="12" cy="12" r="8.5"/>
    <path ${ACCENT} d="M12 8.6L14.9 10.3V13.7L12 15.4L9.1 13.7V10.3Z"/>
    <path d="M12 3.5L14.9 10.3M19.4 7.8L14.9 13.7M19.4 16.2L12 15.4M12 20.5L9.1 13.7M4.6 16.2L9.1 10.3M4.6 7.8L12 8.6"/>`,
  // Thirds guide: a frame cut by two lines each way.
  thirds: `
    <rect x="3.5" y="5.5" width="17" height="13" rx="1"/>
    <path d="M9.2 5.5V18.5M14.8 5.5V18.5M3.5 9.8H20.5M3.5 14.2H20.5" opacity="0.8"/>`,
  // Frame shape: four corner marks round a shape, as a cropping guide.
  aspect: `
    <rect ${ACCENT} x="6.5" y="7.5" width="11" height="9"/>
    <path d="M3.5 8V4.5H7M17 4.5H20.5V8M20.5 16V19.5H17M7 19.5H3.5V16"/>`,
  // Paper margin: a picture set on a wider sheet.
  margin: `
    <rect x="3.5" y="3.5" width="17" height="17" rx="1"/>
    <rect ${ACCENT} x="7" y="7" width="10" height="8"/>
    <rect x="7" y="7" width="10" height="8"/>`,
  // Exposure: a disc half lit, a line between.
  exposure: `
    <circle cx="12" cy="12" r="8.5"/>
    <path ${ACCENT} d="M12 3.5A8.5 8.5 0 0 0 12 20.5Z"/>
    <path d="M12 3.5V20.5"/>
    <path d="M15 9H18M16.5 7.5V10.5M15 15H18"/>`,
  // Soft filter: a glow, its edge drawn in soft breaks round a bright middle.
  'filter-soft': `
    <circle ${ACCENT} cx="12" cy="12" r="4.5"/>
    <circle cx="12" cy="12" r="4.5"/>
    <path d="M12 3.5A8.5 8.5 0 0 1 18 6M20.5 12A8.5 8.5 0 0 1 18 18M12 20.5A8.5 8.5 0 0 1 6 18M3.5 12A8.5 8.5 0 0 1 6 6" opacity="0.7"/>`,
  // Pencil filter: a pencil over three hatched strokes.
  'filter-pencil': `
    <path d="M3.5 20.5L9 15M3.5 16.5L7 13M7.5 20.5L11 17" opacity="0.8"/>
    <path ${ACCENT} d="M10 15.5L18.2 7.3L20.7 9.8L12.5 18Z"/>
    <path d="M10 15.5L18.2 7.3L20.7 9.8L12.5 18L9.2 18.8Z"/>
    <path d="M16.6 8.9L19.1 11.4"/>`,
};

/** Names of every icon in the sprite. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/**
 * One icon's drawing, as the SVG markup inside its symbol (item icons compose species chips into
 * seed and clump icons, src/ui/icons/items.js). @param {string} name @returns {string}
 */
export const iconBody = (name) => ICONS[name] ?? '';

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
