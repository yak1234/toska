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

// ---- score mode: each painting alone beside the goal ----
import { expectedLevel, scoreArms, bootstrapDiff, scoreReport, SCORE_QUESTIONS, customQuestion } from '../scripts/benchmark-judge.ts';

/** Answers a score request by the painting's name: level(painting, questionText) -> probabilities by level (or a bare pick). */
function scorer(level: (painting: string, question: string) => Record<string, number> | number): DecisionMaker & { requests: DecisionRequest[] } {
  const requests: DecisionRequest[] = [];
  return { requests, async decide(request): Promise<DecisionResult> {
    requests.push(request);
    const parts = request.parts as string[];
    const painting = parts[parts.indexOf('PAINTING to judge:') + 1];
    const answers: Record<string, any> = {};
    for (const [name, q] of Object.entries(request.questions)) {
      const v = level(painting, q.instructions);
      answers[name] = typeof v === 'number' ? { type: 'choice', choice: String(v), confidence: 0.8 } : { type: 'choice', choice: '3', probabilities: v };
    }
    return { answers, model: 'fake', elapsed_ms: 1, usage };
  } };
}
const sharp = (n: number) => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, [String(n)]: 1 });

test('expected level is the probability-weighted mean; fallbacks use confidence then the pick', () => {
  assert.ok(Math.abs(expectedLevel('3', { '1': 0.1, '2': 0.1, '3': 0.2, '4': 0.3, '5': 0.3 }, undefined)! - 3.6) < 1e-9);
  assert.ok(Math.abs(expectedLevel('4', { '1': 2, '5': 2 }, undefined)! - 3) < 1e-9, 'probabilities are normalised');
  // confidence 0.6 for level 4, the remaining 0.4 spread over 1,2,3,5 (0.1 each): 2.4 -> 0.1*(1+2+3+5)+0.6*4 = 1.1+2.4 = 3.5
  assert.ok(Math.abs(expectedLevel('4', undefined, 0.6)! - 3.5) < 1e-9);
  assert.equal(expectedLevel('4', undefined, undefined), 4);
  assert.equal(expectedLevel('x', undefined, undefined), null);
});

test('each question has five level descriptions; the defaults are the three agreed questions', () => {
  assert.equal(SCORE_QUESTIONS.length, 3);
  for (const q of SCORE_QUESTIONS) assert.deepEqual(Object.keys(q.levels), ['1', '2', '3', '4', '5']);
  assert.match(SCORE_QUESTIONS[0].text, /colour where areas meet/);
  assert.match(SCORE_QUESTIONS[1].text, /real oil paint/);
  assert.match(SCORE_QUESTIONS[2].text, /atmosphere and colour/);
  assert.deepEqual(Object.keys(customQuestion('Is it nice?').levels), ['1', '2', '3', '4', '5']);
});

test('a painting is sent alone beside the goal, repeats are separate requests, arm names never appear', async () => {
  const client = scorer(() => sharp(3));
  const arms = { A: ['pA1', 'pA2'], B: ['pB1'] };
  const out = await scoreArms(client, 'GOAL', arms, SCORE_QUESTIONS, { repeats: 2, seed: 7, model: 'm' });
  assert.equal(client.requests.length, 6, '3 paintings x 2 repeats, one request each');
  const seen = new Map<string, number>();
  for (const r of client.requests) {
    const parts = r.parts as string[];
    const paintings = parts.filter(p => /^p[AB]\d$/.test(p));
    assert.equal(paintings.length, 1, 'exactly one painting per request');
    assert.ok(parts.includes('GOAL'));
    seen.set(paintings[0], (seen.get(paintings[0]) ?? 0) + 1);
    const text = JSON.stringify([parts.filter(p => !/^p[AB]\d$|^GOAL$/.test(p)), r.questions]);
    assert.ok(!/\barms?\b|baseline|candidate/i.test(text) && !/\b[AB]\b/.test(text), `prompt names an arm: ${text}`);
    assert.equal(Object.keys(r.questions).length, 3);
  }
  assert.deepEqual([...seen.values()], [2, 2, 2].slice(0, seen.size));
  assert.equal(seen.size, 3);
  assert.equal(out.label, 'runtime A/B (scored)');
  const order = client.requests.map(r => (r.parts as string[]).find(p => /^p[AB]\d$/.test(p)));
  assert.notDeepEqual(order, ['pA1', 'pA1', 'pA2', 'pA2', 'pB1', 'pB1'], 'presented in a shuffled order');
});

