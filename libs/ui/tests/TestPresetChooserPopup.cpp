/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "TestPresetChooserPopup.h"

#include <testui.h>
#include <KisTemporaryHomeUiTest.h>
#include <simpletest.h>

#include <QAbstractButton>
#include <QApplication>
#include <QComboBox>
#include <QFile>
#include <QIcon>
#include <QLabel>
#include <QLineEdit>
#include <QMenu>
#include <QSignalSpy>
#include <QScrollBar>
#include <QSlider>
#include <QToolButton>

#include <KisResourceItemChooser.h>
#include <KisResourceItemListView.h>
#include <KisResourceTypes.h>
#include <KisTag.h>
#include <KisTagChooserWidget.h>
#include <KisTagFilterResourceProxyModel.h>
#include <KisTagModel.h>
#include <kis_config.h>
#include <widgets/KisPresetTagChips.h>
#include <widgets/kis_paintop_presets_chooser_popup.h>
#include <widgets/kis_preset_chooser.h>
#include <KisBrushStrokePreviewCache.h>

#include <widgets/gradient/KisGradientChooser.h>
#include <widgets/kis_pattern_chooser.h>

namespace {

QPalette themePalette(bool night)
{
    QPalette palette;
    const QColor window = night ? QColor("#141b25") : QColor("#efe8dc");
    const QColor base = night ? QColor("#0e141c") : QColor("#f8f3ea");
    const QColor raised = night ? QColor("#1f2a38") : QColor("#e7dfd0");
    const QColor text = night ? QColor(233, 227, 216) : QColor(42, 52, 66);
    const QColor highlight = night ? QColor(184, 67, 42) : QColor(196, 67, 42);
    palette.setColor(QPalette::Window, window);
    palette.setColor(QPalette::Base, base);
    palette.setColor(QPalette::AlternateBase, raised);
    palette.setColor(QPalette::Button, raised);
    palette.setColor(QPalette::Text, text);
    palette.setColor(QPalette::WindowText, text);
    palette.setColor(QPalette::ButtonText, text);
    palette.setColor(QPalette::Highlight, highlight);
    palette.setColor(QPalette::HighlightedText, QColor(255, 244, 230));
    return palette;
}

KisPresetChooser *chooserOf(KisPaintOpPresetsChooserPopup &popup)
{
    return popup.findChild<KisPresetChooser *>();
}

KisPresetTagChips *chipsOf(QWidget &widget)
{
    return widget.findChild<KisPresetTagChips *>();
}

QComboBox *comboOf(QWidget &widget)
{
    return widget.findChild<QComboBox *>();
}

QLineEdit *searchOf(KisPaintOpPresetsChooserPopup &popup)
{
    return popup.findChild<QLineEdit *>(QStringLiteral("brushSearch"));
}

QToolButton *button(KisPaintOpPresetsChooserPopup &popup, const QString &name)
{
    return popup.findChild<QToolButton *>(name);
}

/// A shown popup, laid out, at a size.
void showAt(KisPaintOpPresetsChooserPopup &popup, const QSize &size)
{
    popup.setMinimumSize(0, 0);
    popup.setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Preferred);
    popup.setMaximumSize(QWIDGETSIZE_MAX, QWIDGETSIZE_MAX);
    popup.resize(size);
    popup.show();
    QTest::qWait(30);
    QApplication::processEvents();
}

/// The icons are compiled into the application, not the tests: from the source tree here.
QIcon sourceIcon(const QString &name, bool lightStrokes)
{
    const QString file = lightStrokes ? QStringLiteral("misc-light/light_") : QStringLiteral("misc-dark/dark_");
    return QIcon(QStringLiteral(TOSKA_PICS_DIR "/") + file + name + QStringLiteral(".svg"));
}

QMenu *moreMenuOf(KisPaintOpPresetsChooserPopup &popup)
{
    return button(popup, QStringLiteral("brushMore"))->menu();
}

