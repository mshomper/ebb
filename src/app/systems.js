// @ts-check
// The start-up order (src/app.js runs these one after another on the start-up context,
// src/app/context.js). Several systems read what an earlier one made, so the order is the order the
// island has always started in: add a new system's line where what it needs already exists, usually
// beside the system it is most like. Test links sit in the list where their set-up has always run.

import * as boot from './boot.js';
import * as world from './world.js';
import * as view from './view.js';
import * as light from './light.js';
import * as ground from './ground.js';
import * as creatures from './creatures.js';
import * as shore from './shore.js';
import * as walker from './walker.js';
import * as seasons from './seasons.js';
import * as hen from './hen.js';
import * as lift from './lift.js';
import * as pack from './pack.js';
import * as treats from './treats.js';
import * as camp from './camp.js';
import * as dig from './dig.js';
import * as zones from './zones.js';
import * as fixtures from './fixtures.js';
import * as setpieces from './setpieces.js';
import * as kit from './kit.js';
import * as fishing from './fishing.js';
import * as shaped from './shaped.js';
import * as graph from './graph.js';
import * as photo from './photo.js';
import * as quality from './quality.js';
import * as pointer from './pointer.js';
import * as tools from './tools.js';
import * as actions from './actions.js';
import * as sound from './sound.js';
import * as frame from './frame.js';
import * as save from './save.js';
import * as testLinks from './test-links.js';
import * as testCamp from './test-links-camp.js';

/** @type {import('./context.js').StartStep[]} */
export const SYSTEMS = [
  boot.start,
  world.land,
  testLinks.startTime,
  world.start,
  view.start,
  light.start,
  ground.start,
  creatures.start,
  testLinks.swarms,
  creatures.midges,
  shore.start,
  walker.start,
  seasons.start,
  hen.start,
  lift.start,
  pack.start,
  treats.start,
  testLinks.treats,
  camp.start,
  hen.props,
  camp.after,
  dig.start,
  zones.start,
  testLinks.springCave,
  testLinks.digStood,
  dig.run,
  fixtures.start,
  testLinks.lanterns,
  testLinks.perch,
  setpieces.start,
  kit.start,
  fishing.start,
  shaped.start,
  shaped.tests,
  testLinks.packs,
  testCamp.camp,
  testCamp.teas,
  testCamp.spring,
  kit.teaReveal,
  testLinks.autumn,
  testLinks.frogScale,
  ground.waterPasses,
  graph.start,
  photo.start,
  testLinks.photo,
  quality.start,
  pointer.start,
  tools.start,
  actions.start,
  sound.start,
  frame.start,
  testLinks.demos,
  save.start,
];
