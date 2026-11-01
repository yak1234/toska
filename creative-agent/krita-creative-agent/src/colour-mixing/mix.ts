// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// The companion's copy of the colour mixing in plugins/paintops/libpaintmix (KisPaintMix.cpp, KisPaintMixSpectral.cpp,
// KisPaintMixFastMath.h), held to the C++ output by the shared golden file (tests/colour-mixing.test.ts), so the agent's
// mix_colors preview gives the colours the brushes paint. Inputs and outputs are straight, sRGB-encoded components in 0..1.
// Unmixed colours are exact: t == 0, t == 1, a == b, or a single positive weight returns the input before any transform.
// Every arithmetic step goes through Math.fround, because the C++ computes in 32-bit floats.
//
// Spectral constants and functions: libmypaint 1.6.1 (ISC-licensed, COPYING there). T_MATRIX_SMALL, spectral_r_small,
// spectral_g_small, spectral_b_small and WGM_EPSILON, and rgb_to_spectral and spectral_to_rgb, are copied from helpers.c
// lines 39-60 and 521-600; the weighted geometric mean per band is the dab blend of brushmodes.c lines 73-135
// (draw_dab_pixels_BlendMode_Normal_Paint).
//
// fastlog2 and fastpow2 are copied from libmypaint 1.6.1, fastapprox/fastlog.h and fastapprox/fastexp.h
// (fastpow there is fastpow2(p * fastlog2(x))). Original header:
//
//=====================================================================*
//                   Copyright (C) 2011 Paul Mineiro                   *
// All rights reserved.                                                *
//                                                                     *
// Redistribution and use in source and binary forms, with             *
// or without modification, are permitted provided that the            *
// following conditions are met:                                       *
//                                                                     *
//     * Redistributions of source code must retain the                *
//     above copyright notice, this list of conditions and             *
//     the following disclaimer.                                       *
//                                                                     *
//     * Redistributions in binary form must reproduce the             *
//     above copyright notice, this list of conditions and             *
//     the following disclaimer in the documentation and/or            *
//     other materials provided with the distribution.                 *
//                                                                     *
//     * Neither the name of Paul Mineiro nor the names                *
//     of other contributors may be used to endorse or promote         *
//     products derived from this software without specific            *
//     prior written permission.                                       *
//                                                                     *
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND              *
// CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,         *
// INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES               *
// OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE             *
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER               *
// OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,                 *
// INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES            *
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE           *
// GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR                *
// BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF          *
// LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT           *
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY              *
// OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE             *
// POSSIBILITY OF SUCH DAMAGE.                                         *
//                                                                     *
// Contact: Paul Mineiro <paul@mineiro.com>                            *
//=====================================================================*/

export type MixModel = 'rgb' | 'linear' | 'perceptual' | 'spectral';
export type Rgb = [number, number, number];

export const MIX_MODELS: readonly MixModel[] = ['rgb', 'linear', 'perceptual', 'spectral'];

const f = Math.fround;

// ---- fast math (libmypaint fastapprox), through shared views so the bit tricks match the C++ ----
const floatView = new Float32Array(1);
const uintView = new Uint32Array(floatView.buffer);

function bitsOf(x: number): number {
  floatView[0] = x;
  return uintView[0]!;
}

function floatOf(bits: number): number {
  uintView[0] = bits;
  return floatView[0]!;
}

function fastlog2(x: number): number {
  const vi = bitsOf(x);
  const mx = floatOf(((vi & 0x007fffff) | 0x3f000000) >>> 0);
  let y = f(vi);
  y = f(y * f(1.1920928955078125e-7));
  // y - 124.22551499f - 1.498030302f * mx - 1.72587999f / (0.3520887068f + mx), left to right
  const r1 = f(y - f(124.22551499));
  const r2 = f(r1 - f(f(1.498030302) * mx));
  return f(r2 - f(f(1.72587999) / f(f(0.3520887068) + mx)));
}

function fastpow2(p: number): number {
  const offset = p < 0 ? 1 : 0;
  const clipp = p < -126 ? -126 : p;
  const w = Math.trunc(clipp);
  const z = f(f(clipp - w) + offset);
  // (1 << 23) * (clipp + 121.2740575f + 27.7280233f / (4.84252568f - z) - 1.49012907f * z)
  const s1 = f(clipp + f(121.2740575));
  const s2 = f(s1 + f(f(27.7280233) / f(f(4.84252568) - z)));
  const s3 = f(s2 - f(f(1.49012907) * z));
  return floatOf(Math.trunc(f(8388608 * s3)) >>> 0);
}

function fastpow(x: number, p: number): number {
  return fastpow2(f(p * fastlog2(x)));
}

// ---- spectral (libmypaint helpers.c, brushmodes.c) ----
const WGM_EPSILON = f(0.001);