QAction *actionNamed(QMenu *menu, const QString &text)
{
    const QList<QAction *> actions = menu->actions();
    for (QAction *action : actions) {
        if (action->text().remove(QLatin1Char('&')) == text) return action;
    }
    return nullptr;
}

/// The menu as it is when the user opens it.
void prepareMenu(QMenu *menu)
{
    QMetaObject::invokeMethod(menu, "aboutToShow");
}

} // namespace

void TestPresetChooserPopup::init()
{
    KisConfig(false).setPresetChooserViewMode(KisPresetChooser::STROKE);
}

void TestPresetChooserPopup::testChipsThatFit()
{
    using List = QVector<int>;
    // Everything fits.
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 10, 10}, 100, 4, 0), List({0, 1, 2}));
    // In order, up to the width; gaps count.
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 10, 10}, 24, 4, 0), List({0, 1}));
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 10, 10}, 23, 4, 0), List({0}));
    // The current one is always there, replacing as many of the last as it needs.
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 10, 10, 10}, 24, 4, 3), List({0, 3}));
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 10, 10, 30}, 40, 4, 3), List({3}));
    // Wider than everything: still there.
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 100}, 20, 4, 1), List({1}));
    // No current tag.
    QCOMPARE(KisPresetTagChips::chipsThatFit({10, 10}, 100, 4, -1), List({0, 1}));
    QCOMPARE(KisPresetTagChips::chipsThatFit({}, 100, 4, -1), List());
}

void TestPresetChooserPopup::testChipsSelectThroughTheTagChooser()
{
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, QSize(1600, 700));
    KisPresetTagChips *chips = chipsOf(popup);
    QVERIFY(chips);
    KisResourceItemChooser *chooser = chooserOf(popup)->itemChooser();
    QComboBox *combo = comboOf(popup);
    QVERIFY(combo);

    QVERIFY2(chips->tagNames().size() >= 3, "All, All Untagged and at least one tag");
    QCOMPARE(chips->tagNames().size(), combo->count());
    QCOMPARE(chips->tagNames().first(), combo->itemText(0));

    const int allRows = chooser->tagFilterModel()->rowCount();
    QVERIFY(allRows > 0);

    // A real tag narrows the list, through the (hidden) combobox: remembered as ever.
    const QString tagName = chips->tagNames().at(2);
    QToolButton *tagChip = nullptr;
    const QList<QToolButton *> buttons = chips->findChildren<QToolButton *>();
    for (QToolButton *candidate : buttons) {
        if (candidate->text() == tagName) tagChip = candidate;
    }
    QVERIFY(tagChip);
    QTest::mouseClick(tagChip, Qt::LeftButton);
    QCOMPARE(combo->currentText(), tagName);
    QVERIFY(tagChip->isChecked());
    QVERIFY(chooser->tagFilterModel()->rowCount() < allRows);

    // Clicking the current chip keeps it current.
    QTest::mouseClick(tagChip, Qt::LeftButton);
    QVERIFY(tagChip->isChecked());
    QCOMPARE(combo->currentText(), tagName);

    // The combobox moving (a restored tag, a removed tag) moves the chips. They may be rebuilt, so look again.
    combo->setCurrentIndex(0);
    int checked = 0;
    const QList<QToolButton *> again = chips->findChildren<QToolButton *>();
    for (QToolButton *candidate : again) {
        if (candidate->isChecked()) {
            checked++;
            QCOMPARE(candidate->text(), combo->itemText(0));
        }
    }
    QCOMPARE(checked, 1);
    QCOMPARE(chooser->tagFilterModel()->rowCount(), allRows);
}

