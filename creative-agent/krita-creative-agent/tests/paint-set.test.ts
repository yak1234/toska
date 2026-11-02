// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The transfer's own paint set (colour-mixing task 7d, "Level 2"): ΔE00 held to Sharma's published pairs, recipes of at most
// three library paints mixed with Mixbox, the paint set chosen per reference within a strictness limit, the transfer
// painting every dab in its recipe colour, and the dry-run preview script. Fake Krita; temporary files are deleted by each test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { deltaE00, deltaE00Rgb, deltaE00LowerBound } from '../src/colour-mixing/delta-e.ts';
import type { Lab } from '../src/colour-mixing/delta-e.ts';
import { PAINT_LIBRARY, PAINT_NAMES, TITANIUM_WHITE, paintByName } from '../src/colour-mixing/paints.ts';
import { recipeFor, unprunedRecipeFor, choosePaintSet, paintSetLayer, paintPlan, STRICTNESS_LIMITS, ColourHistogram } from '../src/colour-mixing/paint-set.ts';
import { pigmentMix2, pigmentMixMany } from '../src/colour-mixing/mixbox.ts';
import { hexToRgb, rgbToHex } from '../src/colour-mixing/mix.ts';
import type { Rgb } from '../src/colour-mixing/mix.ts';
import { SHIPPED_POLICY } from '../src/colour-mixing/mixing-policy.ts';
import { encodeRgba } from '../src/shapes/png.ts';
// @ts-ignore: .mjs modules
import { CATALOG } from '../src/brush-catalog.mjs';
// @ts-ignore: .mjs modules
import { referenceTools } from '../src/reference-tool.mjs';
// @ts-ignore: .mjs modules
import { generateReferencePlan } from '../src/reference-generator.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// --- ΔE00 -----------------------------------------------------------------------------------------------------------------
// Sharma, Wu and Dalal (2005), Table 1: all 34 pairs (L1 a1 b1 L2 a2 b2 ΔE00).
const SHARMA: number[][] = [
  [50.0000, 2.6772, -79.7751, 50.0000, 0.0000, -82.7485, 2.0425], [50.0000, 3.1571, -77.2803, 50.0000, 0.0000, -82.7485, 2.8615],
  [50.0000, 2.8361, -74.0200, 50.0000, 0.0000, -82.7485, 3.4412], [50.0000, -1.3802, -84.2814, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, -1.1848, -84.8006, 50.0000, 0.0000, -82.7485, 1.0000], [50.0000, -0.9009, -85.5211, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, 0.0000, 0.0000, 50.0000, -1.0000, 2.0000, 2.3669], [50.0000, -1.0000, 2.0000, 50.0000, 0.0000, 0.0000, 2.3669],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0009, 7.1792], [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0010, 7.1792],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0011, 7.2195], [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0012, 7.2195],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0009, -2.4900, 4.8045], [50.0000, -0.0010, 2.4900, 50.0000, 0.0010, -2.4900, 4.8045],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0011, -2.4900, 4.7461], [50.0000, 2.5000, 0.0000, 50.0000, 0.0000, -2.5000, 4.3065],
  [50.0000, 2.5000, 0.0000, 73.0000, 25.0000, -18.0000, 27.1492], [50.0000, 2.5000, 0.0000, 61.0000, -5.0000, 29.0000, 22.8977],
  [50.0000, 2.5000, 0.0000, 56.0000, -27.0000, -3.0000, 31.9030], [50.0000, 2.5000, 0.0000, 58.0000, 24.0000, 15.0000, 19.4535],
  [50.0000, 2.5000, 0.0000, 50.0000, 3.1736, 0.5854, 1.0000], [50.0000, 2.5000, 0.0000, 50.0000, 3.2972, 0.0000, 1.0000],
  [50.0000, 2.5000, 0.0000, 50.0000, 1.8634, 0.5757, 1.0000], [50.0000, 2.5000, 0.0000, 50.0000, 3.2592, 0.3350, 1.0000],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644], [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731], [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373], [36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441], [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377], [2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082],
];

