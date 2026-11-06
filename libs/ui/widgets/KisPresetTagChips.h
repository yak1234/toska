/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KIS_PRESET_TAG_CHIPS_H
#define KIS_PRESET_TAG_CHIPS_H

#include <QList>
#include <QString>
#include <QVector>
#include <QWidget>

#include <kritaui_export.h>

class KisTagChooserWidget;
class KisTagModel;
class QAbstractItemModel;
class QMenu;
class QToolButton;

/**
 * The brush chooser's tags as one row of chips. It is a view on the chooser's KisTagChooserWidget, which stays in charge
 * of the tag (it stays hidden, and keeps choosing, remembering and restoring it): a chip selects through it, and follows it.
 * Tags that do not fit in the row go to addOverflowTo(), the row's … menu; the current tag always has a chip.
 */
class KRITAUI_EXPORT KisPresetTagChips : public QWidget
{
    Q_OBJECT

public:
    KisPresetTagChips(KisTagChooserWidget *chooser, QWidget *parent = nullptr);
    ~KisPresetTagChips() override;

    /**
     * Which chips of the given widths fit in \p available, \p gap apart, in their order. The one at \p current is always
     * among them when it exists, replacing the last that fit if need be.
     */
    static QVector<int> chipsThatFit(const QVector<int> &widths, int available, int gap, int current);

    /// The names of the chips, and of those showing now.
    QStringList tagNames() const;
    QStringList visibleTagNames() const;

    /// Adds the tags without a chip to \p menu; choosing one selects it.
    void addOverflowTo(QMenu *menu);

    QSize sizeHint() const override;
    QSize minimumSizeHint() const override;

public Q_SLOTS:
    /// Reads the tags from the model again.
    void rebuild();

protected:
    void resizeEvent(QResizeEvent *event) override;
    void changeEvent(QEvent *event) override;

private Q_SLOTS:
    void slotCurrentTagChanged();

private:
    void layoutChips();
    void applyStyle();
    void choose(int chip);

    struct Chip {
        QString url;
        QString name;
        QToolButton *button {nullptr};
    };

    KisTagChooserWidget *m_chooser {nullptr};
    QAbstractItemModel *m_model {nullptr};
    QList<Chip> m_chips;
    bool m_styling {false};
};

#endif // KIS_PRESET_TAG_CHIPS_H
