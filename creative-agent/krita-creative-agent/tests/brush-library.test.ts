// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The brushes shelf of the painting-skills library (scheme A: materials/<material>/brushes/<name>.yaml + .png).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MATERIALS, brushId, checkBrushName, loadBrushes, saveBrush, type MadeBrush } from '../src/library/brushes.ts';

const brush = (extra: Partial<MadeBrush> = {}): MadeBrush => ({ material: 'soft-pastel', name: 'stick-side', mark: 'A broad grainy drag of the stick’s side.',
  base: 'b) Basic-5 Size', engine: 'paintbrush', size: 80, settings: { tip: { shape: 'rectangle', ratio: 0.3 }, texture: { pattern: 'Canvas 04' } },
  judged_by: 'luna', learned_from: ['study-02'], made_at: '2026-11-15T10:00:00.000Z', ...extra });

async function folder(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'brush-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('materials are the names painters use, and a brush is material/name', () => {
  assert.deepEqual([...MATERIALS], ['soft-pastel', 'oil', 'watercolour', 'ink', 'charcoal', 'gouache', 'tempera']);
  assert.equal(brushId(brush()), 'soft-pastel/stick-side');
});

test('a name is lowercase words joined by hyphens', () => {
  assert.equal(checkBrushName('stick-side'), 'stick-side');
  for (const bad of ['Stick Side', 'stick_side', '-stick', 'stick-', '', 'a'.repeat(41), '../x', 'stick/side'])
    assert.throws(() => checkBrushName(bad), /lowercase/, bad);
});

test('a saved brush is a readable file on its material’s shelf with its swatch beside it, and loads back with its recipe', async t => {
  const root = await folder(t), swatch = join(root, 'made.png');
  await writeFile(swatch, 'png-bytes');
  const saved = await saveBrush(root, brush(), swatch);
  assert.equal(saved.file, join(root, 'materials', 'soft-pastel', 'brushes', 'stick-side.yaml'));
  assert.equal(await readFile(join(root, 'materials', 'soft-pastel', 'brushes', 'stick-side.png'), 'utf8'), 'png-bytes');
  const text = await readFile(saved.file, 'utf8');
  assert.match(text, /^material: soft-pastel$/m); assert.match(text, /shape: rectangle/);
  const library = await loadBrushes(root);
  assert.deepEqual(library.skipped, []);
  const loaded = library.brushes.get('soft-pastel/stick-side')!;
  assert.deepEqual({ ...loaded, recipe: undefined, file: undefined }, { ...brush(), recipe: undefined, file: undefined });
  assert.equal(loaded.recipe.base_preset, 'b) Basic-5 Size');
  assert.equal(loaded.recipe.tip?.mask.type, 'rect');
  assert.equal(loaded.recipe.properties['Texture/Pattern/Name'], 'Canvas 04');
});

test('saving again replaces the brush, and no folder is an empty library', async t => {
  const root = await folder(t);
  await saveBrush(root, brush());
  await saveBrush(root, brush({ mark: 'Changed.' }));
  assert.equal((await loadBrushes(root)).brushes.get('soft-pastel/stick-side')!.mark, 'Changed.');
  assert.equal((await loadBrushes(join(root, 'nowhere'))).brushes.size, 0);
  assert.equal((await loadBrushes('')).brushes.size, 0);
});

test('a bad file is skipped with its file and field named, and the others load', async t => {
  const root = await folder(t), shelf = join(root, 'materials', 'oil', 'brushes');
  await saveBrush(root, brush());
  await mkdir(shelf, { recursive: true });
  await writeFile(join(shelf, 'impasto.yaml'), 'material: oil\nname: impasto\nmark: Thick.\nbase: b) Basic-1\nengine: paintbrush\nsize: 60\nsettings:\n  tip:\n    ratio: 7\n');
  await writeFile(join(shelf, 'wash.yaml'), 'material: watercolour\nname: wash\nmark: Thin.\nbase: b) Basic-1\nengine: paintbrush\nsize: 60\nsettings: {}\n');
  await writeFile(join(shelf, 'code.yaml'), 'material: oil\nname: code\nmark: x\nbase: b\nengine: paintbrush\nsize: 60\nsettings: {}\nrun: rm\n');
  await writeFile(join(shelf, 'broken.yaml'), ': : :\n  - [');
  const library = await loadBrushes(root);
  assert.deepEqual([...library.brushes.keys()], ['soft-pastel/stick-side']);
  assert.equal(library.skipped.length, 4);
  assert.match(library.skipped.find(s => s.includes('impasto.yaml'))!, /tip\.ratio/);
  assert.match(library.skipped.find(s => s.includes('wash.yaml'))!, /material/);
  assert.match(library.skipped.find(s => s.includes('code.yaml'))!, /run/);
  assert.ok(library.skipped.some(s => s.includes('broken.yaml')));
});

test('a brush that does not check is never written', async t => {
  const root = await folder(t);
  await assert.rejects(saveBrush(root, brush({ name: 'Stick Side' })), /lowercase/);
  await assert.rejects(saveBrush(root, brush({ material: 'crayon' as never })), /material/);
  await assert.rejects(saveBrush(root, brush({ settings: { wetness: 1 } })), /wetness/);
  await assert.rejects(saveBrush(root, brush({ size: 2000 })), /size/);
  assert.equal((await loadBrushes(root)).brushes.size, 0);
});
