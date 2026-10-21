# F12 — Keepsakes, the shelf and the nets

> ebb's slow systems (growth, seasons, creatures settling) need a companion that gives every visit something to look for while the island takes its time. This doc proposes that hook: **keepsakes**, one-of-a-kind objects the sea leaves on the strandline and that nets snag out in the waves. Every keepsake is generated from a seed, so no two are alike, and each carries a rarity the player can read. A **memento shelf** of about 16 spaces holds the ones the player chooses to keep, so the point is choosing what is special rather than gathering everything. Three **nets**, each a different build, reach water the strandline never sees, and **signs in the water** (a sparkle, diving birds) reward paying attention. Nothing here hurries the player or pays for repetition: what turns up depends on the tide, the moon, the weather and the shape of the shore, never on how often you walk the beach. It is grounded in a read of the code on October 20, 2026.

**Status:** Leaning. Not scheduled. Nothing here is built until Matt schedules it. Shells on the strandline (F11, branch m1-finds-shore) are the seed this grows from.

## Decided so far

Matt, October 20, 2026:

- ebb needs a core hook beside its slow systems, the way farming, fishing or mining serve other games: continuous exploration, progression, the chance of rarer things, and combining what you find. It should be simple with depth, sit cohesively with the rest of the game, never hurry the player, and not reward meaningless grinding.
- **Procedural generation** for what the player finds: shells, driftwood, bottles, rocks, fossils, feathers and more.
- **Rarity is labeled.** The chance of something objectively rarer is part of the hook.
- **A memento shelf** in the Journal area, limited to about 16 spaces, so players are not pushed to gather and keep every little thing.
- **The journal records only what you kept.** Counting up to 50 or 100 of something is the grinding mindset; a limited shelf still has plenty of variety but lets players choose what is special to them.
- **Keepsakes left out in the world changing over time** is interesting, but Matt needs to review how the game handles things in perpetuity first (see "Weathering", below).
- **Bottles are the only human-made thing that washes up on the shore.** Nets can snag other interesting objects and artifacts.
- **Artifacts stay mysterious and disconnected.** They are not the main story.
- **Living catches are always released.**
- **The player crafts their own net.** Nets can be damaged and must be repaired.
- **Up to three nets, each a different kind:** a general net first, then a lightweight specialty net, then a sinker net for deeper water. Progression unlocks the second and third, so a few are out at a time at most.
- **Signs in the water,** such as a sparkle where setting a net gives better odds of something rarer, to encourage awareness of the environment. A limited number of signs accumulate while you are away.

## The loop

```mermaid
flowchart TB
  S[Shape the shore<br/>coves, rock, sand] --> T[Each high tide<br/>leaves a few keepsakes]
  W[Read the water<br/>signs, moon, weather] --> N[Set a net<br/>general, light or sinker]
  T --> K{Keep it?}
  N --> H[Lift the haul at low tide<br/>living things go back]
  H --> K
  K -- yes --> SH[The shelf, 16 spaces]
  K -- no --> B[Back to the sea<br/>or set out on the island]
  SH --> S
```

Two ways in, one choice at the end. Beachcombing is what the sea gives the shore; the nets are what you go and ask it for.

## Keepsakes

### What a keepsake is

- **A seed, not a model.** Each keepsake is a family (shell, driftwood, stone and so on) plus a short list of numbers drawn from a seed. The family's generator turns those numbers into a mesh when it is needed.
- **Nothing is saved until it is kept.** What one tide leaves in one strandline cell is a pure function of the world seed, the cell, the tide and its conditions, exactly as `shellAt` works today (`src/world/finds/index.js`). Live play and catch-up give the same keepsakes, and an unkept one costs nothing.
- **A kept keepsake saves its numbers, not just its seed.** If a generator's sampling is retuned later, a seed would produce a different object. Saving the dozen or so numbers (and the generator version) keeps a kept shell the same shell for good.
- **It has a rarity and sometimes a mark.** Rarity uses the four words the Shells page already shows: common, uncommon, rare, very rare. A **mark** is a named trait on top of rarity, taken from real natural history where possible: a left-coiled shell, a holed stone, a double feather. Marks are the outliers a practiced eye learns to spot.

### Rarity comes from conditions, not effort

The Shells recipe already gates its rare items by the tide (`springMin` in `recipes/species/finds.json`: the murex needs a tide near spring, the nautilus nearer still). Keepsakes generalize that rule. A keepsake's rarity is allowed only when the conditions reach it, and within what is allowed the seed picks the object:

| Condition | What it opens (proposals) |
|---|---|
| Spring tides (new and full moon) | Rare keepsakes on the highest strandline |
| King tides (F08) | Very rare keepsakes, and floaters (bottles, pumice, drift seeds) on the outermost line |
| A storm the night before | More keepsakes, heavier ones high on the shore, and more wear on nets |
| Season | Which families lean in: feathers in the autumn moult, driftwood after winter storms, glowing life in summer nets |
| The shape of the shore | Coves catch floaters; rock in the tide band holds stones and fossils; sand holds shells and feathers |

