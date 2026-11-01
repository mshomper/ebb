# Teal model credits

The Eurasian teal (B3, winter visitors to a reedy pond), modelled by Matt for ebb and delivered on November 1, 2026 as `Documents\Ebb\_creatures\teal.glb` (a Blender export: one mesh of 9,159 triangles with a baked material of three 2048 x 2048 PNG maps, colour, normal, and roughness and metal; no rig). The bird stood on a rock fused into the same mesh. The source stays in Matt's folder; only the game's copies are here.

## What was done to it

`tools/teal-prep/make.py` makes both files (see `tools/teal-prep/README.md`). Matt approved the cut to the creature budget on November 1, 2026 (option B), and dropped the rock.

- **Off the rock** (`prep.py`): the feet melt smoothly into the rock, so the mesh is cut level just above the rock's top under the toes. The bird is everything above the cut that joins the legs; the toes lose a sliver underneath and get flat, closed soles. Seven small holes the source had near the wing tips are closed. The bird stands with its feet on y = 0, centred, head toward +z. Units are as exported (the bird is 1.89 units long); the creature recipe sets the drawn size.
- **Cut to the budget** (`cut.mjs`, the game's quadric edge collapse, as for the turnstone): 3,000 triangles for one bird, 1,200 for each bird of a flock, keeping colour edges.
- **Maps baked anew** (`tools/figure-prep/bake.py`, as for the walker): a fresh atlas per file, baked texel by texel from the full-detail bird. Colour as an sRGB JPEG; the normal map turned from tangent space into object space, which is what the creature shader reads. The roughness and metal map is not carried (the creature pass never reads it).

## Files

- `teal.glb`: one bird, 3,000 triangles, 1024 x 1024 colour and normal maps, 0.95 MB.
- `teal-flock.glb`: each bird of a flock, 1,200 triangles, 512 x 512 maps, 0.32 MB.

## Licence

Made for ebb by Matt; no outside assets. Same licence as the rest of the game.
