// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// make_brush (openspec painting-skills goal 2; the artist, 2026-11-14: "what if it was allowed to create its own brushes
// and tools if needed to improve the process"). Two baseline copies of that day showed why: one reference tool solved
// colour and placement, and every surface still came out as the same small soft dabs, because the painter could only
// pick among catalogue presets. Here it describes the mark it needs in a small vocabulary (brush-recipe.ts: tip, spacing,
// scatter, opacity, flow, how each follows the pen, smudge, texture) on top of a catalogue preset, and the brush is kept
// only on evidence:
//   1. the plugin paints one fixed sheet with the base preset and one with the new brush (brush_swatch, brush_craft.py:
//      a hidden scratch document, no painting touched);
//   2. sheets that come out the same are not a brush, and Luna is not asked;
//   3. Luna chooses blind: it sees the mark's sentence, a close-up of the reference when the painter gave one, and the two
//      sheets as A and B in a drawn order, never which is which or any setting;
//   4. the brush is saved to the library (library/brushes.ts) only when Luna picks it. With no decision model, or no
//      answer, it is kept marked unjudged and the result says so: the painter has both sheets and judges itself;
//   5. at most MOST_TRIES tries a brush in a chat. A brush that never wins is refused after that and recorded, because a
//      mark no brush setting reaches is a matter of placing strokes (goal 4, techniques).
// The studio's calls come in as dependencies, so this module imports no .mjs.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ChoiceQuestion, DecisionImage, DecisionMaker, DecisionPart } from './decisions/types.ts';
import { brushRecipe, ENGINES } from './brush-recipe.ts';
import { MATERIALS, brushId, checkBrushName, type MadeBrush, type Material } from './library/brushes.ts';

export const MOST_TRIES = 4;
export const DEFAULT_SIZE = 60;
const FOLDER = 'brush-builds';

const brushSchema = Type.Object({
  material: Type.Union(MATERIALS.map(m => Type.Literal(m)), { description: 'The material the brush belongs to, as painters name it; it is the shelf the brush is kept on.' }),
  name: Type.String({ minLength: 1, maxLength: 40, description: 'Lowercase words joined by hyphens, the mark or the tool a painter would name: "stick-side", "impasto", "pen-line".' }),
  mark: Type.String({ minLength: 1, maxLength: 300, description: 'One sentence on the mark it should make, as you see it in the reference: "a broad grainy drag of the stick’s side, edges broken by the paper".' }),
  base: Type.String({ minLength: 1, maxLength: 200, description: `An exact preset name from list_brushes to start from, of a ${ENGINES.join(' or ')} brush (a pixel brush such as b) Basic-5 Size, or a Color Smudge blender such as k) Blender Basic).` }),
  settings: Type.Object({}, { additionalProperties: true, description:
    'What to change on the base, each optional. tip: {shape: round|rectangle (a new generated tip), diameter, ratio 0.01-1 (height to width), softness 0-1, spikes 2-12, '
    + 'density 0-1, angle -180..180, randomness 0-1}. spacing 0.01-10 (dab gap in tip widths: above 1 the dabs separate). scatter: {amount 0-5, x, y}. '
    + 'opacity 0-1. flow 0-1. build: wash|build_up. blend: a blend mode such as multiply. respond: for size, opacity, flow, rotation, scatter, softness, ratio either false '
    + '(does not follow the pen) or {input: pressure|speed|drawing_angle|fade|distance|fuzzy_dab|fuzzy_stroke, curve: 2-5 points [input, output] from 0 to 1}. '
    + 'smudge (blender bases only): {colour_rate 0-1, smudge_rate 0-1, mode: smear|dull, radius 0-300}. texture: {pattern: a pattern name such as "Canvas 04", scale 0.1-10}.' }),
  size: Type.Optional(Type.Number({ minimum: 4, maximum: 300, description: `The brush diameter the swatch is painted at, in pixels of the 1600-pixel sheet (default ${DEFAULT_SIZE}).` })),
  crop: Type.Optional(Type.Object({ reference_id: Type.String({ minLength: 1 }),
    rect: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 4, maxItems: 4, description: '[x, y, width, height] in the reference’s pixels.' }) },
    { additionalProperties: false, description: 'A close-up of the reference that shows the mark; the judge sees it beside the two sheets. Give it whenever a reference is attached.' })),
}, { additionalProperties: false });
export type BrushArgs = Static<typeof brushSchema>;

