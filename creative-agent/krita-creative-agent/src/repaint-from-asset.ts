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
import { fillHoles, fitAsset, matchPieces, measureFit, pieces, MAX_SCALE, type Fit, type Rgba, type Shape } from './asset-fit.ts';

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
  /** One area was repainted from the asset: the host keeps it from the passes that read the goal (repaint-kept.ts). */
  painted?(done: { part: string; asset: string; fitted: AssetRef; bounds: number[] }): void;
  /** The fit was refused and nothing was painted: the host lets the move end without painting. */
  refused?(why: string): void;
  /** The canvas's size, for where an area sits on it. */
  canvas?(): [number, number] | null;
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
    try { const found = await host.findInAsset(from, part, signal); return found && fillHoles(found); } catch (error) { signal?.throwIfAborted(); return error as Error; }
  };
  let inAsset = await find(asset);
  const notFound = () => {
    host.emit({ type: 'action', seconds: 0, message: `I could not find ${part} in ${label}, so nothing was painted from it.` });
    return reply(`The shapes model could not find ${part} in ${label}. Nothing was painted. Tell the artist; they can name the part as it appears in that image, `
      + `or cut it out themselves (the reference’s Select a part in Krita). ${NO_IMAGE}`, { not_found: true });
  };
  if (inAsset instanceof Error) return notFound();
  // An asset that is its part all over (a sky, water, a wall) has no outline of its own to keep, and the area's shape
  // cuts it: a window of it with the area's proportions is taken, never a stretch, from the side of the asset the area is
  // on in the canvas (a sky at the top takes the asset's top). Only its size then decides (live 2026-11-23: the sky
  // asset was refused as "stretched 2.48 times" for the band of sky on the painting).
  let whole: Shape | null = null;
  const measure = (from: AssetRef, found: Shape | null): Fit => {
    whole = null;
    if (found) return measureFit(found, onCanvas, from);
    const view = assetWindow(from, onCanvas.bounds, host.canvas?.() ?? null), fit = measureFit(view, onCanvas, from), small = fit.scale > MAX_SCALE;
    whole = view;
    return { ...fit, uneven: 1, fits: !small, why: small ? `it is too small for this area (enlarged ${fit.scale.toFixed(2)} times, it would be painted blurred)` : null };
  };
  let fit: Fit = measure(asset, inAsset);
  if (!fit.fits && fit.scale > MAX_SCALE && fit.why?.includes('too small') && host.sharpen) {
    const sharper = await host.sharpen(asset, signal).catch(() => null);
    if (sharper && sharper.width > asset.width) {
      asset = sharper; inAsset = await find(asset);
      if (inAsset instanceof Error) return notFound();
      fit = measure(asset, inAsset);
    }
  }
  const window = (whole as Shape | null)?.bounds ?? null;
  // One name, several things (a facade and a tower; the tower with a slice of what stands beside it): each piece of the
  // asset's part is fitted to the piece of the area it matches, and the area's other pieces keep their paint.
  type Pair = { part: Shape | null; area: Shape; fit: Fit };
  let pairs: Pair[] = fit.fits ? [{ part: inAsset ?? (whole as Shape | null), area: onCanvas, fit }] : [], left = 0;
  if (!pairs.length && inAsset) {
    const matched = matchPieces(pieces(inAsset), pieces(onCanvas));
    pairs = matched.pairs; left = pairs.length ? matched.areaLeft.length : 0;
  }
  host.record?.({ type: 'repaint_fit', part, asset: asset.id, ...fit, whole: !inAsset, ...(window ? { window } : {}), area: area.bounds,
    pieces: pairs.map(pair => ({ area: pair.area.bounds, overlap: pair.fit.overlap, covered: pair.fit.covered, uneven: pair.fit.uneven, scale: pair.fit.scale })), left });
  if (!pairs.length) {
    host.refused?.(fit.why ?? 'it does not fit');
    host.emit({ type: 'action', seconds: 0, message: `${label} does not fit ${part} on the painting: ${fit.why}. Nothing was painted.` });
    return reply(`${label} does not fit ${part} on the painting: ${fit.why}, and no piece of it matched a piece of the area. Nothing was painted. ${JSON.stringify({ fit })} `
      + `Tell the artist plainly; they can adjust the area, name one thing in it, choose another image, or ask for it to be painted by hand. ${NO_IMAGE}`, { fit, painted: false });
  }

  const pixels = await host.pixels(asset), content: Result['content'] = [], repainted: Record<string, unknown>[] = [];
  let details: Record<string, unknown> = {};
  for (const [index, pair] of pairs.entries()) {
    const picture = fitAsset(pixels, pair.part, pair.area), fitted = await host.keep(asset, part, picture);
    const recipe: Recipe = { name: (args.name ?? `${part} from ${label}`).slice(0, 76) + (pairs.length > 1 ? ` ${index + 1}` : ''), reference_id: fitted.id, preset: args.preset,
      source: [0, 0, fitted.width, fitted.height], target: pair.area.bounds.slice(0, 4) };
    const result = await host.transfer(index ? `${id}-${index + 1}` : id, recipe, signal);
    content.push(...result.content); details = { ...(result.details as object) };
    host.painted?.({ part, asset: label, fitted, bounds: recipe.target });
    repainted.push({ area: pair.area.bounds, fitted: fitted.id, fit: pair.fit });
  }
  if (left) host.emit({ type: 'action', seconds: 0, message: `${left} separate piece${left === 1 ? '' : 's'} of the area matched nothing in ${label} and kept ${left === 1 ? 'its' : 'their'} paint.` });
  return { content: [...content, { type: 'text', text: JSON.stringify({ repainted: { part, asset: label, pieces: repainted,
    ...(left ? { left_as_it_was: `${left} separate piece${left === 1 ? '' : 's'} of the area matched nothing in the image: say so in your reply` } : {}),
    note: 'The canvas’s outline was kept: only this area changed. This paint is finished as it is: do not run paint_finish, surface, edge or refine passes over it (they read the underpainting and would blur it back). End the move.' } }) }],
    details: { ...details, repaint: { part, asset: asset.id, pieces: repainted, left } } };
}

