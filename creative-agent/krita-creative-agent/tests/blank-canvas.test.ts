// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Blank-canvas review: the kind of a batch, the facts Luna is told and the findings that still count, from the plugin's
// measured change map. The numbers of the Istanbul case are the plugin's own answer for that chat's views. Writes no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { batchKind, dropFreshFindings, emptyCells, factsText, groundBoxes, needsArtist, newGroundCrop, newGroundNote, parseChangeMap, removedArtwork,
  reviewBatch, updateGround, type Box, type ChangeMap } from '../src/blank-canvas.ts';

const cells = (empty: Record<string, number>, fresh: Record<string, number> = {}): ChangeMap['cells'] =>
  Object.fromEntries(['top_left', 'top_center', 'top_right', 'middle_left', 'center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right']
    .map(name => [name, { empty_before: empty[name] ?? 0, fresh: fresh[name] ?? 0 }]));
const RIGHT = { top_center: 0.4824, top_right: 1, center: 0.4824, middle_right: 1, bottom_center: 0.4824, bottom_right: 1 };
/** The clone of the painting onto the empty right half, as measured on the chat's views. */
const ISTANBUL: ChangeMap = { fresh_share: 0.9893, removed_share: 0, changed_share: 0.5015, fresh_box: [0.5039, 0, 0.4961, 1], cells: cells(RIGHT, RIGHT) };
const over: ChangeMap = { fresh_share: 0, removed_share: 0, changed_share: 0.1, fresh_box: null, cells: cells(RIGHT) };

test('the plugin answer is checked field by field', () => {
  assert.deepEqual(parseChangeMap(JSON.parse(JSON.stringify({ ...ISTANBUL, status: 'ok', ms: 14 }))), ISTANBUL);
  assert.equal(parseChangeMap({ ...ISTANBUL, fresh_share: 1.2 }), null);
  assert.equal(parseChangeMap({ ...ISTANBUL, fresh_box: [0, 0, 0, 1] }), null);
  assert.equal(parseChangeMap({ ...ISTANBUL, cells: { top_left: { empty_before: 0, fresh: 0 } } }), null);
  assert.equal(parseChangeMap({ error: 'Unknown creative operation' }), null);
  assert.equal(parseChangeMap(null), null);
});

test('the kind of a batch comes from where its change landed', () => {
  assert.equal(batchKind(ISTANBUL), 'new_ground');
  assert.equal(batchKind(over), 'over');
  assert.equal(batchKind({ ...ISTANBUL, fresh_share: 0.5 }), 'mixed');
  assert.equal(batchKind({ ...ISTANBUL, fresh_share: 0.05 }), 'over');
  assert.equal(batchKind({ ...ISTANBUL, changed_share: 0.001 }), 'over', 'too small a change to classify');
});

test('Luna is told which ninths were empty, in the words its location question uses', () => {
  assert.deepEqual(emptyCells(ISTANBUL), ['top_right', 'middle_right', 'bottom_right']);
  const text = factsText(ISTANBUL);
  assert.match(text, /^MEASURED FACTS/);
  assert.match(text, /these ninths of the canvas were empty \(no paint at all\): top-right, middle-right, bottom-right\./);
  assert.match(text, /99% of what the batch changed is on that empty canvas/);
  assert.match(text, /not a patch or block laid over the painting/);
  assert.match(factsText({ ...ISTANBUL, cells: cells(Object.fromEntries(Object.keys(ISTANBUL.cells).map(n => [n, 1]))) }), /the whole canvas was empty/);
});

test('an artifact finding in an empty ninth is dropped; one over paint, a covered feature and removed artwork stay', () => {
  const findings = [{ type: 'flat_block', location: 'middle_right' }, { type: 'hard_graphic', location: 'center' },
    { type: 'texture_over_forms', location: 'top_right' }, { type: 'covered_feature', location: 'top_right' },
    { type: 'artwork_removed', location: null }, { type: 'stripes', location: null }];
  assert.deepEqual(dropFreshFindings(findings, ISTANBUL).map(f => f.type), ['hard_graphic', 'covered_feature', 'artwork_removed', 'stripes']);
});

test('removed artwork is measured', () => {
  assert.equal(removedArtwork(ISTANBUL), false);
  assert.equal(removedArtwork({ ...over, removed_share: 0.97 }), true);
});

