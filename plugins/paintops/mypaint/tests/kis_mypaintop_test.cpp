/*
 *  SPDX-FileCopyrightText: 2020 Ashwin Dhakaita <ashwingpdhakaita@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#include <simpletest.h>
#include <QImageReader>
#include <QTest>
#include <qimage_based_test.h>

#include <kis_image.h>
#include <kis_node_facade.h>
#include <kis_group_layer.h>
#include <kis_paintop_preset.h>
#include <stroke_testing_utils.h>
#include <kis_paint_information.h>
#include <kis_random_accessor_ng.h>
#include <KisGlobalResourcesInterface.h>
#include <KoColorSpaceRegistry.h>
#include <KoCompositeOpRegistry.h>
#include <kis_paint_layer.h>
#include <kis_undo_stores.h>
#include <QDir>
#include <QFile>
#include <cmath>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QElapsedTimer>
#include <QColor>
#include <functional>
#include <random>
#include <kis_algebra_2d.h>
#include <algorithm>

#include "kis_mypaintop_test.h"
#include "MyPaintPaintOp.h"
#include "MyPaintSurface.h"
#include "MyPaintSensorPack.h"
#include "MyPaintPaintOpSettings.h"

#include <KisPaintMix.h>

#include <qimage_test_util.h>

class KisMyPaintOpSettings;
KisMyPaintOpTest::KisMyPaintOpTest(): TestUtil::QImageBasedTest("MyPaintOp")
{

}

void KisMyPaintOpTest::testDab() {

    KisPaintDeviceSP dst = new KisPaintDevice(KoColorSpaceRegistry::instance()->rgb8());
    KisPainter painter(dst);

    mypaint_brush_new();

    QScopedPointer<KisMyPaintSurface> surface(new KisMyPaintSurface(&painter, dst));

    surface->draw_dab(surface->surface(), 250, 250, 100, 0, 0, 1, 1, 0.8, 1, 1, 90, 0, 0);

    QImage img = dst->convertToQImage(0, dst->exactBounds().x(), dst->exactBounds().y(), dst->exactBounds().width(), dst->exactBounds().height());
    QImage source(QString(FILES_DATA_DIR) + QDir::separator() + "draw_dab.png");

    QPoint errpoint;
    if (!TestUtil::compareQImages(errpoint, source, img)) {
        img.save("mypaint_test_draw_dab.png");
        QFAIL(QString("Failed to create identical image, first different pixel: %1,%2 \n").arg(errpoint.x()).arg(errpoint.y()).toLatin1());
    }

}

void KisMyPaintOpTest::testGetColor() {

    KisPaintDeviceSP dst = new KisPaintDevice(KoColorSpaceRegistry::instance()->rgb8());

    QImage source(QString(FILES_DATA_DIR) + QDir::separator() + "draw_dab.png");
    dst->convertFromQImage(source, 0);

    KisPainter painter(dst);

    QScopedPointer<KisMyPaintSurface> surface(new KisMyPaintSurface(&painter, dst));

    surface->draw_dab(surface->surface(), 250, 250, 100, 0, 0, 1, 1, 0.8, 1, 1, 90, 0, 0);

    float r = 0.0f;
    float g = 0.0f;
    float b = 0.0f;
    float a = 0.0f;

    surface->get_color(surface->surface(), 250, 250, 100, &r, &g, &b, &a);

    QVERIFY(qFuzzyCompare((float)qRound(r), 0.0L));
    QVERIFY(qFuzzyCompare((float)qRound(g), 0.0L));
    QVERIFY(qFuzzyCompare((float)qRound(b), 1.0L));
    QVERIFY(qFuzzyCompare((float)qRound(a), 1.0L));
}

void KisMyPaintOpTest::testLoading() {

    QScopedPointer<KisMyPaintPaintOpPreset> brush (new KisMyPaintPaintOpPreset(QString(FILES_DATA_DIR) + QDir::separator() + "basic.myb"));
    brush->load(KisGlobalResourcesInterface::instance());
    QVERIFY(brush->valid());
}

/* Toska: libmypaint's spectral paint_mode (colour mixing, task 2) */

