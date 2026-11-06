/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "TestBrushStrokePreviewCache.h"

#include <testui.h>
#include <KisTemporaryHomeUiTest.h>
#include <simpletest.h>
#include <testutil.h>

#include <QDir>
#include <QDirIterator>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QMap>
#include <QPainter>
#include <QSet>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QTextStream>

#include <KisAgentHooks.h>
#include <KisAppIdentity.h>
#include <KisGlobalResourcesInterface.h>
#include <KisResourceModel.h>
#include <KisResourceThumbnailCache.h>
#include <KisResourceTypes.h>
#include <brushengine/kis_paintop_preset.h>
#include <brushengine/kis_paintop_settings.h>
#include <widgets/KisBrushStrokePreviewCache.h>
#include <KisBrushStrokePreviewGenerator.h>

namespace {

const QSize kCell(280, 96);
const QColor kInk(233, 227, 216);

KisPaintOpPresetSP makePreset(int id = 7, const QString &md5 = QStringLiteral("0123abcd"))
{
    KisPaintOpPresetSP preset(new KisPaintOpPreset(TestUtil::fetchDataFileLazy("autobrush_300px.kpp")));
    if (!preset->load(KisGlobalResourcesInterface::instance())) return KisPaintOpPresetSP();
    preset->setResourceId(id);
    preset->setMD5Sum(md5);
    preset->setDirty(false);
    return preset;
}

QStringList filesIn(const QString &folder)
{
    return QDir(folder).entryList(QDir::Files, QDir::Name);
}

/// Everything under \p root.
QSet<QString> treeOf(const QString &root)
{
    QSet<QString> entries;
    QDirIterator it(root, QDir::AllEntries | QDir::NoDotAndDotDot | QDir::Hidden, QDirIterator::Subdirectories);
    while (it.hasNext()) entries << it.next();
    return entries;
}

bool waitForGenerated(const KisBrushStrokePreviewCache &cache, int count, int timeoutMs = 60000)
{
    return QTest::qWaitFor([&] () { return cache.generatedCount() >= count && cache.pendingCount() == 0; }, timeoutMs);
}

void prepare(KisBrushStrokePreviewCache &cache)
{
    cache.setBusyProbeForTesting([] () { return false; });
    cache.setTimingForTesting(0, 0);
}

int paintedPixels(const QImage &image)
{
    const QImage argb = image.convertToFormat(QImage::Format_ARGB32);
    int painted = 0;
    for (int y = 0; y < argb.height(); y++) {
        const QRgb *line = reinterpret_cast<const QRgb *>(argb.constScanLine(y));
        for (int x = 0; x < argb.width(); x++) {
            if (qAlpha(line[x]) > 32) painted++;
        }
    }
    return painted;
}

bool s_agentWorks = false;
bool agentWorks()
{
    return s_agentWorks;
}

} // namespace

void TestBrushStrokePreviewCache::init()
{
    m_folder = QDir::homePath() + QStringLiteral("/preview-cache-test");
    QDir(m_folder).removeRecursively();
}

void TestBrushStrokePreviewCache::cleanup()
{
    KisAgentHooks::setAgentWorkProbe(nullptr);
    s_agentWorks = false;
    KisAppIdentity::setSettingsFolderForTesting(QString());
    QDir(m_folder).removeRecursively();
    QVERIFY(!QFileInfo::exists(m_folder));
}

void TestBrushStrokePreviewCache::testPaintsThenReusesFromDisk()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    QDateTime written;
    {
        KisBrushStrokePreviewCache cache(m_folder);
        prepare(cache);
        QSignalSpy ready(&cache, &KisBrushStrokePreviewCache::sigPreviewReady);

        QVERIFY(!cache.hasPreview(preset));
        QVERIFY(cache.preview(preset, kCell, kInk).isNull());
        QCOMPARE(cache.pendingCount(), 1);

        QVERIFY(waitForGenerated(cache, 1));
        QCOMPARE(ready.count(), 1);
        QCOMPARE(ready.first().first().toInt(), 7);
        QVERIFY(cache.hasPreview(preset));

        const QImage image = cache.preview(preset, kCell, kInk);
        QVERIFY(!image.isNull());
        QVERIFY(image.width() <= kCell.width() && image.height() <= kCell.height());
        QVERIFY2(paintedPixels(image) > 500, "the stroke must show");
        QCOMPARE(filesIn(m_folder).size(), 1);
        written = QFileInfo(m_folder + "/" + filesIn(m_folder).first()).lastModified();

        // Asked again: nothing is queued or painted.
        cache.preview(preset, kCell, kInk);
        QCOMPARE(cache.pendingCount(), 0);
        QCOMPARE(cache.generatedCount(), 1);
    }

    // A new session finds it on disk.
    KisBrushStrokePreviewCache again(m_folder);
    prepare(again);
    QVERIFY(again.hasPreview(preset));
    QVERIFY(!again.preview(preset, kCell, kInk).isNull());
    QTest::qWait(50);
    QCOMPARE(again.pendingCount(), 0);
    QCOMPARE(again.generatedCount(), 0);
    QCOMPARE(QFileInfo(m_folder + "/" + filesIn(m_folder).first()).lastModified(), written);
}

