// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Blind A/B judging of two arm results against the goal, with the decision model, in BOTH orders. Luna showed a
// left-side position bias (colour-mixing pilot P1), so each question is asked twice: A on the left, then B on the
// left; the preference for A is the mean of the two (1 = A both times, 0.5 = it followed the position, 0 = B both
// times). Output is labelled "runtime A/B": these are judgements of the arms' images made for the benchmark, never
// an offline score of anything Luna did inside a run.
//   node scripts/benchmark-judge.ts --goal goal.png --a arm-a.png --b arm-b.png [--question "Which is cleaner?"]...
//     [--model gpt-6-luna] [--env-file <path to .env>] [--timeout 120000]
// Key: OPENAI_API_KEY from the project's .env (or --env-file), else the environment. Never printed.
import { parseArgs } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { DecisionClient } from '../src/decisions/client.ts';
import { BUILT_IN_ENDPOINTS } from '../src/decisions/endpoints.ts';
import { boundedImage } from '../src/bounded-image.ts';
import type { ChoiceQuestion, DecisionMaker, DecisionPart, Questions } from '../src/decisions/types.ts';

export const DEFAULT_QUESTIONS = ['Which is cleaner where colours meet?', 'Which looks more like the goal painting?'];
export type Arm = 'A' | 'B';
export type Side = 'left' | 'right';
export type Order = 'A-left' | 'B-left';
/** One order's raw answer to one question: the side picked (null when unanswered) and the arm that was on it. */
export type RawAnswer = { order: Order; side: Side | null; arm: Arm | null; confidence?: number };
export type QuestionResult = { question: string; raw: RawAnswer[];
  /** Mean over the answered orders of 1 (A picked) or 0 (B picked); null when no order answered. */
  preference_a: number | null; preference_b: number | null; answered: number;
  /** left when both orders picked the same side (position, not content), else the arm both orders picked, else null. */
  verdict: 'A' | 'B' | 'tie' | 'position-bias' | 'unanswered' };
export type Judged = { label: 'runtime A/B'; model: string | null; questions: QuestionResult[]; left_picks: number; answers: number; failures: string[] };
/** The pictures as the decision client takes them: parts in order. `a` and `b` are the two arms' images. */
export type Pictures = { goal: DecisionPart; a: DecisionPart; b: DecisionPart };

const CHOICES: ChoiceQuestion['criteria'] = { left: 'The LEFT painting.', right: 'The RIGHT painting.' };
const ORDERS: Order[] = ['A-left', 'B-left'];

/** The state for one order: the goal, then the two paintings named only by their side (the arm never shows). */
export function orderParts(pictures: Pictures, order: Order): DecisionPart[] {
  const [left, right] = order === 'A-left' ? [pictures.a, pictures.b] : [pictures.b, pictures.a];
  return ['GOAL painting (the target both paintings try to recreate):', pictures.goal, 'LEFT painting:', left, 'RIGHT painting:', right];
}

/** The arm on a side in an order. */
export const armOn = (order: Order, side: Side): Arm => (order === 'A-left') === (side === 'left') ? 'A' : 'B';

/** Mean preference for A from the answered orders, and the verdict. Pure: the averaging the tests pin. */
export function summarise(question: string, raw: RawAnswer[]): QuestionResult {
  const answered = raw.filter(r => r.arm);
  const votes = answered.map(r => (r.arm === 'A' ? 1 : 0));
  const preference_a = votes.length ? votes.reduce((sum: number, v) => sum + v, 0) / votes.length : null;
  const sides = new Set(answered.map(r => r.side));
  const verdict = preference_a === null ? 'unanswered'
    : answered.length === 2 && sides.size === 1 ? 'position-bias'
    : preference_a > 0.5 ? 'A' : preference_a < 0.5 ? 'B' : 'tie';
  return { question, raw, preference_a, preference_b: preference_a === null ? null : 1 - preference_a, answered: answered.length, verdict };
}