test('ΔE00: Sharma’s 34 test pairs within 1e-4, both ways round', () => {
  for (const [i, row] of SHARMA.entries()) {
    const a = row.slice(0, 3) as Lab, b = row.slice(3, 6) as Lab;
    assert.ok(Math.abs(deltaE00(a, b) - row[6]!) < 1e-4, `pair ${i + 1}: ${deltaE00(a, b)} vs ${row[6]}`);
    assert.ok(Math.abs(deltaE00(b, a) - row[6]!) < 1e-4, `pair ${i + 1} reversed`);
  }
  assert.equal(deltaE00Rgb([0.2, 0.4, 0.6], [0.2, 0.4, 0.6]), 0);
  assert.ok(Math.abs(deltaE00Rgb([0, 0, 0], [1, 1, 1]) - 100) < 0.01, 'black to white is 100');
});

test('ΔE00 lower bound: never above ΔE00 (20,000 random Lab pairs, near and far)', () => {
  let a = 12345;
  const rand = () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; };
  for (let i = 0; i < 20000; i++) {
    const p: Lab = [rand() * 100, rand() * 200 - 100, rand() * 200 - 100];
    const spread = i % 2 ? 4 : 120, q: Lab = [p[0] + (rand() - 0.5) * spread, p[1] + (rand() - 0.5) * spread, p[2] + (rand() - 0.5) * spread];
    assert.ok(deltaE00LowerBound(...p, ...q) <= deltaE00(p, q) + 1e-9, `${p} ${q}`);
  }
});

// --- recipes ---------------------------------------------------------------------------------------------------------------
test('the library: Mixbox’s thirteen pigments plus Titanium White and Ivory Black, by user-facing name', () => {
  assert.equal(PAINT_LIBRARY.length, 15);
  assert.deepEqual(paintByName('Cobalt Blue')!.rgb, [0, 33 / 255, 133 / 255]);
  assert.deepEqual(paintByName('Ultramarine Blue')!.rgb, [25 / 255, 0, 89 / 255]);
  assert.ok(PAINT_NAMES.includes(TITANIUM_WHITE) && PAINT_NAMES.includes('Ivory Black'));
});

