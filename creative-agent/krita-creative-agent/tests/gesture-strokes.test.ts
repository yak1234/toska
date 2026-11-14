// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Gesture strokes (src/gesture-strokes.ts): strokes that follow the form, stay inside an area with a soft boundary,
// always vary and carry a pressure shape. Pure functions; nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { gestureStrokes, directionField, pressureCurve, maskInside, gestureRecipe, MIN_LOOSENESS, type GestureRecipe, type GestureStroke } from '../src/gesture-strokes.ts';
import { recipeSchema } from '../src/stroke-generator.mjs';
import { paintingTools } from '../src/tools.mjs';

const canvas = { width: 1200, height: 900 };
const recipe: GestureRecipe = { region: [100, 100, 800, 600], palette: ['#c08060', '#a06848'], stroke_count: 600, size: [10, 24], opacity: [0.3, 0.6],
  length: [60, 140], direction: 'diagonal', irregularity: 0, seed: 7 };
const ends = (s: GestureStroke) => { const last = s.segments.at(-1)!; return { dx: last[4]! - s.start[0], dy: last[5]! - s.start[1] }; };
const angleOf = (s: GestureStroke) => { const { dx, dy } = ends(s); let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a < 0) a += 180; if (a >= 180) a -= 180; return a; };
const lengthOf = (s: GestureStroke) => { const { dx, dy } = ends(s); return Math.hypot(dx, dy); };
const spread = (values: number[]) => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length); };
// Hatching whose direction turns across the picture: marks at 20 degrees on the left half, 110 on the right.
function hatched(width: number, height: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = (x < width / 2 ? 20 : 110) * Math.PI / 180, across = -x * Math.sin(a) + y * Math.cos(a);
    const v = 128 + 90 * Math.sin(across * 2 * Math.PI / 9), i = (y * width + x) * 4;
    data[i] = v; data[i + 1] = v * 0.8; data[i + 2] = v * 0.6; data[i + 3] = 255;
  }
  return { width, height, data };
}

test('a seed reproduces a batch; another seed gives another', () => {
  const a = gestureStrokes(recipe, canvas);
  assert.deepEqual(a, gestureStrokes(recipe, canvas));
  assert.notDeepEqual(a, gestureStrokes({ ...recipe, seed: 8 }, canvas));
});

test('every stroke is a valid paint_pass stroke', () => {
  const strokes = gestureStrokes(recipe, canvas);
  const pass = paintingTools({}).find((t: { name: string }) => t.name === 'paint_pass').parameters;
  for (let i = 0; i < strokes.length; i += 256)
    assert.ok(Value.Check(pass, { name: 'test', preset: 'Test brush', region: recipe.region, strokes: strokes.slice(i, i + 256) }));
});

test('strokes never come out identical: length, angle and position vary even at irregularity 0', () => {
  assert.ok(MIN_LOOSENESS > 0);
  const strokes = gestureStrokes(recipe, canvas), angles = strokes.map(angleOf), lengths = strokes.map(lengthOf);
  assert.ok(strokes.length > 300, `most seeds become strokes (${strokes.length})`);
  assert.ok(spread(angles) > 1, `angles vary (${spread(angles).toFixed(2)} degrees)`);
  assert.ok(spread(lengths) > 5, `lengths vary (${spread(lengths).toFixed(1)} px)`);
  assert.ok(Math.abs(angles.reduce((a, b) => a + b, 0) / angles.length - 45) < 4, 'around the asked direction');
  assert.ok(new Set(strokes.map(s => s.start[1].toFixed(1))).size > strokes.length * 0.9, 'no tidy rows');
  // More looseness spreads the angles further; never beyond a hand's scatter.
  const loose = gestureStrokes({ ...recipe, irregularity: 1 }, canvas).map(angleOf);
  assert.ok(spread(loose) > spread(angles) * 1.5 && spread(loose) < 30, `loose ${spread(loose).toFixed(1)} against tidy ${spread(angles).toFixed(1)}`);
});

