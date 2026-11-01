/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISPAINTMIX_H
#define KISPAINTMIX_H

#include <cstdint>
#include <optional>
#include <string_view>

/**
 * Colour mixing models as pure functions. Inputs and outputs are straight, sRGB-encoded components in 0..1.
 * Unmixed colours are exact: t == 0, t == 1, a == b, or a single non-zero weight returns the input bit for bit.
 */
namespace KisPaintMix {

enum class Model { Rgb, LinearLight, Perceptual, Spectral };

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

/// Pixel layouts: Bgra8 and Bgra16 are B,G,R,A in native-endian uint8/uint16; RgbaF32 is R,G,B,A in float.
/// Colours are sRGB-encoded and alpha is straight (not premultiplied), as in Krita's RGB colour spaces.
enum class PixelFormat { Bgra8, Bgra16, RgbaF32 };
enum class Blend { Over, Copy };

/**
 * Blends src into dst (count pixels) with the model. Over: a = sa*op + da*(1 - sa*op), t = sa*op / a.
 * Copy: a = da + (sa - da)*op, t = op*sa / (op*sa + (1 - op)*da). Colour is mix2(m, dst, src, t); a < 1e-6 leaves the
 * colour unchanged. With srcIsOneColour, src points at a single pixel used for every dst pixel. opacity is clamped to 0..1.
 */
void blendPixels(Model m, Blend blend, PixelFormat f, uint8_t *dst, const uint8_t *src, bool srcIsOneColour, int count, float opacity);

}

#endif // KISPAINTMIX_H
