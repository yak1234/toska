/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KOCOMPOSITEOPTOSKAMIX_H
#define KOCOMPOSITEOPTOSKAMIX_H

#include <KoCompositeOp.h>
#include "kritapigment_export.h"

/**
 * Toska: blend modes that mix colour by a paint-mixing model (plugins/paintops/libpaintmix) instead of averaging RGB:
 * spectral (libmypaint's), pigment (Mixbox), linear light and perceptual. Coverage is worked out as Normal does (or as
 * Copy does, for the copy ids); only the colour of the mix differs. Blue over yellow at half coverage is green, not
 * grey. RGBA colour spaces of 8-bit, 16-bit and 32-bit float depth only; a linear-light profile is mixed in sRGB
 * encoding (the models take encoded colours) and stored back as linear.
 *
 * Any brush engine, layer or fill mixes by a model by naming one of these as its blend mode.
 */
class KRITAPIGMENT_EXPORT KoCompositeOpToskaMix : public KoCompositeOp
{
public:
    /// The models, in the order of KisPaintMix::Model without rgb (which is Normal itself).
    enum Mix { LinearLight, Perceptual, Spectral, Pigment };

    KoCompositeOpToskaMix(const KoColorSpace *cs, Mix mix, bool copy);

    using KoCompositeOp::composite;
    void composite(const KoCompositeOp::ParameterInfo &params) const override;

    /// The blend mode's id: toska_mix_<model>, with _copy for the Copy form (the model ids are libpaintmix's).
    static QString idFor(Mix mix, bool copy);
    /// idFor by libpaintmix's model id ("spectral", "pigment", "linear", "perceptual"); empty for "rgb" or an unknown id.
    static QString idForModel(const QString &modelId, bool copy);
    /// Adds every model's two blend modes to cs when it is an RGBA space of a depth the models read; nothing otherwise.
    static void addTo(KoColorSpace *cs);

private:
    int m_mix;
    bool m_copy;
    int m_format {-1};      // KisPaintMix::PixelFormat, -1 when the colour space is not one the models read
    bool m_linear {false};  // the profile holds linear light
};

#endif // KOCOMPOSITEOPTOSKAMIX_H
