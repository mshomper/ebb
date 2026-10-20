# 20 — Roadmap and vertical slice

> The build order for ebb. The first target is a vertical slice: one small island that already shows every pillar working together at small scale. After Matt approves the slice, the game grows tier by tier, following the creature roadmap. This doc also explains how to feed the doc set into Claude Code sessions so each session has exactly the context it needs.

## Locked decisions

- Nothing from a later milestone is built until the milestone before it is click-tested and approved.
- The slice is desktop-first but must already run with touch input on a phone, at the low quality tier.
- The slice has no human structures and no audio; both start in M2.
- Each milestone ends with a short click-test list for Matt and a local `tools/` page for anything numeric.
- Each milestone lands on its own branch and merges to main only with Matt's approval.

## How it works

```mermaid
flowchart TD
    M0[M0 Foundations] --> M1[M1 Vertical slice]
    M1 --> M2[M2 Pond tier complete]
    M2 --> M3[M3 Meadow and seasons]
    M3 --> M4[M4 Woodland and first expansion]
    M4 --> M5[M5 Wetland shore]
    M5 --> M6[M6 Night tier and polish]
    M6 -.-> M7[M7 Headland expansion, after v1]
```

### M0 — Foundations

The skeleton everything else hangs on. No gameplay yet, but it should already look calm.

- `index.html`, brand icons in the head, WebGPU feature detection with a friendly message when it is missing.
- `src/core/`: GPU device, world clock with time flow, seeded random numbers, event bus, store, worker pool.
- `src/render/`: frame graph, diorama orbit camera, HDR target, a placeholder tonemap.
- A flat placeholder island and a plain sky, so the camera and frame graph can be seen working.
- `tools/frame-timing.html`: live per-pass timing graph Matt can run locally.

Click-test: the page opens on desktop and phone, the camera orbits, pans and zooms smoothly with mouse and with two fingers, and the timing page shows steady frame times.

### M1 — Vertical slice

One island, everything in miniature. Built in seventeen steps, each its own click-test. G1 to G3 (ground detail) were added in October 2026 after the realism review; they upgrade S1's surfaces and sit between the original steps. S4 (water) was split into S4a to S4c in October 2026 so each piece stays click-testable, with realism a priority. J1 and J2 (the field journal) were added in October 2026, before frogs, because the journal is how the player reads the whole island, plants included, not a page per creature:

