// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The transfer's own paint set (colour-mixing task 7d, proposal "Level 2 — its own pigment palette"). A reference transfer
// can paint from a few tube paints: every reference colour is replaced by the closest Mixbox mix of at most three paints
// of the set, within a strictness limit measured in CIEDE2000 (ΔE00) from the reference's own colours, never judged by eye.
//   - recipeFor: the best mix of 1, 2 or 3 paints, by Mixbox's latent mix (mixbox.ts), minimising ΔE00 (delta-e.ts): a
//     weight grid in steps of 1/GRID, then a pattern search on the weights. Which paints is memoised per target quantised
//     to 5 bits a channel: every subset of at most three paints is searched on the grid at the bucket's centre and the
//     CANDIDATES best subsets are kept. How much of each is then found for the exact 8-bit colour (memoised by it): those
//     subsets on the grid, the REFINED best of them refined. Keeping only the centre's single best subset left 40% of
//     the Monet benchmark's pixels out of the exact limit, against 13% with the candidates (task 7d report).
//   - Speed: no triple is pruned. The grid mixes are target-independent (built once per subset, in CIELAB), a subset is
//     dropped as soon as its grid cannot beat the CANDIDATES-th best so far, and a mix is skipped when ΔE00's lightness
//     term alone (|ΔL| / S_L, a lower bound) rules it out. Pruning triples to the best pair's paints, as the brief
//     allowed, was measured no faster after that and missed mixes such as Burnt Sienna + Ultramarine + White.
//   - choosePaintSet: White always; greedily adds the library paint that most lowers the weighted share of the reference's
//     colours above the limit (ties: lower weighted mean ΔE00), to 8 paints, then on while any colour is above the limit,
//     to at most 12.
//   - Strictness: exact ΔE00 <= 2 (default), close <= 5, loose <= 10. In exact and close a colour no mix reaches within
//     the limit is laid as the reference colour, unmixed, and counted; in loose it is laid as its nearest mix.
import { rgbToLatent, latentToRgb, pigmentMixMany } from './mixbox.ts';
import type { Latent } from './mixbox.ts';
import { hexToRgb, rgbToHex } from './mix.ts';
import type { Rgb } from './mix.ts';
import { srgbToLab, deltaE00Scalar, lightnessWeight } from './delta-e.ts';
import type { Lab } from './delta-e.ts';
import { PAINT_LIBRARY, PAINT_NAMES, TITANIUM_WHITE, paintByName } from './paints.ts';
import type { Paint } from './paints.ts';

export type Strictness = 'exact' | 'close' | 'loose';
export const STRICTNESSES: readonly Strictness[] = ['exact', 'close', 'loose'];
export const DEFAULT_STRICTNESS: Strictness = 'exact';
/** The largest ΔE00 allowed between a reference colour and the colour laid for it. */
export const STRICTNESS_LIMITS: Readonly<Record<Strictness, number>> = Object.freeze({ exact: 2, close: 5, loose: 10 });
/** The weight grid's step is 1/GRID. */
export const GRID = 16;
/** A chosen set starts at SET_MIN paints and grows to SET_MAX while a colour is out of reach. */
export const SET_MIN = 8, SET_MAX = 12;
/** The reference is quantised to at most this many weighted colours for choosing. */
export const QUANTISED_COLOURS = 256;
/** Subsets kept per 5-bit bucket, and how many of them (best on the grid first) are refined for each exact colour. */
export const CANDIDATES = 6, REFINED = 2;

export type Recipe = { paints: string[]; weights: number[]; rgb: Rgb; deltaE: number };
export type WeightedColour = { rgb: Rgb; weight: number };
/** What a dab is laid in: its recipe colour, or (unmixed) its reference colour where no mix is within the limit. */
export type Laid = { color: string; deltaE: number; unmixed: boolean; recipe: Recipe | null; nearest: number };

// --- the reference's colours ----------------------------------------------------------------------------------------------

