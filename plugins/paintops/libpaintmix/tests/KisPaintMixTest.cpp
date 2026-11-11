/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPaintMixTest.h"

#include <KisPaintMix.h>

#include <KoColorSpace.h>
#include <KoColorSpaceRegistry.h>
#include <KoCompositeOpRegistry.h>
#include <KoCompositeOp.h>
#include <KoColorProfile.h>
#include <KoColorModelStandardIds.h>
#include <compositeops/KoCompositeOpToskaMix.h>

#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <vector>

#include <cmath>
#include <cstring>
#include <random>
#include <memory>
#include <algorithm>

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

const Model allModels[] = {Model::Rgb, Model::LinearLight, Model::Perceptual, Model::Spectral, Model::Pigment};

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
    QVERIFY(modelFromId("pigment").has_value());
    QVERIFY(*modelFromId("pigment") == Model::Pigment);
    QCOMPARE(QString(modelId(Model::Pigment)), QString("pigment"));
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

void KisPaintMixTest::testLinearBlackWhiteHalf()
{
    const Rgb m = mix2(Model::LinearLight, {0, 0, 0}, {1, 1, 1}, 0.5f);
    QVERIFY(std::fabs(m.r - 187.5f / 255) <= 0.5f / 255);
    QVERIFY(std::fabs(m.g - 187.5f / 255) <= 0.5f / 255);
    QVERIFY(std::fabs(m.b - 187.5f / 255) <= 0.5f / 255);
}

void KisPaintMixTest::testPerceptualBlackWhiteHalf()
{
    const Rgb m = mix2(Model::Perceptual, {0, 0, 0}, {1, 1, 1}, 0.5f);
    QVERIFY2(std::fabs(m.r - 79.4f / 255) <= 1.0f / 255, qPrintable(QString::number(m.r * 255)));
    QVERIFY(std::fabs(m.g - 79.4f / 255) <= 1.0f / 255);
    QVERIFY(std::fabs(m.b - 79.4f / 255) <= 1.0f / 255);
}

void KisPaintMixTest::testMixManyEqualsMix2()
{
    std::mt19937 gen(99);
    std::uniform_real_distribution<float> td(0.02f, 0.98f);
    for (Model m : allModels) {
        for (int i = 0; i < 50; i++) {
            const Rgb cs[2] = {randomRgb(gen), randomRgb(gen)};
            const float t = td(gen);
            const float w[2] = {1.0f - t, t};
            const Rgb many = mixMany(m, cs, w, 2);
            const Rgb two = mix2(m, cs[0], cs[1], t);
            const float worst = std::max({std::fabs(many.r - two.r), std::fabs(many.g - two.g), std::fabs(many.b - two.b)});
            QVERIFY2(worst < 1e-6f, qPrintable(QString("%1 %2").arg(modelId(m)).arg(worst)));
        }
    }
}

void KisPaintMixTest::testBlendPixelsRgbMatchesKritaOver()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    QVERIFY(cs);
    const KoCompositeOp *op = cs->compositeOp(COMPOSITE_OVER);
    QVERIFY(op);

    const int n = 1000;
    std::mt19937 gen(31337);
    std::uniform_int_distribution<int> bd(0, 255);
    std::vector<uint8_t> src(n * 4), dstA(n * 4), dstB;
    for (auto &v : src) v = uint8_t(bd(gen));
    for (auto &v : dstA) v = uint8_t(bd(gen));
    dstB = dstA;

    KoCompositeOp::ParameterInfo params;
    params.dstRowStart = dstB.data();
    params.dstRowStride = n * 4;
    params.srcRowStart = src.data();
    params.srcRowStride = n * 4;
    params.maskRowStart = nullptr;
    params.maskRowStride = 0;
    params.rows = 1;
    params.cols = n;
    params.opacity = 1.0f;
    params.flow = 1.0f;
    params.channelFlags = QBitArray();
    op->composite(params);

    blendPixels(Model::Rgb, Blend::Over, PixelFormat::Bgra8, dstA.data(), src.data(), false, n, 1.0f);

    int worst = 0;
    for (int i = 0; i < n; i++) {
        const int sa = src[i * 4 + 3], da = dstB[i * 4 + 3];
        // Krita leaves the colour of a fully transparent result undefined.
        for (int c = 0; c < 4; c++) {
            if (c < 3 && dstB[i * 4 + 3] == 0) continue;
            worst = std::max(worst, std::abs(int(dstA[i * 4 + c]) - int(dstB[i * 4 + c])));
        }
        Q_UNUSED(sa);
        Q_UNUSED(da);
    }
    QVERIFY2(worst <= 1, qPrintable(QString::number(worst)));
}

