/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: LGPL-2.0-or-later
 */
#include "TestStrokeJobs.h"

#include <testui.h>
#include <KisTemporaryHomeUiTest.h>
#include <simpletest.h>

#include <QAtomicInt>
#include <QElapsedTimer>
#include <QFile>
#include <QImage>
#include <QPointer>
#include <QScopedPointer>
#include <QSemaphore>
#include <QSignalSpy>
#include <QTimer>

#include <Document.h>
#include <Node.h>
#include <Selection.h>
#include <StrokeJob.h>
#include <StrokeJobBrush.h>
#include <Preset.h>
#include <Resource.h>
#include <DocumentChanges.h>

#include <QThread>
#include <atomic>

#include <KisDocument.h>
#include <KisGlobalResourcesInterface.h>
#include <KisPaintOpPresetSessionStorage.h>
#include <KisPart.h>
#include <KisResourceTypes.h>
#include <KoColor.h>
#include <KoColorSpaceRegistry.h>
#include <KoCompositeOpRegistry.h>
#include <brushengine/kis_paintop_preset.h>
#include <brushengine/kis_paintop_registry.h>
#include <KisResourceModel.h>
#include <KoResourcePaths.h>
#include <brushengine/kis_paintop_settings.h>
#include <kis_image.h>
#include <kis_paint_device.h>
#include <kis_paint_layer.h>
#include <kis_painter.h>
#include <QCryptographicHash>
#include <QScopeGuard>
#include <kis_image_config.h>
#include <KisImageConfigNotifier.h>
#include <KisLodPreferences.h>
#include <kis_group_layer.h>
#include <kis_simple_stroke_strategy.h>
#include <kundo2stack.h>

namespace {

/**
 * A document registered with KisPart, as Krita's own are (so it has an undo history for scripts), with one empty paint
 * layer "paint", and its libkis wrappers. No main window or view exists in this test: every job paints without one.
 */
struct JobDocument {
    QPointer<KisDocument> kisdoc;
    KisImageSP image;
    KisNodeSP layer;
    QScopedPointer<Document> doc;
    QScopedPointer<Node> paint;

    explicit JobDocument(int width = 200, int height = 100)
    {
        kisdoc = KisPart::instance()->createDocument();
        image = new KisImage(0, width, height, KoColorSpaceRegistry::instance()->rgb8(), "jobs");
        layer = new KisPaintLayer(image, "paint", OPACITY_OPAQUE_U8);
        image->addNode(layer);
        kisdoc->setCurrentImage(image);
        KisPart::instance()->addDocument(kisdoc, false);
        doc.reset(new Document(kisdoc, false));
        paint.reset(doc->nodeByName("paint"));
        image->waitForDone();
        kisdoc->undoStack()->clear();
    }

    ~JobDocument()
    {
        paint.reset();
        doc.reset();
        if (image) image->waitForDone();
        QCoreApplication::processEvents();
        if (kisdoc) {
            KisPart::instance()->removeDocument(kisdoc, false);
            delete kisdoc;
        }
    }

    /// The layer's alpha, one byte per pixel, as an 8-bit image of the whole canvas.
    QImage alpha() const
    {
        const QImage rgba = layer->paintDevice()->convertToQImage(nullptr, 0, 0, image->width(), image->height());
        QImage out(rgba.size(), QImage::Format_Grayscale8);
        for (int y = 0; y < rgba.height(); y++) {
            const QRgb *in = reinterpret_cast<const QRgb *>(rgba.constScanLine(y));
            uchar *line = out.scanLine(y);
            for (int x = 0; x < rgba.width(); x++) line[x] = uchar(qAlpha(in[x]));
        }
        return out;
    }
};

/// Painted pixels (alpha above \p threshold) in column \p x of \p alpha.
int columnCount(const QImage &alpha, int x, int threshold = 32)
{
    int count = 0;
    for (int y = 0; y < alpha.height(); y++) count += alpha.constScanLine(y)[x] > threshold ? 1 : 0;
    return count;
}

/// Painted pixels in \p rect of \p alpha.
int areaCount(const QImage &alpha, const QRect &rect, int threshold = 32)
{
    int count = 0;
    const QRect clipped = rect & alpha.rect();
    for (int y = clipped.top(); y <= clipped.bottom(); y++) {
        for (int x = clipped.left(); x <= clipped.right(); x++) count += alpha.constScanLine(y)[x] > threshold ? 1 : 0;
    }
    return count;
}

/**
 * The name of one of Krita's own presets as the resource database holds it (the bundle's files use underscores
 * where Krita shows spaces), or an empty string.
 */
QString presetName(const QString &shown)
{
    for (const QString &name : {shown, QString(shown).replace(' ', '_')}) {
        KoResourceSP found = KisGlobalResourcesInterface::instance()->source(ResourceType::PaintOpPresets)
                                 .bestMatch(QString(), QString(), name);
        if (found && found->valid()) return name;
    }
    return QString();
}

/// A preset of Krita's that paints round, plain dabs whose size follows pressure.
QString pressurePreset()
{
    return presetName("b) Basic-5 Size");
}

/// A stroke along \p points ([x, y, pressure...] each), in \p color with \p size.
QVariantMap line(const QList<QVariantList> &points, double size = 20, const QString &color = "#000000")
{
    QVariantList list;
    for (const QVariantList &point : points) list << QVariant(point);
    return QVariantMap{{"points", list}, {"size", size}, {"color", color}};
}

/// \p count short horizontal strokes, one per row band, inside \p area.
QVariantList rows(int count, const QRect &area, double size = 4)
{
    QVariantList strokes;
    for (int i = 0; i < count; i++) {
        const double y = area.top() + (i % qMax(1, area.height())) + 0.5;
        strokes << line({{area.left() + 2, y}, {area.right() - 2, y}}, size);
    }
    return strokes;
}

/// Waits for \p job without blocking the event loop, for at most \p ms.
bool settle(StrokeJob *job, int ms = 20000)
{
    QElapsedTimer clock;
    clock.start();
    while (!job->wait(10)) {
        QCoreApplication::processEvents();
        if (clock.elapsed() > ms) return false;
    }
    QCoreApplication::processEvents();
    return true;
}

struct GateState {
    QSemaphore open;
    QAtomicInt entered;
};

/// A stroke that holds Krita's stroke queue (an exclusive job) until released: work that keeps Krita busy.
class GateStroke : public KisSimpleStrokeStrategy
{
public:
    explicit GateStroke(QSharedPointer<GateState> state)
        : KisSimpleStrokeStrategy(QLatin1String("test-gate"))
        , m_state(state)
    {
        enableJob(JOB_INIT, true, KisStrokeJobData::BARRIER, KisStrokeJobData::EXCLUSIVE);
    }

    void initStrokeCallback() override
    {
        m_state->entered.ref();
        m_state->open.tryAcquire(1, 30000); // never hangs the test run
    }

private:
    QSharedPointer<GateState> m_state; // shared: a failed check never leaves the stroke on a destroyed semaphore
};

/// Holds \p image's stroke queue from here until release() or the end of the scope, whichever comes first.
class Gate
{
public:
    explicit Gate(KisImageSP image)
        : m_state(new GateState())
    {
        KisStrokeId gate = image->startStroke(new GateStroke(m_state));
        image->endStroke(gate);
    }
    ~Gate()
    {
        release();
    }
    void release()
    {
        if (m_released) return;
        m_released = true;
        m_state->open.release();
    }
    bool released() const
    {
        return m_released;
    }
    int entered() const
    {
        return m_state->entered.loadAcquire();
    }

private:
    QSharedPointer<GateState> m_state;
    bool m_released = false;
};

/// The artist's stroke: records how many strokes \p job had painted when it ran.
class ArtistStroke : public KisSimpleStrokeStrategy
{
public:
    ArtistStroke(StrokeJob *job, QSharedPointer<QAtomicInt> doneWhenRun)
        : KisSimpleStrokeStrategy(QLatin1String("test-artist"))
        , m_job(job)
        , m_doneWhenRun(doneWhenRun)
    {
        enableJob(JOB_INIT, true, KisStrokeJobData::SEQUENTIAL, KisStrokeJobData::EXCLUSIVE);
    }

    void initStrokeCallback() override
    {
        m_doneWhenRun->storeRelease(m_job->strokesDone());
    }

private:
    StrokeJob *m_job;
    QSharedPointer<QAtomicInt> m_doneWhenRun;
};

} // namespace

void TestStrokeJobs::testPaintsWithoutAView()
{
    const QString preset = pressurePreset();
    QVERIFY2(!preset.isEmpty(), "Krita's preset b) Basic-5 Size is in the resource database");
    JobDocument d;
    QVERIFY(d.paint);
    QVERIFY(!KisPart::instance()->currentMainwindow());

    QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line({{20, 50}, {180, 50}})}, {{"preset", preset}}));
    QVERIFY(job);
    QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    QCOMPARE(job->strokesDone(), 1);
    QCOMPARE(job->strokesTotal(), 1);
    QCOMPARE(job->progress(), 1.0);
    QVERIFY(columnCount(d.alpha(), 100) > 10);
}

