// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// mix_colors: preview a mix with the brushes' own maths (mix.ts, held to the C++ golden vectors) before painting it. Local
// maths, no Krita call. Only models with a measured card in the catalog are offered (pass-mixing.ts).
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { hexToRgb, mixMany, rgbToHex } from './mix.ts';
import type { MixModel, Rgb } from './mix.ts';
import { measuredModels } from './pass-mixing.ts';
import type { MixingCatalog } from './pass-mixing.ts';

export function mixColorsTool(deps: { catalog: () => MixingCatalog }): ToolDefinition<any, any> {
  const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value });
  return {
    name: 'mix_colors', label: 'Mixing colours',
    description: 'Preview the colour that mixing 2 to 6 colours gives, in the maths the brushes use, before painting. Each colour has a hex and an amount (parts: 3 and 1 is three to one). Give a model for one result, or none for the result in every measured model. The models offered are the ones with a measured card (list_brushes). Does not paint.',
    parameters: Type.Object({
      colours: Type.Array(Type.Object({ hex: Type.String(), amount: Type.Number() }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }),
      model: Type.Optional(Type.String({ maxLength: 20 })) }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: async (_id: string, args: { colours: { hex: string; amount: number }[]; model?: string }) => {
      const catalog = deps.catalog(), measured = measuredModels(catalog);
      if (!measured.length) throw new Error('No mixing model has a measured card yet, so mix_colors has nothing to preview.');
      const { colours, model } = args;
      if (colours.length < 2 || colours.length > 6) throw new Error(`mix_colors takes 2 to 6 colours, not ${colours.length}.`);
      const rgb: Rgb[] = colours.map(c => {
        const v = hexToRgb(c.hex);
        if (!v || !/^#/.test(c.hex.trim())) throw new Error(`"${c.hex}" is not a colour: use six hex digits like #3a5fcd.`);
        return v;
      });
      for (const c of colours) if (!Number.isFinite(c.amount) || c.amount < 0) throw new Error(`The amount for ${c.hex} must be a number of 0 or more, not ${c.amount}.`);
      const weights = colours.map(c => c.amount);
      if (!(weights.reduce((a, b) => a + b, 0) > 0)) throw new Error('The amounts sum to 0: give at least one colour an amount greater than 0.');
      const one = (m: MixModel) => ({ model: m, hex: rgbToHex(mixMany(m, rgb, weights)) });
      if (model === undefined) return reply({ mixes: measured.map(one) });
      if (!(measured as string[]).includes(model)) throw new Error(`Model "${model}" is not measured. Measured: ${measured.join(', ')}.`);
      return reply(one(model as MixModel));
    },
  };
}
