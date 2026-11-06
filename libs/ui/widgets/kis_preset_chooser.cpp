/*
 *  SPDX-FileCopyrightText: 2002 Patrick Julien <freak@codepimps.org>
 *  SPDX-FileCopyrightText: 2009 Sven Langkamp <sven.langkamp@gmail.com>
 *  SPDX-FileCopyrightText: 2011 Silvio Heinrich <plassy@web.de>
 *  SPDX-FileCopyrightText: 2011 Srikanth Tiyyagura <srikanth.tulasiram@gmail.com>
 *  SPDX-FileCopyrightText: 2011 José Luis Vergara <pentalis@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Tenzin Rangdol <tenzindraws@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "kis_preset_chooser.h"

#include <QEvent>
#include <QPainterPath>
#include <QScrollBar>
#include <QVBoxLayout>
#include <QPainter>
#include <QAbstractItemDelegate>
#include <QStyleOptionViewItem>
#include <QSortFilterProxyModel>
#include <KisResourceModel.h>
#include <QApplication>

#include <kis_config.h>
#include <klocalizedstring.h>
#include <KisKineticScroller.h>

#include <KoIcon.h>
#include <KisResourceItemChooser.h>
#include <KisResourceItemChooserSync.h>
#include <KisResourceItemListView.h>
#include <KisResourceLocator.h>
#include <KisResourceTypes.h>

#include <brushengine/kis_paintop_settings.h>
#include <brushengine/kis_paintop_preset.h>
#include "kis_config_notifier.h"
#include <kis_icon.h>
#include <KisResourceModelProvider.h>
#include <KisTagFilterResourceProxyModel.h>
#include <KisResourceThumbnailCache.h>
#include <KisResourceMetaDataModel.h>
#include "KisBrushStrokePreviewCache.h"

namespace {

// The mockup's stroke cell (board "Brushes tab"): 8 px between cells, 8 px inside, corners of 8, 12 px names.
constexpr int kCellGap = 8;
constexpr int kCellPadding = 8;
constexpr int kCellRadius = 8;
constexpr int kNamePixelSize = 12;
constexpr int kNameGap = 6;
constexpr qreal kOutlineWidth = 1.5;

qreal relativeLuminance(const QColor &color)
{
    const auto linear = [] (qreal v) { return v <= 0.03928 ? v / 12.92 : std::pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * linear(color.redF()) + 0.7152 * linear(color.greenF()) + 0.0722 * linear(color.blueF());
}

qreal contrastOf(const QColor &a, const QColor &b)
{
    const qreal x = relativeLuminance(a), y = relativeLuminance(b);
    return (qMax(x, y) + 0.05) / (qMin(x, y) + 0.05);
}

QString displayName(const QModelIndex &index)
{
    // don't need underscores that might be part of the file name
    return index.data(Qt::UserRole + KisAbstractResourceModel::Name).toString().replace("_", " ");
}

void paintRounded(QPainter *painter, const QRectF &rect, qreal radius, const QColor &fill)
{
    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->setPen(Qt::NoPen);
    painter->setBrush(fill);
    painter->drawRoundedRect(rect, radius, radius);
    painter->restore();
}

void paintOutline(QPainter *painter, const QRectF &rect, qreal radius, const QPalette &palette)
{
    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->setPen(QPen(KisPresetChooser::selectionOutlineColor(palette), kOutlineWidth));
    painter->setBrush(Qt::NoBrush);
    const qreal inset = kOutlineWidth / 2;
    painter->drawRoundedRect(rect.adjusted(inset, inset, -inset, -inset), radius, radius);
    painter->restore();
}

void paintDirtyMark(QPainter *painter, const QRect &cell)
{
    const QIcon icon = KisIconUtils::loadIcon("dirty-preset");
    painter->drawPixmap(cell.x() + 3, cell.y() + 3, icon.pixmap(QSize(14, 14)));
}

void paintBrokenMark(QPainter *painter, const QRect &cell)
{
    const QIcon icon = KisIconUtils::loadIcon("broken-preset");
    const int side = qMin(25, cell.height() / 2);
    icon.paint(painter, QRect(cell.right() - side - 2, cell.bottom() - side - 2, side, side));
}

} // namespace


/// The resource item delegate for rendering the resource preview
class KisPresetDelegate : public QAbstractItemDelegate
{
public:
    KisPresetDelegate(QObject * parent = 0)
        : QAbstractItemDelegate(parent)
        , m_showText(false)
        , m_showStroke(false) {}

    ~KisPresetDelegate() override {}

    /// reimplemented
    void paint(QPainter *, const QStyleOptionViewItem &, const QModelIndex &) const override;

    /// reimplemented
    QSize sizeHint(const QStyleOptionViewItem & option, const QModelIndex &) const override {
        return option.decorationSize;
    }

    void setShowText(bool showText) {
        m_showText = showText;
    }

    void setShowStroke(bool showStroke) {
        m_showStroke = showStroke;
    }

private:
    void paintStroke(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const;
    void paintThumbnail(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const;
    void paintDetail(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const;

    bool m_showText;
    bool m_showStroke;
};

void KisPresetDelegate::paint(QPainter * painter, const QStyleOptionViewItem & option, const QModelIndex & index) const
{
    painter->save();
    painter->setRenderHint(QPainter::SmoothPixmapTransform, true);
    if (!(option.state & QStyle::State_Enabled)) {
        painter->setOpacity(0.2);
    }

    if (!index.isValid()) {
        painter->restore();
        return;
    }

    if (m_showStroke) {
        paintStroke(painter, option, index);
    } else if (m_showText) {
        paintDetail(painter, option, index);
    } else {
        paintThumbnail(painter, option, index);
    }

    painter->restore();
}

void KisPresetDelegate::paintStroke(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const
{
    const bool selected = option.state & QStyle::State_Selected;
    const QRect cell = option.rect.adjusted(kCellGap / 2, kCellGap / 2, -kCellGap / 2, -kCellGap / 2);
    paintRounded(painter, cell, kCellRadius, option.palette.color(selected ? QPalette::Button : QPalette::Base));

    QFont font = painter->font();
    font.setPixelSize(kNamePixelSize);
    painter->setFont(font);
    const QFontMetrics metrics(font);
    const QColor ink = option.palette.color(QPalette::Text);
    const qreal ratio = painter->device()->devicePixelRatioF();
    const QRect strokeRect = cell.adjusted(kCellPadding, kCellPadding, -kCellPadding,
                                           -(kCellPadding + metrics.height() + kNameGap));

    QImage picture = KisBrushStrokePreviewCache::instance()->previewForIndex(index, strokeRect.size() * ratio, ink);
    if (picture.isNull()) {
        // Not painted yet, or an engine with no stroke to show.
        picture = KisResourceThumbnailCache::instance()->getImage(index,
                                                                  QSize(strokeRect.height(), strokeRect.height()) * ratio,
                                                                  Qt::KeepAspectRatio,
                                                                  Qt::SmoothTransformation);
    }
    if (!picture.isNull()) {
        const QSize shown = picture.size() / ratio;
        picture.setDevicePixelRatio(ratio);
        painter->drawImage(QPoint(strokeRect.x() + (strokeRect.width() - shown.width()) / 2,
                                  strokeRect.y() + (strokeRect.height() - shown.height()) / 2),
                           picture);
    }

    const bool dirty = index.data(Qt::UserRole + KisAbstractResourceModel::Dirty).toBool();
    QString name = displayName(index);
    if (dirty) name.append(QLatin1Char('*'));
    const QRect nameRect(cell.x() + kCellPadding, cell.bottom() - kCellPadding - metrics.height() + 1,
                         cell.width() - 2 * kCellPadding, metrics.height());
    painter->setPen(ink);
    painter->drawText(nameRect, Qt::AlignLeft | Qt::AlignVCenter, metrics.elidedText(name, Qt::ElideRight, nameRect.width()));

    if (dirty) paintDirtyMark(painter, cell);
    if (index.data(Qt::UserRole + KisAbstractResourceModel::BrokenStatus).toBool()) paintBrokenMark(painter, cell);
    if (selected) paintOutline(painter, cell, kCellRadius, option.palette);
}

void KisPresetDelegate::paintThumbnail(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const
{
    const qreal ratio = painter->device()->devicePixelRatioF();
    const QRect paintRect = option.rect.adjusted(2, 2, -2, -2);
    const int radius = 6;

    QImage picture = KisResourceThumbnailCache::instance()->getImage(index, paintRect.size() * ratio,
                                                                     Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
    if (picture.isNull()) {
        picture = QImage(paintRect.size() * ratio, QImage::Format_RGB32);
        picture.fill(Qt::red);
    }
    picture.setDevicePixelRatio(ratio);

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    QPainterPath clip;
    clip.addRoundedRect(paintRect, radius, radius);
    painter->setClipPath(clip);
    painter->drawImage(paintRect.topLeft(), picture);
    painter->restore();

    if (index.data(Qt::UserRole + KisAbstractResourceModel::Dirty).toBool()) paintDirtyMark(painter, paintRect);
    if (index.data(Qt::UserRole + KisAbstractResourceModel::BrokenStatus).toBool()) paintBrokenMark(painter, paintRect);
    if (option.state & QStyle::State_Selected) paintOutline(painter, paintRect, radius, option.palette);
}

void KisPresetDelegate::paintDetail(QPainter *painter, const QStyleOptionViewItem &option, const QModelIndex &index) const
{
    const bool selected = option.state & QStyle::State_Selected;
    const QRect row = option.rect.adjusted(1, 1, -1, -1);
    const int radius = 6;
    if (selected) paintRounded(painter, row, radius, option.palette.color(QPalette::Button));

    const qreal ratio = painter->device()->devicePixelRatioF();
    const QRect pictureRect = row.adjusted(3, 3, -3, -3);
    const QSize side(pictureRect.height(), pictureRect.height());
    QImage picture = KisResourceThumbnailCache::instance()->getImage(index, side * ratio, Qt::KeepAspectRatio, Qt::SmoothTransformation);
    if (!picture.isNull()) {
        picture.setDevicePixelRatio(ratio);
        painter->save();
        painter->setRenderHint(QPainter::Antialiasing, true);
        QPainterPath clip;
        clip.addRoundedRect(QRect(pictureRect.topLeft(), side), 4, 4);
        painter->setClipPath(clip);
        painter->drawImage(pictureRect.topLeft(), picture);
        painter->restore();
    }

    // Put an asterisk after the preset if it is dirty. This will help in case the pixmap icon is too small
    const bool dirty = index.data(Qt::UserRole + KisAbstractResourceModel::Dirty).toBool();
    QString name = displayName(index);
    if (dirty) name.append(QLatin1Char('*'));
    const QRect textRect = row.adjusted(side.width() + 12, 0, -6, 0);
    painter->setPen(option.palette.color(QPalette::Text));
    painter->drawText(textRect, Qt::AlignLeft | Qt::AlignVCenter,
                      painter->fontMetrics().elidedText(name, Qt::ElideRight, textRect.width()));

    if (dirty) paintDirtyMark(painter, pictureRect);
    if (index.data(Qt::UserRole + KisAbstractResourceModel::BrokenStatus).toBool()) {
        paintBrokenMark(painter, QRect(pictureRect.topLeft(), side));
    }
    if (selected) paintOutline(painter, row, radius, option.palette);
}

KisPresetChooser::KisPresetChooser(QWidget *parent)
    : QWidget(parent)
{
    setObjectName("KisPresetChooser");

    QVBoxLayout * layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);

    m_chooser = new KisResourceItemChooser(ResourceType::PaintOpPresets, false, this);
    m_chooser->setRowHeight(50);
    m_delegate = new KisPresetDelegate(this);
    m_chooser->setItemDelegate(m_delegate);
    m_chooser->setSynced(true);
    m_chooser->showImportExportBtns(false);
    layout->addWidget(m_chooser);

    connect(m_chooser, SIGNAL(resourceSelected(KoResourceSP )),
            this, SLOT(slotResourceWasSelected(KoResourceSP )));

    connect(m_chooser, SIGNAL(resourceSelected(KoResourceSP )),
            this, SIGNAL(resourceSelected(KoResourceSP )));
    connect(m_chooser, SIGNAL(resourceClicked(KoResourceSP )),
            this, SIGNAL(resourceClicked(KoResourceSP )));

    connect(m_chooser, &KisResourceItemChooser::listViewModeChanged, this, &KisPresetChooser::showHideBrushNames);

    // After setSynced(), so this runs after the chooser made the items square.
    connect(KisResourceItemChooserSync::instance(), SIGNAL(baseLengthChanged(int)),
            this, SLOT(slotBaseLengthChanged(int)));
    connect(KisBrushStrokePreviewCache::instance(), SIGNAL(sigPreviewReady(int)),
            this, SLOT(slotStrokePreviewReady(int)));
    m_chooser->itemView()->installEventFilter(this);

    m_mode = ViewMode::THUMBNAIL;

    connect(KisConfigNotifier::instance(), SIGNAL(configChanged()),
            SLOT(notifyConfigChanged()));


    notifyConfigChanged();
}

KisPresetChooser::~KisPresetChooser()
{
}

void KisPresetChooser::setViewMode(KisPresetChooser::ViewMode mode)
{
    m_mode = mode;
    updateViewSettings();
}

void KisPresetChooser::setViewModeToThumbnail()
{
    setViewMode(KisPresetChooser::ViewMode::THUMBNAIL);
}

void KisPresetChooser::setViewModeToDetail()
{
    setViewMode(KisPresetChooser::ViewMode::DETAIL);
}

void KisPresetChooser::setViewModeToStroke()
{
    setViewMode(KisPresetChooser::ViewMode::STROKE);
}

KisPresetChooser::ViewMode KisPresetChooser::viewMode() const
{
    return m_mode;
}

void KisPresetChooser::setPlainBackground(bool plain)
{
    KisResourceItemListView *view = m_chooser->itemView();
    view->setFrameShape(plain ? QFrame::NoFrame : QFrame::StyledPanel);
    view->viewport()->setAutoFillBackground(!plain);
}

int KisPresetChooser::strokeGridHeight(int iconSize)
{
    // 60, the default, makes the mockup's cell: a 48 px stroke over a name.
    return iconSize * 4 / 5 + 52;
}

int KisPresetChooser::strokeGridColumns(int viewWidth)
{
    if (viewWidth < 240) return 1;
    return qMax(2, viewWidth / 300);
}

QColor KisPresetChooser::selectionOutlineColor(const QPalette &palette)
{
    const QColor cell = palette.color(QPalette::Button);
    QColor outline = palette.color(QPalette::Highlight);
    const bool lighten = relativeLuminance(cell) < 0.3;
    for (int i = 0; i < 8 && contrastOf(outline, cell) < 3.2; i++) {
        outline = lighten ? outline.lighter(112) : outline.darker(112);
    }
    return outline;
}

void KisPresetChooser::updateStrokeGrid()
{
    if (m_mode != ViewMode::STROKE || m_stripLayout) return;
    KisResourceItemListView *view = m_chooser->itemView();
    // Room for the scrollbar is always kept: a width that depends on it could flip between two layouts.
    const bool transient = view->style()->styleHint(QStyle::SH_ScrollBar_Transient, nullptr, view);
    const int scrollbar = transient ? 0 : view->verticalScrollBar()->sizeHint().width();
    // Two pixels spare: QListView wraps a row that ends exactly at the viewport's edge.
    const int width = qMax(1, view->contentsRect().width() - scrollbar - 2);
    const int columns = strokeGridColumns(width);
    const QSize cell(width / columns, strokeGridHeight(iconSize()));
    if (view->gridSize() != cell) {
        view->setGridSize(cell);
        view->setIconSize(cell);
    }
}

void KisPresetChooser::requestStrokePreviews()
{
    if (m_mode == ViewMode::STROKE && isVisible()) {
        KisBrushStrokePreviewCache::instance()->requestAll();
    }
}

void KisPresetChooser::slotStrokePreviewReady(int resourceId)
{
    if (m_mode != ViewMode::STROKE || !isVisible()) return;
    KisResourceItemListView *view = m_chooser->itemView();
    const QModelIndex index = m_chooser->tagFilterModel()->indexForResourceId(resourceId);
    if (index.isValid()) view->viewport()->update(view->visualRect(index));
}

void KisPresetChooser::slotBaseLengthChanged(int /*length*/)
{
    updateStrokeGrid();
}

