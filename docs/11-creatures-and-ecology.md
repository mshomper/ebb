# 11 — Creatures and ecology

> Creatures are the reason to tend the island. Each species wants five things: the right water, the right food, somewhere to hide, some peace and space, and company. The island is read as a grid of small patches, and every patch gets a score for every species from what is growing and flowing there. When a good enough patch exists, a creature comes to look; if it likes what it finds, others follow. Their mood is never shown as a bar: a happy frog sings at dusk, a restless one wanders the edges. The player reads behavior, adjusts the habitat, and watches the island answer. The same rules run whether the player is watching or away, so creatures settle and come and go believably either way.

## Locked decisions

- **Five needs**, each scored 0..1 per species: water, food, shelter, quiet/space, company. Weighted per species in its recipe.
- **Mood = weighted geometric mean of the needs**, smoothed over hours. One missing need pulls mood down hard; no single excellent need can carry a bad habitat.
- **Habitat is scored on the 1 m ecology grid** defined in `02-core-loop-and-idle-model.md`, inside the hourly tick (`coarseStep` in `src/world/ecology/coarse.js` and `src/world/creatures/coarse.js`), so live play and catch-up give identical results.
- **Mood shows only through behavior** (calling, singing, nesting, play, lingering, wandering). No meters, no icons over heads. The journal gives soft hints in words.
- **No death, no fail.** Unhappy creatures leave calmly ("moved on") and can return when habitat recovers. Populations never crash on screen.
- **Two creature kinds**: *individuals* (frogs, hedgehogs, herons; each has an agent, position, can be named) and *swarms* (minnows, midges, bees, fireflies; a density field in ecology, boids in the live sim).
- **Bodies are blended SDF primitives**, baked to meshes on the GPU at load from the species recipe. Far LOD and tiny swarms use impostors. Hand-made glTF bodies are a later option.
- **Motion is procedural**: two-bone IK legs with foot planting, damped springs for secondary parts, boids for swarms.
- **Vertical slice species: frogs**, using reeds for cover, the pond and shallows for water, and midges (an insect field fed by reeds near still water) for food. Full frog spec in `12-creature-roadmap.md`.

## How it works

### Plain language

Think of each species as carrying a checklist and a pair of glasses. The glasses show the island as a heat map: warm where the checklist is met, cool where it is not. A frog's glasses light up where still shallow water, thick reeds and plenty of midges meet, away from paths and lanterns, with room for a few other frogs. When the warmest patch is warm enough, a scout appears. If the scout is content after a day, it stays and a small group forms, growing toward what the patch can hold. If things get worse (the player drains the pond, a path cuts through the reeds), mood slides over several hours, behavior turns restless, and after two unhappy days one frog leaves, then another.

### The ecology fields creatures read

The ecology `coarseStep` maintains per-cell fields on the 1 m grid. Creatures never read the GPU water sim or plant meshes directly; they read only these:

| Field | Source | Used by need |
|---|---|---|
| Water class and depth | water summary at mean tide plus the analytic tide | water |
| Tide band | cells wetted between low and high tide | water (shore species), food (waders) |
| Plant biomass per species | growth model (`10-growth-and-seasons.md`) | food, shelter |
| Cover | weighted sum of cover-giving plants, walls, logs, leaf litter | shelter |
| Cliff (from M2; used from M7) | per 1 m cell: rock face height, steepness, ledge cells (narrow level steps in a sheer face), height above high tide, cliff-top turf | shelter (ledge and burrow nesters), quiet |
| Prey fields | insect (midge) field, fish field, nectar field, seed and nut field | food |
| Disturbance | paths (day), lanterns (night), structures, larger wary species | quiet |
| Occupancy | residents and swarm densities per species | company, crowding |

The **insect field** matters for the slice. **Midges are an ecology field, not a creature** (decided October 2026): one share per square meter, kept in the hourly tick (`src/world/ecology/midges.js`, `recipes/species/midge.json`). Midges gather over still fresh water and the ground within 2 m of it, where reeds and rushes within 3 m feed them, scaled by the season's warmth (almost none in winter). Each hour the field moves part of the way toward what the ground can hold, so a new reed bed fills over a day or so and a drained one empties faster; a new world starts with none. Frogs read it as food. In S6a frogs do not eat it down; that can come with feeding in S6c. Time of day changes only the live swarm (more at dusk, fewer at night and in wind), drawn on the GPU in S6b from this field. Midges have a journal page, known by themselves at the first dusk they gather once the swarm is drawn (S6b; until then they stay a pencil "?" and nothing names them, since the journal only tells what you could see), but no needs, arrival or trust.

