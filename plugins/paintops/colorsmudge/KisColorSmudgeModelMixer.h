/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISCOLORSMUDGEMODELMIXER_H
#define KISCOLORSMUDGEMODELMIXER_H

#include <QtGlobal>
#include <KoMixColorsOp.h>
#include <KisPaintMix.h>

/**
 * Toska: averages the pixels a smudge brush picks up (its dulling colour) by a paint-mixing model instead of plain RGB:
 * yellow and blue under the brush are picked up as a green, not a grey. Colour is weighted by the weight times the
 * pixel's alpha, as Krita's own mixer does, and the alpha is the weighted mean of the alphas.
 * Spectral: the weighted geometric mean of the spectra (a sum of log spectra). Pigment: the weighted sum of Mixbox
 * latents. create() gives nothing for the other models, which keep Krita's mixer.
 */
class KisColorSmudgeModelMixer : public KoMixColorsOp::Mixer
{
public:
    static KoMixColorsOp::Mixer *create(KisPaintMix::Model model, KisPaintMix::PixelFormat format);

    void accumulate(const quint8 *data, const qint16 *weights, int weightSum, int nPixels) override;
    void accumulateAverage(const quint8 *data, int nPixels) override;
    void computeMixedColor(quint8 *data) override;
    qint64 currentWeightsSum() const override;

private:
    KisColorSmudgeModelMixer(KisPaintMix::Model model, KisPaintMix::PixelFormat format);
    void add(const quint8 *pixel, float weight);

    KisPaintMix::Model m_model;
    KisPaintMix::PixelFormat m_format;
    int m_pixelSize;
    float m_bands[12] {};        // spectral: the weighted sum of log spectra
    float m_latent[7] {};        // pigment: the weighted sum of latents (four concentrations, three residuals)
    double m_colourWeight {0.0}; // the sum of weight * alpha
    double m_alpha {0.0};        // the sum of weight * alpha, for the mean alpha
    qint64 m_weights {0};
};

#endif // KISCOLORSMUDGEMODELMIXER_H