type Result = AgentToolResult<unknown>;
type Picture = DecisionImage & { type: 'image'; mimeType: string };
export type SwatchResult = { status?: string; error?: string; path?: string; engine?: string; ink_share?: number };
export type BrushMakerRuntime = { emit(event: Record<string, unknown>): void };
export type BrushMakerDependencies = {
  /** The chat's folder: swatches are written under it (the plugin writes images only there). */
  folder(): string;
  /** The plugin's brush_swatch (brush_craft.py): one sheet with a preset or a recipe, written to out_path. */
  swatch(params: Record<string, unknown>, signal?: AbortSignal): Promise<SwatchResult>;
  /** A written swatch as an image for the painter and for Luna. */
  picture(path: string): Promise<Picture>;
  /** A close-up of an attached reference, or null when it cannot be cut. */
  crop(request: { reference_id: string; rect: number[] }, signal?: AbortSignal): Promise<DecisionImage | null>;
  /** The decision model, or null when Decision checks are off or not connected. */
  luna(): Promise<DecisionMaker | null>;
  /** Keep the brush in the library, its swatch beside it. */
  save(brush: MadeBrush, swatch: string): Promise<unknown>;
  random?(): number;
  now?(): string;
};

const DESCRIPTION = 'Make a brush of your own when no catalogue preset makes the mark the picture needs (the side of a pastel stick, a loaded impasto '
  + 'stroke, a dry broken drag, a fine pen line). Describe the mark in one sentence, choose the catalogue preset nearest to it as the base, and change '
  + 'only what the mark needs in settings. The host paints one fixed sheet (a pressure ramp, a curve, short swelling strokes, single dabs, two colours '
  + 'crossed) with the base and with your brush, returns both, and a judge who is not told which is which says which is closer to the mark. The brush is '
  + `kept only when it wins; then paint with it by giving brush: "<material>/<name>" wherever a preset goes. You have ${MOST_TRIES} tries a brush: look at `
  + 'the returned sheets, change one or two settings at a time, and call again with the same name. No painting is touched.';

const json = (value: unknown): Result['content'][number] => ({ type: 'text', text: JSON.stringify(value) });

