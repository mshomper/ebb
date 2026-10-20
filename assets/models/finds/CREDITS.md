# Find model credits

Small models for the shore finds (docs/future/11), baked for ebb by a one-off script: textures
sampled into linear vertex colors, skins, animation and UVs dropped, simplified, and set base down
at a height of 1 (the game scales them in `recipes/species/finds.json`).

## Beadlet anemone: Low-Poly Anemone

This work is based on "Low-Poly Anemone" (https://sketchfab.com/3d-models/low-poly-anemone-ef8834fa2ed84432bf87b33c08e0ab6d, short link https://skfb.ly/6X9T8) by Ben Lebreux (https://sketchfab.com/ben.lebreux), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

- Changes: base color textures baked to vertex colors, skin and sway animation removed (posed at rest), unchanged triangle count (1,116), rescaled. The game also draws a shut pose by folding the tentacles into the column.
- Files: `anemone.gltf`, `anemone.bin`

## Young edible crab: Crab 3d Model Free

"Crab 3d Model Free" (https://skfb.ly/pMCrp) by iRahulRajput is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

- Changes: base color texture baked to vertex colors, simplified from 19,179 to 1,500 triangles, rescaled. The game moves it as a whole (it runs sideways away from you).
- Files: `edible-crab.gltf`, `edible-crab.bin`

## Hermit crab

- Source: "hermit crab" model, released as CC0 1.0.
- Changes: posed at rest (skin and animation removed), textures baked to vertex colors, simplified from 5,436 to 1,487 triangles, rescaled. The game moves it as a whole (it creeps about its pool).
- Files: `hermit-crab.gltf`, `hermit-crab.bin`

## Shells

Each is changed for ebb the same way: textures baked to vertex colors, parts joined, simplified, rescaled and set to lie as a shell lies on sand.

- "Turret Shell || Free Model" (https://sketchfab.com/3d-models/turret-shell-free-model-6f430977b6f44313b29a2a526d23200c) by CyberFox 3D Studio (https://sketchfab.com/cyberfox3d), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). 3,066 to 700 triangles. Files: `shell-turret.gltf`, `shell-turret.bin`.
- "shell fossil 3D Scan" (https://sketchfab.com/3d-models/shell-fossil-3d-scan-32cfd19452dd4080aea0157586e110f3) by Formwerk3D (https://sketchfab.com/Formwerk3D), licensed under CC-BY-4.0. Drawn as a fossil cockle; 700 triangles. Files: `shell-cockle.gltf`, `shell-cockle.bin`.
- "Murex Shell" (https://sketchfab.com/3d-models/murex-shell-fc5a13eb995044d6bfb7eb2a628cede7) by Loïc Norgeot (https://sketchfab.com/norgeotloic), licensed under CC-BY-4.0. 25,000 to 999 triangles. Files: `shell-murex.gltf`, `shell-murex.bin`.
- "Nautilus Shell" (https://sketchfab.com/3d-models/nautilus-shell-9b4acc4a177c41e984a0199c6fdcf90e) by RISD Nature Lab (https://sketchfab.com/RISDNaturelab), licensed under CC-BY-4.0. 397,722 to 998 triangles. Files: `shell-nautilus.gltf`, `shell-nautilus.bin`.
- The empty periwinkle shell reuses the periwinkle scan below, paler.

## Periwinkle: rough periwinkle scan (Littorina brevicula)

- Source: photo scan QS980-W10-1, copyright field "ffish.asia", released as CC0 1.0.
- Changes: one shell kept from the scene; texture baked to vertex colors; simplified from 991,033 to 900 triangles; normals made in the game; rescaled.
- Files: `periwinkle.gltf`, `periwinkle.bin`
