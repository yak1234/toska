// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Default mode `score`: each painting is judged alone beside the goal (see scoreArms); `--mode pair` keeps the pairwise judge below.
// Blind A/B judging of two arm results against the goal, with the decision model, in BOTH orders. Luna showed a
// left-side position bias (colour-mixing pilot P1), so each question is asked twice: A on the left, then B on the
// left; the preference for A is the mean of the two (1 = A both times, 0.5 = it followed the position, 0 = B both
// times). Output is labelled "runtime A/B": these are judgements of the arms' images made for the benchmark, never
// an offline score of anything Luna did inside a run.
//   node scripts/benchmark-judge.ts --goal goal.png --a a1.png a2.png.. --b b1.png.. [--mode score|pair] [--repeats 2] [--question "Which is cleaner?"]...
//     [--model gpt-6-luna] [--env-file <path to .env>] [--timeout 120000]
// Key: OPENAI_API_KEY from the project's .env (or --env-file), else the environment. Never printed.
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { DecisionClient } from '../src/decisions/client.ts';
import { BUILT_IN_ENDPOINTS } from '../src/decisions/endpoints.ts';
// @ts-ignore: an .mjs module
import { parseDotEnv } from '../src/langfuse-tracing.mjs';
import { reduceRgba } from '../src/bounded-image.ts';
import { decodeRgba, pngSize } from '../src/png-rgba.ts';
import { encodeJpeg } from '../src/jpeg-encode.ts';
import type { ChoiceQuestion, DecisionMaker, DecisionPart, Questions } from '../src/decisions/types.ts';

export const DEFAULT_QUESTIONS = ['Which is cleaner where colours meet?', 'Which looks more like the goal painting?'];
export type Arm = 'A' | 'B';
export type Side = 'left' | 'right';
export type Order = 'A-left' | 'B-left';
/** One order's raw answer to one question: the side picked (null when unanswered) and the arm that was on it. */
export type RawAnswer = { order: Order; side: Side | null; arm: Arm | null; confidence?: number;
  /** The model's probability for the left painting (probabilities.left, else from the confidence of the side it picked, else the hard vote). */
  p_left?: number };
/** Preferences are probability means; verdict and left-pick share are the hard-vote view. */
export type QuestionResult = { question: string; raw: RawAnswer[];
  /** Mean over the answered orders of the probability that A is better (1 - it for B); null when no order answered. */
  preference_a: number | null; preference_b: number | null; answered: number;
  /** position-bias: both orders picked the same side; single-order: only one answered; tie: |preference_a - 0.5| < TIE_BAND; else the arm ahead. */
  verdict: 'A' | 'B' | 'tie' | 'position-bias' | 'single-order' | 'unanswered' };
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

export const TIE_BAND = 0.05;

/** The probability of the left painting from one choice answer: probabilities.left, else confidence for the picked side and 1 - confidence for the other, else the hard vote. */
export function pLeft(side: Side, probabilities: Record<string, number> | undefined, confidence: number | undefined): number {
  const p = probabilities?.left;
  if (typeof p === 'number' && Number.isFinite(p)) return Math.min(1, Math.max(0, p));
  if (typeof confidence === 'number' && Number.isFinite(confidence)) { const c = Math.min(1, Math.max(0, confidence)); return side === 'left' ? c : 1 - c; }
  return side === 'left' ? 1 : 0;
}

/** Mean preference for A over the answered orders: per order pA = p(left) when A is on the left, else 1 - p(left). Pure: the averaging the tests pin. */
export function summarise(question: string, raw: RawAnswer[]): QuestionResult {
  const answered = raw.filter(r => r.arm && r.side);
  const votes = answered.map(r => { const p = r.p_left ?? (r.side === 'left' ? 1 : 0); return armOn(r.order, 'left') === 'A' ? p : 1 - p; });
  const preference_a = votes.length ? votes.reduce((sum: number, v) => sum + v, 0) / votes.length : null;
  const sides = new Set(answered.map(r => r.side));
  const verdict = preference_a === null ? 'unanswered'
    : answered.length === 1 ? 'single-order'
    : sides.size === 1 ? 'position-bias'
    : Math.abs(preference_a - 0.5) < TIE_BAND ? 'tie'
    : preference_a > 0.5 ? 'A' : 'B';
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
      const confidence = answer?.type === 'choice' && typeof answer.confidence === 'number' ? answer.confidence : undefined;
      raw[i].push({ order, side, arm: side ? armOn(order, side) : null,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(side && answer?.type === 'choice' ? { p_left: pLeft(side, answer.probabilities, confidence) } : {}) });
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
    for (const r of q.raw) lines.push(`    ${r.order}: ${r.side ?? 'no answer'}${r.arm ? ` = ${r.arm}` : ''}${r.p_left !== undefined ? ` (p(left) ${r.p_left.toFixed(2)})` : ''}`);
  }
  lines.push(`left picked ${judged.left_picks} of ${judged.answers} answers (0.50 = no position bias)`);
  for (const failure of judged.failures) lines.push(`failed ${failure}`);
  return lines.join('\n');
}

