/* This file is part of the KDE project
 * SPDX-FileCopyrightText: 2010 Sven Langkamp <sven.langkamp@gmail.com>
 * SPDX-FileCopyrightText: 2011 Srikanth Tiyyagura <srikanth.tulasiram@gmail.com>
 * SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 * SPDX-License-Identifier: LGPL-2.0-or-later
 */

#include "kis_paintop_presets_chooser_popup.h"

#include <QButtonGroup>
#include <QCompleter>
#include <QEvent>
#include <QFrame>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QMenu>
#include <QResizeEvent>
#include <QToolButton>
#include <QVBoxLayout>
#include <QWidgetAction>
#include <QSlider>
#include <QActionGroup>

#include <KAcceleratorManager>

#include <KoResource.h>
#include <KisResourceItemChooser.h>
#include <KisTagChooserWidget.h>
#include <KisTagFilterResourceProxyModel.h>
#include <KisTagModel.h>

#include <ui_wdgpaintoppresets.h>
#include <kis_config.h>
#include <KisResourceServerProvider.h>
#include <brushengine/kis_paintop_preset.h>
#include <kis_icon.h>
#include <brushengine/kis_paintop_settings.h>
#include "KisPopupButton.h"
#include "KisPresetTagChips.h"

namespace {

// Below this height a short dock keeps Krita's own compact bar and strip: the rows here would leave no room for the brushes.
constexpr int kShortestWithBar = 200;

constexpr int kRowOneHeight = 44;
constexpr int kRowTwoHeight = 36;
constexpr int kButtonSide = 28;

}

struct KisPaintOpPresetsChooserPopup::Private
{
public:
    Ui_WdgPaintOpPresets uiWdgPaintOpPresets;
    bool firstShown {true};
    QSlider* iconSizeSlider {nullptr};
    KisPopupButton *viewModeButton {nullptr};

    // The bar above the brushes: search and view switch, then tag chips and the … menu.
    QWidget *bar {nullptr};
    QLabel *searchIcon {nullptr};
    QLineEdit *search {nullptr};
    QToolButton *strokesButton {nullptr};
    QToolButton *thumbnailsButton {nullptr};
    QToolButton *detailsButton {nullptr};
    KisPresetTagChips *chips {nullptr};
    QToolButton *moreButton {nullptr};
    QMenu *moreMenu {nullptr};
    QSlider *moreIconSizeSlider {nullptr};
    QWidgetAction *moreIconSizeAction {nullptr};
    QAction *filterInTagAction {nullptr};
    QAction *storagesAction {nullptr};
    QFrame *barLine {nullptr};
    QActionGroup *menuModes {nullptr};
    bool barVisible {true};
    bool styling {false};
};