void KisPaintMixTest::testBlendPixelsOneColourOverTransparentIsExact()
{
    for (Model m : allModels) {
        const uint8_t src[4] = {133, 77, 201, 255};
        uint8_t dst[8 * 4] = {};
        blendPixels(m, Blend::Over, PixelFormat::Bgra8, dst, src, true, 8, 1.0f);
        for (int i = 0; i < 8; i++) {
            QVERIFY(std::memcmp(dst + i * 4, src, 4) == 0);
        }
        const float srcF[4] = {0.52f, 0.3f, 0.79f, 1.0f};
        float dstF[4] = {0.0f, 0.0f, 0.0f, 0.0f};
        blendPixels(m, Blend::Over, PixelFormat::RgbaF32, reinterpret_cast<uint8_t *>(dstF), reinterpret_cast<const uint8_t *>(srcF), true, 1, 1.0f);
        QVERIFY(std::memcmp(dstF, srcF, sizeof(srcF)) == 0);
    }
}

void KisPaintMixTest::testBlendPixelsTinyAlphaIsFinite()
{
    for (Model m : allModels) {
        for (Blend b : {Blend::Over, Blend::Copy}) {
            const float srcF[4] = {0.9f, 0.1f, 0.4f, 1e-7f};
            float dstF[4] = {0.2f, 0.6f, 0.3f, 1e-7f};
            blendPixels(m, b, PixelFormat::RgbaF32, reinterpret_cast<uint8_t *>(dstF), reinterpret_cast<const uint8_t *>(srcF), true, 1, 0.7f);
            for (float v : dstF) QVERIFY(std::isfinite(v));

            const uint16_t s16[4] = {26000, 6000, 59000, 0};
            uint16_t d16[4] = {10000, 20000, 30000, 0};
            const uint16_t d16In[4] = {10000, 20000, 30000, 0};
            blendPixels(m, b, PixelFormat::Bgra16, reinterpret_cast<uint8_t *>(d16), reinterpret_cast<const uint8_t *>(s16), true, 1, 0.7f);
            // Both alphas are 0 (1e-7 is below one 16-bit step), so the pixel is left exactly as it was.
            QVERIFY(std::memcmp(d16, d16In, sizeof(d16)) == 0);

            const uint8_t s8[4] = {10, 20, 30, 0};
            uint8_t d8[4] = {40, 50, 60, 0};
            blendPixels(m, b, PixelFormat::Bgra8, d8, s8, true, 1, 0.7f);
            QCOMPARE(int(d8[0]), 40);
        }
    }
}

void KisPaintMixTest::testSpectralOutOfRangeFloatIsFinite()
{
    // A float layer holds values outside 0..1 (a negative channel, an HDR highlight); the spectral model's log step would
    // turn a negative band into NaN. Inputs are clamped to 0..1 first: the result is finite and in range, and equals the
    // mix of the clamped colours.
    const float srcF[4] = {0.2f, -0.4f, 0.9f, 1.0f};
    float dstF[4] = {2.5f, 0.6f, -0.3f, 1.0f};
    blendPixels(Model::Spectral, Blend::Copy, PixelFormat::RgbaF32, reinterpret_cast<uint8_t *>(dstF), reinterpret_cast<const uint8_t *>(srcF), true, 1, 0.5f);
    for (float v : dstF) {
        QVERIFY2(std::isfinite(v) && v >= 0.0f && v <= 1.0f, qPrintable(QString::number(v)));
    }
    const Rgb clamped = mix2(Model::Spectral, Rgb{1.0f, 0.6f, 0.0f}, Rgb{0.2f, 0.0f, 0.9f}, 0.5f);
    QCOMPARE(dstF[0], clamped.r);
    QCOMPARE(dstF[1], clamped.g);
    QCOMPARE(dstF[2], clamped.b);
    const Rgb colours[2] = {{2.5f, 0.6f, -0.3f}, {0.2f, -0.4f, 0.9f}};
    const float weights[2] = {0.5f, 0.5f};
    const Rgb many = mixMany(Model::Spectral, colours, weights, 2);
    QVERIFY(std::isfinite(many.r) && std::isfinite(many.g) && std::isfinite(many.b));
}

