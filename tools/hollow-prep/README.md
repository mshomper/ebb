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