namespace {

const KoColorSpace *rgbF32()
{
    return KoColorSpaceRegistry::instance()->colorSpace(RGBAColorModelID.id(), Float32BitsColorDepthID.id(), QString());
}

// A colour from straight RGBA components, written as raw normalised channel values (no profile conversion), so
// every bit depth holds the same numbers the surface blends.
KoColor rawColor(const KoColorSpace *cs, float r, float g, float b, float a)
{
    const float rgba[4] = {r, g, b, a};
    QVector<float> values(4);
    const QList<KoChannelInfo *> channels = cs->channels();
    for (int i = 0; i < 4; i++) {
        values[i] = rgba[channels[i]->displayPosition()];
    }
    KoColor c(cs);
    cs->fromNormalisedChannelsValue(c.data(), values);
    return c;
}

QVector<float> rawPixel(KisPaintDeviceSP dev, int x, int y)
{
    KoColor c(dev->colorSpace());
    dev->pixel(x, y, &c);
    QVector<float> values(4);
    dev->colorSpace()->normalisedChannelsValue(c.data(), values);
    QVector<float> rgba(4);
    const QList<KoChannelInfo *> channels = dev->colorSpace()->channels();
    for (int i = 0; i < 4; i++) {
        rgba[channels[i]->displayPosition()] = values[i];
    }
    return rgba;
}

QByteArray allBytes(KisPaintDeviceSP dev, const QRect &rect)
{
    QByteArray bytes(rect.width() * rect.height() * dev->pixelSize(), 0);
    dev->readBytes(reinterpret_cast<quint8 *>(bytes.data()), rect);
    return bytes;
}

const float BLUE[3] = {0.0f / 255, 33.0f / 255, 133.0f / 255};
const float YELLOW[3] = {252.0f / 255, 211.0f / 255, 0.0f / 255};
const QRect AREA(0, 0, 100, 100);

void dabPigment(KisMyPaintSurface &surface, const float *c, float opaque, float paint)
{
    KisMyPaintSurface::draw_dab_pigment(surface.surface2(), 50, 50, 20, c[0], c[1], c[2], opaque, 1.0f, 1.0f,
                                        1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.05f, paint);
}

void dabLegacy(KisMyPaintSurface &surface, const float *c, float opaque)
{
    KisMyPaintSurface::draw_dab(surface.surface(), 50, 50, 20, c[0], c[1], c[2], opaque, 1.0f, 1.0f, 1.0f, 0.0f,
                                0.0f, 0.0f);
}

void checkBlueOnYellow(const KoColorSpace *cs)
{
    KisPaintDeviceSP spectral = new KisPaintDevice(cs);
    spectral->fill(AREA, rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));
    KisPaintDeviceSP legacy = new KisPaintDevice(cs);
    legacy->fill(AREA, rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));

    {
        KisPainter painter(spectral);
        KisMyPaintSurface surface(&painter, spectral);
        dabPigment(surface, BLUE, 0.5f, 1.0f);
    }
    {
        KisPainter painter(legacy);
        KisMyPaintSurface surface(&painter, legacy);
        dabLegacy(surface, BLUE, 0.5f);
    }

    const QVector<float> s = rawPixel(spectral, 50, 50);
    const QVector<float> l = rawPixel(legacy, 50, 50);
    qDebug() << cs->id() << "spectral" << s << "legacy" << l;
    QVERIFY2(s[1] > s[0] && s[1] > s[2], qPrintable(cs->id()));
    QVERIFY2(l[1] < l[0], qPrintable(cs->id()));
    QVERIFY(qFuzzyCompare(s[3], 1.0f));
}

}

void KisMyPaintOpTest::testLegacyUnlessPaintMode()
{
    const QDir brushes(QString(FILES_DATA_DIR) + "../../brushes");
    const QStringList files = brushes.entryList({"*.myb"}, QDir::Files);
    QVERIFY(files.size() >= 7);
    QVERIFY(files.contains("e)_Marker_Medium_(mypaint).myb"));

    Q_FOREACH (const QString &file, files) {
        KisMyPaintPaintOpPreset preset(brushes.absoluteFilePath(file));
        QVERIFY2(preset.load(KisGlobalResourcesInterface::instance()), qPrintable(file));
        KisPaintOpSettingsSP settings = preset.settings();
        QVERIFY(settings);

        // as the paintop sets its brush up
        KisMyPaintPaintOpPreset brush;
        brush.apply(settings);
        if (!settings->getString(MYPAINT_JSON).contains("\"paint_mode\"")) {
            // libmypaint's default paint_mode is 1: without applyToskaPaintMode these would leave the legacy path
            QVERIFY2(KisMyPaintPaintOp::usesPaintMode(brush.brush()), qPrintable(file));
        }
        KisMyPaintPaintOp::applyToskaPaintMode(brush.brush(), settings);
        QVERIFY2(!KisMyPaintPaintOp::usesPaintMode(brush.brush()), qPrintable(file));

        mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_PAINT_MODE, 1.0f);
        QVERIFY2(KisMyPaintPaintOp::usesPaintMode(brush.brush()), qPrintable(file));

        // the preset property opts in
        KisPaintOpSettingsSP optIn = settings->clone();
        optIn->setProperty("ToskaMyPaintPaintMode", 0.6);
        KisMyPaintPaintOpPreset painted;
        painted.apply(optIn);
        KisMyPaintPaintOp::applyToskaPaintMode(painted.brush(), optIn);
        QVERIFY2(KisMyPaintPaintOp::usesPaintMode(painted.brush()), qPrintable(file));
        QVERIFY(qFuzzyCompare(mypaint_brush_get_base_value(painted.brush(), MYPAINT_BRUSH_SETTING_PAINT_MODE), 0.6f));
    }
}

void KisMyPaintOpTest::testSpectralDabBlueOnYellowIsGreen()
{
    checkBlueOnYellow(KoColorSpaceRegistry::instance()->rgb8());
}

void KisMyPaintOpTest::testUnmixedDabIsExact()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    const float colour[3] = {51.0f / 255, 102.0f / 255, 204.0f / 255};

    KisPaintDeviceSP spectral = new KisPaintDevice(cs);
    KisPaintDeviceSP legacy = new KisPaintDevice(cs);
    {
        KisPainter painter(spectral);
        KisMyPaintSurface surface(&painter, spectral);
        dabPigment(surface, colour, 1.0f, 1.0f);
    }
    {
        KisPainter painter(legacy);
        KisMyPaintSurface surface(&painter, legacy);
        dabLegacy(surface, colour, 1.0f);
    }

    KoColor centre(cs);
    spectral->pixel(50, 50, &centre);
    QCOMPARE(centre, rawColor(cs, colour[0], colour[1], colour[2], 1.0f));
    QVERIFY(!spectral->exactBounds().isEmpty());
    QCOMPARE(spectral->exactBounds(), legacy->exactBounds());
    QCOMPARE(allBytes(spectral, AREA), allBytes(legacy, AREA));
}

void KisMyPaintOpTest::testSpectralDab16BitAndFloat()
{
    checkBlueOnYellow(KoColorSpaceRegistry::instance()->rgb16());
    checkBlueOnYellow(rgbF32());
}