/** Each question in both orders (two decisions, every question in each), through any decision client. */
export async function judge(client: DecisionMaker, pictures: Pictures, questions: string[] = DEFAULT_QUESTIONS, model: string | null = null): Promise<Judged> {
  if (!questions.length) throw new Error('Give at least one question.');
  const asked: Questions = Object.fromEntries(questions.map((text, i) => [`q${i}`, { type: 'choice' as const, instructions: text, criteria: CHOICES }]));
  const raw: RawAnswer[][] = questions.map(() => []);
  const failures: string[] = [];
  for (const order of ORDERS) {
    const result = await client.decide({ purpose: 'benchmark-judge', parts: orderParts(pictures, order), questions: asked });
    if (result.fallback) failures.push(`${order}: ${result.fallback}`);
    questions.forEach((_text, i) => {
      const answer = result.fallback ? undefined : result.answers[`q${i}`];
      const side = answer?.type === 'choice' && (answer.choice === 'left' || answer.choice === 'right') ? answer.choice : null;
      raw[i].push({ order, side, arm: side ? armOn(order, side) : null,
        ...(answer?.type === 'choice' && typeof answer.confidence === 'number' ? { confidence: answer.confidence } : {}) });
    });
  }
  const results = questions.map((text, i) => summarise(text, raw[i]));
  const all = results.flatMap(r => r.raw).filter(r => r.side);
  return { label: 'runtime A/B', model, questions: results, left_picks: all.filter(r => r.side === 'left').length, answers: all.length, failures };
}

/** A readable report: per question the averaged preference and both raw answers, then the left-side share. */
export function report(judged: Judged): string {
  const lines = [`${judged.label}: ${judged.model ?? 'decision model'}, every question asked in both orders (A-left, B-left)`];
  for (const q of judged.questions) {
    const mean = q.preference_a === null ? 'no answer' : `A ${q.preference_a.toFixed(2)} / B ${q.preference_b!.toFixed(2)}`;
    lines.push(`- ${q.question}  ->  ${mean} (${q.verdict})`);
    for (const r of q.raw) lines.push(`    ${r.order}: ${r.side ?? 'no answer'}${r.arm ? ` = ${r.arm}` : ''}`);
  }
  lines.push(`left picked ${judged.left_picks} of ${judged.answers} answers (0.50 = no position bias)`);
  for (const failure of judged.failures) lines.push(`failed ${failure}`);
  return lines.join('\n');
}

/** OPENAI_API_KEY from a .env file's text, else from the environment. */
export function apiKey(dotEnv: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const line = (dotEnv ?? '').split(/\r?\n/).map(l => l.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/)).find(Boolean);
  const value = line ? line[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
  return value || env.OPENAI_API_KEY || null;
}

async function picture(directory: string, path: string): Promise<DecisionPart> {
  const bounded = await boundedImage(directory, path, 1_500_000);
  const mimeType = bounded.reduced ? 'image/png' : ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(path).toLowerCase()] ?? 'image/png';
  return { data: bounded.data.toString('base64'), mimeType };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { goal: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' }, question: { type: 'string', multiple: true },
    model: { type: 'string' }, 'env-file': { type: 'string' }, timeout: { type: 'string' }, json: { type: 'boolean' } } });
  if (!values.goal || !values.a || !values.b) { process.stderr.write('Usage: --goal <img> --a <img> --b <img> [--question "..."]... [--model m] [--env-file .env] [--json]\n'); process.exit(2); }
  let envPath = values['env-file'];
  if (!envPath) {
    // @ts-ignore: an .mjs module
    const { projectDir } = await import('./project-dir.mjs');
    envPath = join(projectDir(), '.env');
  }
  const key = apiKey(await readFile(envPath, 'utf8').catch(() => null));
  if (!key) { process.stderr.write(`No OPENAI_API_KEY in ${envPath} or the environment.\n`); process.exit(2); }
  const model = values.model ?? BUILT_IN_ENDPOINTS.openai.defaultModel;
  const client = new DecisionClient({ endpoint: BUILT_IN_ENDPOINTS.openai, model, apiKey: key, images: true, timeout: Number(values.timeout ?? 120000) });
  const scratch = await mkdtemp(join(tmpdir(), 'benchmark-judge-'));
  try {
    const pictures = { goal: await picture(scratch, values.goal), a: await picture(scratch, values.a), b: await picture(scratch, values.b) };
    const judged = await judge(client, pictures, values.question?.length ? values.question : DEFAULT_QUESTIONS, model);
    process.stdout.write((values.json ? JSON.stringify(judged, null, 2) : report(judged)) + '\n');
    process.exitCode = judged.failures.length ? 1 : 0;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
