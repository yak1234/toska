// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Sharpen patch references (src/reference-sharpen.ts): a reference a transfer would stretch past 2x becomes its 4x
// sharpened picture (same id, larger pixels). Fakes stand in for the sharpening worker and the plugin; temporary folders only.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { referenceSharpener, scaleRect, sharpenedNote, type SharpenReferenceHost } from '../src/reference-sharpen.ts';
import { UPSCALE_MODEL } from '../src/upscale/model.ts';
import { MAX_INPUT_PIXELS } from '../src/upscale/core.ts';
import { modelDirectory } from '../src/shapes/model.ts';
import { UpscaleError, type UpscaleInput, type UpscaleService } from '../src/upscale/index.ts';
import { TRANSFER_PIXELS } from '../src/closeups.ts';
import type { GoalReference } from '../src/goal-sharpen.ts';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const BYTES = Buffer.from('dock reference bytes');

async function setup(t: TestContext, { size = [616, 400] as [number, number], setting = 'always' as 'always' | 'ask' | 'never', fail = null as Error | null, out = [2464, 1600] as [number, number] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'reference-sharpen-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const chat = join(root, 'chat'), data = join(root, 'data');
  await mkdir(chat, { recursive: true });
  const file = join(chat, 'asset-dock.png');
  await writeFile(file, BYTES);
  const dir = modelDirectory(data, UPSCALE_MODEL);
  await mkdir(dir, { recursive: true });
  for (const f of UPSCALE_MODEL.files) await writeFile(join(dir, f.name), Buffer.alloc(0));
  await writeFile(join(dir, 'verified.json'), JSON.stringify({ revision: UPSCALE_MODEL.revision, files: Object.fromEntries(UPSCALE_MODEL.files.map(f => [f.name, f.sha256])) }));
  const reference: GoalReference & { bounds?: number[] } = { id: 'asset-dock', path: file, width: size[0], height: size[1], mimeType: 'image/png', role: 'asset', purpose: 'material', name: 'Left side: empty dock', mass_map: { version: 2 } };
  const study = { id: 'chat-1', directory: chat, references: [reference] };
  const state = { persisted: 0, published: 0 }, jobs: UpscaleInput[] = [];
  const host: SharpenReferenceHost = {
    get study() { return study; }, setting: () => setting, dataDir: () => data,
    persist: async () => { state.persisted++; }, publish: () => { state.published++; },
    async callNative(operation, params) {
      if (operation !== 'decode_reference') throw new Error('unexpected ' + operation);
      return { width: size[0], height: size[1], sha256: params.sha256, rgba_base64: Buffer.alloc(size[0] * size[1] * 4, 200).toString('base64') };
    },
  };
  const service: UpscaleService = { async upscale(input, options) {
    jobs.push(input);
    if (fail) throw fail;
    options?.onProgress?.(1, 2); options?.onProgress?.(2, 2);
    await writeFile(input.outputs.full, 'full'); await writeFile(input.outputs.reference, 'reference'); await writeFile(input.outputs.compare, 'compare');
    return { ms: 9000, load_ms: 1000, peak_mb: 900, provider: 'coreml', tiles: 12, ms_per_tile: 50, full: { width: input.width * 4, height: input.height * 4 },
      reference: { width: out[0], height: out[1], path: input.outputs.reference, bytes: 9 }, compare: { width: 100, height: 50, crop: [0, 0, 10] } } as Awaited<ReturnType<UpscaleService['upscale']>>;
  } };
  const spec = { ...UPSCALE_MODEL, files: UPSCALE_MODEL.files.map(f => ({ ...f, size: 0 })) };
  return { sharpener: referenceSharpener(host, { spec, service }), reference, study, state, jobs, chat, data, file };
}

test('a reference becomes its sharpened picture: same id, larger pixels, what it was recorded', async t => {
  const { sharpener, reference, state, jobs, chat, file } = await setup(t);
  assert.equal(sharpener.refusal(reference), null);
  const seen: number[] = [];
  const done = await sharpener.sharpen(reference, { onProgress: (a, b) => seen.push(a / b) });
  assert.deepEqual(seen, [0.5, 1]);
  assert.equal(done.scale, 4);
  assert.deepEqual(done.was, [616, 400]);
  assert.equal(reference.id, 'asset-dock');
  assert.deepEqual([reference.width, reference.height, reference.mimeType], [2464, 1600, 'image/png']);
  assert.equal(reference.path, join(chat, 'goal-sharpen', sha(BYTES).slice(0, 16) + '.reference.png'));
  assert.equal(await readFile(reference.path, 'utf8'), 'reference');
  assert.deepEqual(reference.sharpened?.from, { path: file, width: 616, height: 400, sha256: sha(BYTES), mimeType: 'image/png' });
  assert.equal(reference.sharpened?.scale, 4);
  assert.equal(reference.sharpened?.model, UPSCALE_MODEL.name);
  assert.equal(reference.mass_map, undefined, 'read again from the new pixels');
  assert.deepEqual([state.persisted, state.published], [1, 1]);
  assert.deepEqual([jobs[0]!.width, jobs[0]!.height, jobs[0]!.max_pixels], [616, 400, TRANSFER_PIXELS]);
  assert.match(done.note, /"Left side: empty dock" was sharpened 4x.*2464 x 1600 \(they were 616 x 400\).*multiply any earlier rect by 4/);
  assert.match(sharpener.refusal(reference) ?? '', /already sharpened/);
  await assert.rejects(sharpener.sharpen(reference), /already sharpened/);
});

test('a reference larger than the sharpener takes is reduced to it first (Istanbul: 2175 x 1450)', async t => {
  const { sharpener, reference, jobs } = await setup(t, { size: [2175, 1450], out: [6245, 4163] });
  assert.equal(sharpener.refusal(reference), null);
  const done = await sharpener.sharpen(reference);
  const sent = jobs[0]!;
  assert.ok(sent.width * sent.height <= MAX_INPUT_PIXELS && sent.width * sent.height > MAX_INPUT_PIXELS * 0.99, `${sent.width} x ${sent.height}`);
  assert.equal(sent.rgba.length, sent.width * sent.height * 4);
  assert.ok(Math.abs(sent.width / sent.height - 1.5) < 0.01);
  assert.equal(done.scale, 6245 / 2175);
  assert.deepEqual([reference.width, reference.height], [6245, 4163]);
});

test('Never, a part, the whole-picture goal and a missing size are not sharpened', async t => {
  const never = await setup(t, { setting: 'never' });
  assert.match(never.sharpener.refusal(never.reference) ?? '', /Sharpen the goal.*Never/);
  await assert.rejects(never.sharpener.sharpen(never.reference), /Never/);
  const { sharpener, reference } = await setup(t, { setting: 'ask' });
  assert.equal(sharpener.refusal(reference), null, 'Ask sharpens: there is no card for a patch');
  assert.match(sharpener.refusal({ ...reference, part_kind: 'part' }) ?? '', /part/);
  assert.match(sharpener.refusal({ ...reference, source: 'folder', role: 'reference' }) ?? '', /goal/);
  assert.match(sharpener.refusal({ ...reference, width: 0 }) ?? '', /size/);
  assert.equal(reference.sharpened, undefined);
});

test('a failure leaves the reference as it was; Stop is honoured', async t => {
  const failed = await setup(t, { fail: new UpscaleError('out_of_memory', 'Sharpening ran out of memory. Close some apps and try again.') });
  await assert.rejects(failed.sharpener.sharpen(failed.reference), /out of memory/);
  assert.deepEqual([failed.reference.width, failed.reference.path, failed.reference.sharpened, failed.state.persisted], [616, failed.file, undefined, 0]);
  const stopped = await setup(t), controller = new AbortController();
  controller.abort();
  await assert.rejects(stopped.sharpener.sharpen(stopped.reference, { signal: controller.signal }));
  assert.equal(stopped.jobs.length, 0);
  assert.equal(stopped.reference.sharpened, undefined);
});

test('the reference changed on disk since it was listed: not sharpened', async t => {
  const { sharpener, reference, file, state } = await setup(t);
  await writeFile(file, 'other bytes');
  // The plugin answers for the bytes it was given; the size it reports no longer matches the listed one.
  reference.width = 700;
  await assert.rejects(sharpener.sharpen(reference), /changed/);
  assert.equal(state.persisted, 0);
});

test('rects scale with the picture and stay inside it', () => {
  assert.deepEqual(scaleRect([0, 0, 616, 1232], 4, { width: 2464, height: 4928 }), [0, 0, 2464, 4928]);
  assert.deepEqual(scaleRect([100, 50, 516, 350], 3.5, { width: 2156, height: 1400 }), [350, 175, 1806, 1225]);
  assert.deepEqual(scaleRect([600, 390, 16, 10], 4, { width: 2460, height: 1598 }), [2400, 1560, 60, 38], 'clamped to the picture');
  assert.match(sharpenedNote({ name: 'Dock', width: 2464, height: 1600, sharpened: { from: { width: 616, height: 400 } } }) ?? '', /"Dock" was sharpened 4x/);
  assert.equal(sharpenedNote({ name: 'Dock', width: 616, height: 400 }), null);
});
