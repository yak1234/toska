/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISCOLORSMUDGEMIXINGOPTIONDATA_H
#define KISCOLORSMUDGEMIXINGOPTIONDATA_H

#include <QString>
#include <boost/operators.hpp>

#include <KisPaintMix.h>

class KisPropertiesConfiguration;

/**
 * How a Color Smudge preset mixes colour (the preset properties ToskaMixingModel, ToskaMixOnBrush, ToskaMixInWetPaint).
 * A preset without them mixes as Krita always has (rgb). model is one of KisPaintMix's ids; an unknown id reads as rgb.
 * mixInWetPaint is stored only: nothing reads it yet.
 */
struct KisColorSmudgeMixingOptionData : boost::equality_comparable<KisColorSmudgeMixingOptionData>
{
    inline friend bool operator==(const KisColorSmudgeMixingOptionData &lhs, const KisColorSmudgeMixingOptionData &rhs) {
        return lhs.model == rhs.model && lhs.mixOnBrush == rhs.mixOnBrush && lhs.mixInWetPaint == rhs.mixInWetPaint;
    }

    QString model {QStringLiteral("rgb")};
    bool mixOnBrush {true};
    bool mixInWetPaint {false};

    bool read(const KisPropertiesConfiguration *setting);
    void write(KisPropertiesConfiguration *setting) const;

    /// What the engine mixes with.
    KisPaintMix::Settings settings() const;
};

#endif // KISCOLORSMUDGEMIXINGOPTIONDATA_H
