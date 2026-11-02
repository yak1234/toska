// SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
// Colour difference for the transfer's paint set (colour-mixing task 7d): sRGB (0-1, encoded) to CIELAB under D65, and
// CIEDE2000 (ΔE00) exactly as G. Sharma, W. Wu and E. N. Dalal give it ("The CIEDE2000 Color-Difference Formula:
// Implementation Notes, Supplementary Test Data, and Mathematical Observations", Color Research and Application 30(1),
// 2005), with kL = kC = kH = 1. tests/paint-set.test.ts holds it to their 34 published test pairs.
import type { Rgb } from './mix.ts';

export type Lab = [number, number, number];

// D65 reference white (CIE 1931 2°), as XYZ with Y = 1.
const XN = 0.95047, YN = 1, ZN = 1.08883;
const EPSILON = 216 / 24389, KAPPA = 24389 / 27;

const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const labF = (t: number) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

/** An encoded sRGB colour (components 0-1) in CIELAB, D65. */
export function srgbToLab(rgb: Rgb): Lab {
  const r = decode(rgb[0]), g = decode(rgb[1]), b = decode(rgb[2]);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const fx = labF(x / XN), fy = labF(y / YN), fz = labF(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const DEG = Math.PI / 180;
const POW25_7 = Math.pow(25, 7);
const pow7 = (x: number) => { const x2 = x * x; return x2 * x2 * x2 * x; };
/** Hue angle in degrees, 0-360; 0 for a neutral. */
const hue = (b: number, a: number) => { if (b === 0 && a === 0) return 0; const h = Math.atan2(b, a) / DEG; return h < 0 ? h + 360 : h; };

/** The lightness term's weighting S_L at mean lightness Lbar. ΔE00 >= |ΔL| / S_L (the other terms add c^2 + h^2 + RT c h,
 * never negative as |RT| <= 2), so the paint search skips mixes this bound already rules out. */
export function lightnessWeight(Lbar: number): number {
  const Lm = (Lbar - 50) * (Lbar - 50);
  return 1 + (0.015 * Lm) / Math.sqrt(20 + Lm);
}

/** CIEDE2000 between (L1, a1, b1) and (L2, a2, b2), scalar arguments so the paint search allocates nothing. */
export function deltaE00Scalar(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  const C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2), Cbar7 = pow7((C1 + C2) / 2);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p, product = C1p * C2p;
  let dhp = 0;
  if (product !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(product) * Math.sin((dhp / 2) * DEG);
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (product !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbarp - 30) * DEG) + 0.24 * Math.cos(2 * hbarp * DEG)
    + 0.32 * Math.cos((3 * hbarp + 6) * DEG) - 0.20 * Math.cos((4 * hbarp - 63) * DEG);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = pow7(Cbarp), RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));
  const SL = lightnessWeight((L1 + L2) / 2), SC = 1 + 0.045 * Cbarp, SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * DEG) * RC;
  const l = dLp / SL, c = dCp / SC, h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

/** A lower bound on ΔE00, cheap enough to skip most of a search: ΔE00^2 = l^2 + c^2 + h^2 + RT c h with |RT| <= 2 sin 60°
 * (Δθ <= 30°, R_C <= 2), so ΔE00^2 >= l^2 + CHROMA_HUE_SHARE (c^2 + h^2); c^2 + h^2 >= (Δa'^2 + Δb^2) / max(S_C, S_H)^2,
 * with Δa' = (1 + G) Δa >= Δa, S_H <= S_C (T <= 1.93) and C̄' <= 1.5 (C1 + C2) / 2 (G <= 0.5), so
 *   ΔE00^2 >= (ΔL / S_L)^2 + CHROMA_HUE_SHARE (Δa^2 + Δb^2) / (1 + 0.03375 (C1 + C2))^2. */
export const CHROMA_HUE_SHARE = 1 - Math.sin(60 * DEG);
export function deltaE00LowerBound(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  const l = (L2 - L1) / lightnessWeight((L1 + L2) / 2), da = a2 - a1, db = b2 - b1, scale = 1 + 0.03375 * (Math.hypot(a1, b1) + Math.hypot(a2, b2));
  return Math.sqrt(l * l + (CHROMA_HUE_SHARE * (da * da + db * db)) / (scale * scale));
}

/** CIEDE2000 between two CIELAB colours. */
export function deltaE00(lab1: Lab, lab2: Lab): number {
  return deltaE00Scalar(lab1[0], lab1[1], lab1[2], lab2[0], lab2[1], lab2[2]);
}

/** CIEDE2000 between two encoded sRGB colours (components 0-1). */
export function deltaE00Rgb(a: Rgb, b: Rgb): number {
  return deltaE00(srgbToLab(a), srgbToLab(b));
}
