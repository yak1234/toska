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

#include "kis_mypaintop_test.h"
#include "MyPaintPaintOp.h"
#include "MyPaintSurface.h"
#include "MyPaintSensorPack.h"
#include "MyPaintPaintOpSettings.h"

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

SIMPLE_TEST_MAIN(KisMyPaintOpTest)