| Step | What appears | Main docs |
|---|---|---|
| S1 | Sculptable heightfield island with grass, sand, soil and rock paint; undo and redo | 08 |
| S2 | Physical sky, sun and moon moving with the world clock, shadows, day and night, plus a minimal seasons and weather step (season index, day length, light rain, frog and reed dormancy) so catch-up across seasons works | 06, 10 |
| S3 | Palette-last tonemap with two palettes ("dusk" and "meadow morning"), tuned toward realism, and a soft outline | 05, 04 |
| G1 | Textured ground: CC0 scanned detail maps per material (calibrated in `tools/texture-lab.html`), texture arrays with GPU mips, height blending, micro-normal lighting | 22, 08 |
| G2 | No tiles, no stretch: hex tiling, triplanar on steep slopes, macro variation, ground quality-tier settings | 22, 19 |
| S4a | Water you see: analytic tide, the GPU shallow-water simulation coupled to sculpting, the starter spring, and physically based water drawing (Fresnel sky reflection, sun and moon glints, refraction, Beer-Lambert depth color, flow-mapped ripples, gentle sea swell); `tools/water-lab.html` | 07 |
| S4b | Water the island knows: the deterministic water summary (priority-flood), the pond refill nudge, pour and drain tools, spring placing (built, locked until the dragonflies' gift; `?sandbox` opens it), the live readback for creatures, tide events for ecology | 07, 11, 12 |
| S4c | Water optics and wet ground: sky probe with specular mips, screen-space reflection on high, caustics, foam, ripples from rain and creatures, the visual wetness pass with drying tide flats | 07, 06, 08 |
| G3 | Wet ground: roughness and specular, damp darkening and puddles in rain (reads S4c's wetness pass and sky probe) | 22, 06 |
| S5 | Shipped grass, reeds, water lilies, yellow flag iris and sea thrift, each growing and spreading on its own ground, with the Plant tool and `tools/growth-lab.html` | 10, 14 |
| J1 | Field journal v1: the book button, a page for every living thing on the island that fills from what happens there, notes on the island and in the journal, tap a plant to name it | 13, 15 |
| J1.5 | More to explore: tap the ground too (soil, sand, rock, moss, fresh water, shore) and a Ground section; Show me rings a page's example nearest the middle of your view (first built as a camera glide; since J2a the camera stays put); field notes, your island's story and four "?" moment frames per page; the Almanac; `?day=N` to start a new world later in the year | 13, 15 |
| J1.6 | Field sketches: a drawn illustration for each page, in pencil until known, then inked | 13, 15 |
| J2a | The journal's Web: what needs what, in bands (ground, plants, animals, you); links inked once seen on the island, in one journal ink; names not yet seen are a pencil "?" | 13, 15 |
| J2b | The "show where" wash: opening a page washes the island in one journal ink with an inked edge, strong where the species lives and pale where it would do well, painted after the palette; the camera stays where it is; an unseen species gets two or three pencil circles a little off the spot, a hint rather than the answer | 13, 05, 15 |
| S6 | Frogs: needs, arrival, settling, behavior, presence (a list of sources, the camera first), feeding for trust and naming; midges and frogs get journal pages and sketches. In three pieces: S6a frogs arrive (the midge field, frog habitat and the arrival arc in the hourly tick, the journal's stages, posed bodies, `tools/ecology-lab.html`); S6b the frog you see (baked body, motion, the chorus, the midge swarm, presence); S6c feeding, trust and naming | 11, 12, 23 |
| S7 | Autosave, reload, and offline catch-up with the "while you were away" reveal | 02, 18 |
| S8 | Minimal HUD with drawn icons, touch layout on phone, low quality tier | 15, 19 |

**Signed off October 20, 2026:** Matt passed all eight checks below together, on desktop and on an iPhone (tools/slice-review.html). M2 is the current target.

Slice acceptance, all together:

- Sculpt a dip near the spring. Water fills it and finds its way to the sea.
- Watch for a few game hours. The tide visibly ebbs and returns; reeds creep along the wet edge.
- After enough reeds and water, a frog visits, then settles; you can feed it and give it a name.
- Open the journal: every plant on the island has a page that says, in words, where it grows and what it likes, and the notes tell what changed.
- Switch palettes. The whole scene changes mood instantly, and the light still behaves the same.
- Orbit in close at a low sun, then let it rain. Sand, rock and soil read as real material, show no tiling, and turn dark and glossy with puddles in the rain.
- Close the tab, come back the next day. The island has moved on, and a short calm reveal shows what changed.
- The same steps work on a phone with touch, at lower detail.

### M2 — Pond tier complete and the meadow islet

- **First step: the Cliff tool** (decided October 2026). Terrace and Cut modes that build or carve level shelves with sheer rock faces, painted rock that stays sheer (talus about 82 degrees), full mesh detail near cliffs, and a shadow offset for near-vertical faces. Built first so it lands as early as possible without interrupting the slice (docs 08, 15, 04, 19). First planned as available from the start; since October 20, 2026 it is **the frogs' gift** (doc 12), replacing their water lily seed, with `?sandbox` and `?cliffs` opening it for testing. Branch `m2-cliff-tool`: built October 20, 2026 as Sculpt chips (Terrace and Cut beside Raise, Lower, Flatten and Stone), in review, together with **waterfalls**: water running over a shelf's edge is drawn as volumetric droplet water near the eye (screen-space fluid) and as a curtain further off, with foam where it lands (doc 07). Their sound is a later step, once the audio's flowing-water input is wired to the sim.
- Minnows (schooling), dragonflies (darting flight) and turtles (basking) join the frogs. Minnows come by themselves to a still pool with a deep spot of about 1 m; turtles to a warm pond with a sunny stone, and better with a log (doc 12; turtles moved here from the shore tier on October 20, 2026).
- Gifts (progression agreed October 20, 2026, doc 13): the frogs' Cliff tool, the minnows' pondweed, the dragonflies' stream tool, the turtles' carry-a-log. Driftwood washes up from the naturalist's notes at 10 finds, and toads and slow worms (finds) live under logs. The gift card and the progress module are built (`src/world/expansion.js`); the frogs' gift moves from lilies to the Cliff tool.
- The Tier 1 milestone: the meadow islet rises at low tide with a sandbar to the main island, dry only at low tide (doc 13, "The meadow islet in play").
- Field journal with photo mode; photographs fill species pages.
- Tuning panel v1: live sliders for species and flora recipes, saving recipe files.
- First audio pass: water bed, wind bed, frog voice with chorus (doc 17).
- First human touches: stepping stones and one lantern, so the icon's dusk scene can be recreated in game.
- Presence rung 2, the seat (doc 23): "sit here" at eye height, where trust grows fastest; it brings the ground-level view up to standard before the walker.

### M3 — Meadow, seasons and the woodland knoll

- Bees, butterflies and songbirds; flowering plants and a meadow mix.
- Full seasonal look: color shifts, blooming, leaf drop, frosty winter mornings (no snow).
- Full weather: rain, mist, wind, and the drier or wetter leaning.
- Paths and stone walls, with moss growing over them in time.
- Presence rung 3, the walker (doc 23), may start here and finish in M4: a small traveler you step into and walk along paths and over the bridge, and across the sandbar to the meadow islet at low tide. It is large enough to be scheduled as its own step when M3 is planned.
- The Tier 2 milestone: the woodland knoll rises beyond a channel, and the bridge gift arrives with it.

### M4 — Woodland and the tide flats

- Trees grown by space colonization, with shrubs and ferns.
- Hedgehogs, squirrels and owls; shelter in hollows, logs and walls.
- Moss and lichen spreading by reaction-diffusion, including sea-cliff lichen in bands on rock faces in the spray zone (doc 10).
- The Tier 3 milestone: the shore widens into tide flats and a marsh spit.

### M5 — Wetland shore and the outer skerry

- Herons, oystercatchers and otters; tide flats become a feeding ground, and oystercatchers feed on the shore finds.
- More lanterns.
- The Tier 4 milestone: an outer skerry and a long sandbar exposed at low tide.

### M6 — Night tier and polish

- Fireflies, bats, and migrating cranes as rare seasonal visitors.
- Night lighting polish, lantern glow, firefly light; the Moonlight palette as the bats' gift.
- Presence rung 4, the camp (doc 23), here or with the M7 chapter: a bedroll, a fire and a home point that keeps a gentle presence while you are away.
- The journal year page (all sixteen species photographed and all four seasons passed).
- Mobile tier tuning, accessibility pass, store page and promo capture.

### M7 — Headland expansion (after v1)

- A new chapter after the year page, so the sixteen-species year and the five land pieces stay as designed (docs 12, 13).
- A Headland land piece with sea cliffs of about 6 to 10 m, cliff-top turf and a sea stack.
- Puffins (burrows in cliff-top turf, sand eels offshore) and kittiwakes (ledge colonies on sheer faces above water) first; feral goats later on the headland's heights.
- Placed rock pieces for arches and sea caves, which the heightfield cannot hold.

## Data and interfaces

### Branch and version naming

- Branch per step: `m1-s4-water`, `m2-journal`, and so on.
- Version tags: `v0.1.0` for M0, `v0.2.x` across the M1 steps, `v0.3.0` for M2, then one minor version per milestone.

### Feeding the docs to Claude Code

Each session starts with the same three files, then only the docs for the step:

1. `CLAUDE.md` (always)
2. `docs/01-vision-and-pillars.md` (always)
3. `docs/03-tech-stack-and-module-map.md` (always)
4. The step's main docs from the table above
5. `docs/20-roadmap-and-vertical-slice.md` to know where the step sits

A starter prompt for a step:

> Read CLAUDE.md, docs/01, docs/03, docs/20 and docs/07. We are on M1 step S4. Analyze what exists in the repo, then propose the changes for S4 with a short visual plan before writing code.

## Algorithms and shaders

None here. Each step's techniques are in its system doc.

## Tuning knobs

None here.

## Performance budget

Every milestone must hold the targets in `19-performance-and-quality-tiers.md`. If a step breaks the budget, fixing that comes before the next step.

## Acceptance checks

Listed per milestone above. At the end of each milestone, Matt should also be able to say yes to all four whole-game checks in `01-vision-and-pillars.md`.

## Open questions

- Is reeds the right first plant, or would you rather the slice show a small tree growing, which is more dramatic but much heavier to build?
- Once the slice works, would you like a 30-second capture of it, like the F13LD promo, before moving to M2?

## Depends on / feeds into

Depends on every system doc. The step table above is the map back to them.