void TestBrushStrokePreviewCache::testPresetChangeInvalidates()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    KisBrushStrokePreviewCache cache(m_folder);
    prepare(cache);
    cache.request(preset);
    QVERIFY(waitForGenerated(cache, 1));
    const QString savedFile = filesIn(m_folder).first();
    const QImage before = cache.preview(preset, kCell, kInk);
    QVERIFY(!before.isNull());

    // A tweak: no preview for this state yet. The old one stands in while the new one is queued.
    preset->settings()->setPaintOpSize(4.0);
    preset->setDirty(true);
    QVERIFY(!cache.hasPreview(preset));
    const QImage standIn = cache.preview(preset, kCell, kInk);
    QCOMPARE(standIn, before);
    QCOMPARE(cache.pendingCount(), 1);
    QVERIFY(waitForGenerated(cache, 2));
    const QImage thin = cache.preview(preset, kCell, kInk);
    QVERIFY2(paintedPixels(thin) < paintedPixels(before), "a smaller brush paints a thinner stroke");
    QCOMPARE(filesIn(m_folder).size(), 2);

    // Another tweak replaces the first tweak's file, not the saved state's.
    preset->settings()->setPaintOpSize(9.0);
    cache.request(preset);
    QVERIFY(waitForGenerated(cache, 3));
    QCOMPARE(filesIn(m_folder).size(), 2);
    QVERIFY(filesIn(m_folder).contains(savedFile));

    // Reload: back to the saved state, at once and without painting.
    preset->setDirty(false);
    QVERIFY(cache.hasPreview(preset));
    QCOMPARE(cache.preview(preset, kCell, kInk), before);
    QCOMPARE(cache.pendingCount(), 0);
    QCOMPARE(cache.generatedCount(), 3);
}

void TestBrushStrokePreviewCache::testNewSavedStateReplacesOlderFiles()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    KisBrushStrokePreviewCache cache(m_folder);
    prepare(cache);
    cache.request(preset);
    QVERIFY(waitForGenerated(cache, 1));
    preset->setDirty(true);
    preset->settings()->setPaintOpSize(4.0);
    cache.request(preset);
    QVERIFY(waitForGenerated(cache, 2));
    QCOMPARE(filesIn(m_folder).size(), 2);

    // Saved over: a new MD5.
    preset->setDirty(false);
    preset->setMD5Sum(QStringLiteral("feed0001"));
    QVERIFY(!cache.hasPreview(preset));
    cache.request(preset);
    QVERIFY(waitForGenerated(cache, 3));
    QCOMPARE(filesIn(m_folder), QStringList(QStringLiteral("7_feed0001.png")));

    // Another preset's files are not touched.
    KisPaintOpPresetSP other = makePreset(70, QStringLiteral("00aa"));
    cache.request(other);
    QVERIFY(waitForGenerated(cache, 4));
    QCOMPARE(filesIn(m_folder).size(), 2);
}

void TestBrushStrokePreviewCache::testInvalidatePresetRemovesFiles()
{
    KisPaintOpPresetSP preset = makePreset();
    KisPaintOpPresetSP other = makePreset(70, QStringLiteral("00aa"));
    QVERIFY(preset && other);
    KisBrushStrokePreviewCache cache(m_folder);
    prepare(cache);
    cache.request(preset);
    cache.request(other);
    QVERIFY(waitForGenerated(cache, 2));

    cache.invalidatePreset(7);
    QCOMPARE(filesIn(m_folder), QStringList(QStringLiteral("70_00aa.png")));
    QVERIFY(!cache.hasPreview(preset));
    QVERIFY(cache.hasPreview(other));
    QVERIFY(cache.preview(preset, kCell, kInk).isNull());
}

