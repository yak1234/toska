// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Development only: a deterministic wet-into-wet colour-mixing showcase, without the agent. Paired replays showed spectral close
// to rgb in the agent's normal painting because each pass paints one colour family onto its own new layer, so wet strokes never
// meet a different wet colour. Mixing should show only where different colours meet wet on the SAME layer. This paints exactly
// that: for each mixing model (rgb, spectral) and each preset (Wet Paint Plus, Wet Knife Plus), a fresh 3000x2000 white test
// document (made and closed here) holds three panels, each on one new layer that later passes continue:
//   1 blue into yellow, 2 sunset sky (blue top, orange bottom, alternating blending strokes across the middle), 3 red over green.
//   node scripts/mixing-showcase.ts [--out <folder>] [--variant default|glaze|layered]
// Krita must be idle with no document open (checked first). Writes per (preset, model) the full result PNG, per preset a labelled
// sheet showcase-<preset>.jpg (rgb row above spectral row), numbers.json and report.md in the folder (default
// ../local-notes/benchmarks/colour-mixing/showcase). The strokes are fixed (seeded jitter), so a rerun differs only by Krita.
import { crc32, deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { decodeRgba } from '../src/png-rgba.ts';

export type Json = Record<string, any>;
export type Rect = [number, number, number, number];
export type Stroke = { start: [number, number]; segments: number[][]; size: number; opacity: number; flow: number; color: string };
export type Model = 'rgb' | 'spectral';
export type PanelId = 'blue-into-yellow' | 'sunset-sky' | 'red-over-green';
export type PanelPlan = { id: PanelId; title: string; column: Rect; passes: { name: string; strokes: Stroke[] }[]; zones: Record<string, Rect> };

export const CANVAS = { width: 3000, height: 2000 };
export const PRESETS = [
  { name: 'i) Wet Paint Plus (mypaint)', slug: 'wet-paint-plus', label: 'WET PAINT PLUS' },
  { name: 'i) Wet Knife Plus (mypaint)', slug: 'wet-knife-plus', label: 'WET KNIFE PLUS' },
] as const;
export const MODELS: Model[] = ['rgb', 'spectral'];
export const COLOURS = { yellow: '#f5c400', ultramarine: '#1b2a9c', deepBlue: '#10206b', orange: '#f07a14', green: '#1f9a3a', red: '#d41c1c' };
export const GREEN_HUE: [number, number] = [75, 165];
/** A pixel counts as coloured (its hue means something) from this HSV saturation up. */
export const MIN_SATURATION = 0.15;

/** A small deterministic generator (mulberry32): the same seed gives the same strokes on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One straight stroke as native cubic segments: control points on the line, the line wobbling off it by at most `wobble` px. */
export function lineStroke(from: [number, number], to: [number, number], size: number, color: string, random: () => number, wobble = 5, parts = 4): Stroke {
  const point = (t: number): [number, number] => {
    const edge = t === 0 || t === 1 ? 0 : 1;
    return [Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t + edge * (random() * 2 - 1) * wobble)];
  };
  const segments: number[][] = [];
  for (let i = 0; i < parts; i++) {
    const a = point(i / parts), b = point((i + 1) / parts);
    const c1: [number, number] = [Math.round(a[0] + (b[0] - a[0]) / 3), Math.round(a[1] + (b[1] - a[1]) / 3)];
    const c2: [number, number] = [Math.round(a[0] + (b[0] - a[0]) * 2 / 3), Math.round(a[1] + (b[1] - a[1]) * 2 / 3)];
    segments.push([c1[0], c1[1], c2[0], c2[1], b[0], b[1]]);
    if (i === 0) segments[0] = [c1[0], c1[1], c2[0], c2[1], b[0], b[1]];
  }
  return { start: point(0), segments, size, opacity: 1, flow: 1, color };
}