KisPaintOpPresetsChooserPopup::KisPaintOpPresetsChooserPopup(QWidget * parent)
    : QWidget(parent)
    , m_d(new Private())
{
    m_d->uiWdgPaintOpPresets.setupUi(this);
    // Tag names and tool tips are not to be given keyboard accelerators (a shown top level would underline them).
    KAcceleratorManager::setNoAccel(this);
    QMenu* menu = new QMenu(this);
    menu->setStyleSheet("margin: 6px");

    menu->addSection(i18nc("@title Which elements to display (e.g., thumbnails or details)", "Display"));

    QActionGroup *actionGroup = new QActionGroup(this);

    KisPresetChooser::ViewMode mode = (KisPresetChooser::ViewMode)KisConfig(true).presetChooserViewMode();

    QAction* action = menu->addAction(KisIconUtils::loadIcon("view-preview"), i18n("Thumbnails"), this, SLOT(slotThumbnailMode()));
    action->setCheckable(true);
    action->setChecked(mode == KisPresetChooser::THUMBNAIL);
    action->setActionGroup(actionGroup);

    action = menu->addAction(KisIconUtils::loadIcon("view-list-details"), i18n("Details"), this, SLOT(slotDetailMode()));
    action->setCheckable(true);
    action->setChecked(mode == KisPresetChooser::DETAIL);
    action->setActionGroup(actionGroup);

    action = menu->addAction(KisIconUtils::loadIcon("brushes-strokes"), i18n("Strokes"), this, SLOT(slotStrokeMode()));
    action->setCheckable(true);
    action->setChecked(mode == KisPresetChooser::STROKE);
    action->setActionGroup(actionGroup);
    m_d->menuModes = actionGroup;

    // add widget slider to control icon size
    QSlider* iconSizeSlider = new QSlider(this);
    iconSizeSlider->setOrientation(Qt::Horizontal);
    iconSizeSlider->setRange(30, 80);
    iconSizeSlider->setValue(m_d->uiWdgPaintOpPresets.wdgPresetChooser->iconSize());
    iconSizeSlider->setMinimumHeight(20);
    iconSizeSlider->setMinimumWidth(40);
    iconSizeSlider->setTickInterval(10);
    m_d->iconSizeSlider = iconSizeSlider;

    QWidgetAction *sliderAction= new QWidgetAction(this);
    sliderAction->setDefaultWidget(iconSizeSlider);

    menu->addSection(i18n("Icon Size"));
    menu->addAction(sliderAction);



    // setting the view mode
    m_d->uiWdgPaintOpPresets.wdgPresetChooser->setViewMode(mode);
    m_d->uiWdgPaintOpPresets.wdgPresetChooser->showTaggingBar(true);

    m_d->uiWdgPaintOpPresets.wdgPresetChooser->itemChooser()->showViewModeBtn(true);
    m_d->viewModeButton = m_d->uiWdgPaintOpPresets.wdgPresetChooser->itemChooser()->viewModeButton();
    m_d->viewModeButton->setPopupWidget(menu);


    connect(m_d->uiWdgPaintOpPresets.wdgPresetChooser, SIGNAL(resourceSelected(KoResourceSP )),
            this, SIGNAL(resourceSelected(KoResourceSP )));
    connect(m_d->uiWdgPaintOpPresets.wdgPresetChooser, SIGNAL(resourceClicked(KoResourceSP )),
            this, SIGNAL(resourceClicked(KoResourceSP ))) ;


    connect(iconSizeSlider, SIGNAL(valueChanged(int)),
            m_d->uiWdgPaintOpPresets.wdgPresetChooser, SLOT(setIconSize(int)));
    connect(menu, SIGNAL(aboutToHide()),
            m_d->uiWdgPaintOpPresets.wdgPresetChooser, SLOT(saveIconSize()));
    connect(m_d->viewModeButton, SIGNAL(pressed()), this, SLOT(slotUpdateMenu()));

    // The brush chooser's own bar. Krita's bar stays in the item chooser, hidden, as the owner of the tag logic, and comes
    // back in a short dock (resizeEvent()); no other kind of chooser has any of this.
    KisPresetChooser *presetChooser = m_d->uiWdgPaintOpPresets.wdgPresetChooser;
    KisResourceItemChooser *itemChooser = presetChooser->itemChooser();
    KisTagChooserWidget *tagChooser = itemChooser->tagChooserWidget();

    m_d->bar = new QWidget(this);
    m_d->bar->setObjectName(QStringLiteral("brushBar"));
    QVBoxLayout *barLayout = new QVBoxLayout(m_d->bar);
    barLayout->setContentsMargins(0, 0, 0, 0);
    barLayout->setSpacing(0);

    QWidget *rowOne = new QWidget(m_d->bar);
    rowOne->setFixedHeight(kRowOneHeight);
    QHBoxLayout *rowOneLayout = new QHBoxLayout(rowOne);
    rowOneLayout->setContentsMargins(16, 0, 8, 0);
    rowOneLayout->setSpacing(4);

    m_d->searchIcon = new QLabel(rowOne);
    m_d->searchIcon->setObjectName(QStringLiteral("brushSearchIcon"));
    m_d->searchIcon->setFixedSize(16, 16);
    rowOneLayout->addWidget(m_d->searchIcon);

    m_d->search = new QLineEdit(rowOne);
    m_d->search->setObjectName(QStringLiteral("brushSearch"));
    m_d->search->setPlaceholderText(i18n("Search brushes"));
    m_d->search->setToolTip(i18nc("@info:tooltip", "<p>Enter search terms to filter by name</p>"));
    m_d->search->setClearButtonEnabled(true);
    m_d->search->setFrame(false);
    m_d->search->setMinimumWidth(40);
    QCompleter *completer = new QCompleter(tagChooser->model(), m_d->search);
    completer->setCompletionRole(Qt::DisplayRole);
    completer->setCaseSensitivity(Qt::CaseInsensitive);
    m_d->search->setCompleter(completer);
    rowOneLayout->addWidget(m_d->search, 1);

    QButtonGroup *modeGroup = new QButtonGroup(this);
    modeGroup->setExclusive(true);
    const auto makeModeButton = [&] (QToolButton *&button, const char *name, const QString &tip, const char *slot, bool checked) {
        button = new QToolButton(rowOne);
        button->setObjectName(QLatin1String(name));
        button->setToolTip(tip);
        button->setCheckable(true);
        button->setChecked(checked);
        button->setFixedSize(kButtonSide, kButtonSide);
        button->setIconSize(QSize(16, 16));
        modeGroup->addButton(button);
        connect(button, SIGNAL(clicked()), this, slot);
        rowOneLayout->addWidget(button);
    };
    makeModeButton(m_d->strokesButton, "brushViewStrokes", i18n("Strokes"), SLOT(slotStrokeMode()), mode == KisPresetChooser::STROKE);
    makeModeButton(m_d->thumbnailsButton, "brushViewThumbnails", i18n("Thumbnails"), SLOT(slotThumbnailMode()), mode == KisPresetChooser::THUMBNAIL);
    makeModeButton(m_d->detailsButton, "brushViewDetails", i18n("Details"), SLOT(slotDetailMode()), mode == KisPresetChooser::DETAIL);
    barLayout->addWidget(rowOne);

    QWidget *rowTwo = new QWidget(m_d->bar);
    rowTwo->setFixedHeight(kRowTwoHeight);
    QHBoxLayout *rowTwoLayout = new QHBoxLayout(rowTwo);
    rowTwoLayout->setContentsMargins(12, 0, 12, 8);
    rowTwoLayout->setSpacing(4);
    m_d->chips = new KisPresetTagChips(tagChooser, rowTwo);
    rowTwoLayout->addWidget(m_d->chips, 1);

    m_d->moreButton = new QToolButton(rowTwo);
    m_d->moreButton->setObjectName(QStringLiteral("brushMore"));
    m_d->moreButton->setToolTip(i18n("More tags and settings"));
    m_d->moreButton->setFixedSize(kButtonSide, kButtonSide);
    m_d->moreButton->setIconSize(QSize(16, 16));
    m_d->moreButton->setPopupMode(QToolButton::InstantPopup);
    m_d->moreMenu = new QMenu(m_d->moreButton);
    m_d->moreButton->setMenu(m_d->moreMenu);
    connect(m_d->moreMenu, SIGNAL(aboutToShow()), this, SLOT(slotUpdateMoreMenu()));
    rowTwoLayout->addWidget(m_d->moreButton);
    barLayout->addWidget(rowTwo);

    m_d->barLine = new QFrame(m_d->bar);
    m_d->barLine->setFixedHeight(1);
    barLayout->addWidget(m_d->barLine);

    m_d->filterInTagAction = new QAction(i18nc("It appears in the checkbox next to the filter box "
                                               "in resources dockers; must be short.", "Filter in Tag"), this);
    m_d->filterInTagAction->setCheckable(true);
    connect(m_d->filterInTagAction, &QAction::toggled, this, [itemChooser] (bool checked) { itemChooser->setFilterInTag(checked); });

    m_d->storagesAction = new QAction(i18n("Storages..."), this);
    connect(m_d->storagesAction, &QAction::triggered, this, [itemChooser] () { itemChooser->storageButton()->showPopupWidget(); });

    m_d->moreIconSizeSlider = new QSlider(Qt::Horizontal, this);
    m_d->moreIconSizeSlider->setObjectName(QStringLiteral("brushIconSize"));
    m_d->moreIconSizeSlider->setRange(30, 80);
    m_d->moreIconSizeSlider->setMinimumHeight(20);
    m_d->moreIconSizeSlider->setMinimumWidth(120);
    m_d->moreIconSizeAction = new QWidgetAction(this);
    m_d->moreIconSizeAction->setDefaultWidget(m_d->moreIconSizeSlider);
    connect(m_d->moreIconSizeSlider, SIGNAL(valueChanged(int)), presetChooser, SLOT(setIconSize(int)));
    connect(m_d->moreMenu, SIGNAL(aboutToHide()), presetChooser, SLOT(saveIconSize()));

    // Adding or removing a tag from the submenu leaves its parent up, with stale entries.
    const auto closeMoreMenu = [this] () { if (m_d->moreMenu->isVisible()) m_d->moreMenu->close(); };
    connect(tagChooser->model(), &QAbstractItemModel::rowsInserted, this, closeMoreMenu);
    connect(tagChooser->model(), &QAbstractItemModel::rowsRemoved, this, closeMoreMenu);
    connect(tagChooser->model(), &QAbstractItemModel::modelReset, this, closeMoreMenu);

    connect(m_d->search, SIGNAL(textChanged(QString)), this, SLOT(slotSearchTextChanged(QString)));
    // As Krita's bar does: choosing a tag clears the search.
    connect(tagChooser, &KisTagChooserWidget::sigTagChosen, m_d->search, &QLineEdit::clear);

    m_d->uiWdgPaintOpPresets.verticalLayout->setContentsMargins(0, 0, 0, 0);
    m_d->uiWdgPaintOpPresets.verticalLayout->setSpacing(0);
    m_d->uiWdgPaintOpPresets.verticalLayout->insertWidget(0, m_d->bar);

    m_d->barVisible = false;
    setBarVisible(true);
    loadIcons();
    applyStyle();
    m_d->chips->rebuild();
}