void TestBrushStrokePreviewCache::testNothingToShowIsRemembered()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    preset->settings()->setPaintOpOpacity(0.0);
    {
        KisBrushStrokePreviewCache cache(m_folder);
        prepare(cache);
        cache.request(preset);
        QVERIFY(waitForGenerated(cache, 1));
        QVERIFY(cache.hasPreview(preset));
        QVERIFY(cache.hasNoPreview(preset));
        QVERIFY2(cache.preview(preset, kCell, kInk).isNull(), "the caller shows the thumbnail");
        QCOMPARE(cache.pendingCount(), 0);
    }
    KisBrushStrokePreviewCache again(m_folder);
    prepare(again);
    QVERIFY(again.hasNoPreview(preset));
    QVERIFY(again.preview(preset, kCell, kInk).isNull());
    QCOMPARE(again.pendingCount(), 0);
}

void TestBrushStrokePreviewCache::testPausedWhileBusy()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    KisBrushStrokePreviewCache cache(m_folder);
    bool busy = true;
    cache.setBusyProbeForTesting([&busy] () { return busy; });
    cache.setTimingForTesting(0, 0);

    cache.request(preset);
    QTest::qWait(700);
    QCOMPARE(cache.generatedCount(), 0);
    QCOMPARE(cache.pendingCount(), 1);
    QVERIFY(cache.isPaused());
    QVERIFY(filesIn(m_folder).isEmpty());

    busy = false;
    QVERIFY(waitForGenerated(cache, 1));
    QVERIFY(!cache.isPaused());
    QCOMPARE(filesIn(m_folder).size(), 1);
}

void TestBrushStrokePreviewCache::testPausedWhileAgentWorks()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);

    // The generator's own default probe, through the hook libkis's Document.agentActive() state answers.
    KisAgentHooks::setAgentWorkProbe(&agentWorks);
    s_agentWorks = true;
    QVERIFY(KisBrushStrokePreviewGenerator::systemIsBusy());

    KisBrushStrokePreviewCache cache(m_folder);
    cache.setTimingForTesting(0, 0);
    cache.request(preset);
    QTest::qWait(700);
    QCOMPARE(cache.generatedCount(), 0);
    QVERIFY(cache.isPaused());

    s_agentWorks = false;
    QVERIFY(!KisBrushStrokePreviewGenerator::systemIsBusy());
    QVERIFY(waitForGenerated(cache, 1));
}

void TestBrushStrokePreviewCache::testWaitsForTheQuietPeriod()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    KisBrushStrokePreviewCache cache(m_folder);
    bool busy = true;
    cache.setBusyProbeForTesting([&busy] () { return busy; });
    cache.setTimingForTesting(1200, 0);
    cache.request(preset);
    QTest::qWait(600);
    busy = false;

    QElapsedTimer sinceIdle;
    sinceIdle.start();
    // The last busy reading was at most one poll (500 ms) before the switch, so nothing can start for 700 ms.
    QTest::qWait(600);
    QCOMPARE(cache.generatedCount(), 0);
    QVERIFY(waitForGenerated(cache, 1));
    QVERIFY(sinceIdle.elapsed() >= 700);
}

void TestBrushStrokePreviewCache::testNothingWrittenOutsideTheFolder()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation);
    const QSet<QString> homeBefore = treeOf(QDir::homePath());
    const QSet<QString> workBefore = treeOf(QDir::currentPath());
    {
        KisBrushStrokePreviewCache cache(m_folder);
        prepare(cache);
        cache.request(preset);
        QVERIFY(waitForGenerated(cache, 1));
        preset->setDirty(true);
        preset->settings()->setPaintOpSize(5.0);
        cache.request(preset);
        QVERIFY(waitForGenerated(cache, 2));
    }

    const QSet<QString> workAdded = treeOf(QDir::currentPath()) - workBefore;
    QVERIFY2(workAdded.isEmpty(), qPrintable(QStringList(workAdded.values()).join(", ")));
    const QSet<QString> added = treeOf(QDir::homePath()) - homeBefore;
    QVERIFY(!added.isEmpty());
    for (const QString &path : added) {
        QVERIFY2(path == m_folder || path.startsWith(m_folder + QLatin1Char('/')), qPrintable(path));
    }
}

void TestBrushStrokePreviewCache::testFolderFollowsTheIdentity()
{
    KisAppIdentity::setSettingsFolderForTesting(QStringLiteral("ToskaPreviewTest"));
    const QString own = KisBrushStrokePreviewCache::defaultFolder();
    const QString base = QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + "/ToskaPreviewTest/";
    QVERIFY2(own.startsWith(base), qPrintable(own));
    QVERIFY(own.contains(QLatin1String("brush_stroke_previews")));

    // Naming the folder creates nothing.
    QVERIFY(!QFileInfo::exists(own));

    KisAppIdentity::setSettingsFolderForTesting(QString());
    QVERIFY(KisBrushStrokePreviewCache::defaultFolder() != own);
}