/** The box a set of strokes covers, brush radius included, clamped to nothing (strokes stay inside the canvas by layout). */
export function strokesBounds(strokes: Stroke[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const r = s.size / 2, pts: number[][] = [s.start, ...s.segments.map(g => [g[4]!, g[5]!])];
    for (const [x, y] of pts) { x0 = Math.min(x0, x! - r); y0 = Math.min(y0, y! - r); x1 = Math.max(x1, x! + r); y1 = Math.max(y1, y! + r); }
  }
  return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}
export const inset = (r: Rect, by: number): Rect => [r[0] + by, r[1] + by, Math.max(1, r[2] - 2 * by), Math.max(1, r[3] - 2 * by)];

const SIZE = 110;
function rows(ox: number, x0: number, x1: number, y0: number, step: number, count: number, color: string, random: () => number, size = SIZE): Stroke[] {
  return Array.from({ length: count }, (_, i) => lineStroke([ox + x0, y0 + step * i], [ox + x1, y0 + step * i], size, color, random));
}
function columns(ox: number, y0: number, y1: number, x0: number, step: number, count: number, color: string, random: () => number): Stroke[] {
  return Array.from({ length: count }, (_, i) => lineStroke([ox + x0 + step * i, y0], [ox + x0 + step * i, y1], SIZE, color, random));
}

/** The three panels' strokes and measuring zones, one column of the canvas each. Pure and deterministic. */
export type Variant = { opacity?: number; flow?: number; secondOpacity?: number; secondRepeat?: number };
/** Named variants (--variant): default full strength; glaze = every stroke at 0.35 opacity and flow; layered = the second colour
 * (the blue, the blending rows, the red) repeated 3 times at opacity 0.3, flow 1, the first colour at full strength. */
export const VARIANTS: Record<string, Variant> = { default: {}, glaze: { opacity: 0.35, flow: 0.35 }, layered: { secondOpacity: 0.3, secondRepeat: 3 } };

/** Applies a variant to a built layout: every stroke's opacity and flow, and the second pass of each panel repeated. */
export function applyVariant(panels: PanelPlan[], v: Variant): PanelPlan[] {
  const set = (strokes: Stroke[], opacity?: number, flow?: number) => strokes.map(s => ({ ...s, opacity: opacity ?? s.opacity, flow: flow ?? s.flow }));
  return panels.map(panel => ({ ...panel, passes: panel.passes.map((pass, i) => {
    let strokes = set(pass.strokes, v.opacity, v.flow);
    if (i === 1) strokes = Array.from({ length: v.secondRepeat ?? 1 }, () => set(strokes, v.secondOpacity)).flat();
    return { ...pass, strokes };
  }) }));
}

export function buildLayout(canvas = CANVAS, variant: Variant = {}): PanelPlan[] {
  return applyVariant(baseLayout(canvas), variant);
}
function baseLayout(canvas: typeof CANVAS): PanelPlan[] {
  const w = Math.floor(canvas.width / 3);
  const col = (i: number): Rect => [i * w, 0, w, canvas.height];

  // 1. Blue into yellow: a yellow band, then ultramarine dragged down across its right half (the strokes run past the band).
  const r1 = rng(101), o1 = col(0)[0];
  const yellow = rows(o1, 100, 900, 500, 70, 15, COLOURS.yellow, r1);
  const blue = columns(o1, 400, 1600, 500, 70, 6, COLOURS.ultramarine, r1);
  const overlap1 = inset(intersect(strokesBounds(yellow), strokesBounds(blue))!, SIZE / 2);

  // 2. Sunset sky: deep blue rows at the top, orange rows at the bottom, then blending rows alternating the two across the middle third.
  const r2 = rng(202), o2 = col(1)[0];
  const top = rows(o2, 100, 900, 100, 65, 10, COLOURS.deepBlue, r2);
  const bottom = rows(o2, 100, 900, 1315, 65, 10, COLOURS.orange, r2);
  const blend = Array.from({ length: 11 }, (_, k) => lineStroke(k % 2 ? [o2 + 900, 720 + 60 * k] : [o2 + 100, 720 + 60 * k], k % 2 ? [o2 + 100, 720 + 60 * k] : [o2 + 900, 720 + 60 * k],
    100, k % 2 ? COLOURS.orange : COLOURS.deepBlue, r2));
  const x2 = o2 + 150;

  // 3. Red over green: a green patch, then red rows over its right half.
  const r3 = rng(303), o3 = col(2)[0];
  const green = rows(o3, 150, 850, 500, 70, 15, COLOURS.green, r3);
  const red = rows(o3, 500, 850, 535, 70, 14, COLOURS.red, r3);
  const overlap3 = inset(intersect(strokesBounds(green), strokesBounds(red))!, SIZE / 2);

  return [
    { id: 'blue-into-yellow', title: 'BLUE INTO YELLOW', column: col(0), zones: { overlap: overlap1 },
      passes: [{ name: 'Yellow band', strokes: yellow }, { name: 'Blue dragged across', strokes: blue }] },
    { id: 'sunset-sky', title: 'SUNSET SKY', column: col(1),
      zones: { top: [x2, 150, 700, 300], middle: [x2, 800, 700, 400], bottom: [x2, 1550, 700, 300] },
      passes: [{ name: 'Blue top, orange bottom', strokes: [...top, ...bottom] }, { name: 'Blending strokes', strokes: blend }] },
    { id: 'red-over-green', title: 'RED OVER GREEN', column: col(2), zones: { overlap: overlap3 },
      passes: [{ name: 'Green patch', strokes: green }, { name: 'Red over half', strokes: red }] },
  ];
}

