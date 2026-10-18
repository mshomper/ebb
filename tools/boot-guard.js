// Tool pages: if a page's own module never starts, its status line stays at "Starting" forever.
// This plain (non-module) script runs even then and says why, in words Matt can act on. The usual
// causes: the page was opened as a file (double-clicked), which blocks modules, or the browser is
// holding an old copy of a page script.
(function () {
  const find = () => document.querySelector('#status, #verdict, .status');
  const say = (text) => {
    const el = find();
    if (el) el.textContent = text;
  };
  if (location.protocol === 'file:') {
    addEventListener('DOMContentLoaded', () => say('This page was opened as a file, so the browser blocks its scripts. Double-click play.cmd in the ebb folder, then open the tools from the page it shows (All tools).'));
    return;
  }
  addEventListener('load', () => {
    setTimeout(() => {
      const el = find();
      if (el && el.textContent.trim() === 'Starting') {
        say('This page has not started after 12 seconds. Reload it with Ctrl+Shift+R (Cmd+Shift+R on a Mac) to drop any old copy the browser kept. If it still waits, the island may be stuck: open the game in another tab and check it starts.');
      }
    }, 12000);
  });
})();
