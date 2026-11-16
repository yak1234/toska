// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Repaint from asset (openspec repaint-from-asset 2.1): the tool over a stand-in host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repaintTools, type RepaintHost, type AssetRef } from '../src/repaint-from-asset.ts';
import type { Shape } from '../src/asset-fit.ts';

const box = (x: number, y: number, w: number, h: number, inside: (i: number, j: number) => boolean = () => true): Shape => {
  const data = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = inside(i, j) ? 255 : 0;
  return { bounds: [x, y, w, h], data };
};
const TOWER: AssetRef = { id: 'asset-tower', name: '02-historic-buildings.png', width: 400, height: 400 };
const AREA = { bounds: [1000, 200, 300, 600], mask_path: '/chat/.shapes/paint-only-0.png', name: 'the tower' };

type Calls = { asked: string[]; transfers: Record<string, unknown>[]; kept: { part: string; width: number; height: number }[]; said: string[]; recorded: Record<string, unknown>[] };
function host(over: Partial<RepaintHost> = {}): RepaintHost & { calls: Calls } {
  const calls: Calls = { asked: [], transfers: [], kept: [], said: [], recorded: [] };
  return { calls,
    reference: id => id === TOWER.id ? TOWER : null,
    area: () => AREA,
    ask: async part => { calls.asked.push(part); return { asked: true, reply: 'Question displayed.' }; },
    passed: () => false,
    propose: async () => null,
    shape: async area => box(area.bounds[0]!, area.bounds[1]!, area.bounds[2]!, area.bounds[3]!),
    findInAsset: async () => box(100, 50, 150, 300),                       // the tower in its asset: the same proportions
    pixels: async ref => ({ width: ref.width, height: ref.height, data: new Uint8Array(ref.width * ref.height * 4).fill(200) }),
    keep: async (_ref, part, picture) => { calls.kept.push({ part, width: picture.width, height: picture.height }); return { id: 'fitted-1', name: 'fitted', width: picture.width, height: picture.height }; },
    transfer: async (_id, recipe) => { calls.transfers.push(recipe); return { content: [{ type: 'text', text: '{"status":"complete"}' }], details: { status: 'complete' } }; },
    emit: event => { calls.said.push(String(event.message ?? '')); },
    record: event => { calls.recorded.push(event); },
    ...over };
}
const run = (h: RepaintHost, args: Record<string, unknown> = {}) =>
  repaintTools(h).find(tool => tool.name === 'repaint_from_asset')!.execute('call-1', { reference_id: TOWER.id, part: 'the tower', preset: 'b) Basic-1', ...args }, undefined, undefined, undefined as never);
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map(c => c.text ?? '').join('\n');

test('with no area it asks for the part’s area first, as ask_for_selection does, and paints nothing', async () => {
  const h = host({ area: () => null });
  const result = await run(h);
  assert.deepEqual(h.calls.asked, ['the tower']);
  assert.equal(h.calls.transfers.length, 0);
  assert.match(text(result), /Question displayed/);
  assert.match(text(result), /repaint_from_asset again/);
});

test('with the area set it fits the asset’s part into the area’s box and transfers the fitted picture there', async () => {
  const h = host();
  const result = await run(h);
  assert.equal(h.calls.asked.length, 0);
  assert.deepEqual(h.calls.kept, [{ part: 'the tower', width: 150, height: 300 }]);       // 2x both ways: the asset’s own detail
  assert.equal(h.calls.transfers.length, 1);
  const recipe = h.calls.transfers[0]!;
  assert.equal(recipe.reference_id, 'fitted-1');
  assert.deepEqual(recipe.source, [0, 0, 150, 300]);
  assert.deepEqual(recipe.target, [1000, 200, 300, 600]);
  assert.equal(recipe.preset, 'b) Basic-1');
  assert.match(String(recipe.name), /tower/i);
  assert.match(text(result), /"fits":true/);
  assert.equal(h.calls.recorded[0]!.type, 'repaint_fit');
});

test('a poor fit paints nothing, tells the artist why, and does not send the painter to an AI image', async () => {
  const h = host({ findInAsset: async () => box(0, 0, 400, 100) });                    // a wide strip for a tall area
  const result = await run(h);
  assert.equal(h.calls.transfers.length, 0);
  assert.equal(h.calls.kept.length, 0);
  assert.match(h.calls.said.join('\n'), /does not fit/);
  assert.match(text(result), /Nothing was painted/);
  assert.match(text(result), /stretched/);
  assert.match(text(result), /make_asset/);
});

test('an asset that is its part all over is used whole', async () => {
  const h = host({ findInAsset: async () => null, area: () => ({ ...AREA, bounds: [0, 0, 600, 600] }) });
  await run(h);
  assert.deepEqual(h.calls.transfers[0]!.source, [0, 0, 400, 400]);
  assert.deepEqual(h.calls.transfers[0]!.target, [0, 0, 600, 600]);
});

test('the artist answered without an area: the found outline is the shape, and with none found it says what it needs', async () => {
  const found = { bounds: [900, 100, 300, 600], mask_path: '/chat/.shapes/found-0.png' };
  const h = host({ area: () => null, passed: () => true, propose: async () => found });
  await run(h);
  assert.equal(h.calls.asked.length, 0);
  assert.deepEqual(h.calls.transfers[0]!.target, [900, 100, 300, 600]);
  const none = host({ area: () => null, passed: () => true });
  const result = await run(none);
  assert.equal(none.calls.transfers.length, 0);
  assert.match(text(result), /select/i);
});

test('an asset too small for the area is sharpened once first when the host can', async () => {
  let sharpened = 0;
  const small = box(0, 0, 100, 200), large = box(0, 0, 400, 800);
  const h = host({ findInAsset: async ref => ref.width > 400 ? large : small,
    sharpen: async ref => { sharpened++; return { ...ref, width: ref.width * 4, height: ref.height * 4 }; } });
  await run(h);
  assert.equal(sharpened, 1);
  assert.equal(h.calls.transfers.length, 1);
  const cannot = host({ findInAsset: async () => small });
  const result = await run(cannot);
  assert.equal(cannot.calls.transfers.length, 0);
  assert.match(text(result), /too small/);
});

test('the part not found in the asset, or an unknown asset, paints nothing and says so', async () => {
  const h = host({ findInAsset: async () => { throw new Error('I could not see the tower on the painting.'); } });
  const result = await run(h);
  assert.equal(h.calls.transfers.length, 0);
  assert.match(text(result), /could not find the tower in 02-historic-buildings/);
  await assert.rejects(async () => run(host(), { reference_id: 'nope' }), /attached/);
});

test('the goal picture the underpainting came from is not repainted this way: the scoped transfer is its tool', async () => {
  const h = host({ placedGoal: async () => true });
  const result = await run(h);
  assert.equal(h.calls.transfers.length + h.calls.asked.length, 0);
  assert.match(text(result), /paint_from_reference inside its area/);
});