### Need scores

For species *s* at cell *c*, with recipe radii and preferences:

- **Water** `sW = 1 − smoothstep(rOk, rMax, d)` where *d* is distance to the nearest cell of an accepted water class (still, slow, running, tide band) and depth range. Distances come from a chamfer distance transform per water class, rebuilt only when water or terrain changes.
- **Food** `sF = min(1, supply / (demand · groupSize))`, supply being the sum of accepted food fields inside the foraging radius (summed-area table, so any radius costs four lookups).
- **Shelter** `sS = smoothstep(c0, c1, maxCover)` over the shelter radius, cover weighted by the species' preferred cover types.
- **Quiet** `sQ = 1 − smoothstep(q0, q1, blurredDisturbance)`, disturbance switched by the species' active hours (lanterns bother frogs and fireflies at night, paths bother herons by day).
- **Company** a tent function of nearby conspecifics against the recipe's preferred range `[nMin, nIdeal, nMax]`, plus small bonuses for listed companion species. Crowding above `nMax` lowers it.

**Target mood** `M* = Π sᵢ^wᵢ` with weights summing to 1. It is computed as `det.exp(Σ wᵢ · det.log(max(sᵢ, 0.01)))` with the deterministic math from `src/core/rng.js`. Actual mood eases toward it each tick: `M ← M + 0.15 · (M* − M)`, about a 4-hour half-life, so a single edit never flips a creature instantly.

**Habitat score** of a cell is `M*` evaluated with the species' ideal group size. Contiguous cells scoring above 0.5 form a **patch**; patch **capacity** is `floor(area · density)` capped by the species limit. **Frogs instead count their numbers along the shore** (decided October 2026): a bank square beside still water whose score is 0.5 or more is good edge, and the island holds one frog per 3 m of it, with no fixed cap, so a bare stretch of bank holds none. Each frog has a home square on the bank (`src/world/creatures/coarse.js`), which S6b animates from.

### Arrival, settling, leaving

```mermaid
flowchart LR
  U[Species unlocked<br/>tier open] --> S{Best patch<br/>score >= 0.55?}
  S -- no --> U
  S -- yes --> SC[Scout arrives<br/>at its active hour,<br/>within 1-2 game days]
  SC --> D{Scout mood >= 0.5<br/>after 24 h?}
  D -- no --> LV[Scout moves on<br/>journal hint]
  LV --> U
  D -- yes --> G[Group founded<br/>+1 per day while<br/>mood >= 0.5, up to capacity]
  G --> H{Mean mood >= 0.7<br/>for 24 h and<br/>population >= minimum?}
  H -- yes --> HP[species:happy<br/>gift, see doc 13]
  G --> R{Mean mood < 0.3<br/>over 48 h?}
  R -- yes --> L1[One leaves per day<br/>gentle journal note]
  L1 --> G
```

Scouts are scheduled with the deterministic RNG keyed by species and day index. A species that has fully moved on returns through the same scout path. Swarm species skip scouting: their density field seeds at the patch edge and grows logistically toward capacity, shrinking when mood falls.

**As built for frogs in S6a.** Arrival is something the player discovers, not something they are told. The scout comes at dusk, and the journal gets a sign (a plop and rings by the reeds, "Something slipped into the water by the reeds"), never "a frog arrived". The frog page inks only when the player finds one: a tap on it, or watching it in the middle of the view, zoomed in. Until then the notes speak of something, and the page shows a riddle, then hints. A content scout stays after a day, and a second frog comes the next dusk. More come on most evenings while the edge has room, and if the habitat fails, one frog a day moves on, quietly. Frogs sleep in the pond mud through the winter dormancy window (`recipes/world/seasons.json`). Events: `creature:habitat-right`, `creature:arrived` (the scout), `creature:settled`, `creature:joined`, `creature:left`, `creature:dormant`, `creature:woke`, `species:happy`, and the live `creature:found`. `tools/ecology-lab.html` runs the arc on both islands, twice, and must end the same.

### Mood expressed through behavior

Each individual runs a small **utility-weighted state machine**. State weights come from mood band, time-of-day activity curve (diurnal, nocturnal, crepuscular), weather, season and trust in the player.