void TestStrokeJobs::testRefusesCleanly()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    QVERIFY(d.paint);
    const QVariantList one = {line({{20, 50}, {180, 50}})};

    auto refused = [] (StrokeJob *raw, const QString &why) {
        QScopedPointer<StrokeJob> job(raw);
        if (!job) return QString("no job");
        if (job->state() != "failed") return QString("state %1").arg(job->state());
        if (!job->errorString().contains(why)) return QString("error \"%1\"").arg(job->errorString());
        if (!job->wait(0)) return QString("a failed job has not ended");
        return QString();
    };

    // No preset and no view to take one from.
    QCOMPARE(refused(d.paint->paintStrokes(one), "no active view"), QString());
    QCOMPARE(refused(d.paint->paintStrokes(one, {{"preset", "no such preset 2.4"}}), "no brush preset"), QString());
    QCOMPARE(refused(d.paint->paintStrokes(one, {{"preset", preset}, {"compositeOp", "no-such-op"}}), "blending mode"),
             QString());
    QCOMPARE(refused(d.paint->paintStrokes({QVariantMap{{"color", "#ff0000"}}}, {{"preset", preset}}), "stroke 0"),
             QString());
    QCOMPARE(refused(d.paint->paintStrokes({line({{1, 2}}), QVariantMap{{"points", QVariantList{QVariant(QVariantList{1})}}}},
                                           {{"preset", preset}}),
                     "stroke 1"),
             QString());
    QCOMPARE(refused(d.paint->paintStrokes({QVariantMap{{"points", QVariantList{QVariant(QVariantList{1, 2})}}, {"color", "not a colour"}}},
                                           {{"preset", preset}}),
                     "colour"),
             QString());

    // A group has no pixels of its own; a locked layer is not painted.
    d.image->addNode(new KisGroupLayer(d.image, "group", OPACITY_OPAQUE_U8));
    d.image->waitForDone();
    QScopedPointer<Node> group(d.doc->nodeByName("group"));
    QVERIFY(group);
    QCOMPARE(refused(group->paintStrokes(one, {{"preset", preset}}), "no pixels"), QString());
    d.layer->setUserLocked(true);
    QCOMPARE(refused(d.paint->paintStrokes(one, {{"preset", preset}}), "locked"), QString());
    d.layer->setUserLocked(false);

    // Nothing was painted or added to the history.
    d.image->waitForDone();
    QCOMPARE(d.layer->paintDevice()->exactBounds(), QRect());
    QCOMPARE(d.kisdoc->undoStack()->count(), 0);

    // An empty job is done at once.
    QScopedPointer<StrokeJob> empty(d.paint->paintStrokes({}, {{"preset", preset}}));
    QVERIFY(empty);
    QCOMPARE(empty->state(), QString("done"));
    QCOMPARE(empty->strokesTotal(), 0);
}

void TestStrokeJobs::testPressureTapers()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    QVERIFY(d.paint);
    // Pressure 0.1 at both ends and 1 in the middle, with a 40 px brush.
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(
        {line({{20, 50, 0.1}, {100, 50, 1.0}, {180, 50, 0.1}}, 40)}, {{"preset", preset}}));
    QVERIFY(job);
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    const QImage alpha = d.alpha();
    const int start = columnCount(alpha, 24), middle = columnCount(alpha, 100), end = columnCount(alpha, 176);
    QVERIFY2(middle >= 30, qPrintable(QString("middle %1 px").arg(middle)));
    QVERIFY2(start > 0 && start * 3 < middle, qPrintable(QString("start %1 px, middle %2 px").arg(start).arg(middle)));
    QVERIFY2(end > 0 && end * 3 < middle, qPrintable(QString("end %1 px, middle %2 px").arg(end).arg(middle)));

    // Without pressure the same stroke keeps one width.
    JobDocument flat;
    QScopedPointer<StrokeJob> even(flat.paint->paintStrokes({line({{20, 50}, {100, 50}, {180, 50}}, 40)}, {{"preset", preset}}));
    QVERIFY(settle(even.data()));
    const QImage flatAlpha = flat.alpha();
    QVERIFY(qAbs(columnCount(flatAlpha, 24) - columnCount(flatAlpha, 100)) <= 2);
}

namespace {

/// The painted pixels of one horizontal stroke with \p preset, at pen input \p pen for every point ([pressure,
/// xTilt, yTilt, rotation, speed, timeMs]), on a fresh layer.
int footprint(const QString &preset, const QVariantList &pen, double size, QString *error)
{
    JobDocument d(300, 160);
    QList<QVariantList> points;
    for (int i = 0; i <= 10; i++) points << (QVariantList{40 + 22 * i, 80} + pen);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line(points, size)}, {{"preset", preset}}));
    if (!job || !settle(job.data()) || job->state() != "done") {
        *error = job ? job->state() + ": " + job->errorString() : QString("no job");
        return -1;
    }
    return areaCount(d.alpha(), QRect(60, 0, 180, 160));
}

} // namespace

void TestStrokeJobs::testTiltWidensATiltPreset()
{
    // The helper's probe (task 0.5): tilt widens c) Pencil-5 Tilted from 2 to 9 px over 0 to 60 degrees.
    const QString preset = presetName("c) Pencil-5 Tilted");
    QVERIFY2(!preset.isEmpty(), "Krita's preset c) Pencil-5 Tilted is in the resource database");
    QString error;
    const int upright = footprint(preset, {1.0, 0.0, 0.0}, 10, &error);
    QVERIFY2(upright > 0, qPrintable(error));
    const int tilted = footprint(preset, {1.0, 60.0, 0.0}, 10, &error);
    QVERIFY2(tilted > 0, qPrintable(error));
    QVERIFY2(tilted > upright * 1.5, qPrintable(QString("upright %1 px, tilted %2 px").arg(upright).arg(tilted)));
}

void TestStrokeJobs::testSpeedThinsASpeedPreset()
{
    // The helper's probe (task 0.5): speed thins d) Ink-1 Precision from 48 to 28 px.
    const QString preset = presetName("d) Ink-1 Precision");
    QVERIFY2(!preset.isEmpty(), "Krita's preset d) Ink-1 Precision is in the resource database");
    QString error;
    const int slow = footprint(preset, {1.0, 0.0, 0.0, 0.0, 0.0}, 40, &error);
    QVERIFY2(slow > 0, qPrintable(error));
    const int fast = footprint(preset, {1.0, 0.0, 0.0, 0.0, 1.0}, 40, &error);
    QVERIFY2(fast > 0, qPrintable(error));
    QVERIFY2(fast * 1.2 < slow, qPrintable(QString("slow %1 px, fast %2 px").arg(slow).arg(fast)));
}

void TestStrokeJobs::testCubicSegmentsAndPerPointLists()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    // The plugin's paint_pass form: a start, cubic segments, and pressure as a per-point list.
    JobDocument d;
    const QVariantMap curve{{"start", QVariantList{20, 50}},
                            {"segments", QVariantList{QVariant(QVariantList{60, 10, 140, 90, 180, 50})}},
                            {"pressure", QVariantList{0.1, 1.0}},
                            {"size", 30}, {"color", "#ff0000"}, {"opacity", 1.0}};
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes({curve}, {{"preset", preset}}));
    QVERIFY(job);
    QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
    QVERIFY(settle(job.data()));
    const QImage alpha = d.alpha();
    QVERIFY(columnCount(alpha, 24) < columnCount(alpha, 170));
    // The curve bends: above the straight line near its first quarter (t = 0.25: x 56, y 39), below it near its
    // third (t = 0.75: x 144, y 61).
    QVERIFY(areaCount(alpha, QRect(50, 28, 12, 14)) > 0);
    QCOMPARE(areaCount(alpha, QRect(50, 52, 12, 20)), 0);
    QVERIFY(areaCount(alpha, QRect(138, 62, 12, 8)) > 0);
    QCOMPARE(areaCount(alpha, QRect(138, 15, 12, 15)), 0);
    const QImage rgba = d.layer->paintDevice()->convertToQImage(nullptr, 0, 0, 200, 100);
    QVERIFY(qRed(rgba.pixel(176, 50)) > 200 && qGreen(rgba.pixel(176, 50)) < 60);

    // A list shorter than the points is refused.
    QVariantMap shortList = curve;
    shortList["pressure"] = QVariantList{0.5};
    QScopedPointer<StrokeJob> refused(d.paint->paintStrokes({shortList}, {{"preset", preset}}));
    QCOMPARE(refused->state(), QString("failed"));
    QVERIFY(refused->errorString().contains("pressure"));
}

void TestStrokeJobs::testChangedRectAndSignals()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line({{50, 40}, {120, 40}}, 10), line({{60, 70}, {80, 70}}, 10)},
                                                        {{"preset", preset}, {"name", "rect"}}));
    QVERIFY(job);
    QSignalSpy finished(job.data(), &StrokeJob::finished);
    QSignalSpy progress(job.data(), &StrokeJob::progressChanged);
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    QTRY_COMPARE(finished.count(), 1);
    QCOMPARE(finished.first().first().toString(), QString("done"));
    QVERIFY(progress.count() >= 1);
    QCOMPARE(progress.last().at(0).toInt(), 2);

    const QRect painted = d.layer->paintDevice()->exactBounds();
    QVERIFY(!painted.isEmpty());
    const QRect changed = job->changedRect();
    QVERIFY2(changed.contains(painted), qPrintable(QString("changed %1,%2 %3x%4").arg(changed.x()).arg(changed.y())
                                                       .arg(changed.width()).arg(changed.height())));
    QVERIFY(QRect(30, 20, 110, 70).contains(changed));

    const QVariantMap status = job->status();
    QCOMPARE(status.value("state").toString(), QString("done"));
    QCOMPARE(status.value("done").toInt(), 2);
    QCOMPARE(status.value("total").toInt(), 2);
    QCOMPARE(status.value("name").toString(), QString("rect"));
    QCOMPARE(status.value("rect").toList().size(), 4);

    // A later wait() does not emit finished again.
    QVERIFY(job->wait(0));
    QCoreApplication::processEvents();
    QCOMPARE(finished.count(), 1);
}

void TestStrokeJobs::testSelectionClipsOrNone()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    // The document's own selection never clips a job: none given paints everywhere.
    QScopedPointer<Selection> global(new Selection());
    global->select(0, 0, 10, 10, 255);
    d.doc->setSelection(global.data());
    d.image->waitForDone();
    QScopedPointer<StrokeJob> everywhere(d.paint->paintStrokes({line({{20, 30}, {180, 30}}, 10)}, {{"preset", preset}}));
    QVERIFY(settle(everywhere.data()));
    QVERIFY(columnCount(d.alpha(), 150) > 0);

    // A selection given clips the strokes to it.
    QScopedPointer<Selection> left(new Selection());
    left->select(0, 0, 100, 100, 255);
    QScopedPointer<StrokeJob> clipped(
        d.paint->paintStrokes({line({{20, 70}, {180, 70}}, 10)}, {{"preset", preset}}, left.data()));
    QVERIFY(settle(clipped.data()));
    const QImage alpha = d.alpha();
    QVERIFY(areaCount(alpha, QRect(20, 60, 70, 20)) > 0);
    QCOMPARE(areaCount(alpha, QRect(102, 60, 98, 20)), 0);
}

