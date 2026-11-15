// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// make_brush's settings vocabulary turned into a recipe of engine properties (painting-skills 3.1). The key names and
// value forms are the ones read from Toska's presets and seen to work through presetProperties (tasks 1.2 to 1.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brushRecipe, sensorXml } from '../src/brush-recipe.ts';

const pixel = { preset: 'b) Basic-5 Size', engine: 'paintbrush' };
const smudge = { preset: 'k) Blender Basic', engine: 'colorsmudge' };

test('no settings give the base preset unchanged', () => {
  assert.deepEqual(brushRecipe(pixel, {}), { base_preset: 'b) Basic-5 Size', engine: 'paintbrush', properties: {} });
});

test('a tip with a shape replaces the tip: rectangle, softness as fade, angle in radians', () => {
  const recipe = brushRecipe(pixel, { tip: { shape: 'rectangle', diameter: 60, ratio: 0.5, softness: 0.25, angle: 90, spikes: 4, density: 0.8, randomness: 0.1 } });
  assert.deepEqual(recipe.tip, { replace: true,
    brush: { angle: '1.5708', density: '0.8', randomness: '0.1' },
    mask: { type: 'rect', diameter: '60', ratio: '0.5', hfade: '0.75', vfade: '0.75', spikes: '4' } });
});

test('a tip without a shape, and spacing, patch the base preset’s tip', () => {
  const recipe = brushRecipe(pixel, { tip: { ratio: 0.3 }, spacing: 0.4 });
  assert.deepEqual(recipe.tip, { replace: false, brush: { spacing: '0.4', useAutoSpacing: '0' }, mask: { ratio: '0.3' } });
});

test('a response sets the switch, its own curve and the shared curve', () => {
  const { properties } = brushRecipe(pixel, { respond: { size: { input: 'pressure', curve: [[0, 0], [0.8, 0.05], [1, 1]] }, opacity: false } });
  assert.deepEqual(properties, {
    PressureSize: true, SizeUseCurve: true, SizeUseSameCurve: false,
    SizeSensor: '<!DOCTYPE params> <params id="pressure"> <curve>0,0;0.8,0.05;1,1;</curve> </params> ',
    SizecommonCurve: '0,0;0.8,0.05;1,1;',
    PressureOpacity: false });
});

test('a response without a curve is linear, and the inputs carry Krita’s sensor ids', () => {
  assert.equal(sensorXml('drawing_angle'), '<!DOCTYPE params> <params id="drawingangle"> <curve>0,0;1,1;</curve> </params> ');
  assert.equal(sensorXml('fuzzy_dab'), '<!DOCTYPE params> <params id="fuzzy"> <curve>0,0;1,1;</curve> </params> ');
  assert.equal(sensorXml('fuzzy_stroke'), '<!DOCTYPE params> <params id="fuzzystroke"> <curve>0,0;1,1;</curve> </params> ');
});

test('scatter, opacity, flow, build and blend', () => {
  const { properties } = brushRecipe(pixel, { scatter: { amount: 1.5, x: true, y: false }, opacity: 0.6, flow: 0.4, build: 'build_up', blend: 'multiply' });
  assert.deepEqual(properties, { PressureScatter: true, ScatterValue: 1.5, 'Scattering/AxisX': true, 'Scattering/AxisY': false,
    OpacityValue: 0.6, FlowValue: 0.4, PaintOpAction: 1, CompositeOp: 'multiply' });
  assert.equal(brushRecipe(pixel, { build: 'wash' }).properties.PaintOpAction, 2);
});

test('a texture names its pattern and switches texturing on', () => {
  assert.deepEqual(brushRecipe(pixel, { texture: { pattern: 'Canvas 04', scale: 0.6, strength: 0.5 } }).properties, {
    'Texture/Pattern/Enabled': true, 'Texture/Pattern/Name': 'Canvas 04', 'Texture/Pattern/Scale': 0.6,
    'PressureTexture/Strength/': true, 'Texture/Strength/Value': 0.5 });
});

test('smudge settings belong to the colour smudge engine only', () => {
  assert.deepEqual(brushRecipe(smudge, { smudge: { colour_rate: 0.2, smudge_rate: 0.9, mode: 'dull', radius: 12 } }).properties,
    { ColorRateValue: 0.2, SmudgeRateValue: 0.9, SmudgeRateMode: 1, SmudgeRadiusValue: 12 });
  assert.equal(brushRecipe(smudge, { smudge: { mode: 'smear' } }).properties.SmudgeRateMode, 0);
  assert.throws(() => brushRecipe(pixel, { smudge: { smudge_rate: 0.5 } }), /smudge.*Color Smudge/);
});

test('an engine without a vocabulary is refused by name', () => {
  assert.throws(() => brushRecipe({ preset: 'x', engine: 'hairybrush' }, {}), /hairybrush.*paintbrush, colorsmudge/);
});

test('a value out of range, an unknown field and a bad curve are refused with the field named', () => {
  assert.throws(() => brushRecipe(pixel, { tip: { ratio: 0 } }), /tip\.ratio.*0\.01.*1/);
  assert.throws(() => brushRecipe(pixel, { opacity: 1.2 }), /opacity.*0.*1/);
  assert.throws(() => brushRecipe(pixel, { tip: { shape: 'star' } }), /tip\.shape.*round.*rectangle/);
  assert.throws(() => brushRecipe(pixel, { spacing: 'wide' }), /spacing.*number/);
  assert.throws(() => brushRecipe(pixel, { wetness: 1 }), /wetness/);
  assert.throws(() => brushRecipe(pixel, { tip: { glow: 1 } }), /tip\.glow/);
  assert.throws(() => brushRecipe(pixel, { respond: { size: { input: 'mood' } } }), /respond\.size\.input.*pressure/);
  assert.throws(() => brushRecipe(pixel, { respond: { hue: false } }), /respond\.hue/);
  assert.throws(() => brushRecipe(pixel, { respond: { size: { input: 'pressure', curve: [[0, 0]] } } }), /curve.*2 to 5 points/);
  assert.throws(() => brushRecipe(pixel, { respond: { size: { input: 'pressure', curve: [[0.5, 0], [0.2, 1]] } } }), /curve.*left to right/);
  assert.throws(() => brushRecipe(pixel, { respond: { size: { input: 'pressure', curve: [[0, 0], [1, 1.4]] } } }), /curve.*0.*1/);
  assert.throws(() => brushRecipe(pixel, { blend: 'erase' }), /blend/);
  assert.throws(() => brushRecipe(pixel, { texture: { scale: 1 } }), /texture\.pattern/);
  assert.throws(() => brushRecipe(pixel, 'soft'), /settings/);
});

test('bristle settings are not built yet and say so', () => {
  assert.throws(() => brushRecipe(pixel, { bristle: { scale: 1 } }), /bristle.*not available yet/);
});
