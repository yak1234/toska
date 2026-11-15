// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Painting with a brush the painter made (openspec painting-skills goal 2, task 3.5). A pass names it where a preset
// goes, as "<material>/<name>" (no catalogue preset has that form): the pass then paints with the brush's base preset and
// carries its recipe (brush_recipe), which the plugin checks again and sets on the stroke job's own copy of the preset
// (brush_maker.expand, creative_tools._creative_stroke_job). It wraps paint_pass's execute, as withMixing does, and is
// wrapped last, so the mixing policy and everything else that reads `preset` sees the base preset. paint_batch runs
// its passes through the same execute. The library is read per pass that names a brush, so a brush just kept is usable
// at once, and never for an ordinary preset.
import { MATERIALS, type BrushLibrary } from './library/brushes.ts';

const BRUSH_ID = new RegExp(`^(?:${MATERIALS.join('|')})/[a-z0-9]+(?:-[a-z0-9]+)*$`);
/** Whether `preset` has the form of a library brush ("soft-pastel/stick-side"), not of a catalogue preset. */
export const isBrushId = (preset: unknown): preset is string => typeof preset === 'string' && BRUSH_ID.test(preset);

type Executable = { execute: (id: string, args: any, ...rest: any[]) => Promise<any> };

export function withBrush<T extends Executable>(tool: T, library: () => Promise<BrushLibrary>): T {
  const inner = tool.execute;
  tool.execute = async (id, args, ...rest) => {
    if (!isBrushId(args?.preset)) return inner(id, args, ...rest);
    const { brushes } = await library();
    const brush = brushes.get(args.preset);
    if (!brush)
      throw new Error(`There is no brush ${args.preset} in the library. `
        + (brushes.size ? `The brushes there: ${[...brushes.keys()].slice(0, 30).join(', ')}.` : 'It holds no brush yet: make one with make_brush, or use a preset from list_brushes.'));
    const result = await inner(id, { ...args, preset: brush.recipe.base_preset, brush_recipe: brush.recipe }, ...rest);
    return result && typeof result === 'object' ? { ...result, details: { ...(result.details ?? {}), brush: args.preset } } : result;
  };
  return tool;
}
