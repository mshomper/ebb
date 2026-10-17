# 07 — Water and Tide

> Water is half of ebb's name and most of its calm. Water always runs downhill: dig a hollow and it fills, cut a channel and a stream finds it, raise a bank and the pond spills a new way. Twice a game day the sea breathes in and out, uncovering shiny tide flats and shallows that waders and crabs use, then covering them again. Under the soft palette the water behaves optically like real water: it reflects the sky at grazing angles, bends and tints what lies beneath, turns deep teal with depth, throws caustics on the pond floor and gathers foam where currents meet. This doc defines the live water simulation, the tide, how water is drawn, and the small deterministic "water summary" that the ecology and creatures use.

## Locked decisions

- **Live water is a GPU shallow-water heightfield using the virtual pipe model** (O'Brien and Hodgins 1995; Mei, Decaudin and Hu, "Fast Hydraulic Erosion Simulation and Visualization on GPU", 2007). Cell size **0.5 m** (2×2 terrain cells from `08-terrain-and-sculpt.md`) at every tier.
- **Live water is visual only and not deterministic.** It runs on animation time (real seconds), at fixed step 1/120 s, capped at 4 steps per frame (see `04-render-pipeline.md`). Ecology never reads it.
- **The water summary is the truth for ecology.** A deterministic CPU computation (integer heights, priority-flood) in a worker produces, per 1 m ecology cell: standing depth at mean tide (u8, cm), flow class (none, still, slow, running, sea), tide-band flag and basin id. It is rebuilt only when terrain or water features change, or land rises. It is never saved; it is rebuilt on load (`18-saves-and-persistence.md`).
- **Tide is analytic** (`src/world/tide.js`): `level(t) = h0 + A(t) · cos(2π t / 12 h + φ)` with h0 = 0 m (mean sea level, Y = 0), base amplitude **A0 = 0.6 m**, and a spring and neap swing of ±15% driven by moon phase from `06-sky-and-lighting.md`: `A(t) = A0 · (1 + 0.15 · cos(4π · moonPhase(t)))`. Spring tides fall at new and full moon, twice per season.
- Rendering reads tide at **display time**; ecology and `coarseStep` read it at **world time** (see `16-customization-and-photo-mode.md`).
- **Chunk-aware.** Water textures cover the world chunk grid of doc 08 at 0.5 m (the world limit of 192 m by 192 m, 6×6 chunks of 32 m, so at most 384×384 cells), allocated once. Simulation dispatches **per active 32 m chunk tile** (64×64 cells). At that limit (doc 13's expansion ceiling) the worst case is 36 tiles, 147,456 cells.
- Activity per chunk (doc 13): chunks within 60 m of the camera focus run every step. Other chunks with water, shoreline or summary-flagged flow run at quarter rate with 4× step. Open sea outside land chunks is an analytic tide plane with procedural waves.
- Starter water tools: **pour** (temporary brush source) and **soak** (temporary brush sink), plus one fixed **starter spring** (persistent source) placed by the land recipe. Player-placed springs and streams arrive only with the dragonflies' gift, the **stream tool** (`12-creature-roadmap.md`). Springs are saved in the store slice `water`. (S4b, October 2026: the spring mechanism is built into the Water tool's Spring mode: up to 4 placed springs, each trickle 3, brook 12 or stream 30 L/s, undoable. It is locked behind the store flag `unlocks.springs`, which the dragonflies' gift sets; the `?sandbox` address flag sets it early for testing.)
- One hourly `coarseStep` for tide (in `src/world/tide.js`) and one for the water summary (`src/world/water/coarse.js`), run in the shared order from `02-core-loop-and-idle-model.md`: tide, weather, seasons, water summary, growth, ecology, creatures, expansion.

- **Built in three slice steps** (doc 20, October 2026): **S4a** the tide, the live simulation, the starter spring and the water drawing; **S4b** the water summary, the nudge, pour and soak, readback and tide events; **S4c** the sky probe, screen-space reflection, caustics, foam, ripples and the visual wetness pass. S4a's interim choices:
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
  - Water tool: Pour and Soak at up to 60 L/s under the brush; Spring (locked behind `unlocks.springs`). `water.sampleLive(x, z)` reads a CPU copy of depth and velocity made four times a second through a ring of three buffers.

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
    SRC[springs, pour, soak, rain] --> FL
    BC --> FL[Flux pass: pipes]
    NUD --> DP
    FL --> DP[Depth pass]
    DP --> VEL[Velocity pass]
    VEL --> FO[Foam advect + generate]
    RIP[Ripple layer 32 m window] --> DRAW
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
2. Sea cells are those connected to the world edge with bed below mean sea level. Tide band cells have a bed within `[−1.15 A0, +1.15 A0]`, the full spring tide range.
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
- **Motion** uses live water: GPU boids (fish, insects over water) sample `waterDepth` and `waterVel` directly through `lib-water.wgsl`. CPU-animated creatures (frogs, herons, otters) call `water.sampleLive(x, z)`, which reads a 1 m downsample of depth, surface height and velocity for active chunks, copied back four times per second through a ring of three staging buffers, so a read never stalls. Outside active chunks it falls back to the summary plus tide.

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
| `ripple` A/B | r32float, 256² | 32 m window at 0.125 m around the camera focus |

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
- **Foam**: generated where flow converges (`−∇·u` above a threshold), where the surface drops sharply between neighbors (little falls), and where thin water moves fast at the shore (swash). It is advected semi-Lagrangianly by `waterVel` and decays over about 6 s.
- **Ripples**: a damped 2D wave equation on the 256² window, driven by raindrops, creature entry and exit points, fish surfacing and the pour brush. Its gradient adds to the surface normal.
- **Detail waves**: two scrolling normal maps, flow-mapped by `waterVel` (Vlachos, "Water Flow in Portal 2", 2010). Open sea adds 4 Gerstner waves (amplitude at most 6 cm, gentle) whose height fades to zero in water shallower than 0.5 m.

**Shading** (`water-draw.wgsl`, after the HDR copy in doc 04):

- Mesh: per active chunk a 64×64 grid displaced to `bed + depth`. Vertices of dry cells sink 2 cm under the terrain, and a soft edge fades over the first 3 cm of water thickness, so shorelines never show a hard line. Open sea uses an analytic plane at the tide level plus a horizon skirt.
- **Fresnel**: Schlick with F0 = 0.02 (water, n = 1.333).
- **Reflection**: sky probe and specular mips from doc 06. On the high tier, a 16-step screen-space reflection of the island in `sceneColorCopy`, falling back to the probe. Sun and moon glints use GGX with their illuminance, which is what draws the moon path at night.
- **Refraction**: screen offset `n.xz · 0.06 · min(thickness, 1 m)`, sampling `sceneColorCopy` at a mip chosen by thickness. Samples whose `depthCopy` lies in front of the water are rejected and fall back to the unrefracted sample.
- **Absorption** (Beer-Lambert): thickness `L` = distance along the view ray from the surface to `depthCopy`. Transmittance `T = exp(−σ_a L)` with σ_a = (0.45, 0.065, 0.05) per meter for the sea and (0.6, 0.14, 0.22) for ponds (slightly greener and peaty). In-scatter adds `(1 − T) · albedo_s · (sky SH + sun · transmittance)`. Depth reads as teal, then blue, physically, and the palette then softens it toward sea glass.
- **Caustics**: projected along the sun direction onto bed pixels in the opaque pass (they read `waterDepth`). Two scrolling procedural Voronoi-ridge layers, modulated by the surface normal's convergence, faded in over the first 5 cm and out by 2 m, scaled by sun illuminance. They are off at night except a faint moon term.
- **Foam**: lit Lambert, albedo 0.8, with a broken-up noise mask.
- **Shoreline wetness**: doc 08 owns the wetness field. Water provides `waterDepth` and `tide.level`. The terrain shader darkens wet albedo and lowers roughness (Lagarde, "Water drop 2", 2013).

**What the coarse model keeps**: the summary (depth at mean tide, class, tide band, basin), the spring list, and the analytic tide. It drops velocities, foam, ripples, live depths and rain puddles, which are all rebuilt by `reseedFromCoarse()`: the live depth is set from the summary plus the current tide, followed by a silent 200-step settle behind the reveal fade (`02-core-loop-and-idle-model.md`).

## Tuning knobs

- Tuning panel (`recipes/world/water.json`): base tide amplitude, spring and neap swing, tide phase; friction; foam thresholds and decay; nudge time; rain-fed pond catchment threshold; stream depth law; absorption coefficients per water body; scattering albedo; caustic strength; Gerstner wave set; refraction strength. Overlays: flow class map, basin labels, live minus summary difference.
- Player: starter water tool modes (pour, soak). The stream tool (dragonflies' gift) places springs and sets their rate (three steps: trickle, brook, stream).

## Performance budget

| | high (desktop, 1440p) | low (phone) |
|---|---|---|
| Simulation, worst case 36 tiles | 0.6 ms (2 steps per frame) | 0.9 ms (active radius 40 m, 1/60 s steps) |
| Foam and ripples | 0.15 ms | 0.1 ms (ripples 128²) |
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