/** Colours with weights in 32,768 buckets (5 bits a channel), each keeping its weighted mean, quantised by median cut. */
export class ColourHistogram {
  private weight = new Float64Array(32768);
  private sums = new Float64Array(32768 * 3);

  /** One colour, components 0-255. */
  add(r: number, g: number, b: number, weight = 1): void {
    if (!(weight > 0)) return;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    this.weight[k] = this.weight[k]! + weight;
    this.sums[k * 3] = this.sums[k * 3]! + r * weight;
    this.sums[k * 3 + 1] = this.sums[k * 3 + 1]! + g * weight;
    this.sums[k * 3 + 2] = this.sums[k * 3 + 2]! + b * weight;
  }

  /** At most `max` colours (components 0-1) with their weights, by median cut over the buckets; deterministic. */
  quantise(max = QUANTISED_COLOURS): WeightedColour[] {
    type Entry = { c: [number, number, number]; w: number };
    const entries: Entry[] = [];
    for (let k = 0; k < 32768; k++) {
      const w = this.weight[k]!;
      if (w > 0) entries.push({ c: [this.sums[k * 3]! / w, this.sums[k * 3 + 1]! / w, this.sums[k * 3 + 2]! / w], w });
    }
    let boxes: Entry[][] = entries.length ? [entries] : [];
    const range = (box: Entry[], ch: number) => { let lo = Infinity, hi = -Infinity; for (const e of box) { lo = Math.min(lo, e.c[ch]!); hi = Math.max(hi, e.c[ch]!); } return hi - lo; };
    while (boxes.length < max) {
      let pick = -1, score = 0, channel = 0;
      boxes.forEach((box, i) => {
        if (box.length < 2) return;
        const ranges = [0, 1, 2].map(ch => range(box, ch)), widest = ranges.indexOf(Math.max(...ranges));
        const s = box.reduce((n, e) => n + e.w, 0) * ranges[widest]!;
        if (s > score) { score = s; pick = i; channel = widest; }
      });
      if (pick < 0) break;
      const box = [...boxes[pick]!].sort((a, b) => a.c[channel]! - b.c[channel]!);
      const half = box.reduce((n, e) => n + e.w, 0) / 2;
      let at = 0, run = 0;
      while (at < box.length - 1 && run + box[at]!.w < half) run += box[at++]!.w;
      const cut = Math.max(1, Math.min(box.length - 1, at + 1));
      boxes = [...boxes.slice(0, pick), box.slice(0, cut), box.slice(cut), ...boxes.slice(pick + 1)];
    }
    return boxes.map(box => {
      const w = box.reduce((n, e) => n + e.w, 0);
      const c = [0, 1, 2].map(ch => box.reduce((n, e) => n + e.c[ch]! * e.w, 0) / w / 255) as Rgb;
      return { rgb: c, weight: w };
    });
  }
}

// --- mixing and the search -------------------------------------------------------------------------------------------------

/** The weight vectors of the grid for n paints: every paint at least 1/GRID, summing to 1. */
function gridWeights(n: number): number[][] {
  if (n === 1) return [[1]];
  if (n === 2) return Array.from({ length: GRID - 1 }, (_, k) => [(GRID - 1 - k) / GRID, (k + 1) / GRID]);
  const out: number[][] = [];
  for (let i = 1; i < GRID - 1; i++) for (let j = 1; i + j < GRID; j++) out.push([i / GRID, j / GRID, (GRID - i - j) / GRID]);
  return out;
}
const GRIDS = [gridWeights(1), gridWeights(2), gridWeights(3)];

function mixLatents(latents: readonly Latent[], idx: readonly number[], w: readonly number[]): Rgb {
  const l: Latent = { c: [0, 0, 0, 0], residual: [0, 0, 0] };
  for (let n = 0; n < idx.length; n++) {
    const p = latents[idx[n]!]!, k = w[n]!;
    for (let i = 0; i < 4; i++) l.c[i] = l.c[i]! + k * p.c[i]!;
    for (let i = 0; i < 3; i++) l.residual[i] = l.residual[i]! + k * p.residual[i]!;
  }
  return latentToRgb(l);
}

