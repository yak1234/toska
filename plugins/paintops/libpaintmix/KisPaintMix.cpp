/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPaintMix.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace KisPaintMix {

namespace {
struct ModelName { Model model; const char *id; };
const ModelName modelNames[] = {
    {Model::Rgb, "rgb"},
    {Model::LinearLight, "linear"},
    {Model::Perceptual, "perceptual"},
    {Model::Spectral, "spectral"},
    {Model::Pigment, "pigment"},
};
}

const char *modelId(Model m)
{
    for (const ModelName &n : modelNames) {
        if (n.model == m) return n.id;
    }
    return "rgb";
}

std::optional<Model> modelFromId(std::string_view id)
{
    for (const ModelName &n : modelNames) {
        if (id == n.id) return n.model;
    }
    return std::nullopt;
}

namespace {

float decodeSrgb(float v)
{
    return v <= 0.04045f ? v / 12.92f : std::pow((v + 0.055f) / 1.055f, 2.4f);
}

float encodeSrgb(float v)
{
    return v <= 0.0031308f ? v * 12.92f : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
}

float clamp01(float v)
{
    return std::min(1.0f, std::max(0.0f, v));
}

struct Lab { float l, a, b; };

// Realistic Paint Studio's tuned Lab, in floats without 8-bit rounding. XYZ is raised to 2/3 before the usual Lab
// transform and to 3/2 after its inverse, which darkens and desaturates the middle of a mix.
const float kWhiteX = 0.95047f;
const float kWhiteZ = 1.08883f;
const float kEpsilon = 0.008856f;

float labF(float t)
{
    return t > kEpsilon ? std::cbrt(t) : 7.787f * t + 16.0f / 116.0f;
}

float labFInverse(float f)
{
    const float cubed = f * f * f;
    return cubed > kEpsilon ? cubed : (f - 16.0f / 116.0f) / 7.787f;
}

Lab toTunedLab(Rgb c)
{
    const float r = decodeSrgb(c.r), g = decodeSrgb(c.g), b = decodeSrgb(c.b);
    const float x = (0.4124564f * r + 0.3575761f * g + 0.1804375f * b) / kWhiteX;
    const float y = 0.2126729f * r + 0.7151522f * g + 0.0721750f * b;
    const float z = (0.0193339f * r + 0.1191920f * g + 0.9503041f * b) / kWhiteZ;
    const float fx = labF(std::pow(std::max(x, 0.0f), 2.0f / 3.0f));
    const float fy = labF(std::pow(std::max(y, 0.0f), 2.0f / 3.0f));
    const float fz = labF(std::pow(std::max(z, 0.0f), 2.0f / 3.0f));
    return {116.0f * fy - 16.0f, 500.0f * (fx - fy), 200.0f * (fy - fz)};
}

Rgb fromTunedLab(Lab c)
{
    const float fy = (c.l + 16.0f) / 116.0f;
    const float fx = fy + c.a / 500.0f;
    const float fz = fy - c.b / 200.0f;
    const float x = std::pow(std::max(labFInverse(fx), 0.0f), 1.5f) * kWhiteX;
    const float y = std::pow(std::max(labFInverse(fy), 0.0f), 1.5f);
    const float z = std::pow(std::max(labFInverse(fz), 0.0f), 1.5f) * kWhiteZ;
    const float r = 3.2404542f * x - 1.5371385f * y - 0.4985314f * z;
    const float g = -0.9692660f * x + 1.8760108f * y + 0.0415560f * z;
    const float b = 0.0556434f * x - 0.2040259f * y + 1.0572252f * z;
    return {clamp01(encodeSrgb(clamp01(r))), clamp01(encodeSrgb(clamp01(g))), clamp01(encodeSrgb(clamp01(b)))};
}

Rgb linearMix2(Rgb a, Rgb b, float t)
{
    const float u = 1.0f - t;
    return {encodeSrgb(decodeSrgb(a.r) * u + decodeSrgb(b.r) * t),
            encodeSrgb(decodeSrgb(a.g) * u + decodeSrgb(b.g) * t),
            encodeSrgb(decodeSrgb(a.b) * u + decodeSrgb(b.b) * t)};
}

Rgb perceptualMix2(Rgb a, Rgb b, float t)
{
    const Lab la = toTunedLab(a), lb = toTunedLab(b);
    const float u = 1.0f - t;
    return fromTunedLab({la.l * u + lb.l * t, la.a * u + lb.a * t, la.b * u + lb.b * t});
}

}

namespace detail {
Rgb spectralMix2(Rgb a, Rgb b, float t);
Rgb spectralMixMany(const Rgb *colours, const float *weights, int n);
Rgb pigmentMix2(Rgb a, Rgb b, float t);
Rgb pigmentMixMany(const Rgb *colours, const float *weights, int n);
}

Rgb mix2(Model m, Rgb a, Rgb b, float t)
{
    // Unmixed colours are exact in every model, before any transform.
    if (t == 0.0f || a == b) return a;
    if (t == 1.0f) return b;

    switch (m) {
    case Model::Spectral:
        return detail::spectralMix2(a, b, t);
    case Model::Pigment:
        return detail::pigmentMix2(a, b, t);
    case Model::LinearLight:
        return linearMix2(a, b, t);
    case Model::Perceptual:
        return perceptualMix2(a, b, t);
    case Model::Rgb:
        break;
    }
    // Written as separate statements so the compiler cannot fuse them differently from the plain formula.
    const float dr = b.r - a.r;
    const float dg = b.g - a.g;
    const float db = b.b - a.b;
    const float er = dr * t;
    const float eg = dg * t;
    const float eb = db * t;
    return {a.r + er, a.g + eg, a.b + eb};
}

Rgb mixMany(Model m, const Rgb *colours, const float *weights, int n)
{
    if (n <= 0 || !colours || !weights) return {0.0f, 0.0f, 0.0f};

    float sum = 0.0f;
    int nonZero = 0;
    int last = 0;
    for (int i = 0; i < n; ++i) {
        if (weights[i] > 0.0f) {
            sum += weights[i];
            ++nonZero;
            last = i;
        }
    }
    if (nonZero == 0) return {0.0f, 0.0f, 0.0f};
    if (nonZero == 1) return colours[last];
    if (nonZero == 2) {
        // Two colours are exactly mix2, so the two entry points agree in every model (the spectral many-colour path
        // uses a different fast approximation).
        int first = 0;
        while (!(weights[first] > 0.0f)) ++first;
        return mix2(m, colours[first], colours[last], weights[last] / sum);
    }

    switch (m) {
    case Model::Spectral:
        return detail::spectralMixMany(colours, weights, n);
    case Model::Pigment:
        return detail::pigmentMixMany(colours, weights, n);
    case Model::LinearLight: {
        float r = 0.0f, g = 0.0f, b = 0.0f;
        for (int i = 0; i < n; ++i) {
            if (weights[i] > 0.0f) {
                const float w = weights[i] / sum;
                r += decodeSrgb(colours[i].r) * w;
                g += decodeSrgb(colours[i].g) * w;
                b += decodeSrgb(colours[i].b) * w;
            }
        }
        return {encodeSrgb(r), encodeSrgb(g), encodeSrgb(b)};
    }
    case Model::Perceptual: {
        Lab acc{0.0f, 0.0f, 0.0f};
        for (int i = 0; i < n; ++i) {
            if (weights[i] > 0.0f) {
                const float w = weights[i] / sum;
                const Lab l = toTunedLab(colours[i]);
                acc.l += l.l * w;
                acc.a += l.a * w;
                acc.b += l.b * w;
            }
        }
        return fromTunedLab(acc);
    }
    case Model::Rgb:
        break;
    }
    float r = 0.0f, g = 0.0f, b = 0.0f;
    for (int i = 0; i < n; ++i) {
        if (weights[i] > 0.0f) {
            const float w = weights[i] / sum;
            r += colours[i].r * w;
            g += colours[i].g * w;
            b += colours[i].b * w;
        }
    }
    return {r, g, b};
}

}
