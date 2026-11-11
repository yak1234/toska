/*
 *  SPDX-FileCopyrightText: 2020 Peter Schatz <voronwe13@gmail.com>
 *  SPDX-FileCopyrightText: 2021 Dmitry Kazakov <dimula73@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#include <KoCompositeOpRegistry.h>
#include "KisColorSmudgeStrategyBase.h"
#include "kis_painter.h"
#include "kis_fixed_paint_device.h"
#include "kis_paint_device.h"
#include "KisColorSmudgeSampleUtils.h"

#include <KoColorModelStandardIds.h>
#include <KoColorProfile.h>

/**********************************************************************************/
/*                 Toska: mixing by a model                                       */
/**********************************************************************************/

std::optional<KisPaintMix::PixelFormat> KisColorSmudgeStrategyBase::pixelFormatFor(const KoColorSpace *cs)
{
    if (!cs || cs->colorModelId() != RGBAColorModelID) return std::nullopt;
    // a linear-light profile holds linear values; the models would read them as encoded and mix the wrong colours
    if (!cs->profile() || cs->profile()->isLinear()) return std::nullopt;
    const KoID depth = cs->colorDepthId();
    if (depth == Integer8BitsColorDepthID) return KisPaintMix::PixelFormat::Bgra8;
    if (depth == Integer16BitsColorDepthID) return KisPaintMix::PixelFormat::Bgra16;
    if (depth == Float32BitsColorDepthID) return KisPaintMix::PixelFormat::RgbaF32;
    return std::nullopt;
}

void KisColorSmudgeStrategyBase::blendByModel(const MixByModel &mix, const KoCompositeOp *op, quint8 *dst,
                                              const quint8 *src, bool srcIsOneColour, int numPixels, qreal opacity)
{
    KisPaintMix::blendPixels(mix.model,
                             op->id() == COMPOSITE_COPY ? KisPaintMix::Blend::Copy : KisPaintMix::Blend::Over,
                             mix.format, dst, src, srcIsOneColour, numPixels, float(opacity));
}

void KisColorSmudgeStrategyBase::setMixing(const KisPaintMix::Settings &settings)
{
    m_mixing = settings;
}

/**********************************************************************************/
/*                 DabColoringStrategyMask                                        */
/**********************************************************************************/

bool KisColorSmudgeStrategyBase::DabColoringStrategyMask::supportsFusedDullingBlending() const
{
    return true;
}

void KisColorSmudgeStrategyBase::DabColoringStrategyMask::blendInFusedBackgroundAndColorRateWithDulling(
        KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src, const QRect &dstRect,
        const KoColor &preparedDullingColor, const KoCompositeOp *smearOp, const qreal smudgeRateOpacity,
        const KoColor &paintColor, const KoCompositeOp *colorRateOp, const qreal colorRateOpacity) const
{
    KoColor dullingFillColor(preparedDullingColor);

    KIS_SAFE_ASSERT_RECOVER_RETURN(*paintColor.colorSpace() == *colorRateOp->colorSpace());
    colorRateOp->composite(dullingFillColor.data(), 1, paintColor.data(), 1, 0, 0, 1, 1, colorRateOpacity);

    if (smearOp->id() == COMPOSITE_COPY && qFuzzyCompare(smudgeRateOpacity, OPACITY_OPAQUE_F)) {
        dst->fill(dst->bounds(), dullingFillColor);
    } else {
        src->readBytes(dst->data(), dstRect);
        smearOp->composite(dst->data(), dstRect.width() * dst->pixelSize(),
                           dullingFillColor.data(), 0,
                           0, 0,
                           1, dstRect.width() * dstRect.height(),
                           smudgeRateOpacity);
    }
}

void KisColorSmudgeStrategyBase::DabColoringStrategyMask::blendInColorRate(const KoColor &paintColor,
                                                                           const KoCompositeOp *colorRateOp,
                                                                           qreal colorRateOpacity,
                                                                           KisFixedPaintDeviceSP dstDevice,
                                                                           const QRect &dstRect) const
{
    KIS_SAFE_ASSERT_RECOVER_RETURN(*paintColor.colorSpace() == *colorRateOp->colorSpace());

    if (mixByModel) {
        blendByModel(*mixByModel, colorRateOp, dstDevice->data(), paintColor.data(), true,
                     dstRect.width() * dstRect.height(), colorRateOpacity);
        return;
    }

    colorRateOp->composite(dstDevice->data(), dstRect.width() * dstDevice->pixelSize(),
                           paintColor.data(), 0,
                           0, 0,
                           dstRect.height(), dstRect.width(),
                           colorRateOpacity);
}