void KisMyPaintOpTest::testEraserIgnoresPaintMode()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    KisPaintDeviceSP spectral = new KisPaintDevice(cs);
    spectral->fill(AREA, rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));
    KisPaintDeviceSP legacy = new KisPaintDevice(cs);
    legacy->fill(AREA, rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));
    {
        KisPainter painter(spectral);
        painter.setCompositeOpId(COMPOSITE_ERASE);
        KisMyPaintSurface surface(&painter, spectral);
        dabPigment(surface, BLUE, 0.7f, 1.0f);
    }
    {
        KisPainter painter(legacy);
        painter.setCompositeOpId(COMPOSITE_ERASE);
        KisMyPaintSurface surface(&painter, legacy);
        dabLegacy(surface, BLUE, 0.7f);
    }
    QVERIFY(rawPixel(spectral, 50, 50)[3] < 1.0f);
    QCOMPARE(allBytes(spectral, AREA), allBytes(legacy, AREA));
}

void KisMyPaintOpTest::testGetColorPigmentAveragesSpectrally()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    KisPaintDeviceSP dev = new KisPaintDevice(cs);
    dev->fill(QRect(0, 0, 50, 100), rawColor(cs, BLUE[0], BLUE[1], BLUE[2], 1.0f));
    dev->fill(QRect(50, 0, 50, 100), rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));

    KisPainter painter(dev);
    KisMyPaintSurface surface(&painter, dev);

    float r, g, b, a;
    KisMyPaintSurface::get_color_pigment(surface.surface2(), 50, 50, 20, &r, &g, &b, &a, 1.0f);
    qDebug() << "spectral average" << r << g << b << a;
    QVERIFY(g > r);
    QVERIFY(qFuzzyCompare(a, 1.0f));

    float lr, lg, lb, la;
    KisMyPaintSurface::get_color(surface.surface(), 50, 50, 20, &lr, &lg, &lb, &la);
    QVERIFY(lg < lr);
    KisMyPaintSurface::get_color_pigment(surface.surface2(), 50, 50, 20, &r, &g, &b, &a, -1.0f);
    QCOMPARE(r, lr);
    QCOMPARE(g, lg);
    QCOMPARE(b, lb);
    QCOMPARE(a, la);
}

void KisMyPaintOpTest::testSampleMergedReadsBelow()
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    KisImageSP image = new KisImage(new KisSurrogateUndoStore(), 100, 100, cs, "sample merged");
    KisPaintLayerSP below = new KisPaintLayer(image, "below", OPACITY_OPAQUE_U8);
    below->paintDevice()->fill(AREA, rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));
    KisPaintLayerSP paint = new KisPaintLayer(image, "paint", OPACITY_OPAQUE_U8);
    image->addNode(below);
    image->addNode(paint);
    image->initialRefreshGraph();
    image->waitForDone();

    KisPainter painter(paint->paintDevice());
    float r, g, b, a;
    {
        KisMyPaintSurface surface(&painter, nullptr, image, true);
        KisMyPaintSurface::get_color_pigment(surface.surface2(), 50, 50, 10, &r, &g, &b, &a, -1.0f);
        QVERIFY(qAbs(r - YELLOW[0]) < 0.01f);
        QVERIFY(qAbs(g - YELLOW[1]) < 0.01f);
        QVERIFY(qAbs(b - YELLOW[2]) < 0.01f);
        QVERIFY(qFuzzyCompare(a, 1.0f));
    }
    {
        KisMyPaintSurface surface(&painter, nullptr, image, false);
        KisMyPaintSurface::get_color_pigment(surface.surface2(), 50, 50, 10, &r, &g, &b, &a, -1.0f);
        QCOMPARE(a, 0.0f);
    }
}

namespace {

// basic.myb's JSON, with paint_mode set (base value, optional pressure mapping) or removed
QByteArray basicJson(bool withPaintMode, bool withMapping)
{
    QFile file(QString(FILES_DATA_DIR) + "basic.myb");
    if (!file.open(QIODevice::ReadOnly)) {
        return QByteArray();
    }
    QJsonObject root = QJsonDocument::fromJson(file.readAll()).object();
    QJsonObject settings = root.value("settings").toObject();
    settings.remove("paint_mode");
    if (withPaintMode) {
        QJsonObject inputs;
        if (withMapping) {
            inputs.insert("pressure", QJsonArray{QJsonArray{0.0, 0.0}, QJsonArray{1.0, 1.0}});
        }
        settings.insert("paint_mode", QJsonObject{{"base_value", 1.0}, {"inputs", inputs}});
    }
    root.insert("settings", settings);
    return QJsonDocument(root).toJson();
}

KisPaintOpSettingsSP mypaintSettings(const QByteArray &json, const QVariant &toskaPaintMode = QVariant())
{
    KisPaintOpSettingsSP settings = new KisMyPaintOpSettings(KisGlobalResourcesInterface::instance());
    settings->setProperty("paintop", "mypaintbrush");
    settings->setProperty(MYPAINT_JSON, json);
    if (toskaPaintMode.isValid()) {
        settings->setProperty("ToskaMyPaintPaintMode", toskaPaintMode);
    }
    return settings;
}

// A blue stroke over yellow through the paintop's own entry-point choice; the pixels it leaves
QByteArray paintStroke(KisPaintOpSettingsSP settings, bool *paintMode)
{
    const KoColorSpace *cs = KoColorSpaceRegistry::instance()->rgb8();
    const QRect area(0, 0, 200, 100);
    KisPaintDeviceSP dev = new KisPaintDevice(cs);
    dev->fill(area, rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));
    KisPainter painter(dev);
    KisMyPaintSurface surface(&painter, dev);

