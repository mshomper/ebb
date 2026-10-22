# Camp models

Web copies of Matt's camp piles, made from his source files (not kept in the repo). The game reads them with `src/render/gltf.js` (`readGlb`, `meshesByName`).

| Output | Source | Triangles (source → web) | Vertices | Texture | Size |
| --- | --- | --- | --- | --- | --- |
| `stick-pile.glb` | `Ebb_Log+Pile.glb` (47 MB) | 16,582 → 5,999 | 8,355 | 512 px JPEG base color | 442 KB |
| `stone-pile.glb` | `Ebb_Stones.glb` (48 MB) | 16,677 → 7,267 | 11,727 | 512 px JPEG base color | 595 KB |

Each file is one mesh, one primitive: `POSITION`, `NORMAL`, `TEXCOORD_0` (float) and `COLOR_0` (linear float RGB, baked from the base color map, area averaged), indexed, attributes in separate tightly packed buffer views, no extensions. The 4096 px PNG normal and metallic-roughness maps are dropped; the base color map is kept at 512 px for a future textured path (the current reader does not use images).

Units are meters, Y-up. The sources are centered on their bounding box; the web copies are moved so the base sits on y = 0 and the footprint is centered on x = z = 0. Not rescaled.

- stick pile: 1.89 × 1.17 × 1.36 m (x × y × z)
- stone pile: 1.69 × 0.91 × 1.77 m

How: Node with `@gltf-transform/core`, `@gltf-transform/functions`, `meshoptimizer` and `sharp`, in a scratch folder outside the repo:

1. drop normal, metallic-roughness, occlusion and emissive maps; roughness 1, metallic 0
2. `weld` (tolerance 0.0001), then `simplify` with the meshopt simplifier to about 6,000 triangles (error cap 0.01)
3. bake `COLOR_0`: sample the base color map (resized to 1024 px, sRGB to linear) at six points per triangle, area weighted onto its corners
4. resize the base color map to 512 px JPEG (quality 82)
5. translate to base on y = 0, footprint centered
6. `prune`, `dedup`, write with the separate vertex layout