void KisPaintMixTest::testBlendPixelsBgra16AndFloatNumeric()
{
    // Over, op 0.5, sa 1, da 0.5: a = 0.5 + 0.5 * 0.5 = 0.75, t = 0.5 / 0.75 = 2/3. Expected values are written out by hand.
    // Bgra16: dst B,G,R,A = 13107,26214,39321,32768 (0.2,0.4,0.6, da 32768/65535); src B,G,R,A = 0,13107,52428,65535 (R 0.8, G 0.2, B 0).
    {
        const double da = 32768.0 / 65535.0;
        const double a = 0.5 + da * 0.5;
        const double t = 0.5 / a;
        const double r = 0.6 + (0.8 - 0.6) * t, g = 0.4 + (0.2 - 0.4) * t, b = 0.2 + (0.0 - 0.2) * t;
        uint16_t dst[4] = {13107, 26214, 39321, 32768};
        const uint16_t src[4] = {0, 13107, 52428, 65535};
        blendPixels(Model::Rgb, Blend::Over, PixelFormat::Bgra16, reinterpret_cast<uint8_t *>(dst), reinterpret_cast<const uint8_t *>(src), true, 1, 0.5f);
        QVERIFY2(std::abs(int(dst[0]) - int(b * 65535 + 0.5)) <= 1, qPrintable(QString::number(dst[0])));
        QVERIFY2(std::abs(int(dst[1]) - int(g * 65535 + 0.5)) <= 1, qPrintable(QString::number(dst[1])));
        QVERIFY2(std::abs(int(dst[2]) - int(r * 65535 + 0.5)) <= 1, qPrintable(QString::number(dst[2])));
        QVERIFY2(std::abs(int(dst[3]) - int(a * 65535 + 0.5)) <= 1, qPrintable(QString::number(dst[3])));
        // Hand values: B 0.0667 -> 4369, G 0.2667 -> 17476, R 0.7333 -> 48059 (+-1), A 0.75 -> 49152 (+-1).
        QVERIFY(std::abs(int(dst[0]) - 4369) <= 1 && std::abs(int(dst[1]) - 17476) <= 1);
        QVERIFY(std::abs(int(dst[2]) - 48059) <= 2 && std::abs(int(dst[3]) - 49152) <= 1);
    }
    // RgbaF32: R,G,B,A order.
    {
        float dst[4] = {0.2f, 0.4f, 0.6f, 0.5f};
        const float src[4] = {0.8f, 0.2f, 0.0f, 1.0f};
        blendPixels(Model::Rgb, Blend::Over, PixelFormat::RgbaF32, reinterpret_cast<uint8_t *>(dst), reinterpret_cast<const uint8_t *>(src), true, 1, 0.5f);
        QVERIFY2(std::fabs(dst[0] - 0.6f) < 1e-5f, qPrintable(QString::number(dst[0])));
        QVERIFY2(std::fabs(dst[1] - 0.26666667f) < 1e-5f, qPrintable(QString::number(dst[1])));
        QVERIFY2(std::fabs(dst[2] - 0.2f) < 1e-5f, qPrintable(QString::number(dst[2])));
        QVERIFY2(std::fabs(dst[3] - 0.75f) < 1e-6f, qPrintable(QString::number(dst[3])));
    }
}

void KisPaintMixTest::testBlendPixelsCopyAlpha()
{
    // Copy, op 0.5, sa 1, da 0.5: a = 0.5 + 0.5 * 0.5 = 0.75; t = 0.5 / (0.5 + 0.25) = 2/3.
    float dst[4] = {0.2f, 0.4f, 0.6f, 0.5f};
    const float src[4] = {0.8f, 0.2f, 0.0f, 1.0f};
    blendPixels(Model::Rgb, Blend::Copy, PixelFormat::RgbaF32, reinterpret_cast<uint8_t *>(dst), reinterpret_cast<const uint8_t *>(src), true, 1, 0.5f);
    QVERIFY2(std::fabs(dst[3] - 0.75f) < 1e-6f, qPrintable(QString::number(dst[3])));
    QVERIFY2(std::fabs(dst[0] - (0.2f + 0.6f * 2.0f / 3.0f)) < 1e-5f, qPrintable(QString::number(dst[0])));
    QVERIFY2(std::fabs(dst[1] - (0.4f - 0.2f * 2.0f / 3.0f)) < 1e-5f, qPrintable(QString::number(dst[1])));
    QVERIFY2(std::fabs(dst[2] - (0.6f - 0.6f * 2.0f / 3.0f)) < 1e-5f, qPrintable(QString::number(dst[2])));
}

void KisPaintMixTest::testGoldenVectors()
{
    const QString writePath = QProcessEnvironment::systemEnvironment().value("KIS_PAINTMIX_WRITE_GOLDEN");
    std::mt19937 gen(20261101);
    std::uniform_real_distribution<float> td(0.0f, 1.0f);

    QJsonObject root;
    QJsonObject expected;
    auto arr = [](Rgb c) { return QJsonArray{double(c.r), double(c.g), double(c.b)}; };
    for (Model m : allModels) {
        QJsonArray rows;
        for (int i = 0; i < 64; i++) {
            const Rgb a = randomRgb(gen);
            const Rgb b = randomRgb(gen);
            const float t = td(gen);
            QJsonObject row;
            row["a"] = arr(a);
            row["b"] = arr(b);
            row["t"] = double(t);
            row["out"] = arr(mix2(m, a, b, t));
            rows.append(row);
        }
        root[modelId(m)] = rows;
    }

    if (!writePath.isEmpty()) {
        QFile f(writePath);
        QVERIFY(f.open(QIODevice::WriteOnly | QIODevice::Truncate));
        f.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
        f.close();
        return;
    }

    QFile f(QString(FILES_DATA_DIR) + "golden.json");
    QVERIFY(f.open(QIODevice::ReadOnly));
    const QJsonDocument doc = QJsonDocument::fromJson(f.readAll());
    QVERIFY(doc.isObject());
    for (Model m : allModels) {
        const QJsonArray rows = doc.object().value(modelId(m)).toArray();
        QCOMPARE(rows.size(), 64);
        for (const QJsonValue &v : rows) {
            const QJsonObject row = v.toObject();
            auto rd = [&](const char *k) {
                const QJsonArray a = row.value(k).toArray();
                return Rgb{float(a[0].toDouble()), float(a[1].toDouble()), float(a[2].toDouble())};
            };
            const Rgb got = mix2(m, rd("a"), rd("b"), float(row.value("t").toDouble()));
            const Rgb want = rd("out");
            // spectral and perceptual use fast-math / libm pow and cbrt, which differ across platforms on CI; pigment's
            // polynomial is long enough for a compiler's fused multiply-adds to move the last bits.
            const float tol = (m == Model::Spectral || m == Model::Perceptual || m == Model::Pigment) ? 1e-5f : 1e-6f;
            QVERIFY2(std::fabs(got.r - want.r) < tol && std::fabs(got.g - want.g) < tol && std::fabs(got.b - want.b) < tol,
                     modelId(m));
        }
    }
}

