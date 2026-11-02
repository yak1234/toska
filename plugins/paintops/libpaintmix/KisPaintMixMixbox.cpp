/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
// The pigment model: Mixbox 2.0 (Sochorova and Jamriska, "Practical Pigment Mixing for Digital Painting", SIGGRAPH Asia
// 2021). A colour maps to the concentrations of four primary pigments plus a residual; paints mix as a weighted sum in
// that latent space, and the pigment polynomial maps back. rgbToLatent and latentToRgb follow float_rgb_to_latent and
// latent_to_float_rgb in Mixbox's cpp/mixbox.cpp (github.com/scrtwpns/mixbox, commit a1bdb75a), step for step and in
// the same order, so the results are the published ones. The table, its decoder and the polynomial's coefficients are
// in KisPaintMixMixboxData.cpp, with Mixbox's licence (CC BY-NC 4.0).
#include "KisPaintMix.h"

namespace KisPaintMix {

namespace detail {
const unsigned char *mixboxLut();
extern const float mixboxCoefficients[20][3];
}

namespace {

inline float clamp01(float x)
{
    return x < 0.0f ? 0.0f : x > 1.0f ? 1.0f : x;
}

// eval_polynomial: the 20 cubic monomials of c0..c3 times the published coefficients, summed in the published order.
inline void polynomial(float c0, float c1, float c2, float c3, float rgb[3])
{
    const float c00 = c0 * c0;
    const float c11 = c1 * c1;
    const float c22 = c2 * c2;
    const float c33 = c3 * c3;
    const float c01 = c0 * c1;
    const float c02 = c0 * c2;
    const float c12 = c1 * c2;

    const float monomials[20] = {
        c0 * c00, c1 * c11, c2 * c22, c3 * c33,
        c00 * c1, c01 * c1, c00 * c2, c02 * c2, c00 * c3, c0 * c33,
        c11 * c2, c1 * c22, c11 * c3, c1 * c33, c22 * c3, c2 * c33,
        c01 * c2, c01 * c3, c02 * c3, c12 * c3,
    };

    float r = 0.0f, g = 0.0f, b = 0.0f;
    for (int i = 0; i < 20; ++i) {
        const float w = monomials[i];
        r += detail::mixboxCoefficients[i][0] * w;
        g += detail::mixboxCoefficients[i][1] * w;
        b += detail::mixboxCoefficients[i][2] * w;
    }
    rgb[0] = r;
    rgb[1] = g;
    rgb[2] = b;
}

inline Latent weighted(const Latent &l, float w)
{
    Latent out;
    for (int i = 0; i < 4; ++i) out.c[i] = w * l.c[i];
    for (int i = 0; i < 3; ++i) out.residual[i] = w * l.residual[i];
    return out;
}

inline void add(Latent &acc, const Latent &l)
{
    for (int i = 0; i < 4; ++i) acc.c[i] += l.c[i];
    for (int i = 0; i < 3; ++i) acc.residual[i] += l.residual[i];
}

}

Latent rgbToLatent(Rgb c)
{
    const float r = clamp01(c.r);
    const float g = clamp01(c.g);
    const float b = clamp01(c.b);

    const float x = r * 63.0f;
    const float y = g * 63.0f;
    const float z = b * 63.0f;

    const int ix = int(x);
    const int iy = int(y);
    const int iz = int(z);

    const float tx = x - float(ix);
    const float ty = y - float(iy);
    const float tz = z - float(iz);

    const unsigned char *const lut = &(detail::mixboxLut()[((ix + iy * 64 + iz * 64 * 64) & 0x3FFFF) * 3]);

    float c0 = 0.0f;
    float c1 = 0.0f;
    float c2 = 0.0f;

    // The eight corners of the cell; the table's grid point (ix, iy, iz) starts at byte 192.
    float w;
    w = (1.0f - tx) * (1.0f - ty) * (1.0f - tz); c0 += w * lut[192];   c1 += w * lut[193];   c2 += w * lut[194];
    w = (tx) * (1.0f - ty) * (1.0f - tz);        c0 += w * lut[195];   c1 += w * lut[196];   c2 += w * lut[197];
    w = (1.0f - tx) * (ty) * (1.0f - tz);        c0 += w * lut[384];   c1 += w * lut[385];   c2 += w * lut[386];
    w = (tx) * (ty) * (1.0f - tz);               c0 += w * lut[387];   c1 += w * lut[388];   c2 += w * lut[389];
    w = (1.0f - tx) * (1.0f - ty) * (tz);        c0 += w * lut[12480]; c1 += w * lut[12481]; c2 += w * lut[12482];
    w = (tx) * (1.0f - ty) * (tz);               c0 += w * lut[12483]; c1 += w * lut[12484]; c2 += w * lut[12485];
    w = (1.0f - tx) * (ty) * (tz);               c0 += w * lut[12672]; c1 += w * lut[12673]; c2 += w * lut[12674];
    w = (tx) * (ty) * (tz);                      c0 += w * lut[12675]; c1 += w * lut[12676]; c2 += w * lut[12677];

    c0 *= (1.0f / 255.0f);
    c1 *= (1.0f / 255.0f);
    c2 *= (1.0f / 255.0f);

    const float c3 = 1.0f - (c0 + c1 + c2);

    float mixed[3];
    polynomial(c0, c1, c2, c3, mixed);

    return {{c0, c1, c2, c3}, {r - mixed[0], g - mixed[1], b - mixed[2]}};
}

Rgb latentToRgb(const Latent &l)
{
    float rgb[3];
    polynomial(l.c[0], l.c[1], l.c[2], l.c[3], rgb);
    return {clamp01(rgb[0] + l.residual[0]), clamp01(rgb[1] + l.residual[1]), clamp01(rgb[2] + l.residual[2])};
}

namespace detail {

// mixbox_lerp_float: (1 - t) * latent(a) + t * latent(b).
Rgb pigmentMix2(Rgb a, Rgb b, float t)
{
    Latent mix = weighted(rgbToLatent(a), 1.0f - t);
    add(mix, weighted(rgbToLatent(b), t));
    return latentToRgb(mix);
}

// Mixbox's multi-colour mixing: the weighted sum of latents, weights normalised (non-positive ones skipped).
Rgb pigmentMixMany(const Rgb *colours, const float *weights, int n)
{
    float sum = 0.0f;
    for (int i = 0; i < n; ++i) {
        if (weights[i] > 0.0f) sum += weights[i];
    }
    Latent mix{{0.0f, 0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}};
    for (int i = 0; i < n; ++i) {
        if (weights[i] > 0.0f) add(mix, weighted(rgbToLatent(colours[i]), weights[i] / sum));
    }
    return latentToRgb(mix);
}

}

}
