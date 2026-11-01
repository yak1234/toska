/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISPAINTMIX_H
#define KISPAINTMIX_H

#include <optional>
#include <string_view>

/**
 * Colour mixing models as pure functions. Inputs and outputs are straight, sRGB-encoded components in 0..1.
 * Unmixed colours are exact: t == 0, t == 1, a == b, or a single non-zero weight returns the input bit for bit.
 */
namespace KisPaintMix {

enum class Model { Rgb, Spectral };

struct Rgb {
    float r, g, b;
};

inline bool operator==(const Rgb &a, const Rgb &b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
inline bool operator!=(const Rgb &a, const Rgb &b) { return !(a == b); }

const char *modelId(Model m);
std::optional<Model> modelFromId(std::string_view id);

/// t is b's share: t == 0 gives a, t == 1 gives b.
Rgb mix2(Model m, Rgb a, Rgb b, float t);

/// Weighted mix of n colours; weights are normalised, negative weights count as zero, n <= 0 or all-zero gives black.
Rgb mixMany(Model m, const Rgb *colours, const float *weights, int n);

/// libmypaint's ten-band spectral upsampling (rgb_to_spectral, assigning) and its inverse (spectral_to_rgb).
void toSpectrum(Rgb c, float out[10]);
Rgb fromSpectrum(const float s[10]);

}

#endif // KISPAINTMIX_H