bool KisPresetChooser::eventFilter(QObject *watched, QEvent *event)
{
    if (watched == m_chooser->itemView() && event->type() == QEvent::Resize) {
        updateStrokeGrid();
    }
    return QWidget::eventFilter(watched, event);
}

void KisPresetChooser::showEvent(QShowEvent *event)
{
    QWidget::showEvent(event);
    updateStrokeGrid();
    requestStrokePreviews();
}

void KisPresetChooser::notifyConfigChanged()
{
    KisConfig cfg(true);
    setIconSize(cfg.presetIconSize());
}

void KisPresetChooser::slotResourceWasSelected(KoResourceSP resource)
{
    m_currentPresetConnections.clear();
    if (!resource) return;

    KisPaintOpPresetSP preset = resource.dynamicCast<KisPaintOpPreset>();
    KIS_SAFE_ASSERT_RECOVER_RETURN(preset);

    m_currentPresetConnections.addUniqueConnection(
        preset->updateProxy(), SIGNAL(sigSettingsChanged()),
        this, SLOT(slotCurrentPresetChanged()));
}

void KisPresetChooser::slotCurrentPresetChanged()
{
    KoResourceSP currentResource = m_chooser->currentResource();
    if (!currentResource) return;

    QModelIndex index = m_chooser->tagFilterModel()->indexForResource(currentResource);
    Q_EMIT m_chooser->tagFilterModel()->dataChanged(index,
                                               index,
                                               {Qt::UserRole + KisAbstractResourceModel::Thumbnail});
}