    KisMyPaintPaintOpPreset brush;
    brush.apply(settings);
    KisMyPaintPaintOp::applyToskaPaintMode(brush.brush(), settings);
    *paintMode = KisMyPaintPaintOp::usesPaintMode(brush.brush());
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_RADIUS_LOGARITHMIC, std::log(8.0f));
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_COLOR_H, 0.64f);
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_COLOR_S, 1.0f);
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_COLOR_V, 0.52f);

    KisMyPaintPaintOp::strokeBrushTo(brush.brush(), &surface, 20, 50, 0.8f, 0, 0, 1.0);
    for (int i = 1; i <= 40; i++) {
        KisMyPaintPaintOp::strokeBrushTo(brush.brush(), &surface, 20 + i * 4, 50, 0.8f, 0, 0, 0.015);
    }
    return allBytes(dev, area);
}

}

void KisMyPaintOpTest::testJsonPaintModeAloneStaysLegacy()
{
    const QByteArray withPaintMode = basicJson(true, false);
    const QByteArray without = basicJson(false, false);
    QVERIFY(withPaintMode.contains("\"paint_mode\""));
    QVERIFY(!without.contains("\"paint_mode\""));

    bool paintMode = true;
    const QByteArray painted = paintStroke(mypaintSettings(withPaintMode), &paintMode);
    QVERIFY(!paintMode);
    bool referenceMode = true;
    const QByteArray reference = paintStroke(mypaintSettings(without), &referenceMode);
    QVERIFY(!referenceMode);
    QCOMPARE(painted, reference);

    // the property opts in, and the stroke then differs (the comparison above can see a change)
    bool optedIn = false;
    const QByteArray spectral = paintStroke(mypaintSettings(without, 1.0), &optedIn);
    QVERIFY(optedIn);
    QVERIFY(spectral != reference);
}

void KisMyPaintOpTest::testToskaZeroForcesLegacyEvenWithMappings()
{
    const QByteArray mapped = basicJson(true, true);
    QVERIFY(mapped.contains("\"pressure\""));

    // the mapping alone would make libmypaint leave the legacy path
    KisPaintOpSettingsSP settings = mypaintSettings(mapped, 0.0);
    KisMyPaintPaintOpPreset raw;
    raw.apply(settings);
    QVERIFY(!mypaint_brush_is_constant(raw.brush(), MYPAINT_BRUSH_SETTING_PAINT_MODE));
    QVERIFY(KisMyPaintPaintOp::usesPaintMode(raw.brush()));

    bool paintMode = true;
    const QByteArray painted = paintStroke(settings, &paintMode);
    QVERIFY(!paintMode);
    bool referenceMode = true;
    const QByteArray reference = paintStroke(mypaintSettings(basicJson(false, false)), &referenceMode);
    QVERIFY(!referenceMode);
    QCOMPARE(painted, reference);

    // and without the property, the same
    bool absentMode = true;
    QCOMPARE(paintStroke(mypaintSettings(mapped), &absentMode), reference);
    QVERIFY(!absentMode);
}

