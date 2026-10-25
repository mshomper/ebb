# F16 — The sea cave and the Hollow

> Where the sea has worked at a cliff long enough, it opens a mouth. Inside is a chamber that is always the same: tide pools, weed, the sound of the sea. Two ways lead on. One is choked with fallen rock, and digging through it, visit by visit, leads to quiet chambers and a sleeping bear. The other is an old arch with soot marks around it, and the walker won't go through it with empty hands. Beyond it is **the Hollow**: floors that are different every time you go down, things in the dark that don't belong to the island, and a lantern that decides how far you get before you have to turn back. Nothing makes a player go there. It's for the ones who want it, the way the mines are in Stardew Valley.

**Status:** Seed. Not scheduled. Drafted October 25, 2026, from Matt's ask for a cave with a dungeon-crawling experience, then redrafted the same day to Matt's own design (below). It builds on Matt's pin of October 18, 2026 (caves for a landmark creature such as a bear) and doc 20's M7 line on placed rock pieces for sea caves.

## Decided so far (Matt, October 25, 2026)

- **Optional.** Nothing on the surface needs the cave. A player goes there only to do everything, as in Stardew Valley's mines. It has **its own trail**.
- **The mouth never changes.** It is one fixed, hand-made area.
- **To one side, a rubble passage**, blocked at first, that eventually leads to the bear.
- **Another entrance that needs a weapon.** The player can't go through until they've made one.
- **Beyond it, the Hollow:** floors that change procedurally and get tougher as the player progresses.
- **No numbered levels.** Progress is tracked by internal numbers for the player's skills and equipped items, and the Hollow sets its enemies' level from them.
- **The lantern decides** how far the player can go before they have to call it quits.

## What this changes for ebb

This is the first place in ebb with enemies. Doc 01 lists "no combat" as a non-goal. The proposal is a single, bounded exception:

- **Combat happens only in the Hollow, and only when the player chooses to go in.** The island, the camp, the rubble passage and the bear's chambers never have enemies.
- **Nothing from the Hollow ever comes up.** The surface stays exactly as cozy as it is now.
- **The island's real creatures are never fought.** The Hollow's things are not animals (see the bestiary).
- **No death.** When the light gives out, the walker finds their way out in the dark and wakes at the mouth (see when the lantern goes out).

## The layout

```mermaid
flowchart LR
  M[The mouth<br/><i>fixed, never changes</i>] -->|shovel, over several visits| R[Rubble passage]
  R --> Q1[Dripstone gallery]
  Q1 -->|reed raft| Q2[Underground lake]
  Q2 --> Q3[The old marks]
  Q3 --> B[The bear's den]
  M -->|a weapon you made| G[The arch]
  G --> H1[Hollow floor]
  H1 --> H2[Hollow floor]
  H2 --> H3[Hollow floor]
  H3 --> H4[... as deep as<br/>the lantern lasts]
```

### The mouth

- One fixed space, hand-built, the same on every island: a wave-cut floor, weed, rock pools with prawns and a blenny, daylight from the entrance.
- At high tide the sea fills the entrance. The walker comes in at low tide. The rubble passage, the arch and everything beyond are above the highest tide, so no one is ever trapped: the walker waits on the ledge or rests until the water drops.
- A **lantern hook** by the arch. The walker hangs the lantern here and it lights the mouth while they look around. It's where every trip into the Hollow starts and ends.

### The rubble passage and the bear

The quiet half of the cave, with no enemies.

- **The rubble** is cleared with the shovel (P2c digging), a stretch per visit, so getting through takes several trips. Each stretch turns up something: old bones, a bead, a fossil.
- **Behind it** are hand-made chambers that never change: a dripstone gallery, an underground lake crossed on the reed raft, and a wall of old soot marks with the earlier keeper's letter (F13 section 10).
- **The bear's den** is the last chamber. A brown bear comes to the island late in the game, once the woodland can feed it, and winters here. Finding it asleep is the quiet climax: you lower the lantern and leave. Its trust grows by being left alone. It is never an enemy.
- The cairn builder (F14) can lead here.

