/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISCOLORSMUDGEMIXINGOPTIONMODEL_H
#define KISCOLORSMUDGEMIXINGOPTIONMODEL_H

#include <QObject>
#include <lager/cursor.hpp>
#include <lager/extra/qt.hpp>

#include "KisColorSmudgeMixingOptionData.h"

class KisColorSmudgeMixingOptionModel : public QObject
{
    Q_OBJECT
public:
    KisColorSmudgeMixingOptionModel(lager::cursor<KisColorSmudgeMixingOptionData> optionData);

    lager::cursor<KisColorSmudgeMixingOptionData> optionData;

    /// The model's place in the widget's list (the order of KisPaintMix::Model).
    LAGER_QT_CURSOR(int, model);
    LAGER_QT_CURSOR(bool, mixOnBrush);
    LAGER_QT_CURSOR(bool, mixInWetPaint);
};

#endif // KISCOLORSMUDGEMIXINGOPTIONMODEL_H
