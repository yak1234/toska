/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISCOLORSMUDGEMIXINGOPTIONWIDGET_H
#define KISCOLORSMUDGEMIXINGOPTIONWIDGET_H

#include <kis_paintop_option.h>
#include <KisColorSmudgeMixingOptionData.h>
#include <lager/cursor.hpp>

class KisColorSmudgeMixingOptionWidget : public KisPaintOpOption
{
public:
    using data_type = KisColorSmudgeMixingOptionData;

    KisColorSmudgeMixingOptionWidget(lager::cursor<KisColorSmudgeMixingOptionData> optionData);
    ~KisColorSmudgeMixingOptionWidget();

    void writeOptionSetting(KisPropertiesConfigurationSP setting) const override;
    void readOptionSetting(const KisPropertiesConfigurationSP setting) override;

private:
    struct Private;
    const QScopedPointer<Private> m_d;
};

#endif // KISCOLORSMUDGEMIXINGOPTIONWIDGET_H
