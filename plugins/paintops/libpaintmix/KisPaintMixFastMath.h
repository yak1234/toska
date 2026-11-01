/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
/*
 * fastlog2 and fastpow2 are copied from libmypaint 1.6.1, fastapprox/fastlog.h and fastapprox/fastexp.h
 * (fastpow there is fastpow2(p * fastlog2(x))). Original header:
 *
 *=====================================================================*
 *                   Copyright (C) 2011 Paul Mineiro                   *
 * All rights reserved.                                                *
 *                                                                     *
 * Redistribution and use in source and binary forms, with             *
 * or without modification, are permitted provided that the            *
 * following conditions are met:                                       *
 *                                                                     *
 *     * Redistributions of source code must retain the                *
 *     above copyright notice, this list of conditions and             *
 *     the following disclaimer.                                       *
 *                                                                     *
 *     * Redistributions in binary form must reproduce the             *
 *     above copyright notice, this list of conditions and             *
 *     the following disclaimer in the documentation and/or            *
 *     other materials provided with the distribution.                 *
 *                                                                     *
 *     * Neither the name of Paul Mineiro nor the names                *
 *     of other contributors may be used to endorse or promote         *
 *     products derived from this software without specific            *
 *     prior written permission.                                       *
 *                                                                     *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND              *
 * CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,         *
 * INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES               *
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE             *
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER               *
 * OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,                 *
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES            *
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE           *
 * GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR                *
 * BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF          *
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT           *
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY              *
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE             *
 * POSSIBILITY OF SUCH DAMAGE.                                         *
 *                                                                     *
 * Contact: Paul Mineiro <paul@mineiro.com>                            *
 *=====================================================================*/
#ifndef KISPAINTMIXFASTMATH_H
#define KISPAINTMIXFASTMATH_H

#include <cstdint>
#include <cstring>

namespace KisPaintMix {
namespace detail {

// libmypaint fastapprox/fastlog.h, fastlog2 (the union type pun is a memcpy here, same bits)
inline float fastlog2(float x)
{
    uint32_t vi;
    std::memcpy(&vi, &x, sizeof vi);
    const uint32_t mi = (vi & 0x007FFFFF) | 0x3f000000;
    float mx;
    std::memcpy(&mx, &mi, sizeof mx);
    float y = static_cast<float>(vi);
    y *= 1.1920928955078125e-7f;

    return y - 124.22551499f
             - 1.498030302f * mx
             - 1.72587999f / (0.3520887068f + mx);
}

// libmypaint fastapprox/fastexp.h, fastpow2 (cast_uint32_t is a plain conversion there)
inline float fastpow2(float p)
{
    const float offset = (p < 0) ? 1.0f : 0.0f;
    const float clipp = (p < -126) ? -126.0f : p;
    const int w = static_cast<int>(clipp);
    const float z = clipp - w + offset;
    const uint32_t vi = static_cast<uint32_t>((1 << 23) * (clipp + 121.2740575f + 27.7280233f / (4.84252568f - z) - 1.49012907f * z));
    float f;
    std::memcpy(&f, &vi, sizeof f);
    return f;
}

// libmypaint fastapprox/fastpow.h, fastpow
inline float fastpow(float x, float p)
{
    return fastpow2(p * fastlog2(x));
}

}
}

#endif // KISPAINTMIXFASTMATH_H
