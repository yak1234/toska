/*
 *  SPDX-FileCopyrightText: 2026 Tenzin Rangdol <tenzindraws@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Ported from Krita-Revamp (10zindraws / Tenzin Rangdol, GPL-3.0), final form of commits 26851a8, a9698ce, 681ef9f.
 * See AGENT-FORK.md, "Ported from Krita-Revamp: stroke previews".
 */

#include "KisBrushStrokePreviewGenerator.h"

#include <KoCanvasResourceProvider.h>
#include <KoCanvasResourcesIds.h>
#include <KoColor.h>
#include <KoColorSpaceRegistry.h>
#include <KoCompositeOpRegistry.h>
#include <KisAgentHooks.h>
#include <KisDocument.h>
#include <KisPart.h>
#include <KisResourceModel.h>
#include <KisResourceTypes.h>
#include <kis_image.h>
#include <resources/KoPattern.h>
#include <resources/KoSegmentGradient.h>

#include "KisBrushStrokePreviewCache.h"
#include "kis_preset_live_preview_view.h"

namespace {

// The surface every preset paints on. The cell shows at most about 200 x 60 points, at twice that on a high-density screen.
constexpr int kSurfaceWidth = 480;
constexpr int kSurfaceHeight = 160;

// How often the probe is asked while something is busy.
constexpr int kBusyPollMs = 500;

} // namespace

KisBrushStrokePreviewGenerator::KisBrushStrokePreviewGenerator(KisBrushStrokePreviewCache *cache)
    : QObject(cache)
    , m_cache(cache)
    , m_busyProbe(&KisBrushStrokePreviewGenerator::systemIsBusy)
{
    // Quiet from the start: nothing is painted in the first moments of a session, when everything is still loading.
    m_sinceBusy.start();
    m_timer.setSingleShot(true);
    connect(&m_timer, &QTimer::timeout, this, &KisBrushStrokePreviewGenerator::slotTick);
}

KisBrushStrokePreviewGenerator::~KisBrushStrokePreviewGenerator()
{
    shutdown();
}

bool KisBrushStrokePreviewGenerator::systemIsBusy()
{
    if (KisAgentHooks::agentWorkOpen()) return true;
    const QList<QPointer<KisDocument>> documents = KisPart::instance()->documents();
    for (const QPointer<KisDocument> &document : documents) {
        if (!document) continue;
        KisImageSP image = document->image();
        // Cheap when busy: the queues are looked at first, and the barrier is tried only when they are empty.
        if (image && !image->isIdle(false)) return true;
    }
    return false;
}

void KisBrushStrokePreviewGenerator::enqueue(int resourceId, KisPaintOpPresetSP preset, bool first)
{
    if (m_closed || resourceId < 0) return;
    for (int i = 0; i < m_queue.size(); i++) {
        if (m_queue[i].resourceId != resourceId) continue;
        if (preset) m_queue[i].preset = preset;
        if (first && i > 0) m_queue.move(i, 0);
        schedule(0);
        return;
    }
    Item item;
    item.resourceId = resourceId;
    item.preset = preset;
    if (first) {
        m_queue.prepend(item);
    } else {
        m_queue.append(item);
    }
    schedule(0);
}

void KisBrushStrokePreviewGenerator::schedule(int delayMs)
{
    if (m_closed || m_runningId >= 0) return;
    // Never bring a waiting tick forward: a tick starts the wait over, and a chooser's repaint asks every time.
    if (m_timer.isActive()) return;
    m_timer.start(delayMs);
}

