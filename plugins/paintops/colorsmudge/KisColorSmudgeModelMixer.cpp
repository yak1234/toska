/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisColorSmudgeModelMixer.h"

#include <cstring>
#include <QtGlobal>

namespace {

struct Pixel {
    KisPaintMix::Rgb colour;
    float alpha;
};

Pixel load(KisPaintMix::PixelFormat f, const quint8 *p)
{
    if (f == KisPaintMix::PixelFormat::Bgra8) {
        return {{p[2] / 255.0f, p[1] / 255.0f, p[0] / 255.0f}, p[3] / 255.0f};
    }
    if (f == KisPaintMix::PixelFormat::Bgra16) {
        quint16 v[4];
        std::memcpy(v, p, 8);
        return {{v[2] / 65535.0f, v[1] / 65535.0f, v[0] / 65535.0f}, v[3] / 65535.0f};
    }
    float v[4];
    std::memcpy(v, p, 16);
    return {{v[0], v[1], v[2]}, v[3]};
}

void store(KisPaintMix::PixelFormat f, quint8 *p, KisPaintMix::Rgb c, float a)
{
    if (f == KisPaintMix::PixelFormat::Bgra8) {
        auto q = [](float x) { return quint8(qBound(0.0f, x * 255.0f + 0.5f, 255.0f)); };
        p[0] = q(c.b); p[1] = q(c.g); p[2] = q(c.r); p[3] = q(a);
    } else if (f == KisPaintMix::PixelFormat::Bgra16) {
        auto q = [](float x) { return quint16(qBound(0.0f, x * 65535.0f + 0.5f, 65535.0f)); };
        const quint16 v[4] = {q(c.b), q(c.g), q(c.r), q(a)};
        std::memcpy(p, v, 8);
    } else {
        const float v[4] = {c.r, c.g, c.b, a};
        std::memcpy(p, v, 16);
    }
}

}

KoMixColorsOp::Mixer *KisColorSmudgeModelMixer::create(KisPaintMix::Model model, KisPaintMix::PixelFormat format)
{
    if (model != KisPaintMix::Model::Spectral && model != KisPaintMix::Model::Pigment) return nullptr;
    return new KisColorSmudgeModelMixer(model, format);
}

KisColorSmudgeModelMixer::KisColorSmudgeModelMixer(KisPaintMix::Model model, KisPaintMix::PixelFormat format)
    : m_model(model)
    , m_format(format)
    , m_pixelSize(format == KisPaintMix::PixelFormat::Bgra8 ? 4 : format == KisPaintMix::PixelFormat::Bgra16 ? 8 : 16)
{
}

void KisColorSmudgeModelMixer::add(const quint8 *pixel, float weight)
{
    const Pixel p = load(m_format, pixel);
    const float w = weight * p.alpha;
    m_alpha += double(w);
    if (!(w > 0.0f)) return;
    if (m_model == KisPaintMix::Model::Spectral) {
        KisPaintMix::LogSpectrum log;
        KisPaintMix::toLogSpectrum(p.colour, log);
        for (int i = 0; i < 12; i++) m_bands[i] += w * log.band[i];
    } else {
        const KisPaintMix::Latent latent = KisPaintMix::rgbToLatent(p.colour);
        for (int i = 0; i < 4; i++) m_latent[i] += w * latent.c[i];
        for (int i = 0; i < 3; i++) m_latent[4 + i] += w * latent.residual[i];
    }
    m_colourWeight += double(w);
}

void KisColorSmudgeModelMixer::accumulate(const quint8 *data, const qint16 *weights, int weightSum, int nPixels)
{
    for (int i = 0; i < nPixels; i++) add(data + i * m_pixelSize, float(weights[i]));
    m_weights += weightSum;
}

void KisColorSmudgeModelMixer::accumulateAverage(const quint8 *data, int nPixels)
{
    for (int i = 0; i < nPixels; i++) add(data + i * m_pixelSize, 1.0f);
    m_weights += nPixels;
}

void KisColorSmudgeModelMixer::computeMixedColor(quint8 *data)
{
    if (!(m_colourWeight > 0.0) || m_weights <= 0) {
        std::memset(data, 0, size_t(m_pixelSize));
        return;
    }
    const float inverse = float(1.0 / m_colourWeight);
    KisPaintMix::Rgb colour;
    if (m_model == KisPaintMix::Model::Spectral) {
        KisPaintMix::LogSpectrum mean;
        for (int i = 0; i < 12; i++) mean.band[i] = m_bands[i] * inverse;
        colour = KisPaintMix::fromLogSpectrum(mean);
    } else {
        KisPaintMix::Latent mean;
        for (int i = 0; i < 4; i++) mean.c[i] = m_latent[i] * inverse;
        for (int i = 0; i < 3; i++) mean.residual[i] = m_latent[4 + i] * inverse;
        colour = KisPaintMix::latentToRgb(mean);
    }
    store(m_format, data, colour, float(qMin(1.0, m_alpha / double(m_weights))));
}

qint64 KisColorSmudgeModelMixer::currentWeightsSum() const
{
    return m_weights;
}
