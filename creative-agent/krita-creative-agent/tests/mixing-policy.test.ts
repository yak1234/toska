// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The mixing policy (colour-mixing amendment 2026-11-01): a bundled YAML decides each paint pass's mixing model by the
// kind of pass, applied only where the preset has a measured card. Pure functions and fake tools; writes no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMixingPolicy, mixingPolicyOrRgb, policyModel, derivePassKind, resolvePassKind, referencePassKind, PASS_KINDS, RGB_POLICY, SHIPPED_POLICY } from '../src/colour-mixing/mixing-policy.ts';
import type { PassKind } from '../src/colour-mixing/mixing-policy.ts';
import { passMixing, withMixing } from '../src/colour-mixing/pass-mixing.ts';
import { effectiveCatalog, CATALOG } from '../src/brush-catalog.mjs';
import { paintingTools } from '../src/tools.mjs';

const RAW = JSON.parse(readFileSync(new URL('../src/brush-catalog.json', import.meta.url), 'utf8'));
const WET = 'i) Wet Paint Plus (mypaint)', KNIFE = 'i) Wet Knife Plus (mypaint)', BASIC = 'b) Basic-1';
const SHIPPED_TEXT = readFileSync(new URL('../src/colour-mixing/mixing-policy.yaml', import.meta.url), 'utf8');
const policy = loadMixingPolicy(SHIPPED_TEXT);

test('the shipped YAML loads, every kind mapping as the file says', () => {
  assert.equal(policy.version, 1);
  assert.equal(policy.default, 'rgb');
  assert.deepEqual(policy.kinds, { underpainting: 'rgb', block_in: 'rgb', finish: 'spectral', refine: 'spectral', blend: 'spectral',
    glaze: 'spectral', atmosphere: 'spectral', element: 'spectral', details: 'rgb', accents: 'rgb', reference_transfer: 'spectral' });
  assert.deepEqual(Object.keys(policy.kinds).sort(), [...PASS_KINDS].sort());
  assert.deepEqual(SHIPPED_POLICY, policy, 'the bundled file is what the companion reads');
  assert.deepEqual(loadMixingPolicy(), policy, 'no text: the bundled file');
});

test('the policy model applies only where the preset has a measured card', () => {
  for (const kind of PASS_KINDS) {
    assert.equal(policyModel(policy, kind, WET, RAW), policy.kinds[kind], `${kind} with Wet Paint Plus (spectral card)`);
    assert.equal(policyModel(policy, kind, BASIC, RAW), 'rgb', `${kind} with a preset that has no card`);
  }
  assert.equal(policyModel(policy, 'finish', 'no such preset', RAW), 'rgb');
  assert.equal(policyModel(policy, undefined, WET, RAW), 'rgb', 'no kind: the default');
  assert.equal(policyModel(policy, 'sculpting' as PassKind, WET, RAW), 'rgb', 'unknown kind: the default');
  const spectralDefault = loadMixingPolicy(SHIPPED_TEXT.replace('default: rgb', 'default: spectral'));
  assert.equal(policyModel(spectralDefault, undefined, WET, RAW), 'spectral', 'the default is a policy value too');
});

test('passMixing: explicit mixing wins, then the policy for the pass kind, then rgb; rgb sends nothing', () => {
  assert.deepEqual(passMixing({ preset: WET, kind: 'finish' }, RAW, policy), { mixing_model: 'spectral' });
  assert.deepEqual(passMixing({ preset: WET, kind: 'underpainting' }, RAW, policy), {});
  assert.deepEqual(passMixing({ preset: BASIC, kind: 'finish' }, RAW, policy), {}, 'no card: rgb even for a finish');
  assert.deepEqual(passMixing({ preset: WET }, RAW, policy), {}, 'no kind: the default (rgb)');
  assert.deepEqual(passMixing({ preset: WET, kind: 'finish', mixing: 'rgb' }, RAW, policy), {}, 'explicit rgb over the policy');
  assert.deepEqual(passMixing({ preset: WET, kind: 'underpainting', mixing: 'spectral' }, RAW, policy), { mixing_model: 'spectral' }, 'explicit spectral over the policy');
  const refused = passMixing({ preset: BASIC, kind: 'finish', mixing: 'spectral' }, RAW, policy);
  assert.ok('error' in refused, 'explicit mixing is still refused without a card');
});

