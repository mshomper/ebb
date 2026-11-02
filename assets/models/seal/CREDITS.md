# Seal model credits

The grey seal (B3 wave 3), made by Matt and supplied on October 30, 2026, as three OBJ parts (`seal_body.obj`, `seal_eyes.obj`, `seal_jaw.obj` in his `Documents\Ebb\_creatures` folder). His files are kept there as he made them; these are the game's copies.

- **seal-body.obj:** a game copy of the body cut from 28,460 to 6,000 triangles by `tools/decimate-obj.mjs` (quadric edge collapse), with Matt's go of November 1, 2026. Positions only, no UVs or normals, as his file.
- **seal-eyes.obj, seal-jaw.obj:** copied as he made them (1,404 and 274 triangles).
- The game turns the model head toward +z, scales it to 2.0 m (the pup to 0.95 m), rigs it in code with eleven bones and paints its coat in the shader (`src/world/seals/model.js`, `src/shaders/seal-draw.wgsl`).
- Licence: Matt's own work, made for ebb.
