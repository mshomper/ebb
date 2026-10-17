# 12 — Creature roadmap

> Fifteen species in five tiers, each tier tied to a kind of place: the pond, the meadow, the woodland, the wetland shore, and the night and the turning seasons. Every species wants a slightly different mix of water, food, shelter, quiet and company, so each one asks the player to build something new. Each has one behavior that makes it worth watching, one way the player connects with it, and one gift it gives back when it is happy. Frogs come first and are built in full for the vertical slice; everything else reuses what frogs prove out.

## Locked decisions

- Five tiers, three species each, in the order below. A tier's species become eligible to scout when its land exists (see `13-progression-and-expansion.md`). Tier 1 is eligible from the start.
- Every species gives **one gift** (a seed or a tool) when it first becomes happy. Land comes from **tier milestones**: when the second species of a tier becomes happy, new land joins. Gifts never expire and do not depend on order.
- Need models, mood, arrival and leaving follow `11-creatures-and-ecology.md`. Numbers below are starting values for the tuning panel, not final.
- **Winter dormancy**: frogs, hedgehogs, turtles, bees, butterflies, fireflies and bats go quiet in winter (hidden, mood held, not counted as unhappy). Their journal pages say where they sleep.
- **Starter kit** (before any gift): sculpt, water (pond and shallows, with the pour and soak tools), reeds and grass seeds. The slice has no structures; stepping stones and one lantern join the kit in M2, and paths in M3 (`20-roadmap-and-vertical-slice.md`). Every other seed and tool is a gift.
- **Colors**: species albedo regions are physical linear albedo (0 to 1), never palette hex. The palette maps them into its colors at tonemap (`05-look-and-palette.md`).
- **Frogs are the vertical-slice species.** Reeds give them cover, the pond and shallows give them water, and midges (the insect field fed by reeds near still water) give them food.

## How it works

Plain language: each tier teaches one new kind of habitat-building and one new kind of motion. The pond tier teaches water and hopping; the meadow tier teaches flowers and flight; the woodland tier teaches trees and four-legged walking; the shore tier teaches the tide and wading; the night tier teaches darkness and time.

```mermaid
flowchart LR
  T1[Tier 1 pond<br/>frogs, minnows, dragonflies] -->|2nd happy: meadow islet rises| T2[Tier 2 meadow<br/>bees, butterflies, songbirds]
  T2 -->|2nd happy: woodland knoll + bridge| T3[Tier 3 woodland<br/>hedgehogs, squirrels, owls]
  T3 -->|2nd happy: tide flats and marsh spit| T4[Tier 4 wetland shore<br/>herons, otters, turtles]
  T4 -->|2nd happy: outer skerry and long sandbar| T5[Tier 5 night and seasons<br/>fireflies, bats, cranes]
```

Gifts are chosen so one species helps the next: frogs give water lilies, which give minnows shade; minnows feed herons; songbirds plant oaks, which squirrels and owls need; the bridge gives bats a roost.

## Vertical slice: frogs (full detail)

