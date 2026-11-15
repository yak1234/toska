// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The brushes shelf of the painting-skills library (openspec painting-skills goal 1, scheme A, picked by the artist
// 2026-11-15): materials/<material>/brushes/<name>.yaml, each with its swatch <name>.png beside it. A brush file holds
// the painter's own words for the brush (make_brush's settings vocabulary, src/brush-recipe.ts), never engine keys, so
// the artist can read and edit it; the recipe is worked out again from the settings on every load, and a file that does
// not check is skipped with its file and field named while the others load. The folder is the caller's (Toska's data
// folder, never a painting's). Data only: nothing in a brush file is run.
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { brushRecipe, type BrushRecipe } from '../brush-recipe.ts';

/** The materials shelf: the words painters use, lowercase with hyphens on disk. */
export const MATERIALS = ['soft-pastel', 'oil', 'watercolour', 'ink', 'charcoal', 'gouache', 'tempera'] as const;
export type Material = typeof MATERIALS[number];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = ['material', 'name', 'mark', 'base', 'engine', 'size', 'settings', 'judged_by', 'learned_from', 'made_at'];

/** A brush as the painter made it. `judged_by`: 'luna' when Luna chose its swatch over the base preset's, 'unjudged' when
 * no decision model was there to ask. `learned_from`: the studies that taught it. */
export type MadeBrush = { material: Material; name: string; mark: string; base: string; engine: string; size: number;
  settings: Record<string, unknown>; judged_by: 'luna' | 'unjudged'; learned_from: string[]; made_at: string };
export type LibraryBrush = MadeBrush & { recipe: BrushRecipe; file: string };
export type BrushLibrary = { brushes: Map<string, LibraryBrush>; skipped: string[] };

export const brushId = (brush: { material: string; name: string }) => `${brush.material}/${brush.name}`;

export function checkBrushName(name: unknown): string {
  if (typeof name !== 'string' || name.length > 40 || !NAME.test(name))
    throw new Error('A brush name is lowercase words joined by hyphens, up to 40 characters (for example stick-side).');
  return name;
}

/** The brush checked field by field, with its recipe. Throws an Error naming the field. */
function checked(value: unknown): MadeBrush & { recipe: BrushRecipe } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('a brush is a map of ' + FIELDS.join(', '));
  const b = value as Record<string, unknown>;
  const unknown = Object.keys(b).filter(key => !FIELDS.includes(key));
  if (unknown.length) throw new Error(`unknown field ${unknown.join(', ')}`);
  if (!MATERIALS.includes(b.material as Material)) throw new Error(`material must be one of ${MATERIALS.join(', ')}`);
  const name = checkBrushName(b.name);
  for (const key of ['mark', 'base', 'engine'] as const)
    if (typeof b[key] !== 'string' || !(b[key] as string).trim() || (b[key] as string).length > 300) throw new Error(`${key} must be text (up to 300 characters)`);
  if (typeof b.size !== 'number' || !Number.isFinite(b.size) || b.size < 4 || b.size > 300) throw new Error('size must be a number from 4 to 300');
  const judged = b.judged_by ?? 'unjudged';
  if (judged !== 'luna' && judged !== 'unjudged') throw new Error('judged_by must be luna or unjudged');
  const learned = b.learned_from ?? [];
  if (!Array.isArray(learned) || learned.length > 20 || learned.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('learned_from is a list of up to 20 study ids');
  const made = b.made_at ?? '';
  if (typeof made !== 'string' || made.length > 40) throw new Error('made_at must be a date');
  const settings = (b.settings ?? {}) as Record<string, unknown>;
  const recipe = brushRecipe({ preset: b.base as string, engine: b.engine as string }, settings);
  return { material: b.material as Material, name, mark: b.mark as string, base: b.base as string, engine: b.engine as string, size: b.size,
    settings, judged_by: judged, learned_from: learned as string[], made_at: made, recipe };
}

const shelf = (root: string, material: string) => join(root, 'materials', material, 'brushes');

/** Write a brush to its material's shelf (replacing one of the same name), its swatch copied beside it when given. */
export async function saveBrush(root: string, brush: MadeBrush, swatch?: string): Promise<LibraryBrush> {
  const { recipe, ...plain } = checked(brush);
  const dir = shelf(root, plain.material), file = join(dir, plain.name + '.yaml');
  await mkdir(dir, { recursive: true });
  await writeFile(file + '.tmp', stringify(plain));
  await rename(file + '.tmp', file);
  if (swatch) await copyFile(swatch, join(dir, plain.name + '.png'));
  return { ...plain, recipe, file };
}

async function entries(dir: string): Promise<string[]> {
  try { return (await readdir(dir)).filter(name => !name.startsWith('.')).sort(); }
  catch (e) {
    if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return [];
    throw e;
  }
}

/** Every brush of the library folder, by material/name. No folder (or '') is an empty library. */
export async function loadBrushes(root: string): Promise<BrushLibrary> {
  const library: BrushLibrary = { brushes: new Map(), skipped: [] };
  if (!root) return library;
  for (const material of await entries(join(root, 'materials'))) {
    for (const name of (await entries(shelf(root, material))).filter(f => f.endsWith('.yaml'))) {
      const file = join(shelf(root, material), name);
      try {
        const brush = checked(parse(await readFile(file, 'utf8')));
        if (brush.material !== material || brush.name + '.yaml' !== name)
          throw new Error(`material and name must match the file's place (materials/${brush.material}/brushes/${brush.name}.yaml)`);
        library.brushes.set(brushId(brush), { ...brush, file });
      } catch (e) {
        library.skipped.push(`${material}/brushes/${name}: ${(e as Error).message}`);
      }
    }
  }
  return library;
}

/** The made brushes as list_brushes shows them: `preset` is what a pass gives where a preset goes. At most 40. */
export function madeBrushCards(library: BrushLibrary): { preset: string; material: string; mark: string; base: string; judged_by: string }[] {
  return [...library.brushes.entries()].slice(0, 40).map(([id, brush]) =>
    ({ preset: id, material: brush.material, mark: brush.mark, base: brush.base, judged_by: brush.judged_by }));
}
