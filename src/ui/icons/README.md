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
| `drain` | a shallow pool over a gap in the ground line, an arrow leaving downward |
| `wellspring` | water welling up from the ground and arcing over, a ripple at its foot |
| `rate-trickle`, `rate-brook`, `rate-stream` | one, two or three small wave lines: spring flow |
| `spring-remove` | drop with a small cross drawn as two strokes |
| `plant` | seedling with two leaves rising from a small mound on the ground line: the Plant tool |
| `reeds` | stem with a cattail seed head between two curving blades: species chip |
| `lilies` | notched lily pad seen low on a wavy water line, a cup flower of pointed petals on it: species chip |
| `iris` | fan of three sword leaves and a flower on a stalk with three drooping falls: species chip |
| `thrift` | low cushion on the ground line with three stalks topped by round pompoms: species chip |
| `grass` | five blades of different heights on the ground line: the grass journal page |
| `journal` | bound book with a ribbon marker and a pressed leaf on the cover: the journal button |
| `notes` | page with a folded corner and three written lines: the journal's Notes section |
| `unknown` | a circle drawn in short pencil dashes: a living thing not seen yet |
| `close` | two crossing strokes: close a panel or card |
| `back` | a chevron pointing left: back to a list |
| `chevron` | a chevron pointing up (turned over by CSS to point down): the phone sheet's taller or shorter |
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
