# The type check at zero (claude/typecheck-sort-0afbe8)

Status: Done

All 344 type errors left after the typecheck-18 branch were read one by one and sorted: 6 real bugs, 139 type notes behind their code, and 199 places the checker could not follow. The six bugs are fixed, each with a test. A lantern's pouch card no longer fails to draw on foot. The walker holds the pot in both arms again: the raised-lantern control had taken the same name. The gift stone glows on hover like every other camp prop. The raft icon has one drawing, the bundled reeds you already saw. The gather lab shows nettle tops in spring and autumn. A test now stops any plant from relying on the "waits for its land piece" rule until something sets it.

Everything else is type notes and checker hints, with no change to how the game behaves. The baseline is now 0, so any new type error shows up on the branch that adds it. The determinism check still reads C43ABA37 and every row on its page matches.
