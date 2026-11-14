// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Brushwork score (openspec painting-skills goal 5; a study score, never a run-time check). Two WikiArt baseline copies
// reached goal likeness dE 0.3 while their brushwork was the same small soft dabs everywhere: likeness is measured at a
// scale where brushwork does not count (goal-likeness.ts), and Luna's batch review asks whether a batch made the
// painting worse, not whether its marks are the original's. This measures the marks themselves, in a close-up crop of
// the same place in the original and on the canvas, with colour left out:
//
// - direction: which way the marks run (a histogram of gradient orientation) and how strongly they agree locally;
// - mark size: how the crop's contrast is spread over scales (fine grain, strokes, broad shapes), and how much there is;
// - edges: how much of the crop is edge, and how sharp the sharpest edges are.
// brushworkScore(original, canvas) is 0 to 100; a crop against itself is 100. The numbers that turn distances into a
// score are calibrated on the baseline images (see the calibration in openspec painting-skills tasks 4.2) and are for
// ranking results of the same crop, not an absolute grade. Pure functions; no file or studio access; no .mjs imports.

export type Rgba = { width: number; height: number; data: Uint8Array };
export type BrushworkMeasure = {
  /** Gradient orientation, DIRECTION_BINS bins over 180 degrees, weighted by gradient strength; sums to 1. */
  direction: number[];
  /** 0 to 1: how far neighbouring marks agree on a direction (hatching high, stipple and flat paint low). */
  coherence: number;
  /** The share of contrast at each scale, fine to broad (SCALES); sums to 1. */
  scales: number[];
  /** Total contrast over all scales (standard deviations of lightness, 0 to about 0.5). */
  contrast: number;
  /** The share of the crop that is edge. */
  edge_density: number;
  /** The mean strength of the strongest tenth of gradients. */
  sharpness: number;
};
export type BrushworkScore = { score: number; parts: { direction: number; coherence: number; scales: number; contrast: number; edges: number; sharpness: number };
  original: BrushworkMeasure; canvas: BrushworkMeasure };

/** Both crops are measured on a grid of this long side, so a mark has the same size in cells in each. */
export const MEASURE_SIDE = 384;
export const DIRECTION_BINS = 12;
/** Blur radii (cells) between which contrast is measured: bands 0-1, 1-2, 2-4, 4-8, 8-16. */
export const SCALES = [1, 2, 4, 8, 16];
/** A gradient this strong (Sobel on 0-1 lightness) counts as edge. */
const EDGE = 0.08;
/** How much each part of the distance counts; they sum to 1. Direction and mark size are what a style's hand is. */
export const WEIGHTS = { direction: 0.25, coherence: 0.15, scales: 0.25, contrast: 0.15, edges: 0.1, sharpness: 0.1 };

/** The crop as lightness on a grid of at most `side` cells (area-averaged), 0 to 1. */
function lightness(image: Rgba, side: number): { w: number; h: number; L: Float32Array } {
  const scale = Math.min(1, side / Math.max(image.width, image.height));
  const w = Math.max(8, Math.round(image.width * scale)), h = Math.max(8, Math.round(image.height * scale)), L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * image.width / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * image.width / w));
    const y0 = Math.floor(y * image.height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * image.height / h));
    let sum = 0, n = 0;
    for (let v = y0; v < y1 && v < image.height; v++) for (let u = x0; u < x1 && u < image.width; u++) {
      const i = (v * image.width + u) * 4; sum += image.data[i]! * 0.2126 + image.data[i + 1]! * 0.7152 + image.data[i + 2]! * 0.0722; n++;
    }
    L[y * w + x] = n ? sum / n / 255 : 0;
  }
  return { w, h, L };
}

function blur(values: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (source: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h), n = horizontal ? w : h, lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => source[horizontal ? line * w + Math.max(0, Math.min(n - 1, i)) : Math.max(0, Math.min(n - 1, i)) * w + line]!;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < n; i++) { out[horizontal ? line * w + i : i * w + line] = sum / (2 * r + 1); sum += at(i + r + 1) - at(i - r); }
    }
    return out;
  };
  let v = values;
  for (let i = 0; i < 2; i++) v = pass(pass(v, true), false);
  return v;
}
const deviation = (values: Float32Array): number => {
  let sum = 0, squares = 0;
  for (const v of values) { sum += v; squares += v * v; }
  const mean = sum / values.length;
  return Math.sqrt(Math.max(0, squares / values.length - mean * mean));
};