void KisPaintMixTest::testSpeed()
{
#ifndef NDEBUG
    QSKIP("speed is measured in release builds only");
#endif
    const int n = 2000000;
    std::mt19937 gen(5);
    std::uniform_int_distribution<int> bd(0, 255);
    std::vector<uint8_t> dst(size_t(n) * 4), src(size_t(n) * 4);
    for (auto &v : dst) v = uint8_t(bd(gen));
    for (auto &v : src) v = uint8_t(bd(gen));
    const std::vector<uint8_t> dst0 = dst;
    for (Model m : {Model::Spectral, Model::Pigment}) {
        dst = dst0;
        QElapsedTimer timer;
        timer.start();
        blendPixels(m, Blend::Over, PixelFormat::Bgra8, dst.data(), src.data(), false, n, 1.0f);
        const qint64 ms = timer.elapsed();
        qInfo() << modelId(m) << "blendPixels, 2,000,000 pixels:" << ms << "ms";
        QVERIFY2(ms <= 500, qPrintable(QString("%1 %2").arg(modelId(m)).arg(ms)));
    }
}

namespace {

float maxChannelDifference(Rgb a, Rgb b)
{
    return std::max({std::fabs(a.r - b.r), std::fabs(a.g - b.g), std::fabs(a.b - b.b)});
}

// 8-bit colours, as the MyPaint surface meets them on an 8-bit layer
Rgb random8Bit(std::mt19937 &gen)
{
    std::uniform_int_distribution<int> d(0, 255);
    return {d(gen) / 255.0f, d(gen) / 255.0f, d(gen) / 255.0f};
}

}

void KisPaintMixTest::testLogSpectrumCacheIsExact()
{
    std::unique_ptr<LogSpectrumCache> cache(new LogSpectrumCache());
    std::mt19937 gen(31);
    std::vector<Rgb> colours;
    for (int i = 0; i < 3000; i++) {
        colours.push_back(i % 3 == 0 && !colours.empty() ? colours[gen() % colours.size()] : randomRgb(gen));
    }
    for (const Rgb &c : colours) {
        LogSpectrum direct;
        toLogSpectrum(c, direct);
        const LogSpectrum &cached = cache->get(c);
        QVERIFY(std::memcmp(&direct, &cached, sizeof direct) == 0);
        QCOMPARE(direct.band[10], 0.0f);
        QCOMPARE(direct.band[11], 0.0f);
    }
}

void KisPaintMixTest::testMixLogSpectraIsMix2()
{
    std::mt19937 gen(32);
    std::uniform_real_distribution<float> td(0.0f, 1.0f);
    float worst = 0.0f;
    for (int i = 0; i < 20000; i++) {
        const Rgb a = randomRgb(gen);
        const Rgb b = randomRgb(gen);
        const float t = td(gen);
        LogSpectrum la, lb;
        toLogSpectrum(a, la);
        toLogSpectrum(b, lb);
        worst = std::max(worst, maxChannelDifference(mixLogSpectra(la, lb, t), mix2(Model::Spectral, a, b, t)));
    }
    qDebug() << "mixLogSpectra - mix2, largest:" << worst * 255 << "/255";
    QVERIFY(worst <= 1e-5f);
}

void KisPaintMixTest::testDabMixerMatchesMix2()
{
    std::unique_ptr<LogSpectrumCache> cache(new LogSpectrumCache());
    std::unique_ptr<SpectralDabMixer> mixer(new SpectralDabMixer(*cache));
    std::mt19937 gen(33);
    std::uniform_real_distribution<float> td(0.0f, 1.0f);
    const Rgb tops[] = {random8Bit(gen), random8Bit(gen), {0, 0, 0}, {1, 1, 1}, {0, 33 / 255.0f, 133 / 255.0f}};
    float worst = 0.0f;
    // tops change and come back: the memo must never answer for another top colour
    for (int round = 0; round < 3; round++) {
        for (const Rgb &top : tops) {
            mixer->setTop(top);
            for (int i = 0; i < 4000; i++) {
                const Rgb bottom = i % 4 == 0 ? Rgb{0, 0, 0} : random8Bit(gen);
                const float t = td(gen);
                worst = std::max(worst, maxChannelDifference(mixer->mix(bottom, t), mix2(Model::Spectral, bottom, top, t)));
            }
        }
    }
    qDebug() << "SpectralDabMixer - mix2, largest:" << worst * 255 << "/255";
    QVERIFY(worst <= 1.5e-4f);
}

