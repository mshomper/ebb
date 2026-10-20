# F01 — Pacing and seasons

> ebb's authored arc (fifteen species, five land pieces and the year page) runs out much sooner than the game wants a player to stay. Matt imagines people living with one island for many years, and the first several days alone go to sculpting the island and getting ready for frogs. This doc records the clock changes Matt decided on October 19, 2026 to slow the island down: longer seasons, a shorter catch-up cap and slower growth while away, with the length of a game day unchanged. It lists every repo doc and file those changes reach.

**Status:** Decided. F01a (clock, catch-up cap, away rate, moon) is built on branch `m1-f01a-clock`, and docs 02, 03, 06, 07, 10, 13, 18, 19, 24 and the README are updated to match. F01b, on the same branch: old saves move to the new calendar (save format 2: same year, season and hour, day d becomes 2d; doc 18), and the frog timings were reviewed (hour-based steps kept; winter sleep keeps its share of the year; the `?frogs` test link now starts on spring day 7, after the frogs wake).

## Decided so far

Matt, October 19, 2026:

- **Seasons are 14 game days**, up from 7. A year becomes 56 game days.
- **The day keeps its cadence.** A game day stays 24 real minutes at 1x, and the tide keeps its 12 game hour period. The sessions Matt has tuned (dusk chorus, tide turns, music slots) keep their feel.
- **The catch-up cap drops to 7 game days** (168 hourly ticks), down from 14.
- **Growth while away runs at a quarter of watched time:** 4 real minutes away earn 1 game hour (`recipes/world/save.json` `catchUp.awayRate = 0.25`). The 7-day cap is reached after about 11.2 real hours away.
- **The moon keeps its 7-day cycle:** two full moons and four spring tides per season.
- **Plant growth rates stay as they are,** so each season ends fuller.
- **Speeding time up stays the player's choice.** 2x and 4x remain in Settings. Matt expects some players will use them; nothing is balanced against it, and nothing is lost by it except the island's rhythm.

## Why

- The arc in doc 13 takes about 80 to 120 game days. With 7-day seasons and a 14-day cap, a player who visits most evenings moves through that very quickly, and the island has little left to say afterwards.
- Longer seasons give each season room to be lived in: a whole spring of frogspawn and first calls, a summer long enough to feel long, an autumn that turns slowly.
- A shorter cap means one return never jumps more than half a season. A player can never miss a season entirely, which suits a game where seasons are the main clock.
- Slower away growth keeps the early days calm. Nobody wants the reeds racing ahead while they are still shaping the pond.

## How it could work

### The clock

| | Now | Proposed |
|---|---|---|
| Game day, watched at 1x | 24 real minutes | 24 real minutes (unchanged) |
| Tide period | 12 game hours | 12 game hours (unchanged) |
| Season | 7 game days | **14 game days** |
| Year | 28 game days | **56 game days** |
| Catch-up cap per return | 14 game days (336 ticks) | **7 game days (168 ticks)** |
| Growth while away | same rate as watched (1x) | **slower; a quarter of watched is the starting proposal** |

### Growth while away

The starting proposal is a quarter: one game hour for every four real minutes away. At that rate the 7-day cap is reached only after a long absence, so most returns show a gentle, proportional change rather than a fixed jump. Other values to try: a half (bigger returns) or an eighth (very gentle). The rate lives in one recipe value so it can be tuned by feel.

A hidden tab currently earns its time at the away rate. It would keep doing so, which means a tab left in the background also grows more slowly. That seems right: a hidden tab is the player being away.

### What stretches and what doesn't

Most of the island is driven by the season's phase (0 to 1 through a season), so it stretches by itself:

- **Phase-based, stretches automatically:** foliage color, leaf-out, bloom and fruiting windows, leaf drop, grass curing in late summer, frost mornings, day length, the music's seasonal palettes, soundscape crossfades at season edges.
- **Hour-based, needs a look:** plant growth rates (a plant now has twice as long in each season, so a season ends fuller; that may be welcome or may need slower rates), frog arrival and settling timings, the midge field's daily approach, interim moss fill times, per-plant phenology jitter (±0.6 game days today; probably ±1.2 with the longer season).
- **Seasonal gates in progression:** anything that waits for a season (fireflies in summer, cranes at a season turn, the year page's four seasons) now waits twice as long in game days. The year page can complete no sooner than one 56-day year.

### The moon

The moon is tied to the season today: one synodic cycle of 7 game days, new at the start of each season, full in the middle, with spring tides at new and full moon (docs 06 and 07). With 14-day seasons there are two choices:

- **Keep the 7-day moon**, so each season has two full moons and four spring tides. The tide rhythm the player knows stays the same.
- **Stretch the moon to 14 days**, keeping one full moon per season. Spring and neap tides come half as often.

The first keeps more variety in each session; the second keeps the "full moon in the middle of the season" landmark that the summer signature night uses. This is open.

## What it would change

Applied in F01a; the doc 18 save calendar migration and the frog timing review (doc 13) followed in F01b.

- **Doc 02 (core loop and idle model):** the season and year lines in Locked decisions; the cap (14 days, 336 ticks) in Locked decisions, the flowchart, the catch-up section, the code sketch (`capHours`), the performance lines and the acceptance check "close for a night, two seasons turned"; the away rate (`awayRate: 1`) becomes the slower value; the open question about overnight absences is answered.
- **Doc 03 (tech stack):** the module map line "moon cycle 7 game days" if the moon stretches; `catchup-bench.html` described as 336 hours.
- **Doc 06 (sky and lighting):** the moon's synodic cycle and its open question, whichever way the moon goes.
- **Doc 07 (water and tide):** "spring tides twice per season" becomes four per season, or stays two if the moon stretches.
- **Doc 10 (growth and seasons):** "seasons turn every seven game days" in the summary and the seasons step; the phenology jitter; growth rates reviewed against the longer season; the growth lab's 14-day chart.
- **Doc 12 (creature roadmap):** frog arrival and settling timings and dormancy lengths reviewed in game days.
- **Doc 13 (progression):** the pacing table's game-day column and the catch-up note in "Pacing for a relaxed player"; the year page's minimum length.
- **Doc 18 (saves):** the cap (336 hours, 14 game days) in Locked decisions and the time-away math, the away rate in that math, and the clock-forward acceptance check ("the reveal shows 14 game days"). "One copy per game season, up to 8" now reaches back two years instead of one.
- **Doc 19 (performance):** the 336-tick catch-up budget becomes 168, which halves the worst case.
- **Doc 24 (music):** each season's anchor pool now covers twice as many days; the anti-repetition history and the pool size per season (5 anchors) deserve a second look. The summer signature night depends on the moon choice.
- **Doc 25 (soundscape):** nothing structural; crossfades at season edges are phase-based.
- **README:** "one real minute away is one game hour, up to 14 game days".
- **Code and tests to follow the docs:** `src/world/seasons.js`, `src/world/sky/sun-moon.js`, `src/world/tide.js`, `src/sim/catchup.js` (`CAP_HOURS`), the save's time-away math, `tools/unit-tests.js` (the season changes at hours 168 and 336, and the 336-tick checks), `tools/catchup-bench.js`, `tools/growth-lab`.

## Risks and guardrails

- **Saves made before the change** were grown under 7-day seasons. A season index or day number in an old save would mean something different. The save migration (doc 18) needs a step that keeps the island's current date and season sensible, even if it shifts the calendar once.
- **Determinism:** every changed value is a recipe or clock constant, so live play and catch-up still agree. The determinism and catch-up checks need their fixed hour counts updated, not their logic.
- **Thin seasons:** if a season feels empty at 14 days, the answer is more to see in it (rare phenomena in F08, more bloom variety), not shorter seasons again.

## Open questions

- ~~Should time away run at a quarter of watched time, or would a half or an eighth feel better?~~ Answered (Matt, October 19, 2026): a quarter.
- ~~Should the moon keep its 7-day cycle (two full moons a season) or stretch to one full moon per season?~~ Answered: keep the 7-day moon. Which of summer's two full moons the signature night takes (doc 24) stays open.
- ~~With twice as long in each season, should plants grow more slowly per hour, or is a fuller season welcome?~~ Answered: keep the growth rates; a fuller season is welcome. Next, look at where each plant caps out by a season's end and whether anything should recede across seasons (doc 10).
- Should speeding time up to 2x or 4x affect anything else, such as the music resting while time runs fast, or stay purely the player's choice?

## Depends on / feeds into

Depends on docs 02, 06, 07, 10, 13 and 18. Feeds F02 (farewell), F04 (deep clock) and F08 (rare phenomena), which all assume the 56-day year.
