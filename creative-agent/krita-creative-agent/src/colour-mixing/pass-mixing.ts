// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The catalog gate for colour mixing (colour-mixing plan, task 6). A mixing model reaches the painter, and a (preset, model)
// pair reaches the plugin, only when brush-catalog.json `mixing` holds a measured card for it:
//   mixing.models[model] = card string; mixing.presets[preset] = { cards: { [model]: card }, default?: model, coverage?: share }.
// coverage is the preset's measured paint share in a mix (the brush colour's weight over the paint beneath, task 7: Wet Paint
// Plus about 0.91), which the reference transfer's pigment-aware colour choice solves with (transfer-colours.ts).
// rgb is the upstream behaviour and always allowed: it sends nothing. With a mixing policy (mixing-policy.ts, task 6a) a pass
// that names no model gets the policy's model for its kind; without one (older callers) the preset's default applies.
// Mechanism only: the catalog and policy come in as arguments, so this module imports no .mjs (and only types from the policy).
import type { MixModel } from './mix.ts';
import { MIX_MODELS } from './mix.ts';
import type { KindSource, MixingPolicy, PassKind } from './mixing-policy.ts';

export type PresetMixing = { cards?: Partial<Record<MixModel, string>>; default?: MixModel; coverage?: number };
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

/** The preset's measured paint share (0 < coverage <= 1), or null when it has no measured card or no coverage. */
export function presetCoverage(name: string, catalog: MixingCatalog): number | null {
  const coverage = catalog.mixing?.presets?.[name]?.coverage;
  return presetMixing(name, catalog) && typeof coverage === 'number' && coverage > 0 && coverage <= 1 ? coverage : null;
}

/** Every measured pair, as "preset: model, model; preset: ...". */
function measuredPairs(catalog: MixingCatalog): string {
  const rows = Object.keys(catalog.mixing?.presets ?? {}).map(name => [name, Object.keys(presetMixing(name, catalog)?.cards ?? {})] as const).filter(([, m]) => m.length);
  return rows.map(([name, models]) => `${name}: ${models.join(', ')}`).join('; ');
}

/** What the plugin gets for a pass, and why: `mixing_model`, or nothing (rgb), or the refusal. Order: the pass's explicit
 * `mixing` (refused without a card) > for a kind only derived from the preset's catalog job, the preset's measured card
 * (its default, else its first carded model: the preset was carded to blend wet paint; pilot 5) > the policy's model for
 * the pass kind, where the preset has a card for it > rgb. A stated or plan kind always follows the policy table. Without
 * a policy, the preset's default stands in for the policy. A policy never refuses: no card means rgb. */
export function decidePassMixing(args: { preset: string; mixing?: MixModel | string; kind?: PassKind | string; kind_source?: KindSource }, catalog: MixingCatalog, policy?: MixingPolicy): { mixing_model?: MixModel; reason: string } | { error: string } {
  const named = args.mixing;
  if (named === undefined) {
    const own = presetMixing(args.preset, catalog);
    if (!policy) return own?.default && own.default !== 'rgb' ? { mixing_model: own.default, reason: 'the preset\'s default (no policy)' } : { reason: 'no policy and no preset default' };
    if (args.kind_source === 'derived' && own) {
      const card = own.default ?? (Object.keys(own.cards) as MixModel[]).find(m => m !== 'rgb');
      if (card && card !== 'rgb') return { mixing_model: card, reason: `kind derived from the preset's job: the preset's measured ${card} card` };
    }
    const kind = args.kind && Object.hasOwn(policy.kinds, args.kind) ? args.kind : undefined;
    const model = kind ? policy.kinds[kind as PassKind] ?? policy.default : policy.default;
    const rule = kind ? `policy ${kind}: ${model}` : `policy default: ${model}`;
    if (model === 'rgb') return { reason: rule };
    return isModel(model) && own?.cards[model] ? { mixing_model: model, reason: rule } : { reason: `${rule}, but ${args.preset} has no measured ${model} card: rgb` };
  }
  if (named === 'rgb') return { reason: 'explicit mixing rgb' };
  const measured = measuredModels(catalog);
  if (!measured.length) return { error: `Mixing "${named}" is not available: no mixing model has a measured card yet. Leave mixing out; the preset blends as it always does.` };
  const own = presetMixing(args.preset, catalog);
  if (!isModel(named) || !measured.includes(named) || !own?.cards[named]) {
    const here = own ? `${args.preset} has measured cards for ${Object.keys(own.cards).join(', ')}` : `${args.preset} has no measured mixing card`;
    return { error: `Mixing "${named}" has no measured card for ${args.preset}: ${here}. Measured pairs: ${measuredPairs(catalog)}. Leave mixing out (or rgb) for the preset's usual blending.` };
  }
  return { mixing_model: named, reason: `explicit mixing ${named}` };
}

