// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The mixing policy (colour-mixing proposal, amendment 2026-11-01; the user: "Agents can't it be a yaml determinism"):
// which mixing model each kind of paint pass uses, from the bundled mixing-policy.yaml, so mixing is used where it helps
// without the painter choosing it (pilot P1: offered the choice, the painter mixed 0 times). Deterministic and pure: the
// pass kind comes from what the host already knows, and a model applies only where the pass's preset has a measured card
// (pass-mixing.ts passMixing holds the order: explicit `mixing` > this policy > rgb). An invalid file is an error naming
// its field, and the companion then mixes rgb everywhere (mixingPolicyOrRgb): a bad edit never crashes a chat.
//
// The pass kind (derivePassKind), first rule that applies:
//
//   source                                   | kind
//   -----------------------------------------|---------------------------------------------------------------
//   tool paint_from_reference                | reference_transfer (the dab transfer, whatever the step; amendment
//   tool continue_reference_painting         | reference_transfer  2026-11-01 (2). reference-tool.mjs sends the job's
//   tool paint_reference_surface             | blend            own kind: surface → blend, edges → details, else
//                                            |                  reference_transfer)
//   tool paint_reference_edges               | details
//   tool paint_finish                        | finish          (plugin pixel operations, no brush preset:
//   tool refine_to_goal                      | refine           the policy has nothing to apply there; listed so
//   tool paint_accents                       | accents          every tool has one kind)
//   plan step underpainting                  | underpainting   (project-folder.ts folderStepKind of the step the
//   plan step finish                         | finish           Agent move or Autopilot paints now: studio.mjs
//   plan step refine, refine_part            | refine           paintStepKind)
//   plan step accents                        | accents
//   plan step element, addition              | element
//   plan step whole, or no plan step         | the preset's job, below
//   job "blending existing paint…"           | blend           (brush-catalog.json "jobs"; the first job that
//   job "translucent glazes"                 | glaze            lists the preset, in the file's order)
//   job "soft light, glow and atmosphere"    | atmosphere
//   job "small details…", "crisp edges…"     | details
//   any other job, or a preset in no job     | block_in
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { MixModel } from './mix.ts';
import { passMixing } from './pass-mixing.ts';
import type { MixingCatalog } from './pass-mixing.ts';

export type PassKind = 'underpainting' | 'block_in' | 'finish' | 'refine' | 'blend' | 'glaze' | 'atmosphere' | 'element' | 'details' | 'accents' | 'reference_transfer';
export const PASS_KINDS: readonly PassKind[] = ['underpainting', 'block_in', 'finish', 'refine', 'blend', 'glaze', 'atmosphere', 'element', 'details', 'accents', 'reference_transfer'];
/** Model ids, verbatim everywhere (global constraints); pigment is accepted ahead of its card and mixes rgb until it has one. */
export type PolicyModel = MixModel | 'pigment';
export const POLICY_MODELS: readonly PolicyModel[] = ['rgb', 'linear', 'perceptual', 'spectral', 'pigment'];
export type MixingPolicy = { version: 1; kinds: Partial<Record<PassKind, PolicyModel>>; default: PolicyModel };

/** What the companion uses when the file is invalid: rgb for every kind, the upstream behaviour. */
export const RGB_POLICY: Readonly<MixingPolicy> = Object.freeze({ version: 1, kinds: Object.freeze(Object.fromEntries(PASS_KINDS.map(k => [k, 'rgb']))), default: 'rgb' });

const isKind = (name: unknown): name is PassKind => typeof name === 'string' && (PASS_KINDS as readonly string[]).includes(name);
const isModel = (name: unknown): name is PolicyModel => typeof name === 'string' && (POLICY_MODELS as readonly string[]).includes(name);
const bundled = () => readFileSync(new URL('./mixing-policy.yaml', import.meta.url), 'utf8');

/** The policy in `text` (the bundled file when omitted), validated: version 1, known kinds, known model ids, a default.
 * Throws an Error naming the field ("Mixing policy: kinds.glazing is not a pass kind ..."). */
