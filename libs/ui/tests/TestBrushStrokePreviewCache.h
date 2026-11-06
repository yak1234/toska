/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef TEST_BRUSH_STROKE_PREVIEW_CACHE_H
#define TEST_BRUSH_STROKE_PREVIEW_CACHE_H

#include <QObject>
#include <QString>

class TestBrushStrokePreviewCache : public QObject
{
    Q_OBJECT
private Q_SLOTS:
    void init();
    void cleanup();

    void testPaintsThenReusesFromDisk();
    void testPresetChangeInvalidates();
    void testNewSavedStateReplacesOlderFiles();
    void testInvalidatePresetRemovesFiles();
    void testNothingToShowIsRemembered();
    void testPausedWhileBusy();
    void testPausedWhileAgentWorks();
    void testWaitsForTheQuietPeriod();
    void testNothingWrittenOutsideTheFolder();
    void testFolderFollowsTheIdentity();
    void testMaskHelpers();
    void testGeneratingDoesNotTouchThePreset();

    /// Not a check: with TOSKA_PREVIEW_SHEET set to a folder, paints every default preset and writes the contact sheets the
    /// theme decision was made from (AGENT-FORK.md), and prints per-engine timings. Skipped otherwise.
    void testContactSheet();

private:
    QString m_folder;
};

#endif