void KisPaintMixTest::testDabMixerKeepsExactCases()
{
    std::unique_ptr<LogSpectrumCache> cache(new LogSpectrumCache());
    std::unique_ptr<SpectralDabMixer> mixer(new SpectralDabMixer(*cache));
    std::mt19937 gen(34);
    for (int i = 0; i < 200; i++) {
        const Rgb top = randomRgb(gen);
        const Rgb bottom = randomRgb(gen);
        mixer->setTop(top);
        QVERIFY(bitwiseEqual(mixer->mix(bottom, 0.0f), bottom));
        QVERIFY(bitwiseEqual(mixer->mix(bottom, 1.0f), top));
        QVERIFY(bitwiseEqual(mixer->mix(top, 0.37f), top));
    }
}

void KisPaintMixTest::testSpectralAverageMatchesMixMany()
{
    std::unique_ptr<LogSpectrumCache> cache(new LogSpectrumCache());
    std::mt19937 gen(35);
    std::uniform_real_distribution<float> wd(-10.0f, 255.0f);
    float worst = 0.0f;
    for (int i = 0; i < 2000; i++) {
        const int n = 1 + i % 50;
        std::vector<Rgb> colours(n);
        std::vector<float> weights(n);
        SpectralAverage average(*cache);
        for (int k = 0; k < n; k++) {
            // runs of equal colours, as rows of a flat canvas give
            colours[k] = k > 0 && gen() % 3 == 0 ? colours[k - 1] : random8Bit(gen);
            weights[k] = wd(gen);
            average.add(colours[k], weights[k]);
        }
        const Rgb expected = mixMany(Model::Spectral, colours.data(), weights.data(), n);
        if (average.isEmpty()) {
            QVERIFY(bitwiseEqual(average.result(), Rgb{0, 0, 0}));
            continue;
        }
        worst = std::max(worst, maxChannelDifference(average.result(), expected));
    }
    qDebug() << "SpectralAverage - mixMany, largest:" << worst * 255 << "/255";
    QVERIFY(worst <= 2e-4f);

    // one colour, many times: exact
    SpectralAverage one(*cache);
    const Rgb c {51 / 255.0f, 133 / 255.0f, 7 / 255.0f};
    for (int k = 0; k < 100; k++) {
        one.add(c, 1.0f + k);
    }
    QVERIFY(bitwiseEqual(one.result(), c));
}

namespace {

// HSV hue in degrees (0..360) and value of a colour
float hueDegrees(Rgb c)
{
    const float mx = std::max({c.r, c.g, c.b}), mn = std::min({c.r, c.g, c.b});
    const float d = mx - mn;
    if (d <= 0.0f) return 0.0f;
    float h;
    if (mx == c.r) h = std::fmod((c.g - c.b) / d, 6.0f);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0f;
    else h = (c.r - c.g) / d + 4.0f;
    h *= 60.0f;
    return h < 0.0f ? h + 360.0f : h;
}

QString describe(Rgb c)
{
    return QString("(%1, %2, %3)").arg(c.r * 255).arg(c.g * 255).arg(c.b * 255);
}

}

void KisPaintMixTest::testPigmentBlueYellowIsGreen()
{
    // Mixbox's own pigment colours (mixbox.h): Cobalt Blue and Hansa Yellow
    const Rgb blue{0.0f / 255, 33.0f / 255, 133.0f / 255};
    const Rgb yellow{252.0f / 255, 211.0f / 255, 0.0f / 255};
    const Rgb m = mix2(Model::Pigment, blue, yellow, 0.5f);
    qDebug() << "pigment blue + yellow:" << describe(m);
    QVERIFY2(m.g > m.r && m.g > m.b, qPrintable(describe(m)));
    // the same colours in rgb give a grey, not a green: the model is what makes the green
    const Rgb plain = mix2(Model::Rgb, blue, yellow, 0.5f);
    QVERIFY(!(plain.g > plain.r && plain.g > plain.b));
}

void KisPaintMixTest::testPigmentComplementariesMakeBrown()
{
    // Mixbox's Cadmium Orange and Ultramarine Blue (mixbox.h), half and half
    const Rgb orange{255.0f / 255, 105.0f / 255, 0.0f / 255};
    const Rgb ultramarine{25.0f / 255, 0.0f / 255, 89.0f / 255};
    const Rgb m = mix2(Model::Pigment, orange, ultramarine, 0.5f);
    const float hue = hueDegrees(m);
    const float value = std::max({m.r, m.g, m.b});
    qDebug() << "pigment orange + ultramarine:" << describe(m) << "hue" << hue << "value" << value;
    QVERIFY2(hue >= 0.0f && hue <= 60.0f, qPrintable(describe(m)));
    QVERIFY2(m.r > m.g && m.g > m.b, qPrintable(describe(m)));
    QVERIFY2(value <= 0.7f, qPrintable(describe(m)));
}

