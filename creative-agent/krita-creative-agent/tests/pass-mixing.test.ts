// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The catalog gate: a mixing model reaches the painter, and the plugin, only after a measured card. Writes no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { passMixing, measuredModels, withMixing } from '../src/colour-mixing/pass-mixing.ts';
import type { MixingCatalog } from '../src/colour-mixing/pass-mixing.ts';
import { mixColorsTool } from '../src/colour-mixing/mix-tool.ts';
import { CATALOG } from '../src/brush-catalog.mjs';
import { paintingTools, batchTool } from '../src/tools.mjs';

const catalog: MixingCatalog = { mixing: {
  models: { spectral: 'blends like paint: blue and yellow make green', linear: 'light-correct blends' },
  presets: { 'b) Basic-1': { cards: { spectral: 'smooth green' } }, 'i) Wet Paint Plus (mypaint)': { cards: { spectral: 'rich', linear: 'bright' }, default: 'spectral' } } } };

test('a pair without a card is refused, naming the measured pairs', () => {
  const r = passMixing({ preset: 'b) Basic-1', mixing: 'linear' }, catalog);
  assert.ok('error' in r);
  assert.match(r.error, /b\) Basic-1/);
  assert.match(r.error, /spectral/);
  const unknown = passMixing({ preset: 'c) Pencil', mixing: 'spectral' }, catalog);
  assert.ok('error' in unknown);
  assert.match(unknown.error, /Wet Paint Plus[^]*spectral/, 'lists the measured pairs of other presets');
});

test('a preset default applies when mixing is omitted', () => {
  assert.deepEqual(passMixing({ preset: 'i) Wet Paint Plus (mypaint)' }, catalog), { mixing_model: 'spectral' });
  assert.deepEqual(passMixing({ preset: 'b) Basic-1' }, catalog), {}, 'no default, nothing sent');
  assert.deepEqual(passMixing({ preset: 'i) Wet Paint Plus (mypaint)', mixing: 'linear' }, catalog), { mixing_model: 'linear' });
});

test('rgb sends nothing to the plugin', () => {
  assert.deepEqual(passMixing({ preset: 'i) Wet Paint Plus (mypaint)', mixing: 'rgb' }, catalog), {}, 'even over a preset default');
  assert.deepEqual(passMixing({ preset: 'x', mixing: 'rgb' }, { mixing: { models: {}, presets: {} } }), {});
});

test('with an empty mixing catalog, paint_pass and mix_colors offer no model', async () => {
  assert.deepEqual(measuredModels(CATALOG), []);
  const runtime = { faulted: false, study: { directory: '/nonexistent', references: [] }, emit() {}, async callNative() { return {}; } };
  const tools = paintingTools(runtime);
  const pass = tools.find(t => t.name === 'paint_pass')!;
  assert.equal((pass.parameters as any).properties.mixing, undefined);
  assert.equal(tools.find(t => t.name === 'mix_colors'), undefined, 'the tool itself waits for a measured model');
  const mix = mixColorsTool({ catalog: () => CATALOG });
  await assert.rejects(mix.execute('id', { colours: [{ hex: '#ff0000', amount: 1 }, { hex: '#0000ff', amount: 1 }] }, undefined as any, undefined as any), /no mixing model/i);
  const r = passMixing({ preset: 'b) Basic-1', mixing: 'spectral' }, { mixing: { models: {}, presets: {} } });
  assert.ok('error' in r);
  assert.match(r.error, /no mixing model/i);
});

test('paint_batch passes get the same mixing', async () => {
  const seen: any[] = [];
  const pass = { name: 'paint_pass', parameters: Type.Object({ name: Type.String(), preset: Type.String(), strokes: Type.Array(Type.Any()),
    mixing: Type.Optional(Type.Union([Type.Literal('rgb'), Type.Literal('spectral'), Type.Literal('linear')])) }, { additionalProperties: false }),
    execute: async (_id: string, args: any) => { seen.push(args); return { content: [{ type: 'text', text: '{}' }], details: { status: 'ok' } }; } };
  withMixing(pass as any, () => catalog);
  const batch = batchTool([pass as any]);
  await batch.execute('b', { actions: [
    { tool: 'paint_pass', arguments: { name: 'A', preset: 'b) Basic-1', strokes: [], mixing: 'spectral' } },
    { tool: 'paint_pass', arguments: { name: 'B', preset: 'i) Wet Paint Plus (mypaint)', strokes: [] } },
    { tool: 'paint_pass', arguments: { name: 'C', preset: 'b) Basic-1', strokes: [], mixing: 'rgb' } }] });
  assert.deepEqual(seen.map(a => a.mixing_model), ['spectral', 'spectral', undefined]);
  assert.ok(seen.every(a => !('mixing' in a)), 'the prompt-facing field is replaced by mixing_model');
  const stopped = JSON.parse((await batch.execute('c', { actions: [{ tool: 'paint_pass', arguments: { name: 'D', preset: 'b) Basic-1', strokes: [] } },
    { tool: 'paint_pass', arguments: { name: 'E', preset: 'b) Basic-1', strokes: [], mixing: 'linear' } }] })).content[0].text);
  assert.equal(stopped.status, 'stopped');
  assert.match(stopped.actions[1].error, /no measured card/);
  assert.equal(Value.Check(pass.parameters, { name: 'A', preset: 'p', strokes: [], mixing: 'spectral' }), true);
});
