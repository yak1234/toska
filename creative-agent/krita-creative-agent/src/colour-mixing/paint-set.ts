// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The transfer's own paint set (colour-mixing task 7d, proposal "Level 2 — its own pigment palette"). A reference transfer
// can paint from a few tube paints: every reference colour is replaced by the closest Mixbox mix of at most three paints
// of the set, within a strictness limit measured in CIEDE2000 (ΔE00) from the reference's own colours, never judged by eye.
//   - recipeFor: the best mix of 1, 2 or 3 paints, by Mixbox's latent mix (mixbox.ts), minimising ΔE00 (delta-e.ts),
//     searched for each exact 8-bit colour (memoised by it), so a recipe depends only on the colour and the paint names.
//     Every subset of at most three paints is scored on a weight grid in steps of 1/GRID; the subsets within MARGIN of
//     the best grid mix are candidates, and the REFINED best of them get a pattern search on the weights; each paint
//     alone is tried at its own tube colour. (Searching per 5-bit bucket instead, at its centre, was worse for 0.6% of
//     colours, up to ΔE00 1.4; MARGIN 1 left 0.27 points more of p1 unmixed than an unlimited margin, MARGIN 2 0.01.)
//   - Speed, without changing the result (tests/paint-set.test.ts holds the pruned search to the unpruned one): the grid
//     mixes are target-independent, built once per subset in CIELAB and sorted by lightness; a subset is read only in
//     the lightness window that can still come within MARGIN of the best so far; a mix is skipped when ΔE00's lower bound
//     (deltaE00LowerBound) rules it out; the best subsets at the centre of the colour's 5-bit bucket (memoised) are
//     scored first so that bound is tight from the start.
//   - choosePaintSet: White always; greedily adds the library paint that most lowers the weighted share of the reference's
//     colours above the limit (ties: lower weighted mean ΔE00; ranked on a grid table of every library subset), to 8
//     paints, then on while any colour is above the limit by recipeFor (the recipe its dabs are laid with), to at most 12.
//   - Strictness: exact ΔE00 <= 2 (default), close <= 5, loose <= 10. In exact and close a colour no mix reaches within
//     the limit is laid as the reference colour, unmixed, and counted; in loose it is laid as its nearest mix.
import { rgbToLatent, latentToRgb, pigmentMixMany } from './mixbox.ts';
import type { Latent } from './mixbox.ts';
import { hexToRgb, rgbToHex } from './mix.ts';
import type { Rgb } from './mix.ts';
import { srgbToLab, deltaE00Scalar, lightnessWeight, CHROMA_HUE_SHARE } from './delta-e.ts';
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
/** Subsets whose best grid mix is within MARGIN (ΔE00) of the best are candidates, at most CANDIDATES of them; the
 * REFINED best of those are refined. */
export const MARGIN = 2, CANDIDATES = 6, REFINED = 2;

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

/** S_L's largest value (at L = 0 or 100). */
const SL_MAX = lightnessWeight(0);

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
type Subset = { idx: number[]; weights: number[][]; lab: Float64Array; chroma: Float64Array };

class Palette {
  readonly latents: Latent[];
  private subsetCache = new Map<string, Subset>();
  readonly buckets = new Map<number, number[][]>();
  readonly exact = new Map<string, Recipe>();
  readonly unpruned = new Map<string, Recipe>();
  readonly paints: readonly Paint[];
  readonly paintLabs: Lab[];
  constructor(paints: readonly Paint[]) { this.paints = paints; this.latents = paints.map(p => rgbToLatent(p.rgb)); this.paintLabs = paints.map(p => srgbToLab(p.rgb)); }