void KisPaintMixTest::testPigmentLatentRoundTrip()
{
    std::mt19937 gen(9);
    float worst = 0.0f;
    for (int i = 0; i < 4096; i++) {
        const Rgb c = randomRgb(gen);
        const Latent l = rgbToLatent(c);
        QVERIFY(std::fabs(l.c[0] + l.c[1] + l.c[2] + l.c[3] - 1.0f) < 1e-5f);
        worst = std::max(worst, maxChannelDifference(latentToRgb(l), c));
    }
    qDebug() << "latentToRgb(rgbToLatent(c)) - c, largest:" << worst;
    QVERIFY(worst <= 1e-5f);
}

void KisPaintMixTest::testSettingsDefaults()
{
    const Settings s;
    QVERIFY(s.model == Model::Rgb);
    QVERIFY(s.mixOnBrush);
    QVERIFY(!s.mixInWetPaint);
}

namespace {

// yellow (252,211,0) and blue (0,33,133), the pair the live probes use, as 8-bit B,G,R,A
const uint8_t yellow8[4] = {0, 211, 252, 255};
const uint8_t blue8[4] = {133, 33, 0, 255};

void compositeOne(const KoCompositeOp *op, uint8_t *dst, int dstBytes, const uint8_t *src, const uint8_t *mask, int cols,
                  float opacity, const QBitArray &flags = QBitArray())
{
    KoCompositeOp::ParameterInfo params;
    params.dstRowStart = dst;
    params.dstRowStride = dstBytes;
    params.srcRowStart = src;
    params.srcRowStride = 0;          // one colour for every pixel, as a brush dab's paint colour
    params.maskRowStart = mask;
    params.maskRowStride = mask ? cols : 0;
    params.rows = 1;
    params.cols = cols;
    params.opacity = opacity;
    params.flow = 1.0f;
    params.channelFlags = flags;
    op->composite(params);
}

}

void KisPaintMixTest::testBlendPixelsMaskedFollowsTheMask()
{
    for (Model m : allModels) {
        const uint8_t mask[4] = {0, 255, 128, 64};
        uint8_t masked[16], plain[16];
        for (int i = 0; i < 4; i++) { std::memcpy(masked + i * 4, yellow8, 4); std::memcpy(plain + i * 4, yellow8, 4); }
        blendPixelsMasked(m, Blend::Over, PixelFormat::Bgra8, masked, blue8, true, mask, 4, 0.8f);

        // 0 leaves the pixel untouched; each other pixel is blendPixels at the opacity times its mask
        QVERIFY(std::memcmp(masked, yellow8, 4) == 0);
        for (int i = 1; i < 4; i++) {
            blendPixels(m, Blend::Over, PixelFormat::Bgra8, plain + i * 4, blue8, true, 1, 0.8f * (mask[i] == 255 ? 1.0f : mask[i] / 255.0f));
            QVERIFY2(std::memcmp(masked + i * 4, plain + i * 4, 4) == 0, modelId(m));
        }
        // no mask is blendPixels
        uint8_t a[4], b[4];
        std::memcpy(a, yellow8, 4); std::memcpy(b, yellow8, 4);
        blendPixelsMasked(m, Blend::Over, PixelFormat::Bgra8, a, blue8, true, nullptr, 1, 0.5f);
        blendPixels(m, Blend::Over, PixelFormat::Bgra8, b, blue8, true, 1, 0.5f);
        QVERIFY(std::memcmp(a, b, 4) == 0);
    }
}

void KisPaintMixTest::testMixBlendModesAreOnRgbaSpacesOnly()
{
    const QStringList ids = {"toska_mix_linear", "toska_mix_perceptual", "toska_mix_spectral", "toska_mix_pigment"};
    const KoColorSpace *rgb8 = KoColorSpaceRegistry::instance()->rgb8();
    const KoColorSpace *rgb16 = KoColorSpaceRegistry::instance()->rgb16();
    const KoColorSpace *lab = KoColorSpaceRegistry::instance()->lab16();
    QVERIFY(rgb8 && rgb16 && lab);
    for (const QString &id : ids) {
        QVERIFY2(rgb8->hasCompositeOp(id), qPrintable(id));
        QVERIFY2(rgb8->hasCompositeOp(id + "_copy"), qPrintable(id));
        QVERIFY2(rgb16->hasCompositeOp(id), qPrintable(id));
        QVERIFY2(!lab->hasCompositeOp(id), qPrintable(id));
    }
    QCOMPARE(KoCompositeOpToskaMix::idForModel("pigment", false), QString("toska_mix_pigment"));
    QCOMPARE(KoCompositeOpToskaMix::idForModel("spectral", true), QString("toska_mix_spectral_copy"));
    QVERIFY(KoCompositeOpToskaMix::idForModel("rgb", false).isEmpty());
    QVERIFY(KoCompositeOpToskaMix::idForModel("oil", false).isEmpty());
}

