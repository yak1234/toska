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

// The chat's closing trace (endSession's end-chat event) and Luna's decision generations, whose tags come from
// traceInfo('luna') through the decision client's context: one filter must show the whole study.
const endChatTrace = async () => {
  const tracing = recordingTracing() as any;
  await tracing.endSession('study-1');
  return tracing.recorded.observations[0].trace;
};

test('a study chat’s closing end-chat trace carries wikiart-study', async () => {
  assert.deepEqual((await withTraceTag('wikiart-study', endChatTrace)).tags, ['wikiart-study']);
});

test('without the tag the closing end-chat trace has no tags, as before', async () => {
  assert.equal('tags' in await withTraceTag(undefined, endChatTrace), false);
});

test('Luna’s context for a study chat ends with wikiart-study, so its decision generations are tagged', async () => {
  const lunaTags = () => (StudioRuntime.prototype as any).traceInfo.call(chat, 'luna').tags;
  assert.deepEqual(await withTraceTag('wikiart-study', lunaTags), ['luna', 'mode:agent', 'wikiart-study']);
});

// A test chat may switch Painting skills on for itself (painting-skills 3.7: the live checks), as it may switch mixing
// off: the artist's own setting is copied into the test chat and is not changed.
import { skillsForced } from '../src/test-env.ts';

test('a test chat may switch painting skills on for itself, with the one allowed value', () => {
  assert.deepEqual(TEST_ENV_ALLOWED.TOSKA_PAINTING_SKILLS, ['on', '']);
  assert.deepEqual(checkTestEnv({ TOSKA_PAINTING_SKILLS: ' ON ' }), { TOSKA_PAINTING_SKILLS: 'on' });
  assert.throws(() => checkTestEnv({ TOSKA_PAINTING_SKILLS: 'yes' }), /'on'/);
  assert.equal(skillsForced({ TOSKA_PAINTING_SKILLS: 'on' }), true);
  assert.equal(skillsForced({ TOSKA_PAINTING_SKILLS: 'yes' }), false);
  assert.equal(skillsForced({}), false);
});

test('make_brush is offered with the setting on or the test chat’s switch, in Toska only', async () => {
  const offered = (settings: object, forkTools: boolean) =>
    (StudioRuntime.prototype as any).toolOffered.call({ executionSettings: settings, forkTools, currentMove: null, goal: null }, 'make_brush');
  const previous = process.env.TOSKA_PAINTING_SKILLS;
  try {
    delete process.env.TOSKA_PAINTING_SKILLS;
    assert.deepEqual([offered({ painting_skills: true }, true), offered({ painting_skills: false }, true), offered({ painting_skills: true }, false)], [true, false, false]);
    process.env.TOSKA_PAINTING_SKILLS = 'on';
    assert.deepEqual([offered({ painting_skills: false }, true), offered({ painting_skills: false }, false)], [true, false]);
  } finally { if (previous === undefined) delete process.env.TOSKA_PAINTING_SKILLS; else process.env.TOSKA_PAINTING_SKILLS = previous; }
});