void TestPresetChooserPopup::testOverflowGoesToTheMoreMenu()
{
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, QSize(300, 500));
    KisPresetTagChips *chips = chipsOf(popup);
    QVERIFY(chips);
    const QStringList all = chips->tagNames();
    const QStringList visible = chips->visibleTagNames();
    QVERIFY2(visible.size() < all.size(), "this test needs more tags than fit in 300 pixels");

    QMenu *menu = moreMenuOf(popup);
    QVERIFY(menu);
    prepareMenu(menu);
    for (const QString &name : all) {
        const bool inMenu = actionNamed(menu, name) != nullptr;
        QVERIFY2(inMenu != visible.contains(name), qPrintable(name));
    }

    // Choosing one from the menu makes it current, and it gets a chip.
    QString hidden;
    for (const QString &name : all) {
        if (!visible.contains(name)) hidden = name;
    }
    actionNamed(menu, hidden)->trigger();
    QCOMPARE(comboOf(popup)->currentText(), hidden);
    QVERIFY(chips->visibleTagNames().contains(hidden));
}

void TestPresetChooserPopup::testSearchFiltersAndChoosingATagClearsIt()
{
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, QSize(360, 687));
    KisResourceItemChooser *chooser = chooserOf(popup)->itemChooser();
    QLineEdit *search = searchOf(popup);
    QVERIFY(search);
    QVERIFY(search->isVisible());
    QCOMPARE(search->placeholderText(), QStringLiteral("Search brushes"));

    comboOf(popup)->setCurrentIndex(0);
    const int allRows = chooser->tagFilterModel()->rowCount();
    search->setText(QStringLiteral("no brush is called this"));
    QCOMPARE(chooser->tagFilterModel()->rowCount(), 0);

    // As the stock bar does: choosing a tag clears the search.
    comboOf(popup)->setCurrentIndex(1);
    QCOMPARE(search->text(), QString());
    comboOf(popup)->setCurrentIndex(0);
    QCOMPARE(chooser->tagFilterModel()->rowCount(), allRows);
}

void TestPresetChooserPopup::testFilterInTagAndManagementAreInTheMoreMenu()
{
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, QSize(360, 687));
    QMenu *menu = moreMenuOf(popup);
    QVERIFY(menu);
    prepareMenu(menu);

    // Adding, renaming and removing tags: Krita's own actions, in a submenu.
    QAction *manage = actionNamed(menu, QStringLiteral("Manage Tags"));
    QVERIFY(manage);
    QVERIFY(manage->menu());
    QVERIFY(manage->menu() == chooserOf(popup)->itemChooser()->tagChooserWidget()->tagMenu());
    QVERIFY(actionNamed(manage->menu(), QStringLiteral("Delete this tag")));

    // Filter in Tag: the stock checkbox's setting.
    QAction *filterInTag = actionNamed(menu, QStringLiteral("Filter in Tag"));
    QVERIFY(filterInTag);
    QVERIFY(filterInTag->isCheckable());
    KisResourceItemChooser *chooser = chooserOf(popup)->itemChooser();
    const bool before = chooser->filterInTag();
    QCOMPARE(filterInTag->isChecked(), before);
    filterInTag->trigger();
    QCOMPARE(chooser->filterInTag(), !before);
    filterInTag->trigger();
    QCOMPARE(chooser->filterInTag(), before);

    // Storages, and icon size.
    QVERIFY(actionNamed(menu, QStringLiteral("Storages...")));
    QSlider *slider = menu->findChild<QSlider *>(QStringLiteral("brushIconSize"));
    if (!slider) slider = popup.findChild<QSlider *>(QStringLiteral("brushIconSize"));
    QVERIFY(slider);
    const int size = chooserOf(popup)->iconSize();
    slider->setValue(size == 40 ? 50 : 40);
    QCOMPARE(chooserOf(popup)->iconSize(), slider->value());
    // In Strokes view the icon size sets the row height, and the grid stays two columns wide.
    QCOMPARE(chooserOf(popup)->itemChooser()->itemView()->gridSize().height(), KisPresetChooser::strokeGridHeight(slider->value()));
    QVERIFY(chooserOf(popup)->itemChooser()->itemView()->gridSize().width() > slider->value());
    chooserOf(popup)->setIconSize(size);
}

