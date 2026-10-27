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

Since October 27, 2026 (C1 and C3) the clips come from two of Matt's files on the same Meshy rig: `Ebb_Walker+Animations.glb` (in `Documents\Ebb\_assets`) and `The+Walker_Additional+Animations.glb` (in `Documents\Ebb\_walker`). Pass both, split by `;`; a clip is read from the first file that has it, against that file's own rest pose. The second file names its joints the Mixamo way (`mixamorig:Hips` and so on); `MIXAMO` at the top of the script reads them under the first file's names (the joint positions are the same to the millimetre; only their axes differ, which the per-file rest pose takes out).

There are two clip sets:

- `main` (the default): the walks, runs, roll and torch walks, plus `pull` (Pull_Radish), `collect` (Collect_Object) and `squat` (air_squat) for Lift with the shovel, gathering and kneeling on the island (`recipes/world/figure.json clips.shots`).
- `fight` (`--set fight`): the thirteen fighting clips (eleven from the additional animations file, and Throw and Point from `The+Walker_Toss_Point+Cast.glb`, a third file passed the same way; its two clips are unnamed ids, listed in `FIGHT`) in a file of their own, `assets/figures/walker-clips-fight.json`, so the game's walk load doesn't grow. Each is named by the pose it serves (`swingDouble`, `plantSlam`, `raiseCast` and so on; the table is `recipes/world/fight-clips.json`). Only tool pages load it until the move arena. `CLEAN` cleans Matt's Text-to-Animation pair cheaply: `smooth` (1-2-1 passes over the frames against jitter), `mirror` (left for right: the point is Meshy's lantern hand) and `unturn` (the hips' turn about the vertical taken out).

```
python tools/figure-prep/clips.py "<_assets>/Ebb_Walker+Animations.glb;<_walker>/The+Walker_Additional+Animations.glb" recipes/world/figure.json assets/figures/walker.glb assets/figures/walker-clips.json
python tools/figure-prep/clips.py "<same two files>" recipes/world/figure.json assets/figures/walker.glb assets/figures/walker-clips-fight.json --set fight
```

`src/world/figure/clips.js` plays any of them once over the walker (`shoot`), with a mask of the bones it takes: the fighting clips take the hips, spine, head, legs and right arm, and leave the left arm, which holds the lantern, to the code. `tools/walker-strip.html` shows each fighting clip masked beside Meshy's own, the staff in hand, and the island clips.

## The driftwood staff

Matt's two staves (`Ebb_Driftwood+Staves.glb`, one mesh) are split and cut down by `tools/assets/build-models.mjs` (the `part` option, `tools/assets/parts.mjs`: triangles sharing a corner are one piece) into `assets/models/camp/staff-slim.glb` and `staff-knotted.glb`, about 2,100 triangles each, 1.0 m long, foot at the origin, with the shared texture as 512 px WebP maps, the same way as the boat. `recipes/world/staff.json` holds the length, the grip and how the right hand holds it.
