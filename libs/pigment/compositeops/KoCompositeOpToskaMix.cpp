/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "KoCompositeOpToskaMix.h"

#include <cmath>
#include <cstring>

#include <QBitArray>

#include <KisPaintMix.h>

#include <KoColorSpace.h>
#include <KoColorProfile.h>
#include <KoColorModelStandardIds.h>
#include <KoCompositeOpRegistry.h>

namespace {

const char *const modelIds[] = {"linear", "perceptual", "spectral", "pigment"};
const KisPaintMix::Model models[] = {KisPaintMix::Model::LinearLight, KisPaintMix::Model::Perceptual,
                                     KisPaintMix::Model::Spectral, KisPaintMix::Model::Pigment};

int formatOf(const KoColorSpace *cs)
{
    if (!cs || cs->colorModelId() != RGBAColorModelID) return -1;
    const KoID depth = cs->colorDepthId();
    if (depth == Integer8BitsColorDepthID) return int(KisPaintMix::PixelFormat::Bgra8);
    if (depth == Integer16BitsColorDepthID) return int(KisPaintMix::PixelFormat::Bgra16);
    if (depth == Float32BitsColorDepthID) return int(KisPaintMix::PixelFormat::RgbaF32);
    return -1;
}

int pixelBytes(KisPaintMix::PixelFormat f)
{
    return f == KisPaintMix::PixelFormat::Bgra8 ? 4 : f == KisPaintMix::PixelFormat::Bgra16 ? 8 : 16;
}

// the sRGB transfer curve
inline float encode(float v)
{
    if (!(v > 0.0f)) return 0.0f;
    return v <= 0.0031308f ? 12.92f * v : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
}

inline float decode(float v)
{
    if (!(v > 0.0f)) return 0.0f;
    return v <= 0.04045f ? v / 12.92f : std::pow((v + 0.055f) / 1.055f, 2.4f);
}

/// Pixels of any of the three layouts to and from R,G,B,A floats; linear: the stored values are linear light and the
/// floats are sRGB-encoded.
void toFloats(KisPaintMix::PixelFormat f, bool linear, const quint8 *in, float *out, int count)
{
    for (int i = 0; i < count; i++, out += 4) {
        if (f == KisPaintMix::PixelFormat::Bgra8) {
            const quint8 *p = in + i * 4;
            out[0] = p[2] / 255.0f; out[1] = p[1] / 255.0f; out[2] = p[0] / 255.0f; out[3] = p[3] / 255.0f;
        } else if (f == KisPaintMix::PixelFormat::Bgra16) {
            quint16 v[4];
            std::memcpy(v, in + i * 8, 8);
            out[0] = v[2] / 65535.0f; out[1] = v[1] / 65535.0f; out[2] = v[0] / 65535.0f; out[3] = v[3] / 65535.0f;
        } else {
            std::memcpy(out, in + i * 16, 16);
        }
        if (linear) { out[0] = encode(out[0]); out[1] = encode(out[1]); out[2] = encode(out[2]); }
    }
}

void fromFloats(KisPaintMix::PixelFormat f, bool linear, const float *in, quint8 *out, int count)
{
    for (int i = 0; i < count; i++, in += 4) {
        float v[4] = {in[0], in[1], in[2], in[3]};
        if (linear) { v[0] = decode(v[0]); v[1] = decode(v[1]); v[2] = decode(v[2]); }
        if (f == KisPaintMix::PixelFormat::Bgra8) {
            auto q = [](float x) { return quint8(qBound(0.0f, x * 255.0f + 0.5f, 255.0f)); };
            quint8 *p = out + i * 4;
            p[0] = q(v[2]); p[1] = q(v[1]); p[2] = q(v[0]); p[3] = q(v[3]);
        } else if (f == KisPaintMix::PixelFormat::Bgra16) {
            auto q = [](float x) { return quint16(qBound(0.0f, x * 65535.0f + 0.5f, 65535.0f)); };
            const quint16 w[4] = {q(v[2]), q(v[1]), q(v[0]), q(v[3])};
            std::memcpy(out + i * 8, w, 8);
        } else {
            std::memcpy(out + i * 16, v, 16);
        }
    }
}

} // namespace

QString KoCompositeOpToskaMix::idFor(Mix mix, bool copy)
{
    return QStringLiteral("toska_mix_") + QLatin1String(modelIds[mix]) + (copy ? QStringLiteral("_copy") : QString());
}