/** The part of a whole asset that goes into an area: the largest window with the area's proportions, on the side of the
 * asset where the area sits in the canvas (centred when the canvas is not known). */
export function assetWindow(asset: { width: number; height: number }, bounds: number[], canvas: [number, number] | null): Shape {
  const [bx, by, bw, bh] = bounds as [number, number, number, number], wide = bw / bh > asset.width / asset.height;
  const w = Math.max(1, Math.round(wide ? asset.width : asset.height * bw / bh)), h = Math.max(1, Math.round(wide ? asset.width * bh / bw : asset.height));
  const side = (at: number, size: number, of: number | undefined) => of && of > size ? Math.min(1, Math.max(0, at / (of - size))) : 0.5;
  const x = Math.round((asset.width - w) * side(bx, bw, canvas?.[0])), y = Math.round((asset.height - h) * side(by, bh, canvas?.[1]));
  return { bounds: [x, y, w, h] as Shape['bounds'], data: new Uint8Array(w * h).fill(255) };
}

export function repaintTools(host: RepaintHost): ToolDefinition<any, unknown>[] {
  return [{
    name: 'repaint_from_asset', label: 'Repainting from an asset', executionMode: 'sequential', parameters: schema,
    description: 'When the artist names an attached image for one part of the painting ("paint the buildings with this reference", "repaint the tower from '
      + '02-historic-buildings"): repaint that part from the image in brush strokes, where it already is on the canvas. The host does every step: it asks the '
      + 'artist for the part’s area (the shapes model’s outline, selected on the painting) unless one is set, finds the same part in the image, checks that its '
      + 'shape fits the area (a poor fit paints nothing and says why), and transfers it into the area. The canvas’s outline wins: nothing outside the area '
      + 'changes. Use this, never make_asset, for an image the artist attached; the image is never placed as a layer. After the question, stop; call it again '
      + 'with the same arguments once the artist has answered. The repainted area is finished paint: end the move after it; passes that read the goal are refused there.',
    execute: async (id: string, args: Args, signal?: AbortSignal): Promise<Result> => repaintFromAsset(host, id, args, signal),
  }];
}
