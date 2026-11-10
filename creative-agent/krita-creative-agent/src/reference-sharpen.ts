// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Sharpen patch references (openspec sharpen-patch-references, approved 2026-11-10). On a painted canvas a transfer whose
// target is more than 2x its source is refused (reference-tool.mjs stretchRefusal). Istanbul, 2026-11-10: a 2175 x 1450 dock
// reference over 6000 x 4000 (2.8x), and 616 source px over 2000 (3.2x); the painter made three more AI references to get
// under 2x. Instead the transfer sharpens its reference 4x here first (Real-ESRGAN x4plus, as goal-sharpen.ts does for the
// whole-picture goal, nothing uploaded) and paints from the sharpened picture in the same call.
// - The reference becomes the sharpened picture as the goal does: same id, larger pixels, `sharpened` records what it was,
//   so staleGoalSource and goalSourceFile (goal-sharpen.ts) treat it as they treat a sharpened goal.
// - A reference of more than the sharpener's MAX_INPUT_PIXELS is reduced to that first (2175 x 1450 -> 1732 x 1154 -> the
//   most the reference tools read, TRANSFER_PIXELS).
// - No card and no remembered answer: the setting "Sharpen the goal" decides (Never: not sharpened; Always and Ask: sharpened,
//   because the call would otherwise be refused). Not for a part (its bounds are in the original's pixels) nor the
//   whole-picture goal (goal-sharpen.ts owns it).
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reduceRgba } from './bounded-image.ts';
import { TRANSFER_BYTES, TRANSFER_PIXELS } from './closeups.ts';
import { folderGoal, saveChoices, type GoalReference, type SharpenSetting } from './goal-sharpen.ts';
import { downloadBytes, downloadModel, modelDirectory, modelReady, type ModelSpec } from './shapes/model.ts';
import { MAX_INPUT_PIXELS } from './upscale/core.ts';
import { UPSCALE_MODEL } from './upscale/model.ts';
import { UpscaleError, upscaleService, type UpscaleService } from './upscale/index.ts';

export type Rect = [number, number, number, number];
export type PatchReference = GoalReference & { bounds?: unknown };
export type SharpenReferenceHost = {
  readonly study: { directory: string; references: PatchReference[] } | null | undefined;
  setting(): SharpenSetting;
  dataDir(): string | undefined;
  persist(): Promise<unknown>;
  publish(): void;
  callNative(operation: string, params: Record<string, unknown>): Promise<unknown>;
};
type Download = (options: { directory: string; spec: ModelSpec; onProgress?: (done: number, total: number) => void; signal?: AbortSignal }) => Promise<void>;
export type SharpenedReference = { scale: number; was: [number, number]; note: string };

/** A rect in the picture's old pixels, in its pixels after it grew `k` times; kept inside the picture. */
export function scaleRect(rect: readonly number[], k: number, picture: { width: number; height: number }): Rect {
  const [x, y, w, h] = rect.map(v => Math.round(v * k)) as Rect;
  const left = Math.min(x, picture.width - 1), top = Math.min(y, picture.height - 1);
  return [left, top, Math.max(1, Math.min(w, picture.width - left)), Math.max(1, Math.min(h, picture.height - top))];
}