// helpers.c lines 39-60
const T_MATRIX_SMALL: number[][] = [
  [0.026595621243689, 0.049779426257903, 0.022449850859496, -0.218453689278271, -0.256894883201278, 0.445881722194840, 0.772365886289756, 0.194498761382537, 0.014038157587820, 0.007687264480513],
  [-0.032601672674412, -0.061021043498478, -0.052490001018404, 0.206659098273522, 0.572496335158169, 0.317837248815438, -0.021216624031211, -0.019387668756117, -0.001521339050858, -0.000835181622534],
  [0.339475473216284, 0.635401374177222, 0.771520797089589, 0.113222640692379, -0.055251113343776, -0.048222578468680, -0.012966666339586, -0.001523814504223, -0.000094718948810, -0.000051604594741],
].map(row => row.map(f));
const spectral_r_small: number[] = [0.009281362787953, 0.009732627042016, 0.011254252737167, 0.015105578649573, 0.024797924177217, 0.083622585502406, 0.977865045723212, 1.000000000000000, 0.999961046144372, 0.999999992756822].map(f);
const spectral_g_small: number[] = [0.002854127435775, 0.003917589679914, 0.012132151699187, 0.748259205918013, 1.000000000000000, 0.865695937531795, 0.037477469241101, 0.022816789725717, 0.021747419446456, 0.021384940572308].map(f);
const spectral_b_small: number[] = [0.537052150373386, 0.546646402401469, 0.575501819073983, 0.258778829633924, 0.041709923751716, 0.012662638828324, 0.007485593127390, 0.006766900622462, 0.006699764779016, 0.006676219883241].map(f);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function toSpectrum(c: Rgb): number[] {
  const offset = f(1 - WGM_EPSILON);
  const r = f(f(c[0] * offset) + WGM_EPSILON);
  const g = f(f(c[1] * offset) + WGM_EPSILON);
  const b = f(f(c[2] * offset) + WGM_EPSILON);
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    out.push(f(f(f(spectral_r_small[i]! * r) + f(spectral_g_small[i]! * g)) + f(spectral_b_small[i]! * b)));
  }
  return out;
}

function fromSpectrum(s: number[]): Rgb {
  const offset = f(1 - WGM_EPSILON);
  const tmp = [0, 0, 0];
  for (let i = 0; i < 10; i++) {
    for (let k = 0; k < 3; k++) tmp[k] = f(tmp[k]! + f(T_MATRIX_SMALL[k]![i]! * s[i]!));
  }
  return [0, 1, 2].map(k => f(clamp01(f(f(tmp[k]! - WGM_EPSILON) / offset)))) as Rgb;
}

function spectralMix2(a: Rgb, b: Rgb, t: number): Rgb {
  const sa = toSpectrum(a);
  const sb = toSpectrum(b);
  const u = f(1 - t);
  return fromSpectrum(sa.map((v, i) => f(fastpow(v, u) * fastpow(sb[i]!, t))));
}

function spectralMixMany(colours: Rgb[], weights: number[]): Rgb {
  let sum = 0;
  for (const w of weights) if (w > 0) sum = f(sum + w);
  const acc = new Array<number>(10).fill(0);
  colours.forEach((c, k) => {
    if (!(weights[k]! > 0)) return;
    const w = f(weights[k]! / sum);
    const sk = toSpectrum(c);
    for (let i = 0; i < 10; i++) acc[i] = f(acc[i]! + f(w * fastlog2(sk[i]!)));
  });
  return fromSpectrum(acc.map(fastpow2));
}

// ---- sRGB, linear light, tuned Lab (KisPaintMix.cpp) ----
function decodeSrgb(v: number): number {
  return v <= f(0.04045) ? f(v / f(12.92)) : f(Math.pow(f(f(v + f(0.055)) / f(1.055)), f(2.4)));
}

function encodeSrgb(v: number): number {
  return v <= f(0.0031308) ? f(v * f(12.92)) : f(f(f(1.055) * f(Math.pow(v, f(f(1) / f(2.4))))) - f(0.055));
}

const kWhiteX = f(0.95047);
const kWhiteZ = f(1.08883);
const kEpsilon = f(0.008856);
const sixteen116 = f(f(16) / f(116));

function labF(t: number): number {
  return t > kEpsilon ? f(Math.cbrt(t)) : f(f(f(7.787) * t) + sixteen116);
}

function labFInverse(v: number): number {
  const cubed = f(f(v * v) * v);
  return cubed > kEpsilon ? cubed : f(f(v - sixteen116) / f(7.787));
}

type Lab = [number, number, number];

function dot3(m0: number, m1: number, m2: number, r: number, g: number, b: number): number {
  return f(f(f(f(m0) * r) + f(f(m1) * g)) + f(f(m2) * b));
}