namespace {

// Counts the dabs and colour samples a stroke makes and times the samples: the surface's entry points, wrapped
int g_dabCount = 0;
float g_firstDabX = 0.0f;
int g_sampleCount = 0;
qint64 g_sampleNsecs = 0;

void countingGetColor(MyPaintSurface *self, float x, float y, float radius, float *r, float *g, float *b, float *a)
{
    g_sampleCount++;
    QElapsedTimer t;
    t.start();
    KisMyPaintSurface::get_color(self, x, y, radius, r, g, b, a);
    g_sampleNsecs += t.nsecsElapsed();
}

void countingGetColorPigment(MyPaintSurface2 *self, float x, float y, float radius, float *r, float *g, float *b,
                             float *a, float paint)
{
    g_sampleCount++;
    QElapsedTimer t;
    t.start();
    KisMyPaintSurface::get_color_pigment(self, x, y, radius, r, g, b, a, paint);
    g_sampleNsecs += t.nsecsElapsed();
}

int countingDrawDab(MyPaintSurface *self, float x, float y, float radius, float r, float g, float b, float opaque,
                    float hardness, float a, float aspect, float angle, float lockAlpha, float colorize)
{
    if (g_dabCount++ == 0) {
        g_firstDabX = x;
    }
    return KisMyPaintSurface::draw_dab(self, x, y, radius, r, g, b, opaque, hardness, a, aspect, angle, lockAlpha,
                                       colorize);
}

int countingDrawDabPigment(MyPaintSurface2 *self, float x, float y, float radius, float r, float g, float b,
                           float opaque, float hardness, float a, float aspect, float angle, float lockAlpha,
                           float colorize, float posterize, float posterizeNum, float paint)
{
    if (g_dabCount++ == 0) {
        g_firstDabX = x;
    }
    return KisMyPaintSurface::draw_dab_pigment(self, x, y, radius, r, g, b, opaque, hardness, a, aspect, angle,
                                               lockAlpha, colorize, posterize, posterizeNum, paint);
}

struct StrokeSetup {
    const KoColorSpace *cs {KoColorSpaceRegistry::instance()->rgb8()};
    int width {2000};
    int height {2000};
    float radius {20.0f};
    int events {200};          ///< motion events, 4 px apart, along y = start.y()
    float pressure {0.9f};
    QPointF start {600, 1000};
    QColor colour {230, 90, 30}; ///< orange #e65a1e
};

struct StrokeResult {
    qint64 nsecs {0};
    int dabs {0};
    float firstDabX {0.0f};
    int samples {0};
    qint64 sampleNsecs {0};
    KisPaintDeviceSP device;
};

KisPaintOpSettingsSP presetSettings(const QString &file, const QVariant &toskaPaintMode = QVariant())
{
    KisMyPaintPaintOpPreset preset(QString(FILES_DATA_DIR) + "../../brushes/" + file);
    if (!preset.load(KisGlobalResourcesInterface::instance())) {
        return nullptr;
    }
    KisPaintOpSettingsSP settings = preset.settings()->clone();
    if (toskaPaintMode.isValid()) {
        settings->setProperty("ToskaMyPaintPaintMode", toskaPaintMode);
    }
    return settings;
}

/**
 * A stroke across a blue | yellow ground (the halves meet at width / 2) through the paintop's own entry point
 * (strokeBrushTo) and a surface set up as the paintop sets it up (an image, no paint node), so get_color reads the
 * layer as it does live. Only the stroke is timed. tweak changes the brush after the preset is applied.
 */
StrokeResult paintPresetStroke(KisPaintOpSettingsSP settings, const StrokeSetup &setup,
                               const std::function<void(MyPaintBrush *)> &tweak = {})
{
    const KoColorSpace *cs = setup.cs;
    KisImageSP image = new KisImage(new KisSurrogateUndoStore(), setup.width, setup.height, cs, "stroke");
    KisPaintLayerSP layer = new KisPaintLayer(image, "paint", OPACITY_OPAQUE_U8);
    image->addNode(layer);
    KisPaintDeviceSP dev = layer->paintDevice();
    const int half = setup.width / 2;
    dev->fill(QRect(0, 0, half, setup.height), rawColor(cs, BLUE[0], BLUE[1], BLUE[2], 1.0f));
    dev->fill(QRect(half, 0, setup.width - half, setup.height), rawColor(cs, YELLOW[0], YELLOW[1], YELLOW[2], 1.0f));

    KisPainter painter(dev);
    KisMyPaintSurface surface(&painter, nullptr, image, false);
    surface.surface()->draw_dab = countingDrawDab;
    surface.surface2()->draw_dab_pigment = countingDrawDabPigment;
    surface.surface()->get_color = countingGetColor;
    surface.surface2()->get_color_pigment = countingGetColorPigment;

    KisMyPaintPaintOpPreset brush;
    brush.apply(settings);
    KisMyPaintPaintOp::applyToskaPaintMode(brush.brush(), settings);
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_SLOW_TRACKING, 0.0);
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_RADIUS_LOGARITHMIC, std::log(setup.radius));
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_COLOR_H, setup.colour.hsvHueF());
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_COLOR_S, setup.colour.hsvSaturationF());
    mypaint_brush_set_base_value(brush.brush(), MYPAINT_BRUSH_SETTING_COLOR_V, setup.colour.valueF());
    if (tweak) {
        tweak(brush.brush());
    }

    g_dabCount = 0;
    g_sampleCount = 0;
    g_sampleNsecs = 0;
    QElapsedTimer timer;
    timer.start();
    const QPointF start = setup.start;
    KisMyPaintPaintOp::strokeBrushTo(brush.brush(), &surface, start.x(), start.y(), setup.pressure, 0, 0, 1.0);
    for (int i = 1; i <= setup.events; i++) {
        KisMyPaintPaintOp::strokeBrushTo(brush.brush(), &surface, start.x() + i * 4, start.y(), setup.pressure, 0, 0,
                                         0.015);
    }
    StrokeResult result;
    result.nsecs = timer.nsecsElapsed();
    result.dabs = g_dabCount;
    result.firstDabX = g_firstDabX;
    result.samples = g_sampleCount;
    result.sampleNsecs = g_sampleNsecs;
    result.device = dev;
    return result;
}

qint64 median(QVector<qint64> v)
{
    std::sort(v.begin(), v.end());
    return v.isEmpty() ? 0 : v[v.size() / 2];
}

}

namespace {

// The strokes testSpectralStrokesMatchBefore pins: a preset, spectral or legacy, and the largest channel difference
// (of 255) allowed against the image the code before the speed work painted
struct PinnedStroke {
    const char *name;
    const char *preset;
    bool spectral;
    int tolerance;
};

const PinnedStroke pinnedStrokes[] = {
    {"wet_paint_spectral", "i)_Wet_Paint_Plus_(mypaint).myb", true, 2},
    {"marker_plain_spectral", "e)_Marker_Plain_(mypaint).myb", true, 2},
    {"wet_knife_spectral", "i)_Wet_Knife_Plus_(mypaint).myb", true, 2},
    {"wet_paint_legacy", "i)_Wet_Paint_Plus_(mypaint).myb", false, 0},
    {"marker_plain_legacy", "e)_Marker_Plain_(mypaint).myb", false, 0},
};

StrokeSetup pinnedSetup()
{
    StrokeSetup setup;
    setup.width = 400;
    setup.height = 200;
    setup.start = QPointF(100, 100);
    setup.events = 50;
    return setup;
}

}