test('an angle replaces the direction word', () => {
  const angles = gestureStrokes({ ...recipe, angle: 120 }, canvas).map(angleOf);
  assert.ok(Math.abs(angles.reduce((a, b) => a + b, 0) / angles.length - 120) < 4);
});

test('pressure shapes: taper starts light, presses and lifts; swell presses late; even has none', () => {
  let n = 0; const random = () => (n = (n * 7 + 3) % 11) / 11;
  for (let i = 0; i < 20; i++) {
    const taper = pressureCurve('taper', 5, random)!, swell = pressureCurve('swell', 5, random)!;
    const peak = Math.max(...taper);
    assert.ok(taper[0]! < peak - 0.3 && taper.at(-1)! < peak - 0.3, `taper ${taper}`);
    assert.ok(taper.indexOf(peak) <= 3 && swell.indexOf(Math.max(...swell)) >= 2, `swell ${swell}`);
    assert.ok([...taper, ...swell].every(v => v > 0 && v <= 1));
  }
  assert.equal(pressureCurve('even', 5, random), undefined);
  const strokes = gestureStrokes(recipe, canvas);
  assert.ok(strokes.every(s => s.pressure && s.pressure.length === s.segments.length + 1), 'taper by default, one value per point');
  assert.ok(new Set(strokes.map(s => s.pressure!.join())).size > strokes.length * 0.9, 'no two strokes pressed alike');
  assert.ok(gestureStrokes({ ...recipe, pressure: 'even' }, canvas).every(s => s.pressure === undefined));
});

test('follow_form: strokes take the direction of the marks at their own spot', () => {
  const image = hatched(600, 450);
  const field = directionField(image, { source: [0, 0, 600, 450], target: [0, 0, 1200, 900] }, recipe.region)!;
  assert.ok(field && field.coverage === 1 && field.coherent > 0.8);
  const strokes = gestureStrokes({ ...recipe, direction: 'follow_form', colour_from: 'form', irregularity: 0.3 }, canvas, field);
  const side = (left: boolean) => strokes.filter(s => { const x = (s.start[0] + s.segments.at(-1)![4]!) / 2; return left ? x < 540 : x > 660; }).map(angleOf);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(side(true).length > 100 && side(false).length > 100);
  assert.ok(Math.abs(mean(side(true)) - 20) < 6, `left follows 20 degrees (${mean(side(true)).toFixed(1)})`);
  assert.ok(Math.abs(mean(side(false)) - 110) < 6, `right follows 110 degrees (${mean(side(false)).toFixed(1)})`);
  // Colour comes from the image, not the palette, and varies.
  assert.ok(strokes.every(s => !recipe.palette.includes(s.color)));
  assert.ok(new Set(strokes.map(s => s.color)).size > 50);
  assert.throws(() => gestureStrokes({ ...recipe, direction: 'follow_form' }, canvas), /follow_form needs an image/);
  assert.throws(() => gestureStrokes({ ...recipe, colour_from: 'form' }, canvas), /colour_from form needs/);
});

test('strokes stop before a strong edge and never run along it', () => {
  // Left half dark, right half light: one vertical edge at x = 300 (canvas 600).
  const width = 600, height = 450, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { const v = i % width < 300 ? 30 : 220; data.set([v, v, v, 255], i * 4); }
  const field = directionField({ width, height, data }, { source: [0, 0, width, height], target: [0, 0, 1200, 900] }, recipe.region)!;
  const strokes = gestureStrokes({ ...recipe, angle: 0, length: [200, 300] }, canvas, { edge: field.edge });
  const crossing = strokes.filter(s => { const xs = [s.start[0], ...s.segments.map(g => g[4]!)]; return Math.min(...xs) < 590 && Math.max(...xs) > 610; });
  assert.equal(crossing.length, 0, 'no stroke crosses the edge');
  assert.ok(strokes.length > 200);
});