void KisPaintOpPresetsChooserPopup::setBarVisible(bool visible)
{
    if (m_d->barVisible == visible) return;
    m_d->barVisible = visible;

    KisPresetChooser *presetChooser = m_d->uiWdgPaintOpPresets.wdgPresetChooser;
    m_d->search->clear();
    m_d->bar->setVisible(visible);
    presetChooser->itemChooser()->setExternalTagBar(visible);
    presetChooser->setPlainBackground(visible);
    // The grid's cells keep 4 px around them; with these the brushes line up 12 px from the edge, as in the mockup.
    m_d->uiWdgPaintOpPresets.layout->setContentsMargins(visible ? QMargins(8, 8, 8, 0) : QMargins());
    if (visible) presetChooser->itemChooser()->viewModeButton()->setVisible(false);
}

void KisPaintOpPresetsChooserPopup::resizeEvent(QResizeEvent *event)
{
    QWidget::resizeEvent(event);
    setBarVisible(event->size().height() >= kShortestWithBar);
}

void KisPaintOpPresetsChooserPopup::changeEvent(QEvent *event)
{
    QWidget::changeEvent(event);
    if (event->type() == QEvent::PaletteChange) {
        applyStyle();
    }
}

void KisPaintOpPresetsChooserPopup::applyStyle()
{
    if (m_d->styling) return;
    m_d->styling = true;
    const QPalette colors = palette();
    const QString text = colors.color(QPalette::WindowText).name();
    const QString raised = colors.color(QPalette::Button).name();
    const QString line = colors.color(QPalette::Button).lighter(125).name();

    m_d->search->setStyleSheet(QStringLiteral("QLineEdit { background: transparent; border: none; color: %1; }").arg(text));
    const QString buttons = QStringLiteral(
        "QToolButton { background: transparent; border: none; border-radius: 6px; }"
        "QToolButton:hover { background: %1; }"
        "QToolButton:checked { background: %1; }"
        "QToolButton::menu-indicator { image: none; }").arg(raised);
    m_d->strokesButton->setStyleSheet(buttons);
    m_d->thumbnailsButton->setStyleSheet(buttons);
    m_d->detailsButton->setStyleSheet(buttons);
    m_d->moreButton->setStyleSheet(buttons);
    m_d->barLine->setStyleSheet(QStringLiteral("QFrame { background: %1; border: none; }").arg(line));
    m_d->styling = false;
}

