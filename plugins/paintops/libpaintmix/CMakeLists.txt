# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-2.0-or-later

# Colour mixing models as pure functions (RGB, linear light, tuned Lab, libmypaint's spectral). No Krita link dependencies.
add_library(kritapaintmix STATIC
    KisPaintMix.cpp
    KisPaintMixBuffers.cpp
    KisPaintMixSpectral.cpp)
set_target_properties(kritapaintmix PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(kritapaintmix PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(kritapaintmix PUBLIC cxx_std_17)

if(BUILD_TESTING)
    add_subdirectory(tests)
endif()