test('inside an area: strokes stay in the shape and thin out toward its boundary', () => {
  // A disc of radius 250 at the region's centre.
  const [bx, by, bw, bh] = [250, 150, 500, 500], data = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) data[y * bw + x] = Math.hypot(x - 250, y - 250) <= 250 ? 255 : 0;
  const inside = maskInside({ width: bw, height: bh, data }, [bx, by, bw, bh]);
  const strokes = gestureStrokes({ ...recipe, stroke_count: 1500, length: [30, 60] }, canvas, { inside });
  for (const s of strokes) for (const [x, y] of [s.start, ...s.segments.map(g => [g[4]!, g[5]!])])
    assert.ok(Math.hypot(x! - 500, y! - 400) <= 252, 'every point inside the disc');
  const radius = (s: GestureStroke) => Math.hypot((s.start[0] + s.segments.at(-1)![4]!) / 2 - 500, (s.start[1] + s.segments.at(-1)![5]!) / 2 - 400);
  const density = (from: number, to: number) => strokes.filter(s => radius(s) >= from && radius(s) < to).length / (Math.PI * (to * to - from * from));
  assert.ok(density(215, 250) < density(100, 180) * 0.8, 'fewer strokes in the rim than in the middle');
  const mean = (list: GestureStroke[]) => list.reduce((a, s) => a + s.opacity, 0) / list.length;
  assert.ok(mean(strokes.filter(s => radius(s) > 225)) < mean(strokes.filter(s => radius(s) < 150)), 'lighter in the rim');
  assert.throws(() => gestureStrokes(recipe, canvas, { inside: () => false }), /No stroke fits inside that area/);
});

test('bad ranges and regions are refused before painting', () => {
  for (const change of [{ opacity: [0.8, 0.2] }, { size: [40, 10] }, { region: [0, 0, 1300, 10] }, { region: [0, 0, 0, 10] }])
    assert.throws(() => gestureStrokes({ ...recipe, ...change }, canvas));
});

test('the recipe schema takes the new fields and still refuses unknown ones', () => {
  const full = { name: 'Floor', preset: 'Test brush', ...recipe };
  assert.ok(Value.Check(recipeSchema, full));
  assert.ok(Value.Check(recipeSchema, { ...full, direction: 'follow_form', angle: 30, pressure: 'swell', colour_from: 'form', inside_shape: { box: [100, 100, 300, 300] } }));
  assert.ok(!Value.Check(recipeSchema, { ...full, pressure: 'hard' }));
  assert.ok(!Value.Check(recipeSchema, { ...full, unexpected: true }));
  assert.ok(gestureRecipe({ direction: 'follow_form' }) && gestureRecipe({ angle: 10 }) && !gestureRecipe({ direction: 'diagonal' }));
});

test('where the image is known, a stroke stays in its own patch of colour', () => {
  // Vertical bands 100 canvas px wide, alternating pink and ochre with a soft step between (no hard edge to stop at).
  const width = 600, height = 450, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { const x = i % width, t = 0.5 + 0.5 * Math.tanh(Math.sin(x * Math.PI / 50) * 3); data.set([200 - 40 * t, 130 + 40 * t, 140 - 80 * t, 255], i * 4); }
  const field = directionField({ width, height, data }, { source: [0, 0, width, height], target: [0, 0, 1200, 900] }, recipe.region)!;
  const strokes = gestureStrokes({ ...recipe, angle: 0, length: [250, 400], colour_from: 'form' }, canvas, { colour: field.colour });
  const run = (s: GestureStroke) => { const xs = [s.start[0], ...s.segments.map(g => g[4]!)]; return Math.max(...xs) - Math.min(...xs); };
  assert.ok(strokes.length > 200);
  assert.ok(Math.max(...strokes.map(run)) < 110, `no stroke runs across a band (${Math.max(...strokes.map(run)).toFixed(0)} px)`);
  // Without the image the same recipe paints its full length.
  assert.ok(Math.max(...gestureStrokes({ ...recipe, angle: 0, length: [250, 400] }, canvas).map(run)) > 240);
});
