// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// mix_colors previews a mix with the brushes' own maths (colour-mixing/mix.ts). Writes no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mixColorsTool } from '../src/colour-mixing/mix-tool.ts';
import { mixMany, hexToRgb, rgbToHex } from '../src/colour-mixing/mix.ts';
import type { MixingCatalog } from '../src/colour-mixing/pass-mixing.ts';
import type { Rgb } from '../src/colour-mixing/mix.ts';

const catalog: MixingCatalog = { mixing: { models: { spectral: 'paint-like', linear: 'light-like' }, presets: {} } };
const tool = mixColorsTool({ catalog: () => catalog });
const run = async (args: unknown) => JSON.parse(((await tool.execute('id', args as never, undefined, undefined as never)).content[0] as { text: string }).text);
const colours = [{ hex: '#2040c0', amount: 3 }, { hex: '#f0c020', amount: 1 }, { hex: '#ffffff', amount: 1 }];

test('mix_colors returns the module\'s colour', async () => {
  const rgb = colours.map(c => hexToRgb(c.hex) as Rgb), w = colours.map(c => c.amount);
  assert.deepEqual(await run({ colours, model: 'spectral' }), { model: 'spectral', hex: rgbToHex(mixMany('spectral', rgb, w)) });
  const all = await run({ colours });
  assert.deepEqual(all.mixes.map((m: { model: string }) => m.model), ['linear', 'spectral'], 'one row per measured model');
  assert.equal(all.mixes[1].hex, rgbToHex(mixMany('spectral', rgb, w)));
});

test('mix_colors refuses odd input with the reason', async () => {
  const one = [{ hex: '#ff0000', amount: 1 }];
  const two = [{ hex: '#ff0000', amount: 1 }, { hex: '#0000ff', amount: 1 }];
  await assert.rejects(run({ colours: one, model: 'spectral' }), /2 to 6/);
  await assert.rejects(run({ colours: two.map(c => ({ ...c, amount: 0 })), model: 'spectral' }), /amounts.*greater than 0|sum/i);
  await assert.rejects(run({ colours: [{ hex: '#12', amount: 1 }, two[1]], model: 'spectral' }), /#12/);
  await assert.rejects(run({ colours: Array(7).fill(two[0]), model: 'spectral' }), /2 to 6/);
  await assert.rejects(run({ colours: two, model: 'perceptual' }), /perceptual.*not measured|measured.*spectral/i);
  await assert.rejects(run({ colours: [two[0], { hex: '#0000ff', amount: -1 }] }), /amount/i);
});
