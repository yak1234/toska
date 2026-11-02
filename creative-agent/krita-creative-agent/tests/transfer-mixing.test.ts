// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Mixing inside the reference transfer (colour-mixing task 7b, amendment 2026-11-01 (2)): paint_from_reference paints with a
// measured mixing preset and model, each dab's colour solved so that, mixed with the canvas beneath at the preset's measured
// coverage, it lands on the reference colour. Fake Krita; temporary files are deleted by each test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mix2, hexToRgb, rgbToHex } from '../src/colour-mixing/mix.ts';
import type { MixModel, Rgb } from '../src/colour-mixing/mix.ts';
import { solvePaint, overlapShare, SOLVE_STEPS, SOLVE_TOLERANCE } from '../src/colour-mixing/transfer-colours.ts';
import { presetCoverage } from '../src/colour-mixing/pass-mixing.ts';
import { SHIPPED_POLICY } from '../src/colour-mixing/mixing-policy.ts';
import { encodeRgba } from '../src/shapes/png.ts';
// @ts-ignore: .mjs modules
import { effectiveCatalog, CATALOG } from '../src/brush-catalog.mjs';
// @ts-ignore: .mjs modules
import { referenceTools } from '../src/reference-tool.mjs';
// @ts-ignore: .mjs modules
import { generateReferencePlan, DAB_WIDTH, DAB_HALF_LENGTH, DAB_JITTER } from '../src/reference-generator.mjs';
// @ts-ignore: .mjs modules
import { paintingTools } from '../src/tools.mjs';

const RAW = JSON.parse(readFileSync(new URL('../src/brush-catalog.json', import.meta.url), 'utf8'));
const WET = 'i) Wet Paint Plus (mypaint)', KNIFE = 'i) Wet Knife Plus (mypaint)', BRISTLES = 'f) Bristles-2 Flat Rough';
const SHIPPED_HAS_SPECTRAL = !!CATALOG.mixing?.presets?.[WET]?.cards?.spectral;   // false when the shell sets TOSKA_MIXING=off

// --- the pigment-aware solve -------------------------------------------------------------------------------------------
function seeded(seed: number) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const byte = (v: number) => Math.round(v * 255) / 255;
const err = (a: Rgb, b: Rgb) => Math.max(...[0, 1, 2].map(k => Math.abs(a[k]! - b[k]!)));

test('coverage: the measured paint share is recorded on the carded presets', () => {
  assert.equal(presetCoverage(WET, RAW), 0.91);
  assert.equal(presetCoverage(KNIFE, RAW), 0.955);
  assert.equal(presetCoverage(BRISTLES, RAW), null, 'no card: no coverage');
  assert.equal(presetCoverage(WET, effectiveCatalog(RAW, { TOSKA_MIXING: 'off' })), null, 'TOSKA_MIXING=off: none');
});

test('the solve: 50 fixed (C, T, cov) triples land within 2/255 where reachable; P* = T exactly when C == T', () => {
  assert.equal(SOLVE_STEPS, 4);
  assert.equal(SOLVE_TOLERANCE, 1 / 255);
  // The measured coverages (task 7). Below about 0.85 four plain steps fall short on some colours (the step is the error
  // itself, not the error over the coverage, as the brief fixes it); no carded preset is there.
  const rand = seeded(7071), covs = [0.91, 0.955];
  for (const model of ['spectral', 'rgb'] as MixModel[]) {
    for (let i = 0; i < 50; i++) {
      const C: Rgb = [byte(rand()), byte(rand()), byte(rand())];
      // Reachable by construction: T is what some paint Q in gamut gives over C, in 8 bits as a dab's hex colour is.
      const Q: Rgb = [rand(), rand(), rand()], cov = covs[i % covs.length]!;
      const T = mix2(model, C, Q, cov).map(byte) as Rgb;
      const P = solvePaint(model, C, T, cov);
      assert.ok(P.every(v => v >= 0 && v <= 1), `${model} #${i}: paint in gamut ${P}`);
      assert.ok(err(mix2(model, C, P, cov), T) <= 2 / 255, `${model} #${i}: C ${rgbToHex(C)} T ${rgbToHex(T)} cov ${cov}: ${rgbToHex(mix2(model, C, P, cov))}`);
      // As sent: the dab's hex colour.
      const sent = hexToRgb(rgbToHex(P))!;
      assert.ok(err(mix2(model, C, sent, cov), T) <= 2 / 255, `${model} #${i} as hex`);
    }
    const T: Rgb = [0.2, 0.4, 0.6];
    assert.deepEqual(solvePaint(model, [0.2, 0.4, 0.6], T, 0.91), T, 'C == T: the paint is T');
  }
  // Unreachable (white over black at 0.6 coverage): the paint clamps, and the result is no worse than painting T.
  const C: Rgb = [0, 0, 0], T: Rgb = [1, 1, 1], P = solvePaint('spectral', C, T, 0.6);
  assert.ok(P.every(v => v >= 0 && v <= 1));
  assert.ok(err(mix2('spectral', C, P, 0.6), T) <= err(mix2('spectral', C, T, 0.6), T) + 1e-6);
  assert.deepEqual(solvePaint('spectral', [0.1, 0.1, 0.1], T, 1), T, 'full coverage: nothing to solve');
});