/**********************************************************************************/
/*                 DabColoringStrategyStamp                                       */
/**********************************************************************************/

void KisColorSmudgeStrategyBase::DabColoringStrategyStamp::setStampDab(KisFixedPaintDeviceSP device)
{
    m_origDab = device;
}

void KisColorSmudgeStrategyBase::DabColoringStrategyStamp::blendInColorRate(const KoColor &paintColor,
                                                                            const KoCompositeOp *colorRateOp,
                                                                            qreal colorRateOpacity,
                                                                            KisFixedPaintDeviceSP dstDevice,
                                                                            const QRect &dstRect) const
{
    Q_UNUSED(paintColor);

    // TODO: check correctness for composition source device (transparency masks)
    KIS_ASSERT_RECOVER_RETURN(*dstDevice->colorSpace() == *m_origDab->colorSpace());

    if (mixByModel) {
        blendByModel(*mixByModel, colorRateOp, dstDevice->data(), m_origDab->data(), false,
                     dstRect.width() * dstRect.height(), colorRateOpacity);
        return;
    }

    colorRateOp->composite(dstDevice->data(), dstRect.width() * dstDevice->pixelSize(),
                           m_origDab->data(), dstRect.width() * m_origDab->pixelSize(),
                           0, 0,
                           dstRect.height(), dstRect.width(),
                           colorRateOpacity);
}

bool KisColorSmudgeStrategyBase::DabColoringStrategyStamp::supportsFusedDullingBlending() const
{
    return false;
}

void KisColorSmudgeStrategyBase::DabColoringStrategyStamp::blendInFusedBackgroundAndColorRateWithDulling(
        KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src, const QRect &dstRect,
        const KoColor &preparedDullingColor, const KoCompositeOp *smearOp, const qreal smudgeRateOpacity,
        const KoColor &paintColor, const KoCompositeOp *colorRateOp, const qreal colorRateOpacity) const
{
    Q_UNUSED(dst);
    Q_UNUSED(src);
    Q_UNUSED(dstRect);
    Q_UNUSED(preparedDullingColor);
    Q_UNUSED(smearOp);
    Q_UNUSED(smudgeRateOpacity);
    Q_UNUSED(paintColor);
    Q_UNUSED(colorRateOp);
    Q_UNUSED(colorRateOpacity);
}

/**********************************************************************************/
/*                 KisColorSmudgeStrategyBase                                     */
/**********************************************************************************/

KisColorSmudgeStrategyBase::KisColorSmudgeStrategyBase(bool useDullingMode)
        : m_useDullingMode(useDullingMode)
{
}

void KisColorSmudgeStrategyBase::initializePaintingImpl(const KoColorSpace *dstColorSpace, bool smearAlpha,
                                                        const QString &colorRateCompositeOpId)
{
    m_blendDevice = new KisFixedPaintDevice(dstColorSpace, m_memoryAllocator);
    m_smearOp = dstColorSpace->compositeOp(smearCompositeOp(smearAlpha));
    m_colorRateOp = dstColorSpace->compositeOp(colorRateCompositeOpId);
    m_preparedDullingColor.convertTo(dstColorSpace);

    // Toska: the model replaces the smear, dulling and colour rate blends only where both ops are Normal or Copy
    // and the buffer is a layout libpaintmix reads; in every other case the dab is built exactly as upstream
    m_mixByModel.reset();
    auto normalOrCopy = [](const KoCompositeOp *op) {
        return op && (op->id() == COMPOSITE_OVER || op->id() == COMPOSITE_COPY);
    };
    const std::optional<KisPaintMix::PixelFormat> format = pixelFormatFor(dstColorSpace);
    if (m_mixing.model != KisPaintMix::Model::Rgb && m_mixing.mixOnBrush && format &&
        normalOrCopy(m_smearOp) && normalOrCopy(m_colorRateOp)) {
        m_mixByModel = MixByModel{m_mixing.model, *format};
    }
}

