// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Repaint from asset (openspec repaint-from-asset; the artist, 2026-11-16): "repaint the tower from this image". The
// underpainting on the canvas says where the part is, the asset says what it looks like, and the canvas's outline wins.
// One tool, and the host runs every step of it, so the painter cannot wander off to an image model (chat c6928c35 made
// two AI images for a part the artist had attached a picture of):
//
//   1. the part's area on the canvas: the one set, or the area question ask_for_selection asks ("Is this the tower?",
//      the shapes model's outline selected on the painting); the call ends there and is made again after the answer;
//   2. the same part in the asset, by the shapes model (null: the asset is its part all over, a sky filling its frame);
//   3. the fit, measured before any paint (asset-fit.ts); a poor one paints nothing and says why. An asset too small is
//      sharpened once first when the host can;
//   4. the fitted picture kept in the chat as a reference of its own and transferred onto the area's box with the
//      reference transfer as it is (it skips see-through pixels and keeps to the artist's area).
//
// The studio's calls come in as a small host, so this module imports no .mjs.
import { Type, type Static } from 'typebox';
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { fitAsset, measureFit, MAX_SCALE, type Fit, type Rgba, type Shape } from './asset-fit.ts';

/** A found part covering at least this share of its asset is the asset all over (a sky filling its frame): used whole. */
export const ASSET_WHOLE = 0.85;
export type AssetRef = { id: string; name?: string; width: number; height: number };
/** An area on the canvas: the artist's Paint only here area, or a found outline (bounds in canvas pixels, its mask file). */
export type CanvasArea = { bounds: number[]; mask_path: string; name?: string | null };
type Result = AgentToolResult<unknown>;
export type Recipe = { name: string; reference_id: string; preset: string; source: number[]; target: number[] };

export type RepaintHost = {
  /** An attached reference or asset of the chat, or null. */
  reference(id: string): AssetRef | null;
  /** Whether this is the goal picture the whole underpainting was transferred from (its parts are painted by a scoped transfer). */
  placedGoal?(reference: AssetRef): Promise<boolean>;
  /** The artist's Paint only here area, when one is set. */
  area(): CanvasArea | null;
  /** The area question for `part` (paint-only-here.ts askForArea). */
  ask(part: string): Promise<{ asked: boolean; adopted?: CanvasArea; negated?: boolean; reply: string }>;
  /** The artist answered the area question for `part` without an area (Paint everywhere). */
  passed(part: string): boolean;
  /** The shapes model's outline of `part` on the canvas, or null. */
  propose(part: string): Promise<CanvasArea | null>;
  /** An area's shape, read from its mask file. */
  shape(area: CanvasArea): Promise<Shape>;
  /** The part's shape in the asset's own pixels; null when the asset is that part all over. Throws when it is not found. */
  findInAsset(reference: AssetRef, part: string, signal?: AbortSignal): Promise<Shape | null>;
  pixels(reference: AssetRef): Promise<Rgba>;
  /** The asset sharpened (its larger picture), or null when it cannot be. */
  sharpen?(reference: AssetRef, signal?: AbortSignal): Promise<AssetRef | null>;
  /** The fitted picture kept in the chat as a reference of its own. */
  keep(reference: AssetRef, part: string, picture: Rgba): Promise<AssetRef>;
  /** The reference transfer (paint_from_reference). */
  transfer(id: string, recipe: Recipe, signal?: AbortSignal): Promise<Result>;
  emit(event: Record<string, unknown>): void;
  record?(event: Record<string, unknown>): void;
};

const schema = Type.Object({
  reference_id: Type.String({ minLength: 1, maxLength: 200, description: 'The attached asset or reference to repaint from.' }),
  part: Type.String({ minLength: 1, maxLength: 60, description: 'The part, as the artist said it: "the tower", "the car", "the sky".' }),
  preset: Type.String({ minLength: 1, maxLength: 200, description: 'The brush preset for the dabs, as paint_from_reference takes it.' }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 80, description: 'A name for the layers; by default the part and the asset.' })),
}, { additionalProperties: false });
type Args = Static<typeof schema>;

const reply = (text: string, details: Record<string, unknown> = {}): Result => ({ content: [{ type: 'text', text }], details });
const NO_IMAGE = 'Do not call make_asset in its place unless the artist asks for an AI image.';

