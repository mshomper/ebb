# Teal prep

Makes `assets/models/teal/teal.glb` (one bird) and `teal-flock.glb` (each bird of a flock) from Matt's `teal.glb` in `Documents\Ebb\_creatures`, where the bird stands on a rock fused into the same mesh. Run it again whenever Matt sends a new file. Needs Python 3 with numpy, scipy, pillow and xatlas (as `tools/figure-prep` does) and Node. From the repo root, in about 25 seconds:

```
python tools/teal-prep/make.py <teal.glb> assets/models/teal
```

## 1. Off the rock: `prep.py`

The feet melt into the rock with a smooth fillet: there is no crease to follow, and the baked shadow under the bird makes the rock as dark as the toes, so colour gives no clean edge either. So:

1. Every triangle crossing the level `CUT_Y` (just above the rock's top under the toes) is split there.
2. The bird is what lies above the cut and joins the legs (grown from everything above `BIRD_Y`). A pale chip of rock touching a toe (within `CHIP_H` of the cut, rock coloured by `WARM_ROCK` and `LUM_ROCK`) stays with the rock, and so does any bump of rock above the cut.
3. Each piece's holes are found as rims on the welded mesh and filled flat: ear-clipped in the hole's own plane, in one colour (a rim texel near the rim's median colour), so a fill never smears across texture islands.
4. Both pieces move by one offset: the bird's feet on y = 0, centred on the bird.

`make.py` runs it into a scratch folder; on its own it writes the full-detail bird and the rock (Matt dropped the rock, November 1, 2026):

```
python tools/teal-prep/prep.py <teal.glb> <folder> [folder for a report json]
```

## 2. The cut: `cut.mjs`

The game's quadric edge collapse (`src/world/mesh/decimate.js`, as the turnstone uses it) on the welded bird, each vertex's base colour riding along (`COLOUR_WEIGHT` in `make.py`) so colour edges keep their vertices. Sizes are `SIZES` in `make.py`: 3,000 triangles at a 1024 atlas, 1,200 at 512.

## 3. The maps: `tools/figure-prep/bake.py`

As for the walker: xatlas unwraps each cut bird into a fresh atlas, and each texel reads the full-detail bird's colour and normal map at the nearest point facing the same way. The normal is stored in object space (the creature shader reads it with no tangents; `extras.normalSpace` says so). The roughness and metal map is dropped: the creature pass never reads it.

## A look: `view.html`

A plain WebGL2 view of any GLB for model prep (not the game renderer). Open it through `play.cmd` or `tools/serve.ps1`:

- `view.html` shows `assets/models/teal/teal.glb` from the side.
- `?f=` another file (relative to the page), `yaw` and `pitch` in degrees (a positive pitch looks up from below), `zoom`, `at=x,y,z` to centre the view.
- `show=normal` paints the normal map instead of the colour, `flat=1` hides the texture, `backs=1` tints back faces pink, `cut=y` draws a red line at that height (how `CUT_Y` was chosen).