/** OPENAI_API_KEY from a .env file's text (parseDotEnv: quotes and inline # comments handled), else from the environment. */
export function apiKey(dotEnv: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  return (dotEnv === null ? '' : parseDotEnv(dotEnv).OPENAI_API_KEY) || env.OPENAI_API_KEY || null;
}

// Pilot 2 sent three 6000 x 4500 PNGs (about 40 MB each) and the endpoint refused the request (HTTP 413). A picture over
// JUDGE_PIXELS or JUDGE_BYTES is shrunk in memory: its longest side to at most JUDGE_SIDE (and its area to JUDGE_PIXELS) by
// area averaging, then a JPEG at JUDGE_QUALITY, so the three pictures of one request stay well under 5 MB.
export const JUDGE_PIXELS = 1_500_000, JUDGE_BYTES = 4 * 1024 * 1024, JUDGE_SIDE = 1500, JUDGE_QUALITY = 90;
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' };

/** One picture as the decision client takes it: the file itself when it is small, else a shrunk JPEG. `name` is for errors. */
export function judgePicture(file: Buffer, name: string): { data: string; mimeType: string; shrunk: boolean; width?: number; height?: number } {
  const size = pngSize(file);
  if (file.length <= JUDGE_BYTES && (!size || size.width * size.height <= JUDGE_PIXELS))
    return { data: file.toString('base64'), mimeType: MIME[extname(name).toLowerCase()] ?? 'image/png', shrunk: false };
  const pixels = decodeRgba(file, Number.MAX_SAFE_INTEGER, { ignoreColour: true });
  if (!pixels) throw new Error(`${basename(name)} is ${(file.length / 1048576).toFixed(1)} MB and not an 8-bit PNG this script can shrink: export it as an 8-bit PNG, or a JPEG under ${JUDGE_BYTES / 1048576} MB.`);
  const k = Math.min(1, JUDGE_SIDE / Math.max(pixels.width, pixels.height), Math.sqrt(JUDGE_PIXELS / (pixels.width * pixels.height)));
  const small = reduceRgba(pixels, Math.max(1, Math.floor(pixels.width * k) * Math.floor(pixels.height * k)));
  return { data: encodeJpeg(small, JUDGE_QUALITY).toString('base64'), mimeType: 'image/jpeg', shrunk: true, width: small.width, height: small.height };
}

async function picture(path: string): Promise<DecisionPart> {
  const { data, mimeType } = judgePicture(await readFile(path), path);
  return { data, mimeType };
}

// ---- score mode: each painting alone beside the goal (pairwise judging showed left-position bias: 6/6 left picks) ----
export type ScoreQuestion = { text: string; levels: Record<'1' | '2' | '3' | '4' | '5', string> };
const level5 = (a: string, b: string, c: string, d: string, e: string): ScoreQuestion['levels'] => ({ '1': a, '2': b, '3': c, '4': d, '5': e });
export const SCORE_QUESTIONS: ScoreQuestion[] = [
  { text: 'How clean is the colour where areas meet?', levels: level5('Very poor: muddy, grey or dirty colour wherever areas meet.', 'Poor: frequent muddy or dull seams.', 'Fair: some clean joins, some muddy ones.', 'Good: joins are mostly clean and fresh.', 'Excellent: every join is clean, with fresh colour and no mud.') },
  { text: 'How much does this look like real oil paint?', levels: level5('Very poor: flat digital fill or vector look, no paint character.', 'Poor: mostly digital, a little brush texture.', 'Fair: some paint character, still clearly digital.', 'Good: convincing brushwork, edges and blending.', 'Excellent: could pass for a photograph of a real oil painting.') },
  { text: "How well does it capture the goal painting's atmosphere and colour?", levels: level5('Very poor: unrelated mood and colours.', 'Poor: a few matching colours, wrong mood.', 'Fair: roughly the right palette, atmosphere only partly there.', 'Good: close colours and mood, with some differences.', 'Excellent: atmosphere and colour match the goal very closely.') },
];
/** A question given on the command line: the same five generic levels. */
export const customQuestion = (text: string): ScoreQuestion => ({ text, levels: level5('Very poor.', 'Poor.', 'Fair.', 'Good.', 'Excellent.') });

