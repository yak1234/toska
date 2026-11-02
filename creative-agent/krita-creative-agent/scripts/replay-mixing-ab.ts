// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Development only: a paired A/B benchmark for colour mixing. One recorded chat's painting calls are replayed twice into
// fresh documents of the recorded size, through the same native operations the companion sent: run A with every pass in rgb,
// run B with `mixing_model: spectral` on the passes whose preset has a spectral card (brush-catalog.json mixing), the others
// rgb in both. Everything else (strokes, presets, colours, sizes, layers, fills, layer visibility) is the recording's, so the
// only difference between the two canvases is the mixing.
//   node scripts/replay-mixing-ab.ts --records <chat data>/records.sqlite --out <folder> [--chat <id>] [--arms A,B]
// What is replayed: the painter's paint_batch calls (and paint_pass, paint_recipe, paint_contours, fill_region, adjust_layer
// called on their own), action by action as the companion translated them (paint_recipe through generateStrokes in 256-curve
// chunks, paint_contours through contourCommands into painting_toolbox). Skipped: observe/read-only calls, calls refused before
// painting, actions that failed or did not run, and every pass Luna undid (luna_review.undone_pass_ids in the call's result).
// Krita must be idle with no document open (checked first). Each run's document lives in
// <out>/work/benchmark-runs/<stamp>-tool-choice/replay-<arm>-1/<session>/ so the plugin's close_benchmark_copy can close it
// unsaved; that folder is removed afterwards. Writes <out>/replay-<arm>.png, snapshots after each batch that ran spectral, and
// <out>/replay-log.json (every step, what was sent, what the plugin answered, the image hash after it).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { contourCommands } from '../src/contour-tool.mjs';
import { generateStrokes } from '../src/stroke-generator.mjs';
import { passMixing, presetMixing, type MixingCatalog } from '../src/colour-mixing/pass-mixing.ts';

export type Arm = 'A' | 'B';
export type Json = Record<string, any>;
/** One painting action of the recording, with what its result said. */
export type RecordedAction = { tool: string; args: Json; index: number; status: string; layerId?: string; undone: boolean };
export type RecordedCall = { callId: string; tool: string; move: number; refused: string | null; actions: RecordedAction[] };
export type Recording = { chatId: string; canvas: { width: number; height: number }; calls: RecordedCall[] };
/** One native call to send: the operation and its params, as the companion would send them. */
export type Step = { callId: string; batch: number; action: number; tool: string; operation: string; params: Json;
  recordedLayerId?: string; spectral: boolean; move: number };

/** Painting tools the replay knows how to translate; anything else that paints refuses the replay rather than skipping it. */
export const PAINTING_TOOLS = ['paint_pass', 'paint_recipe', 'paint_contours', 'fill_region', 'adjust_layer'] as const;
/** Calls that never change the canvas. */
export const READ_ONLY = new Set(['observe_canvas', 'sample_canvas_colors', 'list_brushes', 'krita_capabilities', 'painting_tool_help',
  'view_reference', 'read', 'select', 'propose_protection', 'record_progress', 'finish_move', 'composition_guides', 'look', 'seed', 'split']);
const BATCH_OK = new Set(['ok', 'complete']);

/** paint_batch operation ids (src/tools.mjs batchPrefix): `${prefix}-${index}`. */
export const batchPrefix = (id: string) => 'batch-' + createHash('sha256').update(String(id)).digest('hex').slice(0, 16);

/** The session entries (Pi's transcript lines) of one chat in a records.sqlite, oldest first. */
export function readEntries(records: string, chatId?: string): { chatId: string; entries: Json[] } {
  const db = new DatabaseSync(records, { readOnly: true });
  try {
    const chats = db.prepare('SELECT DISTINCT chat_id FROM session_entries').all() as { chat_id: string }[];
    const chosen = chatId ?? (chats.length === 1 ? chats[0].chat_id : undefined);
    if (!chosen) throw new Error(`records.sqlite holds ${chats.length} chats; name one with --chat.`);
    const rows = db.prepare('SELECT entry FROM session_entries WHERE chat_id = ? ORDER BY key, seq').all(chosen) as { entry: string }[];
    if (!rows.length) throw new Error('No session entries for chat ' + chosen);
    return { chatId: chosen, entries: rows.map(r => JSON.parse(r.entry)) };
  } finally { db.close(); }
}