test('the crop is the new ground in canvas pixels at the scale the view shows', () => {
  assert.deepEqual(newGroundCrop(ISTANBUL, { width: 12000, height: 4000 }, 1568 / 12000), { source: [6047, 0, 5953, 4000], out: [778, 523] });
  assert.deepEqual(newGroundCrop({ ...ISTANBUL, fresh_box: [0, 0, 1, 1] }, { width: 6000, height: 4500 }, 1), { source: [0, 0, 6000, 4500], out: [1024, 768] });
  assert.equal(newGroundCrop(over, { width: 100, height: 100 }, 1), null);
});

test('kept new ground: a picture in the painting\'s finish has no note, the others say what to do next and never to start again', () => {
  assert.equal(newGroundNote({ reading: 'picture', confidence: 0.9 }), null);
  assert.equal(newGroundNote({ reading: 'picture', confidence: 0.9, same_finish: 0.91 }), null);
  assert.equal(newGroundNote({ reading: 'picture', confidence: 0.9, same_finish: null }), null);
  assert.equal(newGroundNote({ reading: 'other', confidence: 0.9 }), null);
  assert.match(newGroundNote({ reading: 'picture', confidence: 0.86, same_finish: 0 })!, /reads as a picture, but coarser, flatter or more graphic/);
  for (const reading of ['underpainting', 'placeholder'] as const) assert.match(newGroundNote({ reading, confidence: 0.7 })!, new RegExp(reading));
  for (const ground of [{ reading: 'underpainting', confidence: 1 }, { reading: 'placeholder', confidence: 1 }, { reading: 'picture', confidence: 1, same_finish: 0.1 }] as const)
    assert.match(newGroundNote(ground)!, /It is kept\..*do not start it again\.$/);
});

test('a move needs the artist when Luna stopped it, undid all of it, or new ground read as a placeholder three moves running', () => {
  const move = (number: number, review?: object, extra: object = {}) => ({ number, ...(review ? { review: { batches: 1, undone_batches: 0, ...review } } : {}), ...extra });
  assert.equal(needsArtist(move(1, {}), [move(1, {})]), null);
  assert.match(needsArtist(move(1, {}, { luna_stopped: 'Luna undid 2 batches' }), [])!, /stopped/);
  assert.match(needsArtist(move(6, { batches: 2, undone_batches: 2 }), [])!, /undid every batch/);
  assert.equal(needsArtist(move(6, { batches: 2, undone_batches: 1 }), []), null);
  assert.equal(needsArtist(move(1), [move(1)]), null, 'a move with no reviewed batch');
  const placeholder = { new_ground: { reading: 'placeholder', confidence: 0.9 } };
  const run = [move(1, placeholder), move(2, placeholder), move(3, placeholder)];
  assert.match(needsArtist(run[2], run)!, /placeholder in 3 moves running/);
  assert.equal(needsArtist(run[1], run), null, 'only two so far at move 2');
  const broken = [move(1, placeholder), move(2, { new_ground: { reading: 'picture', confidence: 0.9 } }), move(3, placeholder)];
  assert.equal(needsArtist(broken[2], broken), null);
});

test('unsettled ground is remembered until it reads as a picture in the painting\'s finish', () => {
  const right: Box = [0.5, 0, 0.5, 1], strip: Box = [0.5, 0, 0.16, 1];
  const wash = updateGround([], { reading: 'placeholder', confidence: 0.9, box: right });
  assert.deepEqual(wash, [right]);
  assert.deepEqual(updateGround(wash, { reading: 'underpainting', confidence: 0.7, box: strip }), [right], 'inside ground already kept');
  assert.deepEqual(updateGround([strip], { reading: 'underpainting', confidence: 0.7, box: right }), [right], 'a larger box replaces the ones inside it');
  assert.deepEqual(updateGround(wash, { reading: 'picture', confidence: 0.9, same_finish: 0.1, box: strip }), [right], 'a coarse picture is not settled');
  assert.deepEqual(updateGround(wash, { reading: 'picture', confidence: 0.97, same_finish: 0.91, box: right }), [], 'a finished picture is settled');
  assert.deepEqual(updateGround([[0, 0, 0.3, 1]], { reading: 'picture', confidence: 0.97, box: right }), [[0, 0, 0.3, 1]], 'ground elsewhere stays');
  assert.deepEqual(updateGround(wash, { reading: 'picture', confidence: 0.9 }), wash, 'no box, no change');
  let many: Box[] = [];
  for (let i = 0; i < 12; i++) many = updateGround(many, { reading: 'underpainting', confidence: 0.7, box: [i * 0.08, 0, 0.05, 0.5] });
  assert.equal(many.length, 8);
  assert.deepEqual(groundBoxes([right, [0.9, 0, 0.5, 1], 'x', [0, 0, 0, 1]]), [right]);
  assert.deepEqual(groundBoxes(undefined), []);
});