void TestPresetChooserPopup::testViewSwitchPersistsAndKeepsTheOldMenu()
{
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, QSize(360, 687));
    KisPresetChooser *chooser = chooserOf(popup);

    QToolButton *strokes = button(popup, QStringLiteral("brushViewStrokes"));
    QToolButton *thumbnails = button(popup, QStringLiteral("brushViewThumbnails"));
    QToolButton *details = button(popup, QStringLiteral("brushViewDetails"));
    QVERIFY(strokes && thumbnails && details);
    QVERIFY(strokes->isChecked());
    QCOMPARE(chooser->viewMode(), KisPresetChooser::STROKE);

    QTest::mouseClick(details, Qt::LeftButton);
    QVERIFY(details->isChecked() && !strokes->isChecked());
    QCOMPARE(chooser->viewMode(), KisPresetChooser::DETAIL);
    QCOMPARE(KisConfig(true).presetChooserViewMode(), int(KisPresetChooser::DETAIL));

    QTest::mouseClick(thumbnails, Qt::LeftButton);
    QCOMPARE(chooser->viewMode(), KisPresetChooser::THUMBNAIL);
    QCOMPARE(KisConfig(true).presetChooserViewMode(), int(KisPresetChooser::THUMBNAIL));
    QCOMPARE(chooser->itemChooser()->itemView()->gridSize(),
             QSize(chooser->iconSize(), chooser->iconSize()));

    QTest::mouseClick(strokes, Qt::LeftButton);
    QCOMPARE(chooser->viewMode(), KisPresetChooser::STROKE);

    // A new popup starts in the stored mode.
    KisConfig(false).setPresetChooserViewMode(KisPresetChooser::DETAIL);
    KisPaintOpPresetsChooserPopup second;
    showAt(second, QSize(360, 687));
    QCOMPARE(chooserOf(second)->viewMode(), KisPresetChooser::DETAIL);
    QVERIFY(button(second, QStringLiteral("brushViewDetails"))->isChecked());
}

void TestPresetChooserPopup::testStrokeGridHasTwoColumns_data()
{
    QTest::addColumn<QSize>("size");
    QTest::newRow("panel narrow") << QSize(300, 500);
    QTest::newRow("panel usual") << QSize(360, 687);
    QTest::newRow("panel wide") << QSize(420, 1000);
    QTest::newRow("toolbar popup") << QSize(450, 550);
}

void TestPresetChooserPopup::testStrokeGridHasTwoColumns()
{
    QFETCH(QSize, size);
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, size);
    KisResourceItemListView *view = chooserOf(popup)->itemChooser()->itemView();
    comboOf(popup)->setCurrentIndex(0);
    QApplication::processEvents();
    QVERIFY(view->model()->rowCount() >= 3);

    const QRect first = view->visualRect(view->model()->index(0, 0));
    const QRect second = view->visualRect(view->model()->index(1, 0));
    const QRect third = view->visualRect(view->model()->index(2, 0));
    QCOMPARE(second.top(), first.top());
    QVERIFY(second.left() > first.left());
    QVERIFY2(third.top() > first.top(), "the third brush starts the second row");
    QCOMPARE(third.left(), first.left());
    QVERIFY(second.right() <= view->viewport()->width());
    QVERIFY(view->horizontalScrollBar()->maximum() == 0);
    // Default icon size: the mockup's row.
    QCOMPARE(KisPresetChooser::strokeGridHeight(60), 100);
}

void TestPresetChooserPopup::testFitsAtEverySize_data()
{
    QTest::addColumn<QSize>("size");
    QTest::newRow("panel narrow") << QSize(300, 500);
    QTest::newRow("panel usual") << QSize(360, 687);
    QTest::newRow("panel wide") << QSize(420, 1000);
    QTest::newRow("toolbar popup") << QSize(450, 550);
}

