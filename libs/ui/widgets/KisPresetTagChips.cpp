/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPresetTagChips.h"

#include <QEvent>
#include <QMenu>
#include <QToolButton>

#include <KisTag.h>
#include <KisTagChooserWidget.h>
#include <KisTagModel.h>

namespace {
constexpr int kChipHeight = 28;
constexpr int kChipGap = 4;
}

KisPresetTagChips::KisPresetTagChips(KisTagChooserWidget *chooser, QWidget *parent)
    : QWidget(parent)
    , m_chooser(chooser)
    , m_model(chooser->model())
{
    setObjectName(QStringLiteral("KisPresetTagChips"));
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    connect(m_model, &QAbstractItemModel::modelReset, this, &KisPresetTagChips::rebuild);
    connect(m_model, &QAbstractItemModel::layoutChanged, this, &KisPresetTagChips::rebuild);
    connect(m_model, &QAbstractItemModel::rowsInserted, this, &KisPresetTagChips::rebuild);
    connect(m_model, &QAbstractItemModel::rowsRemoved, this, &KisPresetTagChips::rebuild);
    connect(m_model, &QAbstractItemModel::dataChanged, this, &KisPresetTagChips::rebuild);
    connect(m_chooser, &KisTagChooserWidget::sigTagChosen, this, &KisPresetTagChips::slotCurrentTagChanged);
    rebuild();
}

KisPresetTagChips::~KisPresetTagChips()
{
}

QVector<int> KisPresetTagChips::chipsThatFit(const QVector<int> &widths, int available, int gap, int current)
{
    QVector<int> shown;
    int used = 0;
    for (int i = 0; i < widths.size(); i++) {
        const int needed = widths[i] + (shown.isEmpty() ? 0 : gap);
        if (used + needed > available) break;
        used += needed;
        shown << i;
    }
    if (current < 0 || current >= widths.size() || shown.contains(current)) return shown;

    // The current chip takes the place of as many of the last ones as it needs.
    while (!shown.isEmpty()) {
        const int withCurrent = used + widths[current] + gap;
        if (withCurrent <= available) break;
        const int last = shown.takeLast();
        used -= widths[last] + (shown.isEmpty() ? 0 : gap);
    }
    shown << current;
    return shown;
}

QStringList KisPresetTagChips::tagNames() const
{
    QStringList names;
    for (const Chip &chip : m_chips) names << chip.name;
    return names;
}

QStringList KisPresetTagChips::visibleTagNames() const
{
    QStringList names;
    for (const Chip &chip : m_chips) {
        if (chip.button->isVisibleTo(this)) names << chip.name;
    }
    return names;
}

void KisPresetTagChips::addOverflowTo(QMenu *menu)
{
    for (int i = 0; i < m_chips.size(); i++) {
        if (m_chips[i].button->isVisibleTo(this)) continue;
        QAction *action = menu->addAction(m_chips[i].name);
        connect(action, &QAction::triggered, this, [this, i] () { choose(i); });
    }
}

QSize KisPresetTagChips::sizeHint() const
{
    int width = 0;
    for (const Chip &chip : m_chips) width += chip.button->sizeHint().width() + kChipGap;
    return QSize(width, kChipHeight);
}

QSize KisPresetTagChips::minimumSizeHint() const
{
    return QSize(0, kChipHeight);
}

void KisPresetTagChips::rebuild()
{
    const KisTagSP current = m_chooser->currentlySelectedTag();
    const QString currentUrl = current ? current->url() : QString();

    for (const Chip &chip : std::as_const(m_chips)) delete chip.button;
    m_chips.clear();

    for (int row = 0; row < m_model->rowCount(); row++) {
        const QModelIndex index = m_model->index(row, 0);
        Chip chip;
        chip.url = index.data(Qt::UserRole + KisAllTagsModel::Url).toString();
        chip.name = index.data(Qt::DisplayRole).toString();
        chip.button = new QToolButton(this);
        chip.button->setText(chip.name);
        chip.button->setToolTip(chip.name);
        chip.button->setCheckable(true);
        chip.button->setChecked(chip.url == currentUrl);
        chip.button->setAutoRaise(true);
        chip.button->setFocusPolicy(Qt::TabFocus);
        chip.button->setFixedHeight(kChipHeight);
        const int position = m_chips.size();
        connect(chip.button, &QToolButton::clicked, this, [this, position] () { choose(position); });
        m_chips << chip;
    }
    applyStyle();
    layoutChips();
    updateGeometry();
}

void KisPresetTagChips::slotCurrentTagChanged()
{
    const KisTagSP current = m_chooser->currentlySelectedTag();
    const QString currentUrl = current ? current->url() : QString();
    for (const Chip &chip : std::as_const(m_chips)) {
        chip.button->setChecked(chip.url == currentUrl);
    }
    layoutChips();
}

void KisPresetTagChips::choose(int chip)
{
    if (chip < 0 || chip >= m_chips.size()) return;
    m_chooser->setCurrentItem(m_chips[chip].url);
    // Choosing the current tag again leaves the chooser quiet, and clicking unchecked its chip.
    slotCurrentTagChanged();
}

void KisPresetTagChips::layoutChips()
{
    QVector<int> widths;
    int current = -1;
    for (int i = 0; i < m_chips.size(); i++) {
        widths << m_chips[i].button->sizeHint().width();
        if (m_chips[i].button->isChecked()) current = i;
    }
    const QVector<int> shown = chipsThatFit(widths, width(), kChipGap, current);
    int x = 0;
    for (int i = 0; i < m_chips.size(); i++) {
        m_chips[i].button->setVisible(shown.contains(i));
    }
    for (int i : shown) {
        m_chips[i].button->setGeometry(x, (height() - kChipHeight) / 2, widths[i], kChipHeight);
        x += widths[i] + kChipGap;
    }
}

void KisPresetTagChips::applyStyle()
{
    if (m_styling) return;
    m_styling = true;
    const QPalette colors = palette();
    const QColor textColor = colors.color(QPalette::WindowText);
    const QColor window = colors.color(QPalette::Window);
    // Text a step towards the background, what the mockup calls muted (Toska Night's own muted is within a few levels).
    const QColor mutedColor = QColor::fromRgbF(textColor.redF() * 0.6f + window.redF() * 0.4f,
                                               textColor.greenF() * 0.6f + window.greenF() * 0.4f,
                                               textColor.blueF() * 0.6f + window.blueF() * 0.4f);
    const QString muted = mutedColor.name();
    const QString text = textColor.name();
    const QString raised = colors.color(QPalette::Button).name();
    const QString style = QStringLiteral(
        "QToolButton { border: none; border-radius: 14px; padding: 0 10px; background: transparent; color: %1; }"
        "QToolButton:hover { color: %2; }"
        "QToolButton:checked { background: %3; color: %2; }").arg(muted, text, raised);
    for (const Chip &chip : std::as_const(m_chips)) chip.button->setStyleSheet(style);
    m_styling = false;
}

void KisPresetTagChips::resizeEvent(QResizeEvent *event)
{
    QWidget::resizeEvent(event);
    layoutChips();
}

void KisPresetTagChips::changeEvent(QEvent *event)
{
    QWidget::changeEvent(event);
    if (event->type() == QEvent::PaletteChange || event->type() == QEvent::StyleChange) {
        applyStyle();
        layoutChips();
    }
}