// ---- colour metrics ----

export type Image = { width: number; height: number; data: Uint8Array | Buffer };
/** r, g, b in 0-255 to hue in degrees [0,360), HSV saturation 0-1, HSL lightness 0-1. */
export function hsvl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d > 0) h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, l: (max + min) / 2 };
}

export type ZoneStats = { pixels: number; meanHue: number; meanSaturation: number; meanLightness: number;
  greenShare: number; greenMeanSaturation: number | null };
/** Statistics of a rectangle: circular mean hue over the coloured pixels (saturation at least MIN_SATURATION; 0 when none),
 * mean HSV saturation and HSL lightness over all pixels, and the share of pixels with hue in GREEN_HUE (coloured ones only)
 * with their mean saturation. */
export function zoneStats(image: Image, rect: Rect): ZoneStats {
  const [rx, ry, rw, rh] = rect;
  let n = 0, sat = 0, light = 0, sx = 0, sy = 0, coloured = 0, green = 0, greenSat = 0;
  for (let y = Math.max(0, ry); y < Math.min(image.height, ry + rh); y++) {
    for (let x = Math.max(0, rx); x < Math.min(image.width, rx + rw); x++) {
      const i = (y * image.width + x) * 4, p = hsvl(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!);
      n++; sat += p.s; light += p.l;
      if (p.s < MIN_SATURATION) continue;
      coloured++; sx += Math.cos(p.h * Math.PI / 180); sy += Math.sin(p.h * Math.PI / 180);
      if (p.h >= GREEN_HUE[0] && p.h <= GREEN_HUE[1]) { green++; greenSat += p.s; }
    }
  }
  const hue = coloured ? ((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360 : 0;
  return { pixels: n, meanHue: hue, meanSaturation: n ? sat / n : 0, meanLightness: n ? light / n : 0,
    greenShare: n ? green / n : 0, greenMeanSaturation: green ? greenSat / green : null };
}

export type PanelMetrics = Json;
/** The numbers of one panel of a result image, by its layout's zones. */
export function panelMetrics(image: Image, panel: PanelPlan): PanelMetrics {
  if (panel.id === 'sunset-sky') {
    const top = zoneStats(image, panel.zones.top!), middle = zoneStats(image, panel.zones.middle!), bottom = zoneStats(image, panel.zones.bottom!);
    const ends = (top.meanSaturation + bottom.meanSaturation) / 2;
    return { top, middle, bottom, endsSaturation: ends, saturationDrop: ends - middle.meanSaturation, saturationDropShare: ends > 0 ? (ends - middle.meanSaturation) / ends : 0 };
  }
  const overlap = zoneStats(image, panel.zones.overlap!);
  return panel.id === 'blue-into-yellow' ? { overlap, greenShare: overlap.greenShare, greenMeanSaturation: overlap.greenMeanSaturation } : { overlap };
}

// ---- sheet (PNG out, JPEG by the system converter) ----

const FONT: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110', E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001', I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000', Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100', U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111', '-': '00000 00000 00000 11111 00000 00000 00000',
};
export const textWidth = (text: string, scale: number) => text.length * 6 * scale - scale;

export function drawText(image: Image & { data: Uint8Array }, x: number, y: number, text: string, scale: number, rgb: [number, number, number]) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch]?.split(' ');
    if (glyph) for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (glyph[gy]![gx] === '1')
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = cx + gx * scale + dx, py = y + gy * scale + dy;
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        const i = (py * image.width + px) * 4; image.data[i] = rgb[0]; image.data[i + 1] = rgb[1]; image.data[i + 2] = rgb[2]; image.data[i + 3] = 255;
      }
    cx += 6 * scale;
  }
}

