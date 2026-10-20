# 07 — Water and Tide

> Water is half of ebb's name and most of its calm. Water always runs downhill: dig a hollow and it fills, cut a channel and a stream finds it, raise a bank and the pond spills a new way. Twice a game day the sea breathes in and out, uncovering shiny tide flats and shallows that waders and crabs use, then covering them again. Under the soft palette the water behaves optically like real water: it reflects the sky at grazing angles, bends and tints what lies beneath, turns deep teal with depth, throws caustics on the pond floor and gathers foam where currents meet. This doc defines the live water simulation, the tide, how water is drawn, and the small deterministic "water summary" that the ecology and creatures use.

## Locked decisions

- **Live water is a GPU shallow-water heightfield using the virtual pipe model** (O'Brien and Hodgins 1995; Mei, Decaudin and Hu, "Fast Hydraulic Erosion Simulation and Visualization on GPU", 2007). Cell size **0.5 m** (2×2 terrain cells from `08-terrain-and-sculpt.md`) at every tier.
- **Live water is visual only and not deterministic.** It runs on animation time (real seconds), at fixed step 1/120 s, capped at 4 steps per frame (see `04-render-pipeline.md`). Ecology never reads it.
- **The water summary is the truth for ecology.** A deterministic CPU computation (integer heights, priority-flood) in a worker produces, per 1 m ecology cell: standing depth at mean tide (u8, cm), flow class (none, still, slow, running, sea), tide-band flag and basin id. It is rebuilt only when terrain or water features change, or land rises. It is never saved; it is rebuilt on load (`18-saves-and-persistence.md`).
- **Tide is analytic** (`src/world/tide.js`): `level(t) = h0 + A(t) · cos(2π t / 12 h + φ)` with h0 = 0 m (mean sea level, Y = 0), base amplitude **A0 = 0.6 m**, and a spring and neap swing of ±15% driven by moon phase from `06-sky-and-lighting.md`: `A(t) = A0 · (1 + 0.15 · cos(4π · moonPhase(t)))`. Spring tides fall at new and full moon, four times per 14-day season (the moon keeps its 7-day cycle, F01).
- Rendering reads tide at **display time**; ecology and `coarseStep` read it at **world time** (see `16-customization-and-photo-mode.md`).
- **Chunk-aware.** Water textures cover the world chunk grid of doc 08 at 0.5 m (the world limit of 192 m by 192 m, 6×6 chunks of 32 m, so at most 384×384 cells), allocated once. Simulation dispatches **per active 32 m chunk tile** (64×64 cells). At that limit (doc 13's expansion ceiling) the worst case is 36 tiles, 147,456 cells.
- Activity per chunk (doc 13): chunks within 60 m of the camera focus run every step. Other chunks with water, shoreline or summary-flagged flow run at quarter rate with 4× step. Open sea outside land chunks is an analytic tide plane with procedural waves.
- Starter water tools: **pour** (temporary brush source) and **drain** (temporary brush sink), plus one fixed **starter spring** (persistent source) placed by the land recipe. Player-placed springs and streams arrive only with the dragonflies' gift, the **stream tool** (`12-creature-roadmap.md`). Springs are saved in the store slice `water`. (S4b, October 2026: the spring mechanism is built into the Water tool's Spring mode: up to 4 placed springs, each trickle 3, brook 12 or stream 30 L/s, undoable. It is locked behind the store flag `unlocks.springs`, which the dragonflies' gift sets; the `?sandbox` address flag sets it early for testing.)
- One hourly `coarseStep` for tide (in `src/world/tide.js`) and one for the water summary (`src/world/water/coarse.js`), run in the shared order from `02-core-loop-and-idle-model.md`: tide, weather, seasons, water summary, growth, ecology, creatures, expansion.

- **Built in three slice steps** (doc 20, October 2026): **S4a** the tide, the live simulation, the starter spring and the water drawing; **S4b** the water summary, the nudge, pour and drain, readback and tide events; **S4c** the sky probe, screen-space reflection, caustics, foam, ripples and the visual wetness pass. S4a's interim choices:
  - The whole opened area simulates every step (0.5 m, 192 x 192 cells for the starter island). Per-chunk activity and quarter-rate tiles arrive when the world grows past the starter chunks.
  - Until the summary exists, hollows at least 0.1 m deep and 30 m² in size start full to their lip (`src/world/water/init.js`, priority-flood).
  - Beyond the terrain, the island's sea floor continues at `seabedDepth` and deepens by `openSeaFloorSlope`, so the open sea darkens gradually with no seam.
  - The sea swell and the ripples change only the surface normal (no vertex displacement), so the simulated grid and the sea plane always meet. Ripples are procedural noise layers flow-mapped by the velocity field.
  - Thin still water is drawn as a broken, weakly reflecting film (grass and stones stand through it); running water stays glossy, and fast shallow water shows white riffle streaks drawn out along the current (a procedural slice of the S4c foam).
  - Flow is capped by Manning's law (`manningN`), so thin water on slopes runs at realistic speed and depth instead of racing off as an invisible film.
  - The terrain reads the live water depth: ground under water and within about 0.75 m of it is soaked and dark (a first slice of the S4c wetness pass, without drying).

- **S4b as built** (October 2026):
  - `src/world/water/summary.js`: integer Priority-Flood with first-in-first-out flow directions (fixed neighbor order, flats resolved by breadth-first distance to the outlet); the tide band also requires a connection to the sea through ground no higher than the band top. About 5 to 25 ms for the starter island; same hash on every thread (tools/determinism.html).
  - Pond rule tuned for an island meadow: a hollow is a pond when spring water reaches it, or when at least `pondMinCatchmentM2` (120 m²) drains into it and it is at least `pondMinDepthM` (0.15 m) deep. The doc's original 30 m² filled every small dip on the plateau.
  - Stream depth from the law above is capped by the Manning depth for the local slope, so the summary agrees with the live water (steep runs 1 to 3 cm, flatter runs deeper).
  - The nudge tops live water up toward `targetMm` (τ 20 s) and never drains it. Starting water is the sea at the current tide plus the summary's targets.
  - Damp hollows read on the ground: the summary's damp cells (hollows of at least `dampHollowMinM2`, 3 m²) go to a small 0.5 m texture the terrain reads, darkening them by `dampHollowWet` (a slice of the S4c wetness pass, without drying).
  - Water tool: Pour and Drain (named Soak in the first plan) at up to 60 L/s under the brush; Spring (locked behind `unlocks.springs`). `water.sampleLive(x, z)` reads a CPU copy of depth and velocity made four times a second through a ring of three buffers.

- **Still ponds** (October 2026, after S6; Matt: the pond felt like the ocean). The open sea's swell (5 cm, 9 m waves) was added to any water deeper than `seaFadeDepthM`, so a 70 cm pond rolled like the sea. The swell is now the sea's only, by the same sea-or-pond test the optics use (the surface standing above the tide). The small ripple layers on still fresh water follow the wind (`look.freshRipples`: 0.12 of their strength in still air, near a mirror, rising to 0.7 in a full wind), while moving water stays choppy, so a pond ruffles where its stream comes in. The simulation itself is calm in the pond (under 2 mm of rise and fall, under 0.4 cm/s of current, measured on the starter island).

- **The starter spring's outcrop** (October 2026, after S4c): at first the spring poured 12 L/s onto open meadow about 2.5 m above the top of its carved bed (the bed is carved along the domain-warped line, the spring point was not warped), and the water ran down the slope as a wide film a few millimeters deep, drawn glossy because it was moving. Now:
  - The spring sits at the world point the warp carries onto the bed's head (`unwarp` in `landform.js`), and the bed starts at full depth there (`channel.headTaper` 0). The grassy swale around the bed is deeper (`channel.depthM` 0.15 m, was 0.05 m), so where the brook crosses the slope it keeps a downhill bank on the 0.5 m water grid. A deeper or wider thalweg did the same but turned its banks steep enough to draw as rock face.
  - A small outcrop is part of the landform (`spring.outcrop` in `recipes/land/starter-island.json`): a pool leveled into the slope, its water standing `lipRiseM` above the meadow where a notch crosses the rim on the downhill side; a rim `rimAboveM` above the water and at least one water cell wide, so the 0.5 m grid sees it closed; a short ramp from the notch into the bed; and 4 to 6 stones on a horseshoe open downhill, all from the terrain seed. Stones are painted rock, so they take the boulder scan on top and the rock face on steep sides (doc 22). The water summary sees the pool as a small spring-fed pond.
  - Thin water: moving water turns glossy only from `look.glossyDepthM` (0.8 to 2 cm, was 0.4 to 1.5 cm), and water under `look.sheetDepthM` (4 to 8 mm, was 2 to 6 mm) shows only as damp ground.
  - Springs the player places do not have an outcrop yet; they would need it as an undoable terrain stamp placed with the spring (a follow-up, with the dragonflies' gift).

## How it works

Plain version: the island is a grid of half-meter squares. Each square holds a column of water. Between neighboring squares are imaginary pipes. Every tiny time step, water pushes through each pipe in proportion to the difference in water surface height, so it flows downhill and levels out. A ring of "sea" squares around the island is held at the current tide level, so as the tide rises, the sea pushes water onto the flats, and as it falls the flats drain. Springs (the starter spring, and later ones placed with the stream tool) add water; pouring adds more for a moment. Separately, a calm bookkeeping step works out where water would settle and flow in the long run (ponds full to their lip, streams from springs to sea) and hands that map to the ecology. The live water is gently nudged toward that map, so what you see and what the creatures "know" never drift apart.

```mermaid
flowchart TD
  subgraph Deterministic - worker, world time
    TE[terrain height, quantized] --> PF[Priority-flood: basins, spill levels]
    SP[springs from store] --> RT[Route spring discharge to sea]
    PF --> RT
    RT --> SUM[Water summary 1 m: depth, class, tide band, basin]
    TL[tide.js level at world time] --> CS[coarseStep: exposure this hour, tide:turned]
    SUM --> ECO[ecology + creatures doc 11]
    CS --> ECO
  end
  subgraph Live - GPU, animation time
    SUM -->|upsample, nudge target| NUD[Summary nudge]
    TD[tide.js level at display time] --> BC[Sea boundary cells]
    SRC[springs, pour, drain, rain] --> FL
    BC --> FL[Flux pass: pipes]
    NUD --> DP
    FL --> DP[Depth pass]
    DP --> VEL[Velocity pass]
    VEL --> FO[Foam advect + generate]
    RIP[Ripple layer 25 m window] --> DRAW
    DP --> DRAW[Water shading doc 04]
    DP --> WET[Terrain wetness doc 08]
    DP --> RB[Readback 1 m, 4 Hz: creature motion]
  end
```

### Sculpt coupling

The terrain height texture is the water bed. When a brush changes the bed under water:

- **Lowering**: depth stays, so the surface dips and neighbors flow in. A dug hollow fills from its surroundings, and from the summary nudge if it is a new pond.
- **Raising**: depth is kept, so the water rides up on the new ground and runs off it downhill on the next steps. Volume is conserved and the result is a soft bow wave instead of water vanishing. (Decided in S4a, October 2026: simpler than removing the rise and re-adding it on the brush ring, with the same look.)
- On `terrain:stroke-ended`, the summary is rebuilt (debounced 300 ms), which updates the ecology and the nudge targets.

### The water summary (deterministic)

Run by `src/world/water/summary.js` as a `background` lane worker job with integers only, so every device gets the same answer:

1. Bed at 0.5 m = **minimum** of the 2×2 quantized terrain heights, so a 0.25 m channel the player carved is not lost.
2. Sea cells are those connected to the world edge with bed below mean sea level. Tide band cells have a bed within `[−1.15 A0, +1.15 A0]`, the full spring tide range. **Shore height** (docs/future/10, Z1): for the band and the splash ground above it, up to `splashFactor` (0.6) A0 over the band top and reached the same way, a byte 1..255 grades the bed from the band bottom to the splash top (0 elsewhere), with `shoreRange` giving the meters. `src/world/water/shore.js` turns it and the painted ground into shore zones from `recipes/world/shore.json` (kelp, wrack, channelled wrack and lichen on rock; rippled and firm wet sand; tidal mud), shown in `tools/shore-lab.html`. **The strandline** (Z3, `src/world/water/strandline.js`): of the last 14 high waters, each line still lying (no later high water reached above it, at most 8) is drawn as litter at its level plus a little wave run-up, newest freshest, fading over 96 game hours; from the analytic tide alone, so nothing is saved.
3. **Priority-Flood** (Barnes, Lehman and Mulla, 2014) gives the filled surface, basin labels and spill points. Flats are resolved with Barnes' flat-resolution method (2014) so flow directions are well defined.
4. A basin is a **pond** (filled to its spill level) if spring discharge reaches it, or if its catchment is at least 30 m² (rain-fed). Smaller basins stay dry but are marked as damp hollows, which feeds moisture in doc 10.
5. Spring discharge (liters per second) is routed with D8 flow directions over the filled surface and accumulated down to the sea. Stream depth comes from a simple power law, `d = clamp(0.08 · Q^0.4, 0.02, 0.3)` m with Q in L/s, and speed `v = Q / (w · d)` with an assumed width `w = 0.5 + 0.1 √Q` m.
6. Class per 0.5 m cell: `sea`; `still` (pond, or v < 0.05 m/s); `slow` (v < 0.3 m/s); `running`. Cells are aggregated into 1 m cells as follows: depth is the mean over wet subcells, and the class is that of the fastest subcell when at least a quarter of the cell is wet.

Rebuilding the whole world at the 192 m ceiling takes about 25 ms in a worker. It always recomputes globally (basins can span chunks) and emits only the chunks whose values changed.

### Tide and the flats

- `tide.js` is pure and is used by rendering (display time), by the sea boundary of the live sim, by doc 08 wetness (beach band and the tide-flat linger), and by the tide `coarseStep` (world time).
- Tide flats are tide-band cells whose bed is above the current level. Doc 08 keeps them wet and shiny for about two game hours after they are uncovered.
- At 4x time flow the tide moves four times faster while water physics stays real-time, so the flats flood and drain visibly but calmly (0.6 m over about 90 real seconds).
- During time and season preview the sea boundary follows the display tide, so the preview shows the real flats. It glides back with the display time when preview ends.

### How creatures read water

- **Decisions** (habitat, arrival, mood) use only the water summary plus the analytic tide at world time, on the 1 m ecology grid (`11-creatures-and-ecology.md`).
- **Motion** uses live water: GPU boids (fish, insects over water) sample `waterDepth` and `waterVel` directly through `lib-water.wgsl`. CPU-animated creatures (frogs, herons, otters) call `water.sampleLive(x, z)`, which reads a 1 m downsample of depth, surface height and velocity for active chunks, copied back four times per second through a ring of three staging buffers, so a read never stalls. Outside active chunks it falls back to the summary plus tide. Its surface height matches the drawn water (S6b-3): each wet cell's bed (the lowest of its 2 × 2 terrain cells) plus its depth, blended between the four nearest cell centres, never below the ground.

## Data and interfaces

```js
// src/world/tide.js
export const TIDE_PERIOD_H = 12;
export function level(tHours) {}            // m, world or display time
export function state(tHours) {}            // {level, amp, rising, nextTurnH, phase01}
export function coarseStep(state, hourIndex, env) {}
// writes state.tide = {level, rising, exposedBandFrac}; emits 'tide:turned' {kind:'high'|'low'}

// src/world/water/index.js  (System, per 03)
export const water = { id:'water', init, tick, encode, reseedFromCoarse, dispose };
export function addSpring({x, z, rateLps}) {}   // stream tool only; undoable command via input/actions.js
export function removeSpring(id) {}
export function sampleLive(x, z) {}            // {depth, surface, vx, vz, fresh:boolean}
export function getSummary() {}               // {depthCm:Uint8Array, cls:Uint8Array, band:Uint8Array, basin:Uint16Array}
// src/world/water/coarse.js
export function coarseStep(state, hourIndex, env) {}
// rebuilds the summary for dirty chunks (edits, land rises from doc 13), else no-op
```

Store slice `water` (saved): `{ springs: [{id, x, z, rateLps}], tideStone, version }`, where `tideStone` is the tide stone setting (gentle or strong tides, the herons' gift). Ponds and channels are not stored here; they are terrain edits (`08-terrain-and-sculpt.md`). The starter spring runs at 12 L/s (a small brook; raised from 6 in S4a so the stream reads as running water), at the head of a gentle grassy channel with a gravel bed that the land recipe carves down to the pond hollow. Springs placed with the stream tool choose a rate from 1 to 30 L/s.

Events: `water:summary-updated {chunks}` (doc 11 rebuilds distance transforms on it), `tide:turned`, `water:spring-added`, `water:spring-removed`.

GPU resources (at most 384×384 at 0.5 m, chunk tile 64×64):

| Texture | Format | Contents |
|---|---|---|
| `waterDepth` A/B | r32float | depth, ping-pong |
| `waterFlux` A/B | rgba32float | outflow to +X, −X, +Z, −Z |
| `waterVel` | rg32float | velocity, m/s |
| `waterFoam` A/B | rgba16float | foam amount, age, shore swash |
| `waterTarget` | r32float | summary depth upsampled (nudge target, sea marked) |
| `ripple` A/B, out | rgba32float state (height, previous, world texel id), r32float out; 256² (128² low) | 25.6 m window at 0.1 m around the camera target, world-anchored and toroidal |

Core WebGPU allows `read_write` storage only for single-channel 32-bit formats, so multi-channel fields ping-pong. Active tiles are listed in a small buffer and dispatched with `dispatchWorkgroupsIndirect`.

Shaders: `water-flux.wgsl`, `water-depth.wgsl`, `water-velocity.wgsl`, `water-foam.wgsl`, `water-ripple.wgsl`, `water-draw.wgsl`, `lib-water.wgsl`.

## Algorithms and shaders

**Pipe model per step** (Δt = 1/120 s, g = 9.81, cell size l = 0.5 m, pipe cross-section A = l²):

```
f_i ← max(0, f_i · (1 − c_f Δt) + Δt · A · g · Δh_i / l)      Δh_i = surface difference to neighbor i
K   ← min(1, d · l² / (Σ f_i · Δt))                             never drain a cell below zero
f_i ← K · f_i
d   ← d + Δt (Σ f_in − Σ f_out) / l² + Δt (sources − sinks) / l²
u   ← (f_left_in − f_left_out + f_right_out − f_right_in) / (2 · l · d̄)   (same for v)
```

- **Stability**: the gravity-wave speed `√(g d)` gives a CFL limit of about 0.08 s at 4 m depth, far above our step. Speeds are clamped to 4 m/s. Cells under 1 mm are dry. Friction `c_f = 0.6 / s` plus a depth-dependent Manning-style term on thin sheets stops endless sloshing. A NaN guard resets a cell to its target.
- **Sea boundary**: sea cells and the outer ring of every active region are set to `max(0, level(display) − bed)` each step.
- **Rate boundary**: across the boundary between a full-rate and a quarter-rate chunk, each side treats the other as a fixed level for that step. The tiny volume error is absorbed by the nudge.
- **Summary nudge**: in cells the summary marks as pond or stream, `d += (target − d) · (1 − e^(−Δt/τ))` with τ = 20 real seconds, applied only when live depth is below target (so ponds refill and never overflow from the nudge). A newly dug hollow visibly fills over about a minute.
- **Rain**: adds depth uniformly at the weather rain rate (live, visual only) and drives ripples.
- **Foam** (`world/water/foam.js`, `water-foam.wgsl`, `water.json` `foam`): a coverage field on the water cells, one dispatch per frame after the simulation steps. Made where the surface drops more than 5 cm into the neighbor the water flows toward (little falls), where flows converge (`−∇·u`), and where fast, shallow water churns over its bed (stream riffles and beach swash: under 12 cm deep, fading in from 0.25 to 0.8 m/s; this replaced S4a's separate riffle flecks, whose 0.7 s reset cycle made them blink). Films of a few millimeters spilling over a bank never froth. It is advected semi-Lagrangianly by `waterVel` and decays over about 6 s on moving water; on still water (under 0.15 m/s) it spreads toward its neighbors' average and lingers about 12 s, so foam pouring into a pond fans out into a thin veil. Capped at 0.65 cover.
- **Ripples** (`src/world/water/ripples.js`, `water-ripples.wgsl`, `lib-ripples.wgsl`, `water.json` `ripples`): a damped 2D wave equation, h' = (2h − h_prev + C² ∇²h) · damping with C = c Δt / Δx (c = 0.25 m/s, capillary-gravity ripples; C capped at 0.5), on its own fine window: 256² texels of 0.1 m (a 25.6 m square; 128² on the low tier) centered on the camera's orbit target, stepped at a fixed 1/120 s (at most 4 substeps a frame), with rings fading to 5% over 3 s on top of their own spreading. The window is world-anchored and toroidal: world texel c = floor(xz / 0.1 m) lives at index c mod N, so moving the window never shifts the rings, and each state texel (rgba32float: h, h_prev, and the world texel it holds) starts at rest when it wraps to a new world texel. It is held at rest where the live water is thinner than 1 cm, fading in to full by 3 cm, so rings stop at the shore. Drops are smooth dips (1 − t²)² pressed into the water at rest, which then ring out. The pour brush's drops are hashed on the GPU per substep on a world grid of 0.4 m cells (at most one drop per cell per substep), 60 drops a second at full strength. Raindrops are not in this field: at 10 cm a texel they read as spreading divots. They are drawn as rings in the water shader instead (`water.json` `ripples.rings`): on 0.35 m cells each drop lives 0.9 s while its ring spreads to 18 cm (radius growing with √age), with a short train of crests 2.5 cm apart whose slope fades with age; up to 70% of the cells hold a drop at full rain, two offset grids layered so no pattern lines up. They fade out where a pixel is too coarse to hold the crests, so they never shimmer in the distance. Creatures and fish queue impulses (`addImpulse(x, z, strength, radius)`, up to 32 a frame). The drawing reads the r32float height with `rippleSlope()`: central differences blended bilinearly, faded out over the last 2 m of the window, scaled by `normalStrength`, and added to the surface slope.
- **Detail waves**: two scrolling normal maps, flow-mapped by `waterVel` (Vlachos, "Water Flow in Portal 2", 2010). Open sea adds 4 Gerstner waves (amplitude at most 6 cm, gentle) whose height fades to zero in water shallower than 0.5 m.

**Shading** (`water-draw.wgsl`, after the HDR copy in doc 04):

- Mesh: per active chunk a 64×64 grid displaced to `bed + depth`. Vertices of dry cells sink 2 cm under the terrain, and a soft edge fades over the first 3 cm of water thickness, so shorelines never show a hard line. Open sea uses an analytic plane at the tide level plus a horizon skirt.
- **Fresnel**: Schlick with F0 = 0.02 (water, n = 1.333).
- **Reflection**: sky probe and specular mips from doc 06, at a mip chosen by the water's roughness. On the ultra and high tiers, a screen-space reflection of the island in `sceneColorCopy` (24 and 16 steps at quadratically growing spacing, then 5 or 4 bisection steps; reach 90 m), falling back to the probe where the ray finds nothing, toward the screen edges and on rough water. The march follows only 30% of the ripple tilt, so a reflected bank wobbles but hangs together instead of breaking into blotches. Sun and moon glints use GGX with their illuminance, which is what draws the moon path at night; they are hidden where the island stands in the reflection. `?ssr=0` turns the island reflection off; `?waterdbg=5` shows where it hits (red).
- **Refraction**: screen offset `n.xz · 0.06 · min(thickness, 1 m)`, sampling `sceneColorCopy` at a mip chosen by thickness. Samples whose `depthCopy` lies in front of the water are rejected and fall back to the unrefracted sample.
- **Absorption** (Beer-Lambert): thickness `L` = distance along the view ray from the surface to `depthCopy`. Transmittance `T = exp(−σ_a L)` with σ_a = (0.45, 0.065, 0.05) per meter for the sea and (0.4, 0.32, 1.2) for ponds (peat stains absorb blue, water absorbs red, so pond water reads tea-olive). In-scatter adds `(1 − T) · albedo_s · (sky SH + sun · transmittance)`, with a cloudier olive albedo for ponds. Sea or pond is told by where the surface sits: the sea's is at the tide, fresh water stands above it. Depth reads as teal, then blue, physically, and the palette then softens it toward sea glass.
- **Marsh water** (October 2026, `water.json` `look.marshWater`): shallow, still fresh water among drowned plants holds more dissolved peat than open pond water, so σ_a moves from the pond's toward (1.6, 2.4, 6.0) per meter in water shallower than 0.3 to 0.8 m and slower than 0.05 to 0.2 m/s. Marsh pools and shallow pond margins read darker and tea-brown, and the sky's reflection shows on them.
- **The drowned meadow** (October 2026, `terrain.json` `underwater.drownedMeadow`): under shallow, still water a grassy bed keeps its drowned grass, weed and algae, a mottled olive (physical albedo) instead of bare silt, giving way to silt from 0.3 to 0.6 m deep and scoured away by running water.
- **The bed**: grass does not grow under water. Past the first 3 cm of depth a grassy bed turns to bare soil (sand and stone stay), and in deeper water fine silt settles over the soft bed (`terrain.json` `underwater`). From straight above, where Fresnel reflection is only 2%, this is what shows where a pond starts.
- **Caustics** (`lib-caustics.wgsl`, `water.json` `caustics`): drawn on bed pixels in the opaque pass, which already reads `waterDepth` (and now the water velocity). The pattern lives on the surface: a bed point at depth d reads it where its refracted light ray entered, d · tan θ_t toward the sun (Snell, n = 1.333), so it shifts with depth and sun angle. The pattern is computed, not drawn: a small ripple field of 24 plane waves (wavelengths 0.1 to 0.8 m, golden-angle directions, each bending light equally, moving at 30% of real water-wave speed) refracts the sunlight, and the light on the bed scales with 1 / |det(I + k H)|, the Jacobian of the refracted rays' landing map (H the ripple Hessian, exact for plane waves; k = depth · (1 − 1/n)). Ripples that curve like lenses gather light into soft bright filaments, the rest dims slightly; |det| is softened (more with depth) so fold lines are filaments, not spikes. (A first try with Voronoi line lattices read as stacked spiderwebs, and value noise left a square grid in its curvature.) The pattern drifts with the local flow through a two-phase flow map (Vlachos 2010), so stream caustics run downstream. The factor multiplies only the direct sun and moon diffuse on the bed (not sky fill, not specular), so caustics move light around without adding any: they vanish in shadow, follow cloud and twilight dimming, and are only a faint moon term at night. Contrast fades in over the first 1 to 5 cm, rises to full by 0.5 m, and fades out from 0.9 m to 2.2 m. They fade out where the shortest wave spans fewer than 6 pixels, so far caustics never shimmer. The low tier sums 60% of the waves (`causticLayers` 1); `?caustics=0` turns them off.
- **Foam**: lit Lambert, albedo 0.8, at most 85% of a pixel, broken into connected bubbly lace (three noise octaves, 8 cm cells) with dark holes. The lace boils (each octave is two copies drifting slowly apart) and rides the current through a 2.5 s two-phase flow map whose phase is offset per spot by a slow noise, so resets are scattered across the surface and nothing blinks together. Cover is sampled with smoothstepped weights between cells, so no square shapes show.
- **Waterfalls** (M2, with the Cliff tool; `src/render/passes/falls.js`, `water-falls.wgsl`, `water-falls-draw.wgsl`, `water.json` `falls`). Visual only. The sim hands water from a lip cell straight to the foot cell, so on its own nothing shows on the face, and the heightfield water mesh cannot draw a vertical sheet. Each frame, after the sim:
  - **Lips.** A compute pass finds water deeper than 2 mm flowing toward a neighbor whose bed lies more than 0.5 m lower. It marches the ground to find the real edge, and appends one lip per edge cell (an atomic counter, then indirect draws capped per tier: `fallsMax`).
    - **Throw.** Water leaves a brink at about the critical speed √(g × depth): a 2 cm film at 0.44 m/s, so trickles hug the rock instead of shooting out like a hose.
    - **Landing.** The arc is followed down to where it meets flat ground or water. On a wall's steep leaning foot it slides out along the face rather than stopping, so a fall always reaches the bottom.
    - **Undrawn water.** Water counts only at the level of its wet neighbors: in a cell that straddles a wall's foot (its bed is its lowest corner) the sim holds a column against the rock that is never drawn, and falls must not stop on it.
  - **Two ways to draw a fall, by distance.**
    - **Near the eye: droplet water** (`falls-fluid.js`, `falls-particles.wgsl`, `falls-fluid-*.wgsl`, `falls.fluid`). This is screen-space fluid rendering (van der Laan, Green and Sainz, I3D 2009; Green, GDC 2010).
      - Each lip within the tier's `fallsFluid.nearM` sends droplets off its edge, as many as its flow carries. A trickle keeps to a few threads; a stream fills the whole edge.
      - Droplets fall under gravity with drag and fray as they fall. They slide down a leaning face, and are gone on reaching flat ground or water, or after about their fall time.
      - Each droplet is drawn as a sphere into depth and thickness images, at the tier's share of the render size. The depth is smoothed with a bilateral filter into one surface.
      - That surface is shaded as water. The scene behind is bent and dimmed by its thickness (pond water's absorption), so the body reads glassy and slightly green.
      - White ropes of aerated water run down it, meandering and breaking into beads lower down.
      - Rippled glassy water mirrors the sky probe sharply and throws GGX sun glints, brightest at its rounded sides.
      - Falls are tested against land and rock only (the water pass's pre-water depth copy), so the water mesh's own film down a wall never hides them.
    - **Further off: the curtain.** Each lip is drawn from the edge along a gravity arc, thrown out at the water's own speed and following a leaning face down. It is three layers through the water's body, so it has depth, and its outer ends round over like a tongue of water. Curtains give way to droplet water over `fluid.fadeM`.
  - **Thickness.** At the lip the curtain is as thick as the water runs (flow / speed). It bulks out with air as it falls, to 3 cm for a thread and 22 cm for a full sheet.
  - **Look.**
    - Flow per meter (depth times speed) sets the look: threads at a trickle, a ribbon, a white sheet at a stream.
    - Streaks are fixed in the moment the water left the lip, so they fall at the true, quickening speed.
    - The water leaves the lip glassy, reflecting the sky with Fresnel, and turns white as it aerates.
    - The back layer darkens the rock behind it as wet stone.
    - The curtain is lit like any rough surface, with shadows, and the palette is applied last.
  - **Foot.** Where it lands, foam is made in proportion to the inflow (`foam.plungeGain`). Distant strong falls throw soft spray puffs.
  - **Wall triangles.** The water mesh leaves out its steep triangles beside a lip, so no stretched film shows on the wall.
  - **Test and cost.**
    - `?falls=0` turns waterfalls off; `?fallsfluid=0` keeps curtains everywhere; `?fallsdbg` puts the lips found on `window.ebbLips` for the console.
    - tools/cliff-bench.html measures the pass. With the `?cliffs` scene's sheet filling the view on a desktop GPU, the high tier takes about 0.33 ms (p50) and 0.46 ms (p95).
    - Low draws curtains only.
- **Shoreline wetness**: doc 08 owns the wetness field. Water provides `waterDepth` and `tide.level`. The terrain shader darkens wet albedo and lowers roughness (Lagarde, "Water drop 2", 2013).

**What the coarse model keeps**: the summary (depth at mean tide, class, tide band, basin), the spring list, and the analytic tide. It drops velocities, foam, ripples, live depths and rain puddles, which are all rebuilt by `reseedFromCoarse()`: the live depth is set from the summary plus the current tide, followed by a silent 200-step settle behind the reveal fade (`02-core-loop-and-idle-model.md`).

## Tuning knobs

- Tuning panel (`recipes/world/water.json`): base tide amplitude, spring and neap swing, tide phase; friction; foam thresholds and decay; nudge time; rain-fed pond catchment threshold; stream depth law; absorption coefficients per water body; scattering albedo; caustic strength; Gerstner wave set; refraction strength. Overlays: flow class map, basin labels, live minus summary difference.
- Player: starter water tool modes (pour, drain). The stream tool (dragonflies' gift) places springs and sets their rate (three steps: trickle, brook, stream).

## Performance budget

| | high (desktop, 1440p) | low (phone) |
|---|---|---|
| Simulation, worst case 36 tiles | 0.6 ms (2 steps per frame) | 0.9 ms (active radius 40 m, 1/60 s steps) |
| Foam and ripples | 0.15 ms | 0.1 ms (ripples 128²) |
| Waterfalls (M2): lips found, droplet water near the eye, curtains and spray further off | under 1 ms: 2,048 lips, 32,768 droplets within 35 m at 0.75 of the render size (measured 0.33 ms p50 close up) | under 0.3 ms: 256 lips, curtains only, 5 rows |
| Shading | 0.9 ms (SSR, mip refraction) | 0.6 ms (no SSR, single-mip refraction) |
| Caustics (inside opaque) | 0.15 ms | 0.05 ms (one layer) |
| Summary rebuild (worker) | 25 ms | 80 ms |
| Readback | under 0.05 ms main thread | same |

## Acceptance checks

- Lower a hollow beside the spring: water flows in, fills it to the lip within about a minute and spills toward the sea along a visible little stream with foam at the steps.
- Raise ground inside a pond: water bulges aside rather than vanishing.
- Watch half a game day: the sea slides out across the flats, which stay shiny for a while and then dull. It comes back in, filling the shallows first.
- At a spring tide (new or full moon) the low tide uncovers noticeably more than at a neap tide.
- Looking straight down at a pond you see the pebbles, bent and slightly green. Looking across it you see the sky and the far bank reflected.
- On a sunny day, wavering bright caustic lines play on the pond floor.
- At night the moon lays a glittering path on the sea.
- A frog hopping into the pond makes rings that spread and fade. Fish swim below the surface and never above it.
- Drag the preview dial to low tide: the flats appear. Release it: the sea returns to the real level.

## Open questions

- Should a hollow with no spring fill by itself from rain, or should ponds need a spring or the pour tool to start them?
- Is the tide range (about 1.2 m from low to high, more at spring tides) right for the island's size, or should it feel smaller and gentler?
- Should the sea have small rolling waves breaking on the beach, or stay nearly glassy?

## Depends on / feeds into

- Depends on: `02-core-loop-and-idle-model.md` (clock, tick order, re-seed), `04-render-pipeline.md` (pass order, HDR copy), `06-sky-and-lighting.md` (moon phase, sky probe, glints), `08-terrain-and-sculpt.md` (bed height, chunks, wetness), `10-growth-and-seasons.md` (rain), `16-customization-and-photo-mode.md` (display time).
- Feeds into: `08-terrain-and-sculpt.md` (water depth for wetness), `10-growth-and-seasons.md` (moisture, damp hollows), `11-creatures-and-ecology.md` and `12-creature-roadmap.md` (water summary, tide band), `13-progression-and-expansion.md` (rising land), `17-audio.md` (flow class and foam for water sounds), `18-saves-and-persistence.md` (springs), `19-performance-and-quality-tiers.md`.
