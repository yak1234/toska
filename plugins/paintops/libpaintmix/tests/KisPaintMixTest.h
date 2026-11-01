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
};

#endif // KISPAINTMIXTEST_H
