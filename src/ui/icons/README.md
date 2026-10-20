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
| `feed` | a small scoop tipped over, a pinch of food falling from it: the Feed tool |
| `anemone` | a squat column on the ground line with a crown of tentacles open above: the beadlet anemone find |
| `periwinkle` | a round spiral shell on the ground line, its whorl drawn in: the periwinkle find |
| `lugworm` | a coil of sand on the ground line and the dip of the burrow's other end: lugworm casts |
| `shells` | a ribbed fan shell on the ground line and a small spiral one beside it: the shells collection |
| `hermitcrab` | a spiral shell on the ground line, legs and one big claw reaching out of its mouth: the hermit crab find |
| `ediblecrab` | a wide shell, two claws raised, legs splayed to the sides: the young edible crab find |
| `stone` | a rounded boulder on the ground with a smaller one against it, a drop line above: Sculpt's Stone mode |
| `name-tag` | a luggage-style tag with its hole: naming a creature on its card |
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
| `marigold` | two round, notched leaves at a wavy water line and a five-petalled cup flower above: species chip |
| `campion` | a low mat on a rock's back and a flower with a swollen, veined calyx and spreading petals: species chip |
| `grass` | five blades of different heights on the ground line: the grass journal page |
| `rushes` | a tussock of stiff straight stems splaying from one base, a small flower tuft on the middle stem: the rushes journal page |
| `journal` | bound book with a ribbon marker and a pressed leaf on the cover: the journal button |
| `season-spring`, `season-summer`, `season-autumn`, `season-winter` | a bud, a sun, a falling leaf, a frost star: the journal's season boxes |
| `soil`, `sand`, `rock`, `moss`, `shore` | a mound with clods and a sprout, wind ripples, a faceted boulder, soft cushions, waves over a sandy curve: the journal's Ground pages |
| `almanac` | a calendar page with a crescent moon: the journal's Almanac |
| `web` | three knots in a row, each joined by a thread to one knot below: the journal's Web (what needs what) |
| `find` | a looking glass: a journal page's Show me |
| `moment-flower`, `moment-rain`, `moment-dusk`, `moment-dawn`, `moment-mist` | a five-petal flower, a raining cloud, a sun setting, a sun rising, drifting mist: the journal's moment frames |
| `notes` | page with a folded corner and three written lines: the journal's Notes section |
| `frog` | a frog sitting at the water's edge in profile, eye up, hind leg folded: the frogs journal page |
| `midges` | a loose cloud of dots over a reed tip: the midges journal page |
| `pool` | water held in a hollow between two rocks: a rock pool, in the journal's Web |
| `strandline` | a line of torn litter along the shore with the sea below: the strandline, in the Web |
| `wrack` | a bladderwrack frond forking twice, with paired bladders: wrack, in the Web |
| `kelp` | two broad blades with a midrib lying downslope from a holdfast: kelp, in the Web |
| `lichen` | dark crust patches on a splash rock, a little spray above: black lichen, in the Web |
| `ripples` | short wave ripples in the sand with the sea's edge above: rippled sand, in the Web |
| `wetsand` | firm sand with a sheen and a drop above it: wet sand, in the Web |
| `mud` | soft wavy ground that shines, two bubbles rising: tidal mud, in the Web |
| `you` | a simple figure, head and shoulders: you, in the Web |
| `unknown` | a circle drawn in short pencil dashes: a living thing not seen yet |
| `close` | two crossing strokes: close a panel or card |
| `back` | a chevron pointing left: back to a list |
| `chevron` | a chevron pointing up (turned over by CSS to point down): the phone sheet's taller or shorter |
| `undo` | curved arrow to the left |
| `redo` | the mirror of undo |
| `raise` | mound with an up stroke |
| `lower` | hollow with a down stroke |
| `flatten` | level shelf line over a mound, the cut-away top dotted |
| `terrace` | a level shelf raised on a sheer face with rock bands on it, an up stroke above: Sculpt's Terrace mode |
| `cut` | a notch carved into the ground with sheer walls, the cut-away top dotted, a down stroke: Sculpt's Cut mode |
| `time` | half sun on a horizon with a flow arc |
| `flow-1`, `flow-2`, `flow-4` | one, two or three pips: normal, 2x and 4x speed |
| `flow-pause` | two rest bars: time paused |
| `look` | painter's palette with a thumb notch, three dabs of paint and one empty well: the Look (palette) button |
| `eye` | an open eye with its pupil: brings hidden HUD buttons back on a touch screen |
| `settings` | three horizontal sliders with their knobs: the Settings button |
| `sound` | a small speaker with two sound arcs: Settings > Sound |
| `controls` | a fingertip touching, with two rings spreading from the touch: Settings > Controls |
| `quality` | two stacked layers, the top one raised: Settings > Quality |
| `saves` | a keepsake box with an arrow going in: Settings > Saves |
| `tests` | a small flask a third full: Settings > Tests, on previews and local builds only |

The clock dial (`src/ui/clock-dial.js`) is drawn live in the same style rather than from this sprite: a season ring, the sky's arc over a horizon with the sun or moon on it, and a tide wave with a rising or falling chevron.

Adding an icon: add an entry to `ICONS` in `icons.js` following the rules above, then add a row here.