// --- the transfer --------------------------------------------------------------------------------------------------------
const canvas = { width: 64, height: 64 };
const image = { width: 24, height: 24, data: Buffer.alloc(24 * 24 * 4) };
for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) image.data.set(x < 12 ? [200, 120, 40, 255] : [40, 90, 200, 255], (y * 24 + x) * 4);
const recipe = (preset: string, extra: Record<string, unknown> = {}) => ({ name: 'Still life', reference_id: 'ref', preset, source: [0, 0, 24, 24], target: [2, 2, 48, 48], steps: [6, 3, 1.5], focal_regions: [[6, 6, 12, 12]], seed: 42, ...extra });
const CANVAS_RGB = [110, 150, 90];   // the wet paint already on the canvas, under every dab

type Call = { operation: string; params: any };
async function studio(options: { batch?: number; through?: 'tools' | 'reference'; catalog?: unknown; stopAfter?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'transfer-mixing-'));
  const ref = join(directory, 'ref.png'); await writeFile(ref, 'fixture');
  const view = join(directory, 'view.png'), pixels = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) pixels.set([...CANVAS_RGB, 255], i * 4);
  await writeFile(view, encodeRgba({ width: 64, height: 64, data: pixels }));
  let revision = 'r0', layer = 0;
  const calls: Call[] = [], receipts = new Map<string, any>();
  const runtime: any = { config: { reference_batch: options.batch ?? 20 }, mode: 'agent', executionPhase: 'agent', faulted: false,
    study: { directory, references: [{ id: 'ref', path: ref }] }, emit() {}, paintStepKind: () => null,
    async callNative(operation: string, params: any) {
      if (operation === 'decode_reference') return { width: 24, height: 24, rgba_base64: image.data.toString('base64'), sha256: params.sha256 };
      if (operation === 'observe') return { status: 'ok', ...canvas, revision, image_path: view, image_width: 64, image_height: 64, scale: 1 };
      if (operation === 'operation_status') return { found: receipts.has(params.id), result: receipts.get(params.id) };
      if (operation === 'paint_pass') {
        calls.push({ operation, params });
        if (options.stopAfter && calls.length === options.stopAfter) runtime.cancelRequested = true;
        const result = { status: 'ok', revision: 'r' + calls.length, layer_id: params.continue_layer_id ?? 'layer-' + (++layer), ...canvas, image_path: view, image_width: 64, image_height: 64 };
        revision = result.revision; return result;
      }
      throw new Error('unexpected ' + operation);
    } };
  let tools: any[];
  if (options.through === 'reference') {
    const execute = async (id: string, args: any) => {
      const params = args;
      calls.push({ operation: 'paint_pass', params });
      if (options.stopAfter && calls.length === options.stopAfter) runtime.cancelRequested = true;
      const result = { status: 'ok', revision: 'r' + calls.length, layer_id: args.continue_layer_id ?? 'layer-' + (++layer), image_path: view };
      revision = result.revision; receipts.set(id, result); return { details: result };
    };
    tools = referenceTools(runtime, execute, async () => ({ details: {} }), { catalog: () => options.catalog ?? RAW, policy: () => SHIPPED_POLICY });
  } else tools = paintingTools(runtime);
  const find = (name: string) => tools.find(t => t.name === name);
  return { runtime, calls, find, directory, close: () => rm(directory, { recursive: true, force: true }) };
}
const planned = (preset: string) => generateReferencePlan(recipe(preset), image, canvas);
const sentStrokes = (calls: Call[]) => calls.flatMap(c => c.params.strokes);