function resultJson(text: string | undefined): Json | null {
  if (!text) return null;
  try { const value = JSON.parse(text); return value && typeof value === 'object' ? value : null; } catch { return null; }
}

/** The recording's painting calls in order, each with its actions' outcomes and Luna's undo, and the canvas size the first
 * observation reported. Moves are counted by the user messages (the first message starts move 1). */
export function parseRecording(entries: Json[], chatId = ''): Recording {
  const results = new Map<string, Json>();
  for (const e of entries) if (e?.message?.role === 'toolResult') results.set(e.message.toolCallId, e.message);
  let canvas: { width: number; height: number } | null = null, move = 0;
  const calls: RecordedCall[] = [];
  for (const e of entries) {
    const m = e?.message;
    if (!m) continue;
    if (m.role === 'user') { move++; continue; }
    if (m.role === 'toolResult' && !canvas) {
      const r = resultJson(m.content?.[0]?.text);
      const c = r?.canvas ?? r;
      if (Number.isInteger(c?.width) && Number.isInteger(c?.height)) canvas = { width: c.width, height: c.height };
    }
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part?.type !== 'toolCall') continue;
      const name = String(part.name);
      if (READ_ONLY.has(name)) continue;
      const result = results.get(part.id);
      const texts: string[] = (result?.content ?? []).filter((p: Json) => p?.type === 'text').map((p: Json) => String(p.text));
      const main = resultJson(texts[0]);
      const undone = new Set<string>();
      for (const t of texts) for (const id of resultJson(t)?.luna_review?.undone_pass_ids ?? []) undone.add(String(id));
      const listed: { tool: string; arguments: Json }[] = name === 'paint_batch' ? part.arguments?.actions ?? [] : [{ tool: name, arguments: part.arguments ?? {} }];
      for (const a of listed) if (!(PAINTING_TOOLS as readonly string[]).includes(a.tool))
        throw new Error(`Call ${part.id} uses ${a.tool}, which this replay does not translate.`);
      // A call whose result is not a JSON status (a schema refusal, a ValueError before anything ran) painted nothing.
      const refused = !result ? 'no result recorded' : result.isError || !main ? texts[0]?.slice(0, 200) ?? 'refused' : null;
      const prefix = batchPrefix(part.id);
      const actions: RecordedAction[] = listed.map((a, index) => {
        const outcome = name === 'paint_batch' ? main?.actions?.[index] : main;
        const status = refused ? 'refused' : name === 'paint_batch' ? String(outcome?.status ?? 'not_run') : String(main?.status ?? 'ok');
        const layerId = typeof outcome?.layer_id === 'string' ? outcome.layer_id : undefined;
        return { tool: a.tool, args: a.arguments, index, status, ...(layerId ? { layerId } : {}),
          undone: undone.has(`${prefix}-${index}`) || (name !== 'paint_batch' && undone.size > 0) };
      });
      calls.push({ callId: part.id, tool: name, move: Math.max(1, move), refused, actions });
    }
  }
  if (!canvas) throw new Error('The recording has no observation with the canvas size.');
  return { chatId, canvas, calls };
}

/** Whether `preset` has a measured spectral card (and so takes spectral in run B). */
export const spectralCard = (preset: unknown, catalog: MixingCatalog) =>
  typeof preset === 'string' && !!presetMixing(preset, catalog)?.cards.spectral;

/** The native calls of one arm, in order: only actions that painted and were kept. Run A sends no mixing_model (rgb, as the
 * companion sends for rgb); run B sends spectral on carded presets. Recipes keep their preset's mixing (none is carded here,
 * and a recipe's chunks are paint_passes through the same wrapper, so they follow the same rule). */
