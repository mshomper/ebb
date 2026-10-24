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

## Testing

- Each feature ships with a short click-test list: what Matt should see and do, in plain language. Put it in the PR description.
- For anything numeric (simulation stability, frame time, catch-up determinism), add or extend a page in `tools/` that shows the result visually and can be run locally.
- Determinism check: the same seed and the same edits must produce the same world after catch-up. `tools/determinism.html` compares two runs.
- Run only what a change reaches while working: `node tools/affected-tests.mjs` prints the test groups (and a `tools/unit-tests.html?groups=...` link) for what the branch changed. Run the full suite (`tools/unit-tests.html`, no parameters) once at handoff, before reporting ready. Open `tools/determinism.html` only when the script says so.
- Progress: every feature branch adds one row at the end of the table in `docs/progress.md`. Never add progress rows to `README.md`, which keeps only a short status.

## Current target

Phase 2 of the keeper's camp, the first season (`docs/future/13-keepers-camp.md` section 13, with 3.12), after a short groundwork step: the rest of the walker's motion and the planting sketch (D1). Phase 1 passed its exit check on October 23, 2026. Do not build Phase 3 or later until Matt approves. See `docs/20-roadmap-and-vertical-slice.md`.

All planting is the walker's (Matt, October 24, 2026): the Plant tool leaves the view from above.

Matt provides the camp models in `C:\Users\mshom\Documents\Ebb\_assets` (glb). Sessions make only small pieces such as the fire steel, drift twigs, pebbles, flat stones and reed down. For anything more complex than a basic shape, ask Matt whether he will make it or the session will.
