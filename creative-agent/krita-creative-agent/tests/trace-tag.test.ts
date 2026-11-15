// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The study tag of a test chat's Langfuse traces (painting-skills 6.1a): the allow-list key and the reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTestEnv, traceTags, TRACE_TAG_KEY, TEST_ENV_ALLOWED } from '../src/test-env.ts';

test('the allow-list takes wikiart-study and nothing else for the trace tag', () => {
  assert.equal(TRACE_TAG_KEY, 'TOSKA_TRACE_TAG');
  assert.deepEqual(TEST_ENV_ALLOWED[TRACE_TAG_KEY], ['wikiart-study', '']);
  assert.deepEqual(checkTestEnv({ TOSKA_TRACE_TAG: ' Wikiart-Study ' }), { TOSKA_TRACE_TAG: 'wikiart-study' });
  assert.throws(() => checkTestEnv({ TOSKA_TRACE_TAG: 'other' }), /wikiart-study/);
});

test('traceTags gives the tag only for an allowed value', () => {
  assert.deepEqual(traceTags({ TOSKA_TRACE_TAG: 'wikiart-study' }), ['wikiart-study']);
  assert.deepEqual(traceTags({ TOSKA_TRACE_TAG: ' Wikiart-Study ' }), ['wikiart-study']);
  assert.deepEqual(traceTags({ TOSKA_TRACE_TAG: 'foo' }), []);
  assert.deepEqual(traceTags({ TOSKA_TRACE_TAG: '' }), []);
  assert.deepEqual(traceTags({}), []);
});