void TestStrokeJobs::testWaitIsPerJob()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(20, QRect(10, 10, 180, 40)), {{"preset", preset}}));
    QVERIFY(job);
    // Unrelated work queued after the job, which holds Krita until released: Document.waitForDone() would wait
    // for it, and so time out here.
    Gate gate(d.image);
    QElapsedTimer clock;
    clock.start();
    const bool waited = job->wait(15000);
    const qint64 waitedMs = clock.elapsed();
    const bool gateStillHolds = !gate.released(); // released only below
    gate.release();
    QVERIFY(waited);
    QVERIFY2(waitedMs < 10000, qPrintable(QString("wait() took %1 ms").arg(waitedMs)));
    QVERIFY(gateStillHolds);
    QCOMPARE(job->state(), QString("done"));
    QCOMPARE(job->strokesDone(), 20);
    d.image->waitForDone();
    QCOMPARE(gate.entered(), 1);
}

void TestStrokeJobs::testCancelLeavesAPrefix()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    const int count = 30;
    JobDocument d(20 * count + 20, 300);
    // One slow stroke per 20 px column, zigzagging down it: stroke i paints column i only.
    QVariantList strokes;
    for (int i = 0; i < count; i++) {
        QVariantList points;
        const double x = 10 + 20 * i + 10;
        for (int k = 0; k < 400; k++) points << QVariant(QVariantList{x + ((k % 2) ? 4 : -4), 10 + (k % 40) * 7});
        strokes << QVariantMap{{"points", points}, {"size", 8}};
    }
    Gate gate(d.image); // the job waits behind other work, then runs
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}, {"name", "columns"}}));
    QVERIFY(job);
    QCOMPARE(job->state(), QString("queued"));
    gate.release();
    QElapsedTimer clock;
    clock.start();
    while (job->strokesDone() < 3 && clock.elapsed() < 20000) QCoreApplication::processEvents();
    QVERIFY(job->cancel());
    QVERIFY(settle(job.data()));
    const int done = job->strokesDone();
    QVERIFY2(done >= 3 && done < count, qPrintable(QString("%1 strokes painted").arg(done)));
    QCOMPARE(job->state(), QString("cancelled"));
    QVERIFY(!job->cancel());

    d.image->waitForDone();
    const QImage alpha = d.alpha();
    for (int i = 0; i < count; i++) {
        const int painted = areaCount(alpha, QRect(10 + 20 * i + 2, 0, 16, 300));
        if (i < done) {
            QVERIFY2(painted > 100, qPrintable(QString("column %1 of the %2 painted is empty").arg(i).arg(done)));
        } else {
            QVERIFY2(painted == 0, qPrintable(QString("column %1 after the %2 painted has %3 px").arg(i).arg(done).arg(painted)));
        }
    }
    // The shorter pass is still one undo step, and undoing it clears it.
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 1);
    QCOMPARE(d.kisdoc->undoStack()->text(0), QString("columns"));
    d.kisdoc->undoStack()->undo();
    d.image->waitForDone();
    QCOMPARE(d.layer->paintDevice()->exactBounds(), QRect());
}

void TestStrokeJobs::testJobIsOneNamedUndoStep()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(50, QRect(10, 10, 180, 50)), {{"preset", preset}, {"name", "clouds"}}));
    QVERIFY(job);
    QCOMPARE(job->name(), QString("clouds"));
    QVERIFY(settle(job.data()));
    d.image->waitForDone();
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 1);
    QCOMPARE(d.kisdoc->undoStack()->text(0), QString("clouds"));
    d.kisdoc->undoStack()->undo();
    d.image->waitForDone();
    QCOMPARE(d.layer->paintDevice()->exactBounds(), QRect());
}

void TestStrokeJobs::testAgentMoveOf1400StrokesIsOneStep()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d(400, 300);
    // An artist step before the move stays in the history.
    QScopedPointer<StrokeJob> before(d.paint->paintStrokes({line({{5, 290}, {395, 290}}, 4)}, {{"preset", preset}, {"name", "earlier"}}));
    QVERIFY(settle(before.data()));
    d.image->waitForDone();
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 1);

    QVERIFY(d.doc->beginAgentMove("sky"));
    QList<StrokeJob *> jobs;
    int total = 0;
    for (int pass = 0; pass < 6; pass++) {
        const int strokes = pass < 5 ? 234 : 1400 - 5 * 234;
        jobs << d.paint->paintStrokes(rows(strokes, QRect(10, 10 + 45 * pass, 380, 40), 2), {{"preset", preset}});
        QVERIFY(jobs.last());
        QCOMPARE(jobs.last()->name(), QString("Agent: sky"));
        total += strokes;
    }
    QCOMPARE(total, 1400);
    QVERIFY(d.doc->endAgentMove());
    for (StrokeJob *job : jobs) {
        QVERIFY(settle(job, 60000));
        QCOMPARE(job->state(), QString("done"));
    }
    qDeleteAll(jobs);
    d.image->waitForDone();
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 2);
    QCOMPARE(d.kisdoc->undoStack()->text(1), QString("Agent: sky"));
    QCOMPARE(d.kisdoc->undoStack()->text(0), QString("earlier"));

    // One undo removes all six passes and leaves the earlier step.
    d.kisdoc->undoStack()->undo();
    d.image->waitForDone();
    QCOMPARE(areaCount(d.alpha(), QRect(0, 0, 400, 280)), 0);
    QVERIFY(areaCount(d.alpha(), QRect(0, 280, 400, 20)) > 0);
}

void TestStrokeJobs::testNothingLostWhenBusy()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d(400, 200);
    Gate gate(d.image); // Krita busy with other work
    QList<StrokeJob *> jobs;
    for (int i = 0; i < 5; i++) {
        jobs << d.paint->paintStrokes(rows(40, QRect(10 + 76 * i, 20, 70, 160), 3), {{"preset", preset}, {"name", QString("pass %1").arg(i)}});
        QVERIFY(jobs.last());
        QCOMPARE(jobs.last()->state(), QString("queued"));
        QCOMPARE(jobs.last()->wait(0), false);
    }
    gate.release();
    for (StrokeJob *job : jobs) {
        QVERIFY(settle(job));
        QCOMPARE(job->state(), QString("done"));
        QCOMPARE(job->strokesDone(), 40);
    }
    // A job started while the others run is not lost either.
    QScopedPointer<StrokeJob> late(d.paint->paintStrokes(rows(10, QRect(10, 185, 380, 10), 3), {{"preset", preset}}));
    QVERIFY(settle(late.data()));
    QCOMPARE(late->strokesDone(), 10);
    d.image->waitForDone();
    const QImage alpha = d.alpha();
    for (int i = 0; i < 5; i++) {
        QVERIFY2(areaCount(alpha, QRect(10 + 76 * i, 20, 70, 160)) > 40 * 30,
                 qPrintable(QString("pass %1 is missing pixels").arg(i)));
    }
    qDeleteAll(jobs);
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 6);
}

void TestStrokeJobs::testWindowRespondsWhileAJobPaints()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d(1600, 1200);
    QVariantList strokes;
    for (int i = 0; i < 60; i++) {
        QVariantList points;
        for (int k = 0; k < 20; k++) points << QVariant(QVariantList{40 + (k % 2) * 1500, 20 + i * 18 + k * 0.2});
        strokes << QVariantMap{{"points", points}, {"size", 60}};
    }
    QElapsedTimer call;
    call.start();
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}}));
    const qint64 callMs = call.elapsed();
    QVERIFY(job);
    QVERIFY2(callMs < 1000, qPrintable(QString("paintStrokes took %1 ms to return").arg(callMs)));

    // The event loop runs while the job paints: a 10 ms timer keeps firing until the job's finished signal.
    int ticks = 0, ticksWhileRunning = 0;
    qint64 longestGap = 0, last = 0;
    QElapsedTimer clock;
    clock.start();
    QTimer timer;
    QObject::connect(&timer, &QTimer::timeout, [&] () {
        const qint64 now = clock.elapsed();
        longestGap = qMax(longestGap, now - last);
        last = now;
        ticks++;
        if (job->state() == "running") ticksWhileRunning++;
    });
    QEventLoop loop;
    QObject::connect(job.data(), &StrokeJob::finished, &loop, &QEventLoop::quit);
    QTimer::singleShot(120000, &loop, &QEventLoop::quit);
    timer.start(10);
    loop.exec();
    timer.stop();
    QCOMPARE(job->state(), QString("done"));
    QVERIFY2(ticksWhileRunning >= 10, qPrintable(QString("%1 ticks while painting, of %2 in %3 ms")
                                                    .arg(ticksWhileRunning).arg(ticks).arg(clock.elapsed())));
    qDebug() << "job of" << job->strokesTotal() << "strokes:" << job->elapsedMs() << "ms; call" << callMs << "ms;"
             << ticks << "timer ticks, longest gap" << longestGap << "ms";
}