```mermaid
stateDiagram-v2
  [*] --> Rest
  Rest --> Forage: active hours, food need
  Forage --> Rest: sated or off-hours
  Forage --> Display: mood content
  Display --> Forage
  Rest --> Shelter: rain, cold, disturbance
  Shelter --> Rest: calm returns
  Forage --> Play: mood content, company near
  Play --> Rest
  Rest --> Nest: mood content, season fits
  Nest --> Rest
  Forage --> Wander: mood restless
  Wander --> Forage
  Wander --> Leave: leaving rule fires
  Rest --> Approach: called, trust high
  Forage --> Approach: food offered
  Approach --> Linger: near player focus
  Linger --> Rest
  Forage --> Startle: sudden disturbance
  Startle --> Shelter
  Leave --> [*]
```

Mood bands drive what the player sees: **content (0.7+)** display, play, nesting, lingering near the camera; **settled (0.5–0.7)** routine foraging and rest; **restless (0.3–0.5)** wandering the patch edge, fewer calls, more startles; **leaving (under 0.3)** a slow walk to the shore and away. "Startle" is always brief and soft: a hop into the water, never a panic.

### Interactions

- **Feed**: a gentle toss gesture scatters the species' food at the cursor. Raises the food need by up to 0.2 for 6 game hours (diminishing on repeats) and raises trust. Recorded as a timed event so the tick applies it identically in live play and saves.
- **Call**: a soft whistle. Individuals with trust above 0.3 within 15 m turn and approach, then linger.
- **Name**: available once an individual's trust reaches 0.5. Named individuals keep a persistent record (age, home, a seeded marking pattern so they are recognizable) and get their own journal line.
- **Follow**: the camera locks to an individual with a soft follow rig (`15-camera-input-and-ui.md`).
- **Photograph**: in photo mode (`16-customization-and-photo-mode.md`), framing a creature records species, behavior state and name. The first photo of a species fills its journal page; photos of signature behaviors fill "moments".

Trust grows slowly with feeding, calling and time spent watching; it shortens flee distance and enables naming. It never decays below what was earned.

**Presence** (decided October 2026; full design in `23-presence.md`) is what a creature's flee distance is measured from. It is a list of sources; in the slice the only source is the camera's eye: how close it comes and how fast it moves, plus edits (sculpt, pour, plant) close by. Coming in slowly is welcome; a fast swoop inside a creature's comfort ring, or an edit right beside it, makes it startle softly (a frog hops into the water). Trust shrinks the ring (for frogs from about 1.5 m to 0.3 m). Startles and the wariness after them are live animation only; trust (from feeding and quiet watching) is stored in the world as small events so saves and catch-up agree, and shows on the creature card as a word: Wary, Tolerant, Curious (can be named), Familiar, Bonded. Each species has a wildness ceiling on that ladder. Later presences (a seat, a walking figure, a camp) join the same list without changing creature behavior.

### Procedural bodies

A body recipe lists SDF primitives (sphere, ellipsoid, capsule, round cone, rounded box), each attached to a bone, blended with a polynomial smooth-min of radius *k* (Inigo Quilez, "smooth minimum"). At load, a compute pass evaluates the SDF on a grid around the body and extracts a mesh with **surface nets** at three resolutions (LOD0 48³, LOD1 24³, LOD2 12³). LOD3 is an octahedral impostor atlas, also used for swarm members. Skin weights come from each primitive's share of the smooth-min blend, normalized across the four strongest bones. Albedo regions (back, belly, markings) are physical linear albedo; the painted look comes only from the palette tonemap (`05-look-and-palette.md`). Thin parts (frog throat sac, ears, wings) use a wrap-lighting term for soft translucency. Individual variation: each individual's seed jitters primitive radii by up to 6% and offsets marking noise.

**As built in S6b-1** (`src/world/creatures/bodies.js`, `rigs/frog.js`, `pose.js`):
- **Shape.** A species' rig reshapes its pieces by named proportions (`body.shape`; 1 is the recipe's body, exactly) before the bake. This is the hook the creature studio needs.
- **Variants.** Variation is per body variant, not per individual: `body.variants` seeded variants (8 for frogs), each nudging every proportion by up to `body.variation` and moving the blotches. Every individual wears one, picked by its id, and is drawn up to `sizeJitter` larger or smaller. A look change rebakes 8 bodies, not one per frog.
- **Baking.** Bakes run on the worker pool, coarsest level of detail first: frogs at 3.3, 2.2 and 1.1 mm cells (about 2,000, 7,500 and 30,000 triangles), switched by distance from the eye (`bake.lods`). The baker runs on the CPU; a compute bake can come later if bake time matters.
- **Skeleton.** Bones and their pivots are read from the pieces (where each piece begins), never typed in. The throat pivots at the top of the sac, so it swells down.
- **Skinning.** Skin weights come from each piece's distance compared with the nearest piece (`skin.blendM`), with the top four bones kept. Bone matrices go to the draw pass each frame, and the rest pose is every bone still, which draws the bake exactly.
- **Idle motion.** Breathing (the sac and body) and blinking (`motion.breath`, `motion.blink`).