void KisMyPaintOpTest::testSpectralStrokesMatchBefore()
{
    // The images were painted by the code before task 7a (exact mix2 per pixel, every pixel of a colour sample);
    // TOSKA_WRITE_GOLDEN=<folder> writes them instead of comparing.
    const QString writeTo = qEnvironmentVariable("TOSKA_WRITE_GOLDEN");
    const StrokeSetup setup = pinnedSetup();
    QStringList failures;
    for (const PinnedStroke &pinned : pinnedStrokes) {
        KisPaintOpSettingsSP settings = presetSettings(pinned.preset, pinned.spectral ? QVariant(1.0) : QVariant());
        QVERIFY(settings);
        const StrokeResult result = paintPresetStroke(settings, setup);
        QVERIFY(result.device);
        const QImage painted = result.device->convertToQImage(nullptr, 0, 0, setup.width, setup.height);
        const QString file = QString("spectral_before_%1.png").arg(pinned.name);
        if (!writeTo.isEmpty()) {
            QVERIFY(painted.save(QDir(writeTo).absoluteFilePath(file)));
            continue;
        }
        const QImage before(QString(FILES_DATA_DIR) + file);
        QVERIFY2(!before.isNull(), qPrintable(file));
        QCOMPARE(before.size(), painted.size());
        const QImage a = before.convertToFormat(QImage::Format_ARGB32);
        const QImage b = painted.convertToFormat(QImage::Format_ARGB32);
        int worst = 0;
        int differing = 0;
        for (int y = 0; y < a.height(); y++) {
            const QRgb *ra = reinterpret_cast<const QRgb *>(a.constScanLine(y));
            const QRgb *rb = reinterpret_cast<const QRgb *>(b.constScanLine(y));
            for (int x = 0; x < a.width(); x++) {
                const int d = qMax(qMax(qAbs(qRed(ra[x]) - qRed(rb[x])), qAbs(qGreen(ra[x]) - qGreen(rb[x]))),
                                   qMax(qAbs(qBlue(ra[x]) - qBlue(rb[x])), qAbs(qAlpha(ra[x]) - qAlpha(rb[x]))));
                worst = qMax(worst, d);
                differing += d > 0;
            }
        }
        qInfo().noquote() << QString("%1: largest difference %2/255, %3 pixels differ").arg(pinned.name).arg(worst)
                                 .arg(differing);
        if (worst > pinned.tolerance) {
            failures << file;
        }
    }
    QVERIFY2(failures.isEmpty(), qPrintable(failures.join(", ")));
    if (!writeTo.isEmpty()) {
        QSKIP("wrote the images");
    }
}

namespace {

const float ORANGE[3] = {230.0f / 255, 90.0f / 255, 30.0f / 255};

KisPaintMix::Rgb rgbOf(const float *c)
{
    return {c[0], c[1], c[2]};
}

KisPaintMix::Rgb pixelRgb(KisPaintDeviceSP dev, int x, int y)
{
    const QVector<float> p = rawPixel(dev, x, y);
    return {p[0], p[1], p[2]};
}

// The mean colour of row y over [x0, x1)
KisPaintMix::Rgb rowMean(KisPaintDeviceSP dev, int y, int x0, int x1)
{
    KisPaintMix::Rgb sum {0, 0, 0};
    for (int x = x0; x < x1; x++) {
        const KisPaintMix::Rgb p = pixelRgb(dev, x, y);
        sum.r += p.r;
        sum.g += p.g;
        sum.b += p.b;
    }
    const float n = x1 - x0;
    return {sum.r / n, sum.g / n, sum.b / n};
}

float maxDifference(KisPaintMix::Rgb a, KisPaintMix::Rgb b)
{
    return qMax(qMax(qAbs(a.r - b.r), qAbs(a.g - b.g)), qAbs(a.b - b.b));
}

// The spectral share t of paint over ground that mix2 needs to give the colour, and how close it gets
float spectralShare(KisPaintMix::Rgb ground, KisPaintMix::Rgb paint, KisPaintMix::Rgb colour, float *residual)
{
    float best = 0.0f;
    float bestError = 1e9f;
    for (int i = 0; i <= 10000; i++) {
        const float t = i / 10000.0f;
        const float e = maxDifference(KisPaintMix::mix2(KisPaintMix::Model::Spectral, ground, paint, t), colour);
        if (e < bestError) {
            bestError = e;
            best = t;
        }
    }
    *residual = bestError;
    return best;
}

// The value of a brush setting at a pressure: its base value plus the pressure mapping, linearly interpolated
float settingAtPressure(MyPaintBrush *brush, MyPaintBrushSetting setting, float pressure)
{
    float value = mypaint_brush_get_base_value(brush, setting);
    const int n = mypaint_brush_get_mapping_n(brush, setting, MYPAINT_BRUSH_INPUT_PRESSURE);
    for (int i = 0; i + 1 < n; i++) {
        float x0, y0, x1, y1;
        mypaint_brush_get_mapping_point(brush, setting, MYPAINT_BRUSH_INPUT_PRESSURE, i, &x0, &y0);
        mypaint_brush_get_mapping_point(brush, setting, MYPAINT_BRUSH_INPUT_PRESSURE, i + 1, &x1, &y1);
        if (pressure >= x0 && pressure <= x1) {
            value += y0 + (y1 - y0) * (pressure - x0) / (x1 - x0);
            break;
        }
    }
    return value;
}

// Marker Plain over the blue half: the stroke of the live probe (orange, radius 20, pressure 0.9)
StrokeSetup markerSetup(const KoColorSpace *cs)
{
    StrokeSetup setup;
    setup.cs = cs;
    setup.width = 600;
    setup.height = 200;
    setup.start = QPointF(60, 100);
    setup.events = 120;
    return setup;
}

}

