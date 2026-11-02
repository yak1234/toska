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

/** solvePaint's steps without the clamp: null when a step would leave gamut (the target is out of the paint's reach). */
function solveInGamut(model: MixModel, canvas: Rgb, target: Rgb, coverage: number): Rgb | null {
  let paint: Rgb = [target[0], target[1], target[2]], best = paint, bestError = Infinity;
  for (let step = 0; ; step++) {
    const got = mix2(model, canvas, paint, coverage), error = worst(got, target);
    if (error < bestError) { best = paint; bestError = error; }
    if (error < SOLVE_TOLERANCE || step === SOLVE_STEPS) return best;
    paint = [paint[0] + target[0] - got[0], paint[1] + target[1] - got[1], paint[2] + target[2] - got[2]];
    if (paint.some(v => !(v >= 0 && v <= 1))) return null;
  }
}

/** Bisection steps for how far toward its target a feathered dab can reach in gamut. */
export const REACH_STEPS = 8;

/** The paint for a dab of opacity `opacity` wanting `target` over `canvas`. Opacity 1: solvePaint at the measured coverage,
 * as before. Below 1 the dab paints at coverage x opacity, and a plain dab of the reference colour at that opacity would
 * only move the canvas toward T by the opacity: so its target is lerp(C, T, opacity), not T (solving a 0.02-opacity dab to
 * land on T asks for a colour far out of gamut, which clamps to a saturated edge). Where even that target is out of
 * reach, the dab moves toward it only as far as an in-gamut paint can (the largest k in [0, 1] with lerp(C, T, opacity k)
 * solvable without clamping; k = 0 is the canvas itself), so a feathered dab never lays a clamped colour. */
export function solveDab(model: MixModel, canvas: Rgb, target: Rgb, coverage: number, opacity: number): Rgb {
  if (!(opacity >= 0 && opacity < 1)) return solvePaint(model, canvas, target, coverage);
  const share = coverage * opacity;
  const toward = (k: number): Rgb => [0, 1, 2].map(i => canvas[i]! + (target[i]! - canvas[i]!) * opacity * k) as Rgb;
  const whole = solveInGamut(model, canvas, toward(1), share);
  if (whole) return whole;
  let low = 0, high = 1, best: Rgb = [canvas[0], canvas[1], canvas[2]];
  for (let step = 0; step < REACH_STEPS; step++) {
    const middle = (low + high) / 2, paint = solveInGamut(model, canvas, toward(middle), share);
    if (paint) { low = middle; best = paint; } else high = middle;
  }
  return best;
}

// Overlap within a pass (fix round 1). A transfer's dabs are 1.5 steps wide a step apart and painted in shuffled order, so
// most of what is finally seen of a dab lies on an earlier dab of the same pass (whose colour is about T), not on the canvas
// the pass started from (C). Solving against C then overshoots by about (1 - cov)(T - C). The solve uses
// C' = lerp(C, T, s) instead, with s the share of a dab's visible area (where it ends up on top) that lies on earlier dabs
// of its pass.
//
// Derivation: take a point of a dab d that K other dabs of the pass also cover. In a shuffled order each of the K + 1 is
// last with the same chance, so d is seen there with probability 1 / (K + 1), and when it is seen it lies on an earlier
// dab exactly when K >= 1. Over the points of d:
//   s = E[ [K >= 1] / (K + 1) ] / E[ 1 / (K + 1) ].
// K comes from the generator's layout (reference-generator.mjs DAB_*): centres on a unit lattice, each jittered uniformly
// within +-jitter/2 on both axes, each a capsule of the given width around a segment of the given length at a uniform
// random angle (the generator's angle follows the reference's gradient, which is random where the reference is flat).
// overlapShare estimates the two expectations by a deterministic Monte Carlo over the 7 x 7 neighbourhood of a dab (dabs
// further away cannot reach it at these sizes), cached per layout. The standard layout gives s of about 0.90
// (tests/transfer-mixing.test.ts checks it against painting a real plan's pass pixel by pixel).
export type DabLayout = { width: number; halfLength: number; jitter: number };
const OVERLAP_SAMPLES = 40000;
const overlapCache = new Map<string, number>();

/** The share of a dab's visible area that lies on earlier dabs of its own pass, for a layout in step units (above). */
export function overlapShare(layout: DabLayout): number {
  const key = `${layout.width}:${layout.halfLength}:${layout.jitter}`;
  const known = overlapCache.get(key);
  if (known !== undefined) return known;
  let seed = 0x5eed;
  const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const radius = layout.width / 2, reach = 3;
  const dab = (cx: number, cy: number) => { const angle = rand() * Math.PI, dx = Math.cos(angle) * layout.halfLength, dy = Math.sin(angle) * layout.halfLength;
    return { cx: cx + (rand() - 0.5) * layout.jitter, cy: cy + (rand() - 0.5) * layout.jitter, dx, dy }; };
  // Distance from (x, y) to the dab's segment.
  const distance = (d: { cx: number; cy: number; dx: number; dy: number }, x: number, y: number) => {
    const ax = d.cx - d.dx, ay = d.cy - d.dy, bx = 2 * d.dx, by = 2 * d.dy, length = bx * bx + by * by;
    const t = length ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / length)) : 0;
    return Math.hypot(x - ax - t * bx, y - ay - t * by);
  };
  let seen = 0, onEarlier = 0;
  for (let n = 0; n < OVERLAP_SAMPLES; n++) {
    const own = dab(0, 0);
    // A uniform point of the dab: rejection from its bounding box.
    let x = 0, y = 0;
    const box = radius + layout.halfLength;
    do { x = own.cx + (rand() * 2 - 1) * box; y = own.cy + (rand() * 2 - 1) * box; } while (distance(own, x, y) > radius);
    let others = 0;
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
      if (!i && !j) continue;
      if (distance(dab(i, j), x, y) <= radius) others++;
    }
    seen += 1 / (others + 1);
    if (others) onEarlier += 1 / (others + 1);
  }
  const share = onEarlier / seen;
  overlapCache.set(key, share);
  return share;
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

/** A solver for one pass: each stroke's colour solved against the view under it moved `overlap` of the way to the wanted
 * colour (C' = lerp(C, T, overlap), overlapShare above), at the preset's measured coverage times the stroke's opacity (the
 * plugin paints a MyPaint dab at its opacity; the coverage was measured at opacity 1) toward lerp(C', T, opacity) (solveDab),
 * memoised by (canvas, wanted colour, coverage, opacity). */
export function transferSolver(model: MixModel, coverage: number, view: CanvasView, overlap = 0) {
  const known = new Map<string, string>();
  return function solve<T extends Stroke>(strokes: readonly T[]): T[] {
    return strokes.map(stroke => {
      const wanted = typeof stroke.color === 'string' ? hexToRgb(stroke.color) : null;
      if (!wanted) return stroke;
      const [x, y] = centre(stroke), under = canvasColour(view, x, y, (stroke.size * view.scale) / 4);
      if (!under) return stroke;
      const opacity = typeof stroke.opacity === 'number' && stroke.opacity >= 0 && stroke.opacity < 1 ? stroke.opacity : 1;
      const key = rgbToHex(under) + stroke.color + coverage + ':' + opacity;
      let color = known.get(key);
      if (color === undefined) {
        const below: Rgb = [0, 1, 2].map(k => under[k]! + (wanted[k]! - under[k]!) * overlap) as Rgb;
        color = rgbToHex(solveDab(model, below, wanted, coverage, opacity)); known.set(key, color);
      }
      return color === stroke.color ? stroke : { ...stroke, color };
    });
  };
}
