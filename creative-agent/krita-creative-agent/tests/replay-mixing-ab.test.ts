// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The colour-mixing replay (scripts/replay-mixing-ab.ts) without Krita: reading a recorded chat, which calls and actions it
// replays (Luna's undos, refusals and failed actions left out), and what each arm sends. One temporary records.sqlite, removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { batchPrefix, mapLayers, parseRecording, readEntries, replayPlan, spectralCard, type Json } from '../scripts/replay-mixing-ab.ts';
import type { MixingCatalog } from '../src/colour-mixing/pass-mixing.ts';

const WET = 'i) Wet Paint Plus (mypaint)', SOFT = 'b) Airbrush Soft';
const catalog: MixingCatalog = { mixing: { models: { spectral: 'mixes like paint' }, presets: { [WET]: { cards: { spectral: 'yellow over blue: green' } } } } };
const stroke = { start: [10, 10], segments: [[20, 10, 30, 10, 40, 10]], size: 20, opacity: 0.5, color: '#336699' };
const pass = (name: string, preset: string) => ({ tool: 'paint_pass', arguments: { name, preset, strokes: [stroke] } });
const call = (id: string, name: string, args: Json) => ({ type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '…' }, { type: 'toolCall', id, name, arguments: args }] } });
const result = (id: string, name: string, ...texts: (Json | string)[]) => ({ type: 'message', message: { role: 'toolResult', toolCallId: id, toolName: name,
  content: [...texts.map(t => ({ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t) })), { type: 'image', data: '' }] } });
const user = (text: string) => ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } });

/** A chat: observe; a kept batch (wet pass, recipe, contours); a batch Luna undid; a refused batch; a stopped batch whose
 * adjust_layer hides the kept wet pass and whose last pass failed; then a second move. */
function chat(): Json[] {
  return [
    { type: 'session', id: 's' }, user('Paint a lake'),
    call('c-observe', 'observe_canvas', {}), result('c-observe', 'observe_canvas', { status: 'ok', width: 600, height: 400, layers: [] }),
    call('c-1', 'paint_batch', { actions: [pass('Glaze', WET),
      { tool: 'paint_recipe', arguments: { name: 'Block-in', preset: SOFT, region: [0, 0, 600, 200], palette: ['#112233', '#445566'], stroke_count: 300,
        size: [20, 40], opacity: [0.5, 0.9], direction: 'horizontal', irregularity: 0.5, seed: 7 } },
      { tool: 'paint_contours', arguments: { name: 'Ridge', preset: 'b) Basic-1', shapes: [{ color: '#223344', points: [[0, 300], [300, 250], [600, 300], [600, 400], [0, 400]] }] } }] }),
    result('c-1', 'paint_batch', { status: 'ok', actions: [{ action: 1, tool: 'paint_pass', status: 'ok', layer_id: '{11111111-1111-1111-1111-111111111111}' },
      { action: 2, tool: 'paint_recipe', status: 'complete' }, { action: 3, tool: 'paint_contours', status: 'ok', layer_id: '{22222222-2222-2222-2222-222222222222}' }] }),
    call('c-2', 'paint_batch', { actions: [pass('Undone wet', WET), { tool: 'fill_region', arguments: { name: 'Sky', area: [{ shape: 'rectangle', bounds: [0, 0, 600, 200] }], color: '#aabbcc' } }] }),
    result('c-2', 'paint_batch', { status: 'ok', actions: [{ status: 'ok', layer_id: '{33333333-3333-3333-3333-333333333333}' }, { status: 'ok', layer_id: '{44444444-4444-4444-4444-444444444444}' }] },
      { luna_review: { note: 'Luna undid this batch', undone_pass_ids: [batchPrefix('c-2') + '-1', batchPrefix('c-2') + '-0'] } }),
    call('c-3', 'paint_batch', { actions: [pass('Refused', WET)] }),
    result('c-3', 'paint_batch', 'Action 1 (paint_pass) does not match its schema. Nothing was painted.'),
    call('c-4', 'paint_batch', { actions: [{ tool: 'adjust_layer', arguments: { layer_id: '{11111111-1111-1111-1111-111111111111}', visible: false } },
      { tool: 'adjust_layer', arguments: { layer_id: '{33333333-3333-3333-3333-333333333333}', visible: false } },
      pass('Soft veil', SOFT), pass('Off canvas', SOFT), pass('Never ran', WET)] }),
    result('c-4', 'paint_batch', { status: 'stopped', actions: [{ status: 'ok' }, { status: 'ok' }, { status: 'ok', layer_id: '{55555555-5555-5555-5555-555555555555}' },
      { status: 'failed', error: 'ValueError: coordinate must be between -6 and 606' }] }),
    user('continue'),
    call('c-5', 'paint_pass', { name: 'Alone', preset: WET, strokes: [stroke], mixing: 'rgb' }),
    result('c-5', 'paint_pass', { status: 'ok', layer_id: '{66666666-6666-6666-6666-666666666666}' }),
  ];
}