void TestStrokeJobs::testWashStrokesAreRepeatable()
{
    // Toska, 2026-11-11: a Wash-mode stroke paints on a temporary layer that several threads fill at once, and the
    // merge onto the layer is clipped to that layer's extent. KisTiledExtentManager published the extent after reading
    // it without a lock, so it was now and then too small and a strip of the stroke (whole tile rows, sometimes the
    // whole stroke) never reached the layer: about 3 jobs in 100, with any blend mode. The same job painted again and
    // again must give the same pixels. Knobs for hunting: TOSKA_BLEND_ROUNDS, TOSKA_BLEND_MODE, TOSKA_BLEND_FLOW and
    // TOSKA_BLEND_OPACITY (percent), TOSKA_BLEND_EMPTY, TOSKA_BLEND_BUILDUP, TOSKA_BLEND_SINGLE, TOSKA_BLEND_THREADS,
    // TOSKA_BLEND_LOD.
    const QString preset = presetName("b) Basic-4 Flow Opacity");
    QVERIFY2(!preset.isEmpty(), "Krita's preset b) Basic-4 Flow Opacity is in the resource database");
    const int rounds = qEnvironmentVariableIsSet("TOSKA_BLEND_ROUNDS") ? qEnvironmentVariableIntValue("TOSKA_BLEND_ROUNDS") : 150;
    const QString mode = qEnvironmentVariableIsSet("TOSKA_BLEND_MODE") ? qEnvironmentVariable("TOSKA_BLEND_MODE") : QString("normal");
    // TOSKA_BLEND_THREADS: Krita's worker thread limit for the rounds (for hunting); put back afterwards
    KisImageConfig config(false);
    const int threadsBefore = config.maxNumberOfThreads();
    if (qEnvironmentVariableIsSet("TOSKA_BLEND_THREADS")) {
        config.setMaxNumberOfThreads(qEnvironmentVariableIntValue("TOSKA_BLEND_THREADS"));
        KisImageConfigNotifier::instance()->notifyConfigChanged();
    }
    auto restoreThreads = qScopeGuard([&] () {
        if (qEnvironmentVariableIsSet("TOSKA_BLEND_THREADS")) {
            config.setMaxNumberOfThreads(threadsBefore);
            KisImageConfigNotifier::instance()->notifyConfigChanged();
        }
    });
    QHash<QByteArray, int> results;
    QByteArray first;
    QImage firstImage;
    for (int round = 0; round < rounds; round++) {
        JobDocument d(3000, 2000);
        // TOSKA_BLEND_EMPTY=1: the layer starts empty, so its tiles are made while the strokes paint (for hunting)
        if (qEnvironmentVariableIntValue("TOSKA_BLEND_EMPTY") <= 0) {
            d.layer->paintDevice()->fill(QRect(0, 0, 3000, 2000), KoColor(QColor(245, 196, 0), d.image->colorSpace()));
        }
        // TOSKA_BLEND_LOD=1: Instant Preview on, as a document with a view has it (it made no difference)
        if (qEnvironmentVariableIntValue("TOSKA_BLEND_LOD") > 0) {
            d.image->setLodPreferences(KisLodPreferences(2));
        }
        d.image->initialRefreshGraph();
        d.image->waitForDone();
        QVariantList strokes;
        for (int i = 0; i < 10; i++) {
            QVariantMap stroke = line({{1100, 100 + 65 * i}, {1900, 100 + 65 * i}}, 100, i % 2 ? "#f07a14" : "#10206b");
            // TOSKA_BLEND_FLOW / TOSKA_BLEND_OPACITY: percent, for hunting (35 each by default)
            stroke.insert("opacity", (qEnvironmentVariableIsSet("TOSKA_BLEND_OPACITY") ? qEnvironmentVariableIntValue("TOSKA_BLEND_OPACITY") : 35) / 100.0);
            stroke.insert("flow", (qEnvironmentVariableIsSet("TOSKA_BLEND_FLOW") ? qEnvironmentVariableIntValue("TOSKA_BLEND_FLOW") : 35) / 100.0);
            strokes << stroke;
        }
        // TOSKA_BLEND_SINGLE=1: every stroke as a job of its own, each waited for (for hunting)
        const bool single = qEnvironmentVariableIntValue("TOSKA_BLEND_SINGLE") > 0;
        for (int at = 0; at < (single ? strokes.size() : 1); at++) {
            QVariantMap options {{"preset", preset}, {"compositeOp", mode}};
            // TOSKA_BLEND_BUILDUP=1: the brush paints straight onto the layer (Build Up), with no temporary layer to merge
            if (qEnvironmentVariableIntValue("TOSKA_BLEND_BUILDUP") > 0) options.insert("presetProperties", QVariantMap{{"PaintOpAction", 1}});
            QScopedPointer<StrokeJob> job(d.paint->paintStrokes(single ? QVariantList{strokes[at]} : strokes, options));
            QVERIFY(job);
            QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
            QVERIFY(settle(job.data(), 60000));
            d.image->waitForDone();
        }
        const QImage image = d.layer->paintDevice()->convertToQImage(nullptr, 1000, 0, 1000, 900);
        const QByteArray hash = QCryptographicHash::hash(QByteArray::fromRawData(reinterpret_cast<const char *>(image.constBits()), int(image.sizeInBytes())), QCryptographicHash::Md5);
        if (round == 0) { first = hash; firstImage = image.copy(); }
        else if (hash != first && results.value(hash) == 0) {
            int top = image.height(), bottom = -1, left = image.width(), right = -1, worst = 0;
            for (int y = 0; y < image.height(); y++) for (int x = 0; x < image.width(); x++) {
                const QRgb a = image.pixel(x, y), b = firstImage.pixel(x, y);
                const int diff = qMax(qAbs(qRed(a) - qRed(b)), qMax(qAbs(qGreen(a) - qGreen(b)), qAbs(qBlue(a) - qBlue(b))));
                if (diff) { top = qMin(top, y); bottom = qMax(bottom, y); left = qMin(left, x); right = qMax(right, x); worst = qMax(worst, diff); }
            }
            const QColor odd = image.pixelColor((left + right) / 2, (top + bottom) / 2), usual = firstImage.pixelColor((left + right) / 2, (top + bottom) / 2);
            qInfo() << "round" << round << "differs from round 0: x" << left + 1000 << "-" << right + 1000 << "y" << top << "-" << bottom << "largest difference" << worst
                    << "middle pixel here" << odd.red() << odd.green() << odd.blue() << odd.alpha() << "round 0" << usual.red() << usual.green() << usual.blue() << usual.alpha();
        }
        results[hash]++;
    }
    qInfo() << mode << rounds << "rounds," << results.size() << "distinct results";
    QCOMPARE(results.size(), 1);
}

void TestStrokeJobs::testWashBrushLandsBeforeTheJobEnds()
{
    // KRITA_AGENT_WASH_ROUNDS repeats the test in one process, for hunting a rare failure (default: once).
    const int rounds = qEnvironmentVariableIsSet("KRITA_AGENT_WASH_ROUNDS") ? qEnvironmentVariableIntValue("KRITA_AGENT_WASH_ROUNDS") : 1;
    for (int round = 0; round < rounds; round++) {
        washRound(round);
        if (QTest::currentTestFailed()) return;
    }
}

void TestStrokeJobs::washRound(int round)
{
    Q_UNUSED(round);
    // A Wash-mode preset paints on a temporary layer merged after the stroke's finish: the job ends after that.
    const QString preset = presetName("b) Basic-5 Size Opacity");
    QVERIFY2(!preset.isEmpty(), "Krita's preset b) Basic-5 Size Opacity is in the resource database");
    JobDocument d(3000, 2000); // large strokes: the merge of the temporary layer takes a while
    DocumentChanges *changes = DocumentChanges::forImage(d.image);
    QVERIFY(changes);
    std::atomic<int> artistReports {0}, agentReports {0};
    KisNode *layer = d.layer.data();
    QMetaObject::Connection connection = QObject::connect(changes, &DocumentChanges::nodePixelsChangedAsync,
        [&] (KisNodeSP node, const QRect &, bool agent) {
            if (node.data() != layer) return;
            (agent ? agentReports : artistReports)++;
        });
    QVariantList strokes;
    for (int i = 0; i < 6; i++) strokes << line({{100, 150 + 300 * i}, {2900, 150 + 300 * i}}, 250);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}}));
    QVERIFY(job);
    QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
    QVERIFY(job->wait(30000));
    // Read at once, with no event loop turn: the last stroke's pixels are there.
    const QImage alpha = d.alpha();
    const int lastRow = areaCount(alpha, QRect(100, 1600, 2800, 100));
    const QRect changed = job->changedRect();
    const QRect painted = d.layer->paintDevice()->exactBounds();
    QObject::disconnect(connection);
    d.image->waitForDone();
    const int lastRowLater = areaCount(d.alpha(), QRect(100, 1600, 2800, 100));
    QVERIFY2(lastRow > 100000, qPrintable(QString("the last stroke has %1 px when the job ends, %9 once idle (%2, %3 of %4, painted %5,%6 %7x%8)")
                                              .arg(lastRow).arg(job->state()).arg(job->strokesDone()).arg(job->strokesTotal())
                                              .arg(painted.x()).arg(painted.y()).arg(painted.width()).arg(painted.height()).arg(lastRowLater)));
    QVERIFY2(changed.contains(painted), "changedRect covers the merged pixels");
    QVERIFY(agentReports.load() > 0);
    QVERIFY2(artistReports.load() == 0, qPrintable(QString("%1 reports marked the artist's").arg(artistReports.load())));
    QCOMPARE(job->state(), QString("done"));

    // The moment a waiting thread wakes, the last stroke's pixels are on the layer (read at once, one pixel each).
    int missing = 0;
    QStringList alphas;
    for (int i = 0; i < 5; i++) {
        const QPoint centre(1500, 120 + 350 * i);
        QScopedPointer<StrokeJob> one(d.paint->paintStrokes({line({{200, centre.y()}, {2800, centre.y()}}, 120)},
                                                            {{"preset", preset}, {"color", "#ff0000"}}));
        QVERIFY(one);
        std::atomic<int> alphaAtEnd {-1};
        KisPaintDeviceSP device = d.layer->paintDevice();
        QScopedPointer<QThread> waiter(QThread::create([&] () {
            if (!one->wait(30000)) return;
            QColor colour;
            device->pixel(centre.x(), centre.y(), &colour);
            alphaAtEnd = colour.alpha();
        }));
        waiter->start();
        QElapsedTimer clock;
        clock.start();
        while (!waiter->isFinished() && clock.elapsed() < 30000) QCoreApplication::processEvents();
        QVERIFY(waiter->wait(1000));
        if (alphaAtEnd.load() < 200) missing++;
        d.image->waitForDone();
        QColor later;
        device->pixel(centre.x(), centre.y(), &later);
        alphas << QString("%1 %2 later %3").arg(alphaAtEnd.load()).arg(one->state()).arg(later.alpha());
    }
    QVERIFY2(missing == 0, qPrintable(QString("%1 of 5 jobs ended before their pixels (alpha %2)").arg(missing).arg(alphas.join(", "))));
}

void TestStrokeJobs::testKritasCancellationLeavesJobsAlone()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    Gate gate(d.image);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(20, QRect(10, 10, 180, 40)), {{"preset", preset}}));
    QVERIFY(job);
    // Esc in a tool, a click in the Undo History docker, a view closing.
    d.image->requestStrokeCancellation();
    gate.release();
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    QCOMPARE(job->strokesDone(), 20);
}

