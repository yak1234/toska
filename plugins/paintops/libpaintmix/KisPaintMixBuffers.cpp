/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPaintMixBuffers.h"

#include <algorithm>
#include <cstring>

namespace KisPaintMix {

namespace {

struct Px {
    Rgb c;
    float a;
};

template<PixelFormat F> struct Codec;

template<> struct Codec<PixelFormat::Bgra8> {
    static constexpr int stride = 4;
    static Px load(const uint8_t *p)
    {
        return {{p[2] / 255.0f, p[1] / 255.0f, p[0] / 255.0f}, p[3] / 255.0f};
    }
    static uint8_t q(float v) { return uint8_t(std::min(255.0f, std::max(0.0f, v * 255.0f + 0.5f))); }
    static void store(uint8_t *p, Rgb c, float a)
    {
        p[0] = q(c.b);
        p[1] = q(c.g);
        p[2] = q(c.r);
        p[3] = q(a);
    }
    static void storeAlpha(uint8_t *p, float a) { p[3] = q(a); }
};

template<> struct Codec<PixelFormat::Bgra16> {
    static constexpr int stride = 8;
    static Px load(const uint8_t *p)
    {
        uint16_t v[4];
        std::memcpy(v, p, sizeof(v));
        return {{v[2] / 65535.0f, v[1] / 65535.0f, v[0] / 65535.0f}, v[3] / 65535.0f};
    }
    static uint16_t q(float v) { return uint16_t(std::min(65535.0f, std::max(0.0f, v * 65535.0f + 0.5f))); }
    static void store(uint8_t *p, Rgb c, float a)
    {
        const uint16_t v[4] = {q(c.b), q(c.g), q(c.r), q(a)};
        std::memcpy(p, v, sizeof(v));
    }
    static void storeAlpha(uint8_t *p, float a)
    {
        const uint16_t v = q(a);
        std::memcpy(p + 6, &v, sizeof(v));
    }
};

template<> struct Codec<PixelFormat::RgbaF32> {
    static constexpr int stride = 16;
    static Px load(const uint8_t *p)
    {
        float v[4];
        std::memcpy(v, p, sizeof(v));
        return {{v[0], v[1], v[2]}, v[3]};
    }
    static void store(uint8_t *p, Rgb c, float a)
    {
        const float v[4] = {c.r, c.g, c.b, a};
        std::memcpy(p, v, sizeof(v));
    }
    static void storeAlpha(uint8_t *p, float a) { std::memcpy(p + 12, &a, sizeof(a)); }
};

template<PixelFormat F>
void run(Model m, Blend blend, uint8_t *dst, const uint8_t *src, bool one, int count, float op)
{
    using C = Codec<F>;
    const Px s0 = C::load(src);
    for (int i = 0; i < count; ++i) {
        uint8_t *d = dst + size_t(i) * C::stride;
        const Px s = one ? s0 : C::load(src + size_t(i) * C::stride);
        const Px p = C::load(d);

        float a, t;
        if (blend == Blend::Over) {
            const float sa = s.a * op;
            a = sa + p.a * (1.0f - sa);
            t = a < 1e-6f ? 0.0f : sa / a;
        } else {
            a = p.a + (s.a - p.a) * op;
            const float denom = op * s.a + (1.0f - op) * p.a;
            t = denom < 1e-6f ? 0.0f : op * s.a / denom;
        }
        if (a < 1e-6f) {
            C::storeAlpha(d, std::max(a, 0.0f));
            continue;
        }
        t = std::min(1.0f, std::max(0.0f, t));
        // A fully transparent dst has no colour of its own: the source colour is taken exactly.
        const Rgb out = p.a <= 0.0f ? s.c : mix2(m, p.c, s.c, t);
        C::store(d, out, std::min(a, 1.0f));
    }
}

}

void blendPixels(Model m, Blend blend, PixelFormat f, uint8_t *dst, const uint8_t *src, bool srcIsOneColour, int count, float opacity)
{
    if (!dst || !src || count <= 0) return;
    const float op = std::min(1.0f, std::max(0.0f, opacity));
    switch (f) {
    case PixelFormat::Bgra8: run<PixelFormat::Bgra8>(m, blend, dst, src, srcIsOneColour, count, op); break;
    case PixelFormat::Bgra16: run<PixelFormat::Bgra16>(m, blend, dst, src, srcIsOneColour, count, op); break;
    case PixelFormat::RgbaF32: run<PixelFormat::RgbaF32>(m, blend, dst, src, srcIsOneColour, count, op); break;
    }
}

}