test('TOSKA_MIXING=off: rgb for every kind and preset', () => {
  const off = effectiveCatalog(RAW, { TOSKA_MIXING: 'off' });
  for (const kind of PASS_KINDS) for (const preset of [WET, KNIFE, BASIC]) {
    assert.equal(policyModel(policy, kind, preset, off), 'rgb');
    assert.deepEqual(passMixing({ preset, kind }, off, policy), {});
  }
});

test('an invalid policy is an error naming the field, and the companion falls back to rgb everywhere', () => {
  const cases: [string, RegExp][] = [
    [SHIPPED_TEXT.replace('  glaze: spectral', '  glazing: spectral'), /kinds\.glazing/],
    [SHIPPED_TEXT.replace('  finish: spectral', '  finish: watercolour'), /kinds\.finish/],
    [SHIPPED_TEXT.replace('version: 1\n', ''), /version/],
    [SHIPPED_TEXT.replace('version: 1', 'version: 2'), /version/],
    [SHIPPED_TEXT.replace('default: rgb', 'default: oil'), /default/],
    ['kinds: [1, 2', /YAML|mixing policy/i],
  ];
  for (const [text, field] of cases) {
    assert.throws(() => loadMixingPolicy(text), field);
    const fallback = mixingPolicyOrRgb(text);
    assert.match(String(fallback.error), field);
    assert.deepEqual(fallback.policy, RGB_POLICY);
    for (const kind of PASS_KINDS) assert.equal(policyModel(fallback.policy, kind, WET, RAW), 'rgb');
  }
  assert.deepEqual(mixingPolicyOrRgb(SHIPPED_TEXT), { policy, error: null });
  assert.ok(Object.values(RGB_POLICY.kinds).every(model => model === 'rgb'));
});

test('the pass kind derivation table: tool, then plan step kind, then the preset job', () => {
  const cases: [{ tool?: string; step?: string | null; preset?: string }, PassKind][] = [
    [{ tool: 'paint_from_reference', preset: WET }, 'reference_transfer'],
    [{ tool: 'continue_reference_painting', step: 'refine', preset: WET }, 'reference_transfer'],
    [{ tool: 'paint_reference_surface', preset: 'k) Blender Smear' }, 'blend'],
    [{ tool: 'paint_reference_edges', preset: 'd) Ink-3 Gpen' }, 'details'],
    [{ tool: 'paint_finish' }, 'finish'],
    [{ tool: 'paint_accents' }, 'accents'],
    [{ tool: 'refine_to_goal' }, 'refine'],
    [{ tool: 'paint_pass', step: 'refine', preset: WET }, 'refine'],
    [{ tool: 'paint_pass', step: 'refine_part', preset: WET }, 'refine'],
    [{ tool: 'paint_pass', step: 'underpainting', preset: WET }, 'underpainting'],
    [{ tool: 'paint_pass', step: 'finish', preset: BASIC }, 'finish'],
    [{ tool: 'paint_pass', step: 'accents', preset: WET }, 'accents'],
    [{ tool: 'paint_pass', step: 'element', preset: WET }, 'element'],
    [{ tool: 'paint_pass', step: 'addition', preset: WET }, 'element'],
    [{ tool: 'paint_pass', step: 'whole', preset: 'k) Blender Basic' }, 'blend'],
    [{ tool: 'paint_pass', preset: 'k) Blender Basic' }, 'blend'],
    [{ tool: 'paint_pass', preset: 'b) Basic-4 Flow Opacity' }, 'glaze'],
    [{ tool: 'paint_pass', preset: 'b) Airbrush Soft' }, 'atmosphere'],
    [{ tool: 'paint_pass', preset: 'h) Chalk Details' }, 'details'],
    [{ tool: 'paint_pass', preset: 'd) Ink-2 Fineliner' }, 'details'],
    [{ tool: 'paint_pass', preset: KNIFE }, 'details'],
    [{ tool: 'paint_pass', preset: WET }, 'block_in'],
    [{ tool: 'paint_pass', preset: 'f) Bristles-2 Flat Rough' }, 'block_in'],
    [{ tool: 'paint_batch', preset: 'not in the catalog' }, 'block_in'],
    [{}, 'block_in'],
  ];
  for (const [input, kind] of cases) assert.equal(derivePassKind(input, RAW), kind, JSON.stringify(input));
  // The two cases the brief names end to end: Wet Paint Plus in a refine step mixes spectral, in an underpainting rgb.
  assert.equal(policyModel(policy, derivePassKind({ tool: 'paint_pass', step: 'refine', preset: WET }, RAW), WET, RAW), 'spectral');
  // The reference transfer mixes (amendment 2026-11-01 (2)), but only with a carded preset: the default Bristles keep rgb.
  assert.equal(policyModel(policy, derivePassKind({ tool: 'paint_from_reference', preset: WET }, RAW), WET, RAW), 'spectral');
  assert.equal(policyModel(policy, derivePassKind({ tool: 'paint_from_reference', preset: 'f) Bristles-2 Flat Rough' }, RAW), 'f) Bristles-2 Flat Rough', RAW), 'rgb');
  assert.equal(policyModel(policy, derivePassKind({ tool: 'paint_pass', step: 'underpainting', preset: WET }, RAW), WET, RAW), 'rgb');
});