QString KoCompositeOpToskaMix::idForModel(const QString &modelId, bool copy)
{
    for (int i = 0; i < 4; i++) {
        if (modelId == QLatin1String(modelIds[i])) return idFor(Mix(i), copy);
    }
    return QString();
}

void KoCompositeOpToskaMix::addTo(KoColorSpace *cs)
{
    if (formatOf(cs) < 0) return;
    for (int i = 0; i < 4; i++) {
        cs->addCompositeOp(new KoCompositeOpToskaMix(cs, Mix(i), false));
        cs->addCompositeOp(new KoCompositeOpToskaMix(cs, Mix(i), true));
    }
}

KoCompositeOpToskaMix::KoCompositeOpToskaMix(const KoColorSpace *cs, Mix mix, bool copy)
    : KoCompositeOp(cs, idFor(mix, copy), KoCompositeOp::categoryMix())
    , m_mix(mix)
    , m_copy(copy)
    , m_format(formatOf(cs))
    , m_linear(cs && cs->profile() && cs->profile()->isLinear())
{
}

void KoCompositeOpToskaMix::composite(const KoCompositeOp::ParameterInfo &params) const
{
    if (m_format < 0) return;
    const KisPaintMix::PixelFormat format = KisPaintMix::PixelFormat(m_format);
    const KisPaintMix::Model model = models[m_mix];
    const KisPaintMix::Blend blend = m_copy ? KisPaintMix::Blend::Copy : KisPaintMix::Blend::Over;
    const int size = pixelBytes(format);
    const bool oneColour = params.srcRowStride == 0;

    // channel flags: an empty array or all of the four set means every channel is written
    bool allChannels = params.channelFlags.isEmpty();
    if (!allChannels) {
        allChannels = true;
        for (int c = 0; c < 4 && c < params.channelFlags.size(); c++) allChannels = allChannels && params.channelFlags.testBit(c);
    }
    const int channelBytes = size / 4;

    const int Chunk = 256;
    float dstF[Chunk * 4], srcF[Chunk * 4];
    quint8 kept[Chunk * 16];

    const quint8 *srcRow = params.srcRowStart;
    quint8 *dstRow = params.dstRowStart;
    const quint8 *maskRow = params.maskRowStart;

    for (qint32 row = 0; row < params.rows; row++) {
        for (qint32 x = 0; x < params.cols; x += Chunk) {
            const int n = qMin<qint32>(Chunk, params.cols - x);
            quint8 *dst = dstRow + size_t(x) * size;
            const quint8 *src = oneColour ? srcRow : srcRow + size_t(x) * size;
            const quint8 *mask = maskRow ? maskRow + x : nullptr;

            if (!allChannels) std::memcpy(kept, dst, size_t(n) * size);

            if (!m_linear) {
                KisPaintMix::blendPixelsMasked(model, blend, format, dst, src, oneColour, mask, n, params.opacity);
            } else {
                toFloats(format, true, dst, dstF, n);
                toFloats(format, true, src, srcF, oneColour ? 1 : n);
                KisPaintMix::blendPixelsMasked(model, blend, KisPaintMix::PixelFormat::RgbaF32, reinterpret_cast<quint8*>(dstF),
                                               reinterpret_cast<const quint8*>(srcF), oneColour, mask, n, params.opacity);
                // pixels the mask leaves alone keep their stored bytes exactly
                for (int i = 0; i < n; i++) {
                    if (mask && mask[i] == 0) continue;
                    fromFloats(format, true, dstF + i * 4, dst + size_t(i) * size, 1);
                }
            }

            if (!allChannels) {
                // a locked channel keeps its bytes; where the pixel was fully transparent its colour was hidden, so a
                // locked colour channel is zeroed, as Krita's own ops do, and never shows through the new alpha
                static const quint8 zero[4] = {0, 0, 0, 0};
                for (int i = 0; i < n; i++) {
                    const quint8 *was = kept + size_t(i) * size;
                    const bool wasTransparent = std::memcmp(was + 3 * channelBytes, zero, channelBytes) == 0;
                    for (int c = 0; c < 4; c++) {
                        if (c < params.channelFlags.size() && params.channelFlags.testBit(c)) continue;
                        std::memcpy(dst + size_t(i) * size + c * channelBytes, (wasTransparent && c < 3) ? zero : was + c * channelBytes, channelBytes);
                    }
                }
            }
        }
        if (!oneColour) srcRow += params.srcRowStride;
        dstRow += params.dstRowStride;
        if (maskRow) maskRow += params.maskRowStride;
    }
}