void TestStrokeJobs::testClosingTheDocumentStopsAJob()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    const int count = 200;
    QScopedPointer<JobDocument> d(new JobDocument(20 * 30 + 20, 300));
    KisNodeSP layer = d->layer;
    QVariantList strokes;
    for (int i = 0; i < count; i++) {
        QVariantList points;
        const double x = 20 + 20 * (i % 30);
        for (int k = 0; k < 400; k++) points << QVariant(QVariantList{x + ((k % 2) ? 4 : -4), 10 + (k % 40) * 7});
        strokes << QVariantMap{{"points", points}, {"size", 8}};
    }
    QScopedPointer<StrokeJob> job(d->paint->paintStrokes(strokes, {{"preset", preset}}));
    QVERIFY(job);
    QElapsedTimer clock;
    clock.start();
    while (job->strokesDone() < 2 && clock.elapsed() < 20000) QCoreApplication::processEvents();
    QVERIFY(job->strokesDone() >= 2);
    // Close the document as Krita does, without waiting for the job first.
    clock.restart();
    d->paint.reset();
    d->doc.reset();
    KisPart::instance()->removeDocument(d->kisdoc, false);
    delete d->kisdoc;
    d->image = nullptr;
    const qint64 closeMs = clock.elapsed();
    QVERIFY(settle(job.data(), 5000));
    QCOMPARE(job->state(), QString("cancelled"));
    QCOMPARE(job->cancelReason(), QString("document_closed"));
    QCOMPARE(job->status().value("cancelReason").toString(), QString("document_closed"));
    const int done = job->strokesDone();
    QVERIFY2(done < count, qPrintable(QString("%1 strokes painted").arg(done)));
    QVERIFY2(closeMs < 3000, qPrintable(QString("closing took %1 ms").arg(closeMs)));
    qDebug() << "closing mid-job:" << closeMs << "ms," << done << "of" << count << "strokes kept";
    d.reset();
}

void TestStrokeJobs::testGuiThreadWaitIsBounded()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    Gate gate(d.image);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(10, QRect(10, 10, 180, 40)), {{"preset", preset}}));
    QVERIFY(job);
    // On the GUI thread a wait without a limit only polls: it can never hang the window.
    QElapsedTimer clock;
    clock.start();
    const bool ended = job->wait(-1);
    const qint64 ms = clock.elapsed();
    QVERIFY(!ended);
    QVERIFY2(ms < 1000, qPrintable(QString("wait(-1) on the GUI thread took %1 ms").arg(ms)));
    // Off the GUI thread it waits for the end.
    std::atomic<int> result {-1};
    QScopedPointer<QThread> waiter(QThread::create([&] () { result = job->wait(-1) ? 1 : 0; }));
    waiter->start();
    gate.release();
    clock.restart();
    while (!waiter->isFinished() && clock.elapsed() < 20000) QCoreApplication::processEvents();
    QVERIFY(waiter->wait(1000));
    QCOMPARE(result.load(), 1);
    QCOMPARE(job->state(), QString("done"));
}

void TestStrokeJobs::testJobsNeverAskArtistStrokesToEnd()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    QSignalSpy endRequests(d.image.data(), &KisImage::sigStrokeEndRequested);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(40, QRect(10, 10, 180, 40)), {{"preset", preset}}));
    QVERIFY(job);
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    QCOMPARE(endRequests.count(), 0); // (KisImage::waitForDone() asks too, so the count is read before any)
}

void TestStrokeJobs::testRefusesFarPointsAndOversizedJobs()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    auto refused = [&] (const QVariantList &strokes, const QString &why) {
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}}));
        if (!job) return QString("no job");
        if (job->state() != "failed") return QString("state %1").arg(job->state());
        if (!job->errorString().contains(why)) return QString("error \"%1\"").arg(job->errorString());
        return QString();
    };
    QCOMPARE(refused({line({{20, 50}, {1e7, 50}}, 10)}, "outside"), QString());
    QCOMPARE(refused({line({{20, 50}, {180, 50}}, 10), line({{-1e7, -1e7}}, 10)}, "stroke 1"), QString());
    QCOMPARE(refused({QVariantMap{{"start", QVariantList{20, 50}},
                                  {"segments", QVariantList{QVariant(QVariantList{1e7, 0, 60, 60, 100, 50})}},
                                  {"size", 10}}},
                     "control point"),
             QString());
    // One brush size past the edge is allowed, as creative_validation allows it.
    QScopedPointer<StrokeJob> edge(d.paint->paintStrokes({line({{-9, 50}, {209, 50}}, 10)}, {{"preset", preset}}));
    QVERIFY2(edge->state() != "failed", qPrintable(edge->errorString()));
    QVERIFY(settle(edge.data()));
    // Too many strokes, or points in a stroke.
    QVariantList many;
    for (int i = 0; i < 10001; i++) many << line({{20, 50}}, 4);
    QCOMPARE(refused(many, "strokes"), QString());
    QVariantList points;
    for (int i = 0; i < 10001; i++) points << QVariant(QVariantList{20 + i % 100, 50});
    QCOMPARE(refused({QVariantMap{{"points", points}}}, "points"), QString());
    // A per-point list longer than the points is refused too.
    QCOMPARE(refused({QVariantMap{{"points", QVariantList{QVariant(QVariantList{20, 50}), QVariant(QVariantList{60, 50})}},
                                  {"pressure", QVariantList{0.5, 0.5, 0.5}}}},
                     "pressure"),
             QString());
    d.image->waitForDone();
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 1); // only the edge job
}

void TestStrokeJobs::testArtistStrokeRunsBeforeTheJobEnds()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    const int count = 200;
    JobDocument d(20 * 30 + 20, 300);
    QVariantList strokes;
    for (int i = 0; i < count; i++) {
        QVariantList points;
        const double x = 20 + 20 * (i % 30);
        for (int k = 0; k < 100; k++) points << QVariant(QVariantList{x + ((k % 2) ? 4 : -4), 10 + (k % 40) * 7});
        strokes << QVariantMap{{"points", points}, {"size", 8}};
    }
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}}));
    QVERIFY(job);
    QElapsedTimer clock;
    clock.start();
    while (job->strokesDone() < 1 && clock.elapsed() < 20000) QCoreApplication::processEvents();
    QVERIFY(job->strokesDone() >= 1);
    // The artist starts a stroke while the job paints.
    QSharedPointer<QAtomicInt> doneWhenRun(new QAtomicInt(-1));
    KisStrokeId artist = d.image->startStroke(new ArtistStroke(job.data(), doneWhenRun));
    d.image->endStroke(artist);
    QVERIFY(settle(job.data(), 60000));
    QCOMPARE(job->state(), QString("done"));
    d.image->waitForDone();
    const int doneThen = doneWhenRun->loadAcquire();
    QVERIFY2(doneThen >= 0 && doneThen <= 2 * 32,
             qPrintable(QString("the artist's stroke ran after %1 of %2 job strokes").arg(doneThen).arg(count)));
}

void TestStrokeJobs::testArtistUndoStopsTheJobThenUndoes()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    const int count = 150;
    JobDocument d(20 * 30 + 20, 300);
    QScopedPointer<StrokeJob> earlier(d.paint->paintStrokes({line({{5, 295}, {600, 295}}, 4)}, {{"preset", preset}, {"name", "earlier"}}));
    QVERIFY(settle(earlier.data()));
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 1);
    QVariantList strokes;
    for (int i = 0; i < count; i++) {
        QVariantList points;
        const double x = 20 + 20 * (i % 30);
        for (int k = 0; k < 200; k++) points << QVariant(QVariantList{x + ((k % 2) ? 4 : -4), 10 + (k % 38) * 7});
        strokes << QVariantMap{{"points", points}, {"size", 8}};
    }
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}, {"name", "long"}}));
    QVERIFY(job);
    QElapsedTimer clock;
    clock.start();
    while (job->strokesDone() < 3 && clock.elapsed() < 20000) QCoreApplication::processEvents();
    QVERIFY(job->strokesDone() >= 3);
    // The artist presses Ctrl+Z.
    d.kisdoc->undoStack()->undo();
    QVERIFY(settle(job.data()));
    QVERIFY2(job->state() == "cancelled" && job->cancelReason() == "undo" && job->strokesDone() < count,
             qPrintable(QString("state %1, reason \"%2\", %3 of %4 strokes").arg(job->state(), job->cancelReason())
                            .arg(job->strokesDone()).arg(count)));
    // Then the undo is carried out: the job's step is undone, the earlier step stays.
    QElapsedTimer wait;
    wait.start();
    // The index is 1 before the job's step has landed too: wait for the step (count 2) and the undo (index 1).
    while (!(d.kisdoc->undoStack()->count() == 2 && d.kisdoc->undoStack()->index() == 1) && wait.elapsed() < 10000)
        QCoreApplication::processEvents();
    QVERIFY2(d.kisdoc->undoStack()->index() == 1 && d.kisdoc->undoStack()->count() == 2
                 && d.kisdoc->undoStack()->text(1) == "long" && d.kisdoc->undoStack()->text(0) == "earlier",
             qPrintable(QString("index %1, count %2, texts \"%3\" \"%4\"").arg(d.kisdoc->undoStack()->index())
                            .arg(d.kisdoc->undoStack()->count())
                            .arg(d.kisdoc->undoStack()->count() > 1 ? d.kisdoc->undoStack()->text(1) : QString(),
                                 d.kisdoc->undoStack()->count() > 0 ? d.kisdoc->undoStack()->text(0) : QString())));
    d.image->waitForDone();
    QVERIFY2(areaCount(d.alpha(), QRect(0, 0, 620, 285)) == 0,
             qPrintable(QString("%1 px of the job remain").arg(areaCount(d.alpha(), QRect(0, 0, 620, 285)))));
    QVERIFY(areaCount(d.alpha(), QRect(0, 285, 620, 15)) > 0);
}

void TestStrokeJobs::testEraseOpacityAndFlow()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    // compositeOp "erase" erases.
    QScopedPointer<StrokeJob> paint(d.paint->paintStrokes({line({{20, 30}, {180, 30}}, 16)}, {{"preset", preset}}));
    QVERIFY(settle(paint.data()));
    QScopedPointer<StrokeJob> erase(d.paint->paintStrokes({line({{80, 30}, {120, 30}}, 30)}, {{"preset", preset}, {"compositeOp", "erase"}}));
    QVERIFY2(erase->state() != "failed", qPrintable(erase->errorString()));
    QVERIFY(settle(erase.data()));
    QImage alpha = d.alpha();
    QCOMPARE(columnCount(alpha, 100), 0);
    QVERIFY(columnCount(alpha, 40) > 8);
    // One dab each: opacity and flow scale it; at 1 and 1 it is opaque.
    QScopedPointer<StrokeJob> dabs(d.paint->paintStrokes(
        {QVariantMap{{"points", QVariantList{QVariant(QVariantList{40, 75})}}, {"size", 20}, {"opacity", 1.0}, {"flow", 1.0}},
         QVariantMap{{"points", QVariantList{QVariant(QVariantList{100, 75})}}, {"size", 20}, {"opacity", 0.3}, {"flow", 1.0}},
         QVariantMap{{"points", QVariantList{QVariant(QVariantList{160, 75})}}, {"size", 20}, {"opacity", 1.0}, {"flow", 0.3}}},
        {{"preset", preset}}));
    QVERIFY(settle(dabs.data()));
    alpha = d.alpha();
    const int full = alpha.constScanLine(75)[40], lowOpacity = alpha.constScanLine(75)[100], lowFlow = alpha.constScanLine(75)[160];
    QVERIFY2(full > 240, qPrintable(QString("full %1").arg(full)));
    QVERIFY2(lowOpacity > 50 && lowOpacity < 110, qPrintable(QString("opacity 0.3: %1").arg(lowOpacity)));
    QVERIFY2(lowFlow > 50 && lowFlow < 110, qPrintable(QString("flow 0.3: %1").arg(lowFlow)));
}

