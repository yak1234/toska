// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// What a failed model request was (openspec model-busy-retries). Nothing is written to disk.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_RETRY, modelTrouble, pausedMessage, retryStatus } from '../src/model-trouble.ts';

// The painter model's refusal in the Istanbul repaint chat (2026-11-10), as the transcript recorded it.
const ISTANBUL = '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"qwen/qwen3-vl-235b-a22b-instruct is temporarily rate-limited upstream. Please retry shortly, or add your own provider key to use your own limits: https://openrouter.ai/workspaces/default/byok","provider_name":"DeepInfra","is_byok":false,"provider_error_code":"engine_overloaded","limit_source":"upstream_provider_shared_pool"}}';

test('a rate limit or an overloaded host is a busy model, not a connection problem', () => {
  assert.deepEqual(modelTrouble(ISTANBUL), { kind: 'busy', code: 429 });
  assert.deepEqual(modelTrouble('529 {"type":"overloaded_error","message":"Overloaded"}'), { kind: 'busy', code: 529 });
  assert.equal(modelTrouble('Too Many Requests').kind, 'busy');
  assert.equal(modelTrouble('The engine is currently overloaded, please try again later').kind, 'busy');
});

test('a network failure is a connection problem', () => {
  for (const text of ['fetch failed', 'connect ECONNREFUSED 127.0.0.1:443', 'getaddrinfo ENOTFOUND openrouter.ai', 'socket hang up', 'read ECONNRESET', 'Request timed out.', 'terminated'])
    assert.deepEqual(modelTrouble(text), { kind: 'connection', code: null }, text);
});

test('a provider fault is the provider\'s, and anything else is unknown', () => {
  assert.deepEqual(modelTrouble('503 temporarily unavailable'), { kind: 'provider', code: 503 });
  assert.deepEqual(modelTrouble('500 Internal Server Error'), { kind: 'provider', code: 500 });
  assert.deepEqual(modelTrouble('400 the image is too large'), { kind: 'other', code: 400 });
  assert.deepEqual(modelTrouble(undefined), { kind: 'other', code: null });
  // A number inside the text is not a status code: only one that leads the message, or a "code"/"status" field.
  assert.deepEqual(modelTrouble('The canvas is 4000 px wide and 500 dabs were refused'), { kind: 'other', code: null });
  assert.deepEqual(modelTrouble('{"error":{"status":502,"message":"bad gateway"}}'), { kind: 'provider', code: 502 });
});

test('the status line says what is wrong, the wait and the attempt', () => {
  assert.equal(retryStatus(modelTrouble(ISTANBUL), 2, 5, 6000), 'The model is busy at its provider. Trying again in 6 s (2/5)…');
  assert.equal(retryStatus(modelTrouble('fetch failed'), 1, 5, 3000), 'Connection problem. Trying again in 3 s (1/5)…');
  assert.equal(retryStatus(modelTrouble('503 unavailable'), 5, 5, 48000), 'The model\'s provider had an error. Trying again in 48 s (5/5)…');
  assert.equal(retryStatus(modelTrouble('something odd'), 1, 5, 400), 'The model request failed. Trying again in 1 s (1/5)…');
});

test('five retries wait about a minute and a half in all', () => {
  const waits = Array.from({ length: MODEL_RETRY.maxRetries }, (_, i) => Math.min(MODEL_RETRY.baseDelayMs * 2 ** i, MODEL_RETRY.maxAgentDelayMs));
  assert.deepEqual(waits, [3000, 6000, 12000, 24000, 48000]);
});

test('a paused run says what happened and what to do, without the provider\'s raw answer', () => {
  const busy = pausedMessage(modelTrouble(ISTANBUL), ISTANBUL);
  assert.match(busy, /^The model is busy at its provider \(429\)/);
  assert.match(busy, /Nothing on the canvas was lost/);
  assert.match(busy, /another model/);
  assert.doesNotMatch(busy, /metadata|\{/);
  assert.match(pausedMessage(modelTrouble('fetch failed'), 'fetch failed'), /^Connection problem.*Check the internet connection/);
  assert.match(pausedMessage(modelTrouble('503 unavailable'), '503 unavailable'), /^The model's provider had an error \(503\)/);
  // An error that is not a passing one keeps its own words: they say what to change.
  assert.equal(pausedMessage(modelTrouble('400 the image is too large'), '400 the image is too large'), '400 the image is too large');
});
