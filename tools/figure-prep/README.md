# Figure prep

Makes the walker's figure (doc 23, W5) from Matt's source files. Run them again whenever the model or the clips change; the game and `tools/walker-figure.html` read the results.

## The model and its texture: `prep.py`

Makes `assets/figures/walker.glb`.

Sources:

- the Meshy textured model (`Ebb_Walker_Updated+Textures.glb` in `Documents\Ebb\_assets`), which holds the colours and the normal map
- the nTop split of the A-pose model, three OBJ files in tenths of a metre: the body (`body_split.obj`) and each arm (`left+arm_split.obj`, `right+arm_split.obj`)

Since October 26, 2026 the sources are Matt's clean split in `Documents\Ebb\_walker`: `walker_body+only.obj` (no arms, pack or hat), `walker_left+arm_clean.obj`, `walker_right+arm_clean.obj`, `walker_pack.obj` and `walker_hat.obj`, same units and A-pose. With `--pack` and `--hat` each becomes its own mesh in the GLB (labelled pack and hat whole), so the pack folds away under another carrier with nothing left behind, and the hat can be swapped later. The coat where the pack sat takes the coat's own colour from its sides (the textured model has the pack painted there). Run `clips.py` again after, since the arms' shoulders move with the arms.

What it does: carries the textured model's colours onto every vertex of the split meshes (linear albedo), turns each arm down onto the old sleeve to find its colour, gives the gloves their leather, paints the old eye ovals over (the shader draws the eyes), stands the figure on y = 0, labels each body vertex with its part for the rig's skin weights, and records each arm's shoulder and axis.

Then `bake.py` (October 26, 2026) unwraps the body and arms with xatlas into one 2048 atlas and bakes, texel by texel, the textured model's colour and normal map (the arms sampled where they were turned onto the sleeves). The face keeps its vertex colours exactly as before, the gloves keep theirs, and the hat takes the texture's tan. The colour map (sRGB JPEG) and the normal map (object space in the rest pose, JPEG) are embedded in the GLB with a UV per vertex. Takes about a minute.

Needs Python 3 with numpy, scipy, pillow and xatlas (`pip install xatlas`, MIT licence; used only here, nothing of it ships in the game). From the repo root:

```
python tools/figure-prep/prep.py <meshy textured .glb> <body .obj> <left arm .obj> <right arm .obj> assets/figures/walker.glb [folder for still images of the two maps] --pack <pack .obj> --hat <hat .obj>
```

## The clips: `clips.py`

Makes `assets/figures/walker-clips.json` from Meshy's rigged file with its clips (`Ebb_Walker+Animations.glb`). Nothing of Meshy's mesh is used: only how its bones turn, retargeted onto our 20 bones (the table is at the top of the script). It needs our rig, so run it after `prep.py`. More clips made on the same Meshy rig (an idle, kneel and pick up, sit, dig) drop in by adding a line to `CLIPS`.

```
python tools/figure-prep/clips.py <Meshy rigged .glb with clips> recipes/world/figure.json assets/figures/walker.glb assets/figures/walker-clips.json
```
