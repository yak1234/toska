/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#ifndef KISPAINTMIX_H
#define KISPAINTMIX_H

#include <cstdint>
#include <cstring>
#include <optional>
#include <string_view>

/**
 * Colour mixing models as pure functions. Inputs and outputs are straight, sRGB-encoded components in 0..1.
 * Unmixed colours are exact: t == 0, t == 1, a == b, or a single non-zero weight returns the input bit for bit.
 */
#if defined(__GNUC__) || defined(__clang__)
#define KISPAINTMIX_ALWAYS_INLINE inline __attribute__((always_inline))
#elif defined(_MSC_VER)
#define KISPAINTMIX_ALWAYS_INLINE __forceinline
#else
#define KISPAINTMIX_ALWAYS_INLINE inline
#endif

namespace KisPaintMix {

enum class Model { Rgb, LinearLight, Perceptual, Spectral };

struct Rgb {
    float r, g, b;
};

inline bool operator==(const Rgb &a, const Rgb &b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
inline bool operator!=(const Rgb &a, const Rgb &b) { return !(a == b); }

const char *modelId(Model m);
std::optional<Model> modelFromId(std::string_view id);

/// t is b's share: t == 0 gives a, t == 1 gives b.
Rgb mix2(Model m, Rgb a, Rgb b, float t);

/// Weighted mix of n colours; weights are normalised, negative weights count as zero, n <= 0 or all-zero gives black.
Rgb mixMany(Model m, const Rgb *colours, const float *weights, int n);

/// libmypaint's ten-band spectral upsampling (rgb_to_spectral, assigning) and its inverse (spectral_to_rgb).
void toSpectrum(Rgb c, float out[10]);
Rgb fromSpectrum(const float s[10]);

/**
 * The spectral model in the log domain, for callers that mix one colour into many pixels (a MyPaint dab) or average
 * many pixels (a colour sample): a log spectrum is log2 of toSpectrum (libmypaint's fastlog2), so a weighted geometric
 * mean is a weighted sum of log spectra and one fastpow2 per band.
 */
struct LogSpectrum {
    float band[12]; ///< bands 0..9; 10 and 11 are padding (0, the log of 1) so the bands fill three 4-lane vectors
};

/// log2 of toSpectrum(c), band by band.
void toLogSpectrum(Rgb c, LogSpectrum &out);

/// fromSpectrum of fastpow2 of each band: the colour a (weighted sum of) log spectra stands for.
Rgb fromLogSpectrum(const LogSpectrum &s);

/**
 * mix2(Model::Spectral, a, b, t) for colours given as log spectra, with mix2's own arithmetic (libmypaint's dab
 * blend): fastpow2((1 - t) * a) * fastpow2(t * b) per band, then fromSpectrum, so the same result up to the compiler's
 * choice of fused multiply-adds. t is b's share. It does not short-circuit: callers keep mix2's exact cases (t == 0,
 * t == 1, equal colours) themselves.
 */
Rgb mixLogSpectra(const LogSpectrum &a, const LogSpectrum &b, float t);

/**
 * A direct-mapped cache of log spectra keyed by the exact colour (its float bits), so pixels of a colour already seen
 * skip the ten logarithms. Exact: a hit returns what toLogSpectrum returned for the same colour.
 */
class LogSpectrumCache
{
public:
    LogSpectrumCache();
    const LogSpectrum &get(Rgb c);

private:
    static const int Size = 1024;
    struct Entry {
        uint32_t key[3];
        bool valid;
        LogSpectrum log;
    };
    Entry m_entries[Size];
};

/**
 * mixMany's spectral model for many colours at once: the weighted geometric mean of their spectra, summed in the log
 * domain. Runs of equal colours are added up first and each distinct colour's log spectrum comes from the cache.
 * Within 2e-4 (0.05/255) of mixMany(Model::Spectral, ...) over the same colours (summation order; for two colours
 * mixMany takes mix2's product of powers, this the power of a sum); one colour alone, however many times, comes back
 * exact.
 */
class SpectralAverage
{
public:
    explicit SpectralAverage(LogSpectrumCache &cache);
    /// Weights <= 0 are skipped, as in mixMany.
    inline void add(Rgb c, float weight)
    {
        if (!(weight > 0.0f)) return;
        if (m_runWeight > 0.0f && c == m_run) {
            m_runWeight += weight;
            return;
        }
        startRun(c, weight);
    }
    bool isEmpty() const;
    /// Black when empty.
    Rgb result();

private:
    void startRun(Rgb c, float weight);
    void flush();
    LogSpectrumCache &m_cache;
    float m_acc[12];
    float m_sum {0.0f};
    Rgb m_run {0.0f, 0.0f, 0.0f};
    float m_runWeight {0.0f};
    Rgb m_first {0.0f, 0.0f, 0.0f};
    bool m_any {false};
    bool m_mixed {false};
};

/**
 * mix2(Model::Spectral, bottom, top, t) for one top colour (a dab's) and many bottom colours and shares, as a dab
 * blends: for each bottom colour the mix is computed (mixLogSpectra) at knots of t every 1/Knots and interpolated
 * linearly between the two knots around t, and the knot pairs are memoised, so a dab costs one pair of spectral mixes
 * per (canvas colour, knot interval) it meets. Within 1.3e-4 (0.033/255) of mix2; t == 0, t == 1 and equal colours
 * are exact. Knots: 512, because a dab's result is rounded to the layer's depth and blended again by the next dabs, so
 * a pixel settles where one more dab no longer changes it; at 128 or 256 knots that point moved by up to 4/255 on
 * Marker Plain's thin dabs, at 512 by at most 1/255.
 */
class SpectralDabMixer
{
public:
    static const int Knots = 512;

    explicit SpectralDabMixer(LogSpectrumCache &cache);
    /// The memo is kept while the colour stays the same (bit for bit).
    void setTop(Rgb top);
    /// t is top's share.
    KISPAINTMIX_ALWAYS_INLINE Rgb mix(Rgb bottom, float t)
    {
        // mix2's exact cases
        if (t == 0.0f || bottom == m_top) return bottom;
        if (t == 1.0f) return m_top;

        const float scaled = t * Knots;
        int k = static_cast<int>(scaled);
        k = k < 0 ? 0 : (k >= Knots ? Knots - 1 : k);
        const uint32_t knot = uint32_t(k);
        const float f = scaled - k;

        Key key;
        std::memcpy(&key.r, &bottom.r, 4);
        std::memcpy(&key.g, &bottom.g, 4);
        std::memcpy(&key.b, &bottom.b, 4);
        uint32_t h = key.r * 0x9E3779B1u ^ key.g * 0x85EBCA77u ^ key.b * 0xC2B2AE3Du ^ uint32_t(knot) * 0x27D4EB2Fu;
        h ^= h >> 15;
        const Entry *e = &m_entries[h & (Size - 1)];
        if (((e->generation ^ m_generation) | (e->knot ^ knot) | (e->key.r ^ key.r) | (e->key.g ^ key.g)
             | (e->key.b ^ key.b)) != 0) {
            e = fill(h & (Size - 1), bottom, key, knot);
        }
        return {e->low.r + (e->high.r - e->low.r) * f,
                e->low.g + (e->high.g - e->low.g) * f,
                e->low.b + (e->high.b - e->low.b) * f};
    }

private:
    static const int Size = 4096;
    struct Key {
        uint32_t r, g, b;
    };
    struct Entry {
        Key key;
        uint32_t knot;
        uint32_t generation;
        Rgb low, high;
    };
    const Entry *fill(uint32_t slot, Rgb bottom, Key key, uint32_t knot);
    LogSpectrumCache &m_cache;
    Rgb m_top {0.0f, 0.0f, 0.0f};
    LogSpectrum m_topLog;
    uint32_t m_generation {0};
    Entry m_entries[Size];
};

/// Pixel layouts: Bgra8 and Bgra16 are B,G,R,A in native-endian uint8/uint16; RgbaF32 is R,G,B,A in float.
/// Colours are sRGB-encoded and alpha is straight (not premultiplied), as in Krita's RGB colour spaces.
enum class PixelFormat { Bgra8, Bgra16, RgbaF32 };
enum class Blend { Over, Copy };

/**
 * Blends src into dst (count pixels) with the model. Over: a = sa*op + da*(1 - sa*op), t = sa*op / a.
 * Copy: a = da + (sa - da)*op, t = op*sa / (op*sa + (1 - op)*da). Colour is mix2(m, dst, src, t); a < 1e-6 leaves the
 * colour unchanged. With srcIsOneColour, src points at a single pixel used for every dst pixel. opacity is clamped to 0..1.
 */
void blendPixels(Model m, Blend blend, PixelFormat f, uint8_t *dst, const uint8_t *src, bool srcIsOneColour, int count, float opacity);

}

#endif // KISPAINTMIX_H
