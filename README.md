<p align="center"><img src="brand/ebb-icon.svg" width="160" alt="ebb icon: a small green island at dusk with a crescent moon and a heron in the shallows"></p>

<h1 align="center">ebb</h1>
<p align="center"><em>a tended island</em></p>

A cozy idler and living diorama built on raw WebGPU. Shape a small island, plant seeds, and make room for creatures. They arrive and settle when the ecology suits them, and the island keeps growing while you are away. When you come back, it has moved on without you.

The look is soft and natural: physical light, sky and water, ground built from scanned materials, and a gentle palette applied last. Everything grows from seeded recipes, so it can all be tuned without code.

## Where it is

The M1 vertical slice is built and signed off (October 20, 2026). Phase 1 of the keeper's camp, the first evening, is built and played through: a new island opens at dawn on the beach, and ten short beats teach walking, the spring and the first page, pitching the tent, gathering, laying and lighting the fire, shaping, and resting until morning. Next is the groundwork for Phase 2, the first season ([docs/future/13-keepers-camp.md](docs/future/13-keepers-camp.md)).

Everything built so far, step by step, is in **[docs/progress.md](docs/progress.md)**. The plan ahead is in [docs/20-roadmap-and-vertical-slice.md](docs/20-roadmap-and-vertical-slice.md).

There are two islands to start from: the **Starter island** (one large spring-fed pond under a hill) and **Two ponds** (a low island with two spring-fed ponds and three rain-fed marshes). The **Island** button in **Settings > Saves** switches between them, and each keeps its own save. **Saves** also backs an island up to a file, opens one, steps back to an earlier save, or starts the island again. On previews and local builds, **Settings > Tests** pretends you were away and checks recovery. Test links (`?seed`, `?day`, `?frogs`, `?minnows`, `?dragonflies`, `?damselflies`, `?plants`, `?cliffs`, `?stones`, `?driftwood`, `?autumn`, `?keepsakes`, `?nets`, `?sandbar`, `?hour`, `?trails`, `?intro`, `?nointro`) open throwaway islands that are never saved.

## What you can do in it

- **Sculpt, smooth and paint** the land; water always finds its way downhill. Sculpt's **Boulder** mode sets a boulder into the ground where you click; **Loose stone** sets a small stone that rests on it; **Terrace** and **Cut** build and carve level shelves with sheer rock faces.
- **Pour and drain water.** Place springs once they are unlocked (`?sandbox` unlocks them now).
- **Plant** reeds and water lilies from the start. Iris, rushes, sea thrift, marsh marigold, grey willow (a shrub of damp, fresh banks), sea campion (which needs rock by the sea) and gorse (a spiny shrub of dry, sunny ground) come to the island by themselves, and once the journal has noted one you can plant it too. The tool says why when the ground won't do.
- **Click anything** (a plant, the ground, the water) to name it, then open its page in the **field journal**. On foot, the same click walks you over first. Gather drift twigs, pebbles and flat stones into the pouches on the ground bar. Pages fill in from what happens on the island, in words, never numbers. The journal's **Web** shows what needs what, one thing at a time.
- **Look closely along the shore** at low tide for finds: anemones in rock pools, periwinkles on the weed, barnacles and mussels on the rock, lugworm casts and sand dollars on the sand, and pond skaters on the pond by day. Each one you click is kept in the journal, and the naturalist's notes follow your trail of finds: at the third kind, the sea starts leaving shells; at the sixth, loose stones turn up by the water, and you can click one to look underneath; at the tenth, driftwood starts washing up on the strandline after high tides.
- **Dig a pool about a meter deep** and minnows may come to it; dig a second, shallow pond with no fish and let reeds grow along its edge, and dragonflies will patrol it from the start of summer. At the very end of spring, azure damselflies come to any still pond with reeds and flutter among the stems through the summer. Feed scatters crumbs for the minnows once you have found them.
- **Go down** and walk on what you made: click to walk, double-click to hurry, drag to look around. Sit or kneel near a frog, feed it from your hand, click what's around you to look at it, cross a sandbar at low tide. **Go up** to shape again.
- **Look:** switch palettes, and change how fast time flows.

## Running it

You need a WebGPU-capable browser: Chrome, Edge, Firefox on Windows, or Safari 26 and later.