const usage = { cost: 0.001, input_tokens: 1000 };
const flat = { type: 'flat_block', label: 'flat block', probability: 1, location: 'middle_right' };
test('a batch over paint is reviewed as before; without a measure too', async () => {
  const asked: (string | undefined)[] = [];
  const over = async (facts?: string) => { asked.push(facts); return { findings: [flat], usage, elapsed_ms: 5 }; };
  const ground = async () => { throw new Error('not asked'); };
  assert.deepEqual(await reviewBatch({ map: null, over, ground }), { findings: [flat], usage, elapsed_ms: 5 });
  assert.deepEqual(await reviewBatch({ map: over_, over, ground }), { findings: [flat], usage, elapsed_ms: 5, kind: 'over' });
  assert.deepEqual(asked, [undefined, undefined], 'no facts: nothing was empty under the change');
});
const over_: ChangeMap = { fresh_share: 0, removed_share: 0, changed_share: 0.1, fresh_box: null, cells: cells(RIGHT) };

test('new ground is not asked the BEFORE/AFTER questions: the copy onto the empty half is kept as a picture', async () => {
  const facts: string[] = [];
  const result = await reviewBatch({ map: ISTANBUL, over: async () => { throw new Error('not asked'); },
    ground: async text => { facts.push(text); return { reading: 'picture' as const, confidence: 0.96, same_finish: 0.91, usage, elapsed_ms: 7 }; } });
  assert.deepEqual(result, { findings: [], usage, elapsed_ms: 7, kind: 'new_ground',
    new_ground: { reading: 'picture', confidence: 0.96, same_finish: 0.91, box: [0.5039, 0, 0.4961, 1] } });
  assert.match(facts[0], /^MEASURED FACTS/);
});

test('a mixed batch asks both; a finding in an empty ninth is dropped, one over paint stays', async () => {
  const mixed = { ...ISTANBUL, fresh_share: 0.49 };
  const graphic = { type: 'hard_graphic', label: 'hard graphic look', probability: 0.95, location: 'middle_left' };
  const result = await reviewBatch({ map: mixed, over: async facts => { assert.match(facts!, /^MEASURED FACTS/); return { findings: [flat, graphic], usage, elapsed_ms: 9 }; },
    ground: async () => ({ reading: 'picture' as const, confidence: 0.97, same_finish: 0.92, usage, elapsed_ms: 4 }) });
  assert.ok(!('fallback' in result && result.fallback));
  if (result.fallback === undefined) {
    assert.deepEqual(result.findings, [graphic]);
    assert.equal(result.kind, 'mixed'); assert.equal(result.new_ground?.reading, 'picture');
    assert.deepEqual(result.usage, { cost: 0.002, input_tokens: 2000 }); assert.equal(result.elapsed_ms, 9);
  }
});

test('removed artwork is a finding even when Luna does not answer; otherwise Luna\'s fallback is the result', async () => {
  const hidden = { ...over_, removed_share: 0.97 };
  const down = async () => ({ fallback: 'timeout', elapsed_ms: 30 });
  assert.deepEqual(await reviewBatch({ map: hidden, over: down, ground: down }),
    { findings: [{ type: 'artwork_removed', label: 'artwork removed', probability: 1, location: null }], usage: { cost: 0, input_tokens: 0 }, elapsed_ms: 30, kind: 'over' });
  assert.deepEqual(await reviewBatch({ map: over_, over: down, ground: down }), { fallback: 'timeout', elapsed_ms: 30 });
  assert.deepEqual(await reviewBatch({ map: ISTANBUL, over: down, ground: down }), { fallback: 'timeout', elapsed_ms: 30 });
  const kept = await reviewBatch({ map: { ...ISTANBUL, fresh_share: 0.5 }, over: down,
    ground: async () => ({ reading: 'underpainting' as const, confidence: 0.7, same_finish: null, usage, elapsed_ms: 4 }) });
  assert.deepEqual(kept.fallback === undefined && [kept.findings, kept.new_ground?.reading], [[], 'underpainting'], 'the reading still counts when the move check fails');
});
