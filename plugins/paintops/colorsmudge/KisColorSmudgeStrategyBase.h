/*
 *  SPDX-FileCopyrightText: 2021 Dmitry Kazakov <dimula73@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef KRITA_KISCOLORSMUDGESTRATEGYBASE_H
#define KRITA_KISCOLORSMUDGESTRATEGYBASE_H

#include <kis_types.h>

#include "KisColorSmudgeStrategy.h"
#include "KisColorSmudgeSource.h"

#include <optional>
#include <KisPaintMix.h>

class KisPainter;


class KisColorSmudgeStrategyBase : public KisColorSmudgeStrategy
{
public:
    /**
     * Toska: the mixing model a blend of the dab's buffer runs by (libpaintmix's blendPixels), in place of Krita's
     * composite op. Set only when the preset names a model other than rgb, mixes on the brush, the buffer is an
     * sRGB-encoded RGBA layout libpaintmix reads, and the smear and colour rate ops are Normal or Copy.
     */
    struct MixByModel {
        KisPaintMix::Model model;
        KisPaintMix::PixelFormat format;
    };

    /// Blends src into dst by the model: op (Normal or Copy) chooses how the opacity weighs the two.
    static void blendByModel(const MixByModel &mix, const KoCompositeOp *op, quint8 *dst, const quint8 *src,
                             bool srcIsOneColour, int numPixels, qreal opacity);

    /// The layout libpaintmix reads the colour space as: 8-bit, 16-bit or 32-bit float RGBA with an sRGB-encoded
    /// (not linear) profile; nothing for any other colour space, which keeps Krita's own mixing.
    static std::optional<KisPaintMix::PixelFormat> pixelFormatFor(const KoColorSpace *cs);

    struct DabColoringStrategy
    {
        virtual ~DabColoringStrategy() = default;
        /// Toska: set by blendBrush before each dab; empty means Krita's composite ops, as upstream.
        std::optional<MixByModel> mixByModel;
        virtual bool supportsFusedDullingBlending() const = 0;
        virtual void blendInColorRate(const KoColor &paintColor, const KoCompositeOp *colorRateOp, qreal colorRateOpacity,
                                      KisFixedPaintDeviceSP dstDevice, const QRect &dstRect) const = 0;
        virtual void blendInFusedBackgroundAndColorRateWithDulling(KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src,
                                                                   const QRect &dstRect,
                                                                   const KoColor &preparedDullingColor,
                                                                   const KoCompositeOp *smearOp,
                                                                   const qreal smudgeRateOpacity,
                                                                   const KoColor &paintColor,
                                                                   const KoCompositeOp *colorRateOp,
                                                                   const qreal colorRateOpacity) const = 0;
    };

    struct DabColoringStrategyMask : public DabColoringStrategy
    {
        bool supportsFusedDullingBlending() const override;

        void blendInColorRate(const KoColor &paintColor, const KoCompositeOp *colorRateOp, qreal colorRateOpacity,
                              KisFixedPaintDeviceSP dstDevice, const QRect &dstRect) const override;

        void blendInFusedBackgroundAndColorRateWithDulling(KisFixedPaintDeviceSP dst,
                                                           KisColorSmudgeSourceSP src,
                                                           const QRect &dstRect,
                                                           const KoColor &preparedDullingColor,
                                                           const KoCompositeOp *smearOp,
                                                           const qreal smudgeRateOpacity,
                                                           const KoColor &paintColor,
                                                           const KoCompositeOp *colorRateOp,
                                                           const qreal colorRateOpacity) const override;
    };

    struct DabColoringStrategyStamp : public DabColoringStrategy
    {
        void setStampDab(KisFixedPaintDeviceSP device);

        void blendInColorRate(const KoColor &paintColor, const KoCompositeOp *colorRateOp, qreal colorRateOpacity,
                              KisFixedPaintDeviceSP dstDevice, const QRect &dstRect) const override;

        bool supportsFusedDullingBlending() const override;

        void blendInFusedBackgroundAndColorRateWithDulling(KisFixedPaintDeviceSP dst,
                                                           KisColorSmudgeSourceSP src,
                                                           const QRect &dstRect,
                                                           const KoColor &preparedDullingColor,
                                                           const KoCompositeOp *smearOp,
                                                           const qreal smudgeRateOpacity,
                                                           const KoColor &paintColor,
                                                           const KoCompositeOp *colorRateOp,
                                                           const qreal colorRateOpacity) const override;

    private:
        KisFixedPaintDeviceSP m_origDab;
    };

public:

    KisColorSmudgeStrategyBase(bool useDullingMode);

    void initializePaintingImpl(const KoColorSpace *dstColorSpace,
                                bool smearAlpha,
                                const QString &colorRateCompositeOpId);

    virtual DabColoringStrategy& coloringStrategy() = 0;

    /// Toska: the preset's mixing model (KisColorSmudgeMixingOptionData); call before initializePainting().
    void setMixing(const KisPaintMix::Settings &settings);

    /// Toska: the blend mode the finished dab goes onto the layer with. Krita's own (Copy, or Normal for the legacy
    /// mask strategy) unless a model mixes this stroke: then the same coverage with the colour mixed by the model
    /// (KoCompositeOpToskaMix), because for a blending brush that copy through the dab's soft mask is where colours meet.
    /// Valid after initializePaintingImpl().
    QString mixedFinalCompositeOp(const QString &kritaOpId) const;

    const KoColorSpace* preciseColorSpace() const override;

    virtual QString smearCompositeOp(bool smearAlpha) const;

    virtual QString finalCompositeOp(bool smearAlpha) const;

    virtual qreal finalPainterOpacity(qreal opacity, qreal smudgeRateValue);

    virtual qreal colorRateOpacity(qreal opacity, qreal smudgeRateValue, qreal colorRateValue, qreal maxPossibleSmudgeRateValue);

    virtual qreal dullingRateOpacity(qreal opacity, qreal smudgeRateValue);

    virtual qreal smearRateOpacity(qreal opacity, qreal smudgeRateValue);

    virtual void sampleDullingColor(const QRect &srcRect, qreal sampleRadiusValue, KisColorSmudgeSourceSP sourceDevice,
                                    KisFixedPaintDeviceSP tempFixedDevice, KisFixedPaintDeviceSP maskDab,
                                    KoColor *resultColor);

    void blendBrush(const QVector<KisPainter *> dstPainters, KisColorSmudgeSourceSP srcSampleDevice,
                    KisFixedPaintDeviceSP maskDab, bool preserveMaskDab, const QRect &srcRect, const QRect &dstRect,
                    const KoColor &currentPaintColor, qreal opacity, qreal smudgeRateValue,
                    qreal maxPossibleSmudgeRateValue, qreal colorRateValue, qreal smudgeRadiusValue);

    void blendInBackgroundWithSmearing(KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src, const QRect &srcRect,
                                       const QRect &dstRect, const qreal smudgeRateOpacity);

    void blendInBackgroundWithDulling(KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src, const QRect &dstRect,
                                      const KoColor &preparedDullingColor, const qreal smudgeRateOpacity);

protected:
    const KoCompositeOp * m_colorRateOp {nullptr};
    KoColor m_preparedDullingColor;
    const KoCompositeOp * m_smearOp {nullptr};
private:
    KisFixedPaintDeviceSP m_blendDevice;
    bool m_useDullingMode {true};
    KisPaintMix::Settings m_mixing;
    std::optional<MixByModel> m_mixByModel;
};


#endif //KRITA_KISCOLORSMUDGESTRATEGYBASE_H
