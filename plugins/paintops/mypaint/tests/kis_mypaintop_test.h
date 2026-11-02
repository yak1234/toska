/*
 *  SPDX-FileCopyrightText: 2020 Ashwin Dhakaita <ashwingpdhakaita@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef KIS_MYPAINTOP_TEST_H
#define KIS_MYPAINTOP_TEST_H

#include <QObject>
#include <stroke_testing_utils.h>
#include <qimage_based_test.h>
#include <simpletest.h>
#include <QTest>

class KisMyPaintOpTest: public QObject, public TestUtil::QImageBasedTest
{
    Q_OBJECT
public:
    KisMyPaintOpTest();
    virtual ~KisMyPaintOpTest() {}

private Q_SLOTS:
    void testDab();
    void testGetColor();
    void testLoading();

    // Toska: libmypaint's spectral paint_mode, for presets that opt in
    void testLegacyUnlessPaintMode();
    void testSpectralDabBlueOnYellowIsGreen();
    void testUnmixedDabIsExact();
    void testSpectralDab16BitAndFloat();
    void testEraserIgnoresPaintMode();
    void testGetColorPigmentAveragesSpectrally();
    void testSampleMergedReadsBelow();
    void testJsonPaintModeAloneStaysLegacy();
    void testToskaZeroForcesLegacyEvenWithMappings();

    // Toska: spectral speed (task 7a)
    void testSpectralStrokesMatchBefore();
    void testGetColorPigmentMatchesMixMany();
    void testSpectralStrokeStartsLikeLegacy();
    void testSpectralSmudgeFavoursBrushColour();
    void testMarkerFringesAreTheSpectralModel();
    void testMarkerRippleComesFromEightBitBlending();
    void benchmarkSpectralPaintMode();

    // Toska: spectral changes mixing, not coverage (pilot-p5 replay)
    void testSpectralKeepsCoverage();

    // Toska: the spectral glaze only where the layer holds sRGB-encoded values
    void testSpectralGlazeOnlyOnEncodedProfiles();
};

#endif // KIS_MYPAINTOP_TEST_H