const KoColorSpace *KisColorSmudgeStrategyBase::preciseColorSpace() const
{
    // verify that initialize() has already been called!
    KIS_ASSERT_RECOVER_RETURN_VALUE(m_smearOp, KoColorSpaceRegistry::instance()->rgb8());

    return m_smearOp->colorSpace();
}

QString KisColorSmudgeStrategyBase::smearCompositeOp(bool smearAlpha) const
{
    return smearAlpha ? COMPOSITE_COPY : COMPOSITE_OVER;
}

QString KisColorSmudgeStrategyBase::finalCompositeOp(bool smearAlpha) const
{
    Q_UNUSED(smearAlpha);
    return COMPOSITE_COPY;
}

qreal KisColorSmudgeStrategyBase::finalPainterOpacity(qreal opacity, qreal smudgeRateValue)
{
    Q_UNUSED(opacity);
    Q_UNUSED(smudgeRateValue);

    return OPACITY_OPAQUE_F;
}

qreal KisColorSmudgeStrategyBase::colorRateOpacity(qreal opacity, qreal smudgeRateValue, qreal colorRateValue,
                                                   qreal maxPossibleSmudgeRateValue)
{
    Q_UNUSED(smudgeRateValue);
    Q_UNUSED(maxPossibleSmudgeRateValue);
    return colorRateValue * colorRateValue * opacity;
}

qreal KisColorSmudgeStrategyBase::dullingRateOpacity(qreal opacity, qreal smudgeRateValue)
{
    return 0.8 * smudgeRateValue * opacity;
}

qreal KisColorSmudgeStrategyBase::smearRateOpacity(qreal opacity, qreal smudgeRateValue)
{
    return smudgeRateValue * opacity;
}

void KisColorSmudgeStrategyBase::sampleDullingColor(const QRect &srcRect, qreal sampleRadiusValue,
                                                    KisColorSmudgeSourceSP sourceDevice,
                                                    KisFixedPaintDeviceSP tempFixedDevice,
                                                    KisFixedPaintDeviceSP maskDab, KoColor *resultColor)
{
    using namespace KisColorSmudgeSampleUtils;
    sampleColor<WeightedSampleWrapper>(srcRect, sampleRadiusValue,
                                       sourceDevice, tempFixedDevice,
                                       maskDab, resultColor);
}

void
KisColorSmudgeStrategyBase::blendBrush(const QVector<KisPainter *> dstPainters, KisColorSmudgeSourceSP srcSampleDevice,
                                       KisFixedPaintDeviceSP maskDab, bool preserveMaskDab, const QRect &srcRect,
                                       const QRect &dstRect, const KoColor &currentPaintColor, qreal opacity,
                                       qreal smudgeRateValue, qreal maxPossibleSmudgeRateValue, qreal colorRateValue,
                                       qreal smudgeRadiusValue)
{
    const qreal colorRateOpacity = this->colorRateOpacity(opacity, smudgeRateValue, colorRateValue, maxPossibleSmudgeRateValue);

    if (m_useDullingMode) {
        this->sampleDullingColor(srcRect,
                                 smudgeRadiusValue,
                                 srcSampleDevice, m_blendDevice,
                                 maskDab, &m_preparedDullingColor);

        KIS_SAFE_ASSERT_RECOVER(*m_preparedDullingColor.colorSpace() == *m_colorRateOp->colorSpace()) {
            m_preparedDullingColor.convertTo(m_colorRateOp->colorSpace());
        }
    }

    m_blendDevice->setRect(dstRect);
    m_blendDevice->lazyGrowBufferWithoutInitialization();

    DabColoringStrategy &coloringStrategy = this->coloringStrategy();
    coloringStrategy.mixByModel = m_mixByModel;

    const qreal dullingRateOpacity = this->dullingRateOpacity(opacity, smudgeRateValue);

    if (colorRateOpacity > 0 &&
        !m_mixByModel && // Toska: the fused shortcut is Krita's own arithmetic; a model takes the two blends apart
        m_useDullingMode &&
        coloringStrategy.supportsFusedDullingBlending() &&
        ((m_smearOp->id() == COMPOSITE_OVER &&
          m_colorRateOp->id() == COMPOSITE_OVER) ||
         (m_smearOp->id() == COMPOSITE_COPY &&
          qFuzzyCompare(dullingRateOpacity, OPACITY_OPAQUE_F)))) {

        coloringStrategy.blendInFusedBackgroundAndColorRateWithDulling(m_blendDevice,
                                                                       srcSampleDevice,
                                                                       dstRect,
                                                                       m_preparedDullingColor,
                                                                       m_smearOp,
                                                                       dullingRateOpacity,
                                                                       currentPaintColor.convertedTo(
                                                                               m_preparedDullingColor.colorSpace()),
                                                                       m_colorRateOp,
                                                                       colorRateOpacity);

    } else {
        if (!m_useDullingMode) {
            const qreal smudgeRateOpacity = this->smearRateOpacity(opacity, smudgeRateValue);
            blendInBackgroundWithSmearing(m_blendDevice, srcSampleDevice,
                                          srcRect, dstRect, smudgeRateOpacity);
        } else {
            blendInBackgroundWithDulling(m_blendDevice, srcSampleDevice,
                                         dstRect,
                                         m_preparedDullingColor, dullingRateOpacity);
        }

        if (colorRateOpacity > 0) {
            coloringStrategy.blendInColorRate(
                    currentPaintColor.convertedTo(m_preparedDullingColor.colorSpace()),
                    m_colorRateOp,
                    colorRateOpacity,
                    m_blendDevice, dstRect);
        }
    }

    const bool preserveDab = preserveMaskDab && dstPainters.size() > 1;

    Q_FOREACH (KisPainter *dstPainter, dstPainters) {
        dstPainter->setOpacityF(finalPainterOpacity(opacity, smudgeRateValue));

        dstPainter->bltFixedWithFixedSelection(dstRect.x(), dstRect.y(),
                                               m_blendDevice, maskDab,
                                               maskDab->bounds().x(), maskDab->bounds().y(),
                                               m_blendDevice->bounds().x(), m_blendDevice->bounds().y(),
                                               dstRect.width(), dstRect.height());
        dstPainter->renderMirrorMaskSafe(dstRect, m_blendDevice, maskDab, preserveDab);
    }

}