const LEVELS = [1, 2, 3, 4, 5];
/** The expected level from one answer: sum p(level) * level over the model's probabilities (normalised); else the confidence for the picked level with the rest spread evenly; else the pick. null when the pick is no level. */
export function expectedLevel(choice: string, probabilities: Record<string, number> | undefined, confidence: number | undefined): number | null {
  const picked = Number(choice);
  if (!LEVELS.includes(picked)) return null;
  if (probabilities) {
    const ps = LEVELS.map(l => { const v = probabilities[String(l)]; return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0; });
    const total = ps.reduce((a, b) => a + b, 0);
    if (total > 0) return LEVELS.reduce((sum, l, i) => sum + l * ps[i] / total, 0);
  }
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    const c = Math.min(1, Math.max(0, confidence)), rest = (1 - c) / (LEVELS.length - 1);
    return LEVELS.reduce((sum, l) => sum + l * (l === picked ? c : rest), 0);
  }
  return picked;
}

/** A small seeded generator (mulberry32) so the shuffle and the bootstrap repeat exactly. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** B - A of the means with a bootstrap interval (default 90%): both samples resampled with replacement. */
export function bootstrapDiff(a: number[], b: number[], seed = 1, resamples = 2000, level = 0.9): { diff: number; lo: number; hi: number } {
  const diff = mean(b) - mean(a), rnd = seeded(seed);
  const draw = (xs: number[]) => mean(xs.map(() => xs[Math.floor(rnd() * xs.length)]));
  const diffs = Array.from({ length: resamples }, () => draw(b) - draw(a)).sort((x, y) => x - y);
  const cut = (1 - level) / 2;
  return { diff, lo: diffs[Math.floor(cut * (resamples - 1))], hi: diffs[Math.ceil((1 - cut) * (resamples - 1))] };
}

export type Cell = { question: string; values: number[]; mean: number | null; spread: number | null };
export type ArmStat = { mean: number | null; n: number };
export type Scored = { label: 'runtime A/B (scored)'; model: string | null; repeats: number;
  paintings: { arm: Arm; index: number; cells: Cell[] }[];
  questions: { question: string; A: ArmStat; B: ArmStat; diff: number | null; lo: number | null; hi: number | null }[];
  failures: string[] };
export type ScoreOptions = { repeats?: number; seed?: number; model?: string | null; resamples?: number };

/** The state for one request: the goal and ONE painting, never named by arm or placed beside another. */
export const scoreParts = (goal: DecisionPart, painting: DecisionPart): DecisionPart[] =>
  ['GOAL painting (the target the painting below tries to recreate):', goal, 'PAINTING to judge:', painting];

/** Every painting of both arms, `repeats` times each, as separate requests in a seeded random order. */
export async function scoreArms(client: DecisionMaker, goal: DecisionPart, arms: { A: DecisionPart[]; B: DecisionPart[] }, questions: ScoreQuestion[] = SCORE_QUESTIONS, options: ScoreOptions = {}): Promise<Scored> {
  if (!questions.length) throw new Error('Give at least one question.');
  const repeats = options.repeats ?? 2, rnd = seeded(options.seed ?? 1);
  const entries = questions.map((q, i) => [`q${i}`, { type: 'choice' as const,
    instructions: `${q.text} Judge only the painting shown after "PAINTING to judge:", against the goal. Pick the level that fits it best.`,
    criteria: q.levels } satisfies ChoiceQuestion] as const);
  /** The questions of one request in a fresh seeded order (ids stay q<index>, answers are read back by id). */
  const askedShuffled = (): Questions => { const e = [...entries]; for (let i = e.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [e[i], e[j]] = [e[j], e[i]]; } return Object.fromEntries(e); };
  const paintings = (['A', 'B'] as Arm[]).flatMap(arm => arms[arm].map((_p, index) => ({ arm, index, cells: questions.map(q => ({ question: q.text, values: [] as number[], mean: null as number | null, spread: null as number | null })) })));
  const jobs = paintings.flatMap(p => Array.from({ length: repeats }, () => p));
  for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
  const failures: string[] = [];
  for (const job of jobs) {
    const result = await client.decide({ purpose: 'benchmark-judge', parts: scoreParts(goal, arms[job.arm][job.index]), questions: askedShuffled() });
    if (result.fallback) { failures.push(`${job.arm}${job.index + 1}: ${result.fallback}`); continue; }
    questions.forEach((_q, i) => {
      const answer = result.answers[`q${i}`];
      if (answer?.type !== 'choice') return;
      const score = expectedLevel(answer.choice, answer.probabilities, typeof answer.confidence === 'number' ? answer.confidence : undefined);
      if (score !== null) job.cells[i].values.push(score);
    });
  }
  for (const p of paintings) for (const c of p.cells) if (c.values.length) { c.mean = mean(c.values); c.spread = Math.max(...c.values) - Math.min(...c.values); }
  const out = questions.map((q, i) => {
    const pool = (arm: Arm) => paintings.filter(p => p.arm === arm).flatMap(p => p.cells[i].values);
    const a = pool('A'), b = pool('B');
    const stat = (xs: number[]): ArmStat => ({ mean: xs.length ? mean(xs) : null, n: xs.length });
    if (!a.length || !b.length) return { question: q.text, A: stat(a), B: stat(b), diff: null, lo: null, hi: null };
    return { question: q.text, A: stat(a), B: stat(b), ...bootstrapDiff(a, b, (options.seed ?? 1) + i, options.resamples) };
  });
  return { label: 'runtime A/B (scored)', model: options.model ?? null, repeats, paintings, questions: out, failures };
}

