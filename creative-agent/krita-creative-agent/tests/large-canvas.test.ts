// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The tools take coordinates of any size: a canvas has no fixed limit (the artist's panorama is 12000 x 4000), and the plugin checks
// each region against the real canvas. Writes no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { recipeSchema } from '../src/stroke-generator.mjs';
import { contourSchema } from '../src/contour-tool.mjs';
import { referenceSchema } from '../src/reference-generator.mjs';

const pathError = (schema: unknown, value: unknown, path: string) =>
  [...Value.Errors(schema as never, value)].filter(error => String((error as { instancePath?: string; path?: string }).instancePath ?? (error as { path?: string }).path).startsWith(path));

test('a region past 8192 on a panorama is accepted', () => {
  assert.deepEqual(pathError(recipeSchema, { region: [9000, 100, 3000, 500] }, '/region'), []);
  assert.deepEqual(pathError(referenceSchema, { source: [9000, 0, 3000, 4000], target: [9000, 0, 3000, 4000] }, '/source'), []);
  assert.deepEqual(pathError(referenceSchema, { source: [9000, 0, 3000, 4000], target: [9000, 0, 3000, 4000] }, '/target'), []);
});

test('coordinates are still non-negative whole numbers, and a stroke length is still a pair', () => {
  assert.notDeepEqual(pathError(recipeSchema, { region: [-1, 0, 10, 10] }, '/region'), []);
  assert.notDeepEqual(pathError(recipeSchema, { length: 30 }, '/length'), []);
  assert.deepEqual(pathError(recipeSchema, { length: [2, 9000] }, '/length'), []);
  assert.ok(contourSchema);
});
