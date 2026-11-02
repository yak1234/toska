/*
 *  SPDX-FileCopyrightText: 2020 Ashwin Dhakaita <ashwingpdhakaita@gmail.com>
 *
 *  SPDX-License-Identifier: LGPL-2.0-or-later
 */

#include "MyPaintPaintOp.h"

#include <KoColorConversions.h>
#include <KoCompositeOpRegistry.h>
#include <KoToolManager.h>
#include <QDebug>
#include <QtMath>
#include <kis_brush_based_paintop_settings.h>
#include <kis_image.h>
#include <kis_node.h>
#include <kis_paint_information.h>
#include <kis_painter.h>
#include <kis_selection.h>
#include <kis_paint_device.h>
#include <kis_paintop.h>
#include <kis_paintop_plugin_utils.h>
#include <kis_paintop_settings.h>
#include <kis_spacing_information.h>
#include <libmypaint/mypaint-brush.h>
#include <KoColorModelStandardIds.h>
#include <KoColorSpace.h>
#include <KoColorProfile.h>

#include <cstring>

KisMyPaintPaintOp::KisMyPaintPaintOp(const KisPaintOpSettingsSP settings, KisPainter *painter, KisNodeSP /*node*/, KisImageSP image)
    : KisPaintOp (painter) {

    m_image = image;

    m_brush.reset(new KisMyPaintPaintOpPreset());

    if (settings->getBool("EraserMode")) {
        painter->setCompositeOpId(COMPOSITE_ERASE);
    }
    KisPainter *surfacePainter = this->painter();
    m_strokeOpacity = settings->hasProperty("ToskaStrokeOpacity")
        ? qBound(0.0, settings->getDouble("ToskaStrokeOpacity"), 1.0) : 1.0;
    if (m_strokeOpacity < 1.0) {
        // empty until the stroke reads an area (copyLayerForStroke): the stroke paints the second at full strength
        KisPaintDeviceSP layer = painter->device();
        m_strokeStart = new KisPaintDevice(layer->colorSpace());
        m_fullStrength = new KisPaintDevice(layer->colorSpace());
        for (KisPaintDeviceSP copy : {m_strokeStart, m_fullStrength}) {
            copy->setDefaultBounds(layer->defaultBounds());
            copy->setDefaultPixel(layer->defaultPixel());
        }
        m_fullPainter.reset(new KisPainter(m_fullStrength, painter->selection()));
        m_fullPainter->setChannelFlags(painter->channelFlags());
        m_fullPainter->copyMirrorInformationFrom(painter);
        m_fullPainter->setPaintColor(painter->paintColor());
        m_fullPainter->setCompositeOpId(painter->compositeOpId());
        surfacePainter = m_fullPainter.data();
    }
    m_surface.reset(new KisMyPaintSurface(surfacePainter, nullptr, m_image,
                                          settings->getBool("ToskaMyPaintSampleMerged", false)));
    if (m_fullPainter) {
        m_surface->setBeforeRead([this](const QRect &rect) { copyLayerForStroke(rect); });
    }
    if (m_fullPainter && settings->hasProperty("ToskaMyPaintPaintMode")
        && settings->getDouble("ToskaMyPaintPaintMode") > 0.0) {
        // the spectral stroke's glaze: the layer is blended towards the full-strength stroke spectrally (on the
        // sRGB-encoded RGBA layouts libpaintmix reads, glazeFormatFor; any other colour space keeps the plain lerp)
        m_glazeFormat = glazeFormatFor(painter->device()->colorSpace());
    }
    m_surface->setStrokeFlow(settings->hasProperty("ToskaStrokeFlow") ? float(settings->getDouble("ToskaStrokeFlow")) : 1.0f);

    m_brush->apply(settings);
    applyToskaPaintMode(m_brush->brush(), settings);

    if (settings->getBool("EraserMode")) {
        mypaint_brush_set_base_value(m_brush->brush(), MYPAINT_BRUSH_SETTING_ERASER, false);
    }

    m_brush->setColor(this->painter()->paintColor(), painter->device()->colorSpace());

    if (KoToolManager::instance()->activeToolId() != "KritaShape/KisToolBrush") {
        mypaint_brush_set_base_value(m_brush->brush(), MYPAINT_BRUSH_SETTING_SLOW_TRACKING, 0.0);
    }

    m_settings = settings;
    m_airBrushData.read(m_settings.data());

    m_dtime = -1;
    m_isStrokeStarted = false;
    m_radius = exp(mypaint_brush_get_base_value(m_brush->brush(), MYPAINT_BRUSH_SETTING_RADIUS_LOGARITHMIC));
}

KisMyPaintPaintOp::~KisMyPaintPaintOp() {
}

bool KisMyPaintPaintOp::usesPaintMode(MyPaintBrush *brush)
{
    return !(mypaint_brush_get_base_value(brush, MYPAINT_BRUSH_SETTING_PAINT_MODE) <= 0
             && mypaint_brush_is_constant(brush, MYPAINT_BRUSH_SETTING_PAINT_MODE));
}

