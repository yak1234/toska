/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISPAINTMIXTEST_H
#define KISPAINTMIXTEST_H

#include <simpletest.h>

class KisPaintMixTest : public QObject
{
    Q_OBJECT
private Q_SLOTS:
    void testModelIds();
    void testRgbIsPlainLerp();
    void testUnmixedColoursRoundTripExactly();
    void testSpectralBlueYellowIsGreen();
    void testSpectralMatchesLibmypaint();
    void testLinearBlackWhiteHalf();
    void testPerceptualBlackWhiteHalf();
    void testMixManyEqualsMix2();
    void testBlendPixelsRgbMatchesKritaOver();
    void testBlendPixelsOneColourOverTransparentIsExact();
    void testBlendPixelsTinyAlphaIsFinite();
    void testBlendPixelsBgra16AndFloatNumeric();
    void testSpectralOutOfRangeFloatIsFinite();
    void testBlendPixelsCopyAlpha();
    void testGoldenVectors();
    void testSpeed();

    // the log-domain path the MyPaint surface takes (task 7a)
    void testLogSpectrumCacheIsExact();
    void testMixLogSpectraIsMix2();
    void testDabMixerMatchesMix2();
    void testDabMixerKeepsExactCases();
    void testSpectralAverageMatchesMixMany();

    // the pigment model, Mixbox (task 9)
    void testPigmentBlueYellowIsGreen();
    void testPigmentComplementariesMakeBrown();
    void testPigmentLatentRoundTrip();
    void testSettingsDefaults();

    // blendPixelsMasked and the toska_mix_* blend modes (libs/pigment/compositeops/KoCompositeOpToskaMix)
    void testBlendPixelsMaskedFollowsTheMask();
    void testMixBlendModesAreOnRgbaSpacesOnly();
    void testMixBlendModeBlueOverYellowIsGreen();
    void testMixBlendModeMaskAndChannelFlags();
    void testMixBlendModeCopyForm();
    void testMixBlendModeOnALinearProfile();
};

#endif // KISPAINTMIXTEST_H