test('a library paint as the target: the recipe is that paint alone', () => {
  for (const name of ['Cadmium Yellow', 'Cobalt Blue', 'Burnt Sienna', 'Permanent Green']) {
    const r = recipeFor(paintByName(name)!.rgb, PAINT_NAMES);
    assert.deepEqual(r.paints, [name], `${name}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.weights, [1]);
    assert.ok(r.deltaE < 0.5, `${name}: ΔE00 ${r.deltaE}`);
  }
});

test('blue and yellow paints make a green: a two-paint recipe within the exact limit', () => {
  const blue = paintByName('Cobalt Blue')!.rgb, yellow = paintByName('Hansa Yellow')!.rgb;
  const green = hexToRgb(rgbToHex(pigmentMix2(blue, yellow, 0.5)))!;
  assert.ok(green[1] > green[0] && green[1] > green[2], `a green: ${rgbToHex(green)}`);
  const r = recipeFor(green, ['Cobalt Blue', 'Hansa Yellow', TITANIUM_WHITE]);
  assert.equal(r.paints.length, 2, JSON.stringify(r));
  assert.deepEqual([...r.paints].sort(), ['Cobalt Blue', 'Hansa Yellow']);
  assert.ok(Math.abs(r.weights[0]! + r.weights[1]! - 1) < 1e-9);
  assert.ok(r.deltaE <= STRICTNESS_LIMITS.exact, `ΔE00 ${r.deltaE}`);
  // The recipe's colour is Mixbox's mix of its paints at its weights, and its ΔE00 is measured to the target.
  const mixed = pigmentMixMany(r.paints.map(n => paintByName(n)!.rgb), r.weights);
  assert.deepEqual(r.rgb, mixed);
  assert.ok(Math.abs(deltaE00Rgb(green, r.rgb) - r.deltaE) < 1e-9);
});

// The p1 exact set (task 7d preview) and 200 of p1's own colours (tests/fixtures/p1-colours.json).
const P1_EXACT = ['Hansa Yellow', 'Cadmium Orange', 'Cadmium Red', 'Cobalt Violet', 'Ultramarine Blue', 'Phthalo Blue', 'Phthalo Green',
  'Permanent Green', 'Sap Green', 'Burnt Sienna', TITANIUM_WHITE, 'Ivory Black'];
test('the laid recipe is never worse than the same search unpruned, on 200 real p1 colours', { timeout: 240000 }, () => {
  const { colours } = JSON.parse(readFileSync(new URL('./fixtures/p1-colours.json', import.meta.url), 'utf8')) as { colours: string[] };
  assert.equal(colours.length, 200);
  for (const hex of colours) {
    const c = hexToRgb(hex)!, laid = recipeFor(c, P1_EXACT), full = unprunedRecipeFor(c, P1_EXACT);
    assert.ok(laid.deltaE <= full.deltaE + 1e-9, `${hex}: laid ${laid.deltaE} (${laid.paints}) vs unpruned ${full.deltaE} (${full.paints})`);
    assert.ok(laid.paints.length >= 1 && laid.paints.length <= 3);
  }
});

test('strictness limits are numbers in ΔE00: exact 2, close 5, loose 10', () => {
  assert.deepEqual(STRICTNESS_LIMITS, { exact: 2, close: 5, loose: 10 });
});

// --- choosing the set ------------------------------------------------------------------------------------------------------
test('choosePaintSet on a synthetic 6-colour image: White always, 8 to 12 paints, every colour within the limit', () => {
  const p = (n: string) => paintByName(n)!.rgb;
  const six: Rgb[] = [
    pigmentMix2(p('Cobalt Blue'), p(TITANIUM_WHITE), 0.6), pigmentMix2(p('Cadmium Red'), p('Cadmium Yellow'), 0.3),
    pigmentMixMany([p('Burnt Sienna'), p('Ultramarine Blue'), p(TITANIUM_WHITE)], [0.5, 0.2, 0.3]), p('Sap Green'),
    pigmentMix2(p('Quinacridone Magenta'), p(TITANIUM_WHITE), 0.5), pigmentMix2(p('Phthalo Green'), p('Hansa Yellow'), 0.4),
  ].map(c => hexToRgb(rgbToHex(c))!);
  const histogram = new ColourHistogram();
  six.forEach((c, i) => histogram.add(Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), 100 + i * 10));
  const colours = histogram.quantise();
  assert.equal(colours.length, 6);
  for (const strictness of ['exact', 'close', 'loose'] as const) {
    const chosen = choosePaintSet(colours, strictness);
    assert.ok(chosen.paints.includes(TITANIUM_WHITE), strictness);
    assert.ok(chosen.paints.length >= 8 && chosen.paints.length <= 12, `${strictness}: ${chosen.paints}`);
    assert.equal(new Set(chosen.paints).size, chosen.paints.length);
    assert.ok(chosen.paints.every(n => PAINT_NAMES.includes(n)));
    const layer = paintSetLayer(chosen.paints, strictness);
    for (const c of six) {
      const laid = layer(rgbToHex(c));
      assert.ok(!laid.unmixed, `${strictness}: ${rgbToHex(c)} reached`);
      assert.ok(laid.deltaE <= STRICTNESS_LIMITS[strictness], `${strictness}: ${rgbToHex(c)} ΔE00 ${laid.deltaE}`);
    }
  }
});

test('the histogram quantises to at most 256 weighted colours', () => {
  const h = new ColourHistogram();
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 7) for (let b = 0; b < 256; b += 9) h.add(r, g, b, 1);
  const q = h.quantise();
  assert.ok(q.length <= 256 && q.length > 200, `${q.length}`);
  const total = q.reduce((n, c) => n + c.weight, 0);
  assert.equal(total, 52 * 37 * 29);
  assert.deepEqual(h.quantise(), q, 'deterministic');
});

test('exact: an unreachable colour (#00ff00 from earth paints) is laid unmixed and counted; loose lays the nearest mix', () => {
  const earth = ['Burnt Sienna', 'Ivory Black', TITANIUM_WHITE];
  const exact = paintSetLayer(earth, 'exact')('#00ff00');
  assert.equal(exact.unmixed, true);
  assert.equal(exact.color, '#00ff00');
  assert.equal(exact.deltaE, 0, 'laid as the reference colour');
  const loose = paintSetLayer(earth, 'loose')('#00ff00');
  assert.equal(loose.unmixed, false);
  assert.notEqual(loose.color, '#00ff00');
  assert.ok(loose.recipe && loose.recipe.paints.every(n => earth.includes(n)));
  assert.ok(loose.deltaE > STRICTNESS_LIMITS.loose, 'the nearest mix, however far');
  // In a plan: the unmixed dab is counted, the reachable one is mixed.
  const plan = { passes: [{ name: 'p', strokes: [{ color: '#00ff00' }, { color: rgbToHex(paintByName('Burnt Sienna')!.rgb) }] }] };
  const { report } = paintPlan(plan, earth, 'exact');
  assert.equal(report.unmixed, 1);
  assert.equal(report.dabs, 2);
  assert.equal(report.bands.at_most_1, 1, 'bands as laid: the unmixed dab at 0');
  assert.equal(report.unmixed_nearest_delta_e_max, Math.round(exact.nearest * 100) / 100);
  assert.ok(report.unmixed_nearest_delta_e_max > STRICTNESS_LIMITS.exact);
  const looseReport = paintPlan(plan, earth, 'loose').report;
  assert.equal(looseReport.unmixed, 0);
  assert.ok(looseReport.largest_delta_e > 10);
  assert.equal(looseReport.bands.over_10, 0.5);
});

// --- the transfer ------------------------------------------------------------------------------------------------------------
const WET = 'i) Wet Paint Plus (mypaint)', BRISTLES = 'f) Bristles-2 Flat Rough';
const SHIPPED_HAS_SPECTRAL = !!CATALOG.mixing?.presets?.[WET]?.cards?.spectral;
const canvas = { width: 64, height: 64 };
const image = { width: 24, height: 24, data: Buffer.alloc(24 * 24 * 4) };
for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) image.data.set(x < 12 ? [200, 120, 40, 255] : y < 12 ? [40, 90, 200, 255] : [60 + x * 3, 150, 90 + y * 2, 255], (y * 24 + x) * 4);
const recipe = (preset: string, extra: Record<string, unknown> = {}) => ({ name: 'Still life', reference_id: 'ref', preset, source: [0, 0, 24, 24], target: [2, 2, 48, 48], steps: [6, 3, 1.5], focal_regions: [[6, 6, 12, 12]], seed: 42, ...extra });

async function studio(options: { stopAfter?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'paint-set-'));
  const ref = join(directory, 'ref.png'); await writeFile(ref, 'fixture');
  const view = join(directory, 'view.png'), pixels = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) pixels.set([110, 150, 90, 255], i * 4);
  await writeFile(view, encodeRgba({ width: 64, height: 64, data: pixels }));
  let revision = 'r0', layer = 0;
  const calls: any[] = [], receipts = new Map<string, any>(), events: any[] = [];
  const runtime: any = { config: { reference_batch: 20 }, mode: 'agent', executionPhase: 'agent', faulted: false,
    study: { directory, references: [{ id: 'ref', path: ref }] }, emit() {}, paintStepKind: () => null,
    diagnostics: { record: (event: any) => events.push(event) },
    async callNative(operation: string, params: any) {
      if (operation === 'decode_reference') return { width: 24, height: 24, rgba_base64: image.data.toString('base64'), sha256: params.sha256 };
      if (operation === 'observe') return { status: 'ok', ...canvas, revision, image_path: view, image_width: 64, image_height: 64, scale: 1 };
      if (operation === 'operation_status') return { found: receipts.has(params.id), result: receipts.get(params.id) };
      throw new Error('unexpected ' + operation);
    } };
  const execute = async (id: string, args: any) => {
    calls.push(args);
    if (options.stopAfter && calls.length === options.stopAfter) runtime.cancelRequested = true;
    const result = { status: 'ok', revision: 'r' + calls.length, layer_id: args.continue_layer_id ?? 'layer-' + (++layer), image_path: view };
    revision = result.revision; receipts.set(id, result); return { details: result };
  };
  const tools = referenceTools(runtime, execute, async () => ({ details: {} }), { catalog: () => CATALOG, policy: () => SHIPPED_POLICY });
  const find = (name: string) => tools.find((t: any) => t.name === name);
  return { runtime, calls, events, find, directory, close: () => rm(directory, { recursive: true, force: true }) };
}
const plannedColours = (preset: string) => generateReferencePlan(recipe(preset), image, canvas).passes.flatMap((p: any) => p.strokes.map((s: any) => s.color));
const sentColours = (calls: any[]) => calls.flatMap(c => c.strokes.map((s: any) => s.color));

test('a transfer without paints: colours as planned, no paint set anywhere', async () => {
  const h = await studio();
  try {
    const result = await h.find('paint_from_reference').execute('plain', recipe(BRISTLES));
    assert.deepEqual(sentColours(h.calls), plannedColours(BRISTLES));
    assert.ok(!('paint_set' in result.details));
    assert.ok(!h.events.some(e => e.type === 'transfer_paint_set'));
  } finally { await h.close(); }
});

test('a transfer with paints auto: every chunk’s colours come from recipes, the numbers are reported, the plan rebuilds identically', async () => {
  const h = await studio({ stopAfter: 3 });
  try {
    const first = await h.find('paint_from_reference').execute('auto-1', recipe(BRISTLES, { paints: 'auto' }));
    assert.equal(first.details.status, 'paused');
    const set = first.details.paint_set;
    assert.ok(set, 'the response carries the paint set');
    assert.equal(set.strictness, 'exact');
    assert.ok(set.paints.includes(TITANIUM_WHITE) && set.paints.length >= 8 && set.paints.length <= 12, `${set.paints}`);
    for (const key of ['at_most_1', 'at_most_2', 'at_most_5', 'at_most_10', 'over_10']) assert.equal(typeof set.bands[key], 'number', key);
    assert.ok(Math.abs(Object.values(set.bands as Record<string, number>).reduce((a, b) => a + b, 0) - 1) < 1e-3);
    for (const key of ['largest_delta_e', 'unmixed', 'changed_share', 'dabs', 'unmixed_nearest_delta_e_max']) assert.equal(typeof set[key], 'number', key);
    assert.ok(set.changed_share > 0, 'the paint set really changes colours');
    const event = h.events.find(e => e.type === 'transfer_paint_set');
    assert.ok(event && JSON.stringify(event.paints) === JSON.stringify(set.paints));
    // The job record keeps the concrete set, so a continuation paints the same.
    const jobs = join(h.directory, 'reference-paintings'), job = JSON.parse(await readFile(join(jobs, first.details.job_id + '.json'), 'utf8'));
    assert.deepEqual(job.paint_set.paints, set.paints);
    assert.equal(typeof job.paint_set.report.largest_delta_e, 'number');
    assert.ok(!('paints' in job.recipe) && !('strictness' in job.recipe), 'the recipe stays the generator’s');
    // Resume: the plan (with its recipe colours) is rebuilt and must hash the same, or the job refuses to continue.
    h.runtime.cancelRequested = false;
    const done = await h.find('continue_reference_painting').execute('c', { job_id: first.details.job_id });
    assert.equal(done.details.status, 'complete');
    const layer = paintSetLayer(set.paints, 'exact'), planned = plannedColours(BRISTLES), sent = sentColours(h.calls);
    assert.equal(sent.length, planned.length);
    sent.forEach((c: string, i: number) => assert.equal(c, layer(planned[i]).color, `dab ${i}`));
    assert.ok(planned.some((c: string, i: number) => c !== sent[i]));
    // Every laid colour is a recipe of the set's paints, or the reference colour where no mix reaches.
    for (const c of new Set<string>(planned)) {
      const laid = layer(c);
      if (laid.unmixed) assert.equal(laid.color, c);
      else assert.ok(laid.recipe!.paints.every(n => set.paints.includes(n)) && laid.recipe!.paints.length <= 3);
    }
  } finally { await h.close(); }
});

test('a named paint set and strictness: unknown names refused; the canvas solve is skipped with a paint set', async t => {
  const h = await studio();
  try {
    await assert.rejects(h.find('paint_from_reference').execute('bad', recipe(BRISTLES, { paints: ['Cobalt Blue', 'Mauve'] })), /Mauve/);
    const named = ['Cobalt Blue', 'Cadmium Orange', 'Burnt Sienna', TITANIUM_WHITE];
    const result = await h.find('paint_from_reference').execute('named', recipe(BRISTLES, { paints: named, strictness: 'close' }));
    assert.deepEqual(result.details.paint_set.paints, named);
    assert.equal(result.details.paint_set.strictness, 'close');
    const layer = paintSetLayer(named, 'close');
    assert.deepEqual(sentColours(h.calls), plannedColours(BRISTLES).map((c: string) => layer(c).color));
  } finally { await h.close(); }
  if (!SHIPPED_HAS_SPECTRAL) return t.skip('TOSKA_MIXING=off in this shell');
  const m = await studio();
  try {
    await m.find('paint_from_reference').execute('mixing', recipe(WET, { mixing: 'spectral', paints: ['Cobalt Blue', 'Cadmium Orange', TITANIUM_WHITE] }));
    const layer = paintSetLayer(['Cobalt Blue', 'Cadmium Orange', TITANIUM_WHITE], 'exact');
    assert.deepEqual(sentColours(m.calls), plannedColours(WET).map((c: string) => layer(c).color), 'recipe colours, not solved ones');
    assert.ok(m.calls.every(c => c.mixing === 'spectral'));
    assert.ok(!m.events.some(e => e.type === 'transfer_mixing_solve'));
  } finally { await m.close(); }
});

// --- the preview script ------------------------------------------------------------------------------------------------------
test('paint-set-preview prints the bands for a small synthetic image and writes the recipe picture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paint-set-preview-'));
  try {
    const w = 32, h = 24, data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 8, 120 + y, 200 - x * 4, 255], (y * w + x) * 4);
    const reference = join(directory, 'synthetic.png'), out = join(directory, 'preview.png');
    await writeFile(reference, encodeRgba({ width: w, height: h, data }));
    const { stdout } = await run(process.execPath, [join(ROOT, 'scripts/paint-set-preview.ts'), '--reference', reference, '--strictness', 'close', '--out', out], { cwd: ROOT });
    assert.match(stdout, /strictness close \(ΔE00 ≤ 5\)/);
    assert.match(stdout, /paints \(\d+\): .*Titanium White/);
    for (const band of ['≤1', '≤2', '≤5', '≤10', '>10']) assert.ok(stdout.includes(band), band);
    assert.match(stdout, /largest ΔE00 \d/);
    assert.match(stdout, /unmixed \d+/);
    assert.match(stdout, /changed \d/);
    const written = await stat(out);
    assert.ok(written.size > 0);
    const named = await run(process.execPath, [join(ROOT, 'scripts/paint-set-preview.ts'), '--reference', reference, '--paints', 'Cobalt Blue,Titanium White'], { cwd: ROOT });
    assert.match(named.stdout, /paints \(2\): Cobalt Blue, Titanium White/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