/** A subset of a paint list's indices with its grid mixes in CIELAB (target-independent, built once). */
type Subset = { idx: number[]; weights: number[][]; lab: Float64Array };

class Palette {
  readonly latents: Latent[];
  private subsetCache = new Map<string, Subset>();
  readonly buckets = new Map<number, number[][]>();
  readonly exact = new Map<string, Recipe>();
  readonly paints: readonly Paint[];
  readonly paintLabs: Lab[];
  constructor(paints: readonly Paint[]) { this.paints = paints; this.latents = paints.map(p => rgbToLatent(p.rgb)); this.paintLabs = paints.map(p => srgbToLab(p.rgb)); }

  subset(idx: number[]): Subset {
    const key = idx.join(',');
    let s = this.subsetCache.get(key);
    if (!s) {
      const weights = GRIDS[idx.length - 1]!, lab = new Float64Array(weights.length * 3);
      weights.forEach((w, g) => { const L = srgbToLab(mixLatents(this.latents, idx, w)); lab[g * 3] = L[0]; lab[g * 3 + 1] = L[1]; lab[g * 3 + 2] = L[2]; });
      s = { idx, weights, lab };
      this.subsetCache.set(key, s);
    }
    return s;
  }

  /** ΔE00 of the mix of idx at weights w to the target. */
  distance(t: Lab, idx: readonly number[], w: readonly number[]): number {
    const L = srgbToLab(mixLatents(this.latents, idx, w));
    return deltaE00Scalar(t[0], t[1], t[2], L[0], L[1], L[2]);
  }

  /** The best grid point of the subsets given, overall; only mixes closer than `ceiling` count (d stays `ceiling` when none is). */
  bestOnGrid(t: Lab, subsets: Iterable<number[]>, ceiling = Infinity): { idx: number[]; weights: number[]; d: number } {
    let best = { idx: [] as number[], weights: [] as number[], d: ceiling };
    for (const idx of subsets) {
      const s = this.subset(idx);
      for (let g = 0; g < s.weights.length; g++) {
        const L = s.lab[g * 3]!, dL = L - t[0];
        if ((dL < 0 ? -dL : dL) >= best.d * lightnessWeight((L + t[0]) / 2)) continue;   // the bound rules it out
        const d = deltaE00Scalar(t[0], t[1], t[2], L, s.lab[g * 3 + 1]!, s.lab[g * 3 + 2]!);
        if (d < best.d) best = { idx, weights: s.weights[g]!, d };
      }
    }
    return best;
  }

  /** Pattern search on the weights (moving weight between two paints, steps 1/32 down to 1/1024); a paint whose weight
   * reaches 0 is dropped. */
  refine(t: Lab, idx: number[], weights: number[]): { idx: number[]; weights: number[]; d: number } {
    let w = [...weights], d = this.distance(t, idx, w);
    if (idx.length > 1) {
      for (let step = 1 / 32; step >= 1 / 1024; step /= 2) {
        for (let rounds = 0; rounds < 64; rounds++) {
          let improved = false;
          for (let i = 0; i < idx.length; i++) for (let j = 0; j < idx.length; j++) {
            if (i === j || !(w[j]! > 0)) continue;
            const move = Math.min(step, w[j]!), next = [...w];
            next[i] = next[i]! + move; next[j] = next[j]! - move;
            const nd = this.distance(t, idx, next);
            if (nd < d - 1e-12) { w = next; d = nd; improved = true; }
          }
          if (!improved) break;
        }
      }
    }
    const keep = idx.map((_, n) => n).filter(n => w[n]! > 1e-12);
    const sum = keep.reduce((s, n) => s + w[n]!, 0);
    return { idx: keep.map(n => idx[n]!), weights: keep.map(n => w[n]! / sum), d };
  }