const fakePass = (seen: any[]) => ({ name: 'paint_pass', parameters: {},
  execute: async (_id: string, args: any) => { seen.push(args); return { content: [{ type: 'text', text: '{}' }], details: { status: 'ok' } }; } });

test('withMixing with a policy: the step kind, an explicit pass_kind (stripped), else the preset job (its card when carded)', async () => {
  const seen: any[] = [];
  let step: string | null = 'refine';
  const pass = withMixing(fakePass(seen) as any, () => RAW, { policy: () => policy, stepKind: () => step, resolve: resolvePassKind });
  await pass.execute('a', { name: 'A', preset: WET, strokes: [] });
  step = 'underpainting';
  await pass.execute('b', { name: 'B', preset: WET, strokes: [] });
  await pass.execute('c', { name: 'C', preset: WET, strokes: [], pass_kind: 'finish' });
  step = null;
  await pass.execute('d', { name: 'D', preset: WET, strokes: [] });
  await pass.execute('e', { name: 'E', preset: WET, strokes: [], mixing: 'spectral' });
  await pass.execute('f', { name: 'F', preset: WET, strokes: [], pass_kind: 'underpainting' });
  // d: no plan step, so the kind is derived from Wet Paint Plus's job (block_in) and its spectral card decides (pilot 5).
  assert.deepEqual(seen.map(a => a.mixing_model), ['spectral', undefined, 'spectral', 'spectral', 'spectral', undefined]);
  assert.ok(seen.every(a => !('pass_kind' in a) && !('mixing' in a)), 'the plugin never sees pass_kind or mixing');
});

test('the painting tools apply the shipped policy: a paint_pass in a refine step sends spectral, in an underpainting nothing', async () => {
  const calls: any[] = [];
  let step: string | null = 'refine';
  const runtime = { faulted: false, mode: 'agent', executionPhase: 'agent', study: { directory: '/nonexistent', references: [] }, emit() {},
    paintStepKind: () => step,
    async callNative(operation: string, params: any) { calls.push({ operation, params }); return { status: 'ok', revision: 1, layer_id: 'l' }; } };
  const tools = paintingTools(runtime);
  const pass = tools.find(t => t.name === 'paint_pass')!;
  const stroke = { start: [10, 10], segments: [[12, 12, 18, 18, 20, 20]], opacity: 1, flow: 1, color: '#336699', size: 8 };
  await pass.execute('p1', { name: 'A', preset: WET, strokes: [stroke] }, undefined as any, undefined as any);
  step = 'underpainting';
  await pass.execute('p2', { name: 'B', preset: WET, strokes: [stroke] }, undefined as any, undefined as any);
  const sent = calls.filter(c => c.operation === 'paint_pass' || c.params?.operation === 'paint_pass');
  assert.equal(sent.length, 2, JSON.stringify(calls.map(c => c.operation)));
  const params = sent.map(c => c.params?.params ?? c.params);
  const expected = CATALOG.mixing?.presets?.[WET]?.cards?.spectral ? 'spectral' : undefined;   // TOSKA_MIXING=off in the shell: rgb
  assert.equal(params[0].mixing_model, expected);
  assert.equal(params[1].mixing_model, undefined);
  // paint_batch captures the same execute: its passes follow the step too.
  step = 'finish'; calls.length = 0;
  const batch = tools.find(t => t.name === 'paint_batch')!;
  await batch.execute('b1', { actions: [{ tool: 'paint_pass', arguments: { name: 'C', preset: WET, strokes: [stroke] } },
    { tool: 'paint_pass', arguments: { name: 'D', preset: BASIC, strokes: [stroke] } }] }, undefined as any, undefined as any);
  const batched = calls.filter(c => c.operation === 'paint_pass').map(c => c.params);
  assert.deepEqual(batched.map(p => p.mixing_model), [expected, undefined]);
  assert.ok(batched.every(p => !('pass_kind' in p)));
});

