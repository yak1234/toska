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
#include <kis_paintop.h>
#include <kis_paintop_plugin_utils.h>
#include <kis_paintop_settings.h>
#include <kis_spacing_information.h>
#include <libmypaint/mypaint-brush.h>

KisMyPaintPaintOp::KisMyPaintPaintOp(const KisPaintOpSettingsSP settings, KisPainter *painter, KisNodeSP /*node*/, KisImageSP image)
    : KisPaintOp (painter) {

    m_image = image;

    m_brush.reset(new KisMyPaintPaintOpPreset());
    m_surface.reset(new KisMyPaintSurface(this->painter(), nullptr, m_image,
                                          settings->getBool("ToskaMyPaintSampleMerged", false)));

    m_brush->apply(settings);
    applyToskaPaintMode(m_brush->brush(), settings);

    if (settings->getBool("EraserMode")) {

        painter->setCompositeOpId(COMPOSITE_ERASE);
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
