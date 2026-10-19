# abcjs (vendored)

- Version: 6.7.2, the minified basic build `dist/abcjs-basic-min.js` only (notation rendering, no audio or CSS).
- Source: npm package `abcjs` (`npm pack abcjs@6.7.2`), https://github.com/paulrosen/abcjs, https://abcjs.net
- License: MIT, Copyright (c) 2009-2026 Paul Rosen and Gregory Dyke. Full text in `LICENSE.md`.

It is a UMD bundle. Load it as a classic `<script>` (it sets `window.ABCJS`); importing it as an ES
module does not work. `tools/music-lab/notation.js` injects the script tag itself and wraps it.