void KisMyPaintPaintOp::applyToskaPaintMode(MyPaintBrush *brush, const KisPaintOpSettingsSP settings)
{
    // Only the Toska property opts in: the preset's own JSON paint_mode (base value or input mappings) never does,
    // so a preset without the property paints byte-identically through the legacy stroke_to. The setting is made
    // constant either way, so usesPaintMode() is exactly "ToskaMyPaintPaintMode > 0".
    const float paintMode = settings->hasProperty("ToskaMyPaintPaintMode")
        ? qBound(0.0f, float(settings->getDouble("ToskaMyPaintPaintMode")), 1.0f)
        : 0.0f;
    for (int input = 0; input < MYPAINT_BRUSH_INPUTS_COUNT; input++) {
        mypaint_brush_set_mapping_n(brush, MYPAINT_BRUSH_SETTING_PAINT_MODE, MyPaintBrushInput(input), 0);
    }
    mypaint_brush_set_base_value(brush, MYPAINT_BRUSH_SETTING_PAINT_MODE, paintMode);
    if (paintMode > 0.0f) {
        primeForStrokeTo2(brush);
    }
}

namespace {
int primingDab(MyPaintSurface2 *, float, float, float, float, float, float, float, float, float, float, float, float,
               float, float, float, float)
{
    return 0;
}

void primingColor(MyPaintSurface2 *, float, float, float, float *r, float *g, float *b, float *a, float)
{
    *r = *g = *b = 0.0f;
    *a = 1.0f;
}
}

void KisMyPaintPaintOp::primeForStrokeTo2(MyPaintBrush *brush)
{
    MyPaintSurface2 nothing;
    memset(&nothing, 0, sizeof nothing);
    nothing.draw_dab_pigment = primingDab;
    nothing.get_color_pigment = primingColor;
    // tracking noise would skip input (and draw from the brush's random numbers) before the settings are computed
    const float noise = mypaint_brush_get_base_value(brush, MYPAINT_BRUSH_SETTING_TRACKING_NOISE);
    mypaint_brush_set_base_value(brush, MYPAINT_BRUSH_SETTING_TRACKING_NOISE, 0.0f);
    mypaint_brush_reset(brush);
    // the first call only resets the state; the second moves nowhere (no dab) and computes the settings at its end
    mypaint_brush_stroke_to_2(brush, &nothing, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0, 1.0f, 0.0f, 0.0f);
    mypaint_brush_stroke_to_2(brush, &nothing, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.01, 1.0f, 0.0f, 0.0f);
    mypaint_brush_set_base_value(brush, MYPAINT_BRUSH_SETTING_TRACKING_NOISE, noise);
    mypaint_brush_reset(brush);
}

int KisMyPaintPaintOp::strokeBrushTo(MyPaintBrush *brush, KisMyPaintSurface *surface, float x, float y,
                                     float pressure, float xtilt, float ytilt, double dtime)
{
    if (usesPaintMode(brush)) {
        // stroke_to_2 also counts dabs differently, so only presets that opt in take it
        return mypaint_brush_stroke_to_2(brush, surface->surface2(), x, y, pressure, xtilt, ytilt, dtime,
                                         1.0f, 0.0f, 0.0f);
    }
    return mypaint_brush_stroke_to(brush, surface->surface(), x, y, pressure, xtilt, ytilt, dtime);
}

void KisMyPaintPaintOp::strokeTo(const KisPaintInformation &info, double dtime)
{
    strokeBrushTo(m_brush->brush(), m_surface.data(), info.pos().x(), info.pos().y(), info.pressure(),
                  info.xTilt(), info.yTilt(), dtime);
    compositeStrokeOpacity();
}

std::optional<KisPaintMix::PixelFormat> KisMyPaintPaintOp::glazeFormatFor(const KoColorSpace *cs)
{
    if (!cs || cs->colorModelId() != RGBAColorModelID) return std::nullopt;
    // a linear-light profile holds linear values; the model would read them as encoded and mix the wrong colours
    if (!cs->profile() || cs->profile()->isLinear()) return std::nullopt;
    const KoID depth = cs->colorDepthId();
    if (depth == Integer8BitsColorDepthID) return KisPaintMix::PixelFormat::Bgra8;
    if (depth == Integer16BitsColorDepthID) return KisPaintMix::PixelFormat::Bgra16;
    if (depth == Float32BitsColorDepthID) return KisPaintMix::PixelFormat::RgbaF32;
    return std::nullopt;
}