void KisPaintMixTest::testMixBlendModeBlueOverYellowIsGreen()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    for (const char *id : {"toska_mix_spectral", "toska_mix_pigment"}) {
        uint8_t dst[4];
        std::memcpy(dst, yellow8, 4);
        compositeOne(cs->compositeOp(id), dst, 4, blue8, nullptr, 1, 0.5f);
        QVERIFY2(dst[1] > dst[2] && dst[1] > dst[0], qPrintable(QString("%1: r %2 g %3 b %4").arg(id).arg(dst[2]).arg(dst[1]).arg(dst[0])));
        QCOMPARE(int(dst[3]), 255);

        // the same as the library's own blend
        uint8_t expected[4];
        std::memcpy(expected, yellow8, 4);
        blendPixels(QByteArray(id).endsWith("pigment") ? Model::Pigment : Model::Spectral, Blend::Over, PixelFormat::Bgra8, expected, blue8, true, 1, 0.5f);
        QVERIFY(std::memcmp(dst, expected, 4) == 0);

        // full strength is the paint colour itself, exactly
        std::memcpy(dst, yellow8, 4);
        compositeOne(cs->compositeOp(id), dst, 4, blue8, nullptr, 1, 1.0f);
        QVERIFY(std::memcmp(dst, blue8, 4) == 0);
    }
    // Normal's blend of the same two paints is not green
    uint8_t plain[4];
    std::memcpy(plain, yellow8, 4);
    compositeOne(cs->compositeOp(COMPOSITE_OVER), plain, 4, blue8, nullptr, 1, 0.5f);
    QVERIFY(!(plain[1] > plain[2]));
}

void KisPaintMixTest::testMixBlendModeMaskAndChannelFlags()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    const KoCompositeOp *op = cs->compositeOp("toska_mix_pigment");

    // 300 pixels: more than one of the op's chunks
    const int n = 300;
    std::vector<uint8_t> dst(n * 4), mask(n);
    for (int i = 0; i < n; i++) { std::memcpy(&dst[i * 4], yellow8, 4); mask[i] = i % 3 == 0 ? 0 : (i % 3 == 1 ? 255 : 128); }
    compositeOne(op, dst.data(), n * 4, blue8, mask.data(), n, 1.0f);
    for (int i = 0; i < n; i++) {
        const uint8_t *p = &dst[i * 4];
        if (mask[i] == 0) QVERIFY(std::memcmp(p, yellow8, 4) == 0);
        else if (mask[i] == 255) QVERIFY(std::memcmp(p, blue8, 4) == 0);
        else QVERIFY2(p[1] > p[2], qPrintable(QString::number(i)));     // half coverage: a green, not an olive
    }

    // only the red channel may be written: green, blue and alpha keep their bytes
    uint8_t one[4];
    std::memcpy(one, yellow8, 4);
    QBitArray flags(4, false);
    flags.setBit(2);                                                     // B,G,R,A: index 2 is red
    compositeOne(op, one, 4, blue8, nullptr, 1, 0.5f, flags);
    QCOMPARE(int(one[0]), int(yellow8[0]));
    QCOMPARE(int(one[1]), int(yellow8[1]));
    QCOMPARE(int(one[3]), 255);
    QVERIFY(one[2] != yellow8[2]);
}

void KisPaintMixTest::testMixBlendModeCopyForm()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    // Copy at half strength onto a half-transparent pixel: alpha moves halfway to the source's, the colour is mixed by the model
    uint8_t dst[4] = {0, 211, 252, 128};
    uint8_t expected[4];
    std::memcpy(expected, dst, 4);
    compositeOne(cs->compositeOp("toska_mix_spectral_copy"), dst, 4, blue8, nullptr, 1, 0.5f);
    blendPixels(Model::Spectral, Blend::Copy, PixelFormat::Bgra8, expected, blue8, true, 1, 0.5f);
    QVERIFY(std::memcmp(dst, expected, 4) == 0);
    QVERIFY(dst[3] > 128 && dst[3] < 255);
}

void KisPaintMixTest::testMixBlendModeOnALinearProfile()
{
    // Krita's 32-bit float RGBA defaults to a linear-light profile: the op mixes in sRGB encoding and stores linear again.
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->colorSpace(RGBAColorModelID.id(), Float32BitsColorDepthID.id(), QString());
    QVERIFY(cs);
    if (!cs->profile() || !cs->profile()->isLinear()) QSKIP("the default float RGBA profile is not linear here");
    QVERIFY(cs->hasCompositeOp("toska_mix_pigment"));

    auto lin = [](float v) { return v <= 0.04045f ? v / 12.92f : std::pow((v + 0.055f) / 1.055f, 2.4f); };
    auto enc = [](float v) { return v <= 0.0031308f ? 12.92f * v : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f; };
    float dst[4] = {lin(252 / 255.0f), lin(211 / 255.0f), 0.0f, 1.0f};
    const float src[4] = {0.0f, lin(33 / 255.0f), lin(133 / 255.0f), 1.0f};
    const float untouched[4] = {dst[0], dst[1], dst[2], dst[3]};

    // a zero mask leaves the stored floats bit for bit
    const uint8_t none = 0;
    compositeOne(cs->compositeOp("toska_mix_pigment"), reinterpret_cast<uint8_t *>(dst), 16, reinterpret_cast<const uint8_t *>(src), &none, 1, 1.0f);
    QVERIFY(std::memcmp(dst, untouched, 16) == 0);

    compositeOne(cs->compositeOp("toska_mix_pigment"), reinterpret_cast<uint8_t *>(dst), 16, reinterpret_cast<const uint8_t *>(src), nullptr, 1, 0.5f);
    for (float v : dst) QVERIFY(std::isfinite(v));

    // the same mix as the 8-bit sRGB op gives, within rounding
    uint8_t expected[4];
    std::memcpy(expected, yellow8, 4);
    blendPixels(Model::Pigment, Blend::Over, PixelFormat::Bgra8, expected, blue8, true, 1, 0.5f);
    QVERIFY2(std::abs(enc(dst[0]) * 255.0f - expected[2]) <= 1.5f, qPrintable(QString::number(enc(dst[0]) * 255.0f)));
    QVERIFY2(std::abs(enc(dst[1]) * 255.0f - expected[1]) <= 1.5f, qPrintable(QString::number(enc(dst[1]) * 255.0f)));
    QVERIFY2(std::abs(enc(dst[2]) * 255.0f - expected[0]) <= 1.5f, qPrintable(QString::number(enc(dst[2]) * 255.0f)));
}