/**
 * Krita's MyPaint preset \p base (a .myb of the install), added to the resource database as a preset of the MyPaint
 * engine; its name, or an empty string. The tests' resource database has no MyPaint loader (the engine's plugin
 * registers it after the database is read), so the .myb files are not in it.
 */
QString myPaintPreset(const QString &base)
{
    const QString shown = QString(base).replace('_', ' '); // the database names a preset as Krita shows it
    if (!presetName(shown).isEmpty()) return presetName(shown);
    QFile file(KoResourcePaths::getApplicationRoot() + "/share/krita/paintoppresets/" + base + ".myb");
    if (!file.open(QIODevice::ReadOnly)) return QString();
    KisPaintOpSettingsSP settings = KisPaintOpRegistry::instance()->createSettings(
        KoID("mypaintbrush"), KisGlobalResourcesInterface::instance());
    if (!settings) return QString();
    settings->setProperty("paintop", "mypaintbrush");
    settings->setProperty("MyPaint/json", file.readAll());
    settings->setProperty("EraserMode", 0);
    KisPaintOpPresetSP preset(new KisPaintOpPreset());
    preset->setSettings(settings);
    preset->setName(base);
    preset->setFilename(base + preset->defaultFileExtension());
    QImage thumbnail(16, 16, QImage::Format_ARGB32);
    thumbnail.fill(Qt::white);
    preset->setImage(thumbnail);
    preset->setValid(true);
    KisResourceModel model(ResourceType::PaintOpPresets);
    if (!model.addResource(preset)) return QString();
    return presetName(shown);
}

/// Mean alpha (0..255) of \p rect of \p alpha.
double meanAlpha(const QImage &alpha, const QRect &rect)
{
    double sum = 0;
    const QRect clipped = rect & alpha.rect();
    for (int y = clipped.top(); y <= clipped.bottom(); y++) {
        for (int x = clipped.left(); x <= clipped.right(); x++) sum += alpha.constScanLine(y)[x];
    }
    return clipped.isEmpty() ? 0 : sum / (clipped.width() * clipped.height());
}

void TestStrokeJobs::testMyPaintOpacityAndFlow()
{
    // A stroke's opacity and flow scale a MyPaint preset's paint as they do a pixel brush's (testEraseOpacityAndFlow):
    // the MyPaint engine paints its dabs itself and never reads the painter's opacity or the FlowValue property.
    const QString preset = myPaintPreset("i)_Wet_Paint_Plus_(mypaint)");
    QVERIFY2(!preset.isEmpty(), "Krita's i)_Wet_Paint_Plus_(mypaint).myb, added to the resource database");
    auto paintRow = [&](double opacity, double flow, double pressure) {
        JobDocument d(300, 60);
        QVariantMap stroke = line({{30, 30, pressure}, {150, 30, pressure}, {270, 30, pressure}}, 24, "#1e3ce6");
        stroke.insert("opacity", opacity);
        stroke.insert("flow", flow);
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes({stroke}, {{"preset", preset}}));
        if (!settle(job.data()) || job->state() == "failed") return -1.0;
        return meanAlpha(d.alpha(), QRect(60, 24, 180, 13));
    };
    for (double pressure : {1.0, 0.6}) {
        const double full = paintRow(1.0, 1.0, pressure), glaze = paintRow(0.35, 1.0, pressure),
                     both = paintRow(0.35, 0.35, pressure), flowed = paintRow(1.0, 0.35, pressure);
        qInfo() << "pressure" << pressure << "full" << full << "opacity 0.35" << glaze << "both 0.35" << both
                << "flow 0.35" << flowed;
        QVERIFY2(full > 60, qPrintable(QString("full %1").arg(full)));
        // opacity: the stroke at full strength blended over the layer as it was, as Krita's wash mode composites
        QVERIFY2(qAbs(glaze / full - 0.35) < 0.05, qPrintable(QString("opacity 0.35: %1 of %2").arg(glaze).arg(full)));
        // flow scales each dab: less paint, and with opacity less again
        QVERIFY2(flowed < full, qPrintable(QString("flow 0.35: %1 of %2").arg(flowed).arg(full)));
        QVERIFY2(both < glaze, qPrintable(QString("both 0.35: %1, opacity alone %2").arg(both).arg(glaze)));
    }
    // at pressure 0.6 the dabs are light enough that flow shows on its own
    const double light = paintRow(1.0, 1.0, 0.6), lightFlowed = paintRow(1.0, 0.35, 0.6);
    QVERIFY2(lightFlowed < 0.6 * light, qPrintable(QString("flow 0.35 at pressure 0.6: %1 of %2").arg(lightFlowed).arg(light)));
}

void TestStrokeJobs::testMyPaintOpacityCostsTheStrokesArea()
{
    // The reference transfer sends about 210,000 small MyPaint dabs per job, nearly all below opacity 1, on canvases of
    // 6000x4500: a stroke's opacity must cost what the stroke touches, not the layer's size.
    const QString preset = myPaintPreset("i)_Wet_Paint_Plus_(mypaint)");
    QVERIFY(!preset.isEmpty());
    auto paintDabs = [&](double opacity, int count) {
        JobDocument d(6000, 4500);
        d.layer->paintDevice()->fill(d.image->bounds(), KoColor(Qt::white, d.image->colorSpace())); // every tile stored
        QVariantList strokes;
        for (int i = 0; i < count; i++) {
            const double x = 100 + (i % 50) * 115, y = 100 + (i / 50) * 105;
            QVariantMap dab = line({{x, y}, {x + 6, y + 2}}, 20, i % 2 ? "#1e3ce6" : "#e6c81e");
            dab.insert("opacity", opacity);
            strokes << dab;
        }
        QElapsedTimer clock;
        clock.start();
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}}));
        const bool settled = settle(job.data(), 120000) && job->state() != "failed";
        return settled ? clock.elapsed() : qint64(-1);
    };
    paintDabs(1.0, 50); // warm-up: the preset, the brush and the tiles' first allocation
    const qint64 full = paintDabs(1.0, 2000), translucent = paintDabs(0.6, 2000);
    qInfo() << "2000 MyPaint dabs on 6000x4500: opacity 1" << full << "ms, opacity 0.6" << translucent << "ms";
    QVERIFY(full > 0 && translucent > 0);
    QVERIFY2(translucent <= 1.5 * full + 50,
             qPrintable(QString("opacity 0.6 took %1 ms against %2 ms at opacity 1").arg(translucent).arg(full)));
}

namespace {
/// Mean colour of \p rect of \p device, as HSV hue (degrees), saturation (0..1) and the mean alpha (0..255).
struct MeanColour {
    double hue, saturation, alpha;
};
MeanColour meanColour(KisPaintDeviceSP device, const QRect &rect)
{
    const QImage image = device->convertToQImage(nullptr, rect.x(), rect.y(), rect.width(), rect.height());
    double r = 0, g = 0, b = 0, a = 0;
    for (int y = 0; y < image.height(); y++) {
        const QRgb *line = reinterpret_cast<const QRgb *>(image.constScanLine(y));
        for (int x = 0; x < image.width(); x++) {
            r += qRed(line[x]), g += qGreen(line[x]), b += qBlue(line[x]), a += qAlpha(line[x]);
        }
    }
    const double n = image.width() * image.height();
    const QColor mean = QColor::fromRgbF(r / n / 255, g / n / 255, b / n / 255);
    return {mean.hsvHueF() * 360.0, mean.hsvSaturationF(), a / n};
}

QByteArray deviceBytes(KisPaintDeviceSP device, const QRect &rect)
{
    QByteArray bytes(rect.width() * rect.height() * device->pixelSize(), 0);
    device->readBytes(reinterpret_cast<quint8 *>(bytes.data()), rect);
    return bytes;
}
}

