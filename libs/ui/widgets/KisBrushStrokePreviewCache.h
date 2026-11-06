/*
 *  SPDX-FileCopyrightText: 2026 Tenzin Rangdol <tenzindraws@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Ported from Krita-Revamp (10zindraws / Tenzin Rangdol, GPL-3.0), final form of commits 26851a8, a9698ce, 681ef9f.
 * See AGENT-FORK.md, "Ported from Krita-Revamp: stroke previews".
 */

#ifndef KIS_BRUSH_STROKE_PREVIEW_CACHE_H
#define KIS_BRUSH_STROKE_PREVIEW_CACHE_H

#include <QColor>
#include <QImage>
#include <QModelIndex>
#include <QObject>
#include <QScopedPointer>
#include <QSize>
#include <QString>

#include <functional>

#include <kis_paintop_preset.h>
#include <kritaui_export.h>

/**
 * Each brush preset painting the same stroke, for the Strokes view of the brush chooser. GUI thread only.
 *
 * A preview is stored as one coverage mask (Grayscale8: 0 is no paint, 255 is full paint), painted once in white on a
 * throw-away surface and tinted when it is drawn, so one set serves every theme (AGENT-FORK.md says how this was
 * decided). The disk holds a PNG per preset state, named after what it shows:
 *   <resource id>_<MD5 of the saved preset>.png            the preset as saved
 *   <resource id>_<MD5>_<hash of its settings>.png         the preset with tweaks in memory
 * so a changed preset simply has no preview yet, and the tweaked and saved forms do not overwrite each other.
 *
 * Krita Agent changes to Revamp's version:
 *  - The folder comes from KisAppIdentity (cacheLocation()), never stock Krita's.
 *  - Generation is one preview at a time, one worker thread, only while everything is idle: see
 *    KisBrushStrokePreviewGenerator. Revamp ran up to three at start-up, whatever else was happening.
 *  - No window's resource provider and no view of the preset editor is needed: the generator has its own.
 *  - An engine with no preview, or a preset that paints nothing, gets a mark on disk (a 1x1 mask) and preview() returns a
 *    null image: the caller shows the preset's thumbnail. Revamp drew the words "No Preview" and "Loading...".
 */
class KRITAUI_EXPORT KisBrushStrokePreviewCache : public QObject
{
    Q_OBJECT

public:
    /// The application's cache, in defaultFolder(). It lives until the process ends; generation stops on aboutToQuit.
    static KisBrushStrokePreviewCache *instance();

    /// KisAppIdentity::cacheLocation() + "/brush_stroke_previews".
    static QString defaultFolder();

    /// A cache of its own in \p folder (tests).
    explicit KisBrushStrokePreviewCache(const QString &folder, QObject *parent = nullptr);
    ~KisBrushStrokePreviewCache() override;

    QString folder() const;

    /// True for engines that show on stripes (colorsmudge, deform, filter): their mask is what changed on the stripes.
    static bool needsStripedBackground(const QString &paintOpId);

    /// True for engines the preview cannot paint (as upstream's live preview: quick brush, experiment, clone).
    static bool isNoPreviewEngine(const QString &paintOpId);

    /// The mask of a white stroke on nothing: its alpha.
    static QImage maskFromStroke(const QImage &painted);

    /// The mask of a stroke on \p reference: how much each pixel moved from it, strongly amplified so a smudge that only
    /// shifts the stripes still reads.
    static QImage maskFromDifference(const QImage &reference, const QImage &painted);

    /// A faint mask made readable: the strongest paint (a few stray pixels aside) is lifted to near full, by at most three
    /// times. On the contact sheet low-flow presets (watercolours, stamps) were otherwise close to invisible on either theme.
    static QImage liftFaintMask(const QImage &mask);

    /// True when a mask (after liftFaintMask()) shows a stroke one can see: some 120 clearly painted pixels. Fewer, as with
    /// presets that barely mark an empty surface, leave a cell that looks empty: the caller shows the thumbnail instead.
    static bool hasVisibleStroke(const QImage &mask);

    /// \p mask tinted with \p tint, keeping its aspect inside \p size, with \p size's pixel count (ARGB32 premultiplied).
    static QImage renderMask(const QImage &mask, const QSize &size, const QColor &tint);

    /// The name of the preset's present state (see the class comment), without the folder and extension.
    static QString keyFor(KisPaintOpPresetSP preset);

    /// True when the disk or memory holds a result for the preset's present state.
    bool hasPreview(KisPaintOpPresetSP preset) const;

    /// True when the preset's present state was found to have nothing to show (see the class comment).
    bool hasNoPreview(KisPaintOpPresetSP preset) const;

    /**
     * The preset's preview in \p tint, at most \p size pixels. A preset without one yet is queued, and the last preview
     * of that preset stands in until the new one is ready (sigPreviewReady). Null: nothing to show yet, or ever.
     */
    QImage preview(KisPaintOpPresetSP preset, const QSize &size, const QColor &tint);

    /// The same for a row of a resource model, without loading the preset unless it has tweaks in memory.
    QImage previewForIndex(const QModelIndex &index, const QSize &size, const QColor &tint);

    /// Queue the preset's preview, unless it has one. It is painted when everything is idle.
    void request(KisPaintOpPresetSP preset);

    /// Queue every active preset that has no preview, now and when presets are added. Loads nothing yet.
    void requestAll();

    /// Forget the preset's previews, from memory and disk.
    void invalidatePreset(int resourceId);

    /// Stop generating for good (the application is quitting): no stroke runs after this.
    void shutdown();

    /// Previews waiting to be painted, the one being painted included.
    int pendingCount() const;

    /// Previews painted by this cache, and how long the last took (ms).
    int generatedCount() const;
    int lastGenerationMs() const;

    /// True while the generator holds back. By default: an agent works, or any open image is not idle.
    bool isPaused() const;

    /// Tests: what counts as busy (the default is KisBrushStrokePreviewGenerator::systemIsBusy), how long everything must
    /// have been idle before a preview starts, and the rest between two previews.
    void setBusyProbeForTesting(const std::function<bool()> &probe);
    void setTimingForTesting(int quietMs, int gapMs);

Q_SIGNALS:
    /// A preset's preview was painted or found to be missing: repaint its row.
    void sigPreviewReady(int resourceId);

private Q_SLOTS:
    void slotRequestAllNow();

private:
    friend class KisBrushStrokePreviewGenerator;
    /// The generator's result for \p key. A null \p mask marks nothing to show.
    void storePreview(int resourceId, const QString &key, const QImage &mask);
    bool isKnown(const QString &key) const;

    struct Private;
    const QScopedPointer<Private> m_d;
};

#endif // KIS_BRUSH_STROKE_PREVIEW_CACHE_H