void KisPaintMixTest::testSolveOverBelowShowsTheModelsMixThroughNormal()
{
    // Thin paint on a layer, re-solved against the paint below: Krita's own Normal blend of the layer over the below
    // must then show what the model mixes, for every alpha and for colours whose mix lies outside the plain blend's reach.
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    const KoCompositeOp *normal = cs->compositeOp(COMPOSITE_OVER);
    const uint8_t pairs[][2][3] = {{{0, 211, 252}, {133, 33, 0}}, {{133, 33, 0}, {0, 211, 252}}, {{20, 122, 240}, {107, 32, 16}},
                                   {{58, 154, 31}, {28, 28, 212}}, {{255, 255, 255}, {0, 0, 0}}, {{10, 10, 10}, {250, 250, 250}}};
    for (Model m : {Model::Spectral, Model::Pigment}) {
        int worst = 0;
        for (const auto &pair : pairs) {
            for (int alpha : {8, 40, 89, 128, 200, 250}) {
                const uint8_t below[4] = {pair[0][0], pair[0][1], pair[0][2], 255};
                uint8_t layer[4] = {pair[1][0], pair[1][1], pair[1][2], uint8_t(alpha)};

                uint8_t wanted[4];
                std::memcpy(wanted, below, 4);
                blendPixels(m, Blend::Over, PixelFormat::Bgra8, wanted, layer, true, 1, 1.0f);

                solveOverBelow(m, PixelFormat::Bgra8, layer, below, 1);
                QVERIFY(layer[3] >= alpha);                       // never thinner than it was painted

                uint8_t shown[4];
                std::memcpy(shown, below, 4);
                compositeOne(normal, shown, 4, layer, nullptr, 1, 1.0f);
                for (int c = 0; c < 3; c++) worst = std::max(worst, std::abs(int(shown[c]) - int(wanted[c])));
                QCOMPARE(int(shown[3]), 255);
            }
        }
        qInfo() << modelId(m) << "solved layer through Normal: largest difference from the model's mix" << worst << "/255";
        QVERIFY2(worst <= 2, qPrintable(QString("%1: %2").arg(modelId(m)).arg(worst)));
    }
}

void KisPaintMixTest::testSolveOverBelowLeavesWhatItShould()
{
    const uint8_t yellow[4] = {0, 211, 252, 255};
    // opaque paint, an empty pixel, the same colour as below, paint over a transparent below: all untouched
    uint8_t layer[4 * 4] = {133, 33, 0, 255,   133, 33, 0, 0,   0, 211, 252, 100,   133, 33, 0, 100};
    const uint8_t below[4 * 4] = {0, 211, 252, 255,   0, 211, 252, 255,   0, 211, 252, 255,   0, 211, 252, 0};
    uint8_t before[16];
    std::memcpy(before, layer, 16);
    QCOMPARE(solveOverBelow(Model::Pigment, PixelFormat::Bgra8, layer, below, 4), 0);
    QVERIFY(std::memcmp(layer, before, 16) == 0);
    // rgb is the plain blend already
    uint8_t thin[4] = {133, 33, 0, 100};
    QCOMPARE(solveOverBelow(Model::Rgb, PixelFormat::Bgra8, thin, yellow, 1), 0);
    QCOMPARE(solveOverBelow(Model::Pigment, PixelFormat::Bgra8, thin, yellow, 1), 1);
    // a large buffer goes through the threads and gives the same pixels
    const int n = 20000;
    std::vector<uint8_t> many(size_t(n) * 4), under(size_t(n) * 4);
    for (int i = 0; i < n; i++) { const uint8_t t[4] = {133, 33, 0, 100}; std::memcpy(&many[i * 4], t, 4); std::memcpy(&under[i * 4], yellow, 4); }
    QCOMPARE(solveOverBelow(Model::Pigment, PixelFormat::Bgra8, many.data(), under.data(), n), n);
    for (int i = 0; i < n; i += 997) QVERIFY(std::memcmp(&many[i * 4], thin, 4) == 0);
}

SIMPLE_TEST_MAIN(KisPaintMixTest)
