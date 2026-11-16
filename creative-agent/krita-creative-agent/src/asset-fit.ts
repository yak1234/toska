// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Repaint from asset (openspec repaint-from-asset; the artist, 2026-11-16): an asset's part is repainted into the area the
// artist confirmed on the canvas, and the canvas's outline wins: the part's box is stretched onto the area's box, wider or
// taller as needed. This module is the arithmetic of that fit, and nothing else:
//
//   const fit = measureFit(part, area);          // part: the part's shape in the asset; area: its shape on the canvas
//   if (!fit.fits) say(fit.why);                 // before any paint: another shape, stretched unevenly, or too small
//   const picture = fitAsset(asset, part, area); // the asset's part in the area's proportions, see-through outside the part
//
// The fitted picture is transferred onto the area's box like any reference (the transfer skips see-through pixels), so
// where the stretched part does not reach the canvas outline the paint already there stays, and the asset's backdrop is
// never painted. An asset that is its part all over (a sky filling its frame) is `part` null: measured by its stretch alone.
// The limits are first values, to be set against real assets (tasks 6.x); they are exported so the report can name them.
// Mechanism only: no .mjs imports, no files.

export type Rect = [number, number, number, number];
/** A shape over `bounds` [x, y, w, h] of its picture: one byte a pixel, inside from 128 (find-it.ts, paint-only-here.ts). */
export type Shape = { bounds: Rect; data: Uint8Array };
export type Rgba = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** Below this overlap (shared pixels over all pixels of the two outlines, the part stretched onto the area's box) the part
 * is another shape than the area. Live on New Moscow's underpainting (2026-11-16, 02-historic-buildings): the tower alone
 * overlapped 0.57 before its outline's holes were filled, and was plainly the same tower; "the historic buildings" as a
 * group (a facade and the tower, side by side in the image and far apart on the canvas) overlapped 0.30. */
export const MIN_OVERLAP = 0.5;
/** Past this the part is stretched too much more one way than the other: its windows and proportions would read wrong. */
export const MAX_UNEVEN = 1.5;
/** Past this the asset is too small for the area: the transfer's own stretch limit (reference-tool.mjs MAX_PATCH_SCALE). */
export const MAX_SCALE = 2;
/** The fitted picture's size at most: a transfer reads it whole. */
export const FITTED_PIXELS = 4_000_000;
const INSIDE = 128, GRID = 256;

export type Fit = {
  /** Shared pixels over all pixels of the two outlines, 0-1. */
  overlap: number;
  /** The share of the area the stretched part covers, 0-1. */
  covered: number;
  /** How much more the part is stretched one way than the other, from 1. */
  uneven: number;
  /** Canvas pixels to an asset pixel on the more stretched side. */
  scale: number;
  fits: boolean;
  /** Why it does not fit, in the artist's words; null when it fits. */
  why: string | null;
};

const round = (value: number) => Math.round(value * 100) / 100;
const box = (part: Shape | null, asset?: { width: number; height: number }): Rect => {
  if (part) return part.bounds;
  if (!asset) throw new Error('An asset used whole needs its size.');
  return [0, 0, asset.width, asset.height];
};
const stretch = (from: Rect, to: Rect) => {
  if (!(from[2] > 0 && from[3] > 0 && to[2] > 0 && to[3] > 0)) throw new Error('A fit needs a part and an area with a size.');
  return { sx: to[2] / from[2], sy: to[3] / from[3] };
};

/** The shape with every enclosed hole filled (a pixel outside it that no path of outside pixels joins to the bounds' edge).
 * The shapes model leaves holes inside a found part (a dark courtyard, a lit window); the part is the whole of its outline. */
export function fillHoles(shape: Shape): Shape {
  const [, , w, h] = shape.bounds, data = Uint8Array.from(shape.data), open = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const visit = (k: number) => { if (!open[k] && data[k]! < INSIDE) { open[k] = 1; queue[tail++] = k; } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (head < tail) {
    const k = queue[head++]!, x = k % w;
    if (x > 0) visit(k - 1);
    if (x < w - 1) visit(k + 1);
    if (k >= w) visit(k - w);
    if (k < (h - 1) * w) visit(k + w);
  }
  for (let k = 0; k < data.length; k++) if (data[k]! < INSIDE && !open[k]) data[k] = 255;
  return { bounds: shape.bounds, data };
}

/** How well the asset's part fits the area on the canvas when its box is stretched onto the area's box. */
export function measureFit(part: Shape | null, area: Shape, asset?: { width: number; height: number }): Fit {
  const from = box(part, asset), { sx, sy } = stretch(from, area.bounds);
  const uneven = round(Math.max(sx / sy, sy / sx)), scale = round(Math.max(sx, sy));
  let overlap = 1, covered = 1;
  if (part) {
    const [, , aw, ah] = area.bounds, [, , pw, ph] = from, cols = Math.min(aw, GRID), rows = Math.min(ah, GRID);
    let both = 0, either = 0, inArea = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
      const a = (area.data[Math.floor(v * ah) * aw + Math.floor(u * aw)] ?? 0) >= INSIDE;
      const p = (part.data[Math.floor(v * ph) * pw + Math.floor(u * pw)] ?? 0) >= INSIDE;
      if (a) inArea++;
      if (a && p) both++;
      if (a || p) either++;
    }
    overlap = either ? round(both / either) : 0;
    covered = inArea ? round(both / inArea) : 0;
  }
  const why = uneven > MAX_UNEVEN ? `it would be stretched ${uneven} times more one way than the other to fit`
    : overlap < MIN_OVERLAP ? `its shape matches only ${Math.round(overlap * 100)}% of the area on the painting`
    : scale > MAX_SCALE ? `it is too small for this area (enlarged ${scale} times, it would be painted blurred)`
    : null;
  return { overlap, covered, uneven, scale, fits: !why, why };
}

/** The asset's part in the area's proportions: its colours where the part is, see-through elsewhere. Its less stretched
 * side keeps the asset's own detail (it is never enlarged there), and it is never larger than the area or FITTED_PIXELS. */
export function fitAsset(asset: Rgba, part: Shape | null, area: Shape): Rgba {
  const [bx, by, bw, bh] = box(part, asset), [, , aw, ah] = area.bounds, { sx, sy } = stretch([bx, by, bw, bh], area.bounds);
  const reduce = Math.max(1, Math.min(sx, sy), Math.sqrt(aw * ah / FITTED_PIXELS));
  const width = Math.max(1, Math.round(aw / reduce)), height = Math.max(1, Math.round(ah / reduce));
  const data = new Uint8Array(width * height * 4), source = asset.data;
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  for (let y = 0; y < height; y++) {
    // Samples stay inside the part's box, so the asset's backdrop beside it never bleeds in.
    const fy = clamp((y + 0.5) / height * bh - 0.5, 0, bh - 1), j0 = Math.floor(fy), j1 = Math.min(bh - 1, j0 + 1), ty = fy - j0;
    for (let x = 0; x < width; x++) {
      const fx = clamp((x + 0.5) / width * bw - 0.5, 0, bw - 1), i0 = Math.floor(fx), i1 = Math.min(bw - 1, i0 + 1), tx = fx - i0;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty, out = (y * width + x) * 4;
      const at = (i: number, j: number) => ((by + j) * asset.width + bx + i) * 4;
      const a = at(i0, j0), b = at(i1, j0), c = at(i0, j1), d = at(i1, j1);
      for (let k = 0; k < 3; k++) data[out + k] = Math.round(source[a + k]! * w00 + source[b + k]! * w10 + source[c + k]! * w01 + source[d + k]! * w11);
      const opaque = (source[a + 3]! * w00 + source[b + 3]! * w10 + source[c + 3]! * w01 + source[d + 3]! * w11) / 255;
      const inside = part ? (part.data[j0 * bw + i0]! * w00 + part.data[j0 * bw + i1]! * w10 + part.data[j1 * bw + i0]! * w01 + part.data[j1 * bw + i1]! * w11) : 255;
      data[out + 3] = Math.round(inside * opaque);
    }
  }
  return { width, height, data };
}
