<p align="center"><img src="brand/ebb-icon.svg" width="160" alt="ebb icon: a small green island at dusk with a crescent moon and a heron in the shallows"></p>

<h1 align="center">ebb</h1>
<p align="center"><em>a tended island</em></p>

A cozy idler and living diorama built on raw WebGPU. Shape a small island, plant seeds, and make room for creatures. They arrive and settle when the ecology suits them, and the island keeps growing while you are away. When you come back, it has moved on without you.

The look is soft and painted, but the light, sky and water underneath are physical. Everything grows from seeded recipes, so it can all be tuned without code.

## Status

Pre-build. The architecture docs are written, and the first target is the vertical slice described in [docs/20-roadmap-and-vertical-slice.md](docs/20-roadmap-and-vertical-slice.md).

## What's here

| Path | What it is |
|---|---|
| `CLAUDE.md` | Working rules for Claude Code sessions on this repo |
| `docs/` | 21 architecture docs, starting with [01 Vision and pillars](docs/01-vision-and-pillars.md). See the [docs index](docs/README.md) |
| `brand/` | Icon, favicon in all sizes, and the identity review page |

## Pillars

1. **Shape**: sculpt land and water. Every action can be undone.
2. **Grow**: plants, moss and lichen grow by real rules.
3. **Welcome**: creatures are attracted, never bought.
4. **Tend**: refine the ecology to make them happy.
5. **Return**: the island advances while you're away.

## Tech

- Raw WebGPU and WGSL, no engine
- Plain JavaScript ES modules, no build step
- Deterministic seeded simulation, with offline catch-up
- Desktop first; phones and tablets through WebGPU with quality tiers
- Hosted on GitHub Pages

## Running it

Once code exists, open `index.html` through any local static server, or visit the GitHub Pages site. A WebGPU-capable browser is required: Chrome, Edge, Firefox on Windows, or Safari 26 and later.