/** What the marks in a crop are like, colour left out. */
export function measureBrushwork(image: Rgba, side = MEASURE_SIDE): BrushworkMeasure {
  if (!(image.width >= 8 && image.height >= 8) || image.data.length < image.width * image.height * 4) throw new Error('A brushwork crop is an RGBA image of at least 8 x 8 pixels.');
  const { w, h, L } = lightness(image, side);
  const l = (x: number, y: number) => L[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]!;
  const direction = new Array<number>(DIRECTION_BINS).fill(0), M = new Float32Array(w * h);
  const XX = new Float32Array(w * h), XY = new Float32Array(w * h), YY = new Float32Array(w * h);
  let edges = 0, weight = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (l(x + 1, y - 1) + 2 * l(x + 1, y) + l(x + 1, y + 1) - l(x - 1, y - 1) - 2 * l(x - 1, y) - l(x - 1, y + 1)) / 4;
    const gy = (l(x - 1, y + 1) + 2 * l(x, y + 1) + l(x + 1, y + 1) - l(x - 1, y - 1) - 2 * l(x, y - 1) - l(x + 1, y - 1)) / 4;
    const k = y * w + x, m = Math.hypot(gx, gy);
    M[k] = m; XX[k] = gx * gx; XY[k] = gx * gy; YY[k] = gy * gy;
    if (m >= EDGE) edges++;
    if (m > 1e-4) {
      // The mark runs across its gradient; orientation is an axis, so it lives on 0 to 180 degrees.
      let a = Math.atan2(gy, gx) + Math.PI / 2; a = ((a % Math.PI) + Math.PI) % Math.PI;
      const at = a / Math.PI * DIRECTION_BINS, low = Math.floor(at) % DIRECTION_BINS, share = at - Math.floor(at);
      direction[low]! += m * (1 - share); direction[(low + 1) % DIRECTION_BINS]! += m * share; weight += m;
    }
  }
  // Local agreement: the structure tensor averaged over about three marks' width, weighted by how much is there.
  const r = Math.max(2, Math.round(Math.max(w, h) / 64));
  const A = blur(XX, w, h, r), B = blur(XY, w, h, r), C = blur(YY, w, h, r);
  let agree = 0, mass = 0;
  for (let k = 0; k < w * h; k++) { const sum = A[k]! + C[k]!; if (sum > 1e-8) { agree += Math.hypot(A[k]! - C[k]!, 2 * B[k]!); mass += sum; } }
  // Contrast by scale: the deviation of the difference between two blurs.
  const levels = [L, ...SCALES.map(radius => blur(L, w, h, radius))];
  const bands = SCALES.map((_, i) => { const d = new Float32Array(w * h); for (let k = 0; k < d.length; k++) d[k] = levels[i]![k]! - levels[i + 1]![k]!; return deviation(d); });
  const contrast = bands.reduce((a, b) => a + b, 0);
  const strongest = Float32Array.from(M).sort().subarray(Math.floor(M.length * 0.9));
  return {
    direction: direction.map(v => weight ? v / weight : 1 / DIRECTION_BINS), coherence: mass ? agree / mass : 0,
    scales: bands.map(v => contrast > 1e-6 ? v / contrast : 1 / SCALES.length), contrast,
    edge_density: edges / (w * h), sharpness: strongest.reduce((a, b) => a + b, 0) / Math.max(1, strongest.length),
  };
}

const overlap = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.min(v, b[i] ?? 0), 0);
/** How alike two amounts are, 1 when equal, falling with their ratio (a quarter or four times: about 0). */
const alike = (a: number, b: number, floor: number) => Math.max(0, 1 - Math.abs(Math.log2((a + floor) / (b + floor))) / 2);

/** How close the canvas crop's brushwork is to the original crop's, 0 to 100, with each part's closeness (0 to 1). */
export function compareBrushwork(original: BrushworkMeasure, canvas: BrushworkMeasure): BrushworkScore {
  // A direction histogram means little where marks do not agree: flat paint against flat paint is alike whatever the
  // noise says, so the direction part is trusted as far as either crop has direction at all.
  const directed = Math.max(original.coherence, canvas.coherence);
  const parts = {
    direction: directed * overlap(original.direction, canvas.direction) + (1 - directed),
    coherence: Math.max(0, 1 - Math.abs(original.coherence - canvas.coherence) / 0.5),
    scales: overlap(original.scales, canvas.scales),
    contrast: alike(original.contrast, canvas.contrast, 0.005),
    edges: alike(original.edge_density, canvas.edge_density, 0.01),
    sharpness: alike(original.sharpness, canvas.sharpness, 0.01),
  };
  const score = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((sum, key) => sum + WEIGHTS[key] * parts[key], 0);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { score: Math.round(score * 1000) / 10, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])) as BrushworkScore['parts'], original, canvas };
}

/** The score for one place: the original's crop and the canvas's crop of the same place. */
export function brushworkScore(original: Rgba, canvas: Rgba, side = MEASURE_SIDE): BrushworkScore {
  return compareBrushwork(measureBrushwork(original, side), measureBrushwork(canvas, side));
}

/** A crop of an RGBA image (clamped to it), for cutting the same place out of the original and the canvas. */
export function cropRgba(image: Rgba, rect: number[]): Rgba {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(rect[0] ?? 0))), y = Math.max(0, Math.min(image.height - 1, Math.round(rect[1] ?? 0)));
  const w = Math.max(1, Math.min(image.width - x, Math.round(rect[2] ?? 0))), h = Math.max(1, Math.min(image.height - y, Math.round(rect[3] ?? 0)));
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) data.set(image.data.subarray(((y + j) * image.width + x) * 4, ((y + j) * image.width + x + w) * 4), j * w * 4);
  return { width: w, height: h, data };
}
