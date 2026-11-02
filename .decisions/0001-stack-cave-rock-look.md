# 0001 How should the stack's mouth room get rock that reads as stone?

- Status: decided
- Date: 2026-11-02, decided 2026-11-02
- Lenses: ui, architecture
- Settles: procedural cave rock look = stone forms (terraced ledges, rock-sphere detail layer, Voronoi joints) in the signed distance field at mesh scale; the photographed rock scan, triplanar and scaled by its mean, for fine grain

## Decision

**B: Stone forms in the field, texture on top.** Give the room's field stone shapes at the current mesh size: flat bedding ledges and floor slabs (terraced), faceted boulder bulges (a stacked-rocks layer that keeps the field a true distance), shallow joint grooves, and a rougher ceiling. Then add the cliffs' triplanar rock texture for the fine grain, and rebuild the rubble as real stones that take the lantern's shadow and the scan, with no outline.

## Context

F19's mouth room was passed for now, with its polish left for later: the walls read as smoke, the floor as rolling dunes, and the rubble as flat outlined shapes. The cause is in the code. The walls get only two soft noise octaves and a faint shader bump, with no texture. The floor is one smooth noise octave. The rubble stones are faceted balls with flat colour and an outline, and they get no shadow or occlusion. The way this is fixed sets how the spring cave and the Hollow's rooms will look too, since they share the same field and shader.

## Options

### A: Detail in the shader only

Keep the room's shape as it is. Paint the cliffs' photographed rock onto it with triplanar mapping (albedo and normal), add a baked crease darkening and a wet sheen near the floor, and rebuild the rubble's shading.
- Pro: The smallest change: no new mesh, no change to walking or to the baked lantern light.
- Pro: The rock matches the cliff outside, since it uses the same photographed texture and the same palette scaling as the pieces pass.
- Pro: Cheap at run time: about six texture reads a pixel for albedo and normal.
- Con: The outlines stay blobby. Shader detail never changes silhouettes or shadows, and the smoke read comes mostly from the soft shapes.
- Con: The floor still rolls like dunes. A texture on a dune is a textured dune.
- Con: Triplanar blending can show smears on diagonal faces.
- Effort: About 2 to 3 days of code.
- Assumes: The cliffs' rock scan reads well up close at 1 to 3 m, as it does on the cave mouth's outside.
- Assumes: Crease darkening can be baked from the field into the vertex colour beside the lantern's baked sight.
- Risk: It looks better but still soft, and a second polish pass is needed later anyway.
- Risk: Photo colour fights the palette rule unless it is scaled by the scan's mean, as the pieces pass already does.
- Estimate, Code: 2 to 3 days (basis: triplanar scan port from piece-draw.wgsl (1 day), baked creases (half a day), rubble shading and wet floor (1 day))
- Estimate, Frame cost: about 6 extra texture reads a pixel (basis: 3 projections for albedo and 3 for normal)

### B: Stone forms in the field, texture on top (chosen) (recommended)

