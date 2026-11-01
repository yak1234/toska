// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The catalog gate for colour mixing (colour-mixing plan, task 6). A mixing model reaches the painter, and a (preset, model)
// pair reaches the plugin, only when brush-catalog.json `mixing` holds a measured card for it:
//   mixing.models[model] = card string; mixing.presets[preset] = { cards: { [model]: card }, default?: model }.
// rgb is the upstream behaviour and always allowed: it sends nothing. With a mixing policy (mixing-policy.ts, task 6a) a pass
// that names no model gets the policy's model for its kind; without one (older callers) the preset's default applies.
// Mechanism only: the catalog and policy come in as arguments, so this module imports no .mjs (and only types from the policy).
import type { MixModel } from './mix.ts';
import { MIX_MODELS } from './mix.ts';
import type { MixingPolicy, PassKind } from './mixing-policy.ts';

export type PresetMixing = { cards?: Partial<Record<MixModel, string>>; default?: MixModel };
export type MixingCatalog = { mixing?: { models?: Partial<Record<MixModel, string>>; presets?: Record<string, PresetMixing> }; jobs?: Record<string, readonly string[]> };

const isModel = (name: string): name is MixModel => (MIX_MODELS as readonly string[]).includes(name);

/** The models with a measured card, in the module's order. */
export function measuredModels(catalog: MixingCatalog): MixModel[] {
  const models = catalog.mixing?.models ?? {};
  return MIX_MODELS.filter(m => typeof models[m] === 'string' && models[m] !== '');
}

/** The preset's measured cards (only models that also have a model card) and default, or null when it has none. */
export function presetMixing(name: string, catalog: MixingCatalog): { cards: Partial<Record<MixModel, string>>; default?: MixModel } | null {
  const entry = catalog.mixing?.presets?.[name];
  if (!entry) return null;
  const measured = measuredModels(catalog);
  const cards: Partial<Record<MixModel, string>> = {};
  for (const model of measured) if (entry.cards?.[model]) cards[model] = entry.cards[model]!;
  if (!Object.keys(cards).length) return null;
  return { cards, ...(entry.default && cards[entry.default] ? { default: entry.default } : {}) };
}

/** Every measured pair, as "preset: model, model; preset: ...". */
function measuredPairs(catalog: MixingCatalog): string {
  const rows = Object.keys(catalog.mixing?.presets ?? {}).map(name => [name, Object.keys(presetMixing(name, catalog)?.cards ?? {})] as const).filter(([, m]) => m.length);
  return rows.map(([name, models]) => `${name}: ${models.join(', ')}`).join('; ');
}

/** What the plugin gets for a pass: `mixing_model`, or nothing (rgb), or the refusal. Order: the pass's explicit `mixing`
 * (refused without a card) > the policy's model for the pass kind, where the preset has a card for it > rgb. Without a
 * policy, the preset's default stands in for the policy. A policy never refuses: no card means rgb. */
export function passMixing(args: { preset: string; mixing?: MixModel | string; kind?: PassKind | string }, catalog: MixingCatalog, policy?: MixingPolicy): { mixing_model?: MixModel } | { error: string } {
  const named = args.mixing;
  if (named === undefined) {
    const own = presetMixing(args.preset, catalog);
    if (!policy) return own?.default && own.default !== 'rgb' ? { mixing_model: own.default } : {};
    const model = args.kind && Object.hasOwn(policy.kinds, args.kind) ? policy.kinds[args.kind as PassKind] ?? policy.default : policy.default;
    return model !== 'rgb' && isModel(model) && own?.cards[model] ? { mixing_model: model } : {};
  }
  if (named === 'rgb') return {};
  const measured = measuredModels(catalog);
  if (!measured.length) return { error: `Mixing "${named}" is not available: no mixing model has a measured card yet. Leave mixing out; the preset blends as it always does.` };
  const own = presetMixing(args.preset, catalog);
  if (!isModel(named) || !measured.includes(named) || !own?.cards[named]) {
    const here = own ? `${args.preset} has measured cards for ${Object.keys(own.cards).join(', ')}` : `${args.preset} has no measured mixing card`;
    return { error: `Mixing "${named}" has no measured card for ${args.preset}: ${here}. Measured pairs: ${measuredPairs(catalog)}. Leave mixing out (or rgb) for the preset's usual blending.` };
  }
  return { mixing_model: named };
}

type Executable = { parameters?: unknown; execute: (id: string, args: any, signal?: AbortSignal, ...rest: any[]) => Promise<any> };

/** Where withMixing finds the policy and the pass kind: the policy, the kind of the plan step painting now (FolderStepKind,
 * studio.mjs paintStepKind), and how a kind is derived (mixing-policy.ts derivePassKind, passed in to keep this module's
 * imports type-only). */
export type MixingContext = {
  policy: () => MixingPolicy;
  stepKind?: () => string | null | undefined;
  derive: (input: { tool?: string; step?: string | null; preset?: string }, catalog: MixingCatalog) => PassKind;
};

/** Wraps a paint_pass tool so its prompt-facing `mixing` becomes the plugin's `mixing_model` (or is refused); the batch,
 * paint_recipe and the reference tools capture this execute, so their passes get the same handling. With a context, a pass
 * that names no model gets the policy's: its kind is the host's internal `pass_kind` (the reference tools send their own;
 * never sent to the plugin), else derived from the plan step and the preset's job. */
export function withMixing<T extends Executable>(tool: T, catalog: () => MixingCatalog, context?: MixingContext): T {
  const inner = tool.execute;
  tool.execute = async (id, args, ...rest) => {
    const { mixing, pass_kind, ...others } = args ?? {};
    const current = catalog();
    const kind = context ? (typeof pass_kind === 'string' && pass_kind ? pass_kind
      : context.derive({ tool: 'paint_pass', step: context.stepKind?.() ?? null, preset: others.preset }, current)) : undefined;
    const sent = passMixing({ preset: others.preset, ...(mixing === undefined ? {} : { mixing }), ...(kind ? { kind } : {}) }, current, context?.policy());
    if ('error' in sent) throw new Error(sent.error);
    return inner(id, { ...others, ...sent }, ...rest);
  };
  return tool;
}