  /** The CANDIDATES subsets (of 1, 2 or 3 paints, every one considered) whose best grid mix is closest to t. */
  candidates(t: Lab): number[][] {
    const n = this.paints.length, top: { idx: number[]; d: number }[] = [];
    // The CANDIDATES best so far; a subset whose grid cannot beat the last of them is not scored in full.
    const consider = (idx: number[]) => {
      const ceiling = top.length < CANDIDATES ? Infinity : top[top.length - 1]!.d, d = this.bestOnGrid(t, [idx], ceiling).d;
      if (d >= ceiling) return;
      let at = top.findIndex(s => d < s.d);
      if (at < 0) at = top.length;
      top.splice(at, 0, { idx, d });
      if (top.length > CANDIDATES) top.pop();
    };
    for (let i = 0; i < n; i++) consider([i]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) consider([i, j]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) consider([i, j, k]);
    return top.map(s => s.idx);
  }

  /** The best of the candidate subsets for t: each on the grid, the REFINED best of those refined. */
  best(t: Lab, subsets: number[][]): { idx: number[]; weights: number[]; d: number } {
    const onGrid = subsets.map(idx => this.bestOnGrid(t, [idx])).sort((a, b) => a.d - b.d);
    let best = { idx: [] as number[], weights: [] as number[], d: Infinity };
    for (const g of onGrid.slice(0, REFINED)) { const r = this.refine(t, g.idx, g.weights); if (r.d < best.d) best = r; }
    return best;
  }

  recipe(target: Rgb): Recipe {
    const r8 = Math.round(target[0] * 255), g8 = Math.round(target[1] * 255), b8 = Math.round(target[2] * 255);
    const hex = rgbToHex([r8 / 255, g8 / 255, b8 / 255]), known = this.exact.get(hex);
    if (known) return known;
    // Which paints: memoised per 5-bit bucket, searched at its centre.
    const key = ((r8 >> 3) << 10) | ((g8 >> 3) << 5) | (b8 >> 3);
    let subsets = this.buckets.get(key);
    if (!subsets) {
      const centre: Rgb = [((r8 >> 3) * 8 + 4) / 255, ((g8 >> 3) * 8 + 4) / 255, ((b8 >> 3) * 8 + 4) / 255];
      subsets = this.candidates(srgbToLab(centre));
      this.buckets.set(key, subsets);
    }
    // How much of each: the bucket's candidate subsets, for this exact colour.
    const t = srgbToLab([r8 / 255, g8 / 255, b8 / 255]);
    let best = this.best(t, subsets);
    // A paint straight from the tube is laid as itself (not through Mixbox's latent round trip): each candidate paint alone.
    for (const i of new Set(subsets.flat())) {
      const P = this.paintLabs[i]!, d = deltaE00Scalar(t[0], t[1], t[2], P[0], P[1], P[2]);
      if (d <= best.d) best = { idx: [i], weights: [1], d };
    }
    const rgbs = best.idx.map(i => this.paints[i]!.rgb);
    const rgb: Rgb = best.idx.length === 1 ? [...rgbs[0]!] as Rgb : pigmentMixMany(rgbs, best.weights);
    const L = srgbToLab(rgb);
    const recipe: Recipe = { paints: best.idx.map(i => this.paints[i]!.name), weights: best.weights, rgb, deltaE: deltaE00Scalar(t[0], t[1], t[2], L[0], L[1], L[2]) };
    this.exact.set(hex, recipe);
    return recipe;
  }
}

const palettes = new Map<string, Palette>();
function palette(names: readonly string[]): Palette {
  const key = names.join('|');
  let p = palettes.get(key);
  if (!p) {
    const unknown = names.filter(n => !paintByName(n));
    if (unknown.length) throw new Error(`Unknown paint${unknown.length > 1 ? 's' : ''} ${unknown.map(n => `"${n}"`).join(', ')}. The paints are: ${PAINT_NAMES.join(', ')}.`);
    if (!names.length) throw new Error('A paint set needs at least one paint.');
    if (new Set(names).size !== names.length) throw new Error('A paint set names each paint once.');
    p = new Palette(names.map(n => paintByName(n)!));
    palettes.set(key, p);
  }
  return p;
}

