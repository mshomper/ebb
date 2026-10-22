# F03 — Presence, in depth

> Doc 23 sets presence up as a list of sources that creatures react to, builds rung 1 (the hand, the camera) for the slice, and sketches the seat, the walker and the camp. This doc goes deeper on everything after the hand: what patience looks like at each rung, how creatures show trust with their bodies, how groups and routines come into it, and how the later rungs feel to play on desktop and phone. It proposes answers, as leanings, to doc 23's open questions. It builds on doc 23 and changes none of its locked decisions.

**Status:** Leaning. Doc 23 now holds the milestones: the walker moved to M2 (October 21, 2026) and W0 to W6 are built and merged; the seat became the walker's Sit; the camp is M6 or M7. The rest of this doc is not scheduled until Matt schedules it.

## Decided so far

From doc 23, unchanged: presence is a list of sources; trust belongs to individuals, only grows and is saved as small events; wariness is live only and gone in about a minute; trust shows as words, never numbers; every species has a wildness ceiling; game-driven camera moves never startle; the diorama orbit stays the default way to play.

Matt, October 19, 2026: presence deserves a more detailed design before its later rungs are scheduled. Nothing new is decided yet; everything below is a proposal.

## Principles

These carry every rung:

1. **Patience is the skill.** The only thing a player gets better at is being gentle: coming slowly, sitting still, returning at the same hour.
2. **The body tells.** Creatures show how they feel about you through posture and behavior, never through rings, bars or icons.
3. **Curiosity is never punished.** A clumsy approach costs a minute of wariness, never earned trust.
4. **Wildness is respected.** Ceilings stay. Some animals will only ever tolerate you, and that is the point.
5. **Every rung is optional.** A player who never sits, walks or camps still has the whole game.
6. **Learned by watching.** The journal teaches approach in observational words ("lets you close if you come slowly"), never as instructions.

## The body language ladder

Each trust word needs a look. Proposed behaviors per word, by body plan, so each new species inherits a starting set and adds its own:

| Word | Frogs and turtles | Birds | Small mammals | Insects (as swarms) |
|---|---|---|---|---|
| Wary | Freezes, then plops at the first quick move | Stops feeding, head up, flies at your approach | Freezes, then bolts for cover | Scatters, regroups further off |
| Tolerant | Keeps sitting while watched from a meter | Feeds again after a glance at you | Carries on foraging, ears turned to you | Ignores you if you are still |
| Curious | Turns to face you; hops a little nearer | Hops closer along a branch, head tilted | Sniffs toward you, rises on hind legs | Drifts around you |
| Familiar | Sits for a portrait; eyes half closed | Lands near you, preens | Forages at your feet | Settles on you when very still |
| Bonded | Calls from a reed beside you | Follows you as you dig; perches on your pack | Sleeps by the cold firepit | (swarms have no bond) |

These are animation states and choice weights in each species' behavior, not new systems. The table belongs in doc 12 per species once agreed.

## New signals

Doc 23's signals stay. Three more are proposed, all cheap:

- **Footstep sound.** The walker's steps are louder on gravel, shingle and dry leaves, quieter on moss, wet sand and grass. A loud step adds a little to the ring, like gaze does. Creeping on moss is the quietest way to approach. Ground type already exists for footstep audio (doc 17).
- **Routine.** Creatures notice when you usually come. If you often visit at dusk, the frogs come to expect you then and are a little calmer at that hour. Stored as a small per-species histogram of your visiting hours (24 numbers), built from the same quiet-watching events. The journal can say so: "The frogs seem to expect you at dusk."
- **Familiar places.** A seat or a camp you use often becomes a known place. Within a few meters of it, rings are a little smaller for every creature, the way birds learn a gardener's bench. Stored per place as a small value that only grows.

## Familiarity: the group gets used to you

Doc 23 leaves open whether a whole group can get used to you. Proposed: yes, slowly, and through the young.

- **Social learning.** In real animal groups, newcomers and young learn what to fear from the older ones. So: a newcomer to a group whose members mostly trust you starts at Tolerant instead of Wary. It still has to come to know you itself.
- **Nothing else is shared.** Trust stays individual. Names, portraits and bonds still come one creature at a time.
- **It shows in the journal:** "The young frogs this spring don't startle the way the first ones did."

