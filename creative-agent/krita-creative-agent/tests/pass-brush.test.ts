// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Painting with a brush the painter made (painting-skills 3.5): a pass names it where a preset goes, as material/name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBrush } from '../src/pass-brush.ts';
import type { BrushLibrary, LibraryBrush } from '../src/library/brushes.ts';
import { brushRecipe } from '../src/brush-recipe.ts';

const made = (): LibraryBrush => ({ material: 'soft-pastel', name: 'stick-side', mark: 'A drag.', base: 'b) Basic-5 Size', engine: 'paintbrush', size: 80,
  settings: { tip: { shape: 'rectangle', ratio: 0.3 } }, judged_by: 'luna', learned_from: [], made_at: '', file: '/library/x.yaml',
  recipe: brushRecipe({ preset: 'b) Basic-5 Size', engine: 'paintbrush' }, { tip: { shape: 'rectangle', ratio: 0.3 } }) });

function harness(brushes: LibraryBrush[] = [made()]) {
  const calls: Record<string, unknown>[] = [];
  let loads = 0;
  const tool = withBrush({ execute: async (_id: string, args: Record<string, unknown>) => { calls.push(args); return { content: [], details: { layer_id: 'l1' } }; } },
    async (): Promise<BrushLibrary> => { loads++; return { brushes: new Map(brushes.map(b => [`${b.material}/${b.name}`, b])), skipped: [] }; });
  return { tool, calls, loads: () => loads };
}

test('a pass that names a made brush paints with its base preset and carries its recipe', async () => {
  const h = harness();
  const result = await h.tool.execute('p1', { name: 'Wall', preset: 'soft-pastel/stick-side', strokes: [1] });
  assert.deepEqual(h.calls, [{ name: 'Wall', preset: 'b) Basic-5 Size', strokes: [1], brush_recipe: made().recipe }]);
  assert.deepEqual(result.details, { layer_id: 'l1', brush: 'soft-pastel/stick-side' });
});

test('a catalogue preset passes through, and the library is not read for it', async () => {
  const h = harness();
  await h.tool.execute('p1', { name: 'Wall', preset: 'b) Basic-5 Size', strokes: [1] });
  await h.tool.execute('p2', { name: 'Wall', preset: 'a/b', strokes: [1] });
  assert.deepEqual(h.calls.map(c => [c.preset, 'brush_recipe' in c]), [['b) Basic-5 Size', false], ['a/b', false]]);
  assert.equal(h.loads(), 0);
});

test('a brush that is not in the library is refused with the ones that are', async () => {
  const h = harness();
  await assert.rejects(h.tool.execute('p1', { name: 'Wall', preset: 'oil/impasto', strokes: [1] }), /oil\/impasto.*soft-pastel\/stick-side/);
  await assert.rejects(harness([]).tool.execute('p1', { name: 'Wall', preset: 'oil/impasto', strokes: [1] }), /oil\/impasto.*make_brush/);
  assert.equal(h.calls.length, 0);
});