  subset(idx: number[]): Subset {
    const key = idx.join(',');
    let s = this.subsetCache.get(key);
    if (!s) {
      // Sorted by lightness, so bestOnGrid reads only the window its lower bound leaves.
      const mixes = GRIDS[idx.length - 1]!.map(w => ({ w, L: srgbToLab(mixLatents(this.latents, idx, w)) })).sort((a, b) => a.L[0] - b.L[0]);
      const weights = mixes.map(m => m.w), lab = new Float64Array(weights.length * 3);
      mixes.forEach((m, g) => { lab[g * 3] = m.L[0]; lab[g * 3 + 1] = m.L[1]; lab[g * 3 + 2] = m.L[2]; });
      const chroma = Float64Array.from(mixes, m => Math.sqrt(m.L[1] * m.L[1] + m.L[2] * m.L[2]));
      s = { idx, weights, lab, chroma };
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
  bestOnGrid(t: Lab, subsets: Iterable<number[]>, ceiling = Infinity, prune = true): { idx: number[]; weights: number[]; d: number } {
    let best = { idx: [] as number[], weights: [] as number[], d: ceiling };
    for (const idx of subsets) {
      const s = this.subset(idx), n = s.weights.length, tC = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
      // ΔE00 >= |ΔL| / S_L >= |ΔL| / SL_MAX: only mixes with L within best.d * SL_MAX of the target's can win.
      let g = 0;
      if (prune && best.d < Infinity) { let lo = 0, hi = n; const from = t[0] - best.d * SL_MAX; while (lo < hi) { const mid = (lo + hi) >> 1; if (s.lab[mid * 3]! < from) lo = mid + 1; else hi = mid; } g = lo; }
      for (; g < n; g++) {
        const L = s.lab[g * 3]!, dL = L - t[0];
        const a = s.lab[g * 3 + 1]!, b = s.lab[g * 3 + 2]!;
        if (prune) {
          if (dL > best.d * SL_MAX) break;
          // deltaE00LowerBound (delta-e.ts): never above ΔE00, so a mix it puts at or past the best cannot win.
          const l = dL / lightnessWeight((L + t[0]) / 2), da = a - t[1], db = b - t[2], scale = 1 + 0.03375 * (tC + s.chroma[g]!);
          if (l * l + (CHROMA_HUE_SHARE * (da * da + db * db)) / (scale * scale) >= best.d * best.d) continue;
        }
        const d = deltaE00Scalar(t[0], t[1], t[2], L, a, b);
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

  /** The subsets (of 1, 2 or 3 paints, every one considered) whose best grid mix is within MARGIN of the best grid mix
   * for t, best first (ties by paint indices), at most CANDIDATES. With `prune` (the default) a subset is read only while
   * it can still come within MARGIN of the best so far, and the subsets in `seed` (likely winners) go first so that bound
   * is tight early; the result is the same as without, which tests/paint-set.test.ts checks. */
  candidates(t: Lab, seed: readonly number[][] = [], prune = true): number[][] {
    const n = this.paints.length, found: { idx: number[]; d: number; key: string }[] = [], done = new Set<string>();
    let bestD = Infinity;
    const consider = (idx: number[]) => {
      const key = idx.join(',');
      if (done.has(key)) return;
      done.add(key);
      const ceiling = prune ? bestD + MARGIN : Infinity, d = this.bestOnGrid(t, [idx], ceiling, prune).d;
      if (!(d < ceiling)) return;
      found.push({ idx, d, key });
      if (d < bestD) bestD = d;
    };
    for (const idx of seed) consider(idx);
    for (let i = 0; i < n; i++) consider([i]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) consider([i, j]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) consider([i, j, k]);
    return found.filter(f => f.d < bestD + MARGIN).sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, CANDIDATES).map(f => f.idx);
  }

  /** The best of the candidate subsets for t: each on the grid, the REFINED best of those refined. */
  best(t: Lab, subsets: number[][]): { idx: number[]; weights: number[]; d: number } {
    const onGrid = subsets.map(idx => this.bestOnGrid(t, [idx])).sort((a, b) => a.d - b.d);
    let best = { idx: [] as number[], weights: [] as number[], d: Infinity };
    for (const g of onGrid.slice(0, REFINED)) { const r = this.refine(t, g.idx, g.weights); if (r.d < best.d) best = r; }
    return best;
  }

  /** The recipe laid for an 8-bit colour. `prune: false` is the same search without any pruning (for the tests). */
  recipe(target: Rgb, prune = true): Recipe {
    const r8 = Math.round(target[0] * 255), g8 = Math.round(target[1] * 255), b8 = Math.round(target[2] * 255);
    const memo = prune ? this.exact : this.unpruned;
    const hex = rgbToHex([r8 / 255, g8 / 255, b8 / 255]), known = memo.get(hex);
    if (known) return known;
    const t = srgbToLab([r8 / 255, g8 / 255, b8 / 255]);
    // Which paints: every subset scored at this exact colour. The best subsets at the centre of its 5-bit bucket
    // (memoised) are only the seed that makes the pruning bound tight early; they do not change the result.
    let subsets: number[][];
    if (prune) {
      const key = ((r8 >> 3) << 10) | ((g8 >> 3) << 5) | (b8 >> 3);
      let seed = this.buckets.get(key);
      if (!seed) {
        const centre: Rgb = [((r8 >> 3) * 8 + 4) / 255, ((g8 >> 3) * 8 + 4) / 255, ((b8 >> 3) * 8 + 4) / 255];
        seed = this.candidates(srgbToLab(centre));
        this.buckets.set(key, seed);
      }
      subsets = this.candidates(t, seed);
    } else subsets = this.candidates(t, [], false);
    // How much of each: the candidate subsets, for this exact colour.
    let best = this.best(t, subsets);
    // A paint straight from the tube is laid as itself (not through Mixbox's latent round trip): each paint alone.
    for (let i = 0; i < this.paints.length; i++) {
      const P = this.paintLabs[i]!, d = deltaE00Scalar(t[0], t[1], t[2], P[0], P[1], P[2]);
      if (d <= best.d) best = { idx: [i], weights: [1], d };
    }
    const rgbs = best.idx.map(i => this.paints[i]!.rgb);
    const rgb: Rgb = best.idx.length === 1 ? [...rgbs[0]!] as Rgb : pigmentMixMany(rgbs, best.weights);
    const L = srgbToLab(rgb);
    const recipe: Recipe = { paints: best.idx.map(i => this.paints[i]!.name), weights: best.weights, rgb, deltaE: deltaE00Scalar(t[0], t[1], t[2], L[0], L[1], L[2]) };
    memo.set(hex, recipe);
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

/** recipeFor's search with no pruning at all: slow, the reference the tests hold recipeFor to. */
export function unprunedRecipeFor(target: Rgb, paints: readonly string[]): Recipe {
  return palette(paints).recipe(target, false);
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
  const size = () => { let k = 0; for (let i = 0; i < n; i++) if (chosen & (1 << i)) k++; return k; };
  const names = () => PAINT_NAMES.filter((_, i) => chosen & (1 << i));
  // Whether the set is enough is judged with the recipes the dabs are laid with (recipeFor, at each colour in 8 bits), not
  // the grid table the greedy choice ranks by: the share of the colours' weight farther than the limit, and the mean ΔE00.
  const laid = () => {
    let over = 0, mean = 0;
    for (const c of colours) {
      const d = recipeFor(c.rgb, names()).deltaE;
      if (d > limit) over += c.weight;
      mean += c.weight * d;
    }
    return { over: over / total, mean: mean / total };
  };
  let measured = { over: 1, mean: Infinity };   // measured once the set has SET_MIN paints
  while (size() < Math.min(SET_MAX, n) && (size() < SET_MIN || measured.over > 0)) {
    let pick = -1, pickScore = { over: Infinity, mean: Infinity };
    for (let i = 0; i < n; i++) {
      if (chosen & (1 << i)) continue;
      const s = score(bestWith(chosen | (1 << i)));
      if (s.over < pickScore.over - 1e-12 || (Math.abs(s.over - pickScore.over) <= 1e-12 && s.mean < pickScore.mean)) { pick = i; pickScore = s; }
    }
    if (pick < 0) break;
    chosen |= 1 << pick;
    if (size() >= SET_MIN) measured = laid();
  }
  if (size() < SET_MIN) measured = laid();
  return { paints: names(), strictness, limit, within_share: round(1 - measured.over, 4), mean_delta_e: round(measured.mean, 2) };
}

// --- a plan in a paint set -------------------------------------------------------------------------------------------------

export type PaintSetReport = {
  paints: string[]; strictness: Strictness; limit: number; dabs: number;
  /** Share of dabs whose laid colour is within each ΔE00 band of its reference colour (an unmixed dab is at 0). */
  bands: { at_most_1: number; at_most_2: number; at_most_5: number; at_most_10: number; over_10: number };
  largest_delta_e: number; unmixed: number; changed_share: number;
  /** The largest ΔE00 between an unmixed dab's reference colour and its nearest mix (0 when none is unmixed). */
  unmixed_nearest_delta_e_max: number;
};

const round = (v: number, places: number) => { const k = 10 ** places; return Math.round(v * k) / k; };

/** Counts laid colours into a report. */
export class PaintSetTally {
  private counts = [0, 0, 0, 0, 0];
  private dabs = 0; private unmixed = 0; private changed = 0; private largest = 0; private unmixedNearest = 0;
  private paints: readonly string[]; private strictness: Strictness;
  constructor(paints: readonly string[], strictness: Strictness) { this.paints = paints; this.strictness = strictness; }
  add(reference: string, laid: Laid, weight = 1): void {
    this.dabs += weight;
    if (laid.unmixed) { this.unmixed += weight; this.unmixedNearest = Math.max(this.unmixedNearest, laid.nearest); }
    if (laid.color !== reference) this.changed += weight;
    const d = laid.deltaE;
    this.largest = Math.max(this.largest, d);
    this.counts[d <= 1 ? 0 : d <= 2 ? 1 : d <= 5 ? 2 : d <= 10 ? 3 : 4] += weight;
  }
  report(): PaintSetReport {
    const share = (k: number) => (this.dabs ? round(this.counts[k]! / this.dabs, 4) : 0);
    return { paints: [...this.paints], strictness: this.strictness, limit: STRICTNESS_LIMITS[this.strictness], dabs: this.dabs,
      bands: { at_most_1: share(0), at_most_2: share(1), at_most_5: share(2), at_most_10: share(3), over_10: share(4) },
      largest_delta_e: round(this.largest, 2), unmixed: this.unmixed, changed_share: this.dabs ? round(this.changed / this.dabs, 4) : 0,
      unmixed_nearest_delta_e_max: round(this.unmixedNearest, 2) };
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
