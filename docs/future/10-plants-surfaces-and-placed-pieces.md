# F10 — Plants, surfaces and placed pieces

> The starter island already has six plants, four painted grounds, a computed moss layer, water that knows ponds from hollows from the tide band, and a moss-on-rock link in the journal. This doc looks at how to add more variety to the island early and cheaply, using the systems that exist rather than inventing new ones: a shore that zones itself by the tide, a driftline the sea rewrites, a handful of plants that fit the current growth code once it can read ground type, and placed pieces (stones and logs) that give creatures new places to live. Each section says what exists in the code today, what would change, and what it costs. It pairs with F11, which covers the creatures these places would hold.

**Status:** Largely built and merged to main. The ground axes (painted sand, rock and soil with grass counting as soil, slope, height above mean sea level) and two plants on existing shaders, marsh marigold (iris shader, with its own cup flowers and kidney leaves) and sea campion (thrift shader), are built. Every older plant now asks for its ground too, and only grass, reeds and water lilies start on a new island: the others arrive as seeded volunteers (`src/world/growth/volunteers.js`, pace in `recipes/world/growth.json` volunteers), and the Plant tool offers each once the journal has seen it (Matt, October 20, 2026). The Stone brush (boulders as stamps, a Sculpt mode) is built (scheduled before M2 by Matt, October 19, 2026). Z1, the shore data (graded shore height in the water summary, shore zones from `recipes/world/shore.json`, `tools/shore-lab.html`), and Z2, the shore's look in the game (wrack and kelp on rock, black lichen in the splash zone, ripples in the sand, tidal mud), are built. Wrack uses the moss scan at its own albedo (no CC0 seaweed scan exists). Z3, the strandline (`src/world/water/strandline.js`, `src/shaders/lib-shore.wgsl`), is built too: each recent high tide leaves a line of dried litter and broken kelp at its reach, swept up by any higher tide, and kelp is drawn as broad blades lying downslope at the lowest tides. Wrack fronds (bladderwrack, drawn close up over the mat in lib-shore wrackFronds, off on the low tier) followed. Loose stones, the first placed piece, are built (`src/world/pieces`, `recipes/world/pieces.json`): the naturalist's reward at six finds brings a seeded handful by fresh water, Sculpt's Loose stone mode sets and removes more (cap 24, undoable; the old Stone chip is now Boulder), and a click tips one up over its damp patch with a card line and a first-lift journal note; nothing lives under them yet, and the save keeps them in a `pieces` section (format 5). Driftwood is built (`src/world/pieces/driftwood.js`, pieces.json `driftwood`): the naturalist's reward at ten finds, after which each high tide may leave a log or two on its strandline (0.6 to 1.8 m, seeded by the tide like the shells, unsaved, at most three at a time, swept away by later tides), drawn as weathered silver-grey wood with grain, checking cracks, knots and broken ends; a click rolls one over to show the damp sand beneath. Carrying, the turtles' gift, is built with it but given by nothing yet: a log carried off the strand is kept as a piece of kind `log` (cap 8, format 5 unchanged), and a loose stone can be carried too, all undoable. Next: a barnacle rock scan and the rest.

## Decided so far

Matt, October 19, 2026:

- Look for inexpensive ways to add depth early, and for ways to add things downstream without reinventing the engine.
- The starter island is small, but there is room to shape spaces for several species.
- Placed items (stones, logs) are wanted: they add variety to the island and open up more creature options. Lifting a stone to see what lives under it is an interesting idea.

## What the island has today

Read from the code on October 19, 2026:

| Area | What exists | Where |
|---|---|---|
| Painted ground | Four weights per 0.25 m cell: grass, sand, rock, soil, summing to 255. All four channels are used. | `src/world/terrain/heightfield.js` (`material`), `brushes.js` (`LAYER_INDEX`), `landform.js` (`writeWeights`) |
| A spare ground texture | `tex.ground`, four channels, created but read by nothing. Doc 08 meant it for wetness, damp, moss and path wear, which later got their own textures. | `src/world/terrain/index.js` |
| Ground detail | A scanned texture array of six layers (grass, sand, rock, soil, moss, cliff). The shader holds five blend weights in fixed arrays. | `src/render/ground-detail.js`, `recipes/world/ground-sources.json`, `src/shaders/lib-ground.wgsl` |
| Computed moss | Grown from the water summary (damp hollows, fresh banks, never the tide band), uploaded as a texture, and blended in as the fifth ground weight. | `src/world/growth/moss-live.js`, `render/passes/terrain.js` |
| Tide band | A yes or no flag per cell: within about 0.69 m of mean sea level and connected to the sea. No graded height above low tide. | `src/world/water/summary.js`, `src/world/tide.js` |
| Water classes | Dry, sea, still, slow, running and damp, with a basin id for ponds and hollows. No salt-water pools and no basin area table. | `src/world/water/summary.js` |
| Plants | Individual plants (reeds, lilies, iris, thrift) as saved records with one shader each; cover plants (grass, rushes) as a share per 1 m square. | `recipes/flora/`, `src/world/growth/`, `src/render/passes/flora*.js`, `grass.js` |
| Plant suitability | Reads four axes only: water depth, still water, moisture and salt. Not ground type, slope or height above the tide. | `src/world/growth/coarse.js` (`suitability`), `habitat.js` |
| Rock and stones | Rock is painted heightfield, never geometry. The spring outcrop is a set of seeded domes lifted into the height and painted rock. | `landform.js` (`makeOutcrop`, `stoneLift`) |
| Placed objects | None yet. Doc 09's stepping stones (a library of 16 rounded slab shapes) and lantern are planned for M2. | `docs/09-structures.md` |

## Shore zonation

### The idea

Real rocky shores band themselves by how long each height spends underwater: black lichen in the splash zone, then channelled wrack, spiral wrack and bladderwrack with barnacles, and kelp that only shows at the lowest spring tides. Sandy shores show ripple marks and lugworm casts instead. Zonation would make the shore read as alive from the first minute, and it needs no planting and no player action beyond shaping the coast.

### How it fits what exists