const f2 = (x: number | null) => x === null ? 'n/a' : x.toFixed(2);
/** A readable report: per question each painting's mean and repeat spread, then the arms and B - A with the 90% interval. */
export function scoreReport(s: Scored): string {
  const lines = [`${s.label}: ${s.model ?? 'decision model'}, each painting alone beside the goal, ${s.repeats} repeats, levels 1 (very poor) to 5 (excellent)`];
  s.questions.forEach((q, i) => {
    lines.push(`- ${q.question}`);
    for (const p of s.paintings) { const c = p.cells[i]; lines.push(`    ${p.arm}${p.index + 1}: mean ${f2(c.mean)}, spread ${f2(c.spread)} (${c.values.length} answers)`); }
    lines.push(`    arm A mean ${f2(q.A.mean)} (n=${q.A.n}), arm B mean ${f2(q.B.mean)} (n=${q.B.n}), B - A ${q.diff === null ? 'n/a' : `${q.diff >= 0 ? '+' : ''}${q.diff.toFixed(2)} (90% bootstrap ${f2(q.lo)} to ${f2(q.hi)})`}`);
  });
  for (const failure of s.failures) lines.push(`failed ${failure}`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { goal: { type: 'string' }, a: { type: 'string', multiple: true }, b: { type: 'string', multiple: true }, question: { type: 'string', multiple: true },
    mode: { type: 'string' }, repeats: { type: 'string' }, seed: { type: 'string' },
    model: { type: 'string' }, 'env-file': { type: 'string' }, timeout: { type: 'string' }, json: { type: 'boolean' } } });
  const mode = values.mode ?? 'score';
  if (!values.goal || !values.a?.length || !values.b?.length || (mode !== 'score' && mode !== 'pair')) {
    process.stderr.write('Usage: --goal <img> --a <img>... --b <img>... [--mode score|pair] [--question "..."]... [--repeats 2] [--seed 1] [--model m] [--env-file .env] [--json]\n'); process.exit(2); }
  if (mode === 'pair' && (values.a.length > 1 || values.b.length > 1)) { process.stderr.write('--mode pair takes one image for --a and one for --b.\n'); process.exit(2); }
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
  const goal = await picture(values.goal);
  if (mode === 'pair') {
    const pictures = { goal, a: await picture(values.a[0]), b: await picture(values.b[0]) };
    const judged = await judge(client, pictures, values.question?.length ? values.question : DEFAULT_QUESTIONS, model);
    process.stdout.write((values.json ? JSON.stringify(judged, null, 2) : report(judged)) + '\n');
    process.exitCode = judged.failures.length ? 1 : 0;
  } else {
    const arms = { A: await Promise.all(values.a.map(picture)), B: await Promise.all(values.b.map(picture)) };
    const questions = values.question?.length ? values.question.map(customQuestion) : SCORE_QUESTIONS;
    const scored = await scoreArms(client, goal, arms, questions, { repeats: Number(values.repeats ?? 2), seed: Number(values.seed ?? 1), model });
    process.stdout.write((values.json ? JSON.stringify(scored, null, 2) : scoreReport(scored)) + '\n');
    process.exitCode = scored.failures.length ? 1 : 0;
  }
}