| Aspect | Spec |
|---|---|
| Kind, activity | Individual. Crepuscular: active 18:00 to 02:00 and 04:00 to 07:00 game time; rests in reeds at midday. Dormant in winter (buried in pond mud). |
| Water (w 0.25) | Still water or tide band, depth 0.05 to 0.6 m; full score within 2 m, zero beyond 8 m. |
| Food (w 0.25) | Midge field within 6 m; demand 0.08 per frog per hour. Midges grow where reed biomass is within 3 m of still water, scaled by warmth. |
| Shelter (w 0.20) | Reed cover 1.0, grass 0.3, within 3 m; cover 0.2 starts counting, 0.6 is full. |
| Quiet (w 0.15) | Lanterns within 8 m at night, paths within 3 m by day. |
| Company (w 0.15) | Group 2 to 9, ideal 5; cap 12; happy needs 4 or more. Small bonus near dragonflies. |
| Gift | Water lily seed. In the slice, happiness shows through behavior and the journal page only; the gift card and the lilies themselves arrive in M2, the first unlock in `20-roadmap-and-vertical-slice.md`. |
| Signature behavior | **Dusk chorus**: content frogs call from the reed margin with the throat sac swelling; neighbors alternate rather than overlap (each frog delays its call if another started within 0.4 s), so the chorus ripples around the pond. In spring, nesting shows as frogspawn clumps in the shallows. |
| Other behaviors | Tongue-flick at midges (forage); sit still on a stone or pad (rest, linger); plop into water and surface eyes-up 2 m away (startle); slow hop along the far edge (restless wander). |
| Interaction hook | Call: a soft croak whistle, answered by frogs with trust above 0.3. Feed: a pinch of midges at the cursor. Photograph moments: "dusk chorus", "frogspawn", "a frog that came when called". |
| Body recipe | Ellipsoid torso (squashed 1 : 0.6 : 1.3); round-cone head blended k 0.02 m; two eye spheres raised on the head top; throat sac sphere under the jaw (spring-scaled); hind legs as three capsules each (thigh, shank, long foot) folded at rest; short foreleg capsules. Length 7 to 9 cm. Albedo regions (linear): moss-green back about 0.12 to 0.16, sand-pale belly about 0.40 to 0.50, seeded dark bark-brown blotches about 0.05 to 0.08; the palette maps them into its colors at tonemap. |
| Motion | Hop: ballistic arc 0.3 to 0.6 m, legs extend via IK then fold, squash-and-stretch spring on landing. Swim: frog-kick cycle at the surface, floats with eyes above water. Breathing spring on throat at rest. Faces the camera slowly when lingering. |
| Audio | Call voice and chorus layering in `17-audio.md`. |

## Tier 1 — pond island (starter, about 64 m)

| | Minnows | Dragonflies |
|---|---|---|
| Kind | Swarm, diurnal, active all year (deeper in winter) | Swarm of few (3 to 8 visible), diurnal, summer and late spring |
| Water | Still or slow water, depth 0.2 to 1.5 m, at least 20 m² | Still water within 10 m, sunny |
| Food | Midge field over water, pondweed when available | Midge field (competes lightly with frogs) |
| Shelter | Water lily pads and reed stems at the water's edge | Reeds as perches and emergence stems |
| Quiet | Low sensitivity (shade from structures is fine) | Low sensitivity |
| Company | School of 8 to 30 | 3 to 8 |
| Gift | Pondweed seed (underwater meadow, holds more fish) | Stream tool (a spring that feeds running water) |
| Signature | School turns as one, flashes silver when the sun hits | Hovering patrol over the pond; pairs in tandem flight |
| Interaction | Feed: crumbs make the school swirl up to the surface | Follow camera rides along a patrol route |
| Body | Capsule body tapered with a round-cone tail fin; impostor at distance | Thin capsule abdomen, sphere thorax and head, four flat wing ellipsoids |
| Motion | GPU boids under the live water surface | Boids with hover hold points; wing flap as spring-driven phase |

## Tier 2 — meadow (the meadow islet)

| | Bees | Butterflies | Songbirds |
|---|---|---|---|
| Kind | Swarm, diurnal, spring to autumn | Swarm of few, diurnal, summer | Individuals (robin, wren, jay), diurnal |
| Water | Any shallow edge within 40 m | Damp ground (puddling) within 20 m | Shallow edge or bird-bath stone within 30 m |
| Food | Nectar field (clover, wildflowers) | Nectar plus a host plant patch | Seed field and insect field |
| Shelter | Sunny bare bank or stone wall | Tall grass, sunny wall to bask | Hawthorn hedge or shrubs |
| Quiet | Paths fine | Low | Moderate (paths fine, lanterns at dawn not) |
| Company | 20 to 80 | 4 to 15 | Pairs, 2 to 8 |
| Gift | Hawthorn seed | Stone wall tool | Oak (acorn) seed: the jay plants it |
| Signature | Flower-to-flower drift, waggle on the bank | Basking with open wings on warm stone | Dawn chorus; nest building in spring |
| Interaction | Photograph a bee on each flower species | Call: lands on the camera's focus point | Feed seed; a named robin follows the cursor |
| Body | Sphere head, sphere thorax, ellipsoid abdomen with banding | Thin capsule body, two pairs of flat wing ellipsoids with seeded patterns | Sphere body, sphere head, cone beak, ellipsoid tail and wings |
| Motion | Boids with flower targets | Fluttering path with noise, wing spring | Hop gait on ground, flap and glide in flight, perch on branches |

