// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Gesture strokes (openspec painting-skills, mechanical strokes; the artist 2026-11-14). In the Degas baseline the painter
// stated the right gestures as seven paint_recipe calls ("Floor: broad diagonal strokes", 240 strokes, direction
// "diagonal", irregularity 0.4) and Luna undid them all: "mechanical stripes, hard graphic look". The rectangle recipe
// could say one direction word per box, clipped its strokes at the box and gave every stroke one pressure. Noise on a
// wrong direction is still a wrong direction. This module is what paint_recipe uses when a recipe asks for more:
//
// - direction follow_form: each stroke is traced along a direction field read from an image of the same place (the goal
//   where it sits on the canvas, else the canvas itself): the structure tensor's flow, as the surface pass traces it
//   (reference-generator.mjs generateSurfacePlan), stopped at strong edges and sharp turns. Never along an outline: a
//   stroke starts inside the area and ends before an edge (the artist's rule, 2026-10-23).
// - an angle in degrees instead of a direction word;
// - an area that is the part itself (a mask) and not a box: seeds inside it, strokes end at its boundary, and paint thins
//   out toward the boundary instead of being cut by it;
// - a pressure shape on every stroke (taper: light in, press, lift; swell; even), with jitter;
// - colour from the image at each stroke, or from the palette.
// Length, angle, bend, spacing and pressure always vary: MIN_LOOSENESS is the floor however tidy the recipe asks.
// Pure functions, no file or studio access, no .mjs imports. A seed reproduces a batch.

export type Rect = [number, number, number, number];
export type Rgba = { width: number; height: number; data: Uint8Array };
/** Where an image sits on the canvas: its `source` crop (image pixels) drawn over `target` (canvas pixels). */
export type Placement = { source: number[]; target: number[] };
export type PressureShape = 'taper' | 'swell' | 'even';
export type GestureStroke = { start: [number, number]; segments: number[][]; size: number; opacity: number; flow: number; color: string; pressure?: number[] };
export type GestureRecipe = {
  region: number[]; palette: string[]; stroke_count: number; size: number[]; opacity: number[]; length?: number[];
  direction: string; angle?: number; irregularity: number; seed: number; flow?: number;
  pressure?: PressureShape; colour_from?: 'palette' | 'form';
};
/** What the generator may read about the place: all optional, all in canvas pixels. */
export type GestureContext = {
  /** The form's direction at a point as a unit vector, or null where the image has none (flat or confused). */
  flow?: (x: number, y: number) => [number, number] | null;
  /** A strong edge here: strokes stop before it. */
  edge?: (x: number, y: number) => boolean;
  /** The image's colour here, or null outside it. */
  colour?: (x: number, y: number) => [number, number, number] | null;
  /** Inside the area (the part's mask); absent means the whole region. */
  inside?: (x: number, y: number) => boolean;
};

/** However tidy a recipe asks, strokes vary at least this much: identical marks are what reads as mechanical. */
export const MIN_LOOSENESS = 0.25;
/** The share of the area's smaller side over which paint thins out toward its boundary. */
export const EDGE_FEATHER = 0.08;
/** A traced stroke ends when the form turns more than this between steps (cos 45 degrees), as the surface pass. */
const TURN_LIMIT = 0.7;
/** Canvas px between the checks for an edge or the area's boundary along one step of a stroke. */
const EDGE_PROBE = 2;
/** Rounds of seeds tried to reach the asked stroke count. */
const SEED_ROUNDS = 6;
/** The long side of the grid a direction field is computed on: marks of 10-20 px on a 6000 px canvas stay 2-3 cells wide. */
export const FIELD_SIDE = 768;
/** Edge strength (Sobel on 0-1 lightness) that stops a stroke; the surface pass's default. */
export const EDGE_CONTRAST = 0.3;
/** Below this coherence the field has no direction (flat paint, or directions cancelling). */
export const MIN_COHERENCE = 0.12;

export const PRESSURE_SHAPES: readonly PressureShape[] = ['taper', 'swell', 'even'];