void KisBrushStrokePreviewGenerator::ensureView()
{
    if (m_view) return;

    // The stroke engine asks a canvas's resources. These are the generator's own, so a preview depends on no window, and
    // neither the artist's colour nor pattern nor gradient shows in it. KisResourcesSnapshot reads them; the view overrides
    // the colour, and the preset brings its own opacity.
    m_resources.reset(new KoCanvasResourceProvider());
    const KoColorSpace *colorSpace = KoColorSpaceRegistry::instance()->rgb8();
    m_resources->setForegroundColor(KoColor(Qt::white, colorSpace));
    m_resources->setBackgroundColor(KoColor(Qt::black, colorSpace));
    m_resources->setResource(KoCanvasResource::CurrentEffectiveCompositeOp, QString(COMPOSITE_OVER));
    m_resources->setResource(KoCanvasResource::Opacity, 1.0);
    m_resources->setResource(KoCanvasResource::EffectiveZoom, 1.0);
    QImage patternImage(8, 8, QImage::Format_ARGB32);
    patternImage.fill(Qt::white);
    KoPatternSP pattern(new KoPattern(patternImage, QStringLiteral("stroke preview"), QString()));
    m_resources->setResource(KoCanvasResource::CurrentPattern, QVariant::fromValue(pattern));
    QSharedPointer<KoSegmentGradient> gradient(new KoSegmentGradient(QString()));
    gradient->createSegment(INTERP_LINEAR, COLOR_INTERP_RGB, 0.0, 1.0, 0.5, Qt::white, Qt::black);
    gradient->setValid(true);
    m_resources->setResource(KoCanvasResource::CurrentGradient,
                             QVariant::fromValue(KoAbstractGradientSP(gradient)));

    m_view.reset(new KisPresetLivePreviewView(nullptr));
    m_view->resize(kSurfaceWidth, kSurfaceHeight);
    m_view->setup(m_resources.data());
    m_view->setCachePreviewMode(true);
    connect(m_view.data(), &KisPresetLivePreviewView::sigPreviewImageReady, this,
            &KisBrushStrokePreviewGenerator::slotPreviewGenerated);
}

void KisBrushStrokePreviewGenerator::slotTick()
{
    if (m_closed || m_runningId >= 0 || m_queue.isEmpty()) {
        m_paused = false;
        return;
    }

    if (m_busyProbe && m_busyProbe()) {
        m_paused = true;
        m_sinceBusy.start();
        m_timer.start(kBusyPollMs);
        return;
    }
    if (m_sinceBusy.isValid() && m_sinceBusy.elapsed() < m_quietMs) {
        m_paused = true;
        m_timer.start(qMin<qint64>(kBusyPollMs, m_quietMs - m_sinceBusy.elapsed() + 1));
        return;
    }
    m_paused = false;

    // The first in the queue that still lacks a preview.
    while (!m_queue.isEmpty()) {
        const Item item = m_queue.takeFirst();
        KisPaintOpPresetSP preset = item.preset;
        if (!preset) {
            KisResourceModel model(ResourceType::PaintOpPresets);
            preset = model.resourceForId(item.resourceId).dynamicCast<KisPaintOpPreset>();
        }
        if (!preset || !preset->valid() || m_cache->hasPreview(preset)) continue;

        const QString key = KisBrushStrokePreviewCache::keyFor(preset);
        if (KisBrushStrokePreviewCache::isNoPreviewEngine(preset->paintOp().id())) {
            m_cache->storePreview(item.resourceId, key, QImage());
            continue;
        }

        ensureView();
        m_runningId = item.resourceId;
        m_runningKey = key;
        m_running.start();
        m_view->setCurrentPreset(preset);
        m_view->requestUpdateStrokeImmediate();
        return;
    }
}

void KisBrushStrokePreviewGenerator::slotPreviewGenerated(int resourceId, const QImage &mask)
{
    if (resourceId != m_runningId) return;
    const QString key = m_runningKey;
    m_runningId = -1;
    m_runningKey.clear();
    m_lastMs = int(m_running.elapsed());
    m_generated++;

    // A preset that painted (next to) nothing is a preset with nothing to show.
    const QImage lifted = KisBrushStrokePreviewCache::liftFaintMask(mask);
    m_cache->storePreview(resourceId, key, KisBrushStrokePreviewCache::hasVisibleStroke(lifted) ? lifted : QImage());

    if (!m_queue.isEmpty()) schedule(m_gapMs);
}

void KisBrushStrokePreviewGenerator::shutdown()
{
    m_closed = true;
    m_timer.stop();
    m_queue.clear();
    m_runningId = -1;
    m_view.reset();
    m_resources.reset();
}

int KisBrushStrokePreviewGenerator::pendingCount() const
{
    return m_queue.size() + (m_runningId >= 0 ? 1 : 0);
}

int KisBrushStrokePreviewGenerator::generatedCount() const
{
    return m_generated;
}

int KisBrushStrokePreviewGenerator::lastGenerationMs() const
{
    return m_lastMs;
}

bool KisBrushStrokePreviewGenerator::isPaused() const
{
    return m_paused;
}

void KisBrushStrokePreviewGenerator::setBusyProbe(const std::function<bool()> &probe)
{
    m_busyProbe = probe;
}

void KisBrushStrokePreviewGenerator::setTiming(int quietMs, int gapMs)
{
    m_quietMs = quietMs;
    m_gapMs = gapMs;
}