/** Checks a list of paint names against the library; throws naming the unknown ones. */
export function checkPaints(names: readonly string[]): void { palette(names); }

/** The best mix of 1, 2 or 3 of the named paints for the target (components 0-1, read in 8 bits). */
export function recipeFor(target: Rgb, paints: readonly string[]): Recipe {
  return palette(paints).recipe(target);
}

/** A memoised function from a dab's reference colour ("#rrggbb") to the colour it is laid in, under the strictness. */
export function paintSetLayer(paints: readonly string[], strictness: Strictness = DEFAULT_STRICTNESS): (hex: string) => Laid {
  const p = palette(paints), limit = STRICTNESS_LIMITS[strictness], known = new Map<string, Laid>();
  return hex => {
    let laid = known.get(hex);
    if (!laid) {
      const target = hexToRgb(hex);
      if (!target) laid = { color: hex, deltaE: 0, unmixed: true, recipe: null, nearest: 0 };
      else {
        const recipe = p.recipe(target), color = rgbToHex(recipe.rgb), sent = hexToRgb(color)!;
        const t = srgbToLab(target), L = srgbToLab(sent), d = deltaE00Scalar(t[0], t[1], t[2], L[0], L[1], L[2]);
        laid = d > limit && strictness !== 'loose'
          ? { color: hex, deltaE: 0, unmixed: true, recipe: null, nearest: d }
          : { color, deltaE: d, unmixed: false, recipe, nearest: d };
      }
      known.set(hex, laid);
    }
    return laid;
  };
}

// --- choosing the set ------------------------------------------------------------------------------------------------------

export type ChosenSet = { paints: string[]; strictness: Strictness; limit: number; within_share: number; mean_delta_e: number };

/** The paint set for these weighted colours: White, then greedy additions (see the header), in library order. */
export function choosePaintSet(colours: readonly WeightedColour[], strictness: Strictness = DEFAULT_STRICTNESS): ChosenSet {
  const limit = STRICTNESS_LIMITS[strictness], lib = palette(PAINT_NAMES), n = lib.paints.length;
  const total = colours.reduce((s, c) => s + c.weight, 0) || 1;
  // Every subset of at most three library paints, and each colour's best grid ΔE00 with it.
  const subsets: number[][] = [];
  for (let i = 0; i < n; i++) { subsets.push([i]); for (let j = i + 1; j < n; j++) { subsets.push([i, j]); for (let k = j + 1; k < n; k++) subsets.push([i, j, k]); } }
  const labs = colours.map(c => srgbToLab(c.rgb));
  const table = labs.map(t => Float64Array.from(subsets, idx => lib.bestOnGrid(t, [idx]).d));
  const masks = subsets.map(idx => idx.reduce((m, i) => m | (1 << i), 0));
  const white = PAINT_NAMES.indexOf(TITANIUM_WHITE);
  let chosen = 1 << white;
  const bestWith = (mask: number) => table.map(row => { let d = Infinity; for (let s = 0; s < masks.length; s++) if ((masks[s]! & ~mask) === 0 && row[s]! < d) d = row[s]!; return d; });
  const score = (best: number[]) => {
    let over = 0, mean = 0;
    best.forEach((d, c) => { const w = colours[c]!.weight; if (d > limit) over += w; mean += w * d; });
    return { over: over / total, mean: mean / total };
  };
  let current = score(bestWith(chosen));
  const size = () => { let k = 0; for (let i = 0; i < n; i++) if (chosen & (1 << i)) k++; return k; };
  while (size() < Math.min(SET_MAX, n) && (size() < SET_MIN || current.over > 0)) {
    let pick = -1, pickScore = { over: Infinity, mean: Infinity };
    for (let i = 0; i < n; i++) {
      if (chosen & (1 << i)) continue;
      const s = score(bestWith(chosen | (1 << i)));
      if (s.over < pickScore.over - 1e-12 || (Math.abs(s.over - pickScore.over) <= 1e-12 && s.mean < pickScore.mean)) { pick = i; pickScore = s; }
    }
    if (pick < 0) break;
    chosen |= 1 << pick; current = pickScore;
  }
  return { paints: PAINT_NAMES.filter((_, i) => chosen & (1 << i)), strictness, limit,
    within_share: round(1 - current.over, 4), mean_delta_e: round(current.mean, 2) };
}