void KisMyPaintOpTest::testGetColorPigmentMatchesMixMany()
{
    // The spectral sample groups equal pixels and caches their log spectra; it must still be mixMany over every pixel
    // of the sample square, each weighted as get_color weights it (qRound((1 - rr) * 255) inside the circle, 255
    // outside it, as Krita's get_color does) times its alpha.
    const QList<const KoColorSpace *> spaces = {KoColorSpaceRegistry::instance()->rgb8(),
                                                KoColorSpaceRegistry::instance()->rgb16()};
    for (const KoColorSpace *cs : spaces) {
        KisPaintDeviceSP dev = new KisPaintDevice(cs);
        std::mt19937 gen(7);
        std::uniform_int_distribution<int> d(0, 255);
        for (int y = 0; y < 100; y++) {
            for (int x = 0; x < 100; x++) {
                // flat patches, noise and translucent pixels
                const bool flat = (x / 10 + y / 10) % 3 == 0;
                const float a = (x + y) % 7 == 0 ? d(gen) / 255.0f : 1.0f;
                dev->setPixel(x, y, flat ? rawColor(cs, BLUE[0], BLUE[1], BLUE[2], 1.0f)
                                         : rawColor(cs, d(gen) / 255.0f, d(gen) / 255.0f, d(gen) / 255.0f, a));
            }
        }
        KisPainter painter(dev);
        KisMyPaintSurface surface(&painter, dev);
        const float cx = 50.3f, cy = 49.6f, radius = 20.0f;
        float r, g, b, a;
        KisMyPaintSurface::get_color_pigment(surface.surface2(), cx, cy, radius, &r, &g, &b, &a, 1.0f);

        const QRect square(QPoint(cx - radius, cy - radius), QSize(2 * radius, 2 * radius));
        KisAlgebra2D::OuterCircle outer(QPointF(cx, cy), radius);
        QVector<KisPaintMix::Rgb> colours;
        QVector<float> weights;
        for (int y = square.top(); y <= square.bottom(); y++) {
            for (int x = square.left(); x <= square.right(); x++) {
                float rr = 0.0f;
                if (outer.fadeSq(QPointF(x, y)) <= 1.0) {
                    const float yy = y + 0.5f - cy, xx = x + 0.5f - cx;
                    rr = qMax((yy * yy + xx * xx) / (radius * radius), 0.0f);
                }
                const QVector<float> p = rawPixel(dev, x, y);
                colours << KisPaintMix::Rgb{p[0], p[1], p[2]};
                weights << qMax(0, int(qRound((1.0f - rr) * 255))) * p[3];
            }
        }
        const KisPaintMix::Rgb expected = KisPaintMix::mixMany(KisPaintMix::Model::Spectral, colours.constData(),
                                                               weights.constData(), colours.size());
        const float worst = maxDifference({r, g, b}, expected);
        qDebug() << cs->id() << "get_color_pigment - mixMany:" << worst * 255 << "/255";
        QVERIFY2(worst <= 0.5f / 255, qPrintable(cs->id()));
    }
}

void KisMyPaintOpTest::testSpectralStrokeStartsLikeLegacy()
{
    // libmypaint 1.6.1's first stroke_to_2 dab reads settings before they are computed (uninitialised memory), so the
    // stroke's first dabs moved by up to two dab spacings from run to run; primed (primeForStrokeTo2), the spectral
    // stroke starts where the legacy one does, every time.
    StrokeSetup setup = pinnedSetup();
    setup.events = 10;
    const QStringList presets = {"i)_Wet_Paint_Plus_(mypaint).myb", "e)_Marker_Plain_(mypaint).myb"};
    for (const QString &file : presets) {
        const StrokeResult legacy = paintPresetStroke(presetSettings(file), setup);
        for (int i = 0; i < 3; i++) {
            const StrokeResult spectral = paintPresetStroke(presetSettings(file, 1.0), setup);
            QCOMPARE(spectral.firstDabX, legacy.firstDabX);
            QCOMPARE(spectral.dabs, legacy.dabs);
        }
    }
}

void KisMyPaintOpTest::testSpectralSmudgeFavoursBrushColour()
{
    // Task 7's live probe saw Wet Paint Plus lay more paint in spectral mode (paint share .91 against .83). Not more
    // dabs: both paths lay the same dabs, and the stroke is opaque in both, so its colour is the dab colour, the brush
    // colour smudged with the canvas. libmypaint's spectral smudge (mix_colors, helpers.c 564-606) weights the smudge
    // colour by s * a / (a + b * (1 - s)), for two opaque colours s / (2 - s) instead of the legacy s, so the brush
    // colour wins more: at pressure 0.9, s = 0.55 becomes 0.38.
    const StrokeSetup setup = markerSetup(rgbF32());
    const QString file = "i)_Wet_Paint_Plus_(mypaint).myb";
    const StrokeResult legacy = paintPresetStroke(presetSettings(file), setup);
    const StrokeResult spectral = paintPresetStroke(presetSettings(file, 1.0), setup);
    QCOMPARE(spectral.dabs, legacy.dabs);

    const KisPaintMix::Rgb ground = rgbOf(BLUE), paint = rgbOf(ORANGE);
    const KisPaintMix::Rgb l = rowMean(legacy.device, 100, 150, 250);
    const float legacyShare = (l.r - ground.r) / (paint.r - ground.r);
    float residual = 0.0f;
    const float spectralShare_ = spectralShare(ground, paint, rowMean(spectral.device, 100, 150, 250), &residual);
    QVERIFY(residual < 1.0f / 255);

    // the same share at the band's edge: the dab colour, not the coverage, differs
    const KisPaintMix::Rgb edge = rowMean(legacy.device, 85, 150, 250);
    QVERIFY(qAbs((edge.r - ground.r) / (paint.r - ground.r) - legacyShare) < 0.01f);

    // steady state of the smudge: c = s * (alpha * c + (1 - alpha) * ground) + (1 - s) * paint, so the paint share is
    // (1 - s) / (1 - s * alpha); alpha (how much of the sample is the stroke itself) from the legacy stroke, then the
    // spectral share predicted with s / (2 - s)
    KisPaintOpSettingsSP settings = presetSettings(file);
    KisMyPaintPaintOpPreset brush;
    brush.apply(settings);
    const float s = settingAtPressure(brush.brush(), MYPAINT_BRUSH_SETTING_SMUDGE, setup.pressure);
    const float alpha = (1.0f - (1.0f - s) / legacyShare) / s;
    const float sSpectral = s / (2.0f - s);
    const float predicted = (1.0f - sSpectral) / (1.0f - sSpectral * alpha);
    qDebug() << "smudge" << s << "spectral weight" << sSpectral << "legacy share" << legacyShare << "spectral share"
             << spectralShare_ << "predicted" << predicted;
    QVERIFY(spectralShare_ > legacyShare + 0.04f);
    QVERIFY(qAbs(spectralShare_ - predicted) < 0.01f);
}

