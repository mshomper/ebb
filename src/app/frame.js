// @ts-check
// The frame loop: clock, camera, walker, zones, rings and marks, light, uniforms, the sim and the draw.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { flushDeferred, emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { edgeTarget, stepEdge, edgeMark } from '../world/camp/edge.js';
import { weatherAt } from '../world/weather.js';
import { buryRings, RAISING_MODES } from '../world/growth/rings.js';
import { setLiftTargets, liftFor } from '../render/lift.js';
import { lushLook } from '../world/growth/lush.js';
import { ashMarks } from '../world/gather/ashes.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { aimAt, arriveForCard, atmosphere, baker, camera, camp, campRecipe, canvas, caveLighting, cavePass, caveRecipe, caveSH, caveSHData, creatures, daylight, dig, exposure, finds, fishing, fishingOverlay, flora, floraPass, gather, gpu, graph, grassPass, grassRecipe, groundDetail, growthRecipe, hen, intro, lighting, live, params, photo, pieces, plantTool, presence, prevViewProj, publishSound, runHistory, rushPass, matsPass, seasonsRecipe, shadowPass, sim, sowOverlay, sowing, spreadOf, springCave, stores, terrain, terrainPass, tonemap, tools, uniforms, updatePour, updateRing, walk, walkControls, water, waterPass, world, ww, zones } = ctx;
  // The input's shared state (src/app/pointer.js) and the canvas size (src/app/quality.js); the tier
  // is read from ctx each frame, since a tier switch changes it.
  const S = ctx.input, size = ctx.size;
  let padEdge = 0;   // the camp pad's dashed edge's opacity now, fading toward its target
  // Ground detail waits for a few calm frames (below).
  let groundRequested = false;
  let running = true;
  let frameIndex = 0;
  let last = performance.now();
  let raf = 0;

  /** @param {number} now */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const cpuStart = performance.now();
    if (frameIndex === 0) last = now; // the first interval includes loading; don't count it
    const realDt = Math.min((now - last) / 1000, 0.25);
    const frameMs = now - last;
    last = now;

    if (canvas.width !== size.devW || canvas.height !== size.devH) {
      canvas.width = size.devW;
      canvas.height = size.devH;
    }
    // Dynamic resolution; a photo's frame is drawn at its own size (src/render/photo-mode.js).
    const [renderW, renderH] = photo.shotSize(size.devW, size.devH) ?? live.internalSize(size.devW, size.devH);
    graph.resize(renderW, renderH);

    const t = clock.advance(realDt);
    camera.setViewport(size.cssW, size.cssH);
    walkControls.update(realDt);
    walk.update(realDt);
    zones.tick(realDt);
    const zoneNow = zones.zone();
    ctx.zoneGround = zoneNow ? (x, z) => springCave.floor(x, z) : null;
    camera.setFloor(zoneNow ? -Infinity : 0);
    camera.setRoom(zoneNow?.viewRoom ? zoneNow.viewRoom(camera.target, camera.eye) : Infinity);
    // The eye adapts to a zone's dark, but not all the way (spring-cave.json light.exposureBiasEV).
    exposure.setBias(zoneNow ? -(caveRecipe.light.exposureBiasEV ?? 0) : 0);
    if (ctx.zoneCardOnArrival && !walk.busy()) {
      const c = ctx.zoneCardOnArrival;
      ctx.zoneCardOnArrival = null;
      if (zoneNow) updateStore('identify', () => ({ ...c.card, x: c.x, y: c.y, at: performance.now() }));
    }
    if (!zoneNow) arriveForCard();
    gather.update();
    photo.update(realDt);
    camera.update(realDt);
    presence.update(realDt);
    hen.update(realDt);
    updateRing();
    // Plant tool rings, and a breathing ring round whatever the journal's tap card names.
    // The camp pad's dashed edge (CP-01) while a brush ring touches the pad, fading in and out.
    const pad = getStore('campPad') ?? null;
    padEdge = pad ? stepEdge(padEdge, edgeTarget(pad, terrain.ring, tools()), realDt, pad.dash?.opacity ?? 1, pad.dash?.fadeS) : 0;
    const padMark = edgeMark(pad, padEdge);
    // A chosen thing is lifted in its own shader, not ringed (F5); only Show me (a pinned card, far
    // off) keeps its ring on the ground. The first evening's slot glows are rings of their own.
    const chosen = getStore('identify');
    setLiftTargets([...(getStore('hover')?.lift ?? []), ...liftFor(chosen, spreadOf)], realDt);
    // A raising Sculpt brush rings every plant it would cover (rings.js).
    const raising = tools().tool === 'sculpt' && RAISING_MODES.includes(tools().sculptMode);
    const bury = raising ? buryRings(world.state?.growth?.plants ?? [], flora, terrain.ring, growthRecipe.bury) : [];
    // Planting on foot (D1a): the ring under the pointer, a net walk's end, the tossed seeds. The
    // pointer's ground point is cast again every frame, so the ring stays under the cursor while the
    // camera follows or turns (October 29, 2026).
    if (S.sowScreen && walk.below && getStore('hand')) sowing.setPointer(aimAt(S.sowScreen[0], S.sowScreen[1]));
    sowing.update(now);
    sowOverlay.draw(sowing.visuals(), getStore('view').project3, now);
    fishingOverlay.draw(fishing.visuals(), getStore('view').project3);
    terrainPass.setMarks(plantTool.marks(now, !!getStore('hand') && getStore('hand').kind !== 'net' && getStore('hand').kind !== 'line', chosen?.pinned ? chosen : null, [...(padMark ? [padMark] : []), ...bury,...(getStore('reveal')?.rings?.(now) ?? []), ...creatures.foodRings(), ...intro.rings(now), ...camp.rings(now / 1000), ...stores.rings(now / 1000)]));
    // Lugworm casts are drawn into the sand by the terrain pass.
    terrainPass.setCasts(finds.casts());
    // So are the holes you dug (src/world/dig): their mouths and the fresh soil round them; and the
    // ash you spread (P2i), in the slots after them.
    const markAt = [camera.target[0], camera.target[2]], ashLook = gather.recipe.kinds?.ash?.spread?.look;
    terrainPass.setHoles(ashLook ? ashMarks(dig.marks(markAt), gather.ashesNow(), markAt, ashLook) : dig.marks(markAt), dig.ringM);
    updatePour();
    if (S.queuedHistory && !terrain.isBusy()) runHistory(S.queuedHistory);
    // Ground detail waits for a few calm frames so the first picture is as quick as before (docs/22).
    if (!groundRequested && frameIndex > 10 && frameMs < 50) {
      groundRequested = true;
      groundDetail.load().catch((err) => console.warn('ground detail did not load; keeping the flat look', err));
    }
    groundDetail.tick(realDt);

    // Sun, moon and weather at display time (a sky-lab preview moves only the look, never the world).
    const display = clock.display();
    const season = clock.seasonOf(display);
    const day = daylight.update(display, world.state, getStore('preview')?.weather ?? null, atmosphere.aerosolScale);
    atmosphere.setAtmosphere({ cloud: day.weather.cloud, mist: day.weather.mist, rain: day.weather.rain });
    for (const event of day.events) emitDeferred('sky:sun-crossed', { event });
    publishSound(realDt, display, season, day);
    // Palette keys follow the displayed sun, season and weather; positive exposureComp brightens.
    const look = baker.update(realDt, {
      sunAltDeg: (day.sm.sunAlt * 180) / Math.PI, seasonPhase: season.index + season.phase, weather: day.weather,
    });
    const split = getStore('preview')?.split;
    tonemap.set({
      lutFade: look.fade, lutFrom: look.from, lutTo: look.to, look: look.look, purkinje: look.purkinje,
      outline: look.outline, split: typeof split === 'number' ? split : -1,
    });
    const ev100 = exposure.ev100(realDt) - (look.exposureComp ?? 0) - photo.ev();
    if (frameIndex % 15 === 0) updateStore('render', (r) => ({ ...(r ?? {}), ev100 }));

    // Down in a zone, its own light: the cave's uniforms, its fill as the lighting group's sky, and
    // the walker lit from the hole as the frame's sun (no moon, no shadows down here).
    const zl = zoneNow?.light ? zoneNow.light({ sunDir: day.sm.sunDir, sunIlluminance: day.sunIlluminance, cloud: day.weather.cloud, time: t.animT }) : null;
    if (zl) {
      cavePass.setUniforms(zl.uniforms);
      const b = zl.uniforms.slice(20, 23);
      caveSHData.fill(0);
      for (let c = 0; c < 3; c++) { caveSHData[c] = (b[c] * 0.7) / 0.282095; caveSHData[4 + c] = (b[c] * 0.3) / 0.488603; }
      gpu.device.queue.writeBuffer(caveSH, 0, caveSHData);
      // No sky haze down here: an aerial reach far past the cave leaves every distance in it clear.
      caveLighting.write({ shadow: { ...shadowPass.state, strength: 0 }, weather: { cloud: 0, rain: 0, mist: 0, wet: 0 },
        aerial: { maxDistance: 1e7, slices: atmosphere.aerialSlices }, eye: camera.eye, target: camera.target, dt: realDt });
    }
    graph.writeFrameUniforms(uniforms.pack({
      view: camera.view, proj: camera.proj, viewProj: camera.viewProj, invViewProj: camera.invViewProj,
      prevViewProj, cameraPos: camera.eye, near: camera.near,
      renderSize: graph.size,
      animTime: t.animT,
      displayHours: (display % clock.SECONDS_PER_YEAR) / clock.SECONDS_PER_HOUR,
      dayFrac: clock.dayFractionOf(display),
      yearFrac: clock.yearFractionOf(display),
      seasonPhase: season.phase,
      moonPhase: day.sm.moonPhase,
      ev100,
      sunDir: zl ? zl.sunDir : day.sm.sunDir, sunIlluminance: zl ? zl.sunIlluminance : day.sunIlluminance,
      moonDir: day.sm.moonDir, moonIlluminance: zl ? [0, 0, 0] : day.moonIlluminance,
      tierFlags: ctx.tier === 'ultra' || ctx.tier === 'high' ? 2 : ctx.tier === 'medium' ? 1 : 0,
      frameIndex,
    }));
    prevViewProj.set(camera.viewProj);

    shadowPass.update({ eye: camera.eye, view: camera.view, proj: camera.proj, near: camera.near, targetDistance: camera.distance },
      day.shadowDir, day.shadowStrength);
    lighting.write({
      shadow: shadowPass.state, weather: day.weather,
      aerial: { maxDistance: atmosphere.aerialMaxDistance, slices: atmosphere.aerialSlices },
      eye: camera.eye, target: camera.target, dt: realDt,
    });

    /** @type {import('../sim/live-sim.js').FrameInfo} */
    const info = { dt: t.dt, realDt, worldT: t.worldT, animT: t.animT, displayT: display, tier: ctx.tier };
    const windNow = weatherAt(world.state?.weather, display, seasonsRecipe).wind;
    ww.update({ rain: day.weather.rain, sunY: day.sm.sunDir[1], wind: windNow }, camera.target);
    const bladeFrame = {
      focus: camera.target, time: t.animT, wind: windNow, windDir: world.state?.weather?.today?.windDir ?? 0,
      season: season.index + season.phase, seaLevel: water.tide,
    };
    grassPass.update(bladeFrame);
    // No blade grows through a loose stone (src/world/pieces).
    // And none through the clay furnace's stones.
    const clears = [...pieces.clears(camera.target), ...camp.stations.clears(camera.target)].sort((a, b) => a.d - b.d);
    grassPass.setClears(clears);
    rushPass.setClears(clears);
    // Grass and rushes bend away from the walker's feet and body (W6).
    const pushes = walk.pushes();
    grassPass.setPushes(pushes);
    rushPass.setPushes(pushes);
    matsPass.setPushes(pushes);
    // Short, worn grass on the camp pad (CP-16; rushes never stand there).
    grassPass.setPad(getStore('campPad') ?? null, campRecipe?.grass?.thinWithWear ?? 0);
    // Wet-to-dry grass (lush.js): the ground's grass layer takes the blades' tint this season.
    terrainPass.setLush(grassRecipe.lush ? lushLook(grassRecipe, bladeFrame.season) : null);
    rushPass.update(bladeFrame);
    matsPass.update({ ...bladeFrame, eye: camera.eye });
    const floraFrame = ctx.floraFrame = { time: t.animT, wind: windNow, windDir: world.state?.weather?.today?.windDir ?? 0 };
    floraPass.update({ ...floraFrame, season: season.index + season.phase, pressed: creatures.pressedPads() });
    // `?ripplerain=1` rains ripples in any weather, to judge rings in sunshine (tools, tuning).
    // Raindrops ring the water in the water shader; the ripple field keeps the pour and creatures.
    const ringRain = params.has('ripplerain') ? 1 : day.weather.rain;
    waterPass.setRain(ringRain);
    waterPass.setWind(windNow);
    terrainPass.setRain(ringRain);
    sim.update(info);
    const encoder = gpu.device.createCommandEncoder({ label: 'frame' });
    sim.encode(encoder, info);
    atmosphere.update(encoder, {
      sunDir: day.sm.sunDir, moonDir: day.sm.moonDir,
      sunIlluminanceTOA: day.sunTOA, moonIlluminanceTOA: day.moonTOA,
      cameraPos: camera.eye, invViewProj: camera.invViewProj, view: camera.view,
    });
    baker.encode(encoder);
    const shooting = photo.shooting;
    photo.beforeRender(graph.size);
    graph.render(encoder);
    photo.afterRender(encoder);
    gpu.device.queue.submit([encoder.finish()]);
    graph.afterSubmit();
    photo.afterSubmit();
    // A photo's large frame is not counted against the dynamic resolution.
    live.afterSubmit(gpu.device.queue, frameIndex > 0 && !shooting ? frameMs : 0);
    sim.afterSubmit();
    exposure.afterSubmit();
    tonemap.afterSubmit();

    if (frameIndex > 0) emitDeferred('render:frame-ended', { frameMs, cpuMs: performance.now() - cpuStart, frameIndex });
    flushDeferred();
    frameIndex++;
  }
  raf = requestAnimationFrame(frame);
  /** Stops the loop (src/app.js stop). */
  ctx.stopFrames = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}
