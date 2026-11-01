/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPaintMix.h"

#include <cstring>

namespace KisPaintMix {

namespace {
struct ModelName { Model model; const char *id; };
const ModelName modelNames[] = {
    {Model::Rgb, "rgb"},
    {Model::Spectral, "spectral"},
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

namespace detail {
Rgb spectralMix2(Rgb a, Rgb b, float t);
Rgb spectralMixMany(const Rgb *colours, const float *weights, int n);
}

Rgb mix2(Model m, Rgb a, Rgb b, float t)
{
    // Unmixed colours are exact in every model, before any transform.
    if (t == 0.0f || a == b) return a;
    if (t == 1.0f) return b;

    switch (m) {
    case Model::Spectral:
        return detail::spectralMix2(a, b, t);
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

    switch (m) {
    case Model::Spectral:
        return detail::spectralMixMany(colours, weights, n);
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
