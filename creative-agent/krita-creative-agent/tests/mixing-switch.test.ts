// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// TOSKA_MIXING=off hides the mixing catalog (benchmark A/B arms). Pure function of (raw catalog, env); writes no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCatalog, measuredModels, mixingModelCards, presetMixing } from '../src/brush-catalog.mjs';
import { passMixing } from '../src/colour-mixing/pass-mixing.ts';

const raw = {
  cards: {}, jobs: {}, avoid: {},
  mixing: { models: { spectral: 'blends like paint' }, presets: { Wet: { cards: { spectral: 'card' }, default: 'spectral' } } },
};

test('off: no measured models, no cards, no mixing_model', () => {
  const c = effectiveCatalog(raw, { TOSKA_MIXING: 'off' });
  assert.deepEqual(measuredModels(c), []);
  assert.equal(mixingModelCards(c), null);
  assert.equal(presetMixing('Wet', c), null);
  assert.deepEqual(passMixing({ preset: 'Wet' }, c), {});
  assert.ok('error' in passMixing({ preset: 'Wet', mixing: 'spectral' }, c));
});

test('OFF and padded values behave the same', () => {
  assert.deepEqual(effectiveCatalog(raw, { TOSKA_MIXING: 'OFF' }), effectiveCatalog(raw, { TOSKA_MIXING: 'off' }));
  assert.deepEqual(measuredModels(effectiveCatalog(raw, { TOSKA_MIXING: ' Off ' })), []);
});

test('unset keeps the shipped models', () => {
  const c = effectiveCatalog(raw, {});
  assert.equal(c, raw);
  assert.deepEqual(measuredModels(c), ['spectral']);
  assert.deepEqual(passMixing({ preset: 'Wet' }, c), { mixing_model: 'spectral' });
});

test('other values change nothing', () => {
  for (const value of ['on', '1', 'false', '']) assert.equal(effectiveCatalog(raw, { TOSKA_MIXING: value }), raw);
});

test('off does not mutate the raw catalog', () => {
  effectiveCatalog(raw, { TOSKA_MIXING: 'off' });
  assert.deepEqual(measuredModels(raw), ['spectral']);
});
