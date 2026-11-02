// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Pigment-aware colour choice for a mixing reference transfer (colour-mixing task 7b, amendment 2026-11-01 (2)). A dab that
// mixes with the wet paint beneath lands on mix2(model, C, P, cov), not on its own colour P: C the canvas under it, cov the
// preset's measured paint share (brush-catalog.json mixing.presets[preset].coverage). So each dab's colour is solved for the
// colour wanted (T, the reference's) by a few fixed-point steps, P <- clamp(P + (T - mix2(C, P, cov))), from P = T, and the
// transfer stays faithful while it mixes. C is read from the canvas view observed at the start of each pass, never per dab.
// Pure maths on mix.ts (held to the C++ golden vectors), so the colour the companion solves is the colour the brush mixes.
// Mechanism only: no .mjs imports.
import { hexToRgb, mix2, rgbToHex } from './mix.ts';
import type { MixModel, Rgb } from './mix.ts';

/** At most this many fixed-point steps per dab. */
export const SOLVE_STEPS = 4;
/** A dab whose mix is within this of the wanted colour on every channel is done. */
export const SOLVE_TOLERANCE = 1 / 255;
/** The canvas under a dab is the mean of the view's pixels within this radius (view px) of its centre, at most. */
export const SAMPLE_RADIUS_MAX = 4;
/** Below this mean alpha the view shows no paint there (a transparent canvas): the dab lays the wanted colour. */
export const PAINTED_ALPHA = 0.5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const worst = (a: Rgb, b: Rgb) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** The paint P whose mix with `canvas` at `coverage` comes closest to `target` (the best of at most SOLVE_STEPS steps, in
 * gamut). P = target exactly when canvas == target, coverage is 1 or not in (0, 1). */
export function solvePaint(model: MixModel, canvas: Rgb, target: Rgb, coverage: number): Rgb {
  let paint: Rgb = [target[0], target[1], target[2]];
  if (!(coverage > 0 && coverage < 1)) return paint;
  let best = paint, bestError = Infinity;
  for (let step = 0; ; step++) {
    const got = mix2(model, canvas, paint, coverage), error = worst(got, target);
    if (error < bestError) { best = paint; bestError = error; }
    if (error < SOLVE_TOLERANCE || step === SOLVE_STEPS) break;
    paint = [clamp01(paint[0] + target[0] - got[0]), clamp01(paint[1] + target[1] - got[1]), clamp01(paint[2] + target[2] - got[2])];
  }
  return best;
}

/** A canvas view: RGBA (not premultiplied) of the whole canvas, `scale` view px per canvas px. */
export type CanvasView = { width: number; height: number; data: Uint8Array; scale: number };

/** The canvas colour around (x, y) in canvas px: the alpha-weighted mean within `radius` view px, in 8 bits as the view is;
 * null where the view shows no paint. */
export function canvasColour(view: CanvasView, x: number, y: number, radius: number): Rgb | null {
  const cx = Math.round(x * view.scale), cy = Math.round(y * view.scale), r = Math.max(0, Math.min(SAMPLE_RADIUS_MAX, Math.floor(radius)));
  let red = 0, green = 0, blue = 0, alpha = 0, n = 0;
  for (let yy = Math.max(0, cy - r); yy <= Math.min(view.height - 1, cy + r); yy++)
    for (let xx = Math.max(0, cx - r); xx <= Math.min(view.width - 1, cx + r); xx++) {
      const i = (yy * view.width + xx) * 4, a = view.data[i + 3]!;
      red += view.data[i]! * a; green += view.data[i + 1]! * a; blue += view.data[i + 2]! * a; alpha += a; n++;
    }
  if (!n || alpha / n / 255 < PAINTED_ALPHA) return null;
  return [Math.round(red / alpha) / 255, Math.round(green / alpha) / 255, Math.round(blue / alpha) / 255];
}

type Stroke = { start: number[]; segments: number[][]; size: number; color: string; [key: string]: unknown };

/** The dab's centre: halfway between its start and its last segment's end. */
const centre = (stroke: Stroke): [number, number] => {
  const last = stroke.segments.at(-1), end = last ? [last[4]!, last[5]!] : stroke.start;
  return [(stroke.start[0]! + end[0]!) / 2, (stroke.start[1]! + end[1]!) / 2];
};

/** A solver for one pass: each stroke's colour solved against the view under it, memoised by (canvas, wanted) colour pair. */
export function transferSolver(model: MixModel, coverage: number, view: CanvasView) {
  const known = new Map<string, string>();
  return function solve<T extends Stroke>(strokes: readonly T[]): T[] {
    return strokes.map(stroke => {
      const wanted = typeof stroke.color === 'string' ? hexToRgb(stroke.color) : null;
      if (!wanted) return stroke;
      const [x, y] = centre(stroke), under = canvasColour(view, x, y, (stroke.size * view.scale) / 4);
      if (!under) return stroke;
      const key = rgbToHex(under) + stroke.color;
      let color = known.get(key);
      if (color === undefined) { color = rgbToHex(solvePaint(model, under, wanted, coverage)); known.set(key, color); }
      return color === stroke.color ? stroke : { ...stroke, color };
    });
  };
}