This keeps closeness personal while letting a long-tended island feel calmer as a whole, which matters for players who stay many years.

## Rung 2, the seat

### Choosing a seat

- **Anywhere flat enough to sit**: a stone, a log, a bank, the end of the stepping stones. A seat is not built; you simply sit.
- The first time you sit somewhere, it becomes a remembered place in the journal ("the flat stone by the reeds"), and you can name it. The journal's island map marks named seats.

### Sitting

- **Arrival.** The camera glides down to about 1 m, looking out. For the first half minute, creatures nearby notice you (heads turn, a frog goes still), then settle. Arrival is the seat's small ritual.
- **Looking around.** You can turn your head slowly, about 100 degrees either side and up to the sky, but not move. The HUD fades.
- **What you can do seated:** offer food within arm's reach (about 1.5 m), call, photograph, or simply wait. Waiting is the main thing.
- **Trust.** The seat is always low, still and never fast, so it counts as quiet watching at a higher rate (doc 23). It is the place trust grows fastest.
- **Leaving.** Any move of the camera glides you back up. Leaving never startles.

### The seat and the island's sound

Doc 24 asks whether sitting should cue its own music. Proposed: no cue of its own. Instead, sitting brings the island forward. The music director holds off starting new pieces for the first minutes seated, and ambience rises a little, so the seat becomes the place you hear the island. A piece already playing finishes as normal.

## Rung 3, the walker

### The figure

- A small stylized traveler about 1.7 m tall, in coat, hat and pack, with no face (doc 23).
- **Proposed: plain at first, then found and gifted over time.** You start in a plain coat. Creatures and seasons give small changes: a feather in the hat from the heron, a scarf in the first winter, a different coat color from a dye plant you grew. Customization becomes a record of the island, not a menu.

### Moving, on desktop and phone

