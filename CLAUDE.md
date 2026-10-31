# CLAUDE.md — working rules for the ebb repo

ebb is a cozy idler and living diorama: the player shapes a small island, builds habitat, creatures arrive, and the world keeps growing while the player is away. It is built on raw WebGPU and WGSL with plain JavaScript ES modules. Read `docs/01-vision-and-pillars.md` first, then the doc for whatever system you are touching.

## Who you are working with

Matt owns this project. He is an expert in computational design, implicit surfaces, TPMS geometry, biomimicry and GPU graphics concepts, but he does not write code. You write all of it. He is a highly visual learner: when you explain a change, show it (a diagram, a screenshot, a small test page) rather than describing it at length.

## How to work

1. **Analyze, then propose, then build.** When Matt raises an issue or a feature, analyze it and present the proposed changes for his approval before writing or modifying code. Keep proposals short and visual.
2. **Ask before pushing to main.** Work on a branch. Matt click-tests on desktop before anything merges. Never push to main without his explicit approval.
3. **Commits and PRs.** A `Co-Authored-By: Claude` trailer is fine. Never put claude.ai session links in commit messages or PR descriptions.
4. **Big jobs in small pieces.** Split large work into small, fast subagents that run in parallel, and keep working on other parts rather than waiting idle on one long task.
5. **Heavy analysis runs on Matt's machine.** Benchmarks, long simulations and regression checks go in a page under `tools/` that Matt opens locally, side by side with the game. Do not run long computations in the cloud and wait on them.
6. **Do not over-deliberate.** Make an educated call from the docs and the code, state it in one line, and move on.
7. **Repos go through GitHub Desktop on Matt's side.** Git is not available in his PowerShell, so any steps he must take locally should be written as GitHub Desktop actions.

## Hard UI rules

- **No horizontal scrolling, ever.** Every layout must fit its pane at every width.
- **No emoji and no symbol-glyph icons** (no ⊕, ▦, ⬡ and similar). Every icon is a drawn SVG icon in `src/ui/icons/`, sharing one stroke weight and the brand palette.
- **Legible text.** UI body text is never below 15 px. Matt has flagged small text before; when in doubt, go larger.
- UI type is Nunito; the journal and tagline use Fraunces italic. Wordmark rules are in `docs/21-brand-identity.md`.
- Never use the words "genuine" or "genuinely" in UI copy, docs or messages.

## Code conventions

- Plain JavaScript ES modules with JSDoc type annotations. No required build step. The app runs by opening `index.html` from GitHub Pages or a local static server.
- Raw WebGPU and WGSL. No engine. Small libraries only where they save real work (a math library, a glTF loader later). Vendor them under `src/vendor/` with their license.
- Units are meters, Y-up, right-handed.
- **Everything simulated is deterministic and seeded** through `src/core/rng.js`. Never call `Math.random()` in simulation code. Offline catch-up and saves depend on this.
- WGSL lives in `src/shaders/*.wgsl`, one concern per file, loaded at boot. Shared structs go in `src/shaders/common.wgsl`.
- CPU-heavy work runs in Web Workers through `src/core/workers.js`, using all cores. GPU-heavy work runs in compute shaders.
- Modules talk through the event bus (`src/core/events.js`) and the store (`src/core/store.js`), never by reaching into each other's internals.
- Every tunable number that shapes the look or feel lives in a recipe file under `recipes/`, not hard-coded, so the tuning panel can reach it.
- Keep files small and focused. If a file passes about 600 lines, propose a split.

## Module map

```
index.html
src/main.js, core/, world/, sim/, render/, shaders/, input/, ui/, audio/, save/
recipes/  species/ flora/ palettes/ land/ world/ quality-tiers.json
assets/   audio/ (CC0 sounds)
brand/    icons and favicons
docs/     architecture docs (start at 01)
tools/    local test and benchmark pages
```

Full ownership and exports are in `docs/03-tech-stack-and-module-map.md`.

## Look rule

**Physical light, painted last.** Light, sky, shadows and water optics are computed physically in linear HDR. The soft painted palette is applied only at the tonemap step through a palette lookup. Do not paint colors into materials to fake the style; change the palette instead. Details: `docs/05-look-and-palette.md`.

## Creature rule

**Every creature is rigged and animated.** As far as its form allows, every creature, including each life stage (tadpole, froglet, adult), has a basic rig and plays basic animations for what it does: walking, hopping, swimming, flying, breathing at rest. A single posed model sliding across the ground is never acceptable. Swarms of tiny creatures (midges, minnow schools) may use cheap shader motion instead of bones, but they must still move like living things. Build the rig and animations with the creature, not as a later fix.

## Adding a creature

Every new species, swarm or seasonal life goes through this list (Matt, October 29, 2026). Copy it into the plan page, mark each row done, n/a with a reason, or a question for Matt. Look at `recipes/species/turtle.json` and `hen.json` as worked examples. Rules from docs 11 and 12 and the "Shaped, not found" section of `docs/13-progression-and-expansion.md` apply throughout; trust, treats and makes follow `docs/future/13-keepers-camp.md` sections 6 and 8.

