# Texture credits

Ground detail maps for ebb (docs/22-ground-detail.md), made with tools/texture-lab.html from CC0 1.0 photo scans on Poly Haven. CC0 asks for no credit; this file thanks the authors and records what we changed.

## Grass: Grass Ground

- Source page: https://polyhaven.com/a/grass_ground
- Original asset: Grass Ground (`grass_ground`), maps diff, nor_gl, rough, disp, ao at 1k
- License: CC0 1.0
- Changes: albedo delit (heavily blurred luminance divided out at strength 0.7), recalibrated so its linear mean equals the recipe albedo [0.16, 0.26, 0.12] from recipes/world/terrain.json and clamped to 0.04..0.9; height stretched to 0..1 (0.5th to 99.5th percentile); repacked into a.webp (albedo), b.webp (normal X, Y and roughness), c.webp (height and cavity); resized to 512 for the low tier.
- Files: assets/textures/ground/grass/

## Sand: Aerial Beach 01

- Source page: https://polyhaven.com/a/aerial_beach_01
- Original asset: Aerial Beach 01 (`aerial_beach_01`), maps diff, nor_gl, rough, disp, ao at 1k
- License: CC0 1.0
- Changes: albedo delit (heavily blurred luminance divided out at strength 0.6), recalibrated so its linear mean equals the recipe albedo [0.62, 0.52, 0.38] from recipes/world/terrain.json and clamped to 0.04..0.9; height stretched to 0..1 (0.5th to 99.5th percentile); repacked into a.webp (albedo), b.webp (normal X, Y and roughness), c.webp (height and cavity); resized to 512 for the low tier.
- Files: assets/textures/ground/sand/

## Rock: Dry Riverbed Rock

- Source page: https://polyhaven.com/a/dry_riverbed_rock
- Original asset: Dry Riverbed Rock (`dry_riverbed_rock`), maps diff, nor_gl, rough, disp, ao at 1k
- License: CC0 1.0
- Changes: albedo delit (heavily blurred luminance divided out at strength 0.5), recalibrated so its linear mean equals the recipe albedo [0.36, 0.34, 0.31] from recipes/world/terrain.json and clamped to 0.04..0.9; height stretched to 0..1 (0.5th to 99.5th percentile); repacked into a.webp (albedo), b.webp (normal X, Y and roughness), c.webp (height and cavity); resized to 512 for the low tier.
- Files: assets/textures/ground/rock/

## Soil: Dirt Aerial 03

- Source page: https://polyhaven.com/a/dirt_aerial_03
- Original asset: Dirt Aerial 03 (`dirt_aerial_03`), maps diff, nor_gl, rough, disp, ao at 1k
- License: CC0 1.0
- Changes: albedo delit (heavily blurred luminance divided out at strength 0.6), recalibrated so its linear mean equals the recipe albedo [0.21, 0.15, 0.1] from recipes/world/terrain.json and clamped to 0.04..0.9; height stretched to 0..1 (0.5th to 99.5th percentile); repacked into a.webp (albedo), b.webp (normal X, Y and roughness), c.webp (height and cavity); resized to 512 for the low tier.
- Files: assets/textures/ground/soil/
