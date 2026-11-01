/*
 *  SPDX-FileCopyrightText: 2020 Ashwin Dhakaita <ashwingpdhakaita@gmail.com>
 *
 *  SPDX-License-Identifier: LGPL-2.0-or-later
 */

#ifndef KIS_MY_PAINTOP_H_
#define KIS_MY_PAINTOP_H_

#include <kis_types.h>
#include <brushengine/kis_paintop.h>

#include <libmypaint/mypaint-brush.h>
#include <KisAirbrushOptionData.h>

#include "MyPaintPaintOpPreset.h"
#include "MyPaintSurface.h"

class KisPainter;


class KisMyPaintPaintOp : public KisPaintOp
{

public:

    KisMyPaintPaintOp(const KisPaintOpSettingsSP settings, KisPainter * painter, KisNodeSP node, KisImageSP image);
    ~KisMyPaintPaintOp() override;

    /**
     * Toska: whether the brush paints through libmypaint's mypaint_brush_stroke_to_2 (spectral paint_mode) rather
     * than the legacy mypaint_brush_stroke_to: libmypaint's own legacy_smudge test, negated.
     */
    static bool usesPaintMode(MyPaintBrush *brush);

    /**
     * Toska: sets the brush's paint_mode base value from the preset. ToskaMyPaintPaintMode (0..1) overrides it when
     * present; otherwise a preset whose MyPaint JSON does not name paint_mode gets 0 (libmypaint's default is 1, but
     * Krita has always painted such presets with the legacy entry point, which ignores paint_mode).
     */
    static void applyToskaPaintMode(MyPaintBrush *brush, const KisPaintOpSettingsSP settings);

protected:

    KisSpacingInformation paintAt(const KisPaintInformation& info) override;

    KisSpacingInformation updateSpacingImpl(const KisPaintInformation &info) const override;

    KisTimingInformation updateTimingImpl(const KisPaintInformation &info) const override;

private:
    KisSpacingInformation computeSpacing(const KisPaintInformation &info, qreal lodScale) const;
    void strokeTo(const KisPaintInformation &info, double dtime);

private:
    QScopedPointer<KisMyPaintPaintOpPreset> m_brush;
    QScopedPointer<KisMyPaintSurface> m_surface;
    KisPaintOpSettingsSP m_settings;
    KisAirbrushOptionData m_airBrushData;
    KisImageWSP m_image;
    double m_dtime, m_radius, m_previousTime = 0;
    bool m_isStrokeStarted;
    bool m_paintMode {false};
};

#endif // KIS_MY_PAINTOP_H_
