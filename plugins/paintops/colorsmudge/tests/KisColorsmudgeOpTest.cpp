/*
 *  SPDX-FileCopyrightText: 2021 Dmitry Kazakov <dimula73@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "KisColorsmudgeOpTest.h"

#include "kistest.h"

#include <QRegularExpression>
#include <qimage_based_test.h>
#include <stroke_testing_utils.h>
#include <brushengine/kis_paint_information.h>
#include <kis_canvas_resource_provider.h>
#include <brushengine/kis_paintop_preset.h>
#include <brushengine/kis_paintop_settings.h>
#include <KoCanvasResourcesIds.h>
#include <KoColorSpaceRegistry.h>
#include <KoCompositeOpRegistry.h>
#include <kis_properties_configuration.h>

#include <KisColorSmudgeMixingOptionData.h>
#include <KisColorSmudgeModelMixer.h>
#include <KoMixColorsOp.h>

class TestColorsmudgeOp : public TestUtil::QImageBasedTest
{
public:
    TestColorsmudgeOp(const QString &prefix = "simple")
        : QImageBasedTest("colorsmudgeop") {
        m_prefix = prefix;
    }

    void test(const QString &testName, const QString &presetFileName, bool useOverlay) {
        KisSurrogateUndoStore *undoStore = new KisSurrogateUndoStore();
        KisImageSP image = createTrivialImage(undoStore);
        image->initialRefreshGraph();
        image->resizeImage(QRect(0,0,200,200));
        image->waitForDone();

        KisNodeSP paint1 = findNode(image->root(), "paint1");

        QVERIFY(paint1->extent().isEmpty());

        paint1->paintDevice()->fill(QRect(80, 5, 50, 190), KoColor(Qt::red, image->colorSpace()));

        KisNodeSP targetNode = paint1;

        if (useOverlay) {
            KisPaintLayerSP paint2 = new KisPaintLayer(image, "paint2", OPACITY_OPAQUE_U8);
            image->addNode(paint2, paint1->parent(), paint1);
            targetNode = paint2;

            KisPaintLayerSP paintBg = new KisPaintLayer(image, "paintBg", OPACITY_OPAQUE_U8);
            image->addNode(paintBg, paint1->parent(), 0);
            paintBg->paintDevice()->fill(QRect(0, 100, 200, 100), KoColor(Qt::white, image->colorSpace()));

            image->initialRefreshGraph();
        }

        KisPainter gc(targetNode->paintDevice());

        QScopedPointer<KoCanvasResourceProvider> manager(
            utils::createResourceManager(image, 0, presetFileName));

        manager->setResource(KoCanvasResource::ForegroundColor, KoColor(Qt::green, image->colorSpace()));

        KisPaintOpPresetSP preset =
            manager->resource(KoCanvasResource::CurrentPaintOpPreset).value<KisPaintOpPresetSP>();

        if (useOverlay) {
            preset->settings()->setProperty("MergedPaint", true);
        }

        QString testPrefix =
            QString("%1_%2")
            .arg(m_prefix)
            .arg(testName);

        KisResourcesSnapshotSP resources =
            new KisResourcesSnapshot(image,
                                     targetNode,
                                     manager.data());

        resources->setupPainter(&gc);

        doPaint(gc);

        checkOneLayer(image, targetNode, testPrefix);
    }

    void doPaint(KisPainter &gc) {

        const QVector<qreal> pressureLevels = {1.0, 0.8, 0.5};

        int yOffset = 20;
        Q_FOREACH (qreal pressure, pressureLevels) {
            {
                KisDistanceInformation dist;
                KisPaintInformation p1(QPointF(20, yOffset), pressure);
                KisPaintInformation p2(QPointF(180, yOffset), pressure);

                gc.paintLine(p1, p2, &dist);
            }

            {
                KisDistanceInformation dist;
                KisPaintInformation p1(QPointF(100, yOffset + 30), pressure);
                KisPaintInformation p2(QPointF(180, yOffset + 30), pressure);

                gc.paintLine(p1, p2, &dist);
            }

            yOffset += 60;
        }
    }

    QString m_presetFileName;
    QString m_prefix;
};

void KisColorsmudgeOpTest::test_data()
{
    QTest::addColumn<QString>("testName");
    QTest::addColumn<QString>("preset");
    QTest::addColumn<bool>("overlay");

    QStringList files = {
        "test_smudge_20px_dul_nsa_new.0001.kpp",
        "test_smudge_20px_dul_nsa_old.0001.kpp",
        "test_smudge_20px_dul_sa_new.0001.kpp",
        "test_smudge_20px_dul_sa_old.0001.kpp",
        "test_smudge_20px_sme_nsa_new.0001.kpp",
        "test_smudge_20px_sme_nsa_old.0001.kpp",
        "test_smudge_20px_sme_sa_new.0001.kpp",
        "test_smudge_20px_sme_sa_old.0001.kpp"
    };

    for (int i = 0; i < 2; i++) {
        const bool useOverlay = bool(i);
        Q_FOREACH (const QString &file, files) {
            QRegularExpression re("test_smudge_(.+).0001.kpp");
            const QString name = QString("%1_%2").arg(useOverlay ? "over" : "norm").arg(re.match(file).captured(1));
            const QByteArray nameLatin = name.toLatin1();
            QTest::addRow("%s", nameLatin.data()) << name << file << useOverlay;
        }
    }
}

void KisColorsmudgeOpTest::test()
{
    QFETCH(QString, testName);
    QFETCH(QString, preset);
    QFETCH(bool, overlay);

    TestColorsmudgeOp t;
    t.test(testName, preset, overlay);
}

namespace {

/// What one mixing run paints with.
struct MixingRun {
    QColor canvas {252, 211, 0};      // the paint already there
    QColor paint {0, 33, 133};        // the brush's colour
    QString model;                    // ToskaMixingModel; empty leaves the property out
    int mixOnBrush {-1};              // ToskaMixOnBrush: -1 leaves it out
    int mixInWetPaint {-1};           // ToskaMixInWetPaint: -1 leaves it out
    bool overlay {false};             // paint on an empty layer above the canvas paint, with MergedPaint
    bool lab {false};                 // a Lab 16-bit image
    QString compositeOp;              // the brush's blend mode; empty is Normal
    QColor second;                    // when valid: the right half of the canvas (x >= 100) holds this paint
    qreal colorRate {0.15};           // low: a stroke's overlapping dabs add up, and at 0.5 its middle is pure brush colour
};

class MixingPainter : public TestUtil::QImageBasedTest
{
public:
    MixingPainter() : QImageBasedTest("colorsmudgeop") {}

    /// One stroke across a 200x200 canvas; the painted layer as an image.
    QImage paint(const MixingRun &run) {
        KisSurrogateUndoStore *undoStore = new KisSurrogateUndoStore();
        KisImageSP image = createTrivialImage(undoStore);
        image->initialRefreshGraph();
        image->resizeImage(QRect(0, 0, 200, 200));
        image->waitForDone();
        if (run.lab) {
            image->convertImageColorSpace(KoColorSpaceRegistry::instance()->lab16(),
                                          KoColorConversionTransformation::internalRenderingIntent(),
                                          KoColorConversionTransformation::internalConversionFlags());
            image->waitForDone();
        }

        KisNodeSP paint1 = findNode(image->root(), "paint1");
        if (!paint1) return QImage();
        paint1->paintDevice()->fill(QRect(0, 0, 200, 200), KoColor(run.canvas, image->colorSpace()));
        if (run.second.isValid()) {
            paint1->paintDevice()->fill(QRect(100, 0, 100, 200), KoColor(run.second, image->colorSpace()));
        }

        KisNodeSP targetNode = paint1;
        if (run.overlay) {
            KisPaintLayerSP paint2 = new KisPaintLayer(image, "paint2", OPACITY_OPAQUE_U8);
            image->addNode(paint2, paint1->parent(), paint1);
            targetNode = paint2;
        }
        image->initialRefreshGraph();
        image->waitForDone();

        KisPainter gc(targetNode->paintDevice());

        QScopedPointer<KoCanvasResourceProvider> manager(
            utils::createResourceManager(image, 0, "test_smudge_20px_dul_nsa_new.0001.kpp"));
        manager->setResource(KoCanvasResource::ForegroundColor, KoColor(run.paint, image->colorSpace()));

        KisPaintOpPresetSP preset =
            manager->resource(KoCanvasResource::CurrentPaintOpPreset).value<KisPaintOpPresetSP>();
        if (!preset) return QImage();

        KisPaintOpSettingsSP settings = preset->settings();
        settings->setProperty("ColorRateValue", run.colorRate);
        if (run.overlay) settings->setProperty("MergedPaint", true);
        if (!run.model.isEmpty()) settings->setProperty("ToskaMixingModel", run.model);
        if (run.mixOnBrush >= 0) settings->setProperty("ToskaMixOnBrush", bool(run.mixOnBrush));
        if (run.mixInWetPaint >= 0) settings->setProperty("ToskaMixInWetPaint", bool(run.mixInWetPaint));

        KisResourcesSnapshotSP resources = new KisResourcesSnapshot(image, targetNode, manager.data());
        resources->setupPainter(&gc);
        if (!run.compositeOp.isEmpty()) {
            // the paint op reads the blend mode when it is made: make it again with the mode set
            gc.setCompositeOpId(run.compositeOp);
            gc.setPaintOpPreset(preset, targetNode, image);
        }

        KisDistanceInformation dist;
        gc.paintLine(KisPaintInformation(QPointF(20, 100), 1.0), KisPaintInformation(QPointF(180, 100), 1.0), &dist);

        return targetNode->paintDevice()->convertToQImage(0, QRect(0, 0, 200, 200));
    }
};

QImage paintRun(const MixingRun &run)
{
    MixingPainter painter;
    return painter.paint(run);
}

/// The mean colour of the stroke's middle (its centre line, away from both ends).
QColor strokeMiddle(const QImage &image)
{
    qreal r = 0, g = 0, b = 0, a = 0;
    int n = 0;
    for (int y = 98; y <= 102; y++) {
        for (int x = 80; x <= 120; x++) {
            const QColor c = image.pixelColor(x, y);
            r += c.redF(); g += c.greenF(); b += c.blueF(); a += c.alphaF();
            n++;
        }
    }
    return QColor::fromRgbF(r / n, g / n, b / n, a / n);
}

QByteArray describe(const QColor &c)
{
    return QString("(%1, %2, %3, a %4)").arg(c.red()).arg(c.green()).arg(c.blue()).arg(c.alpha()).toLatin1();
}

} // namespace

void KisColorsmudgeOpTest::testMixingOptionRoundTrip()
{
    KisColorSmudgeMixingOptionData written;
    written.model = "spectral";
    written.mixOnBrush = false;
    written.mixInWetPaint = true;

    KisPropertiesConfiguration config;
    written.write(&config);
    QCOMPARE(config.getString("ToskaMixingModel"), QString("spectral"));

    KisColorSmudgeMixingOptionData read;
    QVERIFY(read.read(&config));
    QVERIFY(read == written);
    QVERIFY(read.settings().model == KisPaintMix::Model::Spectral);
    QVERIFY(!read.settings().mixOnBrush);
    QVERIFY(read.settings().mixInWetPaint);

    // a preset that has none of the properties mixes as Krita always has
    KisPropertiesConfiguration empty;
    KisColorSmudgeMixingOptionData defaults;
    QVERIFY(defaults.read(&empty));
    QCOMPARE(defaults.model, QString("rgb"));
    QVERIFY(defaults.mixOnBrush);
    QVERIFY(!defaults.mixInWetPaint);
    QVERIFY(defaults.settings().model == KisPaintMix::Model::Rgb);
}

void KisColorsmudgeOpTest::testUnknownModelReadsAsRgb()
{
    KisPropertiesConfiguration config;
    config.setProperty("ToskaMixingModel", "oil");
    KisColorSmudgeMixingOptionData data;
    QVERIFY(data.read(&config));
    QCOMPARE(data.model, QString("rgb"));
    QVERIFY(data.settings().model == KisPaintMix::Model::Rgb);

    MixingRun unknown;
    unknown.model = "oil";
    MixingRun rgb;
    const QImage a = paintRun(unknown);
    QVERIFY(!a.isNull());
    QVERIFY(a == paintRun(rgb));
}

void KisColorsmudgeOpTest::testSpectralSmudgeBlueIntoYellowIsGreen()
{
    MixingRun run;                       // blue (0,33,133) into yellow (252,211,0)
    const QImage plain = paintRun(run);
    run.model = "spectral";
    const QImage spectral = paintRun(run);
    QVERIFY(!plain.isNull());
    QVERIFY(!spectral.isNull());

    const QColor mixed = strokeMiddle(spectral);
    const QColor lerped = strokeMiddle(plain);
    qInfo() << "blue into yellow: spectral" << describe(mixed).constData() << "rgb" << describe(lerped).constData();
    QVERIFY2(mixed.green() > mixed.red() && mixed.green() > mixed.blue(), describe(mixed).constData());
    // Krita's own blend of the same two paints is an olive: green never leads red
    QVERIFY2(!(lerped.green() > lerped.red()), describe(lerped).constData());
    // an explicit rgb is Krita's own blend, byte for byte
    run.model = "rgb";
    QVERIFY(paintRun(run) == plain);
}

void KisColorsmudgeOpTest::testPigmentComplementariesBrownOnCanvas()
{
    MixingRun run;
    run.canvas = QColor(25, 0, 89);      // ultramarine
    run.paint = QColor(255, 105, 0);     // orange
    run.model = "pigment";
    const QImage image = paintRun(run);
    QVERIFY(!image.isNull());

    const QColor mixed = strokeMiddle(image);
    qInfo() << "orange into ultramarine: pigment" << describe(mixed).constData();
    QVERIFY2(mixed.red() > mixed.green() && mixed.green() > mixed.blue(), describe(mixed).constData());
    QVERIFY2(mixed.hsvHue() >= 0 && mixed.hsvHue() <= 60, describe(mixed).constData());
    QVERIFY2(mixed.valueF() <= 0.7, describe(mixed).constData());
}

void KisColorsmudgeOpTest::testMixOnBrushOffIsRgb()
{
    MixingRun rgb;
    MixingRun off;
    off.model = "pigment";
    off.mixOnBrush = 0;
    MixingRun on;
    on.model = "pigment";
    const QImage plain = paintRun(rgb);
    QVERIFY(!plain.isNull());
    QVERIFY(paintRun(off) == plain);
    QVERIFY(paintRun(on) != plain);
}

void KisColorsmudgeOpTest::testMixInWetPaintStoredOnly()
{
    MixingRun off;
    off.model = "spectral";
    off.mixInWetPaint = 0;
    MixingRun on = off;
    on.mixInWetPaint = 1;
    const QImage a = paintRun(off);
    QVERIFY(!a.isNull());
    QVERIFY(a == paintRun(on));
}

void KisColorsmudgeOpTest::testNonRgbColourSpaceFallsBack()
{
    MixingRun rgb;
    rgb.lab = true;
    MixingRun spectral = rgb;
    spectral.model = "spectral";
    const QImage plain = paintRun(rgb);
    QVERIFY(!plain.isNull());
    QVERIFY(strokeMiddle(plain) != QColor(252, 211, 0));   // the stroke painted
    QVERIFY(paintRun(spectral) == plain);
}

void KisColorsmudgeOpTest::testNonNormalCompositeKeepsKritaOp()
{
    MixingRun rgb;
    rgb.compositeOp = COMPOSITE_MULT;
    MixingRun spectral = rgb;
    spectral.model = "spectral";
    const QImage plain = paintRun(rgb);
    QVERIFY(!plain.isNull());
    QVERIFY(strokeMiddle(plain) != QColor(252, 211, 0));
    QVERIFY(paintRun(spectral) == plain);
}

void KisColorsmudgeOpTest::testOverlayModeUsesModel()
{
    MixingRun run;
    run.overlay = true;
    const QImage plain = paintRun(run);
    run.model = "spectral";
    const QImage spectral = paintRun(run);
    QVERIFY(!plain.isNull());
    QVERIFY(!spectral.isNull());

    // the layer was empty: what it now holds is the brush's paint mixed with the yellow below
    const QColor mixed = strokeMiddle(spectral);
    const QColor lerped = strokeMiddle(plain);
    qInfo() << "overlay, blue over yellow below: spectral" << describe(mixed).constData() << "rgb" << describe(lerped).constData();
    QVERIFY2(mixed.alpha() > 200, describe(mixed).constData());
    QVERIFY2(mixed.green() > mixed.red() && mixed.green() > mixed.blue(), describe(mixed).constData());
    QVERIFY2(!(lerped.green() > lerped.red()), describe(lerped).constData());
}

void KisColorsmudgeOpTest::testBlendingWithoutPaintUsesModel()
{
    // A blender lays no colour: the brush only drags yellow into blue. The colours meet when the smeared dab is put
    // back on the layer through its soft mask, so that step has to mix by the model too.
    MixingRun run;
    run.second = QColor(0, 33, 133);
    run.colorRate = 0.0;
    const QImage plain = paintRun(run);
    run.model = "spectral";
    const QImage spectral = paintRun(run);
    QVERIFY(!plain.isNull());
    QVERIFY(!spectral.isNull());
    QVERIFY(spectral != plain);

    // where the two paints were dragged together: count the pixels that read as green
    auto greens = [](const QImage &image) {
        int n = 0;
        for (int y = 85; y <= 115; y++) {
            for (int x = 60; x <= 180; x++) {
                const QColor c = image.pixelColor(x, y);
                if (c.green() > c.red() + 8 && c.green() > c.blue() + 8) n++;
            }
        }
        return n;
    };
    const int mixed = greens(spectral), lerped = greens(plain);
    qInfo() << "blender across yellow|blue: green pixels, spectral" << mixed << "rgb" << lerped;
    QVERIFY2(mixed > lerped + 50, qPrintable(QString("%1 vs %2").arg(mixed).arg(lerped)));
}

void KisColorsmudgeOpTest::testPickedUpColourIsAveragedByTheModel()
{
    // The colour a smudge brush picks up is the average of the paint under it: yellow and blue in equal parts are a grey
    // by Krita's mixer and a green by the spectral and pigment models (the same colour libpaintmix's mixMany gives).
    const quint8 pixels[8] = {0, 211, 252, 255,   133, 33, 0, 255};        // B,G,R,A: yellow, blue
    const qint16 weights[2] = {100, 100};
    const KisPaintMix::Rgb colours[2] = {{252 / 255.0f, 211 / 255.0f, 0.0f}, {0.0f, 33 / 255.0f, 133 / 255.0f}};
    const float equal[2] = {1.0f, 1.0f};

    quint8 plain[4];
    QScopedPointer<KoMixColorsOp::Mixer> krita(KoColorSpaceRegistry::instance()->rgb8()->mixColorsOp()->createMixer());
    krita->accumulate(pixels, weights, 200, 2);
    krita->computeMixedColor(plain);
    QVERIFY(!(plain[1] > plain[2] + 8 && plain[1] > plain[0] + 8));

    for (KisPaintMix::Model model : {KisPaintMix::Model::Spectral, KisPaintMix::Model::Pigment}) {
        QScopedPointer<KoMixColorsOp::Mixer> mixer(KisColorSmudgeModelMixer::create(model, KisPaintMix::PixelFormat::Bgra8));
        QVERIFY(mixer);
        mixer->accumulate(pixels, weights, 200, 2);
        QCOMPARE(mixer->currentWeightsSum(), qint64(200));
        quint8 mixed[4];
        mixer->computeMixedColor(mixed);
        QVERIFY2(mixed[1] > mixed[2] + 8 && mixed[1] > mixed[0] + 8, qPrintable(QString("r %1 g %2 b %3").arg(mixed[2]).arg(mixed[1]).arg(mixed[0])));
        QCOMPARE(int(mixed[3]), 255);
        const KisPaintMix::Rgb expected = KisPaintMix::mixMany(model, colours, equal, 2);
        QVERIFY(qAbs(mixed[2] - expected.r * 255.0f) <= 2.0f);
        QVERIFY(qAbs(mixed[1] - expected.g * 255.0f) <= 2.0f);
        QVERIFY(qAbs(mixed[0] - expected.b * 255.0f) <= 2.0f);

        // a second read after more pixels: the running mean, with a transparent pixel adding weight but no colour
        const quint8 clear[4] = {9, 9, 9, 0};
        const qint16 one[1] = {200};
        mixer->accumulate(clear, one, 200, 1);
        quint8 thinner[4];
        mixer->computeMixedColor(thinner);
        QCOMPARE(int(thinner[2]), int(mixed[2]));
        QCOMPARE(int(thinner[1]), int(mixed[1]));
        QVERIFY(qAbs(int(thinner[3]) - 128) <= 1);
    }
    // the other models keep Krita's mixer
    QVERIFY(!KisColorSmudgeModelMixer::create(KisPaintMix::Model::Rgb, KisPaintMix::PixelFormat::Bgra8));
    QVERIFY(!KisColorSmudgeModelMixer::create(KisPaintMix::Model::LinearLight, KisPaintMix::PixelFormat::Bgra8));
}

KISTEST_MAIN(KisColorsmudgeOpTest)