void TestBrushStrokePreviewCache::testMaskHelpers()
{
    QImage stroke(4, 1, QImage::Format_ARGB32);
    stroke.fill(qRgba(255, 255, 255, 0));
    stroke.setPixel(1, 0, qRgba(255, 255, 255, 128));
    stroke.setPixel(2, 0, qRgba(255, 255, 255, 255));
    const QImage mask = KisBrushStrokePreviewCache::maskFromStroke(stroke);
    QCOMPARE(mask.format(), QImage::Format_Grayscale8);
    QCOMPARE(int(mask.constScanLine(0)[0]), 0);
    QCOMPARE(int(mask.constScanLine(0)[1]), 128);
    QCOMPARE(int(mask.constScanLine(0)[2]), 255);

    // Stripes that did not move are nothing; moved ones show, amplified.
    QImage before(3, 1, QImage::Format_ARGB32);
    before.setPixel(0, 0, qRgb(80, 80, 80));
    before.setPixel(1, 0, qRgb(80, 80, 80));
    before.setPixel(2, 0, qRgb(140, 140, 140));
    QImage after = before;
    after.setPixel(1, 0, qRgb(100, 100, 100));
    after.setPixel(2, 0, qRgb(255, 255, 255));
    const QImage moved = KisBrushStrokePreviewCache::maskFromDifference(before, after);
    QCOMPARE(int(moved.constScanLine(0)[0]), 0);
    QCOMPARE(int(moved.constScanLine(0)[1]), 60);
    QCOMPARE(int(moved.constScanLine(0)[2]), 255);

    // Faint paint is lifted, at most three times; strong paint is left alone.
    QImage faint(1000, 1, QImage::Format_Grayscale8);
    faint.fill(0);
    for (int x = 0; x < 500; x++) faint.scanLine(0)[x] = 100;
    faint.scanLine(0)[500] = 255; // a stray pixel does not count as the strongest paint
    QCOMPARE(int(KisBrushStrokePreviewCache::liftFaintMask(faint).constScanLine(0)[0]), 230);
    QCOMPARE(int(KisBrushStrokePreviewCache::liftFaintMask(faint).constScanLine(0)[999]), 0);
    faint.fill(0);
    for (int x = 0; x < 500; x++) faint.scanLine(0)[x] = 20;
    QCOMPARE(int(KisBrushStrokePreviewCache::liftFaintMask(faint).constScanLine(0)[0]), 60);
    faint.fill(240);
    QCOMPARE(KisBrushStrokePreviewCache::liftFaintMask(faint), faint);

    // Too little to see is nothing to show.
    QImage few(100, 10, QImage::Format_Grayscale8);
    few.fill(0);
    for (int x = 0; x < 100; x++) few.scanLine(0)[x] = 200;
    QVERIFY(!KisBrushStrokePreviewCache::hasVisibleStroke(few));
    for (int x = 0; x < 100; x++) few.scanLine(1)[x] = 200;
    QVERIFY(KisBrushStrokePreviewCache::hasVisibleStroke(few));

    // The tint is the colour, the mask the alpha, and the picture keeps its aspect inside the size.
    QImage wide(40, 10, QImage::Format_Grayscale8);
    wide.fill(255);
    const QImage tinted = KisBrushStrokePreviewCache::renderMask(wide, QSize(20, 20), QColor(10, 20, 30));
    QCOMPARE(tinted.size(), QSize(20, 5));
    QCOMPARE(tinted.pixel(3, 3), qRgba(10, 20, 30, 255));
}

void TestBrushStrokePreviewCache::testGeneratingDoesNotTouchThePreset()
{
    KisPaintOpPresetSP preset = makePreset();
    QVERIFY(preset);
    const QString xml = preset->settings()->toXML();
    KisBrushStrokePreviewCache cache(m_folder);
    prepare(cache);
    cache.request(preset);
    QVERIFY(waitForGenerated(cache, 1));
    QCOMPARE(preset->settings()->toXML(), xml);
    QVERIFY(!preset->isDirty());
}

