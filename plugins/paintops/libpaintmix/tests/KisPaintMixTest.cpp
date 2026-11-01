/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPaintMixTest.h"

#include <KisPaintMix.h>

#include <cmath>
#include <cstring>
#include <random>

using namespace KisPaintMix;

namespace {

bool bitwiseEqual(Rgb a, Rgb b)
{
    return std::memcmp(&a, &b, sizeof(Rgb)) == 0;
}

Rgb randomRgb(std::mt19937 &gen)
{
    std::uniform_real_distribution<float> d(0.0f, 1.0f);
    return {d(gen), d(gen), d(gen)};
}

const Model allModels[] = {Model::Rgb, Model::Spectral};

// Test-local copy of libmypaint 1.6.1 mix_colors (helpers.c 521-600) with powf, as the reference for fastpow.
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
const float REF_EPSILON = 0.001f;

void refRgbToSpectral(float r, float g, float b, float *spectral)
{
    const float offset = 1.0f - REF_EPSILON;
    r = r * offset + REF_EPSILON;
    g = g * offset + REF_EPSILON;
    b = b * offset + REF_EPSILON;
    for (int i = 0; i < 10; i++) {
        spectral[i] = spectral_r_small[i] * r + spectral_g_small[i] * g + spectral_b_small[i] * b;
    }
}

void refSpectralToRgb(const float *spectral, float *rgb)
{
    const float offset = 1.0f - REF_EPSILON;
    float tmp[3] = {0, 0, 0};
    for (int i = 0; i < 10; i++) {
        for (int c = 0; c < 3; c++) tmp[c] += T_MATRIX_SMALL[c][i] * spectral[i];
    }
    for (int c = 0; c < 3; c++) {
        const float v = (tmp[c] - REF_EPSILON) / offset;
        rgb[c] = v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
    }
}

// mix_colors(a, b, fac, paint_mode = 1) with both alphas 1: sfac_a = fac
Rgb refMix(Rgb a, Rgb b, float fac)
{
    float sa[10], sb[10], s[10], out[3];
    refRgbToSpectral(a.r, a.g, a.b, sa);
    refRgbToSpectral(b.r, b.g, b.b, sb);
    for (int i = 0; i < 10; i++) s[i] = powf(sa[i], fac) * powf(sb[i], 1.0f - fac);
    refSpectralToRgb(s, out);
    return {out[0], out[1], out[2]};
}

}

void KisPaintMixTest::testModelIds()
{
    QVERIFY(modelFromId("spectral").has_value());
    QVERIFY(*modelFromId("spectral") == Model::Spectral);
    QVERIFY(!modelFromId("Spectral").has_value());
    QVERIFY(!modelFromId("").has_value());
    for (Model m : allModels) {
        const auto back = modelFromId(modelId(m));
        QVERIFY(back.has_value());
        QVERIFY(*back == m);
    }
}

void KisPaintMixTest::testRgbIsPlainLerp()
{
    std::mt19937 gen(12345);
    for (int i = 0; i < 100; i++) {
        const Rgb a = randomRgb(gen);
        const Rgb b = randomRgb(gen);
        const Rgb m = mix2(Model::Rgb, a, b, 0.25f);
        const float dr = b.r - a.r, dg = b.g - a.g, db = b.b - a.b;
        const float er = dr * 0.25f, eg = dg * 0.25f, eb = db * 0.25f;
        QCOMPARE(m.r, a.r + er);
        QCOMPARE(m.g, a.g + eg);
        QCOMPARE(m.b, a.b + eb);
    }
}

void KisPaintMixTest::testUnmixedColoursRoundTripExactly()
{
    std::mt19937 gen(777);
    for (Model m : allModels) {
        for (int i = 0; i < 20; i++) {
            const Rgb a = randomRgb(gen);
            const Rgb b = randomRgb(gen);
            QVERIFY(bitwiseEqual(mix2(m, a, b, 0.0f), a));
            QVERIFY(bitwiseEqual(mix2(m, a, b, 1.0f), b));
            QVERIFY(bitwiseEqual(mix2(m, a, a, 0.4f), a));

            const Rgb cs[3] = {randomRgb(gen), b, randomRgb(gen)};
            const float w[3] = {0.0f, 2.0f, 0.0f};
            QVERIFY(bitwiseEqual(mixMany(m, cs, w, 3), cs[1]));
        }
    }
}

void KisPaintMixTest::testSpectralBlueYellowIsGreen()
{
    const Rgb blue{0.0f / 255, 33.0f / 255, 133.0f / 255};
    const Rgb yellow{252.0f / 255, 211.0f / 255, 0.0f / 255};
    const Rgb m = mix2(Model::Spectral, blue, yellow, 0.5f);
    // Expected tuple is the output of libmypaint's mix_colors (the authority), see testSpectralMatchesLibmypaint.
    QVERIFY2(std::fabs(m.r * 255 - 16) <= 2, qPrintable(QString::number(m.r * 255)));
    QVERIFY2(std::fabs(m.g * 255 - 94) <= 2, qPrintable(QString::number(m.g * 255)));
    QVERIFY2(std::fabs(m.b * 255 - 33) <= 2, qPrintable(QString::number(m.b * 255)));
}

void KisPaintMixTest::testSpectralMatchesLibmypaint()
{
    std::mt19937 gen(4242);
    std::uniform_real_distribution<float> td(0.05f, 0.95f);
    for (int i = 0; i < 64; i++) {
        const Rgb a = randomRgb(gen);
        const Rgb b = randomRgb(gen);
        const float t = td(gen);
        const Rgb got = mix2(Model::Spectral, a, b, t);
        const Rgb ref = refMix(b, a, t); // refMix's fac weights its first argument: b's share is t
        QVERIFY2(std::fabs(got.r - ref.r) < 2e-3f, qPrintable(QString::number(i)));
        QVERIFY2(std::fabs(got.g - ref.g) < 2e-3f, qPrintable(QString::number(i)));
        QVERIFY2(std::fabs(got.b - ref.b) < 2e-3f, qPrintable(QString::number(i)));
    }
}

SIMPLE_TEST_MAIN(KisPaintMixTest)