void TestPresetChooserPopup::testFitsAtEverySize()
{
    QFETCH(QSize, size);
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, size);
    QVERIFY(popup.minimumSizeHint().width() <= size.width());
    QVERIFY(popup.width() == size.width());

    const QRect inside(QPoint(0, 0), size);
    const QList<QWidget *> controls = {searchOf(popup), button(popup, QStringLiteral("brushViewStrokes")),
                                       button(popup, QStringLiteral("brushViewThumbnails")),
                                       button(popup, QStringLiteral("brushViewDetails")),
                                       button(popup, QStringLiteral("brushMore")), chipsOf(popup),
                                       chooserOf(popup)->itemChooser()->itemView()};
    for (QWidget *control : controls) {
        QVERIFY(control);
        QVERIFY2(control->isVisible(), control->objectName().toLatin1());
        const QRect rect(control->mapTo(&popup, QPoint(0, 0)), control->size());
        QVERIFY2(inside.contains(rect), control->objectName().toLatin1());
    }
    // The list gets the height, and the stock bar is out of the way.
    QVERIFY(chooserOf(popup)->itemChooser()->itemView()->height() > size.height() - 120);
    QVERIFY(!comboOf(popup)->isVisible());
}

void TestPresetChooserPopup::testShortDockFallsBackToTheStockBar()
{
    KisPaintOpPresetsChooserPopup popup;
    popup.setResponsiveness(true);
    showAt(popup, QSize(800, 90));
    QVERIFY(!chipsOf(popup)->isVisible());
    QVERIFY(!searchOf(popup)->isVisible());
    QVERIFY(comboOf(popup)->isVisible());

    // And back.
    popup.resize(360, 687);
    QTest::qWait(30);
    QApplication::processEvents();
    QVERIFY(chipsOf(popup)->isVisible());
    QVERIFY(searchOf(popup)->isVisible());
    QVERIFY(!comboOf(popup)->isVisible());
    // The list has the height again. Live, in the agent panel's tab, an empty row kept two thirds of it.
    QVERIFY2(chooserOf(popup)->itemChooser()->itemView()->height() > 687 - 120,
             qPrintable(QString::number(chooserOf(popup)->itemChooser()->itemView()->height())));
    // The strip's square items are gone: the stroke grid is back.
    QCOMPARE(chooserOf(popup)->itemChooser()->itemView()->gridSize().height(),
             KisPresetChooser::strokeGridHeight(chooserOf(popup)->iconSize()));
}