export function replayPlan(recording: Recording, arm: Arm, catalog: MixingCatalog): Step[] {
  const steps: Step[] = [];
  const mixing = (preset: string): Json => {
    if (arm === 'A' || !spectralCard(preset, catalog)) return {};
    const sent = passMixing({ preset, mixing: 'spectral' }, catalog);
    if ('error' in sent) throw new Error(sent.error);
    return sent;
  };
  recording.calls.forEach((call, batch) => {
    if (call.refused) return;
    for (const a of call.actions) {
      if (!BATCH_OK.has(a.status) || a.undone) continue;
      const base = { callId: call.callId, batch, action: a.index, tool: a.tool, move: call.move, ...(a.layerId ? { recordedLayerId: a.layerId } : {}) };
      if (a.tool === 'paint_pass') {
        const { mixing: _asked, pass_kind: _kind, ...args } = a.args;
        const extra = mixing(args.preset);
        steps.push({ ...base, operation: 'paint_pass', params: { ...args, ...extra }, spectral: extra.mixing_model === 'spectral' });
      } else if (a.tool === 'paint_recipe') {
        const r = a.args, strokes = generateStrokes(r, recording.canvas) as Json[];
        for (let offset = 0; offset < strokes.length; offset += 256) {
          const extra = mixing(r.preset);
          steps.push({ ...base, operation: 'paint_pass', spectral: extra.mixing_model === 'spectral', params: { name: r.name + ' · ' + (offset / 256 + 1),
            preset: r.preset, region: r.region, layer_opacity: r.layer_opacity ?? 1, ...(r.panel ? { panel: r.panel } : {}),
            ...(r.blend_mode ? { blend_mode: r.blend_mode } : {}), ...(r.clip_to ? { clip_to: r.clip_to } : {}),
            strokes: strokes.slice(offset, offset + 256), ...extra } });
        }
      } else if (a.tool === 'paint_contours') {
        steps.push({ ...base, operation: 'painting_toolbox', params: contourCommands(a.args, recording.canvas), spectral: false });
      } else if (a.tool === 'fill_region' || a.tool === 'adjust_layer') {
        steps.push({ ...base, operation: a.tool, params: { ...a.args }, spectral: false });
      }
    }
  });
  return steps;
}

/** A step's params with recorded layer ids replaced by this run's, or null when it names a layer this run never made. */
export function mapLayers(step: Step, layers: Map<string, string>): Json | null {
  const params = { ...step.params };
  for (const key of ['layer_id', 'clip_to', 'source_layer_id', 'continue_layer_id']) {
    const value = params[key];
    if (typeof value !== 'string' || !/^\{[0-9a-f-]{36}\}$/i.test(value)) continue;
    const mapped = layers.get(value);
    if (!mapped) return null;
    params[key] = mapped;
  }
  return params;
}

// ---- live run ----

type Logged = { step: number; batch: number; action: number; tool: string; operation: string; name?: string; preset?: string;
  mixing_model?: string; status: string; layer_id?: string; error?: string; stroke_job?: Json; image_sha?: string; ms: number };

