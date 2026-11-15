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

// The two places that set a trace's tags: the painter's and reviewer's traces (studio.mjs traceInfo) and Luna's decision
// traces (langfuse-tracing.mjs recordDecision). The recorder is the real LangfuseTracing over an in-memory Langfuse.
import { StudioRuntime } from '../src/studio.mjs';
import { recordingTracing } from './fake-langfuse.mjs';

async function withTraceTag<T>(value: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const previous = process.env.TOSKA_TRACE_TAG;
  if (value === undefined) delete process.env.TOSKA_TRACE_TAG; else process.env.TOSKA_TRACE_TAG = value;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.TOSKA_TRACE_TAG; else process.env.TOSKA_TRACE_TAG = previous; }
}
const chat = { mode: 'agent', study: { id: 'study-1' }, goal: null, planningWith: null };
const painterTags = () => (StudioRuntime.prototype as any).traceInfo.call(chat, 'painter').tags;
const decision = { decision_id: 'decision-1', kind: 'move-review', state: {}, questions: [], images: [], answers: null };
const decisionTags = async () => {
  const tracing = recordingTracing() as any;
  tracing.tracing.createTraceId = async (seed: string) => 'trace-for-' + seed;   // the SDK's own; the recorder has none
  await tracing.recordDecision(decision, { sessionId: 'study-1' });
  return tracing.recorded.observations[0].trace.tags;
};

test('a study chat’s painter traces carry wikiart-study after the role and the mode', async () => {
  assert.deepEqual(await withTraceTag('wikiart-study', painterTags), ['painter', 'mode:agent', 'wikiart-study']);
});

test('without the tag, or with a value that is not allowed, a painter trace’s tags are the role and the mode', async () => {
  assert.deepEqual(await withTraceTag(undefined, painterTags), ['painter', 'mode:agent']);
  assert.deepEqual(await withTraceTag('foo', painterTags), ['painter', 'mode:agent']);
});

test('a study chat’s decision traces carry wikiart-study after decision and the kind', async () => {
  assert.deepEqual(await withTraceTag('wikiart-study', decisionTags), ['decision', 'move-review', 'wikiart-study']);
});

test('without the tag a decision trace’s tags are decision and the kind', async () => {
  assert.deepEqual(await withTraceTag(undefined, decisionTags), ['decision', 'move-review']);
});