void KisMyPaintOpTest::testMarkerFringesAreTheSpectralModel()
{
    // Marker Plain over dark blue (live probe): green, dark fringes on the band's soft edges. The edge pixels are
    // mix2's spectral mix of the ground and the paint at some share (the model: blue and orange pass through green),
    // in float as in 8 bits, not an artefact of the blend. (Within 2/255, not exactly: each dab's result is clamped
    // to 0..1, the red channel here to 0 at first, before the next dab mixes it again.)
    const StrokeResult stroke = paintPresetStroke(presetSettings("e)_Marker_Plain_(mypaint).myb", 1.0),
                                                  markerSetup(rgbF32()));
    const KisPaintMix::Rgb ground = rgbOf(BLUE), paint = rgbOf(ORANGE);
    int greenRows = 0;
    for (int y = 81; y <= 85; y++) {
        const KisPaintMix::Rgb edge = pixelRgb(stroke.device, 200, y);
        float residual = 0.0f;
        const float t = spectralShare(ground, paint, edge, &residual);
        qDebug() << "row" << y << edge.r * 255 << edge.g * 255 << edge.b * 255 << "share" << t << "residual"
                 << residual * 255;
        QVERIFY(residual <= 2.0f / 255);
        greenRows += edge.g > edge.r && edge.g > edge.b;
    }
    QVERIFY(greenRows >= 2);
}

void KisMyPaintOpTest::testMarkerRippleComesFromEightBitBlending()
{
    // The dotted ripple along Marker Plain's band (live: R 128-137) is the dabs' spacing, made visible by the
    // spectral curve and widened by 8 bits: each dab's result is rounded to the layer and the next dabs blend from
    // there, and a pixel stops moving where one dab changes it by less than half a level. In float (or a 16-bit
    // layer) the same stroke ripples about a third as much. (libmypaint's own surface keeps 15 bits.)
    auto rippleRange = [](const KoColorSpace *cs) {
        const StrokeResult stroke = paintPresetStroke(presetSettings("e)_Marker_Plain_(mypaint).myb", 1.0),
                                                      markerSetup(cs));
        float lo = 1.0f, hi = 0.0f;
        for (int x = 120; x < 280; x++) {
            const float r = pixelRgb(stroke.device, x, 100).r;
            lo = qMin(lo, r);
            hi = qMax(hi, r);
        }
        return (hi - lo) * 255;
    };
    const float eightBit = rippleRange(KoColorSpaceRegistry::instance()->rgb8());
    const float floating = rippleRange(rgbF32());
    qDebug() << "red range along the band: 8-bit" << eightBit << "float" << floating;
    QVERIFY(floating <= 4.0f);
    QVERIFY(eightBit >= 2.0f * floating);
}

void KisMyPaintOpTest::benchmarkSpectralPaintMode()
{
    // The same stroke, legacy (no ToskaMyPaintPaintMode) and spectral (ToskaMyPaintPaintMode 1): 200 events of 4 px,
    // radius 20, pressure 0.9, over a 2000 x 2000 rgb8 blue | yellow ground. The ratio of medians is printed, not
    // asserted (it means something only in a Release build, and CI machines vary). TOSKA_BENCH_REPS sets the runs per
    // arm (default 3); TOSKA_BENCH_ONLY=spectral or legacy runs one arm only, for a profiler.
    const int reps = qMax(1, qEnvironmentVariableIsSet("TOSKA_BENCH_REPS") ? qEnvironmentVariableIntValue("TOSKA_BENCH_REPS") : 3);
    const QByteArray only = qgetenv("TOSKA_BENCH_ONLY");
    const StrokeSetup setup;
    const QStringList presets = {"i)_Wet_Paint_Plus_(mypaint).myb", "e)_Marker_Plain_(mypaint).myb"};
    Q_FOREACH (const QString &file, presets) {
        KisPaintOpSettingsSP legacy = presetSettings(file);
        KisPaintOpSettingsSP spectral = presetSettings(file, 1.0);
        QVERIFY(legacy);
        QVERIFY(spectral);

        QVector<qint64> times[2], sampleTimes[2];
        int dabs[2] = {0, 0}, samples[2] = {0, 0};
        for (int rep = 0; rep < reps; rep++) {
            for (int arm = 0; arm < 2; arm++) {
                if ((arm == 0 && only == "spectral") || (arm == 1 && only == "legacy")) continue;
                const StrokeResult r = paintPresetStroke(arm == 0 ? legacy : spectral, setup);
                times[arm] << r.nsecs;
                sampleTimes[arm] << r.sampleNsecs;
                dabs[arm] = r.dabs;
                samples[arm] = r.samples;
            }
        }
        const qint64 l = median(times[0]), s = median(times[1]);
        qInfo().noquote() << QString("BENCH %1: legacy %2 ms (%3 dabs, %4 samples %5 ms), spectral %6 ms (%7 dabs, "
                                     "%8 samples %9 ms), ratio %10")
                                 .arg(file)
                                 .arg(l / 1e6, 0, 'f', 1).arg(dabs[0]).arg(samples[0])
                                 .arg(median(sampleTimes[0]) / 1e6, 0, 'f', 1)
                                 .arg(s / 1e6, 0, 'f', 1).arg(dabs[1]).arg(samples[1])
                                 .arg(median(sampleTimes[1]) / 1e6, 0, 'f', 1)
                                 .arg(l > 0 ? double(s) / double(l) : 0.0, 0, 'f', 2);
    }
}

SIMPLE_TEST_MAIN(KisMyPaintOpTest)