**As built in S6b-2** (`agents.js`, `motion.js`; numbers in `recipes/species/frog.json` motion, from Matt's prototype):
- **Steps.** Each live frog runs on a steady 30 steps a second of real time, so hops take as long at 4×. Its choices come from its own seeded stream.
- **Moods.** Moods follow the hour of the day shown and the frog's mood from the tick:
  - **rest** by day, with an occasional shuffle;
  - **forage** when active: short hops along the bank within 2 m of home, then tongue flicks at the air (eating counts from S6c);
  - **call** for content frogs from half an hour before dusk to three hours after: no call starts within 0.4 s of another frog's, so the chorus runs around the pond;
  - **swim** in the shallows only, never deeper than 0.25 m, where lilies don't grow: kicks, an eyes-up float, then a hop back out;
  - **arrive** (up out of the water near its home) and **leave** (slipping into the water and sinking, also for winter sleep).
- **Spacing.** A hop never lands within 1.6 body lengths of another frog or its landing, and sitting frogs drift apart. This replaces the prototype's stand-ins.
- **Motion.**
  - The hop is a ballistic arc with the hind legs reaching out by two-bone IK, the hip, knee and ankle read from the skeleton.
  - The body pitches nose up leaving and nose down landing, and a landing spring squashes it.
  - The throat sac swells on a spring for each call.
  - The legs kick in the water.
  - The tongue is a small separate mesh that rides the head bone.
- **Frog lab.** `tools/frog-lab.html` shows the chorus call by call and checks the gap. It also counts hops and swims and times moving, posing and drawing.

### Motion

- **Legs**: analytic two-bone IK; feet plant on the terrain heightfield and lift on a gait phase per leg. Body height and pitch follow the averaged foot plane. Longer chains (heron neck) use FABRIK.
- **Hops** (frogs): a ballistic arc between planted poses, with squash-and-stretch from a spring on body scale.
- **Springs**: critically damped second-order springs on secondary bones (tails, ears, throat sac, whiskers), driven by root acceleration.
- **Swarms**: Reynolds boids (separation, alignment, cohesion) on the GPU with a uniform spatial hash, plus attraction to their ecology field and curl noise for insects. Fish stay below the live water surface; birds bank from lateral acceleration.
- **Pathing**: individuals steer on a coarse walkability grid (slope, water depth) with a simple flow field toward goal cells; no full navmesh in v1.

### Offline handling

The coarse model keeps only **group records** (species, patch, population, group mood, trust per named individual) and swarm densities. There are no positions while away. On re-seed, agents spawn near their home cells in the state their activity curve gives for that hour, as described in `02-core-loop-and-idle-model.md`.

## Data and interfaces

```js
// recipes/species/frog.json (shape as built in S6a; values in doc 12). Two halves: the look
// (body, bake, preview) a creature studio or a player's look layer may change, and the life
// (ecology, presence, find) that nothing but the recipe changes, so catch-up stays the same.
{ "id":"frog", "body":{ "displayScale":1.5, "prims":[ /* {type,bone,c,r,k,region} */ ] }, "bake":{...},
  "ecology":{ "dormancy":"frogs", "activity":{"pattern":"crepuscular"},
    "needs": { "water":{"depthM":[0.05,0.6],"okM":2,"maxM":8,"w":0.25},
               "food":{"field":"midges","radiusM":6,"perFrog":2.5,"w":0.25},
               "shelter":{"cover":{"reeds":1,"rushes":0.9,"iris":0.7,"lilies":0.5,"grass":0.3},"radiusM":3,"from":0.3,"full":0.6,"w":0.2},
               "quiet":{"night":["lantern"],"day":["path"],"w":0.15},
               "company":{"n":[2,5,9],"alone":0.6,"crowded":0.4,"w":0.15} },
    "edge":{"metresPerFrog":3,"goodScore":0.5}, "arrival":{ /* scout, settle, join, leave, happy */ }, "gift":{...} },
  "presence":{ /* doc 23 */ }, "find":{ /* tap or watch to find one */ } }
```

Modules:

- `src/world/ecology/fields.js` field storage, summed-area tables, distance transforms.
- `src/world/ecology/coarse.js` the hourly step: fields, habitat, populations, in that order.
- `src/world/ecology/habitat.js` `scoreSpecies(state, speciesId) → Float32Array`, patches, capacity.
- `src/world/ecology/populations.js` arrival, settling, leaving, happy detection.
- `src/world/creatures/agents.js` live individuals, behavior state machine.
- `src/world/creatures/bodies.js` recipe to SDF to mesh bake (shaders `creature-sdf-bake.wgsl`, `surface-nets.wgsl`).
- `src/world/creatures/motion.js` IK, springs, hop arcs; `boids.wgsl` for swarms.
- `src/world/creatures/interact.js` feed, call, name, follow, photograph hooks.

Events (past tense, per doc 03): `creature:arrived` (a scout), `creature:settled`, `creature:left`, `creature:named`, `species:happy`, `species:moved-on`, `journal:photographed`.

## Algorithms and shaders

Weighted geometric mean for mood; summed-area tables (Crow, 1984) for radius sums; chamfer distance transform; surface nets (Gibson, 1998); polynomial smooth-min (Quilez); FABRIK (Aristidou and Lasenby, 2011); boids (Reynolds, 1987) with spatial hashing; curl noise (Bridson et al., 2007); utility AI action selection ("Behavioral Mathematics for Game AI", Mark).

## Tuning knobs

Tuning panel, per species: need weights and radii, accepted water and food, cover preferences, group range, density and cap; body primitives (drag sliders for radius, position, blend), marking colors, variation amount; gait speed, hop height, spring stiffness and damping; boid weights. A "show habitat heat map" overlay per species and a "force scout now" button. Saves to `recipes/species/*.json`.

## Performance budget

- Desktop: habitat scoring for all unlocked species under 1.5 ms per tick in a worker; up to 120 live individuals with IK and springs under 1 ms CPU; 4,096 boids under 0.3 ms GPU; creature rendering under 2 ms at 1440p. Body bake under 20 ms per species at load.
- Mobile (low) tier: 50 individuals (matching `19-performance-and-quality-tiers.md`), 1,024 boids, LOD bias +1, creature rendering under 3 ms.
- Offscreen individuals beyond 60 m run behavior at 4 Hz and skip IK.

## Acceptance checks

- Build a pond with reeds along one edge: within one or two game days a frog scout appears at dusk on the reed margin.
- Thicken the reeds and let grass fill the banks: frogs grow to a group of 4 or more; at dusk they call in a chorus and some sit still near the camera.
- Raise the ground under most of the pond and its reed margin so only a small puddle and a few reeds remain: over the next half day frogs call less and wander the far edge; after two days one leaves with a gentle journal note. Dig the pond out again and let the reeds regrow: a scout returns.
- Toggle the frog heat map: warm cells match where frogs actually sit.
- Feed and call a frog repeatedly; within a session it approaches when called and can be named; the name shows in the journal.
- Drag the body sliders in the tuning panel: the frog reshapes live with no seams.

## Open questions

- Should the journal ever hint at the exact weakest need, or only describe the behavior and let the player guess?
- Should named individuals ever leave, or always stay as long as their species stays?
- Is there room for gentle predator-prey moments (a heron near the frog pond making frogs warier), or should all species simply coexist?
- Matt's pin (October 2026): small burrows or caves for a landmark land creature such as a bear (doc 12's open questions). The ecology grid would need a "den" field from placed rock pieces, since the heightfield holds no undercuts.

## Depends on / feeds into

Depends on `02-core-loop-and-idle-model.md`, `07-water-and-tide.md`, `08-terrain-and-sculpt.md`, `09-structures.md`, `10-growth-and-seasons.md`, `14-asset-recipes-and-tuning-panel.md`. Feeds `12-creature-roadmap.md`, `13-progression-and-expansion.md`, `15-camera-input-and-ui.md`, `16-customization-and-photo-mode.md`, `17-audio.md`, `19-performance-and-quality-tiers.md`, `20-roadmap-and-vertical-slice.md`.