void KisPaintOpPresetsChooserPopup::loadIcons()
{
    m_d->searchIcon->setPixmap(KisIconUtils::loadIcon("brushes-search").pixmap(16, 16));
    m_d->strokesButton->setIcon(KisIconUtils::loadIcon("brushes-strokes"));
    m_d->thumbnailsButton->setIcon(KisIconUtils::loadIcon("brushes-thumbnails"));
    m_d->detailsButton->setIcon(KisIconUtils::loadIcon("brushes-details"));
    m_d->moreButton->setIcon(KisIconUtils::loadIcon("brushes-more"));
}

void KisPaintOpPresetsChooserPopup::slotSearchTextChanged(const QString &text)
{
    m_d->uiWdgPaintOpPresets.wdgPresetChooser->itemChooser()->tagFilterModel()->setSearchText(text);
}

void KisPaintOpPresetsChooserPopup::slotUpdateMoreMenu()
{
    KisPresetChooser *presetChooser = m_d->uiWdgPaintOpPresets.wdgPresetChooser;
    KisResourceItemChooser *itemChooser = presetChooser->itemChooser();

    m_d->moreMenu->clear();

    const int before = m_d->moreMenu->actions().size();
    m_d->chips->addOverflowTo(m_d->moreMenu);
    if (m_d->moreMenu->actions().size() > before) {
        m_d->moreMenu->addSeparator();
    }

    QMenu *tagMenu = itemChooser->tagChooserWidget()->tagMenu();
    tagMenu->setTitle(i18n("Manage Tags"));
    m_d->moreMenu->addMenu(tagMenu);

    {
        QSignalBlocker b(m_d->filterInTagAction);
        m_d->filterInTagAction->setChecked(itemChooser->filterInTag());
    }
    m_d->moreMenu->addAction(m_d->filterInTagAction);
    m_d->moreMenu->addAction(m_d->storagesAction);

    m_d->moreMenu->addSection(i18n("Icon Size"));
    {
        QSignalBlocker b(m_d->moreIconSizeSlider);
        m_d->moreIconSizeSlider->setValue(presetChooser->iconSize());
    }
    m_d->moreMenu->addAction(m_d->moreIconSizeAction);
}

