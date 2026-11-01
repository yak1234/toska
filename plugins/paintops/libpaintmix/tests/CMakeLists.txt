# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-2.0-or-later

kis_add_tests(KisPaintMixTest.cpp
    LINK_LIBRARIES kritapaintmix kritapigment kritaglobal kritatestsdk Qt${QT_MAJOR_VERSION}::Widgets)