/** Does this recipe need the gesture generator (and not the rectangle one)? */
export function gestureRecipe(recipe: { direction?: unknown; angle?: unknown; inside_shape?: unknown; colour_from?: unknown }, context?: GestureContext | null): boolean {
  return recipe.direction === 'follow_form' || typeof recipe.angle === 'number' || recipe.inside_shape !== undefined
    || recipe.colour_from === 'form' || !!context?.inside;
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (rgb: number[]): string => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const unhex = (colour: string): [number, number, number] => [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16)) as [number, number, number];
const WORD_ANGLES: Record<string, number> = { horizontal: 0, vertical: 90, diagonal: 45 };

/** Pressure along a stroke of `points` points (start, then each segment end). Taper is light in, press, lift. */
export function pressureCurve(shape: PressureShape, points: number, random: () => number): number[] | undefined {
  if (shape === 'even' || points < 2) return undefined;
  const lightIn = 0.12 + random() * 0.22, lift = 0.08 + random() * 0.2, press = 0.78 + random() * 0.22;
  // Where the hand presses hardest: early to middle for a taper, late for a swell.
  const peak = shape === 'taper' ? 0.3 + random() * 0.3 : 0.7 + random() * 0.2;
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    const value = t <= peak ? lightIn + (press - lightIn) * Math.sin((t / peak) * Math.PI / 2)
      : lift + (press - lift) * Math.cos(((t - peak) / (1 - peak)) * Math.PI / 2);
    return Math.round(Math.max(0.02, Math.min(1, value)) * 1000) / 1000;
  });
}

/** A smooth curve through the points (Catmull-Rom as cubic segments), the shape a native pass takes. */
function curveThrough(points: [number, number][]): { start: [number, number]; segments: number[][] } {
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
  const segments: number[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    segments.push([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]]);
  }
  return { start: points[0]!, segments };
}

/** `count` points evenly along a polyline (its two ends included). */
function resample(path: [number, number][], count: number): [number, number][] {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
  const total = lengths[lengths.length - 1]!, out: [number, number][] = [];
  for (let n = 0, i = 1; n < count; n++) {
    const want = total * n / (count - 1);
    while (i < path.length - 1 && lengths[i]! < want) i++;
    const span = lengths[i]! - lengths[i - 1]! || 1, t = (want - lengths[i - 1]!) / span;
    out.push([path[i - 1]![0] + (path[i]![0] - path[i - 1]![0]) * t, path[i - 1]![1] + (path[i]![1] - path[i - 1]![1]) * t]);
  }
  return out;
}
const pathLength = (path: [number, number][]): number => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);

