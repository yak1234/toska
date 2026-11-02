// The A/B judge: every question in both orders, the arm behind each side, the averaged preference. A fake decision
// client; no network, no key, no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, summarise, armOn, apiKey, report, orderParts } from '../scripts/benchmark-judge.ts';
import type { DecisionMaker, DecisionRequest, DecisionResult } from '../src/decisions/types.ts';

const pictures = { goal: 'GOAL', a: 'ARM-A', b: 'ARM-B' };
const usage = { input_tokens: 1, output_tokens: 1, cost: 0 };
/** Answers by order: read from which picture is on the left in the request's parts. */
function fake(pick: (leftIsA: boolean, question: string) => string | null | 'fail'): DecisionMaker & { requests: DecisionRequest[] } {
  const requests: DecisionRequest[] = [];
  return { requests, async decide(request): Promise<DecisionResult> {
    requests.push(request);
    const parts = request.parts as string[];
    const leftIsA = parts[parts.indexOf('LEFT painting:') + 1] === 'ARM-A';
    const answers: Record<string, any> = {};
    for (const [name, q] of Object.entries(request.questions)) {
      const side = pick(leftIsA, q.instructions);
      if (side === 'fail') return { fallback: 'timeout', elapsed_ms: 1 };
      if (side) answers[name] = { type: 'choice', choice: side, confidence: 0.9 };
    }
    return { answers, model: 'fake', elapsed_ms: 1, usage };
  } };
}

test('the arm behind a side flips with the order', () => {
  assert.deepEqual([armOn('A-left', 'left'), armOn('A-left', 'right'), armOn('B-left', 'left'), armOn('B-left', 'right')], ['A', 'B', 'B', 'A']);
  const parts = orderParts(pictures, 'B-left');
  assert.equal(parts[parts.indexOf('LEFT painting:') + 1], 'ARM-B');
  assert.ok(!parts.some(p => typeof p === 'string' && /ARM|arm A|\bA\b/.test(p) && p !== 'ARM-A' && p !== 'ARM-B'), 'the prompt text never names an arm');
});

test('each question is asked in both orders; a judge that follows the content gives a clean preference', async () => {
  const client = fake((leftIsA, q) => (q.includes('cleaner') ? (leftIsA ? 'left' : 'right') : (leftIsA ? 'right' : 'left')));   // cleaner: always A; goal: always B
  const judged = await judge(client, pictures, ['Which is cleaner?', 'Which is closer to the goal?'], 'm');
  assert.equal(client.requests.length, 2, 'one decision per order, all questions in each');
  assert.equal(judged.label, 'runtime A/B');
  const [cleaner, goal] = judged.questions;
  assert.equal(cleaner.preference_a, 1); assert.equal(cleaner.verdict, 'A');
  assert.equal(goal.preference_a, 0); assert.equal(goal.preference_b, 1); assert.equal(goal.verdict, 'B');
  assert.deepEqual(cleaner.raw.map(r => [r.order, r.side, r.arm]), [['A-left', 'left', 'A'], ['B-left', 'right', 'A']]);
  assert.equal(judged.left_picks, 2); assert.equal(judged.answers, 4);
});

test('a judge that always says left is position bias: the average is 0.5, never a win for the left arm', async () => {
  const judged = await judge(fake(() => 'left'), pictures, ['Which is cleaner?']);
  assert.equal(judged.questions[0].preference_a, 0.5);
  assert.equal(judged.questions[0].verdict, 'position-bias');
  assert.equal(judged.left_picks, 2);
  assert.match(report(judged), /runtime A\/B[\s\S]*A-left: left = A[\s\S]*B-left: left = B[\s\S]*left picked 2 of 2/);
});

test('an order that fails or gives no answer is averaged over what answered, and reported', async () => {
  const half = await judge(fake((leftIsA) => (leftIsA ? 'fail' : 'right')), pictures, ['q']);
  assert.equal(half.questions[0].answered, 1); assert.equal(half.questions[0].preference_a, 1);
  assert.deepEqual(half.failures, ['A-left: timeout']);
  const none = await judge(fake(() => null), pictures, ['q']);
  assert.equal(none.questions[0].preference_a, null); assert.equal(none.questions[0].verdict, 'unanswered');
  assert.equal(summarise('q', [{ order: 'A-left', side: 'left', arm: 'A' }, { order: 'B-left', side: 'left', arm: 'B' }]).preference_a, 0.5);
  await assert.rejects(judge(fake(() => 'left'), pictures, []), /at least one question/);
});

test('the key comes from the .env text first, then the environment, and is never part of the report', () => {
  assert.equal(apiKey('A=1\nOPENAI_API_KEY="sk-test"\n', {}), 'sk-test');
  assert.equal(apiKey('OTHER=1', { OPENAI_API_KEY: 'from-env' }), 'from-env');
  assert.equal(apiKey(null, {}), null);
});