/** The steps of one repaint (see the head of this file). */
export async function repaintFromAsset(host: RepaintHost, id: string, args: Args, signal?: AbortSignal): Promise<Result> {
  let asset = host.reference(args.reference_id);
  if (!asset) throw new Error('Use an attached reference or asset ID.');
  const part = args.part.trim().slice(0, 60), label = asset.name ?? asset.id;
  if (await host.placedGoal?.(asset).catch(() => false)) return reply(`${label} is the goal picture the underpainting was transferred from, already in place on the canvas: `
    + `paint ${part} from it with paint_from_reference inside its area (ask_for_selection first), then paint_finish and paint_accents there.`, { goal: true });
  let area = host.area();
  if (!area && !host.passed(part)) {
    const outcome = await host.ask(part);
    if (outcome.asked) return reply(`${outcome.reply} When the artist has answered, call repaint_from_asset again with the same arguments.`, { asked: true });
    if (outcome.negated) return reply(outcome.reply, { negated: true });
    area = outcome.adopted ?? null;
  }
  // No area (the artist chose Paint everywhere, or Autopilot does not stop): the found outline is the shape to fit into.
  area ??= await host.propose(part).catch(() => null);
  if (!area) return reply(`Repaint from asset needs ${part}’s area on the painting, and the shapes model did not find it. Ask the artist to select it (ask_for_selection), `
    + `then call repaint_from_asset again. ${NO_IMAGE}`, { needs_area: true });
  const onCanvas = await host.shape(area);

  const find = async (from: AssetRef): Promise<Shape | null | Error> => {
    try { return await host.findInAsset(from, part, signal); } catch (error) { signal?.throwIfAborted(); return error as Error; }
  };
  let inAsset = await find(asset);
  const notFound = () => {
    host.emit({ type: 'action', seconds: 0, message: `I could not find ${part} in ${label}, so nothing was painted from it.` });
    return reply(`The shapes model could not find ${part} in ${label}. Nothing was painted. Tell the artist; they can name the part as it appears in that image, `
      + `or cut it out themselves (the reference’s Select a part in Krita). ${NO_IMAGE}`, { not_found: true });
  };
  if (inAsset instanceof Error) return notFound();
  let fit: Fit = measureFit(inAsset, onCanvas, asset);
  if (!fit.fits && fit.scale > MAX_SCALE && fit.why?.includes('too small') && host.sharpen) {
    const sharper = await host.sharpen(asset, signal).catch(() => null);
    if (sharper && sharper.width > asset.width) {
      asset = sharper; inAsset = await find(asset);
      if (inAsset instanceof Error) return notFound();
      fit = measureFit(inAsset, onCanvas, asset);
    }
  }
  host.record?.({ type: 'repaint_fit', part, asset: asset.id, ...fit, whole: !inAsset, area: area.bounds });
  if (!fit.fits) {
    host.emit({ type: 'action', seconds: 0, message: `${label} does not fit ${part} on the painting: ${fit.why}. Nothing was painted.` });
    return reply(`${label} does not fit ${part} on the painting: ${fit.why}. Nothing was painted. ${JSON.stringify({ fit })} `
      + `Tell the artist plainly; they can adjust the area, choose another image, or ask for it to be painted by hand. ${NO_IMAGE}`, { fit, painted: false });
  }

  const picture = fitAsset(await host.pixels(asset), inAsset, onCanvas), fitted = await host.keep(asset, part, picture);
  const recipe: Recipe = { name: (args.name ?? `${part} from ${label}`).slice(0, 80), reference_id: fitted.id, preset: args.preset,
    source: [0, 0, fitted.width, fitted.height], target: area.bounds.slice(0, 4) };
  const result = await host.transfer(id, recipe, signal);
  return { ...result, content: [...result.content, { type: 'text', text: JSON.stringify({ repainted: { part, asset: label, fit,
    note: 'The canvas’s outline was kept: only this area changed. Finish it with paint_finish in the area, then paint_accents.' } }) }],
    details: { ...(result.details as object), repaint: { part, asset: asset.id, fitted: fitted.id, fit } } };
}

export function repaintTools(host: RepaintHost): ToolDefinition<any, unknown>[] {
  return [{
    name: 'repaint_from_asset', label: 'Repainting from an asset', executionMode: 'sequential', parameters: schema,
    description: 'When the artist names an attached image for one part of the painting ("paint the buildings with this reference", "repaint the tower from '
      + '02-historic-buildings"): repaint that part from the image in brush strokes, where it already is on the canvas. The host does every step: it asks the '
      + 'artist for the part’s area (the shapes model’s outline, selected on the painting) unless one is set, finds the same part in the image, checks that its '
      + 'shape fits the area (a poor fit paints nothing and says why), and transfers it into the area. The canvas’s outline wins: nothing outside the area '
      + 'changes. Use this, never make_asset, for an image the artist attached; the image is never placed as a layer. After the question, stop; call it again '
      + 'with the same arguments once the artist has answered. Then finish the area with paint_finish and paint_accents.',
    execute: async (id: string, args: Args, signal?: AbortSignal): Promise<Result> => repaintFromAsset(host, id, args, signal),
  }];
}