test('a transfer with mixing spectral and Wet Paint Plus: every chunk carries spectral, and each dab is solved against the canvas', async t => {
  if (!SHIPPED_HAS_SPECTRAL) return t.skip('TOSKA_MIXING=off in this shell');
  const h = await studio();
  try {
    const result = await h.find('paint_from_reference').execute('mix-1', recipe(WET, { mixing: 'spectral' }), undefined, undefined);
    assert.equal(result.details.status, 'complete');
    assert.ok(h.calls.length >= 5, 'several chunks');
    assert.ok(h.calls.some(c => c.params.continue_layer_id), 'continuations too');
    for (const c of h.calls) {
      assert.equal(c.params.mixing_model, 'spectral', 'every chunk');
      assert.ok(!('mixing' in c.params) && !('pass_kind' in c.params), 'the plugin never sees mixing or pass_kind');
    }
    const plan = planned(WET), sent = sentStrokes(h.calls), wanted = plan.passes.flatMap((p: any) => p.strokes);
    assert.equal(sent.length, wanted.length);
    const C = CANVAS_RGB.map(v => v / 255) as Rgb, share = overlapShare(LAYOUT);
    let changed = 0;
    sent.forEach((s: any, i: number) => {
      const T = hexToRgb(wanted[i].color)!;
      assert.deepEqual({ ...s, color: '' }, { ...wanted[i], color: '' }, 'only the colour changes');
      // Solved against C' = lerp(C, T, s): what is seen of a dab mostly lies on earlier dabs of its own pass.
      const below = [0, 1, 2].map(k => C[k]! + (T[k]! - C[k]!) * share) as Rgb;
      assert.equal(s.color, rgbToHex(solvePaint('spectral', below, T, 0.91)), `dab ${i}`);
      if (s.color !== wanted[i].color) changed++;
    });
    assert.ok(changed > 0, 'the dabs were solved, not painted as the reference (C\u2032 is near T, so the change is small)');
    assert.match(result.content[0].text, /spectral/);
  } finally { await h.close(); }
});

