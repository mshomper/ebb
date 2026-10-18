# 23 — Presence

> Presence is how the player is *on* the island, not just above it. Creatures read the player the way real animals read a person: how fast you come, how low you sit, where you look, how long you stay still. Trust grows from patience, not from clicking. Presence is built as a **list of sources** that creatures react to. In the slice the only source is the camera. Later rungs add a seat, a small walking figure and a camp, each as one more source, so frog behavior never needs reworking. Followed far enough, presence ends with a small traveler who can walk the island and camp beside its plants and animals. Matt scoped this in October 2026; the first rung lands with the frogs in S6.

## Locked decisions

- **Presence is a list of sources.** Each source reports a few signals (position, speed, editing, stillness, and later posture, gaze, light and predictability). Creatures react to the nearest or strongest source. S6b builds the list with the camera as its only entry; the code never asks "where is the camera", only "what sources are there".
- **Rung 1, the hand, is the slice** (M1 S6b and S6c). The seat (M2), the walker (M3–M4) and the camp (M6, or with the M7 chapter) are planned, not built, until their milestones.
- **The camera source** is the camera's eye (where you look from), so it is close to a creature only when you have zoomed in near it. Its speed is how fast the eye moves; editing is a sculpt, pour or plant stroke within a short reach of the creature.
- **Moves the game makes never startle.** A camera glide that the game drives (Follow, and any later one) is not a movement of the camera source: its speed is reported as zero while the glide runs, and any input ends the glide and hands speed back. This came from Matt's creature tests. Being taken to a creature must never scare it. The journal no longer moves the camera at all: Show me rings the nearest example in place, and J2b's wash leaves the camera where it is.
- **Each creature has a comfort ring**: about 1.5 m for a shy frog, shrinking to about 0.3 m for a trusting one. Coming close slowly is welcome. A creature startles only when a source is inside its ring and moving faster than its calm speed, or when an edit happens right beside it.
- **A startle is soft and live only**: a frog hops into the water, a ripple, eyes up about 2 m away, back in about a minute. Nearby frogs hush for a while, and the chorus returns from the far side. Never a panic.
- **Trust is stored; wariness is not.** Trust belongs to one individual, only ever grows, and is saved as small timed events (a feeding, a stretch of quiet watching) applied in the hourly tick, so live play, saves and catch-up agree. Wariness is the after-effect of a startle: an animation state, gone in about a minute, never saved.
- **Words, not numbers.** Trust shows as a word on the creature card and in the journal (Wary, Tolerant, Curious, Familiar, Bonded), never a bar or a percent.
- **Wildness ceilings.** Each species has a ceiling on how close it will ever get. ebb is a tended island, not a petting zoo.
- **Comfort rings are not shown in the game** by default; creatures' bodies do the telling. A ring view belongs on a tools page.

## How it works

### The ladder

Each rung is a new way to be on the island and keeps the rungs below it. The game holds together at any rung.

```mermaid
flowchart LR
    H["1 The hand<br/>your attention<br/>(the camera)"] --> S["2 The seat<br/>sit at one spot<br/>at eye height"]
    S --> W["3 The walker<br/>a small figure<br/>you walk around"]
    W --> C["4 The camp<br/>a bedroll and fire<br/>you live beside"]
```

| Rung | You are | Creatures feel | Lands around |
|---|---|---|---|
| 1 The hand | The camera | Fast swoops through their ring; sculpting or pouring beside them; quiet watching | M1 S6b and S6c |
| 2 The seat | Sitting quietly at a spot you chose | A still, low, patient presence | M2, with photo mode and the journal |
| 3 The walker | A small traveler on foot | Approach speed, posture, gaze, footsteps, lantern | M3–M4, with paths and the bridge |
| 4 The camp | Someone who lives here | A home point; trust keeps growing slowly while you are away | M6, or with the M7 chapter |

### What the repo already gives presence

| Already in the repo | Where | What presence does with it |
|---|---|---|
| Trust per individual, from feeding, calling and watching, never decays | doc 11 | Stays the stored value; startles add only live wariness |
| Feed, Call, Name, Follow, Photograph | docs 11, 15, 16 | Stay; gain a body later (kneel to offer, whistle while sitting) |
| The disturbance field feeding the "quiet" need | doc 11 | Sources are added to the same field |
| Soft startle, "a hop into the water, never a panic" | doc 11 | Becomes the flee response with the ring rule |
| Walkability grid and flow-field pathing | doc 11 | The walker uses the same grid |
| Stepping stones (M2), paths and walls (M3), the bridge (M3) | docs 09, 20 | Become the routes the figure walks, which creatures learn |
| The follow camera's soft rig | doc 15 | Grows into the walker's third-person camera |
| Field journal: words not numbers, tap anything alive, likes learned, notes, the web | docs 13, 15 | Where presence shows, without meters |

