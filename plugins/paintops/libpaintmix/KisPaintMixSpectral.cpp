/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
/*
 * Spectral mixing as libmypaint 1.6.1 does it (libmypaint is ISC-licensed, COPYING there).
 * The constants T_MATRIX_SMALL, spectral_r_small, spectral_g_small, spectral_b_small and WGM_EPSILON, and the
 * functions rgb_to_spectral and spectral_to_rgb, are copied from helpers.c lines 39-60 and 521-600; the weighted
 * geometric mean per band is the dab blend of brushmodes.c lines 73-135 (draw_dab_pixels_BlendMode_Normal_Paint).
 */
#include "KisPaintMix.h"
#include "KisPaintMixFastMath.h"

#include <cstring>

namespace KisPaintMix {

namespace {

// libmypaint helpers.c (WGM_EPSILON, 0.001)
const float WGM_EPSILON = 0.001f;

// libmypaint helpers.c lines 39-60
const float T_MATRIX_SMALL[3][10] = {{0.026595621243689f,0.049779426257903f,0.022449850859496f,-0.218453689278271f
,-0.256894883201278f,0.445881722194840f,0.772365886289756f,0.194498761382537f
,0.014038157587820f,0.007687264480513f}
,{-0.032601672674412f,-0.061021043498478f,-0.052490001018404f
,0.206659098273522f,0.572496335158169f,0.317837248815438f,-0.021216624031211f
,-0.019387668756117f,-0.001521339050858f,-0.000835181622534f}
,{0.339475473216284f,0.635401374177222f,0.771520797089589f,0.113222640692379f
,-0.055251113343776f,-0.048222578468680f,-0.012966666339586f
,-0.001523814504223f,-0.000094718948810f,-0.000051604594741f}};

const float spectral_r_small[10] = {0.009281362787953f,0.009732627042016f,0.011254252737167f,0.015105578649573f
,0.024797924177217f,0.083622585502406f,0.977865045723212f,1.000000000000000f
,0.999961046144372f,0.999999992756822f};

const float spectral_g_small[10] = {0.002854127435775f,0.003917589679914f,0.012132151699187f,0.748259205918013f
,1.000000000000000f,0.865695937531795f,0.037477469241101f,0.022816789725717f
,0.021747419446456f,0.021384940572308f};

const float spectral_b_small[10] = {0.537052150373386f,0.546646402401469f,0.575501819073983f,0.258778829633924f
,0.041709923751716f,0.012662638828324f,0.007485593127390f,0.006766900622462f
,0.006699764779016f,0.006676219883241f};

float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

}

// helpers.c rgb_to_spectral (assigns where libmypaint accumulates into a zeroed array)
void toSpectrum(Rgb c, float out[10])
{
    const float offset = 1.0f - WGM_EPSILON;
    const float r = c.r * offset + WGM_EPSILON;
    const float g = c.g * offset + WGM_EPSILON;
    const float b = c.b * offset + WGM_EPSILON;
    for (int i = 0; i < 10; i++) {
        out[i] = spectral_r_small[i] * r + spectral_g_small[i] * g + spectral_b_small[i] * b;
    }
}

// helpers.c spectral_to_rgb
Rgb fromSpectrum(const float s[10])
{
    const float offset = 1.0f - WGM_EPSILON;
    float tmp[3] = {0, 0, 0};
    for (int i = 0; i < 10; i++) {
        tmp[0] += T_MATRIX_SMALL[0][i] * s[i];
        tmp[1] += T_MATRIX_SMALL[1][i] * s[i];
        tmp[2] += T_MATRIX_SMALL[2][i] * s[i];
    }
    return {clamp01((tmp[0] - WGM_EPSILON) / offset),
            clamp01((tmp[1] - WGM_EPSILON) / offset),
            clamp01((tmp[2] - WGM_EPSILON) / offset)};
}

namespace {

// The log-domain functions run libmypaint's fastlog2 / fastpow2 on four bands at a time where the compiler has GCC's
// vector extension (GCC, Clang, MinGW); elsewhere band by band. Same operations per lane, so the same values up to
// the compiler's choice of fused multiply-adds.
#if defined(__GNUC__) || defined(__clang__)

typedef float F4 __attribute__((vector_size(16)));
typedef int32_t I4 __attribute__((vector_size(16)));
typedef uint32_t U4 __attribute__((vector_size(16)));

inline F4 splat(float v) { return F4{v, v, v, v}; }
inline U4 splatU(uint32_t v) { return U4{v, v, v, v}; }
inline F4 load4(const float *p) { F4 v; std::memcpy(&v, p, sizeof v); return v; }
inline void store4(float *p, F4 v) { std::memcpy(p, &v, sizeof v); }
inline F4 select4(I4 mask, F4 a, F4 b) { return (F4)(((I4)a & mask) | ((I4)b & ~mask)); }

// fastapprox fastlog2, four lanes
inline F4 fastlog2x4(F4 x)
{
    const U4 vi = (U4)x;
    const F4 mx = (F4)((vi & splatU(0x007FFFFF)) | splatU(0x3f000000));
    const F4 y = __builtin_convertvector(vi, F4) * splat(1.1920928955078125e-7f);
    return y - splat(124.22551499f) - splat(1.498030302f) * mx - splat(1.72587999f) / (splat(0.3520887068f) + mx);
}

// fastapprox fastpow2, four lanes (the result never reaches 2^31 for the exponents here, <= 0 plus rounding)
inline F4 fastpow2x4(F4 p)
{
    const F4 offset = (F4)((I4)splat(1.0f) & (I4)(p < splat(0.0f)));
    const F4 clipp = select4((I4)(p < splat(-126.0f)), splat(-126.0f), p);
    const F4 w = __builtin_convertvector(__builtin_convertvector(clipp, I4), F4);
    const F4 z = clipp - w + offset;
    const F4 v = splat(float(1 << 23)) * (clipp + splat(121.2740575f) + splat(27.7280233f) / (splat(4.84252568f) - z)
                                          - splat(1.49012907f) * z);
    return (F4)__builtin_convertvector(v, I4);
}

void logBands(const float in[12], float out[12])
{
    for (int i = 0; i < 12; i += 4) {
        store4(out + i, fastlog2x4(load4(in + i)));
    }
}

void powBands(const float in[12], float out[12])
{
    for (int i = 0; i < 12; i += 4) {
        store4(out + i, fastpow2x4(load4(in + i)));
    }
}

#else

void logBands(const float in[12], float out[12])
{
    for (int i = 0; i < 12; i++) {
        out[i] = detail::fastlog2(in[i]);
    }
}

void powBands(const float in[12], float out[12])
{
    for (int i = 0; i < 12; i++) {
        out[i] = detail::fastpow2(in[i]);
    }
}

#endif

}

void toLogSpectrum(Rgb c, LogSpectrum &out)
{
    float s[12];
    toSpectrum(c, s);
    s[10] = 1.0f;
    s[11] = 1.0f;
    logBands(s, out.band);
    out.band[10] = 0.0f;
    out.band[11] = 0.0f;
}

Rgb fromLogSpectrum(const LogSpectrum &s)
{
    float linear[12];
    powBands(s.band, linear);
    return fromSpectrum(linear);
}

Rgb mixLogSpectra(const LogSpectrum &a, const LogSpectrum &b, float t)
{
    // brushmodes.c: fastpow(spectral_a[i], fac_a) * fastpow(spectral_b[i], fac_b), fastpow(x, p) being
    // fastpow2(p * fastlog2(x)); the fastlog2 halves come from the log spectra
    const float u = 1.0f - t;
    float pa[12], pb[12];
    for (int i = 0; i < 12; i++) {
        pa[i] = u * a.band[i];
        pb[i] = t * b.band[i];
    }
    float fa[12], fb[12];
    powBands(pa, fa);
    powBands(pb, fb);
    for (int i = 0; i < 12; i++) {
        fa[i] *= fb[i];
    }
    return fromSpectrum(fa);
}

LogSpectrumCache::LogSpectrumCache()
{
    for (Entry &e : m_entries) {
        e.valid = false;
    }
}

const LogSpectrum &LogSpectrumCache::get(Rgb c)
{
    uint32_t key[3];
    std::memcpy(&key[0], &c.r, 4);
    std::memcpy(&key[1], &c.g, 4);
    std::memcpy(&key[2], &c.b, 4);
    uint32_t h = key[0] * 0x9E3779B1u;
    h ^= key[1] * 0x85EBCA77u;
    h ^= key[2] * 0xC2B2AE3Du;
    h ^= h >> 15;
    Entry &e = m_entries[h & (Size - 1)];
    if (!e.valid || e.key[0] != key[0] || e.key[1] != key[1] || e.key[2] != key[2]) {
        e.key[0] = key[0];
        e.key[1] = key[1];
        e.key[2] = key[2];
        e.valid = true;
        toLogSpectrum(c, e.log);
    }
    return e.log;
}

SpectralAverage::SpectralAverage(LogSpectrumCache &cache)
    : m_cache(cache)
{
    for (float &v : m_acc) {
        v = 0.0f;
    }
}

void SpectralAverage::startRun(Rgb c, float weight)
{
    flush();
    m_run = c;
    m_runWeight = weight;
}

void SpectralAverage::flush()
{
    if (!(m_runWeight > 0.0f)) return;
    if (!m_any) {
        m_first = m_run;
        m_any = true;
    } else if (m_run != m_first) {
        m_mixed = true;
    }
    const LogSpectrum &l = m_cache.get(m_run);
    for (int i = 0; i < 12; i++) {
        m_acc[i] += m_runWeight * l.band[i];
    }
    m_sum += m_runWeight;
    m_runWeight = 0.0f;
}

bool SpectralAverage::isEmpty() const
{
    return !m_any && !(m_runWeight > 0.0f);
}

Rgb SpectralAverage::result()
{
    flush();
    if (!m_any) return {0.0f, 0.0f, 0.0f};
    if (!m_mixed) return m_first;
    LogSpectrum mean;
    const float scale = 1.0f / m_sum;
    for (int i = 0; i < 12; i++) {
        mean.band[i] = m_acc[i] * scale;
    }
    return fromLogSpectrum(mean);
}

SpectralDabMixer::SpectralDabMixer(LogSpectrumCache &cache)
    : m_cache(cache)
{
    for (Entry &e : m_entries) {
        e.generation = 0;
    }
    setTop({0.0f, 0.0f, 0.0f});
}

void SpectralDabMixer::setTop(Rgb top)
{
    if (m_generation != 0 && std::memcmp(&top, &m_top, sizeof top) == 0) return;
    m_top = top;
    toLogSpectrum(top, m_topLog);
    m_generation++;
    if (m_generation == 0) {
        // after 2^32 colours: forget every entry rather than mistake an old one for new
        for (Entry &e : m_entries) {
            e.generation = 0;
        }
        m_generation = 1;
    }
}

const SpectralDabMixer::Entry *SpectralDabMixer::fill(uint32_t slot, Rgb bottom, Key key, uint32_t knot)
{
    Entry &e = m_entries[slot];
    const LogSpectrum &bottomLog = m_cache.get(bottom);
    e.key = key;
    e.knot = knot;
    e.generation = m_generation;
    e.low = mixLogSpectra(bottomLog, m_topLog, float(knot) / Knots);
    e.high = mixLogSpectra(bottomLog, m_topLog, float(knot + 1) / Knots);
    return &e;
}

namespace detail {

// brushmodes.c: spectral_result[i] = fastpow(spectral_a[i], fac_a) * fastpow(spectral_b[i], fac_b)
Rgb spectralMix2(Rgb a, Rgb b, float t)
{
    float sa[10], sb[10], s[10];
    toSpectrum(a, sa);
    toSpectrum(b, sb);
    for (int i = 0; i < 10; i++) {
        s[i] = fastpow(sa[i], 1.0f - t) * fastpow(sb[i], t);
    }
    return fromSpectrum(s);
}

// Weighted geometric mean of n colours: fastpow2(sum w_k * fastlog2(s_k)), weights normalised, non-positive skipped.
Rgb spectralMixMany(const Rgb *colours, const float *weights, int n)
{
    float sum = 0.0f;
    for (int k = 0; k < n; k++) {
        if (weights[k] > 0.0f) sum += weights[k];
    }
    float acc[10] = {0};
    for (int k = 0; k < n; k++) {
        if (!(weights[k] > 0.0f)) continue;
        const float w = weights[k] / sum;
        float sk[10];
        toSpectrum(colours[k], sk);
        for (int i = 0; i < 10; i++) {
            acc[i] += w * fastlog2(sk[i]);
        }
    }
    float s[10];
    for (int i = 0; i < 10; i++) {
        s[i] = fastpow2(acc[i]);
    }
    return fromSpectrum(s);
}

}

}