/** The strokes of a gesture recipe on `canvas`. Throws what the painter can act on; never returns an empty batch. */
export function gestureStrokes(recipe: GestureRecipe, canvas: { width: number; height: number }, context: GestureContext = {}): GestureStroke[] {
  const [rx = 0, ry = 0, rw = 0, rh = 0] = recipe.region;
  if (!(rw >= 1 && rh >= 1) || rx + rw > canvas.width || ry + rh > canvas.height) throw new Error('Recipe region must fit the observed canvas.');
  for (const key of ['size', 'opacity', 'length'] as const) { const r = recipe[key]; if (r && !(r[0]! <= r[1]!)) throw new Error(key + ' range must be ordered minimum, maximum.'); }
  const follow = recipe.direction === 'follow_form';
  if (follow && !context.flow) throw new Error('direction follow_form needs an image of this place to read the form from: the goal image placed on the canvas, or the canvas you last saw. Look at the canvas first, or give an angle.');
  if (recipe.colour_from === 'form' && !context.colour) throw new Error('colour_from form needs the goal image placed on the canvas, or the canvas you last saw. Look at the canvas first, or use the palette.');
  const random = mulberry(recipe.seed), between = (r: number[]) => r[0]! + (r[1]! - r[0]!) * random();
  // Two uniform draws make a bell around zero, enough for a hand's scatter.
  const bell = () => (random() + random() + random() - 1.5) / 1.5;
  const loose = Math.max(MIN_LOOSENESS, Math.min(1, recipe.irregularity));
  const inRegion = (x: number, y: number) => x >= rx && y >= ry && x <= rx + rw && y <= ry + rh;
  const inside = (x: number, y: number) => inRegion(x, y) && (context.inside ? context.inside(x, y) : true);
  const blockedAt = (x: number, y: number) => !inside(x, y) || (context.edge ? context.edge(x, y) : false);
  // A step is checked along its whole way (every EDGE_PROBE px): a long stroke's step is longer than an edge is wide.
  const blocked = (x: number, y: number, fromX = x, fromY = y) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / EDGE_PROBE));
    for (let i = 1; i <= n; i++) if (blockedAt(fromX + (x - fromX) * i / n, fromY + (y - fromY) * i / n)) return true;
    return false;
  };
  // How far inside the area a point is, 0 at the boundary to 1 a feather's width in: four probes around it. The canvas
  // border is no boundary (paint may run off the picture).
  const feather = Math.max(2, EDGE_FEATHER * Math.min(rw, rh));
  const within = (x: number, y: number) => {
    let hits = 0, probes = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const) {
      const px = x + dx * feather, py = y + dy * feather;
      if (px < 0 || py < 0 || px > canvas.width || py > canvas.height) continue;
      probes++; if (inside(px, py)) hits++;
    }
    return probes ? hits / probes : 1;
  };
  const baseAngle = typeof recipe.angle === 'number' ? recipe.angle : WORD_ANGLES[recipe.direction];
  // Seeds: a jittered grid over the region, kept where they fall inside the area, in a shuffled order.
  const count = recipe.stroke_count, cell = Math.sqrt(rw * rh / count), cols = Math.max(1, Math.round(rw / cell)), rows = Math.max(1, Math.ceil(count / cols));
  const seedRound = (): [number, number][] => {
    const round: [number, number][] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = rx + (i + 0.5 + (random() - 0.5) * (0.5 + loose * 0.5)) * rw / cols, y = ry + (j + 0.5 + (random() - 0.5) * (0.5 + loose * 0.5)) * rh / rows;
      if (inside(x, y)) round.push([x, y]);
    }
    for (let i = round.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [round[i], round[j]] = [round[j]!, round[i]!]; }
    return round;
  };
  let seeds = seedRound();
  // The area's own main direction, for seeds where the field has none: the first coherent flows, averaged as axes.
  let mainAngle = baseAngle === undefined ? null : baseAngle * Math.PI / 180;
  if (follow) {
    let c = 0, s = 0;
    for (const [x, y] of seeds.slice(0, 400)) { const f = context.flow!(x, y); if (f) { const a = 2 * Math.atan2(f[1], f[0]); c += Math.cos(a); s += Math.sin(a); } }
    if (c || s) mainAngle = Math.atan2(s, c) / 2;
  }
  const strokes: GestureStroke[] = [];
  // Seeds that fall on an edge, outside the area or in its thinning rim paint nothing, so further rounds of fresh seeds
  // follow until the asked count is reached (a small or edge-filled area ends with fewer, and says so by its count).
  for (let round = 0; round < SEED_ROUNDS && strokes.length < count; round++, seeds = seedRound()) for (const [x0, y0] of seeds) {
    if (strokes.length >= count) break;
    const size = between(recipe.size);
    const length = Math.max(4, (recipe.length ? between(recipe.length) : size * (1.5 + random() * 2.5)) * (1 + bell() * loose * 0.35));
    const step = Math.max(1.5, length / 10);
    let path: [number, number][] = [[x0, y0]];
    const fallback = mainAngle ?? random() * Math.PI;
    const turn = bell() * loose * (follow ? 0.14 : 0.42);              // radians: 8 or 24 degrees at full looseness
    const first = follow ? context.flow!(x0, y0) : null;
    const heading: [number, number] = first ?? [Math.cos(fallback), Math.sin(fallback)];
    const cos = Math.cos(turn), sin = Math.sin(turn), start: [number, number] = [heading[0] * cos - heading[1] * sin, heading[0] * sin + heading[1] * cos];
    // A hand's stroke bows slightly: the heading drifts by `bend` over its length (the form's own turn comes on top).
    const bend = bell() * loose * 0.5 / (length / step);
    for (const way of [1, -1]) {
      let px = x0, py = y0, dx = start[0] * way, dy = start[1] * way;
      for (let n = 0; n < length / 2 / step; n++) {
        const nx = px + dx * step, ny = py + dy * step;
        if (blocked(nx, ny, px, py)) break;
        let next: [number, number] = [dx, dy];
        if (follow) {
          const f = context.flow!(nx, ny);
          if (f) { next = f[0] * dx + f[1] * dy < 0 ? [-f[0], -f[1]] : f; if (next[0] * dx + next[1] * dy < TURN_LIMIT) break; }
        }
        const b = bend * way, bc = Math.cos(b), bs = Math.sin(b);
        next = [next[0] * bc - next[1] * bs, next[0] * bs + next[1] * bc];
        if (way > 0) path.push([nx, ny]); else path.unshift([nx, ny]);
        px = nx; py = ny; [dx, dy] = next;
      }
    }
    if (path.length < 2 || pathLength(path) < Math.max(3, Math.min(size * 0.5, length * 0.25))) continue;
    // Toward the area's boundary paint thins out: fewer strokes and lighter ones, so the area has no cut edge.
    const depth = within(x0, y0);
    if (depth < 1 && random() > 0.35 + depth * 0.65) continue;
    path = resample(path, path.length > 6 ? 5 : path.length > 3 ? 4 : 3);
    const middle = path[Math.floor(path.length / 2)]!;
    let rgb: [number, number, number];
    if (recipe.colour_from === 'form') {
      const seen = context.colour!(middle[0], middle[1]);
      if (!seen) continue;
      // A stick or a loaded brush never lays exactly the local colour: a small shift in lightness, a smaller one in hue.
      const light = 1 + bell() * loose * 0.12;
      rgb = seen.map(v => v * light + bell() * loose * 8) as [number, number, number];
    } else rgb = unhex(recipe.palette[Math.floor(random() * recipe.palette.length)]!);
    const pressure = pressureCurve(recipe.pressure ?? 'taper', path.length, random);
    const clamp = ([x, y]: [number, number]): [number, number] => [Math.max(-size, Math.min(canvas.width + size, x)), Math.max(-size, Math.min(canvas.height + size, y))];
    const round = (v: number) => Math.round(v * 100) / 100;
    const { start: from, segments } = curveThrough(path.map(clamp));
    strokes.push({ start: [round(from[0]), round(from[1])], segments: segments.map(s => s.map(round)), size: round(size),
      opacity: round(Math.max(0.01, between(recipe.opacity) * (0.6 + 0.4 * depth))), flow: recipe.flow ?? 1, color: hex(rgb), ...(pressure ? { pressure } : {}) });
  }
  if (!strokes.length) throw new Error(context.inside ? 'No stroke fits inside that area: choose a larger area, shorter strokes or a smaller size.'
    : 'No stroke fits here: the region is all edges or too small for these strokes. Choose a broader region or shorter strokes.');
  return strokes;
}