test('a transfer with Bristles and spectral is refused, naming the measured pairs; nothing is painted', async () => {
  const h = await studio({ through: 'reference' });
  try {
    await assert.rejects(h.find('paint_from_reference').execute('mix-2', recipe(BRISTLES, { mixing: 'spectral' })),
      (error: Error) => /Measured pairs: .*Wet Paint Plus.*spectral/.test(error.message) && /Bristles/.test(error.message));
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

// The plugin calls of a default transfer (Bristles, no mixing) before task 7b, recorded on this fixture: sha256 of the
// paint_pass params in order. Nothing in them may change.
const TODAY = '376875c9e1eb79b7b258c21718409c2fe035a1865b175717dec1c18f6eefe7b1';
test('no mixing and the default brush: byte-identical plugin calls to today', async () => {
  const h = await studio();
  try {
    await h.find('paint_from_reference').execute('plain', recipe(BRISTLES), undefined, undefined);
    const params = h.calls.map(c => c.params);
    assert.ok(params.every(p => !('mixing_model' in p)));
    assert.deepEqual(sentStrokes(h.calls).map((s: any) => s.color), planned(BRISTLES).passes.flatMap((p: any) => p.strokes.map((s: any) => s.color)));
    assert.equal(createHash('sha256').update(JSON.stringify(params)).digest('hex'), TODAY);
  } finally { await h.close(); }
});

test('the policy: a transfer with Wet Paint Plus and no mixing mixes spectral; with Bristles rgb', async t => {
  if (!SHIPPED_HAS_SPECTRAL) return t.skip('TOSKA_MIXING=off in this shell');
  for (const [preset, model] of [[WET, 'spectral'], [BRISTLES, undefined]] as const) {
    const h = await studio();
    try {
      await h.find('paint_from_reference').execute('policy', recipe(preset), undefined, undefined);
      assert.ok(h.calls.length > 1);
      assert.deepEqual([...new Set(h.calls.map(c => c.params.mixing_model))], [model], preset);
    } finally { await h.close(); }
  }
});

test('TOSKA_MIXING=off: the transfer is rgb with plain colours, and an explicit model is refused', async () => {
  const off = effectiveCatalog(RAW, { TOSKA_MIXING: 'off' });
  const h = await studio({ through: 'reference', catalog: off });
  try {
    await h.find('paint_from_reference').execute('off', recipe(WET));
    assert.ok(h.calls.length > 1);
    for (const c of h.calls) assert.equal(c.params.mixing, 'rgb', 'the job sends its resolved model; withMixing turns rgb into nothing');
    assert.deepEqual(sentStrokes(h.calls).map((s: any) => s.color), planned(WET).passes.flatMap((p: any) => p.strokes.map((s: any) => s.color)));
    await assert.rejects(h.find('paint_from_reference').execute('off-2', recipe(WET, { mixing: 'spectral' })), /no mixing model has a measured card/);
  } finally { await h.close(); }
});

test('every continuation of one transfer job uses the job’s mixing; another model on continue is refused', async () => {
  const h = await studio({ through: 'reference', stopAfter: 2 });
  try {
    const first = await h.find('paint_from_reference').execute('cont', recipe(WET, { mixing: 'spectral' }));
    assert.equal(first.details.status, 'paused');
    h.runtime.cancelRequested = false;
    const job = JSON.parse(await readFile(join(h.directory, 'reference-paintings', first.details.job_id + '.json'), 'utf8'));
    assert.equal(job.mixing, 'spectral');
    assert.equal(job.recipe.mixing, undefined, 'the recipe (and its plan) carry no mixing');
    await assert.rejects(h.find('continue_reference_painting').execute('c', { job_id: first.details.job_id, mixing: 'rgb' }), /same mixing/);
    const rest = await h.find('continue_reference_painting').execute('c', { job_id: first.details.job_id });
    assert.equal(rest.details.status, 'complete');
    assert.ok(h.calls.length > 3);
    for (const c of h.calls) assert.equal(c.params.mixing, 'spectral');
  } finally { await h.close(); }
});

// --- fix round 1: overlap within a pass, and the solve switch -------------------------------------------------------------
const LAYOUT = { width: DAB_WIDTH, halfLength: DAB_HALF_LENGTH, jitter: DAB_JITTER };
/** A real plan's fine pass over a flat 120 px reference onto a 480 px canvas (12 px between dabs, 18 px wide). */
function finePass() {
  const flat = { width: 120, height: 120, data: Buffer.alloc(120 * 120 * 4) };
  for (let i = 0; i < 120 * 120; i++) flat.data.set([200, 120, 40, 255], i * 4);
  const plan = generateReferencePlan({ name: 'Flat', reference_id: 'ref', preset: WET, source: [0, 0, 120, 120], target: [0, 0, 480, 480], steps: [6, 3, 1.5], seed: 9 }, flat, { width: 480, height: 480 });
  return plan.passes[1].strokes as { start: number[]; segments: number[][]; size: number }[];
}
/** Paints the strokes in order on a 480 px grid (pixel centres inside each stroke's capsule), calling paint(pixel, dab). */
function rasterise(strokes: { start: number[]; segments: number[][]; size: number }[], paint: (pixel: number) => void) {
  for (const stroke of strokes) {
    const [ax, ay] = stroke.start as [number, number], seg = stroke.segments.at(-1)!, bx = seg[4]! - ax, by = seg[5]! - ay, r = stroke.size / 2, len = bx * bx + by * by;
    for (let y = Math.max(0, Math.floor(Math.min(ay, ay + by) - r)); y <= Math.min(479, Math.ceil(Math.max(ay, ay + by) + r)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, ax + bx) - r)); x <= Math.min(479, Math.ceil(Math.max(ax, ax + bx) + r)); x++) {
        const px = x + 0.5, py = y + 0.5, t = len ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len)) : 0;
        if (Math.hypot(px - ax - t * bx, py - ay - t * by) <= r) paint(y * 480 + x);
      }
  }
}
const interior = (pixel: number) => { const x = pixel % 480, y = Math.floor(pixel / 480); return x >= 36 && x < 444 && y >= 36 && y < 444; };