/** Box-average `rect` of `source` into the `into` rectangle of `target` (a reduction by a whole or fractional factor). */
export function blitScaled(target: Image & { data: Uint8Array }, source: Image, rect: Rect, at: [number, number], scale: number) {
  const tw = Math.floor(rect[2] * scale), th = Math.floor(rect[3] * scale), k = 1 / scale;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const sx0 = rect[0] + Math.floor(tx * k), sy0 = rect[1] + Math.floor(ty * k), sx1 = Math.max(sx0 + 1, rect[0] + Math.floor((tx + 1) * k)), sy1 = Math.max(sy0 + 1, rect[1] + Math.floor((ty + 1) * k));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { const i = (y * source.width + x) * 4; r += source.data[i]!; g += source.data[i + 1]!; b += source.data[i + 2]!; n++; }
    const o = ((at[1] + ty) * target.width + at[0] + tx) * 4;
    target.data[o] = r / n; target.data[o + 1] = g / n; target.data[o + 2] = b / n; target.data[o + 3] = 255;
  }
}

/** The labelled sheet of one preset: the rgb row above the spectral row, three panels each (a panel's column at `scale`). */
export function composeSheet(images: Record<Model, Image>, panels: PanelPlan[], presetLabel: string, scale = 0.35): Image & { data: Uint8Array } {
  const gap = 14, head = 34, pw = Math.floor(panels[0]!.column[2] * scale), ph = Math.floor(panels[0]!.column[3] * scale);
  const width = gap + panels.length * (pw + gap), band = 30;
  const height = band + MODELS.length * (head + ph + gap) + gap;
  const sheet = { width, height, data: new Uint8Array(width * height * 4).fill(255) };
  drawText(sheet, gap, 8, presetLabel, 2, [20, 20, 20]);
  MODELS.forEach((model, row) => {
    const y = band + row * (head + ph + gap) + gap;
    panels.forEach((panel, col) => {
      const x = gap + col * (pw + gap);
      drawText(sheet, x, y, model.toUpperCase() + ' - ' + panel.title, 2, model === 'rgb' ? [70, 70, 70] : [150, 20, 20]);
      blitScaled(sheet, images[model], panel.column, [x, y + head - 6], scale);
      for (let i = 0; i < pw; i++) for (const yy of [y + head - 7, y + head - 6 + ph]) { const o = (yy * width + x + i) * 4; sheet.data[o] = sheet.data[o + 1] = sheet.data[o + 2] = 120; }
    });
  });
  return sheet;
}