function toTunedLab(c: Rgb): Lab {
  const r = decodeSrgb(c[0]), g = decodeSrgb(c[1]), b = decodeSrgb(c[2]);
  const x = f(dot3(0.4124564, 0.3575761, 0.1804375, r, g, b) / kWhiteX);
  const y = dot3(0.2126729, 0.7151522, 0.0721750, r, g, b);
  const z = f(dot3(0.0193339, 0.1191920, 0.9503041, r, g, b) / kWhiteZ);
  const twoThirds = f(f(2) / f(3));
  const fx = labF(f(Math.pow(Math.max(x, 0), twoThirds)));
  const fy = labF(f(Math.pow(Math.max(y, 0), twoThirds)));
  const fz = labF(f(Math.pow(Math.max(z, 0), twoThirds)));
  return [f(f(116 * fy) - 16), f(500 * f(fx - fy)), f(200 * f(fy - fz))];
}

function fromTunedLab(c: Lab): Rgb {
  const fy = f(f(c[0] + 16) / 116);
  const fx = f(fy + f(c[1] / 500));
  const fz = f(fy - f(c[2] / 200));
  const x = f(f(Math.pow(Math.max(labFInverse(fx), 0), 1.5)) * kWhiteX);
  const y = f(Math.pow(Math.max(labFInverse(fy), 0), 1.5));
  const z = f(f(Math.pow(Math.max(labFInverse(fz), 0), 1.5)) * kWhiteZ);
  const r = dot3(3.2404542, -1.5371385, -0.4985314, x, y, z);
  const g = dot3(-0.9692660, 1.8760108, 0.0415560, x, y, z);
  const b = dot3(0.0556434, -0.2040259, 1.0572252, x, y, z);
  return [r, g, b].map(v => clamp01(encodeSrgb(clamp01(v)))) as Rgb;
}

function linearMix2(a: Rgb, b: Rgb, t: number): Rgb {
  const u = f(1 - t);
  return [0, 1, 2].map(k => encodeSrgb(f(f(decodeSrgb(a[k]!) * u) + f(decodeSrgb(b[k]!) * t)))) as Rgb;
}

function perceptualMix2(a: Rgb, b: Rgb, t: number): Rgb {
  const la = toTunedLab(a), lb = toTunedLab(b);
  const u = f(1 - t);
  return fromTunedLab([0, 1, 2].map(k => f(f(la[k]! * u) + f(lb[k]! * t))) as Lab);
}

function sameColour(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** t is b's share: t == 0 gives a, t == 1 gives b. */
export function mix2(model: MixModel, a: Rgb, b: Rgb, t: number): Rgb {
  t = f(t);
  // Unmixed colours are exact in every model, before any transform.
  if (t === 0 || sameColour(a, b)) return [a[0], a[1], a[2]];
  if (t === 1) return [b[0], b[1], b[2]];
  switch (model) {
    case 'spectral': return spectralMix2(a, b, t);
    case 'linear': return linearMix2(a, b, t);
    case 'perceptual': return perceptualMix2(a, b, t);
    case 'rgb': break;
  }
  return [0, 1, 2].map(k => f(a[k]! + f(f(b[k]! - a[k]!) * t))) as Rgb;
}

/** Weighted mix of n colours; weights are normalised, non-positive weights count as zero, none positive gives black. */
export function mixMany(model: MixModel, colours: Rgb[], weights: number[]): Rgb {
  const n = Math.min(colours.length, weights.length);
  let sum = 0, nonZero = 0, first = -1, last = 0;
  for (let i = 0; i < n; i++) {
    if (weights[i]! > 0) {
      sum = f(sum + f(weights[i]!));
      nonZero++;
      if (first < 0) first = i;
      last = i;
    }
  }
  if (nonZero === 0) return [0, 0, 0];
  if (nonZero === 1) return [colours[last]![0], colours[last]![1], colours[last]![2]];
  // Two colours are exactly mix2, so the two entry points agree in every model.
  if (nonZero === 2) return mix2(model, colours[first]!, colours[last]!, f(f(weights[last]!) / sum));

  const cs = colours.slice(0, n), ws = weights.slice(0, n).map(f);
  if (model === 'spectral') return spectralMixMany(cs, ws);
  const acc = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!(ws[i]! > 0)) continue;
    const w = f(ws[i]! / sum);
    const v: number[] = model === 'linear' ? cs[i]!.map(decodeSrgb)
      : model === 'perceptual' ? toTunedLab(cs[i]!) : cs[i]!;
    for (let k = 0; k < 3; k++) acc[k] = f(acc[k]! + f(v[k]! * w));
  }
  if (model === 'linear') return acc.map(encodeSrgb) as Rgb;
  if (model === 'perceptual') return fromTunedLab(acc as Lab);
  return acc as Rgb;
}

/** "#rrggbb" or "rrggbb" to components in 0..1; null when it is not six hex digits. */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Components in 0..1 (clamped) to "#rrggbb". */
export function rgbToHex(c: Rgb): string {
  return '#' + c.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}
