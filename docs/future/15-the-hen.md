# F15 — The hen

> One spring morning a small brown hen walks out of the gorse, scratching. She is feral: no one's, wary, and quite able to look after herself. Over a season she learns the walker, comes to the camp at dusk, follows you while you dig, and starts laying in the nest you made her. Her eggs are the walker's first real meal. If you leave a clutch in spring she sits, and the island has chicks.

**Status:** Slice 1 built on `m2-hen` (October 27, 2026): a wary hen in the scrub. Slice 2 (trust, then Fond) built on `m2-hen-trust` (October 29, 2026); see "Built: trust and Fond" below. Drafted October 25, 2026, from Matt's ask for a wandering chicken you can befriend that gives eggs.

## Decided so far

Matt, October 27, 2026:

- **She was always here** (option A): feral, from an older keeper's birds. She shows once the island has scrub: at least 3 grown gorse or grey willow bushes together (`recipes/species/hen.json` home).
- **No cockerel on the island.** Only a distant crow from the far side, now and then, never every morning. **Chicks: yes**, from a clutch left in the nest in spring.
- **She follows the walker** at Familiar, at a loose 2 to 4 m.
- **Model:** Matt's supplied "Chicken Rig" by FourthGreen (CC BY-NC 4.0, non-commercial; credited in `assets/models/hen/CREDITS.md`) for now; one of his own later, when needed. Her motion is code on bone roles, so another model drops in. The file's wings carry no skin, so her wings cannot open (flap-up, dust bath) until a model with wing weights comes.
- **Size:** drawn at 1.15x (0.49 m), just above the walker's knee.
- **Eggs:** the walker's meal and her grit now; tempera later.
- **A fifth band, hers alone: Fond.** About 7 game days at Familiar with the walker near most days (time together, never a count of treats). She greets the walker at dawn and settles by the fire beside you, and one morning leaves a tail feather on the camp perch: the **hen-feather hat band**, a paint on whatever hat the walker wears, with a small always-on boon (other creatures stay a little calmer near you).

The slices: 1 a wary hen (built), 2 trust (the four bands, then Fond as 2b; built), 3 her day (roost, dust bath, rain, sounds, save), 4 eggs (scrape, nest box, pouch, the meal, grit), 5 chicks.

### Built: trust and Fond (slice 2, October 29, 2026)

- **Trust** is saved with the island (`state.creatures.hens`, src/world/hen/trust.js) and applied by the hourly tick from events live play records, as the frogs'. Watching her quietly within 9 m earns it; so does one treat a game day: **worms** the shovel turned up, or **seedheads** (a handful of nettle, meadowsweet, marram, campion or chamomile seed). Feeding from the pouch is not built: treats are her food from you. Named at 0.5, as the frogs.
- **The bands** (src/world/hen/bands.js chooses, life.js walks it with her clips): Wary runs past 6 m; Tolerant never runs, steps aside inside about 2.4 m and forages about 3 m from you; Curious comes to see you every half minute or so and waits by a hole you dig; Familiar follows you at 2 to 4 m while you stay within 30 m of her scrub, and from 19:00 settles by the fire ring for the night (a new **settle** clip: legs folded under her) until H3 brings the roost; with no ring laid she roosts in the scrub.
- **Fond** comes after 7 whole game days at Familiar on 5 of which you were within 8 m of her for 2 game hours or more. Days pass while you are away, but none counts as together. At Fond she greets you once each dawn (5:00 to 9:00) and settles beside you while you sit by the fire. The next morning from 6:00 she leaves a **tail feather** by the fire ring; the gift stone can take it over (`hen.useGiftPlace`, and the `hen:feather` event).
- **The hen-feather hat band**: Take it up on the feather's card. The feather itself is tucked into the hat's dark band, angled up at the side, and rides the hat's bone through every walk and roll (Matt, October 29, 2026: a real feather, not a painted band; hen.json fond.feather.onHat). It is kept in the kit (`kit.bands`, saved; the Walker page's hat card says so), and every creature's wary ring is 0.85 times as wide near you (fond.calmK).
- Test links: `?hen&trust=0.2` (Tolerant), `0.45` (Curious), `0.65` (Familiar), `?hen&fond&camp` (Fond, her feather by the ring). tools/hen-lab.html shows every band on a test ground.

These rules carry over:

- **Creatures are attracted, never bought** (doc 01). The hen comes because the island suits her, like every species.
- **Every creature is rigged and animated** (CLAUDE.md), including each life stage: chick, pullet, hen.
- **Trust** follows F13 section 8: bands that read as words, watching and treats, live only, one treat a creature a day.
- **No harm, no predators, no fail states.** She is never taken by anything, never ill, never lost.
- **Matt makes complex models** (CLAUDE.md). A hen is more than a basic shape, so who makes her is Matt's call.

## The idea

Every other creature in ebb is wild, and the best you get is a frog that stays when you sit near. The hen is different. She is the one animal that can come to know the walker, and she comes to the camp on her own. That makes her the game's companion without breaking its rules: she isn't bought or tamed, and she is never kept. She chooses to stay.

She also closes a loop the camp has been missing. The walker brews teas, dries herbs and makes salt, but eats nothing. Eggs, cooked on the hearth stones and seasoned with the island's own salt, are the first meal.

## How it could work

### Where she comes from

She must arrive without breaking "the outside world stays distant". Three options:

| Option | How | Fits because | Catch |
|---|---|---|---|
| **A. She was always here** (recommended) | A feral hen descended from an older keeper's birds, living in the scrub. She shows once the island has scrub to hide in | The island already has an older keeper in it: the cache, the old charcoal, the bit of someone else's pot (F13 section 10). Feral fowl on islands are real | None big. The first page says the land is new, so her flock is from the far side of the island, unseen until now |
| B. Across the bar | She walks over at low tide from a neighboring islet once it joins the world (doc 13's expansion) | Uses the tide | Waits for an expansion, and hens don't cross sand flats easily |
| C. A gift | A settled species' gift, like the raft | Fits the gift system | A hen given by frogs makes no sense |

### What she needs

Like every species, she arrives only when the island meets her needs (doc 11's suitability grid):

| Need | Why | On the island |
|---|---|---|
| **Cover** | She roosts off the ground at night and hides her nest | Gorse or bramble scrub, or willow, at least a few bushes together |
| **Dust** | Hens bathe in dry dust to keep their feathers clean | Dry, bare sand or soil above the tide, in sun |
| **Forage** | Seeds, shoots, insects, worms | Meadow grasses gone to seed, open ground to scratch |
| **Water** | Daily | Any fresh water |
| **Quiet** | Like every creature | Not too near anything loud (doc 11) |

That puts her at the **meadow tier** (doc 12), once scrub and seed grasses have come.

### Trust: from wary to following

She uses F13's bands, with words that suit a hen:

| Band | What she does |
|---|---|
| **Wary** | Keeps to the scrub. Runs, then walks, if you come within about 6 m |
| **Tolerant** | Forages in the open while you are near; keeps about 3 m away |
| **Curious** | Comes to see what you are doing. Waits by fresh-turned soil when you dig (as the robin does) |
| **Familiar** | Comes to the camp at dusk and roosts there. **Follows the walker** at a loose few meters on short walks. Lays in the nest box |

- **Watching** and **Feeding** work as for other species (feeding with seed from the pouch).
- **Treats** (F13 section 8, real food only): worms turned up by the shovel, seedheads, and crushed eggshell given back to her as grit, which is real (laying hens need the calcium). Never bread, never anything salted or cooked.
- **Naming** comes at the same trust as the frogs' (0.5).
- **She never startles from the game camera** (the frogs' rule). Only the walker coming close counts.

### Her day

| Time | What she does | Animation |
|---|---|---|
| Dawn | Drops from the roost, shakes out, drinks | flap-down, shake, drink (dip and tip the head back) |
| Morning | Forages: scratch, scratch, step back, peck | walk, the scratch cycle, peck |
| Midday | A dust bath in a sunny dry patch, then preens | dust bath (settle, flick dust over the back with wings), preen |
| Afternoon | Forages further, or follows the walker if Familiar | walk, run (short bursts), follow |
| Laying | Once a day in season, goes quiet, settles in the nest, then the egg song | settle, sit, stand and call |
| Dusk | Goes to roost: scrub, or the camp perch once Familiar | flap-up, roost (feathers fluffed, head tucked) |
| Rain | Shelters under a bush and waits | stand fluffed |

The scratch cycle is her signature: two backward kicks with alternating feet, a step back, a look, a peck. It should read from the above view.

### Eggs

- **Season from daylight.** Real hens lay by day length. ebb's sun is physical, so she lays from the spring days, most in late spring and summer, fewer in autumn, and none in the short days of winter. No extra rule: day length from the sun model drives it.
- **Rate:** about one egg every 1.2 game days at her best. Starting numbers live in `recipes/species/hen.json`.
- **Where:** before Familiar, in a hidden scrape under scrub (finding it is a small hunt). From Familiar, in the **nest box** at camp, a small make (a rush-lined box of sticks, F13 section 6's rules).
- **Moult:** in autumn she drops feathers and stops laying for a while. Feathers are a find.
- **Collecting** is a gather from the nest card. An egg rides in the pack in its own pouch kind (a few at most).

What eggs are for:

| Use | How | Ties to |
|---|---|---|
| **The walker's meal** | Cooked on the hearth stones in the clay pot, seasoned with sea salt | F13's hearth and pots; the salt page's seasoned meals, which only the walker eats |
| **Eggshell grit** | Crushed in the mortar, given back to her | Her treat; the mortar Matt is modelling |
| **A clutch** | Left in the nest in spring | Chicks, below |
| Later: egg tempera | Yolk and an island pigment, for colour in the sketchbook | The dye palette (F13 section 9); only if the sketchbook ever goes beyond pencil |

Eggs are never fed to any creature (F13's real-food rule), and nothing on the island takes them.

### Broody, and chicks

- If eggs are left in the nest in spring, she may **go broody**: she stops laying and sits. Real hens sit 21 days; scaled to the 14-day season, about 5 game days.
- **Chicks** hatch together, follow her in a line, and grow through **pullet** to **hen** over a season. Each stage has its own rig and animations (the creature rule): chicks peep, run in bursts and shelter under her wings.
- **Fertile eggs need a cockerel.** Two choices: a cockerel comes with the flock (he crows at dawn, which some players will love and some won't), or the hen's line stays one hen and no chicks. This is Matt's call.
- **A small flock at most:** a cap of about 4 birds, as populations in doc 11 cap. Chicks past the cap are simply never laid.

### The rig

A small bird rig, about 16 bones:

| Part | Bones |
|---|---|
| Body | pelvis, spine, chest |
| Neck and head | three neck bones and the head, so the head can hold still while the body moves (as real hens do) |
| Legs | thigh, shank, foot and toes on each side |
| Wings | one bone each, folded, with a flap pose |
| Tail | one |

- **Head stabilizing** is what makes a hen look alive: while she walks, the head stays fixed in space, then jumps forward. A procedural lock in the motion code, not hand-keyed.
- **Animations:** walk, run, scratch cycle, peck, drink, dust bath, preen, shake, flap-up and flap-down, roost, sit (laying and brooding), egg song, follow. Chicks: walk, run, peep, shelter.
- **Model:** a basic hen is beyond "a basic shape". Matt's call whether he makes her (as with the camp models) or a session does.

### Sound

Contented murmur while foraging, the egg song after laying, a sharp alarm when the walker comes too close at Wary, chick peeping. CC0 recordings exist for all of these. They join doc 25's soundscape at a low level.

### Journal

- Her own page, like any species (doc 13), with Likes lines learned by watching ("Kicks back the soil, then looks").
- A sketchbook subject (P2i): scratch, dust bath, roosting, chicks in a line.
- The egg pouch and the nest box join the forager's trail if Matt wants them there.

## What it would change

- **11** creatures and ecology: a scrub-and-dust suitability; roosting at camp once Familiar; laying from day length.
- **12** creature roadmap: the hen at the meadow tier, with her life stages; the cockerel choice.
- **F13** keeper's camp: the nest box make, the egg pouch kind, the walker's meal at the hearth, eggshell grit in the mortar, a camp perch slot.
- **F14** scripted events: her arrival out of the gorse could be written as a set piece.
- **17, 25** audio: hen sounds.
- **18** saves: her trust, flock, nest and eggs, a few hundred bytes.
- **01** vision: one line, since she is the first creature that follows the walker and the first food the walker eats.

## Risks and guardrails

- **Pet, not livestock.** She is never kept, penned or counted. No coop management, no feeding chores, nothing goes wrong if you ignore her.
- **Eggs are not a resource grind.** A few in the pack at most, no stockpile, nothing bought with them.
- **The outside world.** Option A keeps her an island creature with a story already in the ground.
- **Cockerel noise.** A dawn crow every game morning could wear thin. If he comes, his crow should be distant and not every day.

## Open questions

All five were answered on October 27, 2026 (Decided so far, above).

## Depends on / feeds into

- Depends on: 11 and 12 (species, suitability, meadow tier), F13 (trust, treats, camp, makes, pouches, hearth, salt), 06 (day length), the creature rig work.
- Feeds into: F14 (her arrival as a set piece), F05 (lineages: a flock's colours drifting over generations), the sketchbook (P2i).