### The arch

- An old arch to the other side of the mouth, ringed with soot and scratched signs. Something moves in the dark beyond it, just past the lantern's reach.
- **Without a weapon** the walker stops at the arch: *"Not with empty hands."*
- **With a weapon they made**, the walker steps through. The first time, the arch's journal page opens the Lamplighter's trail.

### The Hollow

A trip is a run down through floors, one after another, until the player decides to head back up or the lantern gives out.

- **Each floor** is a handful of chambers and passages. It has a way down (a shaft, a slope or a rope drop), enemies, finds, and sometimes a feature:
  - an oil seep that tops up the lantern a little
  - a crystal pocket
  - a still pool with something in it for the net
  - a guardian floor: one strong enemy and a better find
- **Every trip is new.** A floor's layout comes from the island seed, the trip number and the floor's place in the trip. The Hollow is seeded, so saves and replays are exact, but no two trips repeat.
- **The way up** is always marked. On any floor the walker can climb back out with everything they're carrying. Going up is a walk back to the arch with a fade, not a climb through every floor.
- **Not simulated while away.** Nothing grows or moves in the Hollow while the game is closed. It has no part in catch-up.

## How hard it gets: the keeper's measure

There are no numbered levels. Instead the game keeps one internal number, the **keeper's measure**, made from the walker's skills and what they carry. The player never sees it as a number.

```mermaid
flowchart LR
  S[Skills<br/><i>fighting, lamp craft,<br/>footing, Hollow lore</i>] --> K[Keeper's measure]
  E[Equipped<br/><i>weapon, coat,<br/>lantern, charm</i>] --> K
  K --> D0[A trip's starting level<br/><i>a little below the measure</i>]
  D0 --> F[Each floor down this trip<br/>adds a step]
  F --> EN[Enemies: health, damage,<br/>speed, kinds, numbers]
  F --> LO[Finds: better with<br/>every step]
```

- **Skills** are the four tracks below. Each rank reached adds to the measure.
- **Equipped items** each carry a tier: the weapon, the coat, the lantern and a worn charm.
- **A trip starts a little below the measure**, so the first floor of any trip feels comfortable. **Each floor further down in the same trip adds a step**, and finds get better with each step. How deep a player goes in one trip is how hard it gets, so pushing on pays off.
- **The measure lags growth.** If the Hollow matched every gain, getting stronger would feel like nothing. That's the known trap of level scaling. So the Hollow counts only part of each gain (about 70% to start, a recipe value). A better weapon always feels better, and the Hollow catches up only slowly.
- **A slow average.** The measure uses a slowly moving average of the player's best kit, so swapping to a stick at the arch to make the Hollow easy doesn't work.

## The four skill tracks

Each skill is its own track with four ranks. A track fills by doing that thing in the Hollow, and each rank makes the walker stronger in a way the player can feel. The thresholds are recipe values. A new rank gets a line in the walker's hand on the Lamplighter's trail page (*"My feet have learned the wet rock"*), and the track shows as four marks, never as a number.

```mermaid
flowchart LR
  subgraph F[Fighting: hits landed, enemies beaten]
    F1[1 Steady hand] --> F2[2 Follow-through] --> F3[3 Finding the seam] --> F4[4 The sweep]
  end
  subgraph L[Lamp craft: time spent below]
    L1[1 Trimmed wick] --> L2[2 Steady flame] --> L3[3 Flare] --> L4[4 Ember keep]
  end
  subgraph O[Footing: dodges, climbs, wet ground crossed]
    O1[1 Light step] --> O2[2 Sure feet] --> O3[3 Tumble] --> O4[4 Second wind]
  end
  subgraph H[Hollow lore: kinds met, bestiary pages, floors read]
    H1[1 Tells] --> H2[2 Weak points] --> H3[3 Reading the stone] --> H4[4 Old ways]
  end
```