export function loadMixingPolicy(text?: string): MixingPolicy {
  let data: unknown;
  try {
    data = parse(text ?? bundled(), { maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`Mixing policy: not valid YAML (${(error as Error).message.split('\n')[0]})`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Mixing policy: the file must be a mapping with version, kinds and default');
  const root = data as Record<string, unknown>;
  for (const key of Object.keys(root)) if (!['version', 'kinds', 'default'].includes(key)) throw new Error(`Mixing policy: ${key} is not a policy field (version, kinds, default)`);
  if (root.version !== 1) throw new Error(`Mixing policy: version must be 1 (found ${root.version === undefined ? 'none' : JSON.stringify(root.version)})`);
  const kinds = root.kinds;
  if (kinds === null || typeof kinds !== 'object' || Array.isArray(kinds)) throw new Error('Mixing policy: kinds must be a mapping of pass kind to model');
  const out: Partial<Record<PassKind, PolicyModel>> = {};
  for (const [kind, model] of Object.entries(kinds as Record<string, unknown>)) {
    if (!isKind(kind)) throw new Error(`Mixing policy: kinds.${kind} is not a pass kind (known: ${PASS_KINDS.join(', ')})`);
    if (!isModel(model)) throw new Error(`Mixing policy: kinds.${kind} has unknown model ${JSON.stringify(model)} (known: ${POLICY_MODELS.join(', ')})`);
    out[kind] = model;
  }
  if (!isModel(root.default)) throw new Error(`Mixing policy: default must be one of ${POLICY_MODELS.join(', ')} (found ${JSON.stringify(root.default ?? null)})`);
  return { version: 1, kinds: out, default: root.default };
}

/** The policy, or RGB_POLICY with the error when the text (the bundled file when omitted) is missing or invalid. Never throws. */
export function mixingPolicyOrRgb(text?: string): { policy: MixingPolicy; error: string | null } {
  try {
    return { policy: loadMixingPolicy(text), error: null };
  } catch (error) {
    return { policy: RGB_POLICY, error: (error as Error).message };
  }
}

/** The bundled policy, read once when the companion starts; SHIPPED_POLICY_ERROR says why it is RGB_POLICY, else null. */
const shipped = mixingPolicyOrRgb();
export const SHIPPED_POLICY: MixingPolicy = shipped.policy;
export const SHIPPED_POLICY_ERROR: string | null = shipped.error;

/** The model a pass of this kind mixes with: the policy's model for the kind (the default for an absent or unknown kind)
 * when the preset has a measured card for it, else rgb. */
export function policyModel(policy: MixingPolicy, kind: PassKind | undefined, preset: string, catalog: MixingCatalog): MixModel {
  const sent = passMixing({ preset, ...(kind ? { kind } : {}) }, catalog, policy);   // no explicit mixing: never an error
  return 'mixing_model' in sent && sent.mixing_model ? sent.mixing_model : 'rgb';
}

const TOOL_KINDS: Readonly<Record<string, PassKind>> = Object.freeze({
  paint_from_reference: 'reference_transfer', continue_reference_painting: 'reference_transfer', paint_reference_surface: 'blend',
  paint_reference_edges: 'details', paint_finish: 'finish', refine_to_goal: 'refine', paint_accents: 'accents',
});
const STEP_KINDS: Readonly<Record<string, PassKind>> = Object.freeze({
  underpainting: 'underpainting', finish: 'finish', refine: 'refine', refine_part: 'refine', accents: 'accents', element: 'element', addition: 'element',
});
const JOB_KINDS: readonly [RegExp, PassKind][] = [
  [/^blending existing paint/i, 'blend'], [/^translucent glazes/i, 'glaze'], [/^soft light, glow and atmosphere/i, 'atmosphere'],
  [/^small details/i, 'details'], [/^crisp edges/i, 'details'],
];

/** The kind of a reference transfer job by its recipe mode (reference-tool.mjs): surface blends, edges are details, the dab
 * transfer is reference_transfer (its own kind, so underpainting and block_in stay rgb while the transfer may mix). */
export function referencePassKind(mode: unknown): PassKind {
  return mode === 'surface' ? 'blend' : mode === 'edges' ? 'details' : 'reference_transfer';
}

/** The pass kind from what the host knows: the tool, the plan step's kind (project-folder.ts FolderStepKind), the preset's
 * job in the catalog. The table at the top of this file. */
export function derivePassKind({ tool, step, preset }: { tool?: string; step?: string | null; preset?: string }, catalog: { jobs?: Record<string, readonly string[]> }): PassKind {
  if (tool && Object.hasOwn(TOOL_KINDS, tool)) return TOOL_KINDS[tool]!;
  if (step && Object.hasOwn(STEP_KINDS, step)) return STEP_KINDS[step]!;
  const job = preset ? Object.entries(catalog.jobs ?? {}).find(([, presets]) => presets.includes(preset))?.[0] : undefined;
  return (job && JOB_KINDS.find(([pattern]) => pattern.test(job))?.[1]) || 'block_in';
}