- **The same shape as moss.** `moss-live.js` turns the water summary into a cover per cell, uploads it as a texture, and the terrain shader blends it in as a ground weight. A zonation module would do the same: summary in, a few bands out, one texture, extra ground weights.
- **Where it lives.** The spare `tex.ground` texture has four free channels. Two of them (rock-shore band, sand-shore band) could carry zonation without touching the painted channels or the save. Path wear (doc 09) can take a third later.
- **Graded height.** The tide band flag is yes or no, so zonation needs height relative to the tide. The cheapest source is the band step in `summary.js`, which already compares the bed height with sea level. Adding a byte for "height within the band" there gives the simulation and the journal the same answer. The shader can also derive it from height and the tide amplitude for the look alone.
- **Rock or sand decides what shows.** The painted rock and sand weights are already in the shader. Seaweed and barnacles go on rock in the band, ripples and casts on sand in the band.
- **The moon matters.** Kelp shows only below the usual low tide, so it appears on spring low tides (doc 07's moon-driven swing). That gives the lowest tides of each moon something to show.
- **Scans.** New CC0 scans (wrack, barnacled rock, rippled wet sand) join `ground-sources.json` as array layers.

### What it costs

- A new computed-layer module, a binding, and the ground detail arrays widened from five to seven or eight weights in `lib-ground.wgsl` (the fixed arrays and per-layer cases there are the known change).
- A byte of graded band height in the water summary.
- The journal's Shore page gains zone lines (`journal-island.json`), and the web gains links such as "barnacles on rock in the tide band" through its existing `flag:` hook.

## The driftline

Each high tide leaves a line of wrack (seaweed, shells, bits of driftwood) along its highest reach, and the next tide rearranges it.

- **Where:** the edge of the band at the last high tide's level. `tide.js` already gives the level and emits `tide:turned` at high and low.
- **What:** a soft stripe in another free channel of `tex.ground`, plus a few small props (shells, a stick) placed by a seeded hash of the tide's index, so every device agrees and nothing is saved.
- **Why:** a place the sea changes twice a day, a home for shore finds (F11), and the source of the driftwood idea below.

## New ground without new paint

Shingle and mud would add variety, but a new painted material is the costliest kind of change: the four painted channels are full, so it needs a second material texture or a format change, plus brushes, saves, `writeWeights`, `sampleMaterial` and the journal's `paintedKind`. Two of them can be computed instead:

- **Mud:** soil in the tide band, or soil that stays wet, reads as mud. It comes from what is already known (painted soil, the band, the moisture field) and needs a detail scan and a weight, not paint.
- **Shingle:** sand on steep, exposed shore turns to shingle. Same approach.

If painted shingle or mud is ever wanted, that change is best done once, together with any other new paint, and planned with the save migration.

## Plants

### The one change that opens most new plants

Suitability reads only water depth, still water, moisture and salt. Adding three axes, **ground type** (the sand, soil and rock shares), **slope**, and **height in the tide band**, to `coarse.js` (`AXES`, `groundAtCell`) and `habitat.js` lets new plants say where they belong in data. It is a contained change in two files, and it also lets the existing plants be stated more precisely (thrift on rock and sand, reeds on soil).

### Candidates, by how well they fit today

| Plant | Where | Kind | Fits today? |
|---|---|---|---|
| Duckweed | Still, shallow fresh water; spreads in summer | Floating, like lilies | Yes: the lily route (depth and still water) works as is. Needs a shader, or a lily shader variant with tiny pads. Frogs could hide under it via `perches.js`. |
| Marsh marigold | Wet soil at pond edges; bright yellow in early spring | Clump, like iris | Yes for habitat. Spring color the island lacks. |
| Marram grass | Sand above high tide; traps blown sand | Clump of blades | Needs the ground-type axis. |
| Sea campion | Rock and shingle near the sea; white flowers | Low cushion, like thrift | Needs the ground-type axis. |
| Glasswort | Salty mud in the tide band | Cover | Needs the ground axis and more cover channels (below). |

### Two code costs to know about

- **One shader per plant.** Each individual plant has its own shader today (`flora-draw.wgsl` for reeds, `flora-lilies`, `flora-iris`, `flora-thrift`). New plants should first try an existing shader with recipe values (marsh marigold on the iris shader, sea campion on the thrift shader). A new shader is justified only when the silhouette is new.
- **One rival to grass.** Cover plants assume exactly one besides grass: the cover texture's channels are grass, rushes and the lush look, with only alpha free, and `firstCover` and `yieldTo` assume a single rival. Before a second cover plant, cover should become a list of any length (a texture array or a second texture). This unblocks glasswort now and the meadow mix, clover and heather later.

Seaweed is better as zonation than as a plant: the growth code treats the sea as 9 m deep and the blade shader skips deep water.

### Every new plant also needs

- A recipe, a line in `recipes/index.json` and `recipes/world/growth.json`.
- Journal words (`journal.json`) and web links (`journal-web.json`), which are data.
- A hand-drawn sketch (`src/ui/sketches/living.js`) and an icon (`src/ui/icons/icons.js`), which are code. The sketch is the main per-plant cost, and worth it.
- An entry in the Plant tool (`src/ui/tools.js`), and refusal lines (`plant-tool.js`) if the defaults don't read well.

## Placed pieces: stones and logs

### Two ways to place something

| | Stamped into the ground | Placed as a piece |
|---|---|---|
| What | A boulder lifted into the heightfield and painted rock | A separate object resting on the ground: a loose stone, a log, driftwood |
| Exists today | Yes: the spring outcrop's `makeOutcrop` and `stoneLift` | No: doc 09's structure system is not built |
| Saved | Free: edited chunks already save height and paint | A small record per piece (kind, position, turn, seed) |
| Moss and lichen | Free: it is rock, so `mossOnRock` and later lichen apply | Its own weathering, per doc 09's hourly rule |
| Can be lifted or moved | No | Yes |
| Shadows and ground detail | Free | Drawn like other props |

**Proposed:** both, for different jobs.

- **Boulders as stamps.** A Stone brush that drops a seeded boulder into the ground reuses the outcrop code, costs nothing to save, and is immediately rock for moss, lichen, basking and shelter. It also answers doc 08's open question about boulders: placed on purpose with this brush, not automatically with rock paint.
- **Loose stones and logs as pieces.** These need doc 09's piece system, which stepping stones already require in M2. Building it once for stepping stones, loose stones, logs and driftwood is the efficient path. Shapes come from doc 09's 16-slab stone library and, for logs, from the creature body bake (`bakeBody` is generic and can bake a rigless log from blended capsules with bark noise).

### How pieces meet creatures

Doc 09's rule holds: creatures never read structures directly. A piece writes into the 1 m ecology grid, such as **shelter under** (a stone or log), **basking** (a sunny boulder or log top) and **damp underneath** (a log's shade). Species read those fields. One new field, "shelter under", serves toads, slow worms, wood mice, beetles and later the hedgehog's day nest.

