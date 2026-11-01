/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
/*
 * Spectral mixing as libmypaint 1.6.1 does it (libmypaint is ISC-licensed, COPYING there).
 * The constants T_MATRIX_SMALL, spectral_r_small, spectral_g_small, spectral_b_small and WGM_EPSILON, and the
 * functions rgb_to_spectral and spectral_to_rgb, are copied from helpers.c lines 39-60 and 521-600; the weighted
 * geometric mean per band is the dab blend of brushmodes.c lines 73-135 (draw_dab_pixels_BlendMode_Normal_Paint).
 */
#include "KisPaintMix.h"
#include "KisPaintMixFastMath.h"

namespace KisPaintMix {

namespace {

// libmypaint helpers.c (WGM_EPSILON, 0.001)
const float WGM_EPSILON = 0.001f;

// libmypaint helpers.c lines 39-60
const float T_MATRIX_SMALL[3][10] = {{0.026595621243689f,0.049779426257903f,0.022449850859496f,-0.218453689278271f
,-0.256894883201278f,0.445881722194840f,0.772365886289756f,0.194498761382537f
,0.014038157587820f,0.007687264480513f}
,{-0.032601672674412f,-0.061021043498478f,-0.052490001018404f
,0.206659098273522f,0.572496335158169f,0.317837248815438f,-0.021216624031211f
,-0.019387668756117f,-0.001521339050858f,-0.000835181622534f}
,{0.339475473216284f,0.635401374177222f,0.771520797089589f,0.113222640692379f
,-0.055251113343776f,-0.048222578468680f,-0.012966666339586f
,-0.001523814504223f,-0.000094718948810f,-0.000051604594741f}};

const float spectral_r_small[10] = {0.009281362787953f,0.009732627042016f,0.011254252737167f,0.015105578649573f
,0.024797924177217f,0.083622585502406f,0.977865045723212f,1.000000000000000f
,0.999961046144372f,0.999999992756822f};

const float spectral_g_small[10] = {0.002854127435775f,0.003917589679914f,0.012132151699187f,0.748259205918013f
,1.000000000000000f,0.865695937531795f,0.037477469241101f,0.022816789725717f
,0.021747419446456f,0.021384940572308f};

const float spectral_b_small[10] = {0.537052150373386f,0.546646402401469f,0.575501819073983f,0.258778829633924f
,0.041709923751716f,0.012662638828324f,0.007485593127390f,0.006766900622462f
,0.006699764779016f,0.006676219883241f};

float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

}

// helpers.c rgb_to_spectral (assigns where libmypaint accumulates into a zeroed array)
void toSpectrum(Rgb c, float out[10])
{
    const float offset = 1.0f - WGM_EPSILON;
    const float r = c.r * offset + WGM_EPSILON;
    const float g = c.g * offset + WGM_EPSILON;
    const float b = c.b * offset + WGM_EPSILON;
    for (int i = 0; i < 10; i++) {
        out[i] = spectral_r_small[i] * r + spectral_g_small[i] * g + spectral_b_small[i] * b;
    }
}

// helpers.c spectral_to_rgb
Rgb fromSpectrum(const float s[10])
{
    const float offset = 1.0f - WGM_EPSILON;
    float tmp[3] = {0, 0, 0};
    for (int i = 0; i < 10; i++) {
        tmp[0] += T_MATRIX_SMALL[0][i] * s[i];
        tmp[1] += T_MATRIX_SMALL[1][i] * s[i];
        tmp[2] += T_MATRIX_SMALL[2][i] * s[i];
    }
    return {clamp01((tmp[0] - WGM_EPSILON) / offset),
            clamp01((tmp[1] - WGM_EPSILON) / offset),
            clamp01((tmp[2] - WGM_EPSILON) / offset)};
}

namespace detail {

// brushmodes.c: spectral_result[i] = fastpow(spectral_a[i], fac_a) * fastpow(spectral_b[i], fac_b)
Rgb spectralMix2(Rgb a, Rgb b, float t)
{
    float sa[10], sb[10], s[10];
    toSpectrum(a, sa);
    toSpectrum(b, sb);
    for (int i = 0; i < 10; i++) {
        s[i] = fastpow(sa[i], 1.0f - t) * fastpow(sb[i], t);
    }
    return fromSpectrum(s);
}

// Weighted geometric mean of n colours: fastpow2(sum w_k * fastlog2(s_k)), weights normalised, non-positive skipped.
Rgb spectralMixMany(const Rgb *colours, const float *weights, int n)
{
    float sum = 0.0f;
    for (int k = 0; k < n; k++) {
        if (weights[k] > 0.0f) sum += weights[k];
    }
    float acc[10] = {0};
    for (int k = 0; k < n; k++) {
        if (!(weights[k] > 0.0f)) continue;
        const float w = weights[k] / sum;
        float sk[10];
        toSpectrum(colours[k], sk);
        for (int i = 0; i < 10; i++) {
            acc[i] += w * fastlog2(sk[i]);
        }
    }
    float s[10];
    for (int i = 0; i < 10; i++) {
        s[i] = fastpow2(acc[i]);
    }
    return fromSpectrum(s);
}

}

}