### Signals

| Signal | Meaning | Rung 1: the camera | Later rungs |
|---|---|---|---|
| Position | Where the presence is | The camera's eye | The seat; the figure's feet; the camp |
| Speed | How fast it moves through a creature's ring | How fast the eye moves (a swoop) | Walking pace: creep, stroll, brisk |
| Editing | Sculpting, pouring or planting right beside a creature | Yes | Yes (digging, splashing while wading) |
| Stillness | Time since the presence last moved | Camera at rest | Figure at rest |
| Offering | Food put down | The Feed tool | Kneel and offer from the hand |
| Posture | How low and small you are | No; zooming in is fine | Always sitting (seat); stand, kneel, sit, lie (walker) |
| Gaze | Whether you are looking at it | No | The figure's head |
| Light | A carried or placed light at night | No | Hand lantern, campfire |
| Predictability | Doing the expected thing | No | On a path versus off it |

The first five are all the slice needs. The last four exist only with a body, so they arrive with the walker and do not change how frogs work in the slice.

### The comfort ring

Later rungs add multipliers to the same ring, not new rules. Field studies of flight-initiation distance find that a faster approach and a direct gaze both make animals flee sooner (Bateman and Fleming 2011, hadeda ibises; see Sources).

```
ring = species shy ring × (1 − 0.8 · trust)          slice: 1.5 m → 0.3 m for frogs
     × posture (walker)   stand 1.0, kneel 0.8, sit 0.65
     × gaze (walker)      watching 1.15, looking away 0.9
     × light (night)      lantern or fire 1.3
startle when: a source is inside the ring and faster than the calm speed,
              or an edit happens right beside the creature
calm speed  = gentle pace × (1 + 2 · trust)
```

Every number is a per-species field in the species recipe, so the tuning panel can reach it. Matt's presence sandbox (a walker-form prototype, kept outside the repo) runs this rule for frogs.

### Trust, wariness and familiarity

- **Trust** belongs to one individual and is stored as small events. Feeding and quiet watching earn it; it shrinks the ring. Naming and later bonded behavior build on it. It never goes down.
- **Wariness** is the after-effect of a startle: live only, gone in about a minute. A clumsy approach costs a minute, never earned progress.
- **Familiarity**, a whole group slowly getting used to you, could arrive with the walker or the camp (also stored as events). The slice does not need it.

| Word | Internal range | What you see |
|---|---|---|
| Wary | 0–0.2 | Keeps its full ring; plops at the first swoop |
| Tolerant | 0.2–0.45 | Lets you come slowly to about a meter |
| Curious | 0.45–0.65 | Lets you right up close; can be named |
| Familiar | 0.65–0.85 | Sits still for a portrait; comes to food quickly |
| Bonded | 0.85 and up | Rests beside you; visits camp (later rungs only) |

### Wildness ceilings

Starting values for the tuning panel. The ceiling itself says something about the animal.

| Species | Ceiling | Closest it gets |
|---|---|---|
| Frogs | Familiar | Sits still for a portrait at arm's length; calls from a reed beside you |
| Midges | (a swarm) | Ignore you; they matter to the frogs, not to you |
| Minnows | Familiar (as a school) | Swirls to the surface at your hand |
| Dragonflies | Curious | Patrols past you; lands on a reed by your knee |
| Bees | Tolerant | Ignore you while you sit in the flowers |
| Butterflies | Curious | Land on your sleeve or hat if you are very still |
| Songbirds (robin) | Bonded | Follows you while you dig; perches on the tent or your pack |
| Hedgehogs | Bonded | Snuffles past your boots at night; sleeps by the cold firepit |
| Squirrels | Familiar | Takes a nut from the ground near you; caches near camp |
| Owls | Tolerant | Stays on its branch and watches you back; answers your hoot |
| Herons | Tolerant | Keeps fishing if you stay about 15 m away and look elsewhere |
| Otters | Bonded | Pops up to watch; leaves a pebble or shell on your stone |
| Turtles | Familiar | Keeps basking when you sit on the same log |
| Fireflies | Tolerant (as a swarm) | Their flashing drifts around you when you sit without light |
| Bats | Tolerant | Hunt the moths drawn to your fire |
| Cranes | Wary | Rare visitors; you watch from far, and that is the point |

