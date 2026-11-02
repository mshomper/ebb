# Purple sandpiper model credits

The purple sandpiper (B3, winter shore birds), made for ebb in code on November 1, 2026, from the turnstone's recipe. Matt's call (October 30): sessions make the turnstone, the purple sandpiper and the eel; he makes the teal and the seal.

## How it is made

There is no model file. The sandpiper is built each time the game or a lab loads it, from its recipe and the small-bird rig, so the same recipe always gives the same mesh:

- **Shape:** `recipes/birds/purple-sandpiper.json` `shape`, derived from the turnstone's (`recipes/birds/turnstone.json`) by `tools/sandpiper-prep/derive.mjs`: the body a little lower on shorter legs, a longer bill drooping slightly at the tip (two pieces, bending at `bill.mid`). Real metres (a real purple sandpiper is about 0.21 m long), head toward +z, feet on y = 0. Drawn at `displayScale` 2.8, about 0.59 m (the findable scale).
- **Generator:** `src/world/creatures/bird-model.js`, the same as the turnstone's: blended signed-distance pieces baked by surface nets and skinned to the rig's bones, two flat wing panels a side, then cut by quadric edge collapse (`src/world/mesh/decimate.js`) to the turnstone's budget: `bake.maxTris` 3,000 for a single bird, `bake.flockTris` 1,196 for a flock bird.
- **Rig and motion:** `src/world/creatures/bird-rig.js` (fifteen bone roles) and `src/world/creatures/bird-motion.js`: the turnstone's clips plus a creep, a bob and a tucked roost. See `tools/shore-birds-lab.html?bird=purple-sandpiper`.
- **Plumage:** winter only, linear albedo per vertex: slate grey with a purple cast above and pale scaly fringes, a grey streaked breast fading into a pale belly, a pale eye ring, a dark bill with a yellow-orange base, short yellow-orange legs. No palette colour is painted in; the palette is applied at the tonemap.

## Licence

Made for ebb; no outside assets, references traced or third-party files. Same licence as the rest of the game.
