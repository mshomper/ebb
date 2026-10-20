// @ts-check
// Per-layer meters with solo and mute on the listening page: one row per ambience bed, plus the
// scattered one-shots and the creature voices. Text buttons only.

/** @type {Record<string, string>} */
const NAMES = {
  sea: 'Sea', air: 'Air', lap: 'Pond lap', trickle: 'Trickle', run: 'Stream run',
  reeds: 'Wind in reeds', grass: 'Wind in grass', wind: 'Open wind',
  rainWater: 'Rain on water', rainPads: 'Rain on lily pads', rainReeds: 'Rain on reeds', rainGrass: 'Rain on grass',
  drizzle: 'Drizzle', oneShots: 'Small sounds', falls: 'Waterfalls', creatures: 'Frogs and midges',
};

/**
 * @param {HTMLElement} host
 * @param {ReturnType<typeof import('../../src/audio/ambience.js').createAmbience>} ambience
 * @param {ReturnType<typeof import('../../src/audio/voices.js').createVoices>} voices
 */
export function createBedList(host, ambience, voices) {
  const names = [...ambience.names(), 'creatures'];
  /** @type {string|null} */
  let solo = null;
  const muted = new Set();
  /** @type {Map<string, {row: HTMLElement, bar: HTMLElement, db: HTMLElement, src: HTMLElement, solo: HTMLElement, mute: HTMLElement}>} */
  const rows = new Map();
  for (const n of names) {
    const row = document.createElement('div');
    row.className = 'bed';
    row.innerHTML = `<div class="name">${NAMES[n] ?? n} <small></small></div>
      <div class="meter"><div class="bar"><i></i></div><span class="db">off</span></div>
      <button type="button" class="solo" aria-pressed="false">Solo</button>
      <button type="button" class="mute" aria-pressed="false">Mute</button>`;
    host.appendChild(row);
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (row.querySelector(s));
    const r = { row, bar: q('.bar i'), db: q('.db'), src: q('.name small'), solo: q('.solo'), mute: q('.mute') };
    rows.set(n, r);
    r.solo.addEventListener('click', () => { solo = solo === n ? null : n; apply(); });
    r.mute.addEventListener('click', () => { if (muted.has(n)) muted.delete(n); else muted.add(n); apply(); });
  }

  function apply() {
    ambience.setSolo(solo === 'creatures' ? '__none__' : solo);
    for (const n of names) if (n !== 'creatures') ambience.setMute(n, muted.has(n));
    const creaturesOn = (solo ? solo === 'creatures' : true) && !muted.has('creatures');
    voices.output.gain.setTargetAtTime(creaturesOn ? 1 : 0, voices.output.context.currentTime, 0.05);
    for (const [n, r] of rows) {
      r.solo.setAttribute('aria-pressed', String(solo === n));
      r.mute.setAttribute('aria-pressed', String(muted.has(n)));
    }
  }

  return {
    clearSolo() { solo = null; apply(); },
    /** @param {boolean} started */
    refresh(started) {
      const lv = ambience.levels();
      lv.push({ name: 'creatures', db: voices.levelDb(), source: 'made in code', live: [] });
      for (const l of lv) {
        const r = rows.get(l.name);
        if (!r) continue;
        // Bars span -80 to -20 dBFS: the beds are mixed quietly.
        const x = started ? Math.max(0, Math.min(1, (l.db + 80) / 60)) : 0;
        r.bar.style.width = `${(x * 100).toFixed(1)}%`;
        r.db.textContent = !started || l.db < -100 ? 'off' : `${Math.round(l.db)} dB`;
        const seasons = l.live.filter((s) => s !== 'all');
        r.src.textContent = `${l.source}${seasons.length ? `, ${seasons.join(' and ')}` : ''}`;
        r.row.classList.toggle('quiet', !started || l.db < -90);
      }
    },
  };
}