void KisPresetChooser::updateViewSettings()
{
    switch (m_mode) {
    case ViewMode::THUMBNAIL: {
        m_chooser->setListViewMode(ListViewMode::IconGrid);
        m_delegate->setShowText(false);
        break;
    }
    case ViewMode::DETAIL: {
        m_chooser->setListViewMode(ListViewMode::Detail);
        m_delegate->setShowText(true);
        break;
    }
    case ViewMode::STROKE: {
        m_chooser->setListViewMode(ListViewMode::IconGrid);
        m_delegate->setShowText(false);
        break;
    }
    }
    m_delegate->setShowStroke(m_mode == ViewMode::STROKE && !m_stripLayout);
    if (m_mode == ViewMode::STROKE && !m_stripLayout) {
        m_chooser->itemView()->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    } else if (!m_stripLayout) {
        m_chooser->itemView()->setHorizontalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    }
    if (m_mode != ViewMode::STROKE && !m_stripLayout) {
        // Square icons again: the list view keeps the size it was last asked for, not what Strokes set directly.
        const int length = iconSize();
        m_chooser->itemView()->setItemSize(QSize(length, length));
    }
    updateStrokeGrid();
    requestStrokePreviews();
    m_chooser->itemView()->viewport()->update();
}

void KisPresetChooser::setCurrentResource(KoResourceSP resource)
{
    m_chooser->setCurrentResource(resource);
}

