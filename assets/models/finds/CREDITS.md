# Find model credits

Small models for the shore finds (docs/future/11), baked for ebb by a one-off script: textures
sampled into linear vertex colors, skins, animation and UVs dropped, simplified, and set base down
at a height of 1 (the game scales them in `recipes/species/finds.json`).

## Beadlet anemone: Low-Poly Anemone

This work is based on "Low-Poly Anemone" (https://sketchfab.com/3d-models/low-poly-anemone-ef8834fa2ed84432bf87b33c08e0ab6d, short link https://skfb.ly/6X9T8) by Ben Lebreux (https://sketchfab.com/ben.lebreux), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

- Changes: base color textures baked to vertex colors, skin and sway animation removed (posed at rest), unchanged triangle count (1,116), rescaled. The game also draws a shut pose by folding the tentacles into the column.
- Files: `anemone.gltf`, `anemone.bin`

## Periwinkle: rough periwinkle scan (Littorina brevicula)

- Source: photo scan QS980-W10-1, copyright field "ffish.asia", released as CC0 1.0.
- Changes: one shell kept from the scene; texture baked to vertex colors; simplified from 991,033 to 900 triangles; normals made in the game; rescaled.
- Files: `periwinkle.gltf`, `periwinkle.bin`