void TestStrokeJobs::testMyPaintSpectralGlazeMixesByTheModel()
{
    // A glaze on ONE layer: thin blue over yellow (libpaintmix's golden pair, KisPaintMixTest's blue and yellow). The stroke paints at full strength into its copy and
    // the layer is blended towards that copy by the opacity; with the spectral model that blend must be spectral too
    // (green), not a plain lerp of sRGB (slate grey). rgb stays exactly the lerp it was.
    const QString preset = myPaintPreset("i)_Wet_Paint_Plus_(mypaint)");
    QVERIFY(!preset.isEmpty());
    const QRect canvas(0, 0, 300, 120), yellowArea(0, 0, 200, 120), overlap(60, 50, 100, 20), bare(230, 50, 30, 20);
    struct Result {
        KisPaintDeviceSP start, painted;
    };
    auto paint = [&](bool spectral, double opacity) -> Result {
        JobDocument d(canvas.width(), canvas.height());
        d.layer->paintDevice()->fill(yellowArea, KoColor(QColor(252, 211, 0), d.image->colorSpace())); // the yellow
        KisPaintDeviceSP start = new KisPaintDevice(*d.layer->paintDevice());
        QVariantMap stroke = line({{30, 60}, {150, 60}, {270, 60}}, 40, "#002185"); // the blue
        stroke.insert("opacity", opacity);
        QVariantMap options{{"preset", preset}};
        if (spectral) options.insert("presetProperties", QVariantMap{{"ToskaMyPaintPaintMode", 1.0}});
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes({stroke}, options));
        if (!settle(job.data()) || job->state() == "failed") return {};
        d.image->waitForDone();
        return {start, new KisPaintDevice(*d.layer->paintDevice())};
    };
    const Result rgbFull = paint(false, 1.0), rgbGlaze = paint(false, 0.35);
    const Result spectralFull = paint(true, 1.0), spectralGlaze = paint(true, 0.35);
    for (const Result &r : {rgbFull, rgbGlaze, spectralFull, spectralGlaze}) QVERIFY(r.painted);

    // rgb: bit for bit the layer as the stroke began with the full-strength stroke over it at the opacity (copy)
    KisPaintDeviceSP lerp = new KisPaintDevice(*rgbGlaze.start);
    {
        KisPainter painter(lerp);
        painter.setCompositeOpId(COMPOSITE_COPY);
        painter.setOpacityF(0.35);
        painter.bitBlt(canvas.topLeft(), rgbFull.painted, canvas);
    }
    QVERIFY2(deviceBytes(rgbGlaze.painted, canvas) == deviceBytes(lerp, canvas), "rgb glaze is the plain lerp");

    // opacity 1 spectral is untouched by the glaze blend (its bytes as before the change)
    const QByteArray fullHash = QCryptographicHash::hash(deviceBytes(spectralFull.painted, canvas), QCryptographicHash::Md5).toHex();
    qInfo() << "spectral opacity 1 md5" << fullHash;
    QCOMPARE(fullHash, QByteArray("ace52cc3034b24c9e0f6e7ab7fa11013"));

    const MeanColour rgb = meanColour(rgbGlaze.painted, overlap), spectral = meanColour(spectralGlaze.painted, overlap);
    qInfo() << "blue 0.35 over yellow: rgb hue" << rgb.hue << "saturation" << rgb.saturation
            << "| spectral hue" << spectral.hue << "saturation" << spectral.saturation;
    QVERIFY2(spectral.hue >= 75 && spectral.hue <= 165, qPrintable(QString("spectral hue %1").arg(spectral.hue)));
    QVERIFY2(spectral.saturation > rgb.saturation + 0.05,
             qPrintable(QString("saturation spectral %1 rgb %2").arg(spectral.saturation).arg(rgb.saturation)));

    // alpha by the current rule: equal to rgb's over the yellow, and the copy lerp of the full stroke's off it
    QCOMPARE(spectral.alpha, rgb.alpha);
    const QImage glazeAlpha = spectralGlaze.painted->convertToQImage(nullptr, 0, 0, canvas.width(), canvas.height());
    KisPaintDeviceSP alphaLerp = new KisPaintDevice(*spectralGlaze.start);
    {
        KisPainter painter(alphaLerp);
        painter.setCompositeOpId(COMPOSITE_COPY);
        painter.setOpacityF(0.35);
        painter.bitBlt(canvas.topLeft(), spectralFull.painted, canvas);
    }
    const QImage expectedAlpha = alphaLerp->convertToQImage(nullptr, 0, 0, canvas.width(), canvas.height());
    int alphaDifferences = 0;
    for (int y = 0; y < canvas.height(); y++) {
        for (int x = 0; x < canvas.width(); x++) {
            alphaDifferences += qAlpha(glazeAlpha.pixel(x, y)) != qAlpha(expectedAlpha.pixel(x, y)) ? 1 : 0;
        }
    }
    QCOMPARE(alphaDifferences, 0);
    QVERIFY2(meanColour(spectralGlaze.painted, bare).alpha > 10, "the stroke off the yellow is painted");
}

void TestStrokeJobs::testMyPaintSpectralOpacityCostsAboutRgbs()
{
    // The spectral glaze blend costs the stroke's changed area like rgb's: at most about twice rgb opacity's time on
    // the same dabs (testMyPaintOpacityCostsTheStrokesArea's 2000 dabs on 6000x4500).
    const QString preset = myPaintPreset("i)_Wet_Paint_Plus_(mypaint)");
    QVERIFY(!preset.isEmpty());
    auto paintDabs = [&](bool spectral, double opacity, int count) {
        JobDocument d(6000, 4500);
        d.layer->paintDevice()->fill(d.image->bounds(), KoColor(QColor(254, 236, 0), d.image->colorSpace()));
        QVariantList strokes;
        for (int i = 0; i < count; i++) {
            const double x = 100 + (i % 50) * 115, y = 100 + (i / 50) * 105;
            QVariantMap dab = line({{x, y}, {x + 6, y + 2}}, 20, i % 2 ? "#1e3ce6" : "#e6c81e");
            dab.insert("opacity", opacity);
            strokes << dab;
        }
        QVariantMap options{{"preset", preset}};
        if (spectral) options.insert("presetProperties", QVariantMap{{"ToskaMyPaintPaintMode", 1.0}});
        QElapsedTimer clock;
        clock.start();
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, options));
        const bool settled = settle(job.data(), 120000) && job->state() != "failed";
        return settled ? clock.elapsed() : qint64(-1);
    };
    paintDabs(true, 0.6, 50); // warm-up
    const qint64 spectralFull = paintDabs(true, 1.0, 2000), rgbGlaze = paintDabs(false, 0.6, 2000),
                 spectralGlaze = paintDabs(true, 0.6, 2000);
    qInfo() << "2000 MyPaint dabs on 6000x4500: spectral opacity 1" << spectralFull << "ms, rgb opacity 0.6" << rgbGlaze
            << "ms, spectral opacity 0.6" << spectralGlaze << "ms";
    QVERIFY(spectralFull > 0 && rgbGlaze > 0 && spectralGlaze > 0);
    QVERIFY2(spectralGlaze <= 2 * rgbGlaze + 50,
             qPrintable(QString("spectral opacity 0.6 took %1 ms against rgb's %2 ms").arg(spectralGlaze).arg(rgbGlaze)));
}

void TestStrokeJobs::testOffGuiThreadRefusedAndALoneStartDabs()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    // paintStrokes() is for the GUI thread.
    QString state, error;
    QScopedPointer<QThread> other(QThread::create([&] () {
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line({{20, 50}, {180, 50}})}, {{"preset", preset}}));
        state = job ? job->state() : QString("no job");
        error = job ? job->errorString() : QString();
    }));
    other->start();
    QVERIFY(other->wait(10000));
    QCOMPARE(state, QString("failed"));
    QVERIFY(error.contains("GUI thread"));
    // A stroke of a start and no segments paints one dab.
    QScopedPointer<StrokeJob> dab(d.paint->paintStrokes({QVariantMap{{"start", QVariantList{100, 50}}, {"size", 20}}},
                                                        {{"preset", preset}}));
    QVERIFY2(dab->state() != "failed", qPrintable(dab->errorString()));
    QVERIFY(settle(dab.data()));
    const QRect bounds = d.layer->paintDevice()->exactBounds();
    QVERIFY(!bounds.isEmpty() && bounds.width() <= 24 && bounds.contains(QPoint(100, 50)));
}

void TestStrokeJobs::testCancelReasons()
{
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d;
    // No reason while the job is not cancelled, and none when it ends done.
    {
        Gate gate(d.image);
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(5, QRect(10, 10, 180, 40)), {{"preset", preset}}));
        QVERIFY(job);
        QCOMPARE(job->cancelReason(), QString());
        QCOMPARE(job->status().value("cancelReason").toString(), QString());
        gate.release();
        QVERIFY(settle(job.data()));
        QCOMPARE(job->state(), QString("done"));
        QCOMPARE(job->cancelReason(), QString());
        QVERIFY(!job->cancel()); // too late: no reason is recorded
        QCOMPARE(job->cancelReason(), QString());
    }
    // cancel() is the script's (or the plugin's Stop).
    {
        Gate gate(d.image);
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(40, QRect(10, 10, 180, 40)), {{"preset", preset}}));
        QVERIFY(job);
        QVERIFY(job->cancel());
        QCOMPARE(job->cancelReason(), QString("script"));
        gate.release();
        QVERIFY(settle(job.data()));
        QCOMPARE(job->state(), QString("cancelled"));
        QCOMPARE(job->cancelReason(), QString("script"));
        QCOMPARE(job->status().value("cancelReason").toString(), QString("script"));
    }
    // The first reason stays: a script's cancel, then the artist's undo, is still the script's.
    {
        Gate gate(d.image);
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes(rows(40, QRect(10, 10, 180, 40)), {{"preset", preset}}));
        QVERIFY(job);
        QVERIFY(job->cancel());
        d.kisdoc->undoStack()->undo();
        gate.release();
        QVERIFY(settle(job.data()));
        QCOMPARE(job->cancelReason(), QString("script"));
    }
    // (The undo and document_closed reasons: testArtistUndoStopsTheJobThenUndoes, testClosingTheDocumentStopsAJob.)
}

void TestStrokeJobs::testBrushIsFixedAtTheCall()
{
    const QString name = pressurePreset();
    QVERIFY(!name.isEmpty());
    KisPaintOpPresetSP live = KisGlobalResourcesInterface::instance()->source(ResourceType::PaintOpPresets)
                                  .bestMatch(QString(), QString(), name).dynamicCast<KisPaintOpPreset>();
    QVERIFY(live);
    const qreal opacity = live->settings()->paintOpOpacity();
    const qreal size = live->settings()->paintOpSize();
    // Put the live preset back, whatever happens.
    struct Restore {
        KisPaintOpPresetSP preset; qreal opacity, size;
        ~Restore() { preset->settings()->setPaintOpOpacity(opacity); preset->settings()->setPaintOpSize(size); }
    } restore {live, opacity, size};

    JobDocument d(200, 400);
    live->settings()->setPaintOpOpacity(1.0);
    Gate gate(d.image);
    // 100 dabs; the later ones give a size of their own, so each of those windows sets up its brush when it is queued.
    QVariantList strokes;
    for (int i = 0; i < 100; i++) {
        strokes << QVariantMap{{"points", QVariantList{QVariant(QVariantList{20 + 8 * (i % 20), 20 + 18 * (i / 20)})}},
                               {"size", i < 32 ? 12.0 : 13.0}};
    }
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", name}, {"useViewTweaks", true}}));
    QVERIFY(job);
    QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
    // The view's brush changes after the call (a different tool, or a toggle the plugin restores later).
    live->settings()->setPaintOpOpacity(0.2);
    live->settings()->setPaintOpSize(60);
    gate.release();
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    d.image->waitForDone();
    const QImage alpha = d.alpha();
    const int early = alpha.constScanLine(20)[20], late = alpha.constScanLine(20 + 18 * 4)[20 + 8 * 19];
    QVERIFY2(early > 240, qPrintable(QString("an early dab has alpha %1").arg(early)));
    QVERIFY2(late > 240, qPrintable(QString("a late dab has alpha %1 (it used the brush as changed after the call)").arg(late)));
}

