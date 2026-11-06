/*
 *  SPDX-FileCopyrightText: 2026 Tenzin Rangdol <tenzindraws@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Ported from Krita-Revamp (10zindraws / Tenzin Rangdol, GPL-3.0), final form of commits 26851a8, a9698ce, 681ef9f.
 * See AGENT-FORK.md, "Ported from Krita-Revamp: stroke previews".
 */

#ifndef KIS_BRUSH_STROKE_PREVIEW_GENERATOR_H
#define KIS_BRUSH_STROKE_PREVIEW_GENERATOR_H

#include <QElapsedTimer>
#include <QImage>
#include <QList>
#include <QObject>
#include <QScopedPointer>
#include <QString>
#include <QTimer>

#include <functional>

#include <kis_paintop_preset.h>
#include <kritaui_export.h>

class KisBrushStrokePreviewCache;
class KisPresetLivePreviewView;
class KoCanvasResourceProvider;

/**
 * Paints the queued previews through KisPresetLivePreviewView: the real stroke engine on a throw-away image, so nothing
 * goes near an open document and libs/image is unchanged.
 *
 * It must never compete with a paint pass. So there is one view, whose image has one worker thread, and one preview at a
 * time; each starts only when the busy probe has been false for the whole quiet period, and is checked again before the
 * next one. What can overlap a pass that starts during a preview is the rest of that one preview, on one thread.
 */
class KRITAUI_EXPORT KisBrushStrokePreviewGenerator : public QObject
{
    Q_OBJECT

public:
    explicit KisBrushStrokePreviewGenerator(KisBrushStrokePreviewCache *cache);
    ~KisBrushStrokePreviewGenerator() override;

    /// Queue a preset by id (loaded when its turn comes, unless \p preset is given). A queued id is not queued twice;
    /// \p first moves it to the front, for what is on screen now.
    void enqueue(int resourceId, KisPaintOpPresetSP preset, bool first);

    /// No stroke runs after this, and the view is gone.
    void shutdown();

    int pendingCount() const;
    int generatedCount() const;
    int lastGenerationMs() const;
    bool isPaused() const;

    void setBusyProbe(const std::function<bool()> &probe);
    void setTiming(int quietMs, int gapMs);

    /// An agent works on any document (KisAgentHooks::agentWorkOpen(), what libkis's Document.agentActive() reads), or any
    /// open document's image has strokes, updates or a lock open.
    static bool systemIsBusy();

private Q_SLOTS:
    void slotTick();
    void slotPreviewGenerated(int resourceId, const QImage &mask);

private:
    struct Item {
        int resourceId {-1};
        KisPaintOpPresetSP preset;
    };

    void schedule(int delayMs);
    void ensureView();

    KisBrushStrokePreviewCache *m_cache {nullptr};
    QScopedPointer<KoCanvasResourceProvider> m_resources;
    QScopedPointer<KisPresetLivePreviewView> m_view;
    QTimer m_timer;
    QElapsedTimer m_sinceBusy;
    QElapsedTimer m_running;
    std::function<bool()> m_busyProbe;
    QList<Item> m_queue;
    int m_runningId {-1};
    QString m_runningKey;
    int m_quietMs {3000};
    int m_gapMs {100};
    int m_generated {0};
    int m_lastMs {0};
    bool m_paused {false};
    bool m_closed {false};
};

#endif // KIS_BRUSH_STROKE_PREVIEW_GENERATOR_H