test('reference transfer jobs carry their kind: a transfer is reference_transfer, surface blends, edges are details', () => {
  assert.equal(referencePassKind(undefined), 'reference_transfer');
  assert.equal(referencePassKind('surface'), 'blend');
  assert.equal(referencePassKind('edges'), 'details');
  assert.equal(policyModel(policy, referencePassKind(undefined), WET, RAW), 'spectral', 'Wet Paint Plus in the transfer: spectral (it has a card)');
  assert.equal(policyModel(policy, referencePassKind(undefined), 'f) Bristles-2 Flat Rough', RAW), 'rgb', 'a transfer brush without a card: rgb');
  assert.equal(policyModel(policy, referencePassKind(undefined), WET, effectiveCatalog(RAW, { TOSKA_MIXING: 'off' })), 'rgb', 'TOSKA_MIXING=off: rgb');
  assert.equal(policy.kinds.underpainting, 'rgb', 'underpainting and block_in stay rgb');
  assert.equal(policy.kinds.block_in, 'rgb');
});

// Pilot 5 (local-notes/benchmarks/colour-mixing/pilot-p5): with no plan step a pass's kind came from the preset's first
// catalog job, so Wet Paint Plus (block_in) and Wet Knife Plus (details), the only carded presets, never mixed. A kind that
// is only derived from the preset's job now yields to the preset's measured card; an explicit kind keeps the policy table.
const AIRBRUSH = 'b) Airbrush Soft';

test('derived kind: a preset with a measured card uses its card model; explicit kinds follow the policy table', () => {
  assert.deepEqual(passMixing({ preset: WET, kind: 'block_in', kind_source: 'derived' }, RAW, policy), { mixing_model: 'spectral' }, 'derived + Wet Paint Plus');
  assert.deepEqual(passMixing({ preset: KNIFE, kind: 'details', kind_source: 'derived' }, RAW, policy), { mixing_model: 'spectral' }, 'derived + Wet Knife Plus');
  assert.deepEqual(passMixing({ preset: KNIFE, kind: 'details', kind_source: 'plan' }, RAW, policy), {}, 'plan details + Wet Knife Plus: rgb');
  assert.deepEqual(passMixing({ preset: KNIFE, kind: 'details', kind_source: 'stated' }, RAW, policy), {}, 'stated details + Wet Knife Plus: rgb');
  assert.deepEqual(passMixing({ preset: WET, kind: 'underpainting', kind_source: 'plan' }, RAW, policy), {}, 'plan underpainting: rgb');
  assert.deepEqual(passMixing({ preset: AIRBRUSH, kind: 'atmosphere', kind_source: 'derived' }, RAW, policy), {}, 'derived + Airbrush Soft (no card): rgb');
  assert.deepEqual(passMixing({ preset: WET, kind: 'block_in', kind_source: 'derived', mixing: 'rgb' }, RAW, policy), {}, 'explicit rgb still wins');
  const off = effectiveCatalog(RAW, { TOSKA_MIXING: 'off' });
  for (const preset of [WET, KNIFE, AIRBRUSH]) assert.deepEqual(passMixing({ preset, kind: 'block_in', kind_source: 'derived' }, off, policy), {}, `TOSKA_MIXING=off: ${preset} rgb`);
});

