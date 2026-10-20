# The journal's Web, redrawn

The Web you approved on 2026-10-20: one thing at a time instead of rows that grow wider with every species. Built on top of `m1-finds-shore`, so the five finds are in it.

- **Trail** at the top: the last few things you tapped (for example Shore, Rippled sand, Sand). Tap one to go back to it.
- **Focus card**: the chosen thing (icon, name, kind, and Found or On your island) and its ties as chips in three groups: **Needs**, **Needed by** and **Shares a home with**. Tap a chip and that thing moves to the middle. Chips wrap, so the card never widens.
- **Shelf** at the bottom: four tabs (Ground, Plants, Small lives, Animals) with square icon tiles, six to a row on a phone. The name shows on the card, not the tile.
- **Tints**: ground soft sand-yellow, plants soft green, small lives soft aqua, animals soft orange. Chips have a pale fill with darker text of the same hue. A tie you have not seen yet is the same tint in a dashed pencil outline with no fill. Something you have not met is a pencil question mark that hints without telling ("Something here seems to need rock and shore.").
- **Ties strip** on every journal page: the same chips plus **Open in the Web**.
- The Web **opens on whatever the journal last showed**. A note about something with no page of its own (a rock pool, the wrack) opens the Web on it.

Every ground feature is a node: soil, sand, rock, stones, moss, fresh water, shore, rock pools, the strandline, wrack, kelp, black lichen, rippled sand, wet sand and tidal mud. So are every plant, every find (anemone, periwinkle, lugworm, hermit crab, edible crab), frogs, midges and you. Ties follow the game: the anemone needs a rock pool and the tide band; the periwinkle needs wrack; lugworm casts need rippled sand, wet sand or mud; hermit crabs need a pool; edible crabs need wrack and pools; wrack, kelp and lichen need rock and the shore; the strandline is made of wrack and kelp. A unit test checks the finds' ties against `recipes/species/finds.json`. Inking follows today's rule: seen on the island means ink.

Adding a species or ground feature later is one node and its ties in `recipes/world/journal-web.json`, with no layout change (a unit test adds a pretend limpet to prove it).

## What changed

| Where | What |
|---|---|
| `recipes/world/journal-web.json` | Version 2: kinds, nodes with kind and icon, all the new ground nodes and ties; no rows or layout numbers |
| `src/world/journal/web.js` | What the island holds now (presence), new triggers (`here:`, `seenOn:`), `tiesOf` for the three groups |
| `src/world/journal/shore-presence.js` | New: counts the shore zones and rock pools for the Web |
| `src/world/finds/index.js` | The rock pool test pulled out as `poolCells`, shared with the Web (finds behave the same) |
| `src/ui/journal-web.js` | The trail, the focus card, the shelf and the Ties strip |
| `src/ui/journal.js` | Wires taps, the trail and the Ties strip on pages |
| `src/ui/journal.css` | Kind tints as tokens beside the journal's paper colors; Web styles |
| `src/ui/icons/icons.js` | Nine new drawn icons: pool, strandline, wrack, kelp, lichen, ripples, wetsand, mud, you |
| `src/app.js`, `src/main.js`, `src/world/water/shore-live.js`, `src/world/journal/index.js`, `look.js` | The shore's zones and pools reach the journal; setting a stone tells the journal |

The journal is always cream paper, in every Look palette and in dark mode, so the tints sit with its paper colors and would change with them if a night paper is added later.

Plants' habitats and starters are untouched (the plants rework is on another branch).

## Click-test

1. Open the journal and tap **Web**. It opens on the Shore. Its card says Ground, On your island, and lists under Needed by: Rippled sand, Wet sand, Strandline and Sea thrift as tinted chips, then pencil question marks for things you have not met.
2. Tap **Rippled sand**, then **Sand** on its card. The trail at the top reads Shore, Rippled sand, Sand. Tap **Shore** in the trail: you are back on the Shore and the trail is short again.
3. Tap a pencil **?** chip under the Shore. The card says Not yet seen, with a pencil question mark, and a line in the journal's italic hand saying what it seems to need. It never names the thing.
4. In the shelf, tap **Plants**, then the reeds tile. The card shows Reeds: Needs Fresh water; Needed by two pencil question marks (frogs and midges, not yet met); Shares a home with Rushes and Water lilies.
5. Tap **Open its page**. On the Reeds page, under the opening line, a **Ties** box shows the same chips. Tap **Open in the Web**: the Web opens on Reeds.
6. Go to **Living things**, open any page, then tap the **Web** tab: the Web opens on that page's thing.
7. Paint rock along the shore in the tide band and lower a hollow in it. After the tide fills it, the Web's Ground shelf shows a **Rock pool** tile and **Wrack** (on the rock in the band), and the Notes say a hollow in the rock holds the sea as a pool.
8. Find an anemone in that pool (tap it). In the Web, the Rock pool's Needed by now shows **Beadlet anemone** in soft aqua, and Small lives shows its tile.
9. Use Sculpt's **Stone** mode to set a stone. The Ground shelf's **Stones** tile turns from a question mark to the stone icon.
10. On your phone, open the journal tall and check the Web: no sideways scroll, chips wrap, six tiles to a row, text easy to read. Turn the text size up in Settings and check again.
11. Open `tools/unit-tests.html`: every test passes (158 of 158).

## Living things, tidied (second commit)

As the island fills, the **Living things** list stays easy to move through:

- **Folding groups**: Plants, Animals, Small lives, and Shells once the finds branch adds that page. Each header is a tinted pill in the Web's colors (green, orange, aqua) with a chevron; tap it to fold the group shut. A folded group still shows the small "new" dot if something inside it is new.
- **Show** chips: All, Found or Not yet, plus one place at a time: Pond, Meadow or Shore (tap it again to let go).
- **Sort** chips: Recently found (the default), A to Z, or By place (pond, meadow, shore).
- Your folds and chips are kept on this device, like Settings, and never in an island file.
- Small lives still list only what you have found, even under Not yet. Nothing shows a count.

Groups, places and words are in `recipes/world/journal-list.json`. A shells page goes into its own Shells group the moment it exists, with no code change (a unit test checks this).

### Click-test

1. Open the journal on **Living things**. Above the list are the Show and Sort chips. Below are tinted headers: Plants (green), Animals (orange), Small lives (aqua).
2. Tap the **Plants** header: the plants fold away and the chevron turns. Tap again: they come back.
3. Tap **Found**: only what you have met shows; Animals says "Nothing here with these choices." until frogs come. Tap **Not yet**: the plants and animals still in pencil show. Small lives never list one you have not found.
4. Tap **Shore**: only sea thrift (and found shore lives) remain. Tap **Shore** again to let go.
5. Tap **A to Z**, then **By place**: the plants reorder (pond plants, then grass, then thrift).
6. Fold Animals, reload the page, open Living things: Animals is still folded and your chips are as you left them.
7. On your phone: no sideways scroll, the chips wrap, text easy to read.

## To publish

In GitHub Desktop: choose the `m1-journal-web` branch (worktree `Ebb-web`) and click **Publish branch**. It is built on `m1-finds-shore`, so publish that branch first if it is not yet published, or open the pull request against `m1-finds-shore`.