Give the room's field stone shapes at the current mesh size: flat bedding ledges and floor slabs (terraced), faceted boulder bulges (a stacked-rocks layer that keeps the field a true distance), shallow joint grooves, and a rougher ceiling. Then add the cliffs' triplanar rock texture for the fine grain, and rebuild the rubble as real stones that take the lantern's shadow and the scan, with no outline.
- Pro: Fixes all three problems at their cause: the walls get ledges and edges, the floor gets slabs and sand pockets, and the rubble becomes stones.
- Pro: The rubble joins the lantern's light: it casts and takes shadow and loses the cartoon outline.
- Pro: The same field helpers serve the spring cave and the Hollow's rooms later, so the work pays back.
- Pro: No new art from you: it is all procedural, tuned through recipes/world/stack-mouth.json.
- Con: Edges stay a little rounded at the 12 cm mesh size. Truly crisp cracks need a finer mesh or a different mesher, which this option does not include.
- Con: A richer field costs more to build: the room's mesh, built in a worker on entering, takes longer.
- Con: The walk surface changes, so the walking checks and the lantern spots need checking again.
- Effort: About 3 to 4 days of code.
- Assumes: Forms of 20 cm and up read at the current 12 cm cell, and the triplanar texture carries everything finer.
- Assumes: The worker build stays short enough on entering (time it before and after; the room now builds in the zone's fade).
- Risk: Terraced and ridged shapes under the mesher can make stair-steps and slivers. Smoothing them back with soft blends brings the softness back, so the blend widths need tuning.
- Risk: The baked lantern sight must be rebaked on the new shape, and walking must still clear the new ledges.
- Estimate, Code: 3 to 4 days (basis: field forms: terraces, rock layer, joints (1.5 days); triplanar scan port (1 day); rubble as lit stones, no outline (half a day); retune and walk checks (half a day))
- Estimate, Room build time: about 3 to 10 times today's (basis: each field sample gets several more noise and Voronoi evaluations at the same grid size)
- Estimate, Triangles: about the same as today (basis: the mesh size stays 12 cm)

### C: A sculpted interior from you

You sculpt the room's inside as one model, with its normal and occlusion baked, and export it as a glb, as you did for the cave mouth's outside. The game draws your model with the cliffs' rock texture, and keeps the field only for walking and the lantern's light.
- Pro: The best look: real sculpted stone, with crisp edges and baked detail exactly where you want it.
- Pro: Your eye sets the room, as with the cave mouth's outside.
- Pro: One small room costs little to draw: about 20,000 to 40,000 triangles.
- Con: Your time: a sculpt, a decimate, UVs and a bake before any code.
- Con: Walking and the model can drift apart: feet float or sink where the model leaves the field by more than 5 to 10 cm.
- Con: It does not carry to the Hollow's rooms, which are procedural, so their rock still needs the field route later.
- Effort: About 8 to 16 hours of your time, plus 1 to 1.5 days of code.
- Assumes: You want to make it, and the room's layout (the arch, the rubble passage, the hook, the pool) stays where the code puts it.
- Assumes: The model can be fitted to within 5 to 10 cm of the walking field, or walking switches to the model's own surface.
- Risk: The baked occlusion fights the physically computed light if used as colour. It has to be occlusion only.
- Risk: Any later change to the room's layout means a new sculpt.
- Estimate, Your time: 8 to 16 hours (basis: sculpt, decimate or retopo, UVs, normal and occlusion bake, glb export)
- Estimate, Code: 1 to 1.5 days (basis: load the glb into the cave pass, sample its maps, align to the field, check walking)
- Estimate, Memory: about 10 to 20 MB (basis: 20,000 to 40,000 triangles and 2k normal and occlusion maps)

## Evidence

- Bump and normal detail never change silhouettes or shadows; only real geometry does. [A, B] ([Bump mapping (Wikipedia)](https://en.wikipedia.org/wiki/Bump_mapping))
- Triplanar mapping blends three axis projections by the normal, about three texture reads per map, and needs no stored tangents. [A, B, C] ([GPU Gems 3, ch. 1: Generating Complex Procedural Terrains Using the GPU](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-1-generating-complex-procedural-terrains-using-gpu))
- Stacking octaves of hashed rock-like spheres with smooth max and min gives faceted boulder detail while the field stays a true distance, unlike adding plain noise. [B] ([Inigo Quilez, FBM detail in SDFs](https://iquilezles.org/articles/fbmsdf/))
- A terrace curve keeps most of each step flat and rises steeply between them: the shape of bedding ledges and floor slabs. [B] ([noise crate, Terrace modifier source](https://docs.rs/crate/noise/0.8.1/source/src/noise_fns/modifiers/terrace.rs))
- Even-width crack lines come from a corrected Voronoi edge distance, suited to rock joints. [B] ([Inigo Quilez, voronoi edges](https://iquilezles.org/articles/voronoilines/))
- Deep Rock Galactic carves rooms from simple shapes and roughens them with a different noise per biome (sharp ridges in one, eroded walls in another). [B] ([Below Decks at Ghost Ship: Cave Generation in Deep Rock Galactic (community repost)](https://devtrackers.gg/deep-rock-galactic/p/8cd5ca9c-below-decks-at-ghost-ship-cave-generation-in-deep-rock-galactic))
- Organic caves built from modelled pieces still need free pieces on top and lighting to hide joins; seams and repeated detail are the main risks. [C] ([Skyrim's Modular Approach to Level Design (GDC 2013 write-up)](https://www.gamedeveloper.com/design/skyrim-s-modular-approach-to-level-design))
- Baking normal and occlusion maps from a high sculpt onto a low mesh is built into Blender. [C] ([Render Baking, Blender Manual](https://docs.blender.org/manual/en/latest/render/cycles/baking.html))
- The cliffs' photographed rock already exists as a texture array and is sampled triplanar in piece-draw.wgsl, scaled by its mean so the palette still sets the colour; the cave pass binds no textures today and could take the same maps. [A, B, C] (Claude's judgment)
- The smoke read comes mostly from the field: two soft noise octaves on the walls (0.9 and 3.6 cycles a metre), one on the floor, and rubble as faceted balls with outlines and no shadow. [A, B] (Claude's judgment)

## Recommendation

B (lean). Only real shape changes the smoke read, and B fixes the walls, the floor and the rubble at their cause with no art time from you. The work also carries to the spring cave and the Hollow.

What would change this: If you would rather sculpt this one room yourself and want it crisper than procedural shapes give at a 12 cm mesh, C wins. If the richer field makes entering the room slow (more than about a second of build), B shrinks back toward A plus a lighter set of forms.

## Build brief

Files:
- `src/world/spring/cave-field.js`: add shared stone-form helpers: a terrace curve for bedding ledges and floor slabs, a stacked rock-sphere detail layer joined with smooth max and min (stays a true distance), Voronoi edge grooves for joints; floorAt gets slabs and sand pockets in place of the one smooth octave
- `src/world/stack/mouth-field.js`: mouthShape uses the new forms for the chamber, ceiling and passages; numbers from the recipe; rebake the lantern sight and occlusion on the new shape
- `src/render/passes/cave.js`: bind the ground-detail texture arrays (views a and b) and their sampler in the rock layout, as the pieces pass does
- `src/shaders/cave-draw.wgsl`: port scanRead from piece-draw.wgsl: triplanar cliff layer on the sides and rock layer on top, albedo scaled by the scan mean, normal blended; keep the sin-noise bump only as a faint extra; things get the scan too
- `src/world/stack/mouth.js`: rubble as real stones: lumped stones with their own normals, given the baked lantern sight and occlusion, written as rock (normal group 0) so they lose the outline
- `recipes/world/stack-mouth.json`: every new number: terrace step and sharpness, rock layer octaves and size, joint spacing and depth, slab size, scan tile and strength
- `tools/unit-tests-stack.js`: tests: the field stays a usable distance (gradient near 1), the floor has flat slabs within a tolerance, rubble vertices carry sight and occlusion, mesh build time within budget

Steps:
1. Time the current mouth mesh build in the worker and note its triangle count (the baseline).
2. Add the stone-form helpers in cave-field.js and switch the mouth room's walls, ceiling and floor to them, at the same 12 cm cell.
3. Rebake the lantern sight and occlusion; check walking clears the new ledges and the lantern spots, hook and note still sit right.
4. Bind the rock scan in the cave pass and port the triplanar read into cave-draw.wgsl.
5. Rebuild the rubble as lit, outline-free stones with the scan.
6. Tune in the game with screenshots at day and at night with the lantern hung (?stack=mouth, ?stack=lamp&hour=22); send them to Matt before handing over.
7. Leave the spring cave's look as it is unless the shared helpers change it; if they do, check its screenshots too.

Done when:
- Side by side with today's shots, the walls show ledges and edges, the floor shows slabs and sand pockets, the rubble reads as stones with shadows and no outline.
- The rock up close matches the cliff texture outside the cave mouth.
- Entering the room stays within the zone's fade (mesh build under about one second).
- Typecheck at 0, affected tests pass, determinism unchanged (the room is live only).

Validation:
- node tools/run-tests.mjs --affected and node tools/typecheck.mjs.
- Screenshots in the game at the same camera spots as stack-cave-shots-2026-11-02, checked by Claude before they reach Matt.
- Build time logged before and after.

Avoid:
- Plain noise added onto the distance field (breaks distances and the baked soft shadows); use the rock-sphere layer.
- Smooth blends so wide they round the ledges back into blobs.
- Painting colour into the rock to fake the style; the palette stays at the tonemap.
- Shrinking the mesh cell or switching mesher; that was left out of this option.
- Changing the room's layout (arch, rubble passage, hook, pool) or the walking rules.
