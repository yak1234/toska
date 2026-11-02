/*
 * SPDX-FileCopyrightText: 2020 Ashwin Dhakaita <ashwingpdhakaita@gmail.com>
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef KIS_MYPAINT_SURFACE_H
#define KIS_MYPAINT_SURFACE_H

#include <QObject>

#include <kis_paint_device.h>
#include <kis_fixed_paint_device.h>
#include <kis_painter.h>
#include <kis_paint_information.h>
#include <kis_lod_transform.h>
#include <KoColor.h>
#include <kis_marker_painter.h>
#include <kis_sequential_iterator.h>
#include <KisOverlayPaintDeviceWrapper.h>

#include <libmypaint/mypaint-brush.h>
#include <libmypaint/mypaint-surface.h>

#include <memory>

namespace KisPaintMix {
class LogSpectrumCache;
class SpectralDabMixer;
}

#include <functional>

class KisMyPaintSurface
{
public:

    // The extended interface (libmypaint's MyPaintSurface2, whose first member is the plain MyPaintSurface): the
    // brush calls draw_dab_pigment and get_color_pigment from mypaint_brush_stroke_to_2, for presets with ToskaMyPaintPaintMode > 0.
    struct MyPaintSurfaceInternal: public MyPaintSurface2 {
          KisMyPaintSurface *m_owner;
          KoChannelInfo::enumChannelValueType bitDepth;
    };

public:
    /// sampleMerged: get_color reads the image's projection (all visible layers) instead of the painted layer.
    KisMyPaintSurface(KisPainter* painter, KisPaintDeviceSP paintNode=nullptr, KisImageSP image = nullptr,
                      bool sampleMerged = false);
    ~KisMyPaintSurface();

    /**
      * mypaint_surface_draw_dab:
      *
      * Draw a dab onto the surface.
      */
    static int draw_dab(MyPaintSurface *self, float x, float y, float radius,
                           float color_r, float color_g, float color_b, float opaque, float hardness,
                           float color_a, float aspect_ratio, float angle, float lock_alpha,
                           float colorize);

    static void get_color(MyPaintSurface *self, float x, float y, float radius,
                            float * color_r, float * color_g, float * color_b, float * color_a);

    /**
      * The extended interface's dab: paint (0..1) is the spectral share of the blend, as libmypaint's tiled surface
      * splits a dab into a normal and a spectral part. Posterize is ignored, as in draw_dab.
      */
    static int draw_dab_pigment(MyPaintSurface2 *self, float x, float y, float radius,
                                float color_r, float color_g, float color_b, float opaque, float hardness,
                                float color_a, float aspect_ratio, float angle, float lock_alpha,
                                float colorize, float posterize, float posterize_num, float paint);

    /// paint > 0 blends the RGB average towards the spectral average; paint < 0 is get_color.
    static void get_color_pigment(MyPaintSurface2 *self, float x, float y, float radius,
                                  float * color_r, float * color_g, float * color_b, float * color_a, float paint);

    template <typename channelType>
    int drawDabImpl(MyPaintSurface *self, float x, float y, float radius, float color_r, float color_g,
                                    float color_b, float opaque, float hardness, float color_a,
                                    float aspect_ratio, float angle, float lock_alpha, float colorize,
                                    float paint = 0.0f);

    template <typename channelType>
    void getColorImpl(MyPaintSurface *self, float x, float y, float radius,
                                float * color_r, float * color_g, float * color_b, float * color_a,
                                float paint = -1.0f);

    inline float
    calculate_rr_antialiased (int  xp, int  yp, float x, float y, float aspect_ratio,
                              float sn, float cs, float one_over_radius2, float r_aa_start);

    inline float
    calculate_alpha_for_rr (float rr, float hardness, float slope1, float slope2);

    inline float
    calculate_rr (int xp, int yp, float x, float y, float aspect_ratio,
                  float sn, float cs, float one_over_radius2);


    KisPainter* painter();
    void paint(KoColor *color, KoColor* bgColor);
    qreal calculateOpacity(float angle, float hardness, float opaque, float x, float y,
                                            float xp, float yp, float aspect_ratio, float radius);

    MyPaintSurface* surface();
    MyPaintSurface2* surface2();

    /**
     * Toska: a stroke's flow (0..1, as Krita's other engines take it): every dab's alpha, as the brush computed it
     * (the preset's own opaque dynamics), is multiplied by it. 1 leaves dabs untouched.
     */
    void setStrokeFlow(float flow);

    /**
     * Toska: called with every area of the painted device before the surface reads it (a dab's area and its mirrors,
     * a colour sample's area), so a device filled on demand (KisMyPaintPaintOp's full-strength copy) can fill it first.
     */
    void setBeforeRead(std::function<void(const QRect &)> beforeRead);

private:
    KisPainter *m_painter;
    KisPaintDeviceSP m_imageDevice;
    MyPaintSurfaceInternal *m_surface;
    KisImageSP m_image;
    KisOverlayPaintDeviceWrapper m_precisePainterWrapper;
    KisPaintDeviceSP m_dab;
    QScopedPointer<KisPainter> m_tempPainter;
    QScopedPointer<KisPainter> m_backgroundPainter;
    KisFixedPaintDeviceSP m_blendDevice;
    KisFixedPaintDeviceSP m_maskDevice;
    bool m_sampleMerged {false};
    float m_strokeFlow {1.0f};
    std::function<void(const QRect &)> m_beforeRead;
    // Toska: log spectra of the canvas colours the spectral blend and sample have met, and the dab blend's memo
    // (made on first use)
    std::unique_ptr<KisPaintMix::LogSpectrumCache> m_logSpectra;
    std::unique_ptr<KisPaintMix::SpectralDabMixer> m_dabMixer;
    struct SampleWeights;
    std::unique_ptr<SampleWeights> m_sampleWeights;
    KisPaintMix::LogSpectrumCache &logSpectra();
    KisPaintMix::SpectralDabMixer &dabMixer();
    SampleWeights &sampleWeights();

};

#endif // KIS_MYPAINT_SURFACE_H