void TestPresetChooserPopup::testSelectionOutlineReadsOnBothThemes()
{
    const auto luminance = [] (const QColor &color) {
        const auto linear = [] (qreal v) { return v <= 0.03928 ? v / 12.92 : std::pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * linear(color.redF()) + 0.7152 * linear(color.greenF()) + 0.0722 * linear(color.blueF());
    };
    const auto contrast = [&] (const QColor &a, const QColor &b) {
        const qreal x = luminance(a), y = luminance(b);
        return (qMax(x, y) + 0.05) / (qMin(x, y) + 0.05);
    };
    for (bool night : {true, false}) {
        const QPalette palette = themePalette(night);
        const QColor outline = KisPresetChooser::selectionOutlineColor(palette);
        QVERIFY2(contrast(outline, palette.color(QPalette::Button)) >= 3.0, night ? "night" : "day");
        // The accent's own hue.
        QVERIFY(qAbs(outline.hue() - palette.color(QPalette::Highlight).hue()) < 12);
    }
}

void TestPresetChooserPopup::testSelectingABrushStillSignals()
{
    KisPaintOpPresetsChooserPopup popup;
    showAt(popup, QSize(360, 687));
    QSignalSpy selected(&popup, &KisPaintOpPresetsChooserPopup::resourceSelected);
    QSignalSpy clicked(&popup, &KisPaintOpPresetsChooserPopup::resourceClicked);
    KisResourceItemListView *view = chooserOf(popup)->itemChooser()->itemView();
    comboOf(popup)->setCurrentIndex(0);
    QApplication::processEvents();
    QVERIFY(view->model()->rowCount() > 0);

    const QPoint center = view->visualRect(view->model()->index(1, 0)).center();
    QTest::mouseClick(view->viewport(), Qt::LeftButton, Qt::NoModifier, center);
    QCOMPARE(selected.count(), 1);
    QCOMPARE(clicked.count(), 1);
    KoResourceSP resource = selected.first().first().value<KoResourceSP>();
    QVERIFY(resource);
    QCOMPARE(chooserOf(popup)->currentResource(), resource);

    // The same call the paintop box and the docker make.
    popup.canvasResourceChanged(resource.dynamicCast<KisPaintOpPreset>());
    QCOMPARE(chooserOf(popup)->currentResource(), resource);
}

void TestPresetChooserPopup::testOtherChoosersKeepTheirTagBar_data()
{
    QTest::addColumn<QString>("kind");
    QTest::newRow("patterns") << QString("patterns");
    QTest::newRow("gradients") << QString("gradients");
    QTest::newRow("plain item chooser") << QString("plain");
}

void TestPresetChooserPopup::testOtherChoosersKeepTheirTagBar()
{
    QFETCH(QString, kind);
    QScopedPointer<QWidget> holder;
    if (kind == QLatin1String("patterns")) {
        holder.reset(new KisPatternChooser());
    } else if (kind == QLatin1String("gradients")) {
        holder.reset(new KisGradientChooser());
    } else {
        KisResourceItemChooser *chooser = new KisResourceItemChooser(ResourceType::Patterns);
        chooser->showTaggingBar(true);
        holder.reset(chooser);
    }
    holder->resize(400, 500);
    holder->show();
    QTest::qWait(30);

    QVERIFY2(!chipsOf(*holder), "chips belong to the brush chooser");
    QVERIFY(holder->findChild<KisTagChooserWidget *>());
    QComboBox *combo = holder->findChild<KisTagChooserWidget *>()->findChild<QComboBox *>();
    QVERIFY(combo);
    QVERIFY2(combo->isVisible(), "the tag combobox stays");
    // The stock bar's search and its checkbox, and the Tag button.
    bool search = false, checkbox = false, tagButton = false;
    const QList<QLineEdit *> edits = holder->findChildren<QLineEdit *>();
    for (QLineEdit *edit : edits) search = search || (edit->isVisible() && edit->placeholderText() == QLatin1String("Search"));
    const QList<QAbstractButton *> buttons = holder->findChildren<QAbstractButton *>();
    for (QAbstractButton *candidate : buttons) {
        // A shown top level gets accelerators added to its texts.
        const QString text = candidate->text().remove(QLatin1Char('&'));
        checkbox = checkbox || (candidate->isVisible() && text == QLatin1String("Filter in Tag"));
        tagButton = tagButton || (candidate->isVisible() && text == QLatin1String("Tag"));
    }
    QVERIFY(search);
    QVERIFY(checkbox);
    QVERIFY(tagButton);
}

void TestPresetChooserPopup::testPresetEditorChooserKeepsItsTagBar()
{
    // The preset editor's and libkis's choosers use KisPresetChooser without the popup: the stock bar, and Strokes works.
    KisPresetChooser chooser;
    chooser.showTaggingBar(true);
    chooser.resize(300, 500);
    chooser.show();
    QTest::qWait(30);
    QVERIFY(!chipsOf(chooser));
    QVERIFY(comboOf(chooser)->isVisible());
    chooser.setViewMode(KisPresetChooser::STROKE);
    QCOMPARE(chooser.viewMode(), KisPresetChooser::STROKE);
    chooser.setViewMode(KisPresetChooser::THUMBNAIL);
    QCOMPARE(chooser.itemChooser()->itemView()->gridSize(), QSize(chooser.iconSize(), chooser.iconSize()));
}

void TestPresetChooserPopup::testIconsExistInBothSets()
{
    for (const char *name : {"search", "strokes", "thumbnails", "details", "more"}) {
        for (const bool lightStrokes : {true, false}) {
            const QIcon icon = sourceIcon(QStringLiteral("brushes-") + QLatin1String(name), lightStrokes);
            const QImage image = icon.pixmap(32, 32).toImage().convertToFormat(QImage::Format_ARGB32);
            QVERIFY2(!image.isNull(), name);
            bool painted = false;
            for (int y = 0; y < image.height() && !painted; y++) {
                for (int x = 0; x < image.width() && !painted; x++) painted = qAlpha(image.pixel(x, y)) > 128;
            }
            QVERIFY2(painted, name);

            // Listed for the application's resources.
            const QString set = lightStrokes ? QStringLiteral("misc-light") : QStringLiteral("misc-dark");
            QFile qrc(QStringLiteral(TOSKA_PICS_DIR "/") + set + QLatin1Char('/') + set + QStringLiteral("-icons.qrc"));
            QVERIFY(qrc.open(QIODevice::ReadOnly));
            const QString wanted = QStringLiteral("<file>%1_brushes-%2.svg</file>")
                                       .arg(lightStrokes ? QStringLiteral("light") : QStringLiteral("dark"), QLatin1String(name));
            QVERIFY2(QString::fromUtf8(qrc.readAll()).contains(wanted), qPrintable(wanted));
        }
    }
}

void TestPresetChooserPopup::testPictures()
{
    const QString folder = qEnvironmentVariable("TOSKA_PREVIEW_SHEET");
    if (folder.isEmpty()) QSKIP("Set TOSKA_PREVIEW_SHEET to a folder to write the pictures");

    // Previews first, so the pictures show them. The application's cache, in this test's temporary home.
    KisBrushStrokePreviewCache *cache = KisBrushStrokePreviewCache::instance();
    cache->setBusyProbeForTesting([] () { return false; });
    cache->setTimingForTesting(0, 0);
    cache->requestAll();
    QVERIFY(QTest::qWaitFor([&] () { return cache->pendingCount() == 0; }, 300000));

    for (bool night : {true, false}) {
        QApplication::setPalette(themePalette(night));
        for (const QSize &size : {QSize(360, 687), QSize(300, 500), QSize(450, 550)}) {
            for (int mode : {int(KisPresetChooser::STROKE), int(KisPresetChooser::THUMBNAIL), int(KisPresetChooser::DETAIL)}) {
                KisConfig(false).setPresetChooserViewMode(mode);
                KisPaintOpPresetsChooserPopup popup;
                popup.setAttribute(Qt::WA_StyledBackground);
                popup.setAutoFillBackground(true);
                showAt(popup, size);
                button(popup, QStringLiteral("brushViewStrokes"))->setIcon(sourceIcon(QStringLiteral("brushes-strokes"), night));
                button(popup, QStringLiteral("brushViewThumbnails"))->setIcon(sourceIcon(QStringLiteral("brushes-thumbnails"), night));
                button(popup, QStringLiteral("brushViewDetails"))->setIcon(sourceIcon(QStringLiteral("brushes-details"), night));
                button(popup, QStringLiteral("brushMore"))->setIcon(sourceIcon(QStringLiteral("brushes-more"), night));
                popup.findChild<QLabel *>(QStringLiteral("brushSearchIcon"))->setPixmap(sourceIcon(QStringLiteral("brushes-search"), night).pixmap(16, 16));
                comboOf(popup)->setCurrentIndex(0);
                QApplication::processEvents();
                KisResourceItemListView *view = chooserOf(popup)->itemChooser()->itemView();
                view->setCurrentIndex(view->model()->index(1, 0));
                QTest::qWait(50);
                const QString name = QStringLiteral("/chooser-%1-%2x%3-mode%4.png")
                                         .arg(night ? "night" : "day")
                                         .arg(size.width())
                                         .arg(size.height())
                                         .arg(mode);
                QVERIFY(popup.grab().save(folder + name));
            }
        }
    }
}

KISTEST_TEMPORARY_HOME_MAIN(TestPresetChooserPopup)
