/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisColorSmudgeMixingOptionData.h"

#include <kis_properties_configuration.h>

namespace {
std::optional<KisPaintMix::Model> modelOf(const QString &id)
{
    const QByteArray latin = id.toLatin1();
    return KisPaintMix::modelFromId(std::string_view(latin.constData(), size_t(latin.size())));
}
}

bool KisColorSmudgeMixingOptionData::read(const KisPropertiesConfiguration *setting)
{
    const QString id = setting->getString("ToskaMixingModel", QStringLiteral("rgb"));
    model = modelOf(id) ? id : QStringLiteral("rgb");
    mixOnBrush = setting->getBool("ToskaMixOnBrush", true);
    mixInWetPaint = setting->getBool("ToskaMixInWetPaint", false);
    return true;
}

void KisColorSmudgeMixingOptionData::write(KisPropertiesConfiguration *setting) const
{
    setting->setProperty("ToskaMixingModel", model);
    setting->setProperty("ToskaMixOnBrush", mixOnBrush);
    setting->setProperty("ToskaMixInWetPaint", mixInWetPaint);
}

KisPaintMix::Settings KisColorSmudgeMixingOptionData::settings() const
{
    KisPaintMix::Settings s;
    s.model = modelOf(model).value_or(KisPaintMix::Model::Rgb);
    s.mixOnBrush = mixOnBrush;
    s.mixInWetPaint = mixInWetPaint;
    return s;
}
