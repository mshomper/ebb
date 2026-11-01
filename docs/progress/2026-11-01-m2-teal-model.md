# Teal model prep (m2-teal-model)

Status: Done

Matt's teal is off its rock and cut to the creature budget (his call, November 1, 2026). `tools/teal-prep/make.py` cuts his fused mesh level just above the rock's top under the toes, keeps everything above the cut that joins the legs as the bird with flat closed soles, cuts it with the game's quadric edge collapse, and bakes fresh colour and object-space normal maps from the full-detail bird: `assets/models/teal/teal.glb` (3,000 triangles, 1024 maps, 0.95 MB) for one bird and `teal-flock.glb` (1,200 triangles, 512 maps, 0.32 MB) for each bird of a flock. The rock is dropped. `tools/teal-prep/view.html` shows either file from any side. No rig, recipe or creature code yet: that is wave 3.
