/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KisPaintMixBuffers.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

namespace KisPaintMix {

namespace {

/**
 * A small pool for parallelFor: the workers are started on first use and never joined (the pool is never destroyed, so
 * nothing runs at exit). One parallelFor runs at a time; a second caller meanwhile does its work on its own thread.
 */
class Pool
{
public:
    static Pool &instance()
    {
        static Pool *pool = new Pool();
        return *pool;
    }

    void run(int count, int grain, const std::function<void(int, int)> &fn)
    {
        std::unique_lock<std::mutex> busy(m_busy, std::try_to_lock);
        if (!busy.owns_lock() || m_workers.empty() || count <= grain) {
            fn(0, count);
            return;
        }
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_fn = &fn;
            m_count = count;
            m_grain = grain;
            m_next.store(0);
            m_working = int(m_workers.size());
            ++m_generation;
        }
        m_wake.notify_all();
        work();
        std::unique_lock<std::mutex> lock(m_mutex);
        m_done.wait(lock, [this] { return m_working == 0; });
        m_fn = nullptr;
    }

private:
    Pool()
    {
        const unsigned cores = std::thread::hardware_concurrency();
        const int workers = int(std::min(7u, cores > 1 ? cores - 1 : 0u));
        for (int i = 0; i < workers; ++i) {
            m_workers.emplace_back([this] { loop(); });
            m_workers.back().detach();
        }
    }

    void work()
    {
        for (;;) {
            const int begin = m_next.fetch_add(m_grain);
            if (begin >= m_count) return;
            (*m_fn)(begin, std::min(m_count, begin + m_grain));
        }
    }

    void loop()
    {
        unsigned long seen = 0;
        for (;;) {
            {
                std::unique_lock<std::mutex> lock(m_mutex);
                m_wake.wait(lock, [&] { return m_generation != seen; });
                seen = m_generation;
            }
            work();
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                --m_working;
            }
            m_done.notify_all();
        }
    }

    std::vector<std::thread> m_workers;
    std::mutex m_busy, m_mutex;
    std::condition_variable m_wake, m_done;
    const std::function<void(int, int)> *m_fn {nullptr};
    int m_count {0}, m_grain {1}, m_working {0};
    std::atomic<int> m_next {0};
    unsigned long m_generation {0};
};

/// Two colours this close in every channel (2/255) mix to the same colour by any model as by a plain average, within
/// rounding: the model's own arithmetic is skipped for them. A blending brush mostly meets such pairs.
const float NearlyEqual = 2.0f / 255.0f;

inline bool nearlyEqual(Rgb a, Rgb b)
{
    return std::fabs(a.r - b.r) <= NearlyEqual && std::fabs(a.g - b.g) <= NearlyEqual && std::fabs(a.b - b.b) <= NearlyEqual;
}

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
void runRange(Model m, Blend blend, uint8_t *dst, const uint8_t *src, bool one, const uint8_t *mask, int begin, int end, float opacity)
{
    using C = Codec<F>;
    const Px s0 = C::load(src);
    for (int i = begin; i < end; ++i) {
        uint8_t *d = dst + size_t(i) * C::stride;
        float op = opacity;
        if (mask) {
            if (mask[i] == 0) continue;            // nothing of the source reaches this pixel
            if (mask[i] != 255) op *= mask[i] / 255.0f;
        }
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
        const Rgb out = p.a <= 0.0f ? s.c : mix2((m != Model::Rgb && nearlyEqual(p.c, s.c)) ? Model::Rgb : m, p.c, s.c, t);
        C::store(d, out, std::min(a, 1.0f));
    }
}

/// From this many pixels a model's blend is shared among the pool's threads, in pieces of this size.
const int ParallelFrom = 4096;
const int ParallelGrain = 1024;

template<PixelFormat F>
void run(Model m, Blend blend, uint8_t *dst, const uint8_t *src, bool one, const uint8_t *mask, int count, float opacity)
{
    if (m == Model::Rgb || count < ParallelFrom) {
        runRange<F>(m, blend, dst, src, one, mask, 0, count, opacity);
        return;
    }
    parallelFor(count, ParallelGrain, [=](int begin, int end) {
        runRange<F>(m, blend, dst, src, one, mask, begin, end, opacity);
    });
}

}

void parallelFor(int count, int grain, const std::function<void(int begin, int end)> &fn)
{
    if (count <= 0) return;
    Pool::instance().run(count, std::max(1, grain), fn);
}

namespace {

}

void blendPixelsMasked(Model m, Blend blend, PixelFormat f, uint8_t *dst, const uint8_t *src, bool srcIsOneColour,
                       const uint8_t *mask, int count, float opacity)
{
    if (!dst || !src || count <= 0) return;
    const float op = std::min(1.0f, std::max(0.0f, opacity));
    if (op <= 0.0f) return;
    switch (f) {
    case PixelFormat::Bgra8: run<PixelFormat::Bgra8>(m, blend, dst, src, srcIsOneColour, mask, count, op); break;
    case PixelFormat::Bgra16: run<PixelFormat::Bgra16>(m, blend, dst, src, srcIsOneColour, mask, count, op); break;
    case PixelFormat::RgbaF32: run<PixelFormat::RgbaF32>(m, blend, dst, src, srcIsOneColour, mask, count, op); break;
    }
}

void blendPixels(Model m, Blend blend, PixelFormat f, uint8_t *dst, const uint8_t *src, bool srcIsOneColour, int count, float opacity)
{
    if (!dst || !src || count <= 0) return;
    const float op = std::min(1.0f, std::max(0.0f, opacity));
    switch (f) {
    case PixelFormat::Bgra8: run<PixelFormat::Bgra8>(m, blend, dst, src, srcIsOneColour, nullptr, count, op); break;
    case PixelFormat::Bgra16: run<PixelFormat::Bgra16>(m, blend, dst, src, srcIsOneColour, nullptr, count, op); break;
    case PixelFormat::RgbaF32: run<PixelFormat::RgbaF32>(m, blend, dst, src, srcIsOneColour, nullptr, count, op); break;
    }
}

}