void KisMyPaintPaintOp::copyLayerForStroke(const QRect &rect)
{
    // in the layer's 64 px tiles: an area outside the copied ones has not been painted by this stroke, so the layer
    // still holds it as the stroke began
    const int tile = 64;
    auto index = [tile](int v) { return v >= 0 ? v / tile : -((-v + tile - 1) / tile); };
    KisPaintDeviceSP layer = painter()->device();
    for (int ty = index(rect.top()); ty <= index(rect.bottom()); ty++) {
        for (int tx = index(rect.left()); tx <= index(rect.right()); tx++) {
            if (m_copiedTiles.contains(QPoint(tx, ty))) continue;
            m_copiedTiles.insert(QPoint(tx, ty));
            const QRect area(tx * tile, ty * tile, tile, tile);
            KisPainter::copyAreaOptimized(area.topLeft(), layer, m_strokeStart, area);
            KisPainter::copyAreaOptimized(area.topLeft(), layer, m_fullStrength, area);
        }
    }
}

void KisMyPaintPaintOp::blendGlazeByTheModel(const QRect &rect)
{
    // the colour: the layer as the stroke began mixed with the full-strength stroke by the spectral model at the
    // opacity (libpaintmix's copy blend, the share copy gives the stroke); the alpha: the copy's, already on the layer
    KisPaintDeviceSP layer = painter()->device();
    const int pixelSize = layer->pixelSize();
    const int count = rect.width() * rect.height();
    const int bytes = count * pixelSize;
    if (m_glazeBuffer.size() < 3 * bytes) m_glazeBuffer.resize(3 * bytes);
    quint8 *start = m_glazeBuffer.data(), *full = start + bytes, *lerped = full + bytes;
    m_strokeStart->readBytes(start, rect);
    m_fullStrength->readBytes(full, rect);
    layer->readBytes(lerped, rect);
    KisPaintMix::blendPixels(KisPaintMix::Model::Spectral, KisPaintMix::Blend::Copy, *m_glazeFormat, start, full, false,
                             count, float(m_strokeOpacity));
    const int alphaOffset = pixelSize - pixelSize / 4; // B,G,R,A or R,G,B,A: alpha is the last channel
    const int alphaSize = pixelSize / 4;
    for (int i = 0; i < count; i++) {
        std::memcpy(start + i * pixelSize + alphaOffset, lerped + i * pixelSize + alphaOffset, alphaSize);
    }
    layer->writeBytes(start, rect);
}

void KisMyPaintPaintOp::compositeStrokeOpacity()
{
    if (!m_fullPainter) {
        return;
    }
    const QVector<QRect> rects = m_fullPainter->takeDirtyRegion();
    if (rects.isEmpty()) {
        return;
    }
    // each area: the layer as the stroke began, then the full-strength stroke over it at the stroke's opacity
    KisPainter layer(painter()->device());
    layer.setCompositeOpId(COMPOSITE_COPY);
    for (const QRect &rect : rects) {
        layer.setOpacityToUnit();
        layer.bitBlt(rect.topLeft(), m_strokeStart, rect);
        layer.setOpacityF(m_strokeOpacity);
        layer.bitBlt(rect.topLeft(), m_fullStrength, rect);
        if (m_glazeFormat) {
            blendGlazeByTheModel(rect);
        }
    }
    painter()->addDirtyRects(rects);
}

KisSpacingInformation KisMyPaintPaintOp::paintAt(const KisPaintInformation& info) {

    if (!painter()) {
        return KisSpacingInformation(1.0);
    }

    const qreal lodScale = KisLodTransform::lodToScale(painter()->device());

    qreal radius = m_radius;
    radius *= lodScale;
    mypaint_brush_set_base_value(m_brush->brush(), MYPAINT_BRUSH_SETTING_RADIUS_LOGARITHMIC, log(radius));

    m_isStrokeStarted = mypaint_brush_get_state(m_brush->brush(), MYPAINT_BRUSH_STATE_STROKE_STARTED);
    if (!m_isStrokeStarted) {

        strokeTo(info, 1.0f);

        m_dtime = 0.015;
    }
    else {
        m_dtime = abs(info.currentTime() - m_previousTime)*0.001;
    }

    strokeTo(info, m_dtime);

    m_previousTime = info.currentTime();

    return computeSpacing(info, lodScale);
}

KisSpacingInformation KisMyPaintPaintOp::updateSpacingImpl(const KisPaintInformation &info) const
{
    KisSpacingInformation spacingInfo = computeSpacing(info, KisLodTransform::lodToScale(painter()->device()));
    return spacingInfo;
}

KisTimingInformation KisMyPaintPaintOp::updateTimingImpl(const KisPaintInformation &info) const {

    return KisPaintOpPluginUtils::effectiveTiming(&m_airBrushData, nullptr, info);
}

KisSpacingInformation KisMyPaintPaintOp::computeSpacing(const KisPaintInformation &info, qreal lodScale) const {

    return KisPaintOpPluginUtils::effectiveSpacing(m_radius*2, m_radius*2,
                                                   false, 0.0, false, m_radius*2,
                                                   true, 1, lodScale, &m_airBrushData, nullptr, info);
}
