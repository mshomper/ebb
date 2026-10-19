# F02 — Farewell and sister islands

> ebb never ends on its own, but a player may want it to. The name gives the game its closing gesture: once an island has had its year, you can let it **ebb**. On a low tide of your choosing you push off in a small boat, the island recedes into the dusk, and a pale shoal rises out of the sea nearby: a sister island to begin again. Nothing is lost. The first island keeps its life, catches up when you sail back to it, and can be tended again at any time. As Matt put it, this lets someone separate from something they have worked hard on and start anew, without being asked to give it up.

**Status:** Leaning. Not scheduled. After v1 at the earliest, alongside or after the M7 Headland chapter. Nothing here is built until Matt schedules it.

## Decided so far

- Matt, October 19, 2026: the farewell and sister island idea is worth developing, for the reason above (a way to separate from an island and start anew).
- The vision's rules hold: no fail states, nothing lost by being away, no land ever removed, no pressure. The farewell is a choice, never a goal, a prompt or a reward to chase.

## The idea

Most cozy games either never end or end with a credits roll. ebb can do something gentler: let the player close a chapter by leaving, while the island itself goes on. Real islands do this. People leave, and the island keeps its frogs and its reeds.

```mermaid
flowchart LR
  Y[Year page complete] --> O[Offer appears in the journal<br/>quietly, once]
  O --> C[You choose a low tide]
  C --> K[Choose one keepsake]
  K --> B[The boat pushes off at dusk]
  B --> S[A shoal rises nearby:<br/>the sister island]
  S --> T[Tend the new island]
  T -.sail back any time.-> R[The first island,<br/>caught up and waiting]
  R -.-> T
```

## How it could work

### When it is offered

- The farewell becomes possible after the year page completes (doc 13). Before that, the island still has its first story to tell.
- It appears once, as a short line at the end of the year page ("The tide is low tonight. Some keepers sail on from here."), and afterwards lives as a quiet entry at the back of the journal. It never appears as a notification or a menu button on the main screen.
- Leaning: no other condition. A player who wants to stay forever simply never opens that page.

### The ceremony

1. **Choose a low tide.** The journal shows the next few evening low tides. You pick one, or "tonight".
2. **Choose a keepsake** (below).
3. **The departure.** At that low tide the camera glides down to the shore where a small boat waits. Before the walker exists (doc 23, rung 3), the boat is a game-driven glide, which never startles anything. With the walker, you walk to the boat yourself. Creatures that know you behave as they do at your camp: a bonded otter surfaces to watch, the robin flies to the bow.
4. **The island recedes.** The boat rows out slowly. The island shrinks against the dusk sky, and the camera lingers on it: the reeds, the lantern, the pond's last light. The island theme plays in its winter setting (doc 24), or a dedicated farewell piece.
5. **The sister island.** Out on the water, a pale sand shoal shows at low tide, the same way new land pieces arrive (doc 13). By the next low tide it has risen into a small starter island with a spring, and the boat comes ashore.

The whole sequence is skippable after the first time and can be stopped at any point before the boat leaves.

### The keepsake

You take one thing with you. Each is small and carries memory rather than progress:

- **A seed** of any plant that grew on the first island, planted wherever you like on the new one.
- **The lantern** from the first island, already lit on arrival.
- **A token** from a bonded creature (the otter's pebble, a heron feather), which sits at your new camp.
- **The journal itself** is never a choice, because it always comes: the first island's journal is shelved as a bound volume you can open and read, and a fresh journal begins.

Leaning: one keepsake, chosen. The constraint makes the choice mean something.

### What carries over and what doesn't

| Carries over | Starts fresh |
|---|---|
| Your knowledge: tools you earned (Cliff, stream tool), palettes, the tuning you saved | Species: every creature must find the new island and be welcomed again |
| The first island's journal, as a bound volume | Trust: it belongs to individuals, who live on their own island |
| Your keepsake | Land pieces: the new island has its own five to raise |
| Settings and preferences | Gifts: each species gives its gift again on the new island |

Open: whether tools carry over. Carrying them respects what the player learned; starting without them makes the new island feel like a new beginning. The table shows the leaning (carry them).

### The archipelago

- The islands share a sea. The sister island is placed by the first island's seed (a derived seed per island), close enough that the first island shows on the horizon.
- **The first island stays visible** from the new one as a low-detail silhouette built from its saved heightfield and a few tree and lantern impostors. At night its lantern glows across the water. This is the emotional core: you can always see where you came from.
- **Sailing back** is a short boat glide from the shore. Only one island is tended at a time (doc 18's one-writer rule holds); the other is resting.
- The journal's island map (doc 13) grows into a small sea chart: each island, its name, the year you landed.
- Each island keeps its own 192 m world ceiling. Three or four islands is a natural limit for the chart; more is open.

### The resting island

- A resting island runs no simulation while you are on another. Its clock simply waits.
- When you sail back, it catches up like any return: up to 7 game days (F01), with the usual reveal. It has moved on a little, never a lifetime. That keeps the cost of an archipelago at zero while you are elsewhere.
- Leaning: the resting island's catch-up uses the same rule as any absence, so there is no special case in the code.

### Variety in the sister island

Each sister island differs a little from the first, chosen from a few starter shapes in the land recipes (doc 13's `recipes/land/`): a rockier island with a sea-cliff edge, a low marshy one, a sandy one with dunes. Leaning: the player chooses from two shoals at the start of the ceremony, or lets the sea choose.

## What it would change

Listed only; Matt applies these later.

- **Doc 01 (vision):** the open question about an ending is answered: no ending is forced, and the farewell is an optional chapter close.
- **Doc 13 (progression):** the year page gains the farewell line; the island map grows into the sea chart; a note that gifts and land restart on a sister island.
- **Doc 18 (saves):** a small archipelago record (which islands exist, which is active, which are resting, how they are placed); the first island's journal kept as a read-only volume; export of one island or the whole archipelago; doc 18's open question about more than one island slot is answered by this.
- **Doc 15 (camera and UI):** the departure glide and the boat crossing; the journal's back page.
- **Doc 04 and doc 19 (render and performance):** the distant-island silhouette and its lantern as a cheap impostor, budgeted per tier.
- **Doc 23 (presence):** creature farewells for bonded animals; the boat as a walker crossing.
- **Doc 24 (music):** a farewell cue or the island theme's use for departure.
- **Doc 20 (roadmap):** where the farewell sits relative to M7.

## Risks and guardrails

- **It must never feel like a reset button or a prestige loop.** Nothing is multiplied, unlocked faster or scored on the second island. The second island is a fresh start, not a harder or richer level.
- **It must never feel like loss.** The first island is always one boat ride away, always visible on the horizon and never removed.
- **It must never push.** One quiet line, once. No reminders.
- **Scope:** the archipelago is new save structure and a new render element. It belongs after v1.

## Open questions

- Should the farewell open only after the year page, or at any time for a player who wants to start over sooner?
- Should earned tools come with you to the sister island, or should each island earn its own?
- One keepsake, or a small bundle (a seed and a token, say)?
- Should the player choose the shape of the sister island, or let the sea decide?
- How many islands should the sea chart hold?
- Should the first frogs on the sister island come from the old one (founders, see F05), or arrive from beyond the shore like before?

## Depends on / feeds into

Depends on F01 (the cap and clock), docs 13, 18 and 23. Feeds F04 (the chronicle becomes the bound volume) and F05 (founders from the first island).
