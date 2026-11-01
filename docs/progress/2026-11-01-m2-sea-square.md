# The darker square of sea (m2-sea-square)

Status: Done

The hard-edged, darker square of sea around the island is gone. Inside the opened area the water showed the real terrain under it, shaded with its ground texture and cavity; past it, a flat stand-in floor of plain wet sand, brighter by about a half. Now, where the terrain is just the flat open floor, it fades to the stand-in over its last half metre of height (`openFloorFadeM`), so the edge has nothing to show, and shore slopes keep their real ground. The stand-in's albedo is scaled to match the shaded terrain where they meet (`openFloorAlbedo` 0.6, measured at midday with a temporary comparison view; at night the match is about 0.5, too dark to show). The open sea reads a little deeper as a result, and the soft dark ring that the first experiment left round the shore is gone too. Render only: determinism stays C43ABA37. Checked at midday, dusk and night from above, from the walker, and round the meadow islet.