void TestStrokeJobs::testUndoBetweenTopUpsUndoesTheJob()
{
    // While the job waits for the GUI thread to queue its next strokes, the image is idle, and Krita takes an undo at
    // once: it must undo the job's step, not the one before it (which the job's step landing later would wipe).
    const QString preset = pressurePreset();
    QVERIFY(!preset.isEmpty());
    JobDocument d(620, 300);
    QScopedPointer<StrokeJob> earlier(d.paint->paintStrokes({line({{5, 295}, {600, 295}}, 4)}, {{"preset", preset}, {"name", "earlier"}}));
    QVERIFY(settle(earlier.data()));
    QTRY_COMPARE(d.kisdoc->undoStack()->count(), 1);
    QVariantList strokes;
    for (int i = 0; i < 100; i++) strokes << line({{20 + 5 * (i % 100), 20}, {20 + 5 * (i % 100), 100}}, 4);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes(strokes, {{"preset", preset}, {"name", "long"}}));
    QVERIFY(job);
    // No event loop turn: the first window paints, and then nothing queues the rest.
    QElapsedTimer clock;
    clock.start();
    while (!d.image->isIdle() && clock.elapsed() < 20000) QThread::msleep(2);
    QVERIFY(d.image->isIdle());
    QVERIFY2(job->strokesDone() > 0 && job->strokesDone() < 100, qPrintable(QString("%1 strokes done").arg(job->strokesDone())));
    d.kisdoc->undoStack()->undo();
    QVERIFY(settle(job.data()));
    d.image->waitForDone();
    QVERIFY2(job->state() == "cancelled" && job->cancelReason() == "undo",
             qPrintable(QString("state %1, reason \"%2\"").arg(job->state(), job->cancelReason())));
    clock.restart();
    while (!(d.kisdoc->undoStack()->count() == 2 && d.kisdoc->undoStack()->index() == 1) && clock.elapsed() < 10000)
        QCoreApplication::processEvents();
    QVERIFY2(d.kisdoc->undoStack()->count() == 2 && d.kisdoc->undoStack()->index() == 1
                 && d.kisdoc->undoStack()->text(1) == "long" && d.kisdoc->undoStack()->text(0) == "earlier",
             qPrintable(QString("count %1, index %2").arg(d.kisdoc->undoStack()->count()).arg(d.kisdoc->undoStack()->index())));
    d.image->waitForDone();
    QCOMPARE(areaCount(d.alpha(), QRect(0, 0, 620, 285)), 0);
    QVERIFY(areaCount(d.alpha(), QRect(0, 285, 620, 15)) > 0);
}

void TestStrokeJobs::testPaintsTheSavedBrushNotTheViewsTweaks()
{
    const QString name = pressurePreset();
    QVERIFY(!name.isEmpty());
    KisPaintOpPresetSP live = KisGlobalResourcesInterface::instance()->source(ResourceType::PaintOpPresets)
                                  .bestMatch(QString(), QString(), name).dynamicCast<KisPaintOpPreset>();
    QVERIFY(live);
    QVERIFY(live->resourceId() >= 0);
    struct Restore {
        KisPaintOpPresetSP preset; QString op; bool dirty;
        ~Restore()
        {
            StrokeJobBrush::setViewPresetForTesting(KisPaintOpPresetSP());
            preset->settings()->setPaintOpCompositeOp(op);
            preset->setDirty(dirty);
        }
    } restore {live, live->settings()->paintOpCompositeOp(), live->isDirty()};

    auto painted = [] (const QVariantMap &options, QString *error) {
        JobDocument d(200, 100);
        QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line({{20, 50}, {180, 50}}, 20)}, options));
        if (!job || !settle(job.data()) || job->state() != "done") {
            *error = job ? job->state() + ": " + job->errorString() : QString("no job");
            return -1;
        }
        d.image->waitForDone();
        return areaCount(d.alpha(), QRect(0, 0, 200, 100));
    };
    QString error;
    const int saved = painted({{"preset", name}}, &error);
    QVERIFY2(saved > 0, qPrintable(error));

    // The artist's tweak, as Krita's session storage loads it into the preset when it is selected: this brush erases.
    live->settings()->setPaintOpCompositeOp(COMPOSITE_ERASE);
    live->setDirty(true);

    // Named: the preset as saved, unless the tweaked one is asked for
    QCOMPARE(painted({{"preset", name}}, &error), saved);
    QCOMPARE(painted({{"preset", name}, {"useViewTweaks", false}}, &error), saved);
    QCOMPARE(painted({{"preset", name}, {"useViewTweaks", true}}, &error), 0); // erases an empty layer: nothing
    QCOMPARE(error, QString());

    // Not named: the view's preset, as saved, unless its tweaks are asked for
    StrokeJobBrush::setViewPresetForTesting(live);
    QCOMPARE(painted({}, &error), saved);
    QCOMPARE(painted({{"useViewTweaks", true}}, &error), 0);
    QCOMPARE(error, QString());

    // The job never touches the view's own preset
    QCOMPARE(live->settings()->paintOpCompositeOp(), QString(COMPOSITE_ERASE));
    QVERIFY(live->isDirty());

    // A preset not in the database has no saved version: the preset itself
    KisPaintOpPresetSP unsaved = live->clone().dynamicCast<KisPaintOpPreset>();
    unsaved->setResourceId(-1);
    QCOMPARE(StrokeJobBrush::savedPreset(unsaved).data(), unsaved.data());
    QVERIFY(StrokeJobBrush::savedPreset(live).data() != live.data());
    QCOMPARE(StrokeJobBrush::savedPreset(live)->settings()->paintOpCompositeOp(), restore.op);
}

void TestStrokeJobs::testAgentPassLeavesStoredTweaksAlone()
{
    const QString name = pressurePreset();
    QVERIFY(!name.isEmpty());
    KisPaintOpPresetSP live = KisGlobalResourcesInterface::instance()->source(ResourceType::PaintOpPresets)
                                  .bestMatch(QString(), QString(), name).dynamicCast<KisPaintOpPreset>();
    QVERIFY(live);
    QVERIFY(live->resourceId() >= 0);
    KisPaintOpPresetSessionStorage *storage = KisPaintOpPresetSessionStorage::instance();
    const qreal size = live->settings()->paintOpSize();
    const bool dirty = live->isDirty();
    struct Restore {
        KisPaintOpPresetSessionStorage *storage; KisPaintOpPresetSP preset; qreal size; bool dirty;
        ~Restore()
        {
            preset->settings()->setPaintOpSize(size);
            preset->setDirty(dirty);
            storage->clearTweaks(preset);
        }
    } restore {storage, live, size, dirty};

    auto fileContent = [storage] () {
        storage->sync();
        QFile file(storage->filePath());
        return file.open(QIODevice::ReadOnly) ? file.readAll() : QByteArray();
    };

    // The artist's tweak, stored
    live->settings()->setPaintOpSize(size + 7);
    QVERIFY(storage->saveTweaks(live));
    const QByteArray before = fileContent();
    QVERIFY(!before.isEmpty());
    QVERIFY(storage->hasTweaks(live));

    // An agent pass: a move with a job, the brush changed from the script as the plugin does (size through the
    // preset, Preset.fromXML), and Krita's GUI trying to store the result as the artist's tweak.
    JobDocument d(200, 100);
    QVERIFY(d.doc->beginAgentMove("brush"));
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line({{20, 50}, {180, 50}}, 20)}, {{"preset", name}}));
    QVERIFY(job);
    QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
    live->settings()->setPaintOpSize(size + 70);
    QVERIFY(!storage->saveTweaks(live));          // Krita's slotGuiChangedCurrentPreset / sliderChanged while the agent works
    QVERIFY(d.doc->endAgentMove());
    QVERIFY(settle(job.data()));
    QCOMPARE(job->state(), QString("done"));
    d.image->waitForDone();

    QScopedPointer<Resource> resource(new Resource(live, ResourceType::PaintOpPresets));
    Preset script(resource.data());
    script.fromXML(script.toXML());               // the plugin's configure_brush / restore_brush
    QVERIFY(storage->isScriptChanged(live));
    live->settings()->setPaintOpSize(size + 80);
    QVERIFY(!storage->saveTweaks(live));          // after the pass: still the script's change, not the artist's

    QCOMPARE(fileContent(), before);
    QVERIFY(storage->hasTweaks(live));
}

void TestStrokeJobs::testPresetPropertiesApplyToTheJobsCopyOnly()
{
    const QString name = pressurePreset();
    QVERIFY(!name.isEmpty());
    KisPaintOpPresetSP live = KisGlobalResourcesInterface::instance()->source(ResourceType::PaintOpPresets)
                                  .bestMatch(QString(), QString(), name).dynamicCast<KisPaintOpPreset>();
    QVERIFY(live);
    const QString before = live->settings()->toXML();
    const bool dirty = live->isDirty();
    JobDocument d(200, 100);
    QScopedPointer<StrokeJob> job(d.paint->paintStrokes({line({{20, 50}, {180, 50}}, 20)},
                                                        {{"preset", name}, {"presetProperties", QVariantMap{{"MergedPaint", true}}}}));
    QVERIFY(job);
    QVERIFY2(job->state() != "failed", qPrintable(job->errorString()));
    QVERIFY(settle(job.data()));
    d.image->waitForDone();
    QCOMPARE(live->settings()->toXML(), before);          // the view's preset is untouched
    QCOMPARE(live->isDirty(), dirty);
    QVERIFY(!StrokeJobBrush::savedPreset(live)->settings()->getBool("MergedPaint")); // so is the saved copy

    QScopedPointer<StrokeJob> bad(d.paint->paintStrokes({line({{20, 50}, {180, 50}}, 20)},
                                                        {{"preset", name}, {"presetProperties", QVariantMap{{"MergedPaint", QVariantList{1}}}}}));
    QCOMPARE(bad->state(), QString("failed"));
    QVERIFY(bad->errorString().contains("presetProperties"));
}

KISTEST_TEMPORARY_HOME_MAIN(TestStrokeJobs)
