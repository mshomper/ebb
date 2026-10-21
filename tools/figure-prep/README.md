# Figure prep

Makes `assets/figures/walker.glb`, the walker's figure (doc 23, W5), from Matt's source files. Run it again whenever the model changes; the game and `tools/walker-figure.html` read the result.

Sources:

- the Meshy textured model (`Meshy_AI_Ebb_the_Walker_1021143224_texture.glb`), which holds the colours
- the nTop split of the A-pose model, three OBJ files in tenths of a metre: the body (`body_split.obj`) and each arm (`left+arm_split.obj`, `right+arm_split.obj`)

What it does: carries the textured model's colours onto every vertex of the split meshes (linear albedo), turns each arm down onto the old sleeve to find its colour, gives the gloves their leather, paints the old eye ovals over (the shader draws the eyes), stands the figure on y = 0, labels each body vertex with its part for the rig's skin weights, and records each arm's shoulder and axis.

Needs Python 3 with numpy, scipy and pillow. From the repo root:

```
python tools/figure-prep/prep.py <meshy textured .glb> <body .obj> <left arm .obj> <right arm .obj> assets/figures/walker.glb
```
