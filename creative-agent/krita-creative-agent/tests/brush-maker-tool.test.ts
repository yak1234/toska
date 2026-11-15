// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// make_brush (painting-skills goal 2, task 3.4): the base preset's swatch and the new brush's, Luna's blind choice
// between them, and a brush kept only when it wins. The plugin, Luna and the library are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brushMakerTools, MOST_TRIES, type BrushMakerDependencies } from '../src/brush-maker-tool.ts';
import type { MadeBrush } from '../src/library/brushes.ts';

type Asked = { parts: unknown[]; questions: Record<string, { instructions: string; criteria: Record<string, string> }> };

function harness(options: { luna?: 'made' | 'base' | 'same' | 'fallback' | null; same?: boolean; random?: number; engine?: string; reject?: string } = {}) {
  const swatches: Record<string, unknown>[] = [], asked: Asked[] = [], saved: { brush: MadeBrush; swatch: string }[] = [], events: Record<string, unknown>[] = [], crops: unknown[] = [];
  const dependencies: BrushMakerDependencies = {
    folder: () => '/chat',
    swatch: async params => {
      swatches.push(params);
      if (options.reject && params.recipe) return { status: 'rejected', error: options.reject };
      return { status: 'ok', path: String(params.out_path), engine: options.engine ?? 'paintbrush', ink_share: 0.1 };
    },
    picture: async path => ({ type: 'image', mimeType: 'image/png', data: options.same ? 'same' : 'picture-of-' + path.split('/').at(-1) }),
    crop: async request => { crops.push(request); return { type: 'image', mimeType: 'image/jpeg', data: 'crop' }; },
    luna: async () => options.luna === null ? null : { decide: async request => {
      asked.push(request as unknown as Asked);
      if (options.luna === 'fallback') return { fallback: 'timeout' as const, elapsed_ms: 1 };
      // Which letter holds the made brush's sheet is read from the parts, as Luna would see them.
      const parts = request.parts as unknown[];
      const letterOfMade = parts[parts.findIndex(p => typeof p === 'object' && p !== null && (p as { data: string }).data === 'picture-of-made.png') - 1];
      const made = String(letterOfMade).includes('A') ? 'A' : 'B', base = made === 'A' ? 'B' : 'A';
      const choice = options.luna === 'base' ? base : options.luna === 'same' ? 'same' : made;
      return { answers: { closer: { type: 'choice' as const, choice, confidence: 0.9 } }, model: 'm', elapsed_ms: 1, usage: { input_tokens: 0, output_tokens: 0, cost: 0 } };
    } },
    save: async (brush, swatch) => { saved.push({ brush, swatch }); },
    random: () => options.random ?? 0.1,
    now: () => '2026-11-15T10:00:00.000Z',
  };
  const [tool] = brushMakerTools({ emit: event => events.push(event) }, dependencies);
  const make = async (args: Record<string, unknown> = {}) => {
    const result = await tool.execute('call-1', { material: 'soft-pastel', name: 'stick-side', mark: 'A broad grainy drag.', base: 'b) Basic-5 Size',
      settings: { tip: { shape: 'rectangle', ratio: 0.3 } }, ...args } as never, undefined, undefined, undefined as never);
    const text = result.content.find(c => c.type === 'text') as { text: string };
    return { result, report: JSON.parse(text.text).brush as Record<string, any>, images: result.content.filter(c => c.type === 'image') };
  };
  return { make, swatches, asked, saved, events, crops, tool };
}

test('a brush Luna prefers to its base is kept: both sheets painted, the choice blind, the brush saved with its swatch', async () => {
  const h = harness({ luna: 'made' });
  const { report, images } = await h.make();
  assert.deepEqual(h.swatches.map(s => [s.preset ?? (s.recipe as { base_preset: string }).base_preset, String(s.out_path).split('/').at(-1), s.size]),
    [['b) Basic-5 Size', 'base.png', 60], ['b) Basic-5 Size', 'made.png', 60]]);
  assert.ok(String(h.swatches[0].out_path).startsWith('/chat/brush-builds/'));
  assert.equal((h.swatches[1].recipe as { tip: { mask: { type: string } } }).tip.mask.type, 'rect');
  assert.equal(h.asked.length, 1);
  const { parts, questions } = h.asked[0];
  assert.match(questions.closer.instructions, /A broad grainy drag\./);
  assert.deepEqual(Object.keys(questions.closer.criteria), ['A', 'B', 'same']);
  assert.ok(!JSON.stringify(parts.filter(p => typeof p === 'string')).match(/base|made|preset|rectangle/i), 'nothing tells Luna which sheet is which');
  assert.deepEqual([report.kept, report.brush, report.judged_by, report.luna, report.tries_left], [true, 'soft-pastel/stick-side', 'luna', 'chose the new brush', MOST_TRIES - 1]);
  assert.equal(h.saved.length, 1);
  assert.deepEqual({ ...h.saved[0].brush }, { material: 'soft-pastel', name: 'stick-side', mark: 'A broad grainy drag.', base: 'b) Basic-5 Size',
    engine: 'paintbrush', size: 60, settings: { tip: { shape: 'rectangle', ratio: 0.3 } }, judged_by: 'luna', learned_from: [], made_at: '2026-11-15T10:00:00.000Z' });
  assert.ok(h.saved[0].swatch.endsWith('/made.png'));
  assert.deepEqual(images.map(i => (i as { data: string }).data), ['picture-of-base.png', 'picture-of-made.png'], 'the painter sees the base sheet, then the new one');
});