async function live(argv: string[]) {
  const args: Record<string, string> = Object.fromEntries(argv.flatMap((a, i) => a.startsWith('--') ? [[a.slice(2), argv[i + 1] ?? 'yes']] : []));
  if (!args.records || !args.out) throw new Error('usage: node scripts/replay-mixing-ab.ts --records <records.sqlite> --out <folder> [--chat <id>] [--arms A,B]');
  const url = process.env.KRITA_URL ?? 'http://127.0.0.1:5679';
  const out = resolve(args.out), arms = (args.arms ?? 'A,B').split(',') as Arm[];
  const catalog = JSON.parse(await readFile(new URL('../src/brush-catalog.json', import.meta.url), 'utf8')) as MixingCatalog;
  const { chatId, entries } = readEntries(resolve(args.records), args.chat);
  const recording = parseRecording(entries, chatId);
  const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

  async function bridge(action: string, params: Json = {}, timeout = 300): Promise<Json> {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params, timeout }), signal: AbortSignal.timeout((timeout + 30) * 1000) });
    return await response.json() as Json;
  }
  const creative = (operation: string, params: Json = {}, session?: string, operationId?: string) =>
    bridge('creative', { operation, params, ...(session ? { session_id: session } : {}), ...(operationId ? { operation_id: operationId } : {}) });

  // Idle and empty first: a running chat or an open painting stops the replay before anything is made.
  const health = await (await fetch(url + '/health', { signal: AbortSignal.timeout(10000) })).json() as Json;
  if (health.status !== 'ok') throw new Error('Bridge not healthy: ' + JSON.stringify(health));
  const state = await bridge('health', {}, 20), creativeHealth = await creative('health');
  if (creativeHealth.session_active) throw new Error('A chat holds a painting session; nothing was replayed.');
  if (state.has_canvas) throw new Error('A document is open in Krita; nothing was replayed.');

  await mkdir(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const report: Json = { chat: chatId, canvas: recording.canvas, bridge: url, build: creativeHealth.build?.build_id, krita: creativeHealth.krita_version, arms: {} };
  // Snapshots after every batch that has a spectral pass in run B (the same batches in both runs).
  const spectralBatches = new Set(replayPlan(recording, 'B', catalog).filter(s => s.spectral).map(s => s.batch));
  for (const arm of arms) {
    const plan = replayPlan(recording, arm, catalog);
    const session = randomUUID();
    const dir = join(out, 'work', 'benchmark-runs', stamp + '-tool-choice', `replay-${arm.toLowerCase()}-1`, session);
    await mkdir(dir, { recursive: true });
    log(arm, 'begin', plan.length, 'steps,', plan.filter(s => s.spectral).length, 'spectral');
    const begun = await creative('begin', { mode: 'new', name: 'Replay ' + arm, width: recording.canvas.width, height: recording.canvas.height,
      background: '#ece3d4', output_dir: dir }, session);
    if (begun.error) throw new Error('begin: ' + begun.error);
    const layers = new Map<string, string>(), steps: Logged[] = [], snapshots: string[] = [];
    let failure: string | null = null;
    try {
      for (const [n, step] of plan.entries()) {
        const params = mapLayers(step, layers);
        const started = Date.now();
        const entry: Logged = { step: n, batch: step.batch, action: step.action, tool: step.tool, operation: step.operation,
          name: step.params.name, preset: step.params.preset, ...(step.params.mixing_model ? { mixing_model: step.params.mixing_model } : {}), status: 'skipped', ms: 0 };
        if (!params) { entry.error = 'names a layer this replay never made'; steps.push(entry); log(arm, n, 'skip', step.tool, step.params.layer_id); continue; }
        const result = await creative(step.operation, { ...params, stage_id: 'move-' + step.move }, session, `replay-${arm}-${n}`);
        entry.ms = Date.now() - started;
        if (result.error) {
          entry.status = 'error'; entry.error = String(result.error).slice(0, 300); steps.push(entry);
          if (['outcome_unknown', 'internal', 'timeout'].includes(result.error_code) || /Timeout waiting/.test(String(result.error))) { failure = entry.error; break; }
          log(arm, n, 'error', step.tool, entry.error); continue;
        }
        entry.status = String(result.status ?? 'ok');
        if (typeof result.layer_id === 'string') { entry.layer_id = result.layer_id; if (step.recordedLayerId) layers.set(step.recordedLayerId, result.layer_id); }
        if (result.stroke_job) entry.stroke_job = result.stroke_job;
        if (typeof result.image_path === 'string') entry.image_sha = createHash('sha256').update(await readFile(result.image_path)).digest('hex').slice(0, 16);
        steps.push(entry);
        log(arm, n, step.operation, entry.name ?? '', entry.mixing_model ?? '', entry.status, entry.ms + ' ms');
        // Taken before later calls can hide those layers.
        const next = plan[n + 1];
        if (spectralBatches.has(step.batch) && (!next || next.batch !== step.batch)) {
          const path = join(out, `snapshot-batch${step.batch}-${arm}.png`);
          const saved = await bridge('save', { path });
          if (saved.error) throw new Error('save: ' + saved.error);
          snapshots.push(path);
        }
      }
      if (!failure) {
        const saved = await bridge('save', { path: join(out, `replay-${arm}.png`) });
        if (saved.error) throw new Error('save: ' + saved.error);
      }
    } finally {
      const ended = await creative('end', {}, session);
      const closed = await creative('close_benchmark_copy', { path: join(dir, 'painting.kra') });
      report.arms[arm] = { session, steps, snapshots, failure, ended: ended.error ?? 'ok', closed: closed.closed ?? closed.error };
      await writeFile(join(out, 'replay-log.json'), JSON.stringify(report, null, 2));
      if (!closed.closed) throw new Error('Krita did not close the replay document ' + join(dir, 'painting.kra') + ': ' + (closed.error ?? 'still open'));
      await rm(dir, { recursive: true, force: true });
    }
    if (failure) throw new Error(`Run ${arm} stopped: ${failure}`);
  }
  await rm(join(out, 'work'), { recursive: true, force: true });
  log('log:', join(out, 'replay-log.json'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  live(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
