# Hollow prep

Makes the Hollow's foes from Matt's source files (doc 16, the bestiary). Run again whenever a model changes; `tools/hollow-foes.html` and the move arena read the results.

## The soot mote: `mote.py`

Makes `assets/models/hollow/mote.glb` from `Documents\Ebb\_enemies`:

- `mote_body.obj`: Matt's own decimation (13,856 triangles), Z up, eyes facing +X. Used as it is: no further cut and no normal map, only smooth normals.
- `mote_eyes.obj`: two eye discs. They aren't kept as geometry. Each becomes a placement for the shader's eyes (`src/shaders/lib-mote.wgsl`): its middle carried along its axis onto the body's surface, its axis and its radius, in the GLB node's extras.

It turns the model Y up and facing +Z, centres it on its bounds, scales it to `foes.motes.mote.sizeM` across (`recipes/world/hollow.json`, 20 cm) and gives it the recipe's soot albedo. Needs Python 3 with numpy. From the repo root:

```
python tools/hollow-prep/mote.py <mote_body.obj> <mote_eyes.obj> assets/models/hollow/mote.glb
```

The drawn size follows the recipe live, so a new `sizeM` needs no new prep unless you want the GLB itself to match.

## One scale for every enemy

Matt's nTop enemy space is to scale across the enemies. `recipes/world/hollow.json` enemySpace.mPerUnit is metres per nTop unit (0.00406715, the factor that makes the mote 20 cm across). Every prep script scales by it.

## The silt crawler: `crawler.py`

Makes `assets/models/hollow/crawler.glb` from the four `silt+crawler_*.obj` files in `Documents\Ebb\_enemies` (body, forelegs, hindlegs, tail), used as they are. It turns them Y up and facing +Z, scales them by enemySpace.mPerUnit, puts the origin on the ground under the body, and writes the rig in code: 16 bones (root, body, two eye stalks, a hip and a knee each leg, four tail bones) with their pivots found from the meshes, and skin weights (each leg blending hip to knee across its middle, the tail bone to bone, the stalks out of the body). There are no textures, because the OBJs have no UVs. Instead, COLOR_0 marks the shell plate, the underside and the eye knobs, and `_SURFACE` carries Matt's modelled cobbles, found from the plate's concavity (how far down in a seam, each cobble's shade), for `src/shaders/lib-crawler.wgsl`. The prep numbers are `foes.lunger.crawler.prep`. Needs Python 3 with numpy. From the repo root:

```
python tools/hollow-prep/crawler.py <folder with the four OBJs> assets/models/hollow/crawler.glb
```

## The hagstone watcher: `watcher.mjs`

Makes `assets/models/hollow/watcher.glb` from a signed field, not from Matt's files (the orchestrator's draft 2, approved by Matt on October 27, 2026). Matt's `hagstone+watcher_*_draft.obj` files in `_enemies` are the same model in his nTop space, for reference only. Every number is in `recipes/world/hollow.json` foes.watcher.stone.prep.

- `watcher-field.mjs`: the shape and colours. A lopsided, flattened pebble with an off-centre hole whose rim flares toward the faces, a barnacle crust on the lower left only, four flat wrack blades and the albedo (pale banded stone, lichen on top, chalky barnacles, a darker worn rim, olive-brown weed lighter at the tips). Seeded by the draft's own small generator, so the approved look stays exactly the same.
- `decimate.mjs`: quadric edge collapse. The field is meshed at prep.cellM (5.5 mm, about 135k triangles) by the repo's surface nets and cut to prep.targetTris (15,000), so the barnacles keep their shells while the smooth pebble is cut hardest.
- `atlas.py`: xatlas unwraps the cut stone; the script carries each texel back onto the fine field and bakes the albedo (sRGB) and the field's own normals (object space, rest pose) into prep.textureSize maps, embedded as JPEGs.
- Then the rig: a root at the stone's middle and each blade a chain of prep.blades.bones bones, with the stone all on the root (it is rigid) and each blade blended along its chain. The hole's middle, radius and flare go in the node's extras, for `src/shaders/lib-watcher.wgsl`.

Needs Node, and Python 3 with numpy, pillow and xatlas. About 20 seconds. From the repo root:

```
node tools/hollow-prep/watcher.mjs assets/models/hollow/watcher.glb [folder for the before-and-after OBJs and the two maps]
```
