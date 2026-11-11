/*
 *  SPDX-FileCopyrightText: 2021 Dmitry Kazakov <dimula73@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef KISCOLORSMUDGEOPTEST_H
#define KISCOLORSMUDGEOPTEST_H

#include <QTest>

class KisColorsmudgeOpTest : public QObject
{
    Q_OBJECT
private Q_SLOTS:

    void test();
    void test_data();

    // Toska: the preset's mixing model (KisColorSmudgeMixingOptionData, KisColorSmudgeStrategyBase::setMixing)
    void testMixingOptionRoundTrip();
    void testUnknownModelReadsAsRgb();
    void testSpectralSmudgeBlueIntoYellowIsGreen();
    void testPigmentComplementariesBrownOnCanvas();
    void testMixOnBrushOffIsRgb();
    void testMixInWetPaintStoredOnly();
    void testNonRgbColourSpaceFallsBack();
    void testNonNormalCompositeKeepsKritaOp();
    void testOverlayModeUsesModel();
    void testBlendingWithoutPaintUsesModel();
    void testPickedUpColourIsAveragedByTheModel();
};

#endif // KISCOLORSMUDGEOPTEST_H