The shore-shape rule is the one that makes sculpting pay off: a player who carves a sheltered cove has made a place the sea leaves things. Strandline cells would be weighted by how enclosed the shoreline around them is, read from the water summary's graded shore (F10, Z1).

**The tide's budget.** Each high tide leaves only a few keepsakes on the whole island, beyond the ordinary shells: starting point 0 to 2, average about 1, more with spring tides and storms. With two high tides a game day (tide period 12 game hours, doc 07) that is roughly a hundred keepsakes in a 56-day year, against a shelf of 16. Walking the beach more never makes the sea leave more.

**While away.** The strandline is already swept by any higher tide (`src/world/water/strandline.js`), so a return finds only what the most recent tides left, capped at about 3 keepsakes. Nothing piles up into a chore.

### The families

Each family is one small generator with one or two rarity knobs. Starting points:

| Family | Where | How it is generated | Rare knobs and marks | Reuses |
|---|---|---|---|---|
| Shells | Strandline, sand | Raup's coiling model: a profile swept along a logarithmic spiral, four main numbers (how fast the whorl grows, distance from the axis, how far it climbs, aperture shape) plus ribs, spines and banding | Size, spines, banding; mark: **left-coiled** (in real whelks, a small fraction of a percent coil the "wrong" way) | A sweep like `lathe` in `src/world/finds/procedural.js` |
| Driftwood | Strandline, after storms | Blended capsules with bark noise (the creature body bake, `body-bake.js`, as F10 plans for logs), bleached by age | Length, twist, silvering; mark: **root knot** | `bakeBody` |
| Stones | Rock in the tide band | The loose-stone bake (blended ellipsoids cut by facets, `recipes/world/pieces.json`) at hand size, with banding | Banding, polish; mark: **holed stone** | The loose-stone bake |
| Fossils | Rock in the tide band | A Raup shell set into the stone bake | Whole or broken; mark: **ammonite, complete** | Shells plus stones |
| Feathers | Above the strandline, in wind | A flat card with a parametric vane: rachis curve, barb angle, notch, pattern | Size, barring; mark: a large flight feather from a landmark bird that lives on the island (a heron's, once herons come) | The flora card path |
| Bottles | Outermost strandline, king tides only | A lathe profile with tint and frosting | Tint, a stopper; very rare by design | `lathe` |

The five scanned shells (periwinkle, turret, cockle fossil, murex, nautilus) can stay as they are. Procedural shells would sit beside them as one-of-a-kind keepsakes, and could borrow a scanned kind's name when they fall near it ("a murex, unusually long-spined").

**Readability.** Keepsakes are hand-sized, so they follow F11's rule: drawn at a modest enlargement like the strandline shells (`scale` 2 in finds.json), found in places the player made or knows (the strandline, the cove), and few at a time.

## The memento shelf

- **About 16 spaces,** a page in the Journal area. Each kept keepsake sits in a slot as its own mesh, with a small card: its name, its rarity and mark, and one line of where and when ("On the cove's strandline, after the spring tide of summer day 9").
- **Only kept things are recorded.** The shelf is the record; there is no list of everything ever found and no count of what is missing (doc 13's rule).
- **A full shelf asks for a choice.** To keep something new, the player lets something go: back to the sea, or set out on the island. Curating the shelf is the decision that matters.
- **Setting out.** A keepsake set on the island becomes a placed piece (the piece system in `src/world/pieces`), capped like loose stones are, so the island does not fill with clutter. What happens to it over time is the weathering question below.

## The nets

### Three kinds

| Net | Comes from (proposals) | Where it is set | What it favors |
|---|---|---|---|
| **General net** | Woven by the player once rushes grow on the island; offered as a mark on the naturalist's line (proposed at 8, between loose stones and driftwood) | Staked in the shallows of the tide band at low tide, so the next high tide fills it | Small living things, drift seeds, ordinary oddities |
| **Light net** | A later progression milestone (proposed: the meadow tier's milestone) | On floats along the current line, beyond the tide band | Floating curiosities, glowing life at night, things carried a long way |
| **Sinker net** | A later milestone (proposed: the shore tier's, when herons and otters come) | Weighted down in open water | The rarest and heaviest drifters, and most of the artifacts |

Each net's mesh is part of its kind (the general net is medium, the light net fine, the sinker coarse), so there is no separate mesh setting to manage. Three kinds, three places, three temperaments: depth without extra controls.

### Made from the island, not an inventory

The vision rules out currency grind (doc 01), and a pile of materials to farm would be one. So nets are made and mended from what the island **grows and holds**, never from items spent:

- The general net is woven from rushes. It can be made when a stand of rushes of some size grows on the island (rushes are already a cover plant, doc 10).
- The light net's floats are driftwood, so it needs driftwood on the driftline (the naturalist's reward at 10 finds).
- The sinker net is weighted with loose stones, so it needs a few on the island (the reward at 6 finds).

Cutting rushes for cord would thin that patch's cover share for a few days, then it grows back. The player's real work is growing the right plants and keeping the shore, which is the game they are already playing.

### Setting and lifting

- **Set and walk away.** A net is placed on the water like a piece. It fishes through one tide and is ready to lift at the next low tide.
- **A full net waits.** A net holds one haul. Once full it catches nothing more until lifted, so time away gives one haul per net, and a haul never spoils.
- **The haul** opens as a small tray: kelp and weed as texture, living things for a moment before they slip back, and any keepsake offered to keep or return.
- **Pure, like the strandline.** A haul is a function of the world seed, the net, the tide, its place and depth, the hour, the season, the weather and any sign nearby. Nothing is simulated in the water.
- **Starting odds:** most hauls hold a living thing or two and something ordinary; about one in four holds a keepsake.

### Living catches

Always released. Each gets a moment on the tray and a journal page, then swims off: a sand eel, a pipefish, a shrimp, a small flatfish, a moon jelly; at night in the light net, a comb jelly glowing; very rarely a young cuttlefish. Being handled gently could feed presence (doc 23), so the sea's creatures come to know you over time.

### Wear and mending

- **Wear builds with use.** Every haul adds a little; storms, rock in the shallows and heavy hauls add more. Nothing wears while a net is stored.
- **Holes change the catch before they stop it.** A worn net loses small things through its holes, so it fishes like a coarser net. That is a gradual, visible change, not a broken state.
- **A torn net must be mended** before it is set again. Mending takes the net out of the water for one tide, with rushes growing on the island. It is never lost.

### Artifacts

Mysterious and disconnected, per Matt. Each gets a single line of observation and nothing more: no lore, no set to complete.

- A carved float from someone else's net
- A small bell
- A clay pot, sometimes with seeds still inside
- A lantern lens
- A scrap of map with no names

Most of them are revolved profiles, so one lathe generator (the `lathe` helper in `src/world/finds/procedural.js`, exported) with carved pattern stamps makes the family. Natural curiosities share the nets with them: drift seeds, sponge skeletons, coral branches, a whale's ear bone, a pumice raft with goose barnacles riding it (reusing `barnacleMesh`).

## Signs in the water

A small family of signs teaches players to read the sea. Each favors a pool and a net:

| Sign | What it means | Best net |
|---|---|---|
| A sparkle on the surface | Something reflective drifting: better odds of a rare object | Any |
| Diving birds | Fish near: more living catches | Light |
| A floating kelp mat | Things tangled inside it: natural oddities | General or light |
| A glow at night | A bloom of light-making life (F08's glowing plankton night is the big version) | Light |
| A strangely flat, calm patch | Something large below: the rarest drifters | Sinker |

- **Unhurried.** A sign lasts until the next tide turns. A net set within some distance of it before then (starting point 15 m) gets the better odds.
- **Never required.** Anything a sign makes likelier can also come without one, only less often, so a missed sign closes no door (doc 13: nothing is lost by being away, no reward is time-limited).
- **While away.** A limited number wait for your return (starting point 2), laid out on the water by the reveal (`reveal-return.js`) and lasting until the next tide after you are back.
- **Rolled like weather.** Signs come from the seed and the game hour, the same way F08's weather-borne phenomena do, leaning toward the conditions that would cause them in life (diving birds at dawn and dusk, glows on dark calm nights).

## Weathering (seed, pending Matt's review)

The idea: a keepsake set out somewhere changes with time. Driftwood left on grass silvers and mosses, a shell in a pool takes barnacles, a bone buried in sand slowly turns to stone. This is crafting that happens while the seasons turn.

What it would take, for Matt to weigh against how the game keeps things in perpetuity:

- **No ongoing simulation.** A set-out keepsake saves only when it was set down and what it rests in. Its look is a function of its age and its ground, worked out when it is loaded and again only when it crosses a stage, the same way F04's veteran trees remesh at most once a game year.
- **Age follows the island's clock.** Time away would count at the same slowed rate as growth while away (F01), so weathering never outruns the rest of the island.
- **Capped.** A set-out cap, like the loose stones' cap of 24, keeps the count small.
- **Stages, not a slider.** Each family gets two or three named stages (fresh, weathered, old), each a small change to its numbers, so the save stays tiny.

## How it plugs into the code

From the code read on October 20, 2026:

- **The roll (new, small).** A `keepsakeAt` beside `shellAt`: pure, seeded by cell and tide, gated by conditions, weighted by shore shape, with an island-wide budget per tide. Numbers in a new `recipes/world/keepsakes.json` (families, rarity weights, gates, budgets).
- **Generators (new, one module per family).** `src/world/keepsakes/`, each taking its numbers and returning a mesh. Reuse `lathe` (export it from `procedural.js`), `bakeBody`, the loose-stone bake and `barnacleMesh`. Meshes are made on demand near the camera and cached by keepsake id, since unlike the scanned shells each one is unique.
- **A keepsake lab (new tool).** `tools/keepsake-lab.html`, a local page that lays many seeds of a family side by side with their rarity, for tuning the generators and the odds on Matt's own machine, in the style of `tools/finds-models.html`.
- **Tapping (small change).** `cardAt` in `journal/index.js` gains a keepsake lookup beside the finds lookup; the card offers keep or leave. A left keepsake stays until a higher tide sweeps its line.
- **The shelf (new page).** A page in the Journal area. The journal's tabs are hardcoded (`VIEWS` in `src/ui/journal.js`), so the shelf would sit as a page inside an existing view rather than a sixth tab, keeping the phone layout as it is.
- **Nets (new piece kind).** Nets are pieces that sit on water. Setting, lifting and mending would live with the piece system (`src/world/pieces`), with a Net mode beside Loose stone.
- **Unlocks (exists).** The general net as a naturalist reward in `recipes/world/naturalist.json`, granted by `src/world/expansion.js`; the light and sinker nets through the same module at milestones.
- **Signs (new, small).** Rolled hourly from the seed; drawn as surface effects in the water pass (the sparkle and the glow use the water's own light, like pond skaters).
- **Saves.** A new `keepsakes` section (shelf slots with their numbers, set-out keepsakes with their stamps, nets with wear and set time) and a save format step from 5 to 6, with a migration that starts older islands with an empty shelf.

## What it would change

Listed only; Matt applies these later.

- **Doc 07 (water and tide):** strandline cells weighted by how enclosed the shore is; nets fishing through a tide; signs drawn on the water.
- **Doc 09 (structures):** the piece system broadened to nets on water and keepsakes set out on land.
- **Doc 12 (creature roadmap):** living net catches as a new set of journal pages; a landmark bird's feather as a keepsake mark.
- **Doc 13 (progression):** the general net on the naturalist's line; the light and sinker nets at milestones; the shelf rule (kept things only, never a count of what is missing).
- **Doc 14 (tuning panel):** the keepsake lab.
- **Doc 15 (camera and UI):** keepsake cards, the haul tray, the Net mode and the shelf page.
- **Doc 18 (saves):** the `keepsakes` section and save format 6.
- **Doc 20 (roadmap):** where keepsakes and the first net land.
- **Doc 23 (presence):** gentle release as a presence source for sea creatures; signs waiting on return.
- **F04 (deep clock):** weathering of set-out keepsakes, if accepted.
- **F08 (rare phenomena):** king tides and the glowing night as the biggest keepsake and sign events.
- **F10 (plants and surfaces):** rushes as net material; the driftline as the keepsake shore.
- **F11 (creatures and finds):** living net catches beside the shore finds; the Shells page reconciled with the shelf (open question).

## Risks and guardrails

- **Hoarding.** The shelf's 16 spaces and the set-out cap are the guard. There is no storage beyond them.
- **Grinding.** A fixed budget per tide, one haul per net per tide, no sell value and no currency. Rarity is gated by conditions the player learns, never by repetition.
- **Chores.** A full net waits and never spoils; signs last a tide; the strandline only ever shows the latest tides. Checking is a pleasure, never an obligation.
- **Clutter.** Few keepsakes at a time, drawn only near the camera.
- **Kept things changing.** Kept keepsakes save their numbers and generator version, so later tuning never alters what a player chose to keep.
- **Cost.** Six small generators and one lathe family are the bulk of the work. The lab makes tuning them a visual job rather than a code one.

## Open questions

- Should the Shells page keep listing every kind of shell you have found, or change so the journal only shows shells you kept?
- Should a torn net be unusable until it is mended, or keep fishing with holes and only catch larger things?
- Should the first net come as a mark on the naturalist's line, or as soon as enough rushes grow?
- Should living net catches get their own pages among the small lives, and count on the naturalist's line?
- Should bottles ever hold anything inside?
- How many signs should be waiting when you come back: one, two or three?
- Should procedural shells sit beside the five scanned shells, or eventually replace them?

## Depends on / feeds into

Depends on F01 (the clock and catch-up), F08 (spring and king tides, the glowing night), F10 (the strandline, rushes, driftwood, loose stones), F11 (finds, the naturalist's line, the Shells page) and docs 07, 09, 13 and 18. Feeds F04 (weathering over years) and the shore tier of doc 12.