### Fighting

Fills from hits landed and enemies beaten.

| Rank | Name | What it does |
|---|---|---|
| 1 | **Steady hand** | Recovery after each swing is shorter, so swings come faster |
| 2 | **Follow-through** | Every third hit in a row staggers the enemy |
| 3 | **Finding the seam** | Hits on armored enemies (silt crawlers, barnacle backs) from the side or behind do full damage |
| 4 | **The sweep** | Hold the swing to charge it, then let go to hit everything around the walker |

### Lamp craft

Fills from time spent below, more on deeper floors.

| Rank | Name | What it does |
|---|---|---|
| 1 | **Trimmed wick** | Fuel lasts about 15% longer |
| 2 | **Steady flame** | Hits make the flame gutter less, so each one costs less fuel |
| 3 | **Flare** | Once per floor, the walker flares the lantern. Light-shy enemies nearby scatter and are stunned for a moment |
| 4 | **Ember keep** | Once per trip, when the light would go out, it holds as an ember long enough to walk to the way up and keep everything |

### Footing

Fills from dodges that avoid a hit, climbs, and wet or broken ground crossed.

| Rank | Name | What it does |
|---|---|---|
| 1 | **Light step** | The dodge step recovers faster |
| 2 | **Sure feet** | No slowing on wet rock, weed or silt; climbs and rope drops are quicker |
| 3 | **Tumble** | The dodge becomes a roll that passes through enemies untouched |
| 4 | **Second wind** | After a dodge at the last moment, the next hit does double damage |

### Hollow lore

Fills from each new kind met, each bestiary page and each floor fully walked.

| Rank | Name | What it does |
|---|---|---|
| 1 | **Tells** | Enemies' wind-ups show sooner, as a glint in the lantern light |
| 2 | **Weak points** | Kinds with a full bestiary page take more damage |
| 3 | **Reading the stone** | On each floor, a draft of air shows toward the way down, and finds glint at the lantern's edge |
| 4 | **Old ways** | Once per trip, the walker spots a hidden side passage to a find room |

## The lantern

The lantern is how far you can go.

- **Fuel is made at camp** (see Lanterns below for the fuels). Each trip starts with whatever fuel the walker brings.
- **It burns down** as you go, and a little faster on deeper floors.
- **Its light is a real light.** Better lanterns reach further or burn longer (see Lanterns below). Some enemies shy from the light, so a bigger light is a defense.
- **Recommended: the lantern is also the walker's health.** A hit makes the flame gutter and costs fuel. One thing to watch, drawn as the flame itself, with no hearts or health bar. A long, clean trip goes deep; a scrappy one ends early. The alternative is a separate steadiness meter.
- **When it runs low**, the light shrinks, enemies grow bolder, and the walker says it's time: *"The light won't last."* The player heads for the way up.

### When the lantern goes out

- The screen goes dark, and the walker finds their way out by touch. They wake at the mouth with the hook's lantern lit.
- Everything brought in is kept: the weapon, the coat, the lantern, anything from camp.
- Part of what was found on this trip is dropped in the dark, a seeded share of it. This is Stardew's rule, and it's what makes turning back in time a real decision.

## Fighting

Simple, readable, from the below-view camera.