test('the recording: canvas, calls, outcomes, undos and moves', () => {
  const r = parseRecording(chat(), 'x');
  assert.deepEqual(r.canvas, { width: 600, height: 400 });
  assert.deepEqual(r.calls.map(c => c.callId), ['c-1', 'c-2', 'c-3', 'c-4', 'c-5']);   // observe is not a painting call
  assert.deepEqual(r.calls.map(c => c.move), [1, 1, 1, 1, 2]);
  assert.equal(r.calls[2].refused?.startsWith('Action 1'), true);
  assert.deepEqual(r.calls[1].actions.map(a => a.undone), [true, true]);
  assert.deepEqual(r.calls[3].actions.map(a => a.status), ['ok', 'ok', 'ok', 'failed', 'not_run']);
  assert.equal(r.calls[0].actions[0].layerId, '{11111111-1111-1111-1111-111111111111}');
});

test('only kept, painted actions are replayed, in order, as the companion translated them', () => {
  const plan = replayPlan(parseRecording(chat()), 'A', catalog);
  assert.deepEqual(plan.map(s => [s.callId, s.operation, s.params.name ?? s.params.layer_id]), [
    ['c-1', 'paint_pass', 'Glaze'], ['c-1', 'paint_pass', 'Block-in · 1'], ['c-1', 'paint_pass', 'Block-in · 2'], ['c-1', 'painting_toolbox', 'Ridge'],
    ['c-4', 'adjust_layer', '{11111111-1111-1111-1111-111111111111}'], ['c-4', 'adjust_layer', '{33333333-3333-3333-3333-333333333333}'],
    ['c-4', 'paint_pass', 'Soft veil'], ['c-5', 'paint_pass', 'Alone']]);
  // The recipe in 256-curve chunks with its seed's strokes; the contours as selection-clipped fills.
  assert.deepEqual(plan.slice(1, 3).map(s => s.params.strokes.length), [256, 44]);
  assert.deepEqual(plan[1].params.strokes, replayPlan(parseRecording(chat()), 'A', catalog)[1].params.strokes);
  assert.deepEqual(plan[3].params.commands.map((c: Json) => c.tool), ['set_brush', 'selection', 'curve_stroke', 'selection']);
  assert.deepEqual(plan.map(s => s.move), [1, 1, 1, 1, 1, 1, 1, 2]);
});

test('A sends no mixing model; B sends spectral only on carded presets, whatever the painter asked', () => {
  const recording = parseRecording(chat());
  const a = replayPlan(recording, 'A', catalog), b = replayPlan(recording, 'B', catalog);
  assert.equal(a.length, b.length);
  assert.ok(a.every(s => !('mixing_model' in s.params) && !('mixing' in s.params) && !s.spectral));
  assert.deepEqual(b.filter(s => s.spectral).map(s => s.params.name), ['Glaze', 'Alone']);
  assert.ok(b.filter(s => s.spectral).every(s => s.params.mixing_model === 'spectral'));
  assert.ok(b.filter(s => !s.spectral).every(s => !('mixing_model' in s.params)));
  // Apart from the mixing model, the two arms send the same thing.
  const strip = (p: Json) => { const { mixing_model: _m, ...rest } = p; return rest; };
  assert.deepEqual(a.map(s => s.params), b.map(s => strip(s.params)));
  assert.equal(spectralCard(WET, catalog), true);
  assert.equal(spectralCard(SOFT, catalog), false);
});

test('layer ids map to the replay’s layers; a layer the replay never made skips the step', () => {
  const plan = replayPlan(parseRecording(chat()), 'A', catalog);
  const layers = new Map([['{11111111-1111-1111-1111-111111111111}', '{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}']]);
  assert.equal(mapLayers(plan[4], layers)?.layer_id, '{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}');
  assert.equal(mapLayers(plan[5], layers), null);                 // the undone pass's layer
  assert.deepEqual(mapLayers(plan[0], layers), plan[0].params);    // no layer named
});

test('an unknown painting tool refuses the recording rather than dropping paint', () => {
  const entries = [user('x'), call('c-o', 'observe_canvas', {}), result('c-o', 'observe_canvas', { width: 10, height: 10 }),
    call('c-x', 'paint_batch', { actions: [{ tool: 'apply_filter', arguments: {} }] }), result('c-x', 'paint_batch', { status: 'ok', actions: [{ status: 'ok' }] })];
  assert.throws(() => parseRecording(entries), /apply_filter/);
});

test('readEntries reads one chat’s transcript in order from records.sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'replay-mixing-'));
  try {
    const path = join(dir, 'records.sqlite'), db = new DatabaseSync(path);
    db.exec('CREATE TABLE session_entries (chat_id TEXT NOT NULL, key TEXT NOT NULL, seq INTEGER NOT NULL, entry TEXT NOT NULL, PRIMARY KEY (chat_id, key, seq))');
    const insert = db.prepare('INSERT INTO session_entries VALUES (?, ?, ?, ?)');
    chat().forEach((entry, seq) => insert.run('chat-1', 'sessions/a.jsonl', 100 - seq, JSON.stringify({ ...entry, n: seq })));
    db.close();
    const read = readEntries(path);
    assert.equal(read.chatId, 'chat-1');
    assert.deepEqual(read.entries.map(e => e.n), chat().map((_, i) => i).reverse());   // by seq
    assert.throws(() => readEntries(path, 'other'), /No session entries/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
