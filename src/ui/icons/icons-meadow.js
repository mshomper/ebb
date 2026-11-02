// @ts-check
// The meadow islet's stories without creatures (F20, docs/future/20-meadow-stories.md): the rye,
// its sheaf (the rye thread), a stook drying, the marker stone with its notch (the stone's thread
// and card), and the sickle (Cut the rye). Drawn in the shared family's rules (icons.js, README.md):
// 24 px grid, 2 px padding, stroke 1.75, round caps and joins, currentColor, accent fills at 20
// percent. Spread into the sprite by icons.js.

const ACCENT = 'fill="currentColor" fill-opacity="0.2" stroke="none"';

/** @type {Record<string, string>} */
export const MEADOW_ICONS = {
  // Rye: one tall stalk with a long whiskered head, a leaf off its foot.
  rye: `
    <path d="M3.5 20.5H20.5"/>
    <path d="M12 20.5V10.4"/>
    <path d="M12 16.6C10 15.4 8.4 13.6 7.6 11.6"/>
    <path ${ACCENT} d="M12 10.4C10.6 9 10.4 5.6 12 3.4C13.6 5.6 13.4 9 12 10.4Z"/>
    <path d="M12 10.4C10.6 9 10.4 5.6 12 3.4C13.6 5.6 13.4 9 12 10.4Z"/>
    <path d="M11 8.6L8.6 6.8M11 6.4L9 4.4M13 8.6L15.4 6.8M13 6.4L15 4.4M12 3.4V1.8"/>`,
  // Sheaf: a bundle of stalks tied at the waist, the heads fanned out on top.
  sheaf: `
    <path d="M9.6 20.6L11 12.6M12 20.8V12.6M14.4 20.6L13 12.6M7.8 20.2L10.4 12.8M16.2 20.2L13.6 12.8"/>
    <path ${ACCENT} d="M9.4 11.4H14.6V13.8H9.4Z"/>
    <path d="M9.4 11.4H14.6M9.4 13.8H14.6"/>
    <path d="M11 11.4C10.4 8.6 8.6 6.4 6.4 5.4M12 11.4V3.6M13 11.4C13.6 8.6 15.4 6.4 17.6 5.4"/>
    <path d="M6.4 5.4L5.4 3.8M12 3.6V2.2M17.6 5.4L18.6 3.8"/>`,
  // Stook: three sheaves leaned together into a little tent of straw on the stubble.
  stook: `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M6 20.5L11.2 6.6L12.8 6.6L18 20.5Z"/>
    <path d="M6 20.5L11.2 6.6M18 20.5L12.8 6.6M12 20.5V6.6"/>
    <path d="M8.4 14.4H15.6"/>
    <path d="M11.2 6.6L9.6 3.6M12 6.6V3M12.8 6.6L14.4 3.6"/>`,
  // Marker stone: a tall leaning stone with a V notch in its top, the sun beside it.
  'marker-stone': `
    <path d="M2.5 20.5H21.5"/>
    <path ${ACCENT} d="M7.6 20.5L8.6 5.6L10.6 5L12 8L13.4 5.2L15.2 5.8L15.8 20.5Z"/>
    <path d="M7.6 20.5L8.6 5.6L10.6 5L12 8L13.4 5.2L15.2 5.8L15.8 20.5"/>
    <path d="M10.4 12.4L11.4 13.4M12.8 15.6L13.8 16.4" opacity="0.6"/>
    <circle cx="19.4" cy="4.6" r="1.6"/>`,
  // Sickle: a curved blade swept round from a short wooden handle.
  sickle: `
    <path ${ACCENT} d="M9.6 15.4C5.6 12.6 5.4 6.8 9.4 4.2C13.6 1.6 19.2 4 19.6 9C17.8 6.4 14 5.6 11.6 7.4C9.2 9.2 9.4 12.8 11.4 14.6Z"/>
    <path d="M9.6 15.4C5.6 12.6 5.4 6.8 9.4 4.2C13.6 1.6 19.2 4 19.6 9C17.8 6.4 14 5.6 11.6 7.4C9.2 9.2 9.4 12.8 11.4 14.6"/>
    <path d="M10.4 15L5 20.4M9 13.8L11.8 16.4"/>`,
};
