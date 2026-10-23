// @ts-check
// One click walks and uses, and card actions as icons (Matt, October 22, 2026), for
// tools/unit-tests.html: what a click below does by what it lands on and how far it is, and which
// actions a card shows, in what order. Pure; no page needed.

import { clickKind, clickPlan } from '../src/world/walk/click.js';
import { registerCardAction, actionsFor, MAX_ACTIONS } from '../src/ui/card-actions.js';
import { shownHere, MAX_HERE } from '../src/ui/ground-here.js';

const G = 'click';
const R = { thingReachM: 0.9, creatureCardM: 8, nearLookM: 2.5 };
const SPECIES = { frogs: { kind: 'creature' }, minnows: { kind: 'school' }, grass: { kind: 'cover' }, thrift: {} };

/** @type {import('./unit-tests-parallel.js').AddTests} */
export function addClickTests(test, assert, eq) {
  test(G, 'a click is a thing, a creature, ground that is everywhere, or plain walking', () => {
    eq(clickKind(null, SPECIES), 'none');
    eq(clickKind({ sp: 'frogs' }, SPECIES), 'creature');
    eq(clickKind({ sp: 'minnows' }, SPECIES), 'creature');
    eq(clickKind({ sp: 'grass' }, SPECIES), 'everywhere');
    eq(clickKind({ sp: 'shore', ground: true }, SPECIES), 'everywhere');
    eq(clickKind({ sp: 'thrift' }, SPECIES), 'thing');
    eq(clickKind({ sp: 'piece:stone', piece: 'p1' }, SPECIES), 'thing');
  });

  test(G, 'a thing walks you beside it, then its card; already beside it, the card at once', () => {
    eq(JSON.stringify(clickPlan('thing', 5, 0.6, R)), JSON.stringify({ kind: 'approach', reachM: 1.5 }));
    eq(clickPlan('thing', 1.2, 0.6, R).kind, 'card');
  });

  test(G, 'a creature never draws you up to it: its card where you stand, within 8 m', () => {
    eq(clickPlan('creature', 2, 0.4, R).kind, 'card');
    eq(clickPlan('creature', 7.9, 0.4, R).kind, 'card');
    const far = clickPlan('creature', 12, 0.4, R);
    eq(far.kind, 'approach');
    assert(far.kind === 'approach' && far.reachM < R.creatureCardM, 'stops short of the card reach');
  });

  test(G, 'grass and sand: never a card when plain; with something to gather, its card near, else walk to it first', () => {
    eq(clickPlan('everywhere', 0.5, 0.45, R).kind, 'walk', 'plain grass at your feet is a walk, not a card');
    eq(clickPlan('everywhere', 2, 0.45, R).kind, 'walk', 'plain grass two meters off is a walk');
    eq(clickPlan('everywhere', 12, 0.45, R).kind, 'walk', 'plain sand far off is a walk');
    eq(clickPlan('everywhere', 2, 0.45, R, true).kind, 'card', 'drift twigs two meters off open their card');
    const far = clickPlan('everywhere', 12, 0.45, R, true);
    assert(far.kind === 'approach' && far.reachM < R.nearLookM, 'drift twigs far off: walk up to them, then their card');
    eq(clickPlan('none', 0.2, 0, R).kind, 'walk');
  });

  test(G, 'card actions: only those that fit the card, in order, at most six, the main one marked', () => {
    const offs = [
      registerCardAction({ id: 't-b', icon: 'carry', label: 'B', order: 20, when: (c) => !!c.t, action: () => ({ type: 'b' }) }),
      registerCardAction({ id: 't-a', icon: 'gather', label: (c) => `Gather ${c.what}`, order: 10, main: true, when: (c) => !!c.t, action: () => ({ type: 'a' }) }),
      registerCardAction({ id: 't-no', icon: 'lift', label: 'No', order: 5, when: () => false }),
    ];
    try {
      const got = actionsFor({ t: true, what: 'sticks', noPage: true }, {}).filter((x) => x.a.id.startsWith('t-'));
      eq(got.map((x) => x.a.id).join(), 't-a,t-b');
      eq(got[0].label, 'Gather sticks');
      assert(got[0].main && !got[1].main, 'only the first is main');
      for (let i = 0; i < 8; i++) offs.push(registerCardAction({ id: `t-x${i}`, icon: 'notes', label: 'x', order: 30 + i, when: (c) => !!c.t }));
      eq(actionsFor({ t: true, noPage: true }, {}).length, MAX_ACTIONS);
    } finally { for (const off of offs) off(); }
    eq(actionsFor({ t: true, noPage: true }, {}).filter((x) => x.a.id.startsWith('t-')).length, 0, 'removed again');
  });

  test(G, 'the "here" bar shows the two lowest orders', () => {
    const here = { rest: { id: 'rest', icon: 'rest', label: 'Rest', order: 20, action: {} }, light: { id: 'light', icon: 'fire', label: 'Light', order: 10, action: {} },
      dig: { id: 'dig', icon: 'sculpt', label: 'Dig', order: 30, action: {} } };
    eq(shownHere(here).map((o) => o.id).join(), 'light,rest');
    eq(MAX_HERE, 2);
    eq(shownHere(undefined).length, 0);
  });
}