test('resolvePassKind names where the kind came from: stated, plan or derived', () => {
  assert.deepEqual(resolvePassKind({ tool: 'paint_pass', stated: 'finish', step: 'underpainting', preset: WET }, RAW), { kind: 'finish', source: 'stated' });
  assert.deepEqual(resolvePassKind({ tool: 'paint_pass', step: 'accents', preset: KNIFE }, RAW), { kind: 'accents', source: 'plan' });
  assert.deepEqual(resolvePassKind({ tool: 'paint_pass', step: 'whole', preset: KNIFE }, RAW), { kind: 'details', source: 'derived' });
  assert.deepEqual(resolvePassKind({ tool: 'paint_pass', step: null, preset: WET }, RAW), { kind: 'block_in', source: 'derived' });
});

test('paint_batch with no plan step: each pass gets its own model, and a pass_mixing diagnostic carries kind_source', async () => {
  const calls: any[] = [], events: any[] = [];
  const runtime = { faulted: false, mode: 'agent', executionPhase: 'agent', study: { directory: '/nonexistent', references: [] }, emit() {},
    paintStepKind: () => null, diagnostics: { record: (event: any) => events.push(event) },
    async callNative(operation: string, params: any) { calls.push({ operation, params }); return { status: 'ok', revision: 1, layer_id: 'l' }; } };
  const tools = paintingTools(runtime);
  const stroke = { start: [10, 10], segments: [[12, 12, 18, 18, 20, 20]], opacity: 1, flow: 1, color: '#336699', size: 8 };
  const batch = tools.find(t => t.name === 'paint_batch')!;
  await batch.execute('b1', { actions: [{ tool: 'paint_pass', arguments: { name: 'Lake', preset: WET, strokes: [stroke] } },
    { tool: 'paint_pass', arguments: { name: 'Mist', preset: AIRBRUSH, strokes: [stroke] } },
    { tool: 'paint_pass', arguments: { name: 'Glints', preset: KNIFE, strokes: [stroke] } }] }, undefined as any, undefined as any);
  const carded = !!CATALOG.mixing?.presets?.[WET]?.cards?.spectral;   // TOSKA_MIXING=off in the shell: rgb
  const batched = calls.filter(c => c.operation === 'paint_pass').map(c => c.params);
  assert.deepEqual(batched.map(p => p.mixing_model), carded ? ['spectral', undefined, 'spectral'] : [undefined, undefined, undefined]);
  assert.ok(batched.every(p => !('kind_source' in p) && !('pass_kind' in p)), 'the plugin never sees the decision fields');
  const decided = events.filter(e => e.type === 'pass_mixing');
  assert.deepEqual(decided.map(e => [e.preset, e.kind, e.kind_source, e.model]), [
    [WET, 'block_in', 'derived', carded ? 'spectral' : 'rgb'],
    [AIRBRUSH, 'atmosphere', 'derived', 'rgb'],
    [KNIFE, 'details', 'derived', carded ? 'spectral' : 'rgb'],
  ]);
  assert.ok(decided.every(e => typeof e.reason === 'string' && e.reason.length > 0), 'each decision says why');
});

test('withMixing reports its decision in the result details: stated details and a plan accents step keep Wet Knife Plus rgb', async () => {
  const seen: any[] = [];
  let step: string | null = null;
  const pass = withMixing(fakePass(seen) as any, () => RAW, { policy: () => policy, stepKind: () => step, resolve: resolvePassKind });
  const stated = await pass.execute('k', { name: 'K', preset: KNIFE, strokes: [], pass_kind: 'details' });
  step = 'accents';
  const planned = await pass.execute('l', { name: 'L', preset: KNIFE, strokes: [] });
  step = null;
  const derived = await pass.execute('m', { name: 'M', preset: KNIFE, strokes: [] });
  assert.deepEqual(seen.map(a => a.mixing_model), [undefined, undefined, 'spectral']);
  const strip = (d: any) => ({ ...d, reason: typeof d.reason });
  assert.deepEqual(strip(stated.details.pass_mixing), { preset: KNIFE, kind: 'details', kind_source: 'stated', model: 'rgb', reason: 'string' });
  assert.deepEqual(strip(planned.details.pass_mixing), { preset: KNIFE, kind: 'accents', kind_source: 'plan', model: 'rgb', reason: 'string' });
  assert.deepEqual(strip(derived.details.pass_mixing), { preset: KNIFE, kind: 'details', kind_source: 'derived', model: 'spectral', reason: 'string' });
});