void KisColorSmudgeStrategyBase::blendInBackgroundWithSmearing(KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src,
                                                               const QRect &srcRect, const QRect &dstRect,
                                                               const qreal smudgeRateOpacity)
{
    if (m_smearOp->id() == COMPOSITE_COPY && qFuzzyCompare(smudgeRateOpacity, OPACITY_OPAQUE_F)) {
        src->readBytes(dst->data(), srcRect);
    } else {
        src->readBytes(dst->data(), dstRect);

        KisFixedPaintDevice tempDevice(src->colorSpace(), m_memoryAllocator);
        tempDevice.setRect(srcRect);
        tempDevice.lazyGrowBufferWithoutInitialization();

        src->readBytes(tempDevice.data(), srcRect);
        if (m_mixByModel) {
            blendByModel(*m_mixByModel, m_smearOp, dst->data(), tempDevice.data(), false,
                         dstRect.width() * dstRect.height(), smudgeRateOpacity);
            return;
        }
        m_smearOp->composite(dst->data(), dstRect.width() * dst->pixelSize(),
                             tempDevice.data(), dstRect.width() * tempDevice.pixelSize(), // stride should be random non-zero
                             0, 0,
                             1, dstRect.width() * dstRect.height(),
                             smudgeRateOpacity);
    }
}

void KisColorSmudgeStrategyBase::blendInBackgroundWithDulling(KisFixedPaintDeviceSP dst, KisColorSmudgeSourceSP src,
                                                              const QRect &dstRect, const KoColor &preparedDullingColor,
                                                              const qreal smudgeRateOpacity)
{
    Q_UNUSED(preparedDullingColor);

    if (m_smearOp->id() == COMPOSITE_COPY && qFuzzyCompare(smudgeRateOpacity, OPACITY_OPAQUE_F)) {
        dst->fill(dst->bounds(), m_preparedDullingColor);
    } else {
        src->readBytes(dst->data(), dstRect);
        if (m_mixByModel) {
            blendByModel(*m_mixByModel, m_smearOp, dst->data(), m_preparedDullingColor.data(), true,
                         dstRect.width() * dstRect.height(), smudgeRateOpacity);
            return;
        }
        m_smearOp->composite(dst->data(), dstRect.width() * dst->pixelSize(),
                             m_preparedDullingColor.data(), 0,
                             0, 0,
                             1, dstRect.width() * dstRect.height(),
                             smudgeRateOpacity);
    }
}
