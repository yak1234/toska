/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisColorSmudgeMixingOptionWidget.h"

#include <QWidget>
#include <QLabel>
#include <QCheckBox>
#include <QComboBox>
#include <QVBoxLayout>

#include <klocalizedstring.h>

#include <KisColorSmudgeMixingOptionModel.h>
#include <KisWidgetConnectionUtils.h>

struct KisColorSmudgeMixingOptionWidget::Private
{
    Private(lager::cursor<KisColorSmudgeMixingOptionData> optionData)
        : model(optionData)
    {
    }

    KisColorSmudgeMixingOptionModel model;
};

KisColorSmudgeMixingOptionWidget::KisColorSmudgeMixingOptionWidget(lager::cursor<KisColorSmudgeMixingOptionData> optionData)
    : KisPaintOpOption(i18n("Colour Mixing"), KisPaintOpOption::GENERAL, true)
    , m_d(new Private(optionData))
{
    using namespace KisWidgetConnectionUtils;

    setObjectName("KisColorSmudgeMixingOption");
    m_checkable = false;

    QWidget *page = new QWidget();

    QLabel *label = new QLabel(i18n("How the brush mixes its colour with the paint it picks up:"), page);
    label->setWordWrap(true);

    // the order of KisColorSmudgeMixingOptionModel's list
    QComboBox *models = new QComboBox(page);
    models->addItem(i18n("RGB (Krita)"));
    models->addItem(i18n("Linear light"));
    models->addItem(i18n("Perceptual"));
    models->addItem(i18n("Spectral (MyPaint)"));
    models->addItem(i18n("Pigment (Mixbox)"));

    QCheckBox *onBrush = new QCheckBox(i18n("Mix on the brush"), page);
    QCheckBox *inWetPaint = new QCheckBox(i18n("Mix in wet paint (not used yet)"), page);

    QVBoxLayout *layout = new QVBoxLayout(page);
    layout->addWidget(label);
    layout->addWidget(models);
    layout->addWidget(onBrush);
    layout->addWidget(inWetPaint);
    layout->addStretch(1);

    connect(&m_d->model, &KisColorSmudgeMixingOptionModel::modelChanged, models, &QComboBox::setCurrentIndex);
    connect(models, qOverload<int>(&QComboBox::currentIndexChanged), &m_d->model, &KisColorSmudgeMixingOptionModel::setmodel);
    models->setCurrentIndex(m_d->model.model());
    connectControl(onBrush, &m_d->model, "mixOnBrush");
    connectControl(inWetPaint, &m_d->model, "mixInWetPaint");

    setConfigurationPage(page);

    m_d->model.optionData.bind(std::bind(&KisColorSmudgeMixingOptionWidget::emitSettingChanged, this));
}

KisColorSmudgeMixingOptionWidget::~KisColorSmudgeMixingOptionWidget()
{
}

void KisColorSmudgeMixingOptionWidget::writeOptionSetting(KisPropertiesConfigurationSP setting) const
{
    m_d->model.optionData->write(setting.data());
}

void KisColorSmudgeMixingOptionWidget::readOptionSetting(const KisPropertiesConfigurationSP setting)
{
    KisColorSmudgeMixingOptionData data = *m_d->model.optionData;
    data.read(setting.data());
    m_d->model.optionData.set(data);
}