void KisPaintOpPresetsChooserPopup::setViewMode(int mode)
{
    KisConfig(false).setPresetChooserViewMode(mode);
    m_d->uiWdgPaintOpPresets.wdgPresetChooser->setViewMode(KisPresetChooser::ViewMode(mode));
    m_d->strokesButton->setChecked(mode == KisPresetChooser::STROKE);
    m_d->thumbnailsButton->setChecked(mode == KisPresetChooser::THUMBNAIL);
    m_d->detailsButton->setChecked(mode == KisPresetChooser::DETAIL);
    const QList<QAction *> menuActions = m_d->menuModes->actions();
    const int menuPosition = mode == KisPresetChooser::THUMBNAIL ? 0 : (mode == KisPresetChooser::DETAIL ? 1 : 2);
    if (menuPosition < menuActions.size()) menuActions[menuPosition]->setChecked(true);
}

KisPaintOpPresetsChooserPopup::~KisPaintOpPresetsChooserPopup()
{
    delete m_d;
}

void KisPaintOpPresetsChooserPopup::slotThumbnailMode()
{
    setViewMode(KisPresetChooser::THUMBNAIL);
}

void KisPaintOpPresetsChooserPopup::slotDetailMode()
{
    setViewMode(KisPresetChooser::DETAIL);
}

void KisPaintOpPresetsChooserPopup::slotStrokeMode()
{
    setViewMode(KisPresetChooser::STROKE);
}

void KisPaintOpPresetsChooserPopup::slotUpdateMenu()
{
    QSignalBlocker b(m_d->iconSizeSlider);
    m_d->iconSizeSlider->setValue(KisConfig(true).presetIconSize());
}

void KisPaintOpPresetsChooserPopup::paintEvent(QPaintEvent* event)
{
    QWidget::paintEvent(event);
    //Workaround to get the column and row size right
    if(m_d->firstShown) {
        m_d->uiWdgPaintOpPresets.wdgPresetChooser->updateViewSettings();
        m_d->firstShown = false;
    }
}

void KisPaintOpPresetsChooserPopup::canvasResourceChanged(KisPaintOpPresetSP  preset)
{
    if (preset) {
        blockSignals(true);
        m_d->uiWdgPaintOpPresets.wdgPresetChooser->setCurrentResource(preset);
        blockSignals(false);
    }
    m_d->uiWdgPaintOpPresets.wdgPresetChooser->updateViewSettings();
}

void KisPaintOpPresetsChooserPopup::slotThemeChanged()
{
   m_d->viewModeButton->setIcon(KisIconUtils::loadIcon("view-choose"));
   loadIcons();
   m_d->uiWdgPaintOpPresets.wdgPresetChooser->itemChooser()->updateView(); // updates other icons
}

void KisPaintOpPresetsChooserPopup::updateViewSettings()
{
   m_d->uiWdgPaintOpPresets.wdgPresetChooser->updateViewSettings();
}

void KisPaintOpPresetsChooserPopup::setResponsiveness(bool value)
{
    m_d->uiWdgPaintOpPresets.wdgPresetChooser->itemChooser()->setResponsiveness(value);
}