Several come from real behavior: robins follow people who turn soil, because digging exposes worms, and can learn a familiar person; bats hunt the insects drawn to lights.

### Presence in the journal

Presence needs no screen of its own:

- **Likes lines** learned by watching: "Doesn't mind you close, if you come slowly." "Dives at a fast swoop." "Will sit for a portrait once it knows you."
- **Notes** for moments: "Pip sat still for a portrait." "The chorus went quiet when you swooped, and came back from the far side."
- **The creature card** carries the trust word beside the name.
- **The web** may later gain a pencil node for you ("you → frogs, food"), inked the first time a frog eats from your offering. Optional.

### Determinism and time away

Live only, recorded when it matters:

1. Startles, wariness and the chorus going quiet are live animation. Nothing is saved.
2. Trust is saved as small timed events and applied by the hourly tick in live play and catch-up alike, the pattern doc 11 already uses for Feed. Quiet watching becomes such an event: a stretch of a still camera near a creature, closed when the camera moves or the stretch reaches its cap.
3. While you are away there is no presence, so trust does not change. The later exception is the camp, which adds standing presence events during catch-up.
4. Later rungs add their own event types the same way (footfall for desire lines, camp events). No per-frame presence data is ever saved.

### Rung 1, the hand (S6b and S6c)

- **S6b (the frog you see, and presence):** each frog has its comfort ring. A fast swoop through it, or sculpting or pouring right beside it, causes a soft startle. Zooming in slowly is welcome. Nearby frogs hush; the chorus returns from the far side.
- **S6c (feed, trust and name):** Feed is for trust only. Feeding and quiet watching earn trust as small saved events; trust shrinks the ring. A curious frog can be named; a familiar frog sits still for a portrait.

### Rung 2, the seat (M2)