void TestBrushStrokePreviewCache::testContactSheet()
{
    const QString sheetFolder = qEnvironmentVariable("TOSKA_PREVIEW_SHEET");
    if (sheetFolder.isEmpty()) QSKIP("Set TOSKA_PREVIEW_SHEET to a folder to write the contact sheets");

    KisBrushStrokePreviewCache cache(m_folder);
    prepare(cache);
    KisResourceModel model(ResourceType::PaintOpPresets);

    struct Row {
        QModelIndex index;
        QString name;
        QString engine;
        int ms {0};
    };
    QVector<Row> rows;
    QMap<QString, QVector<int>> timings;
    QElapsedTimer all;
    all.start();
    for (int i = 0; i < model.rowCount(); i++) {
        const QModelIndex index = model.index(i, 0);
        KisPaintOpPresetSP preset = model.resourceForIndex(index).dynamicCast<KisPaintOpPreset>();
        if (!preset) continue;
        const int before = cache.generatedCount();
        cache.request(preset);
        QVERIFY2(QTest::qWaitFor([&] () { return cache.pendingCount() == 0; }, 120000), qPrintable(preset->name()));
        const int ms = cache.generatedCount() > before ? cache.lastGenerationMs() : 0;
        rows.append({index, preset->name(), preset->paintOp().id(), ms});
        timings[preset->paintOp().id()] << ms;
    }

    // The runner shows only verdicts, so the numbers go beside the pictures.
    QFile report(sheetFolder + QStringLiteral("/previews.txt"));
    QVERIFY(report.open(QIODevice::WriteOnly | QIODevice::Text));
    QTextStream out(&report);
    out << "presets " << rows.size() << " painted " << cache.generatedCount() << " total ms " << all.elapsed() << "\n";
    for (auto it = timings.constBegin(); it != timings.constEnd(); ++it) {
        QVector<int> values = it.value();
        std::sort(values.begin(), values.end());
        out << "engine " << it.key() << " count " << values.size() << " median ms " << values[values.size() / 2]
            << " max ms " << values.last() << "\n";
    }

    // Stroke cells as the chooser draws them, on each theme.
    const struct Theme {
        const char *name;
        QColor window, cell, text;
    } themes[] = {{"night", QColor("#141b25"), QColor("#0e141c"), QColor(233, 227, 216)},
                  {"day", QColor("#efe8dc"), QColor("#f8f3ea"), QColor(42, 52, 66)}};
    const int columns = 6, cellWidth = 164, cellHeight = 84, gap = 8;
    const int rowCount = (rows.size() + columns - 1) / columns;
    for (const Theme &theme : themes) {
        QImage sheet((cellWidth + gap) * columns + gap, (cellHeight + gap) * rowCount + gap, QImage::Format_ARGB32_Premultiplied);
        sheet.fill(theme.window);
        QPainter painter(&sheet);
        QFont font = painter.font();
        font.setPixelSize(11);
        painter.setFont(font);
        for (int i = 0; i < rows.size(); i++) {
            const QRect cell(gap + (i % columns) * (cellWidth + gap), gap + (i / columns) * (cellHeight + gap), cellWidth, cellHeight);
            painter.fillRect(cell, theme.cell);
            KisPaintOpPresetSP preset = model.resourceForIndex(rows[i].index).dynamicCast<KisPaintOpPreset>();
            const QRect strokeRect = cell.adjusted(6, 6, -6, -22);
            const QImage image = cache.preview(preset, strokeRect.size(), theme.text);
            if (image.isNull()) {
                painter.setPen(QColor(200, 80, 60));
                painter.drawText(strokeRect, Qt::AlignCenter, QStringLiteral("thumbnail"));
            } else {
                painter.drawImage(strokeRect.center() - image.rect().center(), image);
            }
            painter.setPen(theme.text);
            painter.drawText(cell.adjusted(6, cell.height() - 20, -6, -2), Qt::AlignLeft | Qt::AlignVCenter,
                             painter.fontMetrics().elidedText(rows[i].name, Qt::ElideRight, cell.width() - 12));
        }
        painter.end();
        QVERIFY(sheet.save(sheetFolder + QStringLiteral("/previews-%1.png").arg(QString::fromLatin1(theme.name))));
    }

    int nothing = 0;
    QStringList names;
    for (const Row &row : rows) {
        KisPaintOpPresetSP preset = model.resourceForIndex(row.index).dynamicCast<KisPaintOpPreset>();
        if (cache.hasNoPreview(preset)) {
            nothing++;
            names << row.engine + QLatin1Char(':') + row.name;
        }
    }
    out << "nothing to show " << nothing << " " << names.join(", ") << "\n";
}

KISTEST_TEMPORARY_HOME_MAIN(TestBrushStrokePreviewCache)
