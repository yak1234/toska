// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// A repaint kept (openspec repaint-from-asset 5.4): passes that read the goal are turned away over a repainted area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passTarget, repaintKept, GOAL_PASSES, type Repainted } from '../src/repaint-kept.ts';

const CANVAS: [number, number] = [6000, 4500];
const TOWER: Repainted = { part: 'the tower', asset: '02-historic-buildings.png', fitted_id: 'fitted-1', bounds: [1193, 104, 800, 1479], size: [800, 1479], move: 3 };
const refuse = (tool: string, args: Record<string, unknown>, area: number[] | null = null, repainted: Repainted[] = [TOWER]) =>
  repaintKept({ tool, args, repainted, canvas: CANVAS, area });

test('where a pass paints: its target or box, inside the Paint only here area, else the whole canvas', () => {
  assert.deepEqual(passTarget('paint_finish', {}, CANVAS, null), [0, 0, 6000, 4500]);
  assert.deepEqual(passTarget('paint_finish', { area: 'whole' }, CANVAS, [0, 103, 2648, 2077]), [0, 103, 2648, 2077]);
  assert.deepEqual(passTarget('paint_finish', { area: { box: [1000, 0, 500, 500] } }, CANVAS, null), [1000, 0, 500, 500]);
  assert.deepEqual(passTarget('paint_reference_surface', { target: [1000, 0, 2000, 1500] }, CANVAS, [0, 103, 2648, 2077]), [1000, 103, 1648, 1397]);
  assert.equal(passTarget('paint_finish', { area: { box: [5000, 4000, 100, 100] } }, CANVAS, [0, 0, 100, 100]), null);
});

test('Finish and the goal passes over a repainted area are turned away, and told the fitted picture', () => {
  for (const tool of ['paint_finish', 'refine_to_goal']) {
    const why = refuse(tool, { area: 'whole' }, [0, 103, 2648, 2077]);
    assert.match(why!, /the tower/); assert.match(why!, /02-historic-buildings/); assert.match(why!, /Nothing was painted/);
  }
  const surface = refuse('paint_reference_surface', { reference_id: 'goal-1', source: [0, 0, 1448, 1086], target: [0, 0, 6000, 4500] });
  assert.match(surface!, /fitted-1/); assert.match(surface!, /\[0,0,800,1479\]/); assert.match(surface!, /\[1193,104,800,1479\]/);
  assert.ok(refuse('paint_reference_edges', { reference_id: 'goal-1', target: [1000, 0, 1500, 2000] }));
  assert.ok(refuse('paint_from_reference', { reference_id: 'goal-1', target: [0, 0, 6000, 4500] }));
  assert.ok(refuse('paint_accents', { reference_id: 'goal-1' }));
});

test('the fitted picture itself, a pass elsewhere, a grazing box and other tools go through', () => {
  assert.equal(refuse('paint_from_reference', { reference_id: 'fitted-1', source: [0, 0, 800, 1479], target: [1193, 104, 800, 1479] }), null);
  assert.equal(refuse('paint_reference_surface', { reference_id: 'fitted-1', target: [1193, 104, 800, 1479] }), null);
  assert.equal(refuse('paint_finish', { area: { box: [3000, 2000, 2000, 2000] } }), null);
  assert.equal(refuse('paint_finish', { area: { box: [1900, 1500, 1000, 1000] } }), null);        // a corner of the box only
  assert.equal(refuse('paint_snow', {}), null);
  assert.equal(refuse('paint_pass', { target: [1193, 104, 800, 1479] }), null);
  assert.equal(refuse('paint_finish', {}, null, []), null);
  assert.ok(GOAL_PASSES.includes('paint_finish') && !GOAL_PASSES.includes('paint_snow'));
});

test('a finish by named selection or shape is judged on the Paint only here area or the whole canvas', () => {
  assert.ok(refuse('paint_finish', { area: { selection: 'Buildings' } }));
  assert.equal(refuse('paint_finish', { area: { selection: 'Sky' } }, [3000, 0, 3000, 1000]), null);
});

test('several repainted areas: each one the pass would cover is named', () => {
  const car: Repainted = { part: 'the car', asset: '12-vintage-convertible.png', fitted_id: 'fitted-2', bounds: [2500, 3000, 2000, 1200], size: [1000, 600] };
  const why = refuse('paint_finish', {}, null, [TOWER, car]);
  assert.match(why!, /the tower/); assert.match(why!, /the car/);
});