/** What the plugin gets for a pass (decidePassMixing without its reason). */
export function passMixing(args: { preset: string; mixing?: MixModel | string; kind?: PassKind | string; kind_source?: KindSource }, catalog: MixingCatalog, policy?: MixingPolicy): { mixing_model?: MixModel } | { error: string } {
  const decided = decidePassMixing(args, catalog, policy);
  if ('error' in decided) return decided;
  return decided.mixing_model ? { mixing_model: decided.mixing_model } : {};
}

type Executable = { parameters?: unknown; execute: (id: string, args: any, signal?: AbortSignal, ...rest: any[]) => Promise<any> };

/** Where withMixing finds the policy and the pass kind: the policy, the kind of the plan step painting now (FolderStepKind,
 * studio.mjs paintStepKind), how a kind and its source are resolved (mixing-policy.ts resolvePassKind, passed in to keep
 * this module's imports type-only), and where each pass's decision is recorded (the `pass_mixing` diagnostic). */
export type MixingContext = {
  policy: () => MixingPolicy;
  stepKind?: () => string | null | undefined;
  resolve: (input: { tool?: string; stated?: string | null; step?: string | null; preset?: string }, catalog: MixingCatalog) => { kind: PassKind; source: KindSource };
  record?: (event: Record<string, unknown>) => void;
};

/** Wraps a paint_pass tool so its prompt-facing `mixing` becomes the plugin's `mixing_model` (or is refused); the batch,
 * paint_recipe and the reference tools capture this execute, so their passes (every pass inside a paint_batch included)
 * get the same handling. With a context, a pass that names no model gets the policy's: its kind is the host's internal
 * `pass_kind` (stated; the reference tools send their own; never sent to the plugin), else the plan step's, else derived
 * from the preset's job. With a context, the decision (preset, kind, kind_source, model, reason) is recorded as a
 * `pass_mixing` diagnostic and returned in the result's details.pass_mixing. */
export function withMixing<T extends Executable>(tool: T, catalog: () => MixingCatalog, context?: MixingContext): T {
  const inner = tool.execute;
  tool.execute = async (id, args, ...rest) => {
    const { mixing, pass_kind, ...others } = args ?? {};
    const current = catalog();
    const resolved = context ? context.resolve({ tool: 'paint_pass', stated: typeof pass_kind === 'string' && pass_kind ? pass_kind : null,
      step: context.stepKind?.() ?? null, preset: others.preset }, current) : undefined;
    const decided = decidePassMixing({ preset: others.preset, ...(mixing === undefined ? {} : { mixing }),
      ...(resolved ? { kind: resolved.kind, kind_source: resolved.source } : {}) }, current, context?.policy());
    if ('error' in decided) throw new Error(decided.error);
    const sent = decided.mixing_model ? { mixing_model: decided.mixing_model } : {};
    const result = await inner(id, { ...others, ...sent }, ...rest);
    if (!context || !resolved) return result;
    const record = { preset: others.preset, kind: resolved.kind, kind_source: resolved.source, model: decided.mixing_model ?? 'rgb', reason: decided.reason };
    context.record?.({ type: 'pass_mixing', ...record });
    return result && typeof result === 'object' ? { ...result, details: { ...(result.details ?? {}), pass_mixing: record } } : result;
  };
  return tool;
}