/** What the painter is told of a sharpened reference (goal-sharpen.ts sharpenedContext's words, for any reference), or null. */
export function sharpenedNote(reference: { name?: string; id?: string; width?: number; height?: number; sharpened?: { from: { width: number; height: number } } }): string | null {
  const was = reference.sharpened?.from;
  if (!was) return null;
  const scale = Math.round((reference.width ?? 0) / was.width * 10000) / 10000;
  return `The reference "${reference.name ?? reference.id ?? 'reference'}" was sharpened ${Math.round(scale * 10) / 10}x on this computer for this transfer: its pixels are now `
    + `${reference.width} x ${reference.height} (they were ${was.width} x ${was.height}). Give its source rects in the new pixels: multiply any earlier rect by ${scale}.`;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function referenceSharpener(host: SharpenReferenceHost, { spec = UPSCALE_MODEL, download = downloadModel as Download, service }: { spec?: ModelSpec; download?: Download; service?: UpscaleService } = {}) {
  const modelDir = () => { const dir = host.dataDir(); if (!dir) throw new UpscaleError('model', 'Sharpening needs the companion’s data folder, and none is set.'); return modelDirectory(dir, spec); };
  const sharpener = service ?? upscaleService({ modelDir: async () => modelDir() });

  /** Why this reference is not sharpened for a transfer, or null when it may be. */
  function refusal(reference: PatchReference): string | null {
    if (reference.sharpened) return 'this reference is already sharpened';
    if (host.setting() === 'never') return 'Settings: Sharpen the goal is Never';
    if (reference.part_kind) return 'a reference part is not sharpened (sharpen from its whole picture)';
    if (folderGoal([reference])) return 'the whole-picture goal is sharpened by its own card';
    if (!(Number(reference.width) > 0 && Number(reference.height) > 0)) return 'the reference has no known size';
    return null;
  }

  /** Sharpens `reference` 4x and makes it the sharpened picture (same id). Throws with a plain reason; the reference is
   * then as it was. */
  async function sharpen(reference: PatchReference, { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number, message?: string) => void } = {}): Promise<SharpenedReference> {
    const study = host.study, why = refusal(reference);
    if (why) throw new UpscaleError('failed', why.replace(/^./, c => c.toUpperCase()) + '.');
    if (!study) throw new UpscaleError('failed', 'No chat is open.');
    signal?.throwIfAborted();
    const directory = modelDir();
    if (!(await modelReady(directory, spec))) {
      const size_mb = Math.round(downloadBytes(spec) / 1e6);
      onProgress?.(0, 1, `Downloading the sharpening model (${size_mb} MB)…`);
      try { await download({ directory, spec, ...(signal ? { signal } : {}) }); }
      catch (error) {
        if (signal?.aborted) throw new UpscaleError('cancelled', 'Sharpening was stopped; the model download resumes next time.');
        throw new UpscaleError('model', 'The sharpening model could not be downloaded: ' + (error as Error).message);
      }
    }
    signal?.throwIfAborted();
    const data = await readFile(reference.path), sha = sha256(data);
    const decoded = await host.callNative('decode_reference', { image_base64: data.toString('base64'), sha256: sha }) as { width: number; height: number; rgba_base64: string; sha256: string } | null;
    if (decoded?.sha256 !== sha) throw new UpscaleError('failed', 'The reference could not be read for sharpening.');
    if (decoded.width !== reference.width || decoded.height !== reference.height) throw new UpscaleError('failed', 'The reference changed since it was attached.');
    // More than the sharpener takes: reduced to that first (the net enlargement is then under 4x).
    const input = reduceRgba({ width: decoded.width, height: decoded.height, data: new Uint8Array(Buffer.from(decoded.rgba_base64, 'base64')) }, MAX_INPUT_PIXELS);
    const folder = join(study.directory, 'goal-sharpen'), stem = join(folder, sha.slice(0, 16));
    await mkdir(folder, { recursive: true });
    const outputs = { full: stem + '.x4.png', reference: stem + '.reference.png', compare: stem + '.compare.png' };
    const reply = await sharpener.upscale({ rgba: input.data, width: input.width, height: input.height, outputs, max_pixels: TRANSFER_PIXELS, max_bytes: TRANSFER_BYTES },
      { ...(signal ? { signal } : {}), onProgress: (done, total) => onProgress?.(done, total) });
    signal?.throwIfAborted();
    if (host.study !== study || !study.references.includes(reference) || reference.sharpened) throw new UpscaleError('failed', 'The chat changed while the reference was being sharpened.');
    const megapixels = input.width * input.height / 1e6, dir = host.dataDir();
    if (dir && reply.ms > 0 && megapixels > 0) await saveChoices(dir, { seconds_per_mp: reply.ms / 1000 / megapixels }).catch(() => {});
    const was: [number, number] = [decoded.width, decoded.height], scale = reply.reference.width / decoded.width;
    reference.sharpened = { from: { path: reference.path, width: decoded.width, height: decoded.height, sha256: sha, ...(reference.mimeType ? { mimeType: reference.mimeType } : {}) },
      model: spec.name, revision: spec.revision, scale, full: outputs.full, at: new Date().toISOString() };
    reference.path = reply.reference.path; reference.width = reply.reference.width; reference.height = reply.reference.height; reference.mimeType = 'image/png';
    delete reference.mass_map;
    await host.persist(); host.publish();
    return { scale, was, note: sharpenedNote(reference)! };
  }

  return { refusal, sharpen };
}
export type ReferenceSharpener = ReturnType<typeof referenceSharpener>;
