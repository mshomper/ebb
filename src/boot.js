// @ts-check
// The first module index.html runs. ebb is made for a desktop or laptop with a mouse and keyboard
// (October 21, 2026): on a touch-first device it shows a gentle notice (src/ui/desktop-only.js)
// and nothing of the game loads, so no WebGPU and no audio. Otherwise it loads src/main.js.

import { isTouchFirst, showDesktopOnly } from './ui/desktop-only.js';

if (isTouchFirst()) showDesktopOnly();
else import('./main.js');
