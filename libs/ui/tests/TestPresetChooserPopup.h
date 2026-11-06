/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef TEST_PRESET_CHOOSER_POPUP_H
#define TEST_PRESET_CHOOSER_POPUP_H

#include <QObject>

class TestPresetChooserPopup : public QObject
{
    Q_OBJECT
private Q_SLOTS:
    void init();

    void testChipsThatFit();
    void testChipsSelectThroughTheTagChooser();
    void testOverflowGoesToTheMoreMenu();
    void testSearchFiltersAndChoosingATagClearsIt();
    void testFilterInTagAndManagementAreInTheMoreMenu();
    void testViewSwitchPersistsAndKeepsTheOldMenu();
    void testStrokeGridHasTwoColumns_data();
    void testStrokeGridHasTwoColumns();
    void testFitsAtEverySize_data();
    void testFitsAtEverySize();
    void testShortDockFallsBackToTheStockBar();
    void testSelectionOutlineReadsOnBothThemes();
    void testSelectingABrushStillSignals();
    void testOtherChoosersKeepTheirTagBar_data();
    void testOtherChoosersKeepTheirTagBar();
    void testPresetEditorChooserKeepsItsTagBar();
    void testIconsExistInBothSets();

    /// Not a check: with TOSKA_PREVIEW_SHEET set to a folder, writes the chooser as a picture on both themes.
    void testPictures();
};

#endif
