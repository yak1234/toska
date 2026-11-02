/*
 *  SPDX-FileCopyrightText: 2020 Ashwin Dhakaita <ashwingpdhakaita@gmail.com>
 *
 *  SPDX-License-Identifier: LGPL-2.0-or-later
 */

#ifndef KIS_MY_PAINTOP_H_
#define KIS_MY_PAINTOP_H_

#include <QSet>
#include <QPoint>
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
     * than the legacy mypaint_brush_stroke_to: libmypaint's own legacy_smudge test, negated. After
     * applyToskaPaintMode() it is true exactly when the preset sets ToskaMyPaintPaintMode > 0.
     */
    static bool usesPaintMode(MyPaintBrush *brush);

    /**
     * Toska: sets the brush's paint_mode to ToskaMyPaintPaintMode (0..1), or 0 without it, and clears its input
     * mappings. The preset's own MyPaint JSON paint_mode never switches a preset to spectral painting.
     */
    static void applyToskaPaintMode(MyPaintBrush *brush, const KisPaintOpSettingsSP settings);

    /**
     * Toska: libmypaint 1.6.1's update_states_and_setting_values copies SETTING(DABS_PER_*) into the brush state
     * before it computes the settings, so the first dab of a brush's first stroke_to_2 reads uninitialised memory
     * (state_based_dab_count and opaque_linearize use those states; the legacy path reads base values). Two empty
     * stroke_to_2 calls on a surface that paints nothing compute the settings once, and a reset makes the next stroke
     * start afresh. applyToskaPaintMode calls it for presets that opt in.
     */
    static void primeForStrokeTo2(MyPaintBrush *brush);

    /// Toska: one stroke_to through the entry point usesPaintMode() picks (the paintop's own path)
    static int strokeBrushTo(MyPaintBrush *brush, KisMyPaintSurface *surface, float x, float y, float pressure,
                             float xtilt, float ytilt, double dtime);

protected:

    KisSpacingInformation paintAt(const KisPaintInformation& info) override;

    KisSpacingInformation updateSpacingImpl(const KisPaintInformation &info) const override;

    KisTimingInformation updateTimingImpl(const KisPaintInformation &info) const override;

private:
    KisSpacingInformation computeSpacing(const KisPaintInformation &info, qreal lodScale) const;
    void strokeTo(const KisPaintInformation &info, double dtime);
    void compositeStrokeOpacity();
    void copyLayerForStroke(const QRect &rect);

private:
    QScopedPointer<KisMyPaintPaintOpPreset> m_brush;
    QScopedPointer<KisMyPaintSurface> m_surface;
    KisPaintOpSettingsSP m_settings;
    KisAirbrushOptionData m_airBrushData;
    KisImageWSP m_image;
    double m_dtime, m_radius, m_previousTime = 0;
    bool m_isStrokeStarted;
    /**
     * Toska: a stroke's opacity below 1 (ToskaStrokeOpacity, which a script's stroke job, libkis Node.paintStrokes,
     * sets on its copy of the preset; the engine paints its dabs itself and never reads the painter's opacity). The
     * brush paints, smudges and samples at full strength on m_fullStrength, and every dab's area of the layer becomes
     * the layer as the stroke began (m_strokeStart) blended towards it by the opacity, as Krita's other engines
     * composite a stroke (wash mode). Both devices start empty and take the layer's tiles the stroke reads, as it
     * reads them (m_copiedTiles), so the cost follows the stroke's area, not the layer's. The stroke's flow
     * (ToskaStrokeFlow) scales each dab.
     */
    qreal m_strokeOpacity {1.0};
    KisPaintDeviceSP m_strokeStart;
    KisPaintDeviceSP m_fullStrength;
    QSet<QPoint> m_copiedTiles;
    QScopedPointer<KisPainter> m_fullPainter;
};

#endif // KIS_MY_PAINTOP_H_