## Tier 3 — woodland (the woodland knoll and its bridge, which arrive at the Tier 2 meadow milestone)

| | Hedgehogs | Squirrels | Owls |
|---|---|---|---|
| Kind | Individual, nocturnal, dormant in winter | Individual, diurnal | Individual (pair), nocturnal |
| Water | Shallow edge within 30 m | Any water within 40 m | Any water within 60 m |
| Food | Beetle field (leaf litter plus moisture) | Nut field (hazel, oak, beech) | Small-prey field (grass plus litter) |
| Shelter | Leaf litter under hedge, wall or bramble | Mature tree for a drey | Old tree with a hollow (oak past maturity) |
| Quiet | Lanterns within 6 m at night | Paths fine | Lanterns within 15 m at night |
| Company | 1 to 3 | 2 to 6 | A pair |
| Gift | Bramble (blackberry) seed | Beech seed | Night-photo tool (long exposure in photo mode) |
| Signature | Snuffling forage along wall bases | Spiral chase around a trunk; caching nuts | Silent glide between trees; hooting duet |
| Interaction | Feed: a dish at the cursor; named hedgehog returns nightly | Feed nuts; caches appear as seedlings later | Call: answers the whistle with a hoot |
| Body | Ellipsoid body, round-cone snout, spine shell as displaced SDF noise | Ellipsoid body, sphere head, large tail of chained spheres | Egg body, flat facial disc, two large eyes, folded wing ellipsoids |
| Motion | Quadruped IK, short trot | Quadruped IK, bounding gait, trunk climbing on tree SDF, tail springs | Perch idle head turns, glide flight |

## Tier 4 — wetland shore (tide flats and the marsh spit)

| | Herons | Otters | Turtles |
|---|---|---|---|
| Kind | Individual, diurnal, all year | Individual, crepuscular, all year | Individual, diurnal, dormant in winter |
| Water | Tide band and shallows 0.1 to 0.5 m | Running or slow water, depth over 0.5 m | Still warm water, depth 0.3 to 1.2 m |
| Food | Fish field (minnows) in shallows | Fish field | Pondweed and water lilies |
| Shelter | Tall reeds or trees to roost | Bank holt under roots or stones | Basking logs or stones in sun |
| Quiet | High: paths within 12 m by day | Moderate | Moderate |
| Company | 1 to 2 | 2 to 4 | 2 to 6 |
| Gift | Tide stone tool (choose gentle or strong tides) | Alder seed (bankside tree) | Drift log tool (place fallen logs) |
| Signature | Stands still for minutes, then strikes | Slides down a bank, rolls and plays in pairs | Stacks of turtles basking on one log |
| Interaction | Photograph the strike | Call: pops up and watches the camera | Feed lily leaves; named turtle ages visibly |
| Body | Slim ellipsoid body, long neck of chained capsules, long cone beak, stilt legs | Long capsule body, flat round-cone tail, small sphere head | Flattened ellipsoid shell, sphere head on a short neck, flipper-shaped ellipsoids |
| Motion | FABRIK neck, slow wading IK, slow flap | Swim along a spline, quadruped bound on land, play loops | Slow paddle, haul-out onto logs |

## Tier 5 — night and seasons (the outer skerry and long sandbar)

