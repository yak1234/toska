/*
 *  SPDX-FileCopyrightText: 2002 Patrick Julien <freak@codepimps.org>
 *  SPDX-FileCopyrightText: 2011 Silvio Heinrich <plassy@web.de>
 *  SPDX-FileCopyrightText: 2011 José Luis Vergara <pentalis@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Tenzin Rangdol <tenzindraws@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KIS_PRESET_CHOOSER_H_
#define KIS_PRESET_CHOOSER_H_

#include <QWidget>
#include <QColor>
#include <QPalette>
#include <QPointer>

#include <KoResource.h>
#include <KoID.h>
#include "kis_signal_auto_connection.h"
#include "ResourceListViewModes.h"

class KoAbstractResourceServerAdapter;
class KisPresetDelegate;
class KisResourceItemChooser;


#include <kritaui_export.h>

/**
 * A special type of item chooser that can contain extra widgets that show
 * more information about the currently selected item. Reimplement update()
 * to extract that information and fill the appropriate widgets.
 */
class KRITAUI_EXPORT KisPresetChooser : public QWidget
{
    Q_OBJECT

public:

    KisPresetChooser(QWidget *parent = 0);
    ~KisPresetChooser() override;

    enum ViewMode {
        THUMBNAIL, /// Shows thumbnails
        DETAIL,  /// Shows thumbnails with text next to it
        STROKE   /// Shows each brush painting the same stroke, with its name
    };

    /// Sets a list of resources in the paintop list, when ever user press enter in the lineedit of paintop_presets_popup Class
    void setViewMode(ViewMode mode);
    void setViewModeToThumbnail();
    void setViewModeToDetail();
    void setViewModeToStroke();
    ViewMode viewMode() const;

    /// The view shows on the panel's own background, without a frame (the brush chooser's look; the popup sets it).
    void setPlainBackground(bool plain);

    /// The height of a row of the stroke grid for an icon size (the gap between rows included).
    static int strokeGridHeight(int iconSize);

    /// How many columns of strokes fit a view this wide: two, one when too narrow for two, more only when very wide.
    static int strokeGridColumns(int viewWidth);

    /// The outline of the selected brush: the theme's accent, lightened or darkened until it reads on a selected cell.
    static QColor selectionOutlineColor(const QPalette &palette);

    void setCurrentResource(KoResourceSP resource);

    KoResourceSP currentResource() const;

    /// Sets the visibility of tagging klineEdits
    void showTaggingBar(bool show);

    KisResourceItemChooser *itemChooser();

    void setPresetFilter(const QString& paintOpId);

    /// get the base size for the icons. Used by the slider in the view options
    int iconSize();

Q_SIGNALS:
    void resourceSelected(KoResourceSP resource);
    void resourceClicked(KoResourceSP resource);

public Q_SLOTS:
    void updateViewSettings();

    /// sets the icon size. Used by slider in view menu
    void setIconSize(int newSize);

    /// saves the icon size for the presets. called by the horizontal slider release event.
    void saveIconSize();

    /// Shows/hides brush names when KisResourceItemListView used by KisResourceItemChooser
    /// changes it's ListViewMode.
    /// If this method is removed then the Details view brush names will still be displayed when
    /// KisResourceItemChooser is in horizontal layout.
    void showHideBrushNames(ListViewMode newViewMode);

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;
    void showEvent(QShowEvent *event) override;

private Q_SLOTS:
    void notifyConfigChanged();
    void slotResourceWasSelected(KoResourceSP resource);
    void slotCurrentPresetChanged();
    void slotStrokePreviewReady(int resourceId);
    void slotBaseLengthChanged(int length);

private:
    /// In Strokes view: sizes the grid to the view (after anything that set it to square icons), asks for the previews.
    void updateStrokeGrid();
    void requestStrokePreviews();

    KisResourceItemChooser *m_chooser {0};
    KisPresetDelegate* m_delegate {0};
    ViewMode m_mode;
    bool m_stripLayout {false};

    class PaintOpFilterModel;
    QPointer<PaintOpFilterModel> m_paintOpFilterModel;

    KisSignalAutoConnectionsStore m_currentPresetConnections;
};

#endif

