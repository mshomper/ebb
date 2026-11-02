# Shaping the meadow islet (m2-islet-brushes)

Status: Done

Matt found while testing that no brush worked on the meadow islet: Paint, Raise, Lower and the rest faded out at the edge of the island's original square of land, which the islet lies beyond. Once the islet has risen, the brushes now reach it and its sandbar (every cell whose final ground stands above -1.2 m, `recipes/land/meadow-islet.json` `brushes.floorM`), as doc 13 says. The open sea round it, outside the island's old square, stays as it is, so the bar stays the way across. The camp pad and the stack's no-build ring are guarded as before.

A chunk of the islet you brush is saved with its heights and paint (marked `raised`), and on a load it is put back and the islet writes around it, so a lowered spot stays lowered. A chunk only the rise drew is not saved; it regrows from the seed as before. Older saves load unchanged.

Found on the way: the brushes' guard texture was written as 1 in an 8-bit texture, which the shader reads as 1/255, under its 0.5 cut-off, so it never held anything on the graphics card; the Steps and the stack ring were kept only by their put-back after each stroke. It is now written as 255. A unit test (`islet-brushes`) covers the save.