test('which sheet is A is drawn each time, and the answer is read against that', async () => {
  for (const random of [0.1, 0.9]) {
    const h = harness({ luna: 'made', random });
    const { report } = await h.make();
    const letters = h.asked[0].parts.filter(p => typeof p === 'string' && /^Sheet [AB]:$/.test(p as string));
    assert.deepEqual(letters, ['Sheet A:', 'Sheet B:']);
    const first = h.asked[0].parts[h.asked[0].parts.indexOf('Sheet A:') + 1] as { data: string };
    assert.equal(first.data, random < 0.5 ? 'picture-of-made.png' : 'picture-of-base.png');
    assert.equal(report.kept, true);
  }
});

test('a brush Luna does not prefer is not saved, and says how many tries are left', async () => {
  for (const luna of ['base', 'same'] as const) {
    const h = harness({ luna });
    const { report } = await h.make();
    assert.deepEqual([report.kept, report.tries_left, h.saved.length], [false, MOST_TRIES - 1, 0]);
    assert.match(report.note, /^Not kept/);
  }
});

test('after four tries that never win the brush is refused, and the failure is recorded', async () => {
  const h = harness({ luna: 'base' });
  for (let i = 0; i < MOST_TRIES; i++) assert.equal((await h.make()).report.kept, false);
  await assert.rejects(h.make(), /4 tries.*stroke/);
  assert.equal(h.swatches.length, MOST_TRIES * 2, 'the fifth call painted nothing');
  assert.ok(h.events.some(e => e.type === 'brush_failed' && e.brush === 'soft-pastel/stick-side'));
  assert.equal((await h.make({ name: 'other-brush' })).report.tries_left, MOST_TRIES - 1, 'another brush has its own tries');
});

test('without a decision model, or without an answer, the brush is kept unjudged and says so', async () => {
  for (const luna of [null, 'fallback'] as const) {
    const h = harness({ luna });
    const { report } = await h.make();
    assert.deepEqual([report.kept, report.judged_by, h.saved[0].brush.judged_by], [true, 'unjudged', 'unjudged']);
    assert.match(report.note, /not judged/);
  }
});

test('settings that change nothing are not a brush', async () => {
  const h = harness({ luna: 'made', same: true });
  const { report } = await h.make();
  assert.deepEqual([report.kept, h.asked.length, h.saved.length], [false, 0, 0]);
  assert.match(report.note, /same marks/);
});

test('a close-up of the reference is shown to Luna first when a crop is given', async () => {
  const h = harness({ luna: 'made' });
  await h.make({ crop: { reference_id: 'reference-1', rect: [10, 20, 300, 200] } });
  assert.deepEqual(h.crops, [{ reference_id: 'reference-1', rect: [10, 20, 300, 200] }]);
  const parts = h.asked[0].parts;
  assert.ok(parts.findIndex(p => (p as { data?: string })?.data === 'crop') < parts.indexOf('Sheet A:'));
  assert.match(h.asked[0].questions.closer.instructions, /close-up/);
});

test('what is refused before anything is painted', async () => {
  const h = harness({ luna: 'made' });
  await assert.rejects(h.make({ name: 'Stick Side' }), /lowercase/);
  await assert.rejects(h.make({ material: 'crayon' }), /material/);
  assert.equal(h.swatches.length, 0);
  await assert.rejects(h.make({ settings: { tip: { ratio: 7 } } }), /tip\.ratio/);
  assert.equal(h.swatches.length, 1, 'only the base sheet, which tells the engine');
  assert.equal(harness().tool.name, 'make_brush');
});

test('an engine with no vocabulary, and a swatch Krita refuses, are errors that name the cause', async () => {
  await assert.rejects(harness({ engine: 'hairybrush' }).make(), /hairybrush/);
  await assert.rejects(harness({ reject: 'no such pattern' }).make(), /no such pattern/);
});
