# Icons

Every icon in ebb is a hand-drawn SVG line drawing kept in `icons.js`. No emoji, Unicode symbols or icon fonts (docs/15, "Icon set").

## Use

```js
import { ensureIconSprite, iconSvg } from './icons/icons.js';
ensureIconSprite();                       // once, injects the hidden <svg> sprite into <body>
button.innerHTML = iconSvg('sculpt');     // '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-sculpt"/></svg>'
```

Size and color come from CSS: set `width`/`height` on `.icon` and `color` on the parent. The button carrying the icon holds the `aria-label`.

## Style rules

- One `<symbol id="i-NAME" viewBox="0 0 24 24">` per icon, on a 24 px grid with 2 px padding (drawing stays inside 2..22).
- Stroke 1.75, round caps, round joins, `stroke="currentColor"`, no fill by default.
- Optional accent fill: `currentColor` at 20 percent opacity, for the one shape that carries the meaning (the mound, the blade, the leaf).
- Calm, rounded, simple: few strokes, no text glyphs, arrows drawn as paths.
- Drawn at 28 px in 48 px buttons on desktop, 26 px in 52 px buttons on phones, 22 px inside chips.

## Icons

| Name | Drawing |
|---|---|
| `sculpt` | trowel lifting a soft mound |
| `smooth` | flat float over a wavy line that straightens |
| `paint` | round brush with a leaf-shaped dab |
| `water` | droplet over one ripple line |
| `pour` | spout bending down, a falling drop, a small pool on the ground line |
| `soak` | down stroke into the ground line, a drop sinking below it, damp specks |
| `wellspring` | water welling up from the ground and arcing over, a ripple at its foot |
| `rate-trickle`, `rate-brook`, `rate-stream` | one, two or three small wave lines: spring flow |
| `spring-remove` | drop with a small cross drawn as two strokes |
| `undo` | curved arrow to the left |
| `redo` | the mirror of undo |
| `raise` | mound with an up stroke |
| `lower` | hollow with a down stroke |
| `flatten` | level shelf line over a mound, the cut-away top dotted |
| `time` | half sun on a horizon with a flow arc |
| `flow-1`, `flow-2`, `flow-4` | one, two or three pips: normal, 2x and 4x speed |
| `flow-pause` | two rest bars: time paused |
| `look` | painter's palette with a thumb notch, three dabs of paint and one empty well: the Look (palette) button |

Adding an icon: add an entry to `ICONS` in `icons.js` following the rules above, then add a row here.