test('overlap share: s for the generator\u2019s layout lies in (0, 1) and matches painting a real pass pixel by pixel within 0.02', () => {
  const s = overlapShare(LAYOUT);
  assert.ok(s > 0 && s < 1, String(s));
  assert.equal(overlapShare(LAYOUT), s, 'cached and deterministic');
  // Brute force: paint the pass in its shuffled order; of what is seen at the end, the share painted over an earlier dab.
  const painted = new Uint8Array(480 * 480), onEarlier = new Uint8Array(480 * 480);
  rasterise(finePass(), pixel => { onEarlier[pixel] = painted[pixel]; painted[pixel] = 1; });
  let seen = 0, over = 0;
  for (let p = 0; p < painted.length; p++) if (interior(p) && painted[p]) { seen++; over += onEarlier[p]!; }
  assert.ok(Math.abs(over / seen - s) <= 0.02, `simulated ${over / seen} vs overlapShare ${s}`);
});

test('a simulated pass: solving against C\u2032 lands closer to T than no solve and than solving against C', () => {
  const strokes = finePass(), cov = 0.91, s = overlapShare(LAYOUT);
  for (const [C, T] of [[[0.2, 0.3, 0.7], [0.85, 0.7, 0.2]], [[0.9, 0.85, 0.8], [0.35, 0.2, 0.15]], [[0.1, 0.5, 0.2], [0.6, 0.3, 0.55]]] as [Rgb, Rgb][]) {
    const meanError = (P: Rgb) => {
      const memo = new Map<string, Rgb>(), colour: Rgb[] = new Array(480 * 480).fill(C);
      rasterise(strokes, pixel => { const below = colour[pixel]!, key = below.join(); let next = memo.get(key); if (!next) { next = mix2('spectral', below, P, cov); memo.set(key, next); } colour[pixel] = next; });
      // The pass's colour as seen: the mean over the interior (a dab is about 12 canvas px; on a 6000 px canvas the eye and
      // the judge see the dabs averaged), against T. This is the bias the overshoot makes and C' corrects; per pixel, the
      // spots a dab painted on bare canvas keep (1 - cov)(C - T) whatever the solve.
      const sum: Rgb = [0, 0, 0]; let n = 0;
      for (let p = 0; p < colour.length; p++) if (interior(p)) { for (let k = 0; k < 3; k++) sum[k] += colour[p]![k]!; n++; }
      return err(sum.map(v => v / n) as Rgb, T);
    };
    const below = [0, 1, 2].map(k => C[k]! + (T[k]! - C[k]!) * s) as Rgb;
    const plain = meanError(T), againstC = meanError(solvePaint('spectral', C, T, cov)), againstBelow = meanError(solvePaint('spectral', below, T, cov));
    assert.ok(againstBelow < plain && againstBelow < againstC, `C ${rgbToHex(C)} T ${rgbToHex(T)}: no solve ${plain}, against C ${againstC}, against C' ${againstBelow}`);
  }
});

test('solve: false lays the reference colours unsolved while the dabs still mix; continuations keep it', async () => {
  const h = await studio({ through: 'reference', stopAfter: 2 });
  try {
    const first = await h.find('paint_from_reference').execute('raw', recipe(WET, { mixing: 'spectral', solve: false }));
    h.runtime.cancelRequested = false;
    const job = JSON.parse(await readFile(join(h.directory, 'reference-paintings', first.details.job_id + '.json'), 'utf8'));
    assert.equal(job.solve, false);
    assert.equal(job.recipe.solve, undefined);
    await assert.rejects(h.find('continue_reference_painting').execute('c', { job_id: first.details.job_id, solve: true }), /same/);
    await h.find('continue_reference_painting').execute('c', { job_id: first.details.job_id });
    for (const c of h.calls) assert.equal(c.params.mixing, 'spectral');
    assert.deepEqual(sentStrokes(h.calls).map((s: any) => s.color), planned(WET).passes.flatMap((p: any) => p.strokes.map((s: any) => s.color)));
  } finally { await h.close(); }
});