// ---- the direction field ---------------------------------------------------------------------------------------------

function boxBlur(values: Float32Array, w: number, h: number, r: number): Float32Array {
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
  for (let i = 0; i < 2; i++) v = pass(pass(v, true), false);          // two passes: close to a Gaussian
  return v;
}

/** The part of `image` that lies under `region` of the canvas, as a grid of at most `side` cells on its long side, with
 * the form's flow (structure tensor), edge strength and colour per cell; null when the image does not cover the region. */
export function directionField(image: Rgba, placement: Placement, region: number[], { side = FIELD_SIDE, edgeContrast = EDGE_CONTRAST, smoothing }: { side?: number; edgeContrast?: number; smoothing?: number } = {}): Required<Pick<GestureContext, 'flow' | 'edge' | 'colour'>> & { coverage: number; coherent: number } | null {
  const [sx = 0, sy = 0, sw = 0, sh = 0] = placement.source, [tx = 0, ty = 0, tw = 0, th = 0] = placement.target;
  const [rx = 0, ry = 0, rw = 0, rh = 0] = region;
  if (!(sw > 0 && sh > 0 && tw > 0 && th > 0 && rw > 0 && rh > 0)) return null;
  // The region's overlap with where the image sits, and that overlap in image pixels.
  const left = Math.max(rx, tx), top = Math.max(ry, ty), right = Math.min(rx + rw, tx + tw), bottom = Math.min(ry + rh, ty + th);
  if (right - left < 2 || bottom - top < 2) return null;
  const kx = sw / tw, ky = sh / th;
  const ix = sx + (left - tx) * kx, iy = sy + (top - ty) * ky, iw = (right - left) * kx, ih = (bottom - top) * ky;
  const scale = Math.min(1, side / Math.max(iw, ih)), w = Math.max(2, Math.round(iw * scale)), h = Math.max(2, Math.round(ih * scale));
  // Area-average each cell from the image (a plain box: the image is at most a few times larger than the grid).
  const L = new Float32Array(w * h), R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, Math.floor(ix + x * iw / w)), x1 = Math.min(image.width, Math.max(x0 + 1, Math.ceil(ix + (x + 1) * iw / w)));
    const y0 = Math.max(0, Math.floor(iy + y * ih / h)), y1 = Math.min(image.height, Math.max(y0 + 1, Math.ceil(iy + (y + 1) * ih / h)));
    // At most 4 x 4 samples a cell: enough to average, bounded on a large image.
    const stepX = Math.max(1, Math.floor((x1 - x0) / 4)), stepY = Math.max(1, Math.floor((y1 - y0) / 4));
    let r = 0, g = 0, b = 0, n = 0;
    for (let v = y0; v < y1; v += stepY) for (let u = x0; u < x1; u += stepX) { const i = (v * image.width + u) * 4; r += image.data[i]!; g += image.data[i + 1]!; b += image.data[i + 2]!; n++; }
    const k = y * w + x;
    if (n) { R[k] = r / n; G[k] = g / n; B[k] = b / n; }
    L[k] = (R[k]! * 0.2126 + G[k]! * 0.7152 + B[k]! * 0.0722) / 255;
  }
  const l = (x: number, y: number) => L[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]!;
  const XX = new Float32Array(w * h), XY = new Float32Array(w * h), YY = new Float32Array(w * h), M = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (l(x + 1, y - 1) + 2 * l(x + 1, y) + l(x + 1, y + 1) - l(x - 1, y - 1) - 2 * l(x - 1, y) - l(x - 1, y + 1)) / 4;
    const gy = (l(x - 1, y + 1) + 2 * l(x, y + 1) + l(x + 1, y + 1) - l(x - 1, y - 1) - 2 * l(x, y - 1) - l(x + 1, y - 1)) / 4;
    const k = y * w + x; XX[k] = gx * gx; XY[k] = gx * gy; YY[k] = gy * gy; M[k] = Math.hypot(gx, gy);
  }
  const r = smoothing ?? Math.max(2, Math.round(Math.max(w, h) / 120));
  const A = boxBlur(XX, w, h, r), Bm = boxBlur(XY, w, h, r), C = boxBlur(YY, w, h, r);
  // An edge is a strong step that is not part of a field of marks: strong against its own neighbourhood's mean.
  const around = boxBlur(M, w, h, r * 2);
  const cell = (x: number, y: number) => { const i = Math.floor((x - left) * w / (right - left)), j = Math.floor((y - top) * h / (bottom - top)); return i < 0 || j < 0 || i >= w || j >= h ? -1 : j * w + i; };
  let coherent = 0;
  const angle = new Float32Array(w * h).fill(NaN);
  for (let k = 0; k < w * h; k++) {
    const sum = A[k]! + C[k]!;
    if (sum < 1e-7) continue;
    const coherence = Math.hypot(A[k]! - C[k]!, 2 * Bm[k]!) / sum;
    if (coherence < MIN_COHERENCE) continue;
    angle[k] = 0.5 * Math.atan2(2 * Bm[k]!, A[k]! - C[k]!); coherent++;
  }
  return {
    // The structure tensor's main axis is across the marks; the flow is perpendicular to it.
    flow: (x, y) => { const k = cell(x, y); if (k < 0 || Number.isNaN(angle[k]!)) return null; const t = angle[k]!; return [-Math.sin(t), Math.cos(t)]; },
    edge: (x, y) => { const k = cell(x, y); return k >= 0 && M[k]! >= edgeContrast && M[k]! >= 3 * around[k]!; },
    colour: (x, y) => { const k = cell(x, y); return k < 0 ? null : [R[k]!, G[k]!, B[k]!]; },
    coverage: (right - left) * (bottom - top) / (rw * rh), coherent: coherent / (w * h),
  };
}

/** Inside test for a mask plane (0-255) whose top-left sits at `bounds` on the canvas. */
export function maskInside(mask: { width: number; height: number; data: Uint8Array }, bounds: number[]): (x: number, y: number) => boolean {
  const [bx = 0, by = 0] = bounds;
  return (x, y) => { const i = Math.floor(x - bx), j = Math.floor(y - by); return i >= 0 && j >= 0 && i < mask.width && j < mask.height && (mask.data[j * mask.width + i] ?? 0) >= 128; };
}