test('per painting mean and spread, per arm mean and B - A over runs x repeats', async () => {
  // A paintings score 2 and 4 (repeats alike), B paintings 5 and 3 -> A mean 3, B mean 4, diff 1.
  const level: Record<string, number> = { pA1: 2, pA2: 4, pB1: 5, pB2: 3 };
  const out = await scoreArms(scorer(p => sharp(level[p])), 'GOAL', { A: ['pA1', 'pA2'], B: ['pB1', 'pB2'] }, SCORE_QUESTIONS.slice(0, 1), { repeats: 2, seed: 1, resamples: 500 });
  const a1 = out.paintings.find(p => p.arm === 'A' && p.index === 0)!;
  assert.deepEqual([a1.cells[0].mean, a1.cells[0].spread, a1.cells[0].values.length], [2, 0, 2]);
  const arm = out.questions[0];
  assert.equal(arm.A.mean, 3); assert.equal(arm.B.mean, 4); assert.equal(arm.diff, 1);
  assert.equal(arm.A.n, 4);
  assert.ok(arm.lo <= 1 && arm.hi >= 1 && arm.lo >= 0 && arm.hi <= 2);
  assert.match(scoreReport(out), /runtime A\/B \(scored\)[\s\S]*B - A/);
});

test('repeat spread is the max minus min of the repeats; unanswered requests are failures, not scores', async () => {
  const count = new Map<string, number>();
  const wobble: DecisionMaker = { async decide(request) { const who = (request.parts as string[])[3]; const n = (count.get(who) ?? 0) + 1; count.set(who, n); const answers: Record<string, any> = {};
    for (const name of Object.keys(request.questions)) answers[name] = { type: 'choice', choice: '3', probabilities: sharp(n % 2 ? 2 : 4) };
    return { answers, model: 'f', elapsed_ms: 1, usage }; } };
  const out = await scoreArms(wobble, 'G', { A: ['a'], B: ['b'] }, SCORE_QUESTIONS.slice(0, 1), { repeats: 2, seed: 3, resamples: 50 });
  for (const p of out.paintings) assert.equal(p.cells[0].spread, 2);
  const failing: DecisionMaker = { async decide() { return { fallback: 'timeout', elapsed_ms: 1 }; } };
  const bad = await scoreArms(failing, 'G', { A: ['a'], B: ['b'] }, SCORE_QUESTIONS.slice(0, 1), { repeats: 1, seed: 3 });
  assert.equal(bad.failures.length, 2); assert.equal(bad.questions[0].diff, null);
});

test('the bootstrap interval is deterministic for a fixed seed and brackets the difference', () => {
  const a = [1, 2, 3, 2, 1.5, 2.5], b = [3, 4.5, 5, 4, 3.5, 4];
  const one = bootstrapDiff(a, b, 11, 1000), two = bootstrapDiff(a, b, 11, 1000);
  assert.deepEqual(one, two);
  assert.ok(Math.abs(one.diff - (4 - 2)) < 0.01);
  assert.ok(one.lo > 0.5 && one.lo <= one.diff && one.hi >= one.diff && one.hi < 3.5, JSON.stringify(one));
  assert.notDeepEqual(bootstrapDiff(a, b, 12, 20), bootstrapDiff(a, b, 11, 20), "another seed draws other resamples");
  assert.deepEqual(bootstrapDiff([2, 2], [3, 3], 1, 100), { diff: 1, lo: 1, hi: 1 });
});

test('question order is shuffled per request (seeded) and answers are attributed by question id', async () => {
  // The fake answers by question text: a level that depends only on which question it is.
  const levelOf = (text: string) => (text.includes('colour where areas meet') ? 1 : text.includes('real oil paint') ? 3 : 5);
  const run = async () => { const c = scorer((_p, q) => sharp(levelOf(q))); const out = await scoreArms(c, 'GOAL', { A: ['pA1'], B: ['pB1'] }, SCORE_QUESTIONS, { repeats: 4, seed: 5, resamples: 20 }); return { c, out }; };
  const { c, out } = await run();
  const orders = c.requests.filter(r => (r.parts as string[]).includes('pA1')).map(r => Object.keys(r.questions).join(','));
  assert.equal(orders.length, 4);
  assert.ok(new Set(orders).size > 1, `question order differs across requests for one painting: ${orders}`);
  for (const p of out.paintings) assert.deepEqual(p.cells.map(cell => cell.mean), [1, 3, 5], 'each answer lands on its own question');
  const again = await run();
  assert.deepEqual(again.c.requests.map(r => Object.keys(r.questions).join(',')), c.requests.map(r => Object.keys(r.questions).join(',')), 'deterministic under the seed');
});
