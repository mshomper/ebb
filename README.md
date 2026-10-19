<p align="center"><img src="brand/ebb-icon.svg" width="160" alt="ebb icon: a small green island at dusk with a crescent moon and a heron in the shallows"></p>

<h1 align="center">ebb</h1>
<p align="center"><em>a tended island</em></p>

A cozy idler and living diorama built on raw WebGPU. Shape a small island, plant seeds, and make room for creatures. They arrive and settle when the ecology suits them, and the island keeps growing while you are away. When you come back, it has moved on without you.

The look is soft and natural: physical light, sky and water, ground built from scanned materials, and a gentle palette applied last. Everything grows from seeded recipes, so it can all be tuned without code.

## Where it is

The M1 vertical slice, one small island with every pillar working in miniature, is about two thirds built. The full step list is in [docs/20-roadmap-and-vertical-slice.md](docs/20-roadmap-and-vertical-slice.md).

| | Step | What it gives you |
|---|---|---|
| Done | S1 to S3 | A seeded island to sculpt, smooth and paint (grass, sand, soil, rock) with undo and redo; a physical sky, sun, moon, shadows, seasons and weather; two palettes applied last |
| Done | G1 to G4 | Realistic ground from scanned materials: no visible tiling, wet ground in rain, natural rock |
| Done | S4 | Water: a shallow-water simulation coupled to sculpting, the tide, springs welling up from rock outcrops, streams, ponds and marshes, with reflections, caustics and foam. Ponds lie still, ruffled only by the wind and their inflow; the swell is the sea's |
| Done | S5 | Six plants that grow, spread and compete on their own ground: grass, rushes, reeds, water lilies, yellow flag iris and sea thrift, with a Plant tool |
| Done | J1 to J2 | The field journal: a page and a field sketch for every living thing and every kind of ground, notes as things happen, the Almanac, a web of what needs what, and a wash that shows where each thing lives |
| In progress | S6 | Frogs: they find the island, arrive and settle (S6a), then move, call and react to you (S6b; by day they hide in the reeds and rushes, at dusk they come out to the edge), then come to trust you and take a name (S6c) |
| Next | S7 | Saving, and the island moving on while you are away. Until then every load starts a fresh world |
| Next | S8 | The final touch layout and the low quality tier for phones |

There are two islands to start from: the **Starter island** (one large spring-fed pond under a hill) and **Two ponds** (a low island with two spring-fed ponds and three rain-fed marshes). The **Island** button on the corner badge switches between them.

## What you can do in it

- **Sculpt, smooth and paint** the land; water always finds its way downhill.
- **Pour and drain water.** Place springs once they are unlocked (`?sandbox` unlocks them now).
- **Plant** reeds, water lilies, iris, rushes and sea thrift. The tool says why when the ground won't do.
- **Tap anything** (a plant, the ground, the water) to name it, then open its page in the **field journal**. Pages fill in from what happens on the island, in words, never numbers.
- **Look:** switch palettes, and change how fast time flows.

## Running it

You need a WebGPU-capable browser: Chrome, Edge, Firefox on Windows, or Safari 26 and later.

- **Live:** https://mshomper.github.io/ebb/ (the `main` branch).
- **Branch previews:** https://mshomper.github.io/ebb/preview/ lists every other branch, each at `/ebb/preview/<branch>/`.
- **On this PC:**
  1. Choose the branch in GitHub Desktop.
  2. Double-click `play.cmd` in the repo folder. It starts a small local server (nothing to install), opens the game in your browser, and uses the first free port from 8080 to 8099.
  3. Close its window to stop.

The corner badge shows which build you are looking at: `local · <branch>`, `preview · <branch> · <commit>`, or `build <commit>` on the live site.

### Address switches

Add these to the address (for example `…/?island=two-ponds&day=8`) to test things quickly.

| Switch | What it does |
|---|---|
| `island=two-ponds` | Start on Two ponds instead of the Starter island |
| `seed=N` | Another seed for the same island recipe |
| `day=N` | Start a new world N game days in (7 a season; `day=8` is early summer) |
| `weather=clear`, `cloud`, `rain` or `mist` | Preview one kind of weather |
| `sandbox` | Unlock the spring tool now (normally a later gift) |
| `frogscale` | Frogs at true size around the pond, with a panel to compare sizes and close-up views |
| `tier=low`, `medium`, `high` or `ultra` | Force a quality tier |
| `debug` | Keep console errors and expose the game to the browser console, for tools and checks |
| `flora=0`, `ripplerain` | Hide the plants; ring the water with rain in any weather |

### Local test pages

Open these at `/tools/` while running locally. They are for checks that run on your own machine.

| Page | What it checks |
|---|---|
| `unit-tests.html` | Every unit test in one run: the core, terrain, water, growth, the journal, creatures and islands |
| `determinism.html` | The same seed builds the same island on every thread (`?island=` for another island) |
| `frame-timing.html` | The island live, with a graph of how long each drawing step takes on the graphics card |
| `growth-lab.html` | 14 game days of growth on a copy of the island, with charts and a check that two runs end the same |
| `water-lab.html` | The live water's volume, wet area, flow and cost, with buttons that sculpt near the spring and pond |
| `sky-lab.html` | The island at any hour and season, without moving the world clock |
| `palette-lab.html` | Tune a palette with a before and after divider, an eyedropper and sliders |
| `texture-lab.html`, `rock-lab.html` | Prepare the ground photo scans; compare rock tilings and scans |
| `sketch-lab.html` | Every journal field sketch at each stage: pencil, ink and wash |
| `terrain-brush-bench.html` | Island building, brush strokes and settling, timed against their budgets |

## What's here

| Path | What it is |
|---|---|
| `index.html`, `play.cmd` | The game page, and the double-click launcher for this PC |
| `src/` | The game: `core/` (clock, seeded random numbers, events, store, workers), `world/` (terrain, water, growth, journal, creatures), `sim/` (the hourly tick), `render/` and `shaders/` (WebGPU passes and WGSL), `input/`, `ui/` |
| `recipes/` | Every tunable number: land shapes, flora, species, palettes, world settings and quality tiers |
| `tools/` | The local test pages above |
| `docs/` | 23 architecture docs, starting with [01 Vision and pillars](docs/01-vision-and-pillars.md); see the [docs index](docs/README.md) |
| `brand/`, `assets/` | The icon, favicons and identity review page; the ground's photo scans (CC0, credited in `assets/textures/CREDITS.md`) |
| `CLAUDE.md` | Working rules for Claude Code sessions on this repo |

## Pillars

1. **Shape**: sculpt land and water. Every action can be undone.
2. **Grow**: plants, moss and lichen grow by real rules.
3. **Welcome**: creatures are attracted, never bought.
4. **Tend**: refine the ecology to make them happy.
5. **Return**: the island advances while you're away.

## Tech

- Raw WebGPU and WGSL, no engine
- Plain JavaScript ES modules, no build step
- A deterministic, seeded simulation on an hourly tick, built so that offline catch-up (S7) replays the same world
- Desktop first; phones and tablets through WebGPU with quality tiers
- Hosted on GitHub Pages