KoResourceSP KisPresetChooser::currentResource() const
{
    return m_chooser->currentResource();
}

void KisPresetChooser::showTaggingBar(bool show)
{
    m_chooser->showTaggingBar(show);
}

KisResourceItemChooser *KisPresetChooser::itemChooser()
{
    return m_chooser;
}

void KisPresetChooser::setPresetFilter(const QString& paintOpId)
{
    QMap<QString, QVariant> metaDataFilter;
    if (!paintOpId.isEmpty()) { // empty means "all"
        metaDataFilter["paintopid"] = paintOpId;
    }
    m_chooser->tagFilterModel()->setMetaDataFilter(metaDataFilter);
    updateViewSettings();
}

void KisPresetChooser::setIconSize(int newSize)
{
    KisResourceItemChooserSync* chooserSync = KisResourceItemChooserSync::instance();
    chooserSync->setBaseLength(newSize);
}

int KisPresetChooser::iconSize()
{
    KisResourceItemChooserSync* chooserSync = KisResourceItemChooserSync::instance();
    return chooserSync->baseLength();
}

void KisPresetChooser::saveIconSize()
{
    // save icon size
    if (KisConfig(true).presetIconSize() != iconSize()) {
        KisConfig(false).setPresetIconSize(iconSize());
    }
}

void KisPresetChooser::showHideBrushNames(ListViewMode newViewMode)
{
    // A short dock shows a strip of square icons, whatever the mode: a stroke and a name do not fit there.
    m_stripLayout = newViewMode == ListViewMode::IconStripHorizontal;
    m_delegate->setShowStroke(m_mode == ViewMode::STROKE && !m_stripLayout);
    updateStrokeGrid();

    switch (newViewMode) {
    case ListViewMode::Detail: {
        m_delegate->setShowText(true);
        break;
    }
    default: {
        m_delegate->setShowText(false);
    }
    }
}
