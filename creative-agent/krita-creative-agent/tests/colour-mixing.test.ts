// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The companion's colour mixing (src/colour-mixing/mix.ts) held to the C++ module's golden vectors, so the agent's preview
// gives the colours the brushes paint. Reads one data file from the repository; writes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIX_MODELS, mix2, mixMany, hexToRgb, rgbToHex } from '../src/colour-mixing/mix.ts';
import type { MixModel, Rgb } from '../src/colour-mixing/mix.ts';
import { latentToRgb, rgbToLatent } from '../src/colour-mixing/mixbox.ts';
import { decompressMixboxLut } from '../src/colour-mixing/mixbox-data.ts';

type Row = { a: Rgb; b: Rgb; t: number; out: Rgb };
const goldenPath = fileURLToPath(new URL('../../../plugins/paintops/libpaintmix/tests/data/golden.json', import.meta.url));
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<MixModel, Row[]>;

test('every golden row matches within 1e-4', () => {
  for (const model of MIX_MODELS) {
    const rows = golden[model];
    assert.equal(rows.length, 64, model);
    let worst = 0;
    for (const row of rows) {
      const got = mix2(model, row.a, row.b, row.t);
      for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(got[i] - row.out[i]));
    }
    assert.ok(worst <= 1e-4, `${model}: largest difference ${worst}`);
  }
});

test('unmixed colours come back exactly', () => {
  const a: Rgb = [133 / 255, 0.2, 0.9];
  const b: Rgb = [0.1, 0.7, 0.3];
  for (const model of MIX_MODELS) {
    assert.deepEqual(mix2(model, a, b, 0), a, model);
    assert.deepEqual(mix2(model, a, b, 1), b, model);
    assert.deepEqual(mix2(model, a, a, 0.4), a, model);
    assert.deepEqual(mixMany(model, [a, b, a], [0, 3, 0]), b, model);
    assert.deepEqual(mixMany(model, [a, b], [1, 1]), mix2(model, a, b, 0.5), model);
    assert.deepEqual(mixMany(model, [], []), [0, 0, 0], model);
  }
});

test('blue and yellow make green under spectral', () => {
  const blue: Rgb = [0, 0.2, 0.8];
  const yellow: Rgb = [1, 0.9, 0];
  const [r, g, b] = mix2('spectral', blue, yellow, 0.5);
  assert.ok(g > r && g > b, `expected green, got ${r} ${g} ${b}`);
});

test('pigment golden rows match within 1e-4', () => {
  const rows = golden.pigment;
  assert.equal(rows.length, 64);
  let worst = 0;
  for (const row of rows) {
    const got = mix2('pigment', row.a, row.b, row.t);
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(got[i] - row.out[i]));
  }
  assert.ok(worst <= 1e-4, `pigment: largest difference ${worst}`);
});

test('pigment: blue and yellow make green, orange and ultramarine make brown', () => {
  // Mixbox's own pigment colours (mixbox.h): Cobalt Blue, Hansa Yellow, Cadmium Orange, Ultramarine Blue
  const [r, g, b] = mix2('pigment', [0, 33 / 255, 133 / 255], [252 / 255, 211 / 255, 0], 0.5);
  assert.ok(g > r && g > b, `expected green, got ${r} ${g} ${b}`);
  const brown = mix2('pigment', [1, 105 / 255, 0], [25 / 255, 0, 89 / 255], 0.5);
  assert.ok(brown[0] > brown[1] && brown[1] > brown[2] && Math.max(...brown) <= 0.7, `expected brown, got ${brown.join(' ')}`);
});

test('pigment latent round trip', () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let worst = 0;
  for (let i = 0; i < 4096; i++) {
    const c: Rgb = [next(), next(), next()];
    const back = latentToRgb(rgbToLatent(c));
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(back[k] - c[k]));
  }
  assert.ok(worst <= 1e-5, `largest difference ${worst}`);
});

test('the published Mixbox table decodes to its full size', () => {
  const lut = decompressMixboxLut();
  assert.equal(lut.length, 64 * 64 * 64 * 3 + 4353);
  // not all one value: the golden rows above check the values against the C++ copy of the table
  assert.ok(lut.some(v => v !== 0) && lut.some(v => v !== lut[0]));
});

test('hex parsing rejects bad input', () => {
  assert.equal(hexToRgb('#12345'), null);
  assert.equal(hexToRgb('zzzzzz'), null);
  assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
  assert.equal(rgbToHex([1, 0, 0]), '#ff0000');
  assert.equal(rgbToHex([2, -1, 0.5]), '#ff0080');
});