- **Live:** https://mshomper.github.io/ebb/ (the `main` branch).
- **Branch previews:** https://mshomper.github.io/ebb/preview/ lists every other branch, each at `/ebb/preview/<branch>/`: newest first (or A to Z), with a search box, a "new" tag for the last day, and branches already merged into main folded away at the bottom.
- **On this PC:**
  1. Choose the branch in GitHub Desktop.
  2. Double-click `play.cmd` in the repo folder. It starts a small local server (nothing to install), opens the game in your browser, and uses the first free port from 8080 to 8099.
  3. Close its window to stop.

A small tag under the clock dial shows which build you are looking at, `local · <branch>` or `preview · <branch> · <commit>`; on the live site it is at the foot of Settings as `build <commit>`.

### Address switches

Add these to the address (for example `…/?island=two-ponds&day=8`) to test things quickly.

| Switch | What it does |
|---|---|
| `island=two-ponds` | Start on Two ponds instead of the Starter island |
| `seed=N` | Another seed for the same island recipe |
| `day=N` | Start a new world N game days in (14 a season; `day=15` is early summer) |
| `weather=clear`, `cloud`, `rain` or `mist` | Preview one kind of weather |
| `sandbox` | Unlock the spring tool, the Cliff tool, Sculpt's Loose stone mode and carrying stones and logs now (normally gifts from the dragonflies, the frogs, the naturalist's notes and the turtles), and offer every plant in the Plant tool before it has come. The handful of loose stones that comes with the reward, and driftwood on the strandline, still wait for their rewards |
| `plants=all` | Start a new island with every plant, not only grass, reeds and water lilies (pondweed too) |
| `minnows=N` | A school of N minnows comes at once and is settled, in the biggest still water (its deep spot is not asked for) |
| `dragonflies=N` | N southern hawkers come at once and are settled over the biggest pond, any pond (no fish-free pond of yours asked for; starts on summer day 2, when they fly) |
| `damselflies=N` | N azure damselflies come at once and are settled at the biggest pond (starts on the last day of spring, when the first ones climb out) |
| `shells=rare`, or a shell's id (`nautilus`, `murex`, `cockle`, `turret`, `periwinkle`) | A test island whose strandline is thick with those shells, whatever the tide, so a rare one can be seen and found |
| `keepsakes` | A test island where every high tide leaves three keepsakes on its strandline (normally about one a tide on the whole island, once the shells have come), up to twelve at once. Click one for its card; Leave it to the sea takes it away. In the browser console, `ebbKeepsakes.look(0)` brings the camera to the first one |
| `trails` | A test island whose trails already have stops: five keepsake families kept (so the net is given), a rare one, a holed stone noticed, and two places made (a deep pool and a cove). Open the journal, then Trails |
| `nets` | A test island with the general net already given (normally at four keepsake families kept): Water, then Net, and click the shallows at low tide; a net cast here is full at once, so click it and Lift to see a haul. In the browser console, `ebbNets.look()` brings the camera to the net |
| `cliffs` | Opens Terrace and Cut at once (normally the frogs' gift), on a test island with a cliff scene built by real Terrace and Cut strokes: two stacked terraces with a spring at the head of a notch on the upper shelf, so after about a minute it pours over both faces as waterfalls, and a carved channel (`cliffs=nospring` leaves the spring out) |
| `stones` | Opens Sculpt's Loose stone mode at once (normally the naturalist's reward at six finds), on a test island where the reward's handful of loose stones has already come by the water |
| `driftwood` | A test island where driftwood washes up on the strandline after high tides (normally the naturalist's reward at ten finds) and a log's or a loose stone's card offers Carry (normally the turtles' gift). Add `&stones` for loose stones to carry too |
| `sandbar` | A test island with a sandbar and a small islet off the shore, built by real Terrace and Cut strokes, so the walker's low-tide crossing can be tried before the meadow islet exists |
| `intro` | A test island that runs the first evening from the start, on the beach at dawn. `intro=dusk` (or any beat: `landfall`, `spring`, `page`, `pitch`, `gather`, `ring`, `shape`, `dusk`, `rest`) starts at that beat with the earlier ones done; `dusk` and `rest` open near sunset |
| `nointro` | A test island as if the first evening was skipped: the camp is ready and you stand at the tent flap |
| `hour=H` | Start a new world at that hour of the day. Low water falls at 6 and 18, so `sandbar&hour=7` opens with the bar dry and the tide starting to rise |
| `autumn` | A test island that opens at 7 in the morning on its first misty autumn day with fungi grown in, with a kept log laid near the view and the camera on it: fungi on the log and dewy webs in the tall grass around. Add `&debug` for `ebb.debug.autumnMorning()` (jump to the next such morning) and `ebb.debug.keptLog()` (lay another log near the view) in the console |
| `cliffdetail=0` | Turn off the full mesh detail near cliffs, to compare |
| `falls=0` | Turn off the waterfalls, to compare |
| `fallsfluid=0` | Draw waterfalls as curtains everywhere instead of droplet water near the eye |
| `fallsdbg` | Put the waterfall lips found each second on `window.ebbLips`, for the console |
| `frogscale` | Frogs at true size around the pond, with a panel to compare sizes and close-up views |
| `tier=low`, `medium`, `high` or `ultra` | Force a quality tier |
| `debug` | Keep console errors and expose the game to the browser console, for tools and checks. `ebb.debug.damselflies()` skips ahead to late spring (if they are not flying) and brings a few damselflies to the pond; `ebb.debug.skipTo(day)` and `ebb.debug.summon('minnow' or 'dragonfly' or 'damselfly', n)` do each half |
| `flora=0`, `ripplerain` | Hide the plants; ring the water with rain in any weather |
| `spring=spawn`, `tadpoles`, `froglets` or `toad` | That stage of spring at the warm shallows nearest the frogs (or the view): two clumps of frogspawn, a cloud of tadpoles, froglets climbing out, or a toad walking from dry ground to the water. Add `&frogs=6` for frogs too, and `&hour=19` to see the toad at dusk |
| `turtles=N` | N European pond turtles come at once and are settled at the biggest pond (starts on summer day 2, when they wake). Add `&stones` for loose stones to bask on |