export function encodePng(image: Image): Buffer {
  const { width, height, data } = image, stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const chunk = (kind: string, body: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- report ----

export type Results = Record<string, Record<Model, Record<PanelId, PanelMetrics>>>;
const pct = (v: number) => (v * 100).toFixed(1) + '%', num = (v: number, d = 3) => v.toFixed(d), deg = (v: number) => v.toFixed(0) + '°';

/** Plain-words reading of the numbers, one paragraph per preset and panel, generated from the same numbers. */
export function reading(results: Results): string[] {
  const lines: string[] = [];
  for (const preset of PRESETS) {
    const r = results[preset.slug]; if (!r) continue;
    const by = r.rgb['blue-into-yellow'], bs = r.spectral['blue-into-yellow'];
    const gDiff = bs.greenShare - by.greenShare;
    lines.push(`**${preset.name}, blue into yellow.** Green pixels in the overlap: rgb ${pct(by.greenShare)}, spectral ${pct(bs.greenShare)}. ` +
      (Math.abs(gDiff) < 0.05 ? 'About the same: the two models mix blue and yellow alike here.' : gDiff > 0 ? 'Spectral makes noticeably more green where blue meets yellow, as real paint does; rgb leaves grey or the strokes\' own colours.'
        : 'Rgb makes more green here than spectral.') +
      ` Mean overlap saturation rgb ${num(by.overlap.meanSaturation)}, spectral ${num(bs.overlap.meanSaturation)}; mean hue ${deg(by.overlap.meanHue)} against ${deg(bs.overlap.meanHue)}.`);
    const ys = r.rgb['sunset-sky'], ss = r.spectral['sunset-sky'];
    lines.push(`**${preset.name}, sunset sky.** Saturation drop from the ends to the middle: rgb ${pct(ys.saturationDropShare)} (${num(ys.endsSaturation)} to ${num(ys.middle.meanSaturation)}), ` +
      `spectral ${pct(ss.saturationDropShare)} (${num(ss.endsSaturation)} to ${num(ss.middle.meanSaturation)}). ` +
      (Math.abs(ss.saturationDropShare - ys.saturationDropShare) < 0.05 ? 'The middle is about as grey in both.' : ss.saturationDropShare > ys.saturationDropShare ? 'Spectral goes greyer across the middle than rgb.' : 'Spectral keeps the middle more colourful than rgb: less mud.'));
    const yr = r.rgb['red-over-green'].overlap, sr = r.spectral['red-over-green'].overlap;
    lines.push(`**${preset.name}, red over green.** Overlap saturation rgb ${num(yr.meanSaturation)}, spectral ${num(sr.meanSaturation)}; lightness rgb ${num(yr.meanLightness)}, spectral ${num(sr.meanLightness)}; mean hue ${deg(yr.meanHue)} against ${deg(sr.meanHue)}. ` +
      (Math.abs(sr.meanSaturation - yr.meanSaturation) < 0.05 && Math.abs(sr.meanLightness - yr.meanLightness) < 0.04 ? 'Close to the same result.' : 'The two models give visibly different overlaps.'));
  }
  return lines;
}

export function reportMarkdown(results: Results, meta: Json): string {
  const out = ['# Wet-into-wet colour mixing showcase', '',
    `Run ${meta.date}, build ${meta.build ?? 'unknown'}. Fresh ${CANVAS.width}x${CANVAS.height} white document per preset and model; each panel is painted on one layer, later passes continue it (same layer, sample_below off).`,
    'Overlap zone = where the two sets of strokes meet, inset by half a brush. Hue is the circular mean over coloured pixels (HSV saturation at least ' + MIN_SATURATION + '); green = hue ' + GREEN_HUE.join('-') + ' degrees.', '', '## Reading', ''];
  out.push(...reading(results).flatMap(l => [l, '']));
  for (const preset of PRESETS) {
    const r = results[preset.slug]; if (!r) continue;
    out.push(`## ${preset.name}`, '', `![${preset.name}](showcase-${preset.slug}.jpg)`, '',
      '| panel | measure | rgb | spectral |', '|---|---|---|---|');
    const row = (panel: string, measure: string, a: string, b: string) => out.push(`| ${panel} | ${measure} | ${a} | ${b} |`);
    const a = r.rgb['blue-into-yellow'], b = r.spectral['blue-into-yellow'];
    row('blue into yellow', 'overlap mean hue', deg(a.overlap.meanHue), deg(b.overlap.meanHue));
    row('', 'overlap mean saturation', num(a.overlap.meanSaturation), num(b.overlap.meanSaturation));
    row('', 'green share (75-165 deg)', pct(a.greenShare), pct(b.greenShare));
    row('', 'green pixels mean saturation', a.greenMeanSaturation === null ? 'n/a' : num(a.greenMeanSaturation), b.greenMeanSaturation === null ? 'n/a' : num(b.greenMeanSaturation));
    const c = r.rgb['sunset-sky'], d = r.spectral['sunset-sky'];
    row('sunset sky', 'saturation top / middle / bottom', [c.top, c.middle, c.bottom].map(z => num(z.meanSaturation)).join(' / '), [d.top, d.middle, d.bottom].map(z => num(z.meanSaturation)).join(' / '));
    row('', 'middle mean hue', deg(c.middle.meanHue), deg(d.middle.meanHue));
    row('', 'saturation drop, ends to middle', pct(c.saturationDropShare), pct(d.saturationDropShare));
    const e = r.rgb['red-over-green'].overlap, f = r.spectral['red-over-green'].overlap;
    row('red over green', 'overlap mean hue', deg(e.meanHue), deg(f.meanHue));
    row('', 'overlap mean saturation', num(e.meanSaturation), num(f.meanSaturation));
    row('', 'overlap mean lightness', num(e.meanLightness), num(f.meanLightness));
    out.push('');
  }
  return out.join('\n');
}

// ---- live run ----

async function live(argv: string[]) {
  const args: Record<string, string> = Object.fromEntries(argv.flatMap((a, i) => a.startsWith('--') ? [[a.slice(2), argv[i + 1] ?? 'yes']] : []));
  const url = process.env.KRITA_URL ?? 'http://127.0.0.1:5679';
  const out = resolve(args.out ?? new URL('../../local-notes/benchmarks/colour-mixing/showcase', import.meta.url).pathname);
  const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);
  const variantName = args.variant ?? 'default';
  if (!VARIANTS[variantName]) throw new Error('--variant is one of ' + Object.keys(VARIANTS).join(', '));
  const panels = buildLayout(CANVAS, VARIANTS[variantName]);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  async function health(ms = 10000): Promise<Json> { return await (await fetch(url + '/health', { signal: AbortSignal.timeout(ms) })).json() as Json; }
  async function hang(why: string): Promise<never> {
    // No answer from /health within two minutes: sample the process into the output folder and stop (nothing is killed).
    for (let waited = 0; waited < 120; waited += 10) { try { await health(8000); throw new Error(why + ' (Toska recovered; stopping)'); } catch (e) { if (e instanceof Error && /recovered/.test(e.message)) throw e; } await new Promise(r => setTimeout(r, 2000)); }
    const pid = execFileSync('pgrep', ['-if', 'Toska.app|krita.app'], { encoding: 'utf8' }).split('\n')[0]?.trim();
    if (pid) execFileSync('sample', [pid, '3', '-file', join(out, 'toska-hang-sample.txt')]);
    throw new Error(why + ': Toska stopped answering /health; sample written to ' + join(out, 'toska-hang-sample.txt'));
  }
  async function bridge(action: string, params: Json = {}, timeout = 300): Promise<Json> {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params, timeout }), signal: AbortSignal.timeout((timeout + 30) * 1000) });
      return await response.json() as Json;
    } catch (e) { if (e instanceof Error && /abort|timeout/i.test(e.name + e.message)) return hang(action + ' did not answer'); throw e; }
  }
  let operations = 0;
  const creative = (operation: string, params: Json = {}, session?: string) => bridge('creative', { operation, params, ...(session ? { session_id: session } : {}),
    ...(operation === 'paint_pass' ? { operation_id: `showcase-${stamp}-${++operations}` } : {}) });

  const status = await health();
  if (status.status !== 'ok') throw new Error('Bridge not healthy: ' + JSON.stringify(status));
  const idle = async () => {
    const state = await bridge('health', {}, 20), chat = await creative('health');
    if (chat.session_active) throw new Error('A chat holds a painting session; nothing was painted.');
    if (state.has_canvas) throw new Error('A document is open in Krita; nothing was painted.');
    return chat;
  };
  const chatHealth = await idle();

  await mkdir(out, { recursive: true });
  const results: Results = {}, steps: Json[] = [];
  const images: Record<string, Record<Model, Image>> = {};
  for (const preset of PRESETS) {
    results[preset.slug] = {} as Results[string]; images[preset.slug] = {} as Record<Model, Image>;
    for (const model of MODELS) {
      await idle();
      const session = randomUUID();
      const dir = join(out, 'work', 'benchmark-runs', stamp + '-tool-choice', `showcase-${preset.slug}-${model}-1`, session);
      await mkdir(dir, { recursive: true });
      const begun = await creative('begin', { mode: 'new', name: `Showcase ${preset.slug} ${model}`, width: CANVAS.width, height: CANVAS.height, background: '#ffffff', output_dir: dir }, session);
      if (begun.error) throw new Error('begin: ' + begun.error);
      const png = join(out, `showcase-${preset.slug}-${model}.png`);
      try {
        for (const panel of panels) {
          let layer: string | undefined;
          for (const pass of panel.passes) {
            const started = Date.now();
            const result = await creative('paint_pass', { name: `${panel.title} ${preset.slug}`, preset: preset.name, strokes: pass.strokes, stage_id: 'showcase-' + panel.id,
              sample_below: false, ...(model === 'rgb' ? {} : { mixing_model: model }), ...(layer ? { continue_layer_id: layer } : {}) }, session);
            if (result.error) throw new Error(`${preset.slug} ${model} ${panel.id} ${pass.name}: ${result.error}`);
            layer ??= String(result.layer_id);
            steps.push({ preset: preset.slug, model, panel: panel.id, pass: pass.name, strokes: pass.strokes.length, layer, status: result.status, ms: Date.now() - started, stroke_job: result.stroke_job });
            log(preset.slug, model, panel.id, pass.name, result.status, Date.now() - started, 'ms');
          }
        }
        const saved = await bridge('save', { path: png });
        if (saved.error) throw new Error('save: ' + saved.error);
      } finally {
        const ended = await creative('end', {}, session);
        const closed = await creative('close_benchmark_copy', { path: join(dir, 'painting.kra') });
        await rm(dir, { recursive: true, force: true });
        if (!closed.closed) throw new Error('Krita did not close the showcase document: ' + (closed.error ?? ended.error ?? 'still open'));
      }
      const decoded = decodeRgba(await readFile(png), CANVAS.width * CANVAS.height + 1, { ignoreColour: true });
      if (!decoded || decoded.width !== CANVAS.width || decoded.height !== CANVAS.height) throw new Error('Could not read ' + png + ' (needs an 8-bit PNG of the canvas size).');
      images[preset.slug]![model] = decoded;
      results[preset.slug]![model] = Object.fromEntries(panels.map(p => [p.id, panelMetrics(decoded, p)])) as Record<PanelId, PanelMetrics>;
    }
    const sheet = join(out, `showcase-${preset.slug}.png`);
    await writeFile(sheet, encodePng(composeSheet(images[preset.slug]!, panels, preset.label)));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', sheet, '--out', join(out, `showcase-${preset.slug}.jpg`)], { stdio: 'ignore' });
    await rm(sheet, { force: true });
  }
  const meta = { variant: variantName, date: new Date().toISOString(), build: chatHealth.build?.build_id, krita: chatHealth.krita_version, canvas: CANVAS, bridge: url };
  await writeFile(join(out, 'numbers.json'), JSON.stringify({ ...meta, zones: Object.fromEntries(panels.map(p => [p.id, p.zones])), results, steps }, null, 2));
  await writeFile(join(out, 'report.md'), reportMarkdown(results, meta));
  await rm(join(out, 'work'), { recursive: true, force: true });
  log('wrote', out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  live(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