### Logs over time

A log is a slow story, which suits F04's deep clock: bark loosens, moss climbs, fungi fruit in autumn, it softens and eventually crumbles into a mound that grows over. Decided October 20, 2026: driftwood washes up on the driftline at 10 finds (the naturalist's notes), and the turtles, now in the pond tier, give the gift to carry a log and set it down where you want it (doc 12).

### Lifting a stone

Tap a loose stone and it tips over, showing what was underneath, then settles back after a moment. What is underneath comes from a seeded hash of the stone and the hour, so there is nothing to save, and it follows the ground's conditions (damp, shade, how long the stone has sat). Presence (doc 23) applies: whatever was under it reacts as if a hand had come close. The tap uses the existing pick path (`journal/index.js` `cardAt`), with a stone lookup ahead of plants.

## What it would change

Listed only; Matt applies these later.

- **Doc 07 (water and tide):** graded height in the tide band; the driftline at the last high tide's reach.
- **Doc 08 (terrain):** the Stone brush answers the boulder question; mud and shingle as computed looks; `tex.ground`'s channels assigned to zonation, the driftline and path wear.
- **Doc 09 (structures):** the piece system broadened from stepping stones to loose stones, logs and driftwood; pieces write shelter under, basking and damp underneath.
- **Doc 10 (growth):** the three new suitability axes; cover as a list of any length; new plant candidates.
- **Doc 11 (ecology):** the shelter-under, basking and damp-underneath fields.
- **Doc 12 (creature roadmap):** driftwood logs before the turtles' tool.
- **Doc 13 (progression):** the journal's Shore page zone lines; new web links.
- **Doc 22 (ground detail):** new scans (wrack, barnacled rock, rippled sand, mud, shingle); the detail arrays widened.
- **Doc 18 (saves):** piece records.
- **Doc 19 (performance):** the extra ground weights and piece draws per tier.

## Risks and guardrails

- **Shader growth.** Widening ground weights costs fill rate on phones. Zonation can drop to a single tinted band on the low tier.
- **Clutter.** Pieces must stay few and natural. Soft caps, like doc 09's, apply.
- **Undo.** Every placement and stamp goes through the existing undo, per the Shape pillar.
- **Saves.** New piece records need a save version bump and migration.

## Open questions

- Should boulders be stamped into the ground with a brush, placed as loose pieces, or both?
- Should driftwood logs wash up on their own early, before the turtles' log tool? (Decided October 20, 2026: yes, at 10 finds; the turtles' gift carries them.)
- Are mud and shingle as computed looks enough, or do you want to paint them?
- Which new plants would you most like on the starter island first?
- Should lifting a stone be a tap, or something you do only up close?

## Depends on / feeds into

Depends on docs 07, 08, 09, 10, 11 and 22. Feeds F11 (finds live in these places), F04 (logs ageing), F06 (succession reads the new ground axes) and F09 (path wear takes a channel of the spare ground texture).