- **Swing** the weapon. Each weapon has its own reach and rhythm.
- **Dodge step** out of the way.
- **Raise the lantern.** This pushes back light-shy enemies but burns fuel faster.
- **Sling.** It throws pebbles, which the walker already gathers, so the pebble store becomes ammunition.
- A gentle lock-on to the nearest enemy, and a **"gentler Hollow"** setting for younger players (Matt's testers are 7 and 10).

## What the walker carries

Weapons, lanterns and coats are all made at camp with the making core (S1).

- **At most three ingredients** per item.
- **Better tiers use what the Hollow gives**, which is the loop: go down, bring back, make, go deeper.
- **An item can be an ingredient of its own upgrade**, so nothing made is wasted.
- **Tiers 1 to 4** feed the keeper's measure.

These lists are a pool to pick from, not a build list. A suggested first set is marked in each table.

### Weapons

| Weapon | Kind | Made from | Tier | Good at | First set |
|---|---|---|---|---|---|
| **Driftwood staff** | Staff | Drift stick, rush cord | 1 | Balanced reach and speed. The first weapon; it opens the arch | Yes |
| **Hazel quarterstaff** | Staff | Hazel rod, rush cord | 2 | Faster swings than the drift staff | |
| **Barnacle staff** | Staff | Ship's timber, barnacle shell, birch tar | 3 | Rough ends that crack armor: good against crawlers and barnacle backs | |
| **Lantern staff** | Staff | Hazel rod, crystal, rush cord | 3 | The lantern hangs from its head, so the light reaches further while fighting. Weaker hits | |
| **Burl club** | Club | Drift root, rush cord | 1 | Slow, heavy, staggers | |
| **Stone maul** | Club | Flat stone, ship's timber, rush cord | 2 | The biggest stagger, knocks enemies back. Very slow | Yes |
| **Pearl-studded club** | Club | Drift root, cave pearls, birch tar | 3 | Each hit throws a spark of light that sends light-shy enemies back | |
| **Shell knife** | Blade | Razor shell, rush cord | 1 | Quick and short. Cuts free of tanglers at once | Yes |
| **Flint knife** | Blade | Flint, hazel rod, birch tar | 2 | Quick and sure | |
| **Crystal blade** | Blade | Crystal, ship's timber, birch tar | 3 | Very sharp. The best against tide shades | |
| **Star-iron knife** | Blade | Star-iron, ship's timber, brine salt (to quench it) | 4 | The best blade | |
| **Fire-hardened spear** | Spear | Hazel rod, hardened at the hearth | 1 | Long reach, cheap | |
| **Flint spear** | Spear | Ship's timber, flint, rush cord | 2 | Long reach and a real point | Yes |
| **Bone harpoon** | Spear | Bone, hazel rod, nettle cord | 3 | Thrown on its line and pulled back. Drags brine eels out of the water and drip wisps off the ceiling | |
| **Star-iron spear** | Spear | Star-iron, ship's timber, birch tar | 4 | The best reach. The island's star-iron makes either this or the knife, never both | |
| **Sling** | Thrown | Rush cord, sailcloth | 1 | Pebbles as shot, from the pebble store | Yes |
| **Bolas** | Thrown | Nettle cord, pebbles | 2 | Tangles legs and wings: slows enemies, brings wisps down | Yes |
| **Hazel bow** | Shot | Hazel rod, nettle cord | 3 | The longest reach; needs arrows | |
| **Wrack whip** | Odd | Tangle fibre, rush cord | 2 | A long lash that pulls small enemies in | |
| **Ember brand** | Odd | Hazel rod, rushes, oil | 2 | A burning club with its own light. Light-shy enemies won't close. Burns out after a floor | |
| **Hagstone flail** | Odd | Hagstone, hazel rod, nettle cord | 3 | A wide spinning arc. Looking through its stone shows tide shades, and it hits watchers hard | |

**Shot and arrows,** made by the handful:

| Ammunition | Made from | For | Does |
|---|---|---|---|
| **Pebbles** | Gathered as now | Sling | Plain shot |
| **Clay shot** | Clay, fired at the hearth | Sling | Heavier, staggers |
| **Flare shot** | Clay, oil, soot | Sling | Bursts into light where it lands, scattering light-shy enemies |
| **Pearl shot** | Cave pearls | Sling | The hardest hit |
| **Arrows** | Reed, flint, feather | Bow | Plain arrows |

### Lanterns

The lantern is the trip's limit and, as proposed, the walker's health, so lanterns matter as much as weapons. Reach is how far the light goes; burn is how long a fill of fuel lasts, against the hand lantern.

| Lantern | Made from | Reach | Burn | Good at | First set |
|---|---|---|---|---|---|
| **Hand lantern** | The walker already has it | 6 m | 1x | Where everyone starts | Yes |
| **Clay lamp** | Clay, rush pith | 4 m | 1.5x | Cheap and long-burning, but a small light | Yes |
| **Shell lantern** | Ship's timber, oyster shell scraped thin, rush cord | 6 m | 1.2x | A steadier flame: hits cost less fuel | |
| **Sea-glass lantern** | Sea glass, ship's timber, birch tar | 8 m | 1x | A wider light, tinted by the glass | Yes |
| **Bulls-eye lantern** | Crystal, ship's timber, birch tar | 12 m ahead, 3 m around | 1x | A beam. Light-shy enemies caught in it slow down | |
| **Pearl lantern** | Cave pearls, crystal, clay | 7 m | 1.2x | An even, soft glow. Tide shades can't fade inside it | |
| **Ship's lantern** | The wreck's lantern (F14), sea glass, rush cord | 8 m | 1.6x | Storm-built: the longest burn | |
| **Ember pot** | Clay, charcoal, rush cord | Belt light | — | Worn with any lantern. If the lantern goes out, the ember pot lights the way to the way up once. Works with Ember keep | |

**Fuel:**
- **Rushlights:** rush pith dipped in seed oil. The first fuel.
- **Seed oil:** pressed in the mortar. It burns longer.
- **Hollow oil:** from lamp-eaters and oil seeps. It burns longest.

### Coats

A coat's guard is how much of a hit it takes off, which means less fuel lost from the lantern. Heavier coats guard more but slow the dodge.

| Coat | Made from | Guard | Good at | Tier | First set |
|---|---|---|---|---|---|
| **Rush cape** | Rushes, rush cord | Light | Keeps the dodge quick | 1 | Yes |
| **Oilskin coat** | Sailcloth, seed oil | Medium | Sheds hits; the all-rounder | 2 | Yes |
| **Soot cloak** | Sailcloth, soot, seed oil | Light | Enemies notice the walker later; watchers take longer to see them | 2 | |
| **Wrack cloak** | Tangle fibre, rush cord | Light | Tanglers can't hold on | 2 | |
| **Feather cape** | Feathers, nettle cord, sailcloth | Light | The dodge goes further | 3 | |
| **Limpet scale coat** | Limpet shells, sailcloth, birch tar | Heavy | Strong guard; a slower dodge | 3 | |
| **Barnacle mail** | Barnacle shell, nettle cord, birch tar | Heaviest | Stops the most; the slowest dodge | 3 | |
| **Pearl-lined oilskin** | Oilskin coat, cave pearls, crystal | Medium | The lining glows faintly, a little light of its own | 4 | |

### Charms

Keepsakes worn on the belt, one at a time, each with one small effect. A hagstone lets the walker see tide shades a moment sooner. A piece of sea glass tints the light. A cave pearl steadies the flame. Charms come from finds, not from making.

### Where the ingredients come from

| Ingredient | From |
|---|---|
| Drift stick, drift root | The strand (F10 logs) |
| Rushes, rush cord, rush pith | Rushes, worked at camp (F13) |
| Reed | Reeds at the pond |
| Nettle cord | Nettles, if they come to the island, worked at camp. A new plant |
| Hazel rod | A hazel, coppiced (F07). If none grows on the island, the passing boat (F14) can bring one |
| Birch tar | Birch bark cooked at the hearth: a camp make. Needs a birch |
| Flat stone, pebbles, razor shell, limpet shells, oyster shell, sea glass | The strand |
| Hagstone | Rare on the strand; common from hagstone watchers |
| Feathers | The hen (F15), or gulls' feathers on the strand |
| Seed oil | Pressed in the mortar (F13) |
| Charcoal | The hearth |
| Clay | The Hollow (silt crawlers), or the silted crawl |
| Ship's timber, sailcloth, the ship's lantern | The wreck (F14) |
| Star-iron | The falling star (F14) |
| Bone | The rubble passage |
| Flint, barnacle shell, crystal, cave pearls, soot, oil, brine salt, tangle fibre | The Hollow, from enemies and finds |

## The bestiary: things in the dark

They are not animals. They're made of the dark and the old sea, so the island's naturalist rules never apply to them. Beaten, they break into grey sand and motes of light, and drop what they were made around. No blood, no bodies. Each is rigged and animated (the creature rule). Swarms may use shader motion.

| Kind | What it does | Where | Drops |
|---|---|---|---|
| **Soot motes** | A swarm that drifts in and nips; scatters from the light | Any floor | Soot, for ink and dye |
| **Silt crawlers** | Crab-shaped, made of packed silt; slow, armored front | Wet floors | Clay, sand glass |
| **Drip wisps** | Hang from the ceiling and drop; quick | Dripstone floors | Cave pearls |
| **Barnacle backs** | Big, slow, charge in a straight line | Deeper floors | Shell, flint |
| **Brine eels** | Lunge from the water's edge | Pool floors | Brine salt |
| **Lamp-eaters** | Snuff the light: each touch drains fuel | Deeper floors | Oil |
| **Tide shades** | Fade between pools of light; only seen in the lantern's glow | Deepest floors | Crystal |
| **Wrack tanglers** | Heaps of dark weed that lie still until the walker is close, then grab and hold. Struggle free, or cut free with a blade | Wet and pool floors | Tangle fibre |
| **Hagstone watchers** | Floating stones with a hole through them that turn toward light. When one sees the walker it calls everything nearby. Dim the lantern, or reach it first | Any floor; in groups deeper down | Hagstones |

- **As the level rises**, kinds get tougher and gain behaviors: crawlers that burrow, wisps in pairs, shades that circle.
- **Each kind gets a bestiary page** in the journal the first time it's beaten: a sketch, its habits and its tells. Filling the bestiary is the Hollow lore skill.

## What comes back up

- **Materials** the surface can't give: flint, clay, ochre, soot, cave pearls, crystal, brine salt, oil. They feed the camp: clay for pots and bowls, ochre and soot for dyes, flint for tools, oil for the lantern.
- **Keepsakes** (F12) found only underground.
- **Make plans** for gear, found on guardian floors.

## The Lamplighter's trail

A fifth trail, alongside the naturalist's, the beachcomber's, the shaper's and the forager's.

- **Marks:**
  - first through the arch
  - the deepest a single trip has gone (a personal best in floors, not a level)
  - each bestiary page
  - each weapon made
  - each Hollow material found
  - through the rubble
  - the bear
- **Gifts along it:**
  - a better lantern
  - a rope back (once per trip, climb out from any floor and keep everything, even with the light going out)
  - make plans for gear

## How it is built

- **The fixed parts** (the mouth, the rubble passage and the bear's chambers) are implicit surfaces: chambers as smoothly blended blobs, passages as capsules, worn with noise, meshed once in a worker with dual contouring, and rebuilt from the seed.
- **Hollow floors** use the same mesher on a generated floor plan: a small graph of chambers and passages, made in a worker while the descent fades to black. Each floor is about 60k to 100k triangles, small enough to build in a moment.
- **TPMS for the strange floors.** A rare floor kind can be a gyroid sponge: rock eroded into a porous lattice, from a gyroid field clipped by the chamber shapes.
- **Walking** uses a walk grid from the mesh's upward-facing surfaces, and enemies path on the same grid.
- **Enemies** run simple state machines: idle, notice, approach, attack with a tell, recover. The tell is how a player learns them.
- **Light** is the lantern as a point light with soft shadows. The palette keeps the darks deep blue-green, never black (doc 05).
- **Recipes:** `recipes/world/cave.json` for the fixed parts and the lantern, and `recipes/world/hollow.json` for floor sizes, enemy tables, the measure's weights, the lag and the drop share.
- **A tool page,** `tools/cave-lab.html`, shows:
  - floors made from seeds side by side
  - the walk grid
  - the measure against floor depth, as curves for different players
  - how long meshing takes

## What it would change

- **01** vision: the non-goal "no combat" gains its one exception, the Hollow, which is opt-in and never reaches the surface. **Matt's call.**
- **04** render pipeline: an interior scene with its own pass list.
- **05** look: the cave's darks in the palette.
- **08** terrain: the cave mouth as a placed rock piece.
- **11, 12** creatures: the bear as the landmark; the Hollow's kinds kept apart from the ecology.
- **13** progression and journal: the Lamplighter's trail, the bestiary pages.
- **15** input: swing, dodge, raise the lantern, sling.
- **23** walker: fighting animations (swing per weapon, dodge, hit, lantern raise) and a climb.
- **F13** camp: weapons, lanterns, coats, fuel and ammunition as makes (at most three ingredients each); birch tar at the hearth; the Hollow's materials as inputs.
- **F10, 12** plants: hazel, birch and nettles as possible new plants, since several makes need them.
- **F14** scripted events: star-iron, ship's timber, the cairns.
- **17, 25** audio: cave reverb, enemy sounds, the lantern's flame.
- **18** saves: the measure, skills, trip count, rubble progress, the bestiary, the deepest trip.
- **19** performance: the interior budget.
- **20** roadmap: a late milestone, after the Headland (M7) at the earliest.

## Risks and guardrails

- **Tone.** Combat can sour a cozy game. Stardew shows it can live beside farming when it stays optional, bright and short. Keep the enemies strange rather than horrible, and keep the walker's lines calm.
- **Level scaling.** If the Hollow tracks the player too closely, progress feels pointless. The lag and the per-trip steps are there to prevent it. The cave-lab curves are where to check it.
- **Scope.** This is the biggest feature ebb would have: combat, enemy AI, a floor generator, nine rigged enemy kinds, many made items and fighting animations. A first version could be the mouth, the arch, three floor kinds and three enemies.
- **The surface must never need it.** Hollow materials make things better, but nothing on the island requires them.
- **Kid testers.** The gentler setting, and an end to a trip that never feels like punishment.

## Open questions

- Is the one exception to "no combat" right, kept to the Hollow?
- Does the sea open the cave in a tall cliff the player made (F16's first draft), or is it found in a cliff that's already there?
- Is the lantern also the walker's health, or is there a separate steadiness?
- When the light goes out, how much of the trip's finds is dropped: a share, everything found, or nothing?
- What do the Hollow's things look like? Matt to sketch a direction, or a session to propose some. Who makes their models is Matt's call (CLAUDE.md).
- Guardian floors: should there be bigger set-piece enemies, and how often?
- Should the player ever see anything of the measure, such as a hint like "the Hollow feels deeper today"?
- Which weapons, lanterns and coats make the first set? The tables suggest six weapons, three lanterns and two coats.
- Should hazel, birch and nettles come to the island as plants, or should their makes use something already here?

## Depends on / feeds into

- Depends on: the walker (doc 23) and its lantern, F13 (makes, the shovel and digging, the mortar), F14 (star-iron, ship's timber), doc 09 (the reed raft), 08 (placed rock pieces), M7 (the Headland), 04 to 06 (rendering and light).
- Feeds into: F12 (keepsakes), F13 (clay, ochre, soot, flint, oil), F04 (the bear's years), the sketchbook (P2i).
