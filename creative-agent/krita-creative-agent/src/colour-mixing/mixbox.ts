// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The pigment model: Mixbox 2.0 (Sochorova and Jamriska, "Practical Pigment Mixing for Digital Painting", SIGGRAPH Asia
// 2021), the companion's copy of plugins/paintops/libpaintmix/KisPaintMixMixbox.cpp. A colour maps to the concentrations
// of four primary pigments plus a residual; paints mix as a weighted sum in that latent space, and the pigment polynomial
// maps back. rgbToLatent and latentToRgb follow unpackedFloatRgbToLatent and latentToFloatRgb in Mixbox's
// javascript/mixbox.esm.js (github.com/scrtwpns/mixbox, commit a1bdb75a), in the same order, and every step goes through
// Math.fround as the C++ computes in 32-bit floats. The table and its decoder are in mixbox-data.ts, with Mixbox's
// licence (CC BY-NC 4.0); the polynomial's coefficients below are Mixbox's, in the published order.
import { decompressMixboxLut } from './mixbox-data.ts';
import type { Rgb } from './mix.ts';

/** c: the four pigment concentrations (c3 = 1 - c0 - c1 - c2); residual: what the polynomial misses of the colour. */
export type Latent = { c: [number, number, number, number]; residual: [number, number, number] };

const f = Math.fround;

// eval_polynomial's coefficients (r, g, b per monomial), in the published order:
// c0^3, c1^3, c2^3, c3^3, c0^2 c1, c0 c1^2, c0^2 c2, c0 c2^2, c0^2 c3, c0 c3^2, c1^2 c2, c1 c2^2, c1^2 c3, c1 c3^2,
// c2^2 c3, c2 c3^2, c0 c1 c2, c0 c1 c3, c0 c2 c3, c1 c2 c3.
const COEFFICIENTS: readonly (readonly number[])[] = [
  [+0.07717053, +0.02826978, +0.24832992],
  [+0.95912302, +0.80256528, +0.03561839],
  [+0.74683774, +0.04868586, +0.00000000],
  [+0.99518138, +0.99978149, +0.99704802],
  [+0.04819146, +0.83363781, +0.32515377],
  [-0.68146950, +1.46107803, +1.06980936],
  [+0.27058419, -0.15324870, +1.98735057],
  [+0.80478189, +0.67093710, +0.18424500],
  [-0.35031003, +1.37855826, +3.68865000],
  [+1.05128046, +1.97815239, +2.82989073],
  [+3.21607125, +0.81270228, +1.03384539],
  [+2.78893374, +0.41565549, -0.04487295],
  [+3.02162577, +2.55374103, +0.32766114],
  [+2.95124691, +2.81201112, +1.17578442],
  [+2.82677043, +0.79933038, +1.81715262],
  [+2.99691099, +1.22593053, +1.80653661],
  [+1.87394106, +2.05027182, -0.29835996],
  [+2.56609566, +7.03428198, +0.62575374],
  [+4.08329484, -1.40408358, +2.14995522],
  [+6.00078678, +2.55552042, +1.90739502],
].map(row => row.map(f));

let lut: Uint8Array | null = null;
/** The table, decoded on first use (a few milliseconds). */
function table(): Uint8Array {
  if (!lut) lut = decompressMixboxLut();
  return lut;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function polynomial(c0: number, c1: number, c2: number, c3: number): Rgb {
  const c00 = f(c0 * c0), c11 = f(c1 * c1), c22 = f(c2 * c2), c33 = f(c3 * c3);
  const c01 = f(c0 * c1), c02 = f(c0 * c2), c12 = f(c1 * c2);
  const monomials = [
    c0 * c00, c1 * c11, c2 * c22, c3 * c33,
    c00 * c1, c01 * c1, c00 * c2, c02 * c2, c00 * c3, c0 * c33,
    c11 * c2, c1 * c22, c11 * c3, c1 * c33, c22 * c3, c2 * c33,
    c01 * c2, c01 * c3, c02 * c3, c12 * c3,
  ];
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 20; i++) {
    const w = f(monomials[i]!);
    const k = COEFFICIENTS[i]!;
    r = f(r + f(k[0]! * w));
    g = f(g + f(k[1]! * w));
    b = f(b + f(k[2]! * w));
  }
  return [r, g, b];
}

