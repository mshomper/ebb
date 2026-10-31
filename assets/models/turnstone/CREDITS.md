# Turnstone model credits

The ruddy turnstone (B3, autumn and winter shore birds), made for ebb in code on October 31, 2026. Matt's call (October 30): sessions make the turnstone, the purple sandpiper and the eel; he makes the teal and the seal.

## How it is made

There is no model file. The turnstone is built each time the game or a lab loads it, from its recipe and the small-bird rig, so the same recipe always gives the same mesh:

- **Shape:** `recipes/birds/turnstone.json` `shape`, real metres (a real turnstone is about 0.23 m long), head toward +z, feet on y = 0. Drawn at `displayScale` 2.8, about 0.64 m (the findable scale).
- **Generator:** `src/world/creatures/bird-model.js`. The body, breast, neck, head, wedge bill, tail, eyes, feathered thighs, bare legs and toes are blended signed-distance pieces, baked to triangles by surface nets (`src/world/creatures/body-bake.js`) and skinned to the rig's bones by each piece's pull. Each wing is two flat panels baked on their own and skinned whole to their bone, so the wing can telescope open.
- **Rig and motion:** `src/world/creatures/bird-rig.js` (fifteen bone roles, the leg reach, the telescoping wing) and `src/world/creatures/bird-motion.js` (the code clips). See `tools/shore-birds-lab.html`.
- **Plumage:** linear albedo per vertex from the recipe's `plumage` (winter first, breeding for spring): a part colour, mottled upperparts, and marks (the dark breast band, the pale throat, the white back patch, the wing bar, the dark wing tips). No palette colour is painted in; the palette is applied at the tonemap.

## Licence

Made for ebb; no outside assets, references traced or third-party files. Same licence as the rest of the game.