**Always:**
- **Model and rig.** Who makes the model is Matt's call when it is more than a basic shape; note its licence and credit (`assets/models/<id>/CREDITS.md`). A rig and animations for every life stage, motion written against bone roles, as the creature rule says. Drawn at the findable scale (about 2.5 to 3 times real for small creatures; real-metre needs stay real).
- **Species recipe** (`recipes/species/<id>.json`, registered in `recipes/index.json`): body, motion, `presence` (wary ring, multipliers, bands), `ecology` (needs, activity, dormancy, `arrival` with `leaveGraceDays` for schools and swarms). It never startles from the game camera, only from the walker. Simulation is seeded and catch-up-safe; trust is live only.
- **How it comes.** Its needs are met by ground the player shaped where "Shaped, not found" says so; a newcomer visits first and leaves a hint note the next morning; homes compete. Its tier, and whether it counts toward a tier milestone (doc 12).
- **Journal page** (`recipes/world/journal.json`): name, icon, card line, riddle, hints (`<key>:right`, `<key>:sign`), field notes learned by watching, stages and amount lines, pencil-then-ink lines; its place in `journal-list.json`; its nodes and inked edges in `journal-web.json` (what it eats, where it shelters, who eats it). Every card it shows needs a home on a page (no orphan cards).
- **Sketchbook** (`recipes/world/sketchbook.json` list and `art`): Matt draws the pencil art from `sketchbook-brief.html` (three tiers, `<id>-1..3.png` and moments into `Documents\Ebb\_sketches\`); list the moments it needs.
- **Icon** in the item icon family (`src/ui/icons/`), same stroke and palette; no glyphs.
- **Show me and hints:** its Show me rings where it lives; add it to the morning hints' `animalCame` and `showMe` lists where it fits (`recipes/world/morning-hints.json`).
- **Sound** if it makes one (CC0, `recipes/audio/`), quiet in the soundscape.
- **Seasons:** when it is active, dormant or away (`recipes/world/seasons.json`), and what its page says while it sleeps.
- **Saves:** whatever it keeps (trust, names, places) goes in a save section that older saves read without breaking.
- **Test link** (`?<id>`, and `?trust=` reaching each band) and a set-up link on any review page that checks it.

**Depending on how far trust can go** (`presence.ceiling` and `bands`; F13 section 8):
- **Watching only** (a ceiling of Tolerant, like damselflies): bands and their behaviour; no treats, no name, no gift. Say so on its page.
- **Feeding and treats** (`presence.feedTrust` above 0): its `treat` block (kinds, how it takes them, `treatFeeds`), real food or real things only, one treat a creature a day; the treat's lines in `recipes/world/treats.json` (`coming`); any treat that is made gets a make with a **unique set of parts** in `cook.json`, plus its pack kind, icon and gather if new; a "treats" morning hint `showMe` entry; pencil-then-ink lines on its page.
- **Naming** (named at `namingTrust` 0.5, like frogs, turtles, the hen): the name moment, the name on its card and page. Species that cannot be named (schools, swarms) get a group moment at 0.5 instead (the minnows rise to meet you).
- **The gift** (doc 12): one gift per species, a seed or a tool, never a creature, at naming or the group's 0.5. `ecology.gift`, its card lines in `recipes/world/naturalist.json` `gifts` (with `stoneLine` for when it is laid on the gift stone), and what it opens next in the gift chain (`docs/13-progression-and-expansion.md`, "The gift chain"). Check it does not repeat another species' gift.
- **Beyond the top band** (like the hen's Fond): only when Matt asks for it; its own reward, earned by time together, never by counting treats.

## Adding a set piece or story arc

The twin of the list above (Matt, October 30, 2026), for every set piece (`recipes/setpieces/`) or story arc that runs over days:
- **Its thread** in `recipes/world/threads.json`: a title, a drawn icon, lines in the keeper's voice (American spelling) each with a test in the morning hints' shape (add flags the set piece sets, as `setpiece:<id>:...`, where none fit), one soft pencil line, and its `end` tests (none if it never ends, like the boat).
- **Its keeper page** if it has one (`recipes/world/keeper-pages.json`), and the thread's `pages` if the thread should open them.
- **A morning hint** when the player needs a nudge to find it (`recipes/world/morning-hints.json`, a `when` on its first flag).
- **Test links**: its own, and the thread part-way on `?threads` where it fits.

## Testing

- Each feature ships with a short click-test list: what Matt should see and do, in plain language. Put it in the PR description.
- For anything numeric (simulation stability, frame time, catch-up determinism), add or extend a page in `tools/` that shows the result visually and can be run locally.
- Determinism check: the same seed and the same edits must produce the same world after catch-up. `tools/determinism.html` compares two runs.
- A branch runs only what it reaches, while working and at handoff: `node tools/run-tests.mjs --affected` (the groups its changes reach, plus the core), `tools/determinism.html` when that says so, and the browser page (`tools/unit-tests.html?groups=...`) only for the page-only groups it names. The full suite runs once, on the combined tip, in the orchestrator's merge queue.
- A new test file is `tools/unit-tests-<key>.js` with one `add...Tests` export; `node tools/index-tests.mjs` lists it. Never add it to a shared list by hand. `node tools/typecheck.mjs` lists type errors that are new since its baseline: fix the ones the branch added.
- Progress: every feature branch adds its own file, `docs/progress/<date>-<branch>.md` (the format is in `docs/progress/README.md`). The table in `docs/progress.md` is a closed archive; never edit it. Never add progress rows to `README.md`, which keeps only a short status.

## Current target

M2's close. Phase 1 of the keeper's camp passed its exit check on October 23, 2026, and Phase 2, the first season (`docs/future/13-keepers-camp.md` section 13, `tools/season-review.html`), on October 29, 2026. Next: M2's close in three stages (B1 camp Phase 3 with the hen, B2 Steps, stepping stones, photo mode and tuning panel, B3 the meadow islet and the autumn and winter creatures), then the Hollow's first version. Do not start a stage until Matt approves it. See `docs/20-roadmap-and-vertical-slice.md`.

All planting is the walker's (Matt, October 24, 2026): the Plant tool leaves the view from above.

Matt provides the camp models in `C:\Users\mshom\Documents\Ebb\_assets` (glb). Sessions make only small pieces such as the fire steel, drift twigs, pebbles, flat stones and reed down. For anything more complex than a basic shape, ask Matt whether he will make it or the session will.