/** The colour's latent: c from a trilinear lookup of the 64^3 table (components clamped to 0..1), residual the colour
 * minus the polynomial of c. */
export function rgbToLatent(colour: Rgb): Latent {
  const lut = table();
  const r = clamp01(f(colour[0])), g = clamp01(f(colour[1])), b = clamp01(f(colour[2]));
  const x = f(r * 63), y = f(g * 63), z = f(b * 63);
  const ix = Math.trunc(x), iy = Math.trunc(y), iz = Math.trunc(z);
  const tx = f(x - ix), ty = f(y - iy), tz = f(z - iz);
  const ux = f(1 - tx), uy = f(1 - ty), uz = f(1 - tz);
  const xyz = ix + iy * 64 + iz * 64 * 64;

  // The eight corners of the cell: offset into the planes (c0 at +192, c1 at +262336, c2 at +524480) and weight.
  const corners: [number, number][] = [
    [0, f(f(ux * uy) * uz)], [1, f(f(tx * uy) * uz)], [64, f(f(ux * ty) * uz)], [65, f(f(tx * ty) * uz)],
    [4096, f(f(ux * uy) * tz)], [4097, f(f(tx * uy) * tz)], [4160, f(f(ux * ty) * tz)], [4161, f(f(tx * ty) * tz)],
  ];
  let c0 = 0, c1 = 0, c2 = 0;
  for (const [offset, w] of corners) {
    c0 = f(c0 + f(w * lut[xyz + offset + 192]!));
    c1 = f(c1 + f(w * lut[xyz + offset + 262336]!));
    c2 = f(c2 + f(w * lut[xyz + offset + 524480]!));
  }
  const inv255 = f(1 / 255);
  c0 = f(c0 * inv255);
  c1 = f(c1 * inv255);
  c2 = f(c2 * inv255);
  const c3 = f(1 - f(f(c0 + c1) + c2));

  const mixed = polynomial(c0, c1, c2, c3);
  return { c: [c0, c1, c2, c3], residual: [f(r - mixed[0]), f(g - mixed[1]), f(b - mixed[2])] };
}

/** The polynomial of l.c plus l.residual, clamped to 0..1. */
export function latentToRgb(l: Latent): Rgb {
  const rgb = polynomial(l.c[0], l.c[1], l.c[2], l.c[3]);
  return [clamp01(f(rgb[0] + l.residual[0])), clamp01(f(rgb[1] + l.residual[1])), clamp01(f(rgb[2] + l.residual[2]))];
}

function weightedSum(latents: Latent[], weights: number[]): Latent {
  const out: Latent = { c: [0, 0, 0, 0], residual: [0, 0, 0] };
  latents.forEach((l, k) => {
    const w = weights[k]!;
    for (let i = 0; i < 4; i++) out.c[i] = f(out.c[i]! + f(w * l.c[i]!));
    for (let i = 0; i < 3; i++) out.residual[i] = f(out.residual[i]! + f(w * l.residual[i]!));
  });
  return out;
}

/** Mixbox's lerp: (1 - t) * latent(a) + t * latent(b). t is b's share. No short-circuit: mix.ts keeps the exact cases. */
export function pigmentMix2(a: Rgb, b: Rgb, t: number): Rgb {
  return latentToRgb(weightedSum([rgbToLatent(a), rgbToLatent(b)], [f(1 - t), t]));
}

/** The weighted sum of latents, weights normalised; non-positive weights are skipped. */
export function pigmentMixMany(colours: Rgb[], weights: number[]): Rgb {
  let sum = 0;
  for (const w of weights) if (w > 0) sum = f(sum + w);
  const used = colours.map((c, i) => [c, weights[i]!] as const).filter(([, w]) => w > 0);
  return latentToRgb(weightedSum(used.map(([c]) => rgbToLatent(c)), used.map(([, w]) => f(w / sum))));
}