export function brushMakerTools(runtime: BrushMakerRuntime, dependencies: BrushMakerDependencies): ToolDefinition<any, unknown>[] {
  const tries = new Map<string, number>();
  return [{
    name: 'make_brush', label: 'Making a brush', executionMode: 'sequential', parameters: brushSchema, description: DESCRIPTION,
    execute: async (_id: string, args: BrushArgs, signal?: AbortSignal): Promise<Result> => {
      signal?.throwIfAborted();
      if (!MATERIALS.includes(args.material as Material)) throw new Error(`material must be one of ${MATERIALS.join(', ')}.`);
      const name = checkBrushName(args.name), id = brushId({ material: args.material, name });
      const size = args.size ?? DEFAULT_SIZE;
      if ((tries.get(id) ?? 0) >= MOST_TRIES)
        throw new Error(`${id} did not beat its base preset in ${MOST_TRIES} tries. A mark no brush setting reaches is a matter of placing strokes, not of the brush: `
          + 'paint it with paint_recipe or drawn strokes, or start again from another base under another name.');
      const folder = join(dependencies.folder(), FOLDER, randomUUID().replace(/-/g, '').slice(0, 12));
      runtime.emit({ type: 'status', phase: 'painting', message: `Making a brush: ${id}…` });
      // The base sheet first: it is one side of the comparison, and its answer names the base preset's engine.
      const base = await dependencies.swatch({ preset: args.base, out_path: join(folder, 'base.png'), size }, signal);
      if (base.status !== 'ok' || !base.path || !base.engine) throw new Error(base.error ?? 'The base preset’s swatch could not be painted.');
      const recipe = brushRecipe({ preset: args.base, engine: base.engine }, args.settings);
      const made = await dependencies.swatch({ recipe, out_path: join(folder, 'made.png'), size }, signal);
      if (made.status !== 'ok' || !made.path) throw new Error(made.error ?? 'The brush’s swatch could not be painted.');
      const [basePicture, madePicture] = [await dependencies.picture(base.path), await dependencies.picture(made.path)];
      const attempt = (tries.get(id) ?? 0) + 1;
      tries.set(id, attempt);
      const left = MOST_TRIES - attempt;
      const done = (report: Record<string, unknown>): Result => {
        if (!report.kept && left === 0) runtime.emit({ type: 'brush_failed', brush: id, mark: args.mark, base: args.base, tries: attempt });
        if (report.kept) tries.delete(id);
        runtime.emit({ type: 'action', seconds: 0, message: report.kept ? `Brush kept: ${id}.` : `Brush not kept: ${id}.` });
        return { content: [json({ brush: { brush: id, base: args.base, engine: base.engine, tries_left: left, ...report } }), basePicture, madePicture],
          details: { brush: id, kept: report.kept, swatch: made.path } };
      };
      const sheets = 'The first image is the base preset’s sheet, the second your brush’s.';
      if (basePicture.data === madePicture.data)
        return done({ kept: false, note: `Not kept: the two sheets show the same marks, so these settings change nothing visible on this base. ${sheets}` });

      let judged: 'luna' | 'unjudged' = 'unjudged', luna = 'not asked', won = true;
      const client = await dependencies.luna().catch(() => null);
      if (client) {
        const close = args.crop ? await dependencies.crop(args.crop, signal).catch(() => null) : null;
        const madeFirst = (dependencies.random ?? Math.random)() < 0.5;
        const parts: DecisionPart[] = ['Two brush swatch sheets, painted with the same strokes on the same ground.',
          ...(close ? ['Close-up of the painting:', close] : []),
          'Sheet A:', madeFirst ? madePicture : basePicture, 'Sheet B:', madeFirst ? basePicture : madePicture];
        const question: ChoiceQuestion = { type: 'choice',
          instructions: `A painter needs a brush that makes this mark: "${args.mark}"${close ? ' It is the mark in the close-up of the painting.' : ''} `
            + 'Each sheet shows one brush: a stroke from light to full pressure, a long curve, five short strokes, single dabs and two colours crossed. '
            + 'Judge the marks themselves (their shape, edges, grain, how they thin and swell, how the dabs sit), not the sheet as a picture. Which sheet’s brush is closer to that mark?',
          criteria: { A: 'Sheet A’s brush is closer to the mark.', B: 'Sheet B’s brush is closer to the mark.', same: 'Neither is closer: no difference that matters for this mark.' } };
        const decision = await client.decide({ parts, questions: { closer: question }, signal, purpose: 'brush-choice' }).catch(() => null);
        const answer = decision && !decision.fallback ? decision.answers.closer : undefined;
        if (answer?.type === 'choice' && ['A', 'B', 'same'].includes(answer.choice)) {
          judged = 'luna';
          won = answer.choice === (madeFirst ? 'A' : 'B');
          luna = won ? 'chose the new brush' : answer.choice === 'same' ? 'saw no difference that matters' : 'chose the base preset';
        } else luna = 'gave no answer';
      }
      if (!won)
        return done({ kept: false, judged_by: judged, luna,
          note: `Not kept: the judge ${luna}. ${sheets} Compare them with the mark, change one or two settings and call make_brush again with the same name`
            + (left ? ` (${left} ${left === 1 ? 'try' : 'tries'} left).` : '; this was the last try.') });
      const brush: MadeBrush = { material: args.material as Material, name, mark: args.mark, base: args.base, engine: base.engine, size,
        settings: args.settings as Record<string, unknown>, judged_by: judged, learned_from: [], made_at: (dependencies.now ?? (() => new Date().toISOString()))() };
      await dependencies.save(brush, made.path);
      return done({ kept: true, judged_by: judged, luna,
        note: (judged === 'luna' ? 'Kept: the judge chose it over the base preset. ' : 'Kept, but not judged: no decision model answered, so compare the two sheets yourself before you rely on it. ')
          + `${sheets} Paint with it by giving brush: "${id}" where a preset goes.` });
    },
  }];
}
