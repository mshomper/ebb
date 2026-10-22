# 21 — Brand identity

> How ebb looks and is named outside the game: the wordmark, the tagline, the icon, the favicon and the colors. These choices were settled in the scoping session and the files live in `brand/`. Use them as-is; changes go through Matt.

## Locked decisions

- **Name:** ebb. Always lowercase in the wordmark and in UI. In running text, "ebb" stays lowercase too.
- **Tagline:** "a tended island".
- **Store and search title:** "ebb: a tended island". The bare name is crowded (Esoteric Ebb, a 2026 RPG; Ebb Software, the studio behind Scorn), so the tagline always travels with the name in listings, page titles and social cards.
- **Wordmark:** "ebb" in Nunito ExtraBold (800), letter spacing −0.015 em, color moss green `#5F7F5B` on light backgrounds and `#BFD5A8` on dark. The tagline sits beneath in Fraunces italic, regular weight, at about 27 % of the wordmark size, color `#7B8B84` on light and `#A9B6B0` on dark.
- **Icon:** "Moon tide". A small green island at dusk with one round tree and a smaller one, a lantern on the hill, a crescent moon, the moon's reflection in the water, and a heron standing in the shallows to the left. File: `brand/ebb-icon.svg`.
- **Favicon:** the simplified Moon tide: sky, crescent moon, island with one tree, sand line, water with two moonlight glints. No heron, no lantern, no stars, no reflection. File: `brand/ebb-favicon.svg`.

## How it works

```
 +-----------+
 |  (moon)   |   ebb
 |   island  |   a tended island
 +-----------+
 icon            wordmark + tagline (lockup, take 1)
```

The icon carries the mood (dusk, quiet, a creature at home). The favicon carries recognition at tiny sizes. The wordmark is soft and rounded so it sits comfortably next to the painted icon.

### Lockups

- **Horizontal (primary):** icon at the left, wordmark and tagline stacked to its right. Icon height equals wordmark cap height plus tagline height. Gap between icon and text ≈ 0.2 × icon height.
- **Stacked (title and loading screens):** icon above, wordmark and tagline centered below.
- **Wordmark alone:** allowed in the game's own UI (title bar, settings header). In any external listing, use the tagline as well.

### Files in `brand/`

| File | Use |
|---|---|
| `ebb-icon.svg` | Master icon, 512 × 512 viewBox |
| `ebb-favicon.svg` | Master favicon, 32 × 32 viewBox |
| `favicon.ico` | 16, 32 and 48 px combined, for older browsers |
| `favicon-16.png`, `favicon-32.png`, `favicon-48.png` | Raster favicons |
| `apple-touch-icon.png` | 180 px, Safari pinned and home screen icon |
| `icon-192.png`, `icon-512.png` | Web app manifest icons |
| `favicon-preview.png` | Reference sheet: icon and favicon at each size |

`index.html` head should include:

```html
<link rel="icon" href="brand/ebb-favicon.svg" type="image/svg+xml">
<link rel="icon" href="brand/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="brand/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<title>ebb: a tended island</title>
```

## Data and interfaces

### Color tokens

Defined once in `src/ui/tokens.css` and mirrored in `recipes/palettes/dusk.json` where the renderer needs them.

| Token | Hex | Role |
|---|---|---|
| sky-high | `#B8A9CC` | Dusk sky top |
| sky-mid | `#EBC6C0` | Dusk sky middle |
| sky-low | `#F8DEC8` | Dusk horizon |
| sea-light | `#AFC6CF` | Shallow water |
| sea-deep | `#5F8196` | Deep water |
| moss-1 … moss-5 | `#6A8B66` `#7C9D72` `#8DAE80` `#9DBB8B` `#AECA9C` | Foliage, dark to light |
| sand | `#E8D4B4` | Shore |
| bark | `#7D6352` | Trunks, wood |
| moonlight | `#FBF1DC` | Moon, glints, highlights |
| lantern | `#FFDE95` | Warm light |
| heron | `#5E6E7D` | Creature slate |
| beak | `#E3B36E` | Accent |
| wordmark | `#5F7F5B` / `#BFD5A8` | Wordmark light / dark |
| ui-cream | `#F4EEE4` | UI background |
| ui-night | `#1E2624` | UI dark background |

### Type

- UI: Nunito (600 for labels, 800 for headings and the wordmark).
- Journal, tagline, captions with personality: Fraunces italic (regular, SOFT axis 100).
- Both are vendored under `src/vendor/fonts/` (no font CDN at runtime, per doc 03), loaded with `font-display: swap`, with system rounded sans and serif as fallbacks.

## Algorithms and shaders

None. The icon art is hand-built SVG: flat fills with two gentle gradients (sky and sea), a mask for the crescent, and Bezier-curve silhouettes (the heron is one continuous outline with a separate beak, plume and legs).

## Tuning knobs

None in game. Brand changes are made by editing the SVG masters and re-exporting the PNG and ICO files. Add a small `tools/brand-export.html` that renders the masters to each size so the export can be redone locally.

## Performance budget

The favicon SVG is under 2 KB; the icon SVG is under 8 KB.

## Acceptance checks

- The browser tab shows the favicon crisply at 16 px, and the moon and island are recognizable.
- Installing the page as an app from the browser (or pinning it) shows the full Moon tide icon.
- The title screen shows the stacked lockup in Nunito and Fraunces (not fallback fonts) once loaded.
- The tab title reads "ebb: a tended island".

## Open questions

- Should there be a short animated version of the icon (moon rising, tide easing) for the loading screen?
- Do you want a monochrome version of the favicon for places that force a single color?

## Depends on / feeds into

- Palette tokens feed `05-look-and-palette.md`.
- Type and icon style feed `15-camera-input-and-ui.md`.
