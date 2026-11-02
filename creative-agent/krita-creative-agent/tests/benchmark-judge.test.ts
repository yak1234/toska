// The A/B judge: every question in both orders, the arm behind each side, the averaged preference. A fake decision
// client; no network, no key, no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, summarise, armOn, apiKey, report, orderParts, judgePicture, JUDGE_SIDE, JUDGE_PIXELS } from '../scripts/benchmark-judge.ts';
import { encodeRgba } from '../src/shapes/png.ts';
import type { DecisionMaker, DecisionRequest, DecisionResult } from '../src/decisions/types.ts';

const pictures = { goal: 'GOAL', a: 'ARM-A', b: 'ARM-B' };
const usage = { input_tokens: 1, output_tokens: 1, cost: 0 };
/** Answers by order: read from which picture is on the left in the request's parts. */
function fake(pick: (leftIsA: boolean, question: string) => string | null | 'fail', extra: (leftIsA: boolean) => Record<string, unknown> = () => ({})): DecisionMaker & { requests: DecisionRequest[] } {
  const requests: DecisionRequest[] = [];
  return { requests, async decide(request): Promise<DecisionResult> {
    requests.push(request);
    const parts = request.parts as string[];
    const leftIsA = parts[parts.indexOf('LEFT painting:') + 1] === 'ARM-A';
    const answers: Record<string, any> = {};
    for (const [name, q] of Object.entries(request.questions)) {
      const side = pick(leftIsA, q.instructions);
      if (side === 'fail') return { fallback: 'timeout', elapsed_ms: 1 };
      if (side) answers[name] = { type: 'choice', choice: side, confidence: 0.9, ...extra(leftIsA) };
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
  assert.ok(Math.abs(cleaner.preference_a! - 0.9) < 1e-9); assert.equal(cleaner.verdict, 'A');
  assert.ok(Math.abs(goal.preference_a! - 0.1) < 1e-9); assert.ok(Math.abs(goal.preference_b! - 0.9) < 1e-9); assert.equal(goal.verdict, 'B');
  assert.deepEqual(cleaner.raw.map(r => [r.order, r.side, r.arm]), [['A-left', 'left', 'A'], ['B-left', 'right', 'A']]);
  assert.equal(judged.left_picks, 2); assert.equal(judged.answers, 4);
});

test('a judge that always says left is position bias: the average is 0.5, never a win for the left arm', async () => {
  const judged = await judge(fake(() => 'left'), pictures, ['Which is cleaner?']);
  assert.ok(Math.abs(judged.questions[0].preference_a! - 0.5) < 1e-9, 'confidence 0.9 for left both orders: 0.9 and 0.1');
  assert.equal(judged.questions[0].verdict, 'position-bias');
  assert.equal(judged.left_picks, 2);
  assert.match(report(judged), /runtime A\/B[\s\S]*A-left: left = A[\s\S]*B-left: left = B[\s\S]*left picked 2 of 2/);
});

test('an order that fails or gives no answer is averaged over what answered, and reported', async () => {
  const half = await judge(fake((leftIsA) => (leftIsA ? 'fail' : 'right')), pictures, ['q']);
  assert.equal(half.questions[0].answered, 1); assert.ok(Math.abs(half.questions[0].preference_a! - 0.9) < 1e-9);
  assert.equal(half.questions[0].verdict, 'single-order');
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

test('probabilities are averaged across orders, not hard votes: A-left p(left)=0.8, B-left p(left)=0.6 gives pA 0.6', async () => {
  const judged = await judge(fake(() => 'left', leftIsA => ({ probabilities: { left: leftIsA ? 0.8 : 0.6, right: leftIsA ? 0.2 : 0.4 } })), pictures, ['q']);
  const q = judged.questions[0];
  assert.ok(Math.abs(q.preference_a! - 0.6) < 1e-9, String(q.preference_a));
  assert.ok(Math.abs(q.preference_b! - 0.4) < 1e-9);
  assert.equal(q.verdict, 'position-bias', 'hard votes: both orders picked left');
  assert.equal(judged.left_picks, 2);
  assert.match(report(judged), /p\(left\) 0\.80/);
});

test('without probabilities the picked side takes the confidence and the other side 1 - confidence', async () => {
  const judged = await judge(fake((leftIsA) => (leftIsA ? 'left' : 'right')), pictures, ['q']);   // A both times, confidence 0.9
  assert.ok(Math.abs(judged.questions[0].preference_a! - 0.9) < 1e-9);
  assert.equal(judged.questions[0].verdict, 'A');
  const lowRight = summarise('q', [{ order: 'A-left', side: 'right', arm: 'B', p_left: 0.3 }, { order: 'B-left', side: 'left', arm: 'B', p_left: 0.7 }]);
  assert.ok(Math.abs(lowRight.preference_a! - 0.3) < 1e-9, 'B picked at 0.7 and 0.7: A at 0.3');
});

test('a close call is a tie; one order answered is single-order, whatever its side', () => {
  const near = summarise('q', [{ order: 'A-left', side: 'left', arm: 'A', p_left: 0.52 }, { order: 'B-left', side: 'right', arm: 'A', p_left: 0.49 }]);
  assert.ok(Math.abs(near.preference_a! - 0.515) < 1e-9); assert.equal(near.verdict, 'tie');
  const one = summarise('q', [{ order: 'A-left', side: 'left', arm: 'A', p_left: 0.9 }, { order: 'B-left', side: null, arm: null }]);
  assert.equal(one.verdict, 'single-order'); assert.ok(Math.abs(one.preference_a! - 0.9) < 1e-9);
});

test('a .env line with an inline comment or quotes gives the bare key', () => {
  assert.equal(apiKey('OPENAI_API_KEY=sk-test   # the benchmark key\n', {}), 'sk-test');
  assert.equal(apiKey("export OPENAI_API_KEY='sk-q' # c", {}), 'sk-q');
});

test('a large painting is shrunk in memory before it is sent: one request with three of them stays under 5 MB', async () => {
  // Pilot 2: three 6000 x 4500 PNGs, about 40 MB each, refused with HTTP 413. A noisy 4000 x 3000 stands in (in memory).
  const width = 4000, height = 3000, data = new Uint8Array(width * height * 4);
  let seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) >>> 0; return ((seed >>> 16) & 63) - 32; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = Math.max(0, Math.min(255, (x * 255) / width + noise())); data[i + 1] = Math.max(0, Math.min(255, (y * 255) / height + noise()));
    data[i + 2] = Math.max(0, Math.min(255, 128 + 100 * Math.sin(x / 37) * Math.cos(y / 53) + noise())); data[i + 3] = 255;
  }
  const png = encodeRgba({ width, height, data });
  assert.ok(png.length > 20 * 1024 * 1024, `the fixture is a heavy PNG (${png.length} bytes)`);
  const shrunk = judgePicture(png, 'arm-a.png');
  assert.equal(shrunk.mimeType, 'image/jpeg');
  assert.ok(shrunk.shrunk && Math.max(shrunk.width!, shrunk.height!) <= JUDGE_SIDE && shrunk.width! * shrunk.height! <= JUDGE_PIXELS, `${shrunk.width} x ${shrunk.height}`);
  assert.deepEqual([...Buffer.from(shrunk.data as string, 'base64').subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
  let body = 0;
  const client: DecisionMaker = { async decide(request) { body = Math.max(body, JSON.stringify(request).length); return { fallback: 'timeout', elapsed_ms: 1 }; } };
  const part = { data: shrunk.data, mimeType: shrunk.mimeType };
  await judge(client, { goal: part, a: part, b: part }, ['q']);
  assert.ok(body > 0 && body < 5 * 1024 * 1024, `request body ${body} bytes`);
  // A small picture goes as it is; a large file this script cannot read is refused by name, never sent.
  const small = encodeRgba({ width: 4, height: 4, data: new Uint8Array(64).fill(200) });
  assert.deepEqual(judgePicture(small, 'goal.png'), { data: small.toString('base64'), mimeType: 'image/png', shrunk: false });
  assert.throws(() => judgePicture(Buffer.alloc(5 * 1024 * 1024, 7), 'arm-b.tif'), /arm-b\.tif is 5\.0 MB/);
});