"Sit here" lets you choose a spot. The camera glides down to seated eye height (about 1 m), looking out; you can look around slowly but not move, and the HUD fades. In the source list the seat is always low, still and never fast, so it never startles and always counts as quiet watching: the place trust grows fastest. Seats become places the journal remembers. It pairs with photo mode (M2), and it forces the ground-level view (grass at eye height, the water's edge up close, the horizon, fog) to look good before the walker needs it.

### Rung 3, the walker (M3–M4)

- **Moving:** tap or click a spot and the figure walks there along the creature walkability grid; the same on a phone and a desktop, no virtual joystick (WASD optional on desktop). Pace: creep, stroll, brisk; creep stays under a shy frog's calm speed. Postures: stand, kneel, sit, lie.
- **Where:** anywhere walkable above water, wading to the knee, no swimming. Stepping stones and the bridge become crossings; paths become routes.
- **Creatures learn your routes:** on a path you always use, the ring multiplier is slightly smaller. Repeated footfall wears a faint desire line into the grass that grows back if you stop using it.
- **Interactions gain a body:** kneel to offer food, whistle while sitting, carry a lantern, crouch to photograph.
- **The figure:** a small stylized traveler, about 1.7 m, in a coat, hat and pack, with no face. Recommended build: procedural, from the same blended-SDF body pipeline as the creatures, with leg IK; a hand-made glTF figure is the alternative.
- **The camera:** "step in" glides from the diorama orbit to a low third-person view; "step out" glides back. The orbit stays the default way to play.
- **Cost:** the biggest rung. Near-field rendering and draw distance at ground level, grass that bends underfoot, footprints, footsteps by ground (doc 17), collision with walls, bridge and stones, an animation set, and new save data.

### Rung 4, the camp (M6, or with M7)

A spot above high tide: a bedroll or small tent, a firepit, a kettle, a lantern and a crate. A home point, not a building project (doc 01's non-goal of settlements holds).

- **The sleep ritual:** crawling into the tent saves and ends a session; the next return opens at camp at dawn, the reveal starting from the tent flap. Closing the tab still works.
- **Standing presence:** while you are away, the camp adds small trust events during catch-up for creatures that already know you. Bonded animals visit: the hedgehog by the cold firepit, the robin on the tent ridge, an otter's pebble on your stone.
- **Fire:** a physical light at about 1,800 K with flicker and wind-blown smoke. It draws moths, the bats come for the moths, the frogs call from beyond the firelight. It never spreads; its ash fades in a day.
- **Leave no trace:** moving camp leaves a pale patch that regrows over a few days.

## Data and interfaces

```js
// src/world/creatures/presence.js (S6b): the live source list, rebuilt each frame, never saved.
/**
 * @typedef {Object} PresenceSource
 * @property {string} id
 * @property {'camera'|'seat'|'walker'|'camp'} kind   only 'camera' in the slice
 * @property {[number, number, number]} pos           world meters
 * @property {number} speed                           m/s
 * @property {boolean} editing                        a sculpt, pour or plant stroke near pos
 * @property {number} stillS                          seconds since it last moved
 * @property {'stand'|'kneel'|'sit'|'lie'} [posture]  walker and seat
 * @property {[number, number] | null} [gazeAt]       walker
 * @property {boolean} [light]                        lantern or fire, at night
 * @property {boolean} [onPath]                       walker
 */
```

Per species, a `presence` block in `recipes/species/<id>.json` (frog starting values):

```json
"presence": {
  "ringM": 1.5, "ringTrustShrink": 0.8, "ringMinM": 0.3,
  "calmSpeed": 0.5, "calmTrustGain": 2,
  "editReachM": 2, "wariS": [40, 70], "hushReachM": 4, "hushS": 20,
  "watch": { "reachM": 3, "minS": 20, "capS": 600, "trustPerMin": 0.012 },
  "feedTrust": 0.06, "ceiling": "familiar",
  "multipliers": { "posture": { "stand": 1, "kneel": 0.8, "sit": 0.65 }, "gaze": { "watch": 1.15, "away": 0.9 }, "light": 1.3 }
}
```

Stored trust events (applied by the hourly tick, saved with the world): `trust:fed { creature, hour }`, `trust:watched { creature, minutes, hour }`. Live events (past tense, doc 03): `creature:startled`, `creature:hushed`, `creature:portrait`.

## Tuning knobs

Per species, in the tuning panel: the ring, its trust shrink and minimum; calm speed and its trust gain; edit reach; wariness time; hush reach and time; quiet-watching reach, minimum, cap and rate; feed trust; the ceiling; and the later posture, gaze and light multipliers.

## Performance budget

Rung 1 is a few distance checks per creature per frame against one source: negligible. Later rungs keep the source list small (a handful of entries). The walker's near-field rendering is budgeted in doc 19 when it is scheduled.

## Acceptance checks (rung 1, with S6)

- Swoop the camera fast past a frog on the reeds: it hops into the water, surfaces eyes-up about 2 m away, and is back within about a minute; frogs nearby hush, and the chorus resumes from the far side.
- Zoom in slowly to the reeds beside a frog: it stays put.
- Sculpt or pour right beside a frog: it startles.
- Feed and watch quietly over a few sessions: the card's word moves from Wary toward Curious; a curious frog can be named; a familiar frog sits still for a portrait.
- Close the tab and come back: trust is where you left it, and startles from before are forgotten.

## Open questions

- Should the walker stay something you choose to step into, with the diorama view the main way to play, or eventually become the main way?
- Should the figure be customizable from the start, or found and gifted over time?
- Should a whole group slowly get used to you (familiarity), or should closeness stay one creature at a time?
- Should the camp kit be a creature's gift, or the reward for your first bonded creature?
- Should the camp ever grow (a lean-to, a small garden, a rain barrel), or stay a bedroll and a fire?
- One camp you move, or more than one camp spot?
- Should a bonded creature ever follow you on walks, or only meet you at its home and at camp?

## Sources

- [Bateman and Fleming (2011), "Who are you looking at? Hadeda ibises use direction of gaze, head orientation and approach speed in their risk assessment of a potential predator", *Journal of Zoology*](https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Who-are-you-looking-at-Hadeda/991005542929307891)
- [A Review of Flight-Initiation Distances and their Application to Managing Disturbance to Australian Birds](https://vuir.vu.edu.au/22210/)
- [Countryfile: Your garden robin might know who you are and even follow you about](https://www.countryfile.com/animals/your-garden-robin-might-know-who-you-are-and-even-follow-you-about-but-its-not-because-youve-become-friends)

## Depends on / feeds into

Depends on `11-creatures-and-ecology.md`, `13-progression-and-expansion.md` (journal), `15-camera-input-and-ui.md`, `02-core-loop-and-idle-model.md` (hourly tick, catch-up). Feeds `12-creature-roadmap.md` (ceilings), `16-customization-and-photo-mode.md` (the seat, the figure's look), `17-audio.md` (footsteps, fire, the chorus hushing), `18-saves-and-persistence.md` (trust events, later camp state), `19-performance-and-quality-tiers.md` (near-field budgets), `20-roadmap-and-vertical-slice.md` (where each rung lands).
