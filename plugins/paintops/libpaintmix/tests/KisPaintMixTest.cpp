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

const Model allModels[] = {Model::Rgb, Model::LinearLight, Model::Perceptual, Model::Spectral};

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
            // spectral and perceptual use fast-math / libm pow and cbrt, which differ across platforms on CI.
            const float tol = (m == Model::Spectral || m == Model::Perceptual) ? 1e-5f : 1e-6f;
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
    QElapsedTimer timer;
    timer.start();
    blendPixels(Model::Spectral, Blend::Over, PixelFormat::Bgra8, dst.data(), src.data(), false, n, 1.0f);
    const qint64 ms = timer.elapsed();
    qInfo() << "spectral blendPixels, 2,000,000 pixels:" << ms << "ms";
    QVERIFY2(ms <= 500, qPrintable(QString::number(ms)));
}

SIMPLE_TEST_MAIN(KisPaintMixTest)