// --- a plan in a paint set -------------------------------------------------------------------------------------------------

export type PaintSetReport = {
  paints: string[]; strictness: Strictness; limit: number; dabs: number;
  /** Share of dabs whose laid colour is within each ΔE00 band of its reference colour (an unmixed dab is at 0). */
  bands: { at_most_1: number; at_most_2: number; at_most_5: number; at_most_10: number; over_10: number };
  largest_delta_e: number; unmixed: number; changed_share: number;
};

const round = (v: number, places: number) => { const k = 10 ** places; return Math.round(v * k) / k; };

/** Counts laid colours into a report. */
export class PaintSetTally {
  private counts = [0, 0, 0, 0, 0];
  private dabs = 0; private unmixed = 0; private changed = 0; private largest = 0;
  private paints: readonly string[]; private strictness: Strictness;
  constructor(paints: readonly string[], strictness: Strictness) { this.paints = paints; this.strictness = strictness; }
  add(reference: string, laid: Laid, weight = 1): void {
    this.dabs += weight;
    if (laid.unmixed) this.unmixed += weight;
    if (laid.color !== reference) this.changed += weight;
    const d = laid.deltaE;
    this.largest = Math.max(this.largest, d);
    this.counts[d <= 1 ? 0 : d <= 2 ? 1 : d <= 5 ? 2 : d <= 10 ? 3 : 4] += weight;
  }
  report(): PaintSetReport {
    const share = (k: number) => (this.dabs ? round(this.counts[k]! / this.dabs, 4) : 0);
    return { paints: [...this.paints], strictness: this.strictness, limit: STRICTNESS_LIMITS[this.strictness], dabs: this.dabs,
      bands: { at_most_1: share(0), at_most_2: share(1), at_most_5: share(2), at_most_10: share(3), over_10: share(4) },
      largest_delta_e: round(this.largest, 2), unmixed: this.unmixed, changed_share: this.dabs ? round(this.changed / this.dabs, 4) : 0 };
  }
}

type Stroke = { color?: unknown; [key: string]: unknown };
type Plan = { passes: { strokes: Stroke[]; [key: string]: unknown }[]; [key: string]: unknown };

/** The colours a plan's dabs carry, quantised for choosing (each dab counts once). */
export function planColours(plan: Plan): WeightedColour[] {
  const h = new ColourHistogram();
  for (const pass of plan.passes) for (const s of pass.strokes) {
    const rgb = typeof s.color === 'string' ? hexToRgb(s.color) : null;
    if (rgb) h.add(Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255));
  }
  return h.quantise();
}

/** The plan with every dab's colour laid from the paint set, and the report. Deterministic: a rebuilt plan hashes the same. */
export function paintPlan<P extends Plan>(plan: P, paints: readonly string[], strictness: Strictness = DEFAULT_STRICTNESS): { plan: P; report: PaintSetReport } {
  const layer = paintSetLayer(paints, strictness), tally = new PaintSetTally(paints, strictness);
  const passes = plan.passes.map(pass => ({ ...pass, strokes: pass.strokes.map(s => {
    if (typeof s.color !== 'string') return s;
    const laid = layer(s.color);
    tally.add(s.color, laid);
    return laid.color === s.color ? s : { ...s, color: laid.color };
  }) }));
  return { plan: { ...plan, passes }, report: tally.report() };
}