- **Tap or click where to go**; the figure walks there on the walkability grid. No virtual joystick.
- **Pace** follows how far you tap: a short tap creeps, a longer one strolls. A double tap walks briskly. On desktop, WASD is optional and holding Shift creeps.
- **Posture** has its own drawn buttons at the bottom edge: stand, kneel, sit, lie. Kneeling and sitting shrink rings (doc 23's multipliers).
- **Gaze** follows the camera: where you look is where the figure looks. Looking away from a shy creature (doc 23's gaze multiplier) is simply turning the camera.
- **Step in and step out** glide between the diorama and the low third-person view. The diorama stays home.

### On the ground

- **Wading** to the knee, never swimming. The stepping stones, the bridge and later the sandbars at low tide are the crossings.
- **Footprints** in sand and mud, which the next tide washes away. A small, honest detail: the island forgets you between tides.
- **Desire lines** where you walk often (F09).
- **Lantern** at night: carried, it lets you see and makes you visible. Without it, fireflies drift closer (doc 23).

### Interactions gain a body

Kneel to offer food from the hand, whistle while sitting, crouch to photograph, turn soil and have the robin come (doc 23). Each existing tool action gains an animation, not a new rule.

### Is the walker the main way to play?

Proposed: **no, the walker stays a visit.** The orbit view is where you shape and tend; the walker is how you step inside what you made. This keeps the game's identity as a diorama and keeps the walker's cost bounded. The question can be revisited after players have it.

## Rung 4, the camp

### How you get it

Proposed: **the camp kit arrives with your first bonded creature.** Presence earns presence: the first animal that bonds with you is what makes the island feel like somewhere to stay. It is announced as any gift is, by a card and a journal line.

### What it is

A bedroll or small tent, a firepit, a kettle, a lantern and a crate, above high tide (doc 23).

### Does it grow?

Proposed: **the camp does not grow as a building, but it gathers.** Gifts from bonded creatures accumulate on the crate and around the fire: the otter's pebbles, a jay's feather, a snail shell, a robin's spot on the tent ridge. Over years the camp becomes a small museum of the island's friendships. No lean-to, garden or rain barrel, in keeping with doc 01's limit on human touches.

### One camp or several?

Proposed: **one camp you can move.** Moving it leaves a pale patch that regrows over a few days (doc 23's leave no trace). The camp's familiar-place value stays with the old spot and starts again at the new one, so moving has a soft cost in calm, never in trust.

### The sleep ritual and time away

- Crawling into the tent ends a session; the next return opens at camp at dawn (doc 23).
- While you are away, the camp adds small standing presence events during catch-up for creatures that already know you. With the 7-day cap (F01), this stays small and bounded.

### Do bonded creatures follow you?

Proposed: **they meet you at their places and at camp, and only species that really follow people do so.** The robin follows you while you dig, as robins follow gardeners. An otter may swim alongside when you wade. Nothing trails you around the island like a pet.

## Presence across sister islands

If F02's farewell is built: trust stays with individuals on their island. A bonded creature's token can be the keepsake. If founders travel to the sister island (F05), they start as Wary like any newcomer, but a founder group carries its familiarity, so their young start Tolerant. The old friendships wait on the first island.

## Presence with other systems

- **Photo mode (doc 16):** the seat and the walker are where the best photographs come from. A Familiar creature holding still for a portrait is presence paying off.
- **The journal:** presence lines in likes, notes and the web, as doc 23 describes, plus routine and familiar-place lines from this doc.
- **Audio:** footsteps by ground, the frogs hushing near you, the fire.
- **Accessibility:** every rung works with calm motion on; the walker works one-handed on a phone; posture buttons are 52 px like the tool bar.
- **Performance:** the walker's near-field rendering is the big cost and is budgeted in doc 19 when scheduled. The new signals are a few numbers per species.

## What it would change

Listed only; Matt applies these later.

- **Doc 23 (presence):** the three new signals (footstep sound, routine, familiar places), familiarity through social learning, the seat's arrival and look-around limits, the walker's tap-distance pace and posture buttons, footprints washed by the tide, the camp kit as the first bond's gift, the camp's gathered keepsakes, and leanings on all seven open questions.
- **Doc 11 (creatures and ecology):** newcomers in a trusting group start Tolerant; routine and familiar-place values in the creature state.
- **Doc 12 (creature roadmap):** the body language ladder per species; which species really follow people.
- **Doc 15 (camera, input and UI):** seat glide and look limits; walker controls on desktop and phone; posture buttons.
- **Doc 16 (customization and photo mode):** the figure's look as found and gifted pieces.
- **Doc 17 and doc 25 (audio):** footstep loudness by ground; the seat bringing ambience forward.
- **Doc 24 (music):** its open question about the seat is answered: no cue, the director holds off new pieces at first.
- **Doc 07 (water and tide):** footprints cleared by the tide.
- **Doc 13 (progression):** the camp kit as a gift with the first bond.
- **Doc 18 (saves):** named seats, familiar-place values, the routine histogram per species and camp keepsakes.
- **Doc 19 (performance):** the walker's near-field budget.

## Risks and guardrails

- **Scope.** The walker is the largest single feature in the game. Keeping it a visit, not the main mode, is what keeps it finishable.
- **Petting-zoo drift.** Following, gifting and bonding must stay rare and species-true. Ceilings stay in place.
- **Grind.** Routine must reward a habit, never punish breaking one. Missing your usual dusk visit costs nothing.
- **Phone controls.** Tap distance as pace needs testing on small screens; a fallback is a pace toggle beside the posture buttons.

## Open questions

- Should a whole group slowly get used to you through its young, or should every creature start wary no matter how long you've tended the island?
- Do you like the idea of creatures learning the hour you usually visit?
- Should the camp kit come with your first bonded creature, or as one species' gift?
- Should the walker's look be found and gifted over time, or customizable from the start?
- Is "the walker stays a visit, the diorama stays home" the right line?
- Should the seat hold off new music when you sit down, or let the music carry on as normal?

## Depends on / feeds into

Builds on doc 23 throughout. Depends on docs 11, 12, 15 and 17. Feeds F02 (creature farewells and keepsakes) and F09 (desire lines from footfall).