| | Fireflies | Bats | Cranes |
|---|---|---|---|
| Kind | Swarm, nocturnal, summer only | Swarm of few, dusk and night, dormant in winter | Rare visitors: arrive at the spring and autumn turns, stay 1 to 3 game days |
| Water | Damp ground (moisture field) | Open water to drink in flight | Shallows and tide flats on the skerry |
| Food | Larvae in moist leaf litter | Midge field at dusk | Fish field and seed field |
| Shelter | Tall grass and meadow edges | Hollow trees or under the bridge | None needed; wide open sight lines instead |
| Quiet | Very high: no lanterns within 15 m | Lanterns along flight lines | Very high: no paths or structures within 20 m |
| Company | 20 to 200 | 5 to 20 | Flock of 4 to 12 |
| Gift | Evening primrose seed | Moonlight palette (`05-look-and-palette.md`) | Wild cherry seed; their arrival is usually the last step toward the year page (`13-progression-and-expansion.md`) |
| Signature | Synchronized flashing that spreads through the swarm | Stream out from the roost at dusk, zigzag over water | Pair dance: bowing and leaping at dawn |
| Interaction | Photograph the sync | Follow the dusk stream | Photograph the dance; "happy" here means they danced before leaving |
| Body | Tiny impostor with an emissive tail (physical emission, palette last) | Small ellipsoid body, membrane wings as thin SDF fans | Tall ellipsoid body, long capsule neck and legs, wing ellipsoids |
| Motion | Boids plus coupled-oscillator flash phase | Boids with sharp turns | Flock V formation in flight, slow wading IK |

## Data and interfaces

One recipe per species in `recipes/species/<id>.json`, schema in `11-creatures-and-ecology.md`, with extra fields `gift: {kind:"seed"|"tool"|"palette", id}`, `dormant: ["winter"]`, `visitor: {seasons:["spring","autumn"], stayDays:[1,3]}` for cranes, and `signature: "<behavior id>"`. The happy event (`species:happy`) carries the gift id; `src/world/expansion.js` watches it for tier milestones.

## Algorithms and shaders

Reuse from doc 11 throughout. New per tier: frog call alternation (call inhibition window, a simple form of anuran chorus timing); boids with targets (bees, dragonflies); quadruped gait phase tables (hedgehogs, squirrels, otters); FABRIK neck (herons, cranes); firefly sync as a Kuramoto coupled-oscillator model, with coupling strength rising with mood so a happier swarm flashes in tighter unison.

## Tuning knobs

Each species exposes its needs, gift, group sizes, body primitives and motion constants in the tuning panel. A "roadmap" view lists all fifteen with unlocked, eligible, present and happy status as drawn icons.

## Performance budget

Per-species additions must stay inside doc 11 totals. Rule of thumb: swarm species share one boids pass; at most 6 individual species are animated at full rate at once, others at 4 Hz off-screen. Fireflies and minnows use impostors only.

## Acceptance checks

- Slice: frogs meet every row of the frog table above (except the gift card, which is M2), including the dusk chorus ripple.
- Each later species, when built: its heat map makes sense, its signature behavior appears within one game day of becoming content, and its gift card appears once.

## Build order

1. Frogs (slice, S6 in `20-roadmap-and-vertical-slice.md`)
2. Minnows (first boids, first fish field)
3. Dragonflies (flying boids, wing springs)
4. Bees, 5. Butterflies, 6. Songbirds (first birds and perching)
7. Hedgehogs (first quadruped), 8. Squirrels (tree climbing), 9. Owls
10. Herons (FABRIK neck), 11. Turtles, 12. Otters (swim plus land gait)
13. Fireflies (oscillator sync), 14. Bats, 15. Cranes (visitor system)

## Open questions

- Should songbirds be one species with three looks, or three separate journal pages?
- Should herons ever eat a frog, or only fish?
- Is a gift every species too frequent late in the game, or about right?

## Depends on / feeds into

Depends on `11-creatures-and-ecology.md`, `10-growth-and-seasons.md`, `07-water-and-tide.md`. Feeds `13-progression-and-expansion.md`, `14-asset-recipes-and-tuning-panel.md`, `17-audio.md`, `20-roadmap-and-vertical-slice.md`.