### Local test pages

Open these at `/tools/` while running locally. They are for checks that run on your own machine.

| Page | What it checks |
|---|---|
| `slice-review.html` | The vertical slice's eight sign-off checks, each with steps, what you should see, a test link and Pass or Not yet; copies the results to paste to Claude |
| `unit-tests.html` | Every unit test in one run: the core, terrain, water, growth, the journal, creatures and islands. The long runs share all the cores (about half a minute); `?only=pond` runs one area, `?serial` runs them one after another |
| `determinism.html` | The same seed builds the same island on every thread (`?island=` for another island) |
| `intro-lab.html` | The first evening side by side with the game: jump to any beat with the earlier ones done, replay on a new seed, skip to dusk, read the beat and hint live, and see the camp pad, its lock edge, its slots, the boat line and the walker's start on this seed and over 60 seeds, checked for a stake and dry beach at the highest tide |
| `frame-timing.html` | The island live, with a graph of how long each drawing step takes on the graphics card |
| `cliff-bench.html` | What full mesh detail near cliffs and the waterfalls cost on high, medium and low: the cliff scene measured with detail on and off, then with its spring pouring over the edges, against the budgets |
| `catchup-bench.html` | Checks that time away gives the same island as time watched, and how long catch-up takes, from a new island with four reed seeds planted by the pond |
| `migrate-test.html` | Opens every sample island in `tools/save-samples` and brings it up to this build's save format, as the game does with an old save; each should open and, where a fingerprint is written down, still match |
| `icon-sheet.html` | Every item glyph by family in a card button, on the ground bar and at 20 px, light and dark, with the destination chips, the pouch bar, the composed seeds and treats, and which glyph each item id wears |
| `dial-sheet.html` | The clock dial drawn large through a summer day and at midday across each season, with the line it says under each |
| `growth-lab.html` | 14 game days (one season) of growth on a copy of the island, with charts and a check that two runs end the same |
| `water-lab.html` | The live water's volume, wet area, flow and cost, with buttons that sculpt near the spring and pond |
| `finds-models.html` | The finds' models at true scale, side by side: the anemone open and shut, the crabs (the hermit crab walking), the shells, the mussel pair gaping, the sand dollar, and the built barnacles and pond skaters; drag to turn them. New models are baked by `node tools/bake-find-model.mjs` (texture to vertex colors, simplified, set base down) |
| `artifact-models.html` | The nine keepsake artifacts (old bullet, carved piece, flat relic, blue crystal piece, bronze shoe, gold disc, painted jar, stone trinket, little bowl) side by side at true hand size in a 12 cm view, with triangle count, size and credit line under each; drag to turn them. Baked with `node tools/bake-find-model.mjs ... --size` (real size, base on y = 0, `--patina` for the bullet) into `assets/models/keepsakes/`, listed in `recipes/world/keepsake-artifacts.json` |
| `artifact-variants.html` | The artifact keepsakes morphed by seeded numbers (docs/future/12): 48 at a time as shelf sketches or models, for one base or all nine and one rarity or as the sea leaves them; each names and describes itself from its numbers. One up close to turn, with sliders for stretch, taper, twist, bend, barrel or waist, lean, rings, lobes, dents, wear, hue, strength, tint, crust, stains, bands, gilding and a cut, and marks (broken, paired, gilded) to switch on; a mock shelf of 16; and how many names, colours and objects turn up in 5,000 rolls. The generator is `src/world/keepsakes/families/artifact*.js`; `node tools/artifact-base-stats.mjs` re-measures the bases after one is re-baked |
| `keepsake-lab.html` | Keepsakes (docs/future/12), one family at a time: shells, stones, fossils, driftwood, feathers, bottles and artifacts. 48 seeds side by side as ink sketches (traced from each one's mesh and washed in its own colours) or as models, on the paper ground their rarity gets on the shelf; a mock shelf of 16; the tide and season that let rarer ones through; rarity chips to see one tier at a time; one up close to turn (a shell's coiling numbers and pattern on sliders, a bottle's message); and how often each rarity, kind and mark turn up in 20,000 rolls. Numbers live in `recipes/world/keepsakes.json` |
| `catch-lab.html` | The nets' living catches (docs/future/12, K6), one kind at a time: 24 seeds side by side, moving as they do on the haul tray or as the ink sketch their journal page is traced from, at each rarity; and what 10,000 hauls hold at a chosen tide, season and depth, with their keepsakes' rarity against the beach's. Numbers live in `recipes/world/nets.json` |
| `finds-sketches.html` | Every find's journal sketch in pencil, ink and wash, beside plant sketches to compare; the shapes are traced from the models by `tools/gen-sketch-outlines.mjs` |
| `walker-figure.html` | The walker's figure (W5) on a turntable and on test ground (flat, a 15 degree slope, a 30 cm shelf, water to wade), pacing back and forth at a creep, a stroll or brisk, with buttons for turning on the spot, Sit, Kneel, Feed, Go down and Go up, waiting above, every expression of the eyes, night, slow motion, set views and a colour view of the bones. Shows the model's size and the pose's cost per frame |
| `hen-lab.html` | The hen (docs/future/15, slice 1): each of her code clips on its own (Idle, Walk, Run, Scratch, Peck, Look down, Alert, slow motion, set views), and Life, her day on a test ground with her 6 m wary ring drawn: click to put the walker down, or have it walk to her, and watch her freeze and run. `?clip=peck&hold=0.1` holds a clip at a moment |
| `footstep-shortlist.html` | 34 CC0 footstep recordings from Freesound for the walker, grouped by ground (grass, dry sand, wet sand and mud, rock, shallow water, pebbles), each with a preview, what to listen for and the file name to save it under; keep or set aside each one and save your picks |
| `walk-lab.html` | Where the walker can stand at any tide, on the island from above with the test sandbar: click to stand, click to walk, double-click to hurry, a frog to creep past, and a tide slider that opens and closes the bar, all with the mouse. Runs without WebGPU |
| `music-lab.html` | The music: play the instruments, hear a piece performed from its notation, watch the director choose through a game day, hear the theme candidates, and grow pieces seed by seed (Engine tab) |
| `music-render.html` | Grows a piece as the game would, plays it through the game's music sound and saves it as a WAV, trimmed and leveled to -18 LUFS |
| `unit-tests-audio.html` | The audio unit tests in one run |
| `freesound-shortlist.html` | 110 CC0 field recordings from Freesound for the island's beds and one-shots, each with a preview, what to listen for and where to save it; mark each one and save your picks |
| `shore-lab.html` | Shape and paint the coast and see the shore zones it makes (kelp, wrack, lichen, wet sand, mud), with a sea-level slider for each tide, and a **Show sheltered shore** overlay that warms the coves you carve (the cove field, which brings more keepsakes to sheltered shore) and shows how long it takes |
| `sky-lab.html` | The island at any hour and season, without moving the world clock |
| `palette-lab.html` | Tune a palette with a before and after divider, an eyedropper and sliders |
| `texture-lab.html`, `rock-lab.html` | Prepare the ground photo scans; compare rock tilings and scans |
| `sketch-lab.html` | Every journal field sketch at each stage: pencil, ink and wash |
| `journal-review.html` | Every plant's journal page side by side: sketch and icon, then each part of the page lined up across the plants, with empty parts and much longer or shorter wording flagged |
| `ecology-lab.html`, `frog-lab.html` | Frogs arriving over game days on two islands; frogs live at any hour, with the chorus, lily pads and presence checks |
| `creature-studio.html` | The frog, the minnow or the southern hawker on a stage, moving as in the game (play, pause, slow motion), with sliders for each one's colors, part sizes, drawn size and motion; Save to repo writes only the numbers you moved into its `recipes/species/<id>.json`. `?species=minnow` opens on one |
| `terrain-brush-bench.html` | Island building, brush strokes and settling, timed against their budgets |

## What's here

| Path | What it is |
|---|---|
| `index.html`, `play.cmd` | The game page, and the double-click launcher for this PC |
| `src/` | The game: `core/` (clock, seeded random numbers, events, store, workers), `world/` (terrain, water, growth, journal, creatures), `sim/` (the hourly tick), `render/` and `shaders/` (WebGPU passes and WGSL), `input/`, `ui/` |
| `recipes/` | Every tunable number: land shapes, flora, species, palettes, world settings and quality tiers |
| `tools/` | The local test pages above |
| `CLAUDE.md` | Working rules for Claude Code sessions on this repo |
| `docs/` | 25 architecture docs, starting with [01 Vision and pillars](docs/01-vision-and-pillars.md); see the [docs index](docs/README.md) |
| `brand/`, `assets/` | The icon, favicons and identity review page; the ground's photo scans (CC0, credited in `assets/textures/CREDITS.md`); the finds' small models (credited in `assets/models/finds/CREDITS.md`) |

## Credits

- "Low-Poly Anemone" (https://skfb.ly/6X9T8) by Ben Lebreux, licensed under Creative Commons Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/). Changed for ebb: textures baked to vertex colors, posed at rest, rescaled, and given a shut pose.
- "Crab 3d Model Free" (https://skfb.ly/pMCrp) by iRahulRajput, licensed under Creative Commons Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/). Changed for ebb: texture baked to vertex colors, simplified, rescaled; drawn as a young edible crab.
- The hermit crab is a CC0 model, simplified, with its own walk.
- Shells, each licensed under Creative Commons Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/) and simplified for ebb: "Turret Shell || Free Model" by CyberFox 3D Studio; "shell fossil 3D Scan" by Formwerk3D; "Murex Shell" by Loïc Norgeot; "Nautilus Shell" by RISD Nature Lab. Links in `assets/models/finds/CREDITS.md`.
- The periwinkle is a CC0 photo scan of a rough periwinkle (Littorina brevicula, ffish.asia), simplified to 900 triangles.
- "Blue Mussel Shell - Mytilus edulis" (https://sketchfab.com/3d-models/blue-mussel-shell-mytilus-edulis-9e5d8d32a838428e9e9cf35f25fa0ba4) by scotdiver, licensed under Creative Commons Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/). Changed for ebb: texture baked to vertex colors, simplified, and the one valve mirrored into a pair that opens at the hinge.
- "Sand Dollar" (https://sketchfab.com/3d-models/sand-dollar-ecb3b89356874d73ba449f6c0bf59cf7) by semmert179, licensed under Creative Commons Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/). Changed for ebb: parts joined, simplified, tinted.
- Camp pots, each licensed under Creative Commons Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/) and simplified for ebb: "clay cooking pot" by josemtavares; "Clay teapot" by patrakeevasveta; "GENED 1105 Clay Pot" by andrew_ogundimu (drawn as a dye pot). Links in `assets/models/camp/CREDITS.md`.
- The hen: "Chicken Rig" by FourthGreen, licensed under Creative Commons Attribution-NonCommercial 4.0 (http://creativecommons.org/licenses/by-nc/4.0/), non-commercial use only. Link in `assets/models/hen/CREDITS.md`.
- Camp willow basket, larger pot and clay cup from Poly Haven (CC0): "Wicker Basket 02" by Kuutti Siitonen, "Ceramic Pot" by Aron Łyczek, "Planter Pot Clay" by Amal Kumar. Links in `assets/models/camp/CREDITS.md`.
- Ground scans from Poly Haven and ambientCG (CC0); see `assets/textures/CREDITS.md`.

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
- Desktop and laptop only, with mouse, keyboard or trackpad; quality tiers from medium up, with low as a fallback for weak laptops. Phones and tablets used by touch see a short note that ebb is made for a desktop or laptop
- Hosted on GitHub Pages
