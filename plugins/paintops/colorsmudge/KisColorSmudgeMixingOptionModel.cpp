/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisColorSmudgeMixingOptionModel.h"

#include <lager/lenses.hpp>

namespace {
const KisPaintMix::Model listed[] = {KisPaintMix::Model::Rgb, KisPaintMix::Model::LinearLight, KisPaintMix::Model::Perceptual,
                                     KisPaintMix::Model::Spectral, KisPaintMix::Model::Pigment};
const int listedCount = int(sizeof(listed) / sizeof(listed[0]));

auto modelIndex = lager::lenses::getset(
    [](const QString &id) {
        for (int i = 0; i < listedCount; i++) {
            if (id == QLatin1String(KisPaintMix::modelId(listed[i]))) return i;
        }
        return 0;
    },
    [](QString, int index) {
        return QString::fromLatin1(KisPaintMix::modelId(listed[index >= 0 && index < listedCount ? index : 0]));
    });
}

KisColorSmudgeMixingOptionModel::KisColorSmudgeMixingOptionModel(lager::cursor<KisColorSmudgeMixingOptionData> _optionData)
    : optionData(_optionData)
    , LAGER_QT(model) {optionData[&KisColorSmudgeMixingOptionData::model].zoom(modelIndex)}
    , LAGER_QT(mixOnBrush) {optionData[&KisColorSmudgeMixingOptionData::mixOnBrush]}
    , LAGER_QT(mixInWetPaint) {optionData[&KisColorSmudgeMixingOptionData::mixInWetPaint]}
{
}
