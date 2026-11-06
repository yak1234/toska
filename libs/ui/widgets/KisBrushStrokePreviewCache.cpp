/*
 *  SPDX-FileCopyrightText: 2026 Tenzin Rangdol <tenzindraws@gmail.com>
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Ported from Krita-Revamp (10zindraws / Tenzin Rangdol, GPL-3.0), final form of commits 26851a8, a9698ce, 681ef9f.
 * See AGENT-FORK.md, "Ported from Krita-Revamp: stroke previews".
 */

#include "KisBrushStrokePreviewCache.h"

#include <QCache>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QHash>
#include <QPointer>
#include <QRegularExpression>
#include <QSaveFile>
#include <QStringList>
#include <QTimer>

#include <KisAppIdentity.h>
#include <KisResourceModel.h>
#include <KisResourceTypes.h>
#include <kis_paintop_settings.h>

#include "KisBrushStrokePreviewGenerator.h"

namespace {

const char *kFolderName = "brush_stroke_previews";
// A generation of the picture itself: raise it when the stroke or the mask changes, and every preview is painted anew.
const char *kSubfolder = "v1";

constexpr int kMaskCacheBytes = 48 * 1024 * 1024;
constexpr int kRenderedCacheBytes = 32 * 1024 * 1024;

/// The settings as they show in a stroke (Revamp's generateSettingsFingerprint): the texture offsets vary per stroke.
QString settingsFingerprint(KisPaintOpPresetSP preset)
{
    if (!preset || !preset->settings()) return QString();
    QString xml = preset->settings()->toXML();
    static const QRegularExpression strokeTimeParams(
        QStringLiteral("<param name=\"Texture/Pattern/Offset[XY]\"[^>]*>[^<]*</param>\\s*"));
    xml.remove(strokeTimeParams);
    return QString::fromLatin1(QCryptographicHash::hash(xml.toUtf8(), QCryptographicHash::Md5).toHex().left(16));
}

QString keyOf(int resourceId, const QString &md5, const QString &tweakHash)
{
    QString key = QString::number(resourceId) + QLatin1Char('_') + md5;
    if (!tweakHash.isEmpty()) key += QLatin1Char('_') + tweakHash;
    return key;
}

int costOf(const QImage &image)
{
    return qMax<qint64>(1, image.sizeInBytes());
}

} // namespace

struct KisBrushStrokePreviewCache::Private {
    QString folder;
    QCache<QString, QImage> masks {kMaskCacheBytes};
    QCache<QString, QImage> rendered {kRenderedCacheBytes};
    /// The newest state of each preset that was seen with a result: it stands in while a changed preset waits.
    QHash<int, QString> newestKey;
    QScopedPointer<KisBrushStrokePreviewGenerator> generator;
    KisResourceModel *model {nullptr};
    bool wantAll {false};
    bool requestAllScheduled {false};

    QString pathOf(const QString &key) const
    {
        return folder + QLatin1Char('/') + key + QStringLiteral(".png");
    }

    /// The mask of \p key from memory or disk; null if there is none. A 1x1 mask marks nothing to show.
    const QImage *maskOf(const QString &key)
    {
        const QImage *mask = masks.object(key);
        if (mask) return mask;
        const QString path = pathOf(key);
        if (!QFile::exists(path)) return nullptr;
        QImage loaded(path);
        if (loaded.isNull()) {
            // A damaged file is the same as none.
            QFile::remove(path);
            return nullptr;
        }
        loaded.convertTo(QImage::Format_Grayscale8);
        const int cost = costOf(loaded);
        masks.insert(key, new QImage(loaded), cost);
        return masks.object(key);
    }

    QImage renderedOf(const QString &key, const QImage &mask, const QSize &size, const QColor &tint)
    {
        const QString renderedKey = QStringLiteral("%1|%2x%3|%4")
                                        .arg(key)
                                        .arg(size.width())
                                        .arg(size.height())
                                        .arg(tint.rgba(), 8, 16, QLatin1Char('0'));
        if (const QImage *known = rendered.object(renderedKey)) return *known;
        const QImage image = KisBrushStrokePreviewCache::renderMask(mask, size, tint);
        rendered.insert(renderedKey, new QImage(image), costOf(image));
        return image;
    }

    /// What preview() and previewForIndex() share.
    QImage imageFor(int resourceId, const QString &key, const QSize &size, const QColor &tint, bool *missing)
    {
        *missing = false;
        if (size.isEmpty()) return QImage();
        const QImage *mask = maskOf(key);
        if (mask) {
            newestKey[resourceId] = key;
        } else {
            *missing = true;
            const QString stand = newestKey.value(resourceId);
            if (!stand.isEmpty()) mask = maskOf(stand);
            if (!mask) return QImage();
        }
        if (mask->width() <= 1) return QImage();
        const QString shownKey = *missing ? newestKey.value(resourceId) : key;
        return renderedOf(shownKey, *mask, size, tint);
    }
};

KisBrushStrokePreviewCache::KisBrushStrokePreviewCache(const QString &folder, QObject *parent)
    : QObject(parent)
    , m_d(new Private)
{
    m_d->folder = folder;
    QDir().mkpath(m_d->folder);
    m_d->generator.reset(new KisBrushStrokePreviewGenerator(this));
}

KisBrushStrokePreviewCache::~KisBrushStrokePreviewCache()
{
    shutdown();
}

KisBrushStrokePreviewCache *KisBrushStrokePreviewCache::instance()
{
    // Never deleted: it would outlive QApplication, and its only widget is gone by then (shutdown()).
    static KisBrushStrokePreviewCache *s_instance = [] () {
        KisBrushStrokePreviewCache *cache = new KisBrushStrokePreviewCache(defaultFolder());
        QObject::connect(qApp, &QCoreApplication::aboutToQuit, cache, &KisBrushStrokePreviewCache::shutdown);
        return cache;
    }();
    return s_instance;
}

QString KisBrushStrokePreviewCache::defaultFolder()
{
    return KisAppIdentity::cacheLocation() + QLatin1Char('/') + QLatin1String(kFolderName) + QLatin1Char('/')
        + QLatin1String(kSubfolder);
}

QString KisBrushStrokePreviewCache::folder() const
{
    return m_d->folder;
}

bool KisBrushStrokePreviewCache::needsStripedBackground(const QString &paintOpId)
{
    return paintOpId == QLatin1String("colorsmudge") || paintOpId == QLatin1String("deformbrush")
        || paintOpId == QLatin1String("filter");
}

bool KisBrushStrokePreviewCache::isNoPreviewEngine(const QString &paintOpId)
{
    return paintOpId == QLatin1String("roundmarker") || paintOpId == QLatin1String("experimentbrush")
        || paintOpId == QLatin1String("duplicate");
}

QImage KisBrushStrokePreviewCache::maskFromStroke(const QImage &painted)
{
    if (painted.isNull()) return QImage();
    const QImage source = painted.convertToFormat(QImage::Format_ARGB32);
    QImage mask(source.size(), QImage::Format_Grayscale8);
    for (int y = 0; y < source.height(); y++) {
        const QRgb *in = reinterpret_cast<const QRgb *>(source.constScanLine(y));
        uchar *out = mask.scanLine(y);
        for (int x = 0; x < source.width(); x++) {
            out[x] = uchar(qAlpha(in[x]));
        }
    }
    return mask;
}

QImage KisBrushStrokePreviewCache::maskFromDifference(const QImage &reference, const QImage &painted)
{
    if (painted.isNull() || reference.size() != painted.size()) return QImage();
    const QImage before = reference.convertToFormat(QImage::Format_ARGB32);
    const QImage after = painted.convertToFormat(QImage::Format_ARGB32);
    QImage mask(after.size(), QImage::Format_Grayscale8);
    // The stripes are 60 levels apart, and white over them moves a pixel by 115 or 175: three times the largest channel
    // move gives a white stroke full coverage on both stripes, and a smudge that only blends them reads clearly.
    constexpr int kGain = 3;
    for (int y = 0; y < after.height(); y++) {
        const QRgb *a = reinterpret_cast<const QRgb *>(before.constScanLine(y));
        const QRgb *b = reinterpret_cast<const QRgb *>(after.constScanLine(y));
        uchar *out = mask.scanLine(y);
        for (int x = 0; x < after.width(); x++) {
            const int moved = qMax(qAbs(qRed(a[x]) - qRed(b[x])),
                                   qMax(qAbs(qGreen(a[x]) - qGreen(b[x])), qAbs(qBlue(a[x]) - qBlue(b[x]))));
            out[x] = uchar(qMin(255, moved * kGain));
        }
    }
    return mask;
}

QImage KisBrushStrokePreviewCache::liftFaintMask(const QImage &mask)
{
    if (mask.isNull()) return mask;
    QVector<qint64> histogram(256, 0);
    qint64 painted = 0;
    for (int y = 0; y < mask.height(); y++) {
        const uchar *line = mask.constScanLine(y);
        for (int x = 0; x < mask.width(); x++) {
            if (line[x]) {
                histogram[line[x]]++;
                painted++;
            }
        }
    }
    if (!painted) return mask;
    constexpr int kTarget = 230;
    constexpr int kMostGain = 3;
    qint64 above = 0;
    int peak = 255;
    while (peak > 1 && (above + histogram[peak]) * 200 <= painted) {
        above += histogram[peak];
        peak--;
    }
    if (peak >= kTarget) return mask;
    const int gainPercent = qMin(kMostGain * 100, kTarget * 100 / peak);
    QImage lifted = mask;
    for (int y = 0; y < lifted.height(); y++) {
        uchar *line = lifted.scanLine(y);
        for (int x = 0; x < lifted.width(); x++) {
            line[x] = uchar(qMin(255, line[x] * gainPercent / 100));
        }
    }
    return lifted;
}

bool KisBrushStrokePreviewCache::hasVisibleStroke(const QImage &mask)
{
    constexpr int kClearlyPainted = 40;
    constexpr int kEnoughPixels = 120;
    int seen = 0;
    for (int y = 0; y < mask.height(); y++) {
        const uchar *line = mask.constScanLine(y);
        for (int x = 0; x < mask.width(); x++) {
            if (line[x] >= kClearlyPainted && ++seen >= kEnoughPixels) return true;
        }
    }
    return false;
}

QImage KisBrushStrokePreviewCache::renderMask(const QImage &mask, const QSize &size, const QColor &tint)
{
    if (mask.isNull() || size.isEmpty()) return QImage();
    const QImage gray = mask.format() == QImage::Format_Grayscale8 ? mask : mask.convertToFormat(QImage::Format_Grayscale8);
    const QImage scaled = gray.scaled(size, Qt::KeepAspectRatio, Qt::SmoothTransformation);
    QImage image(scaled.size(), QImage::Format_ARGB32_Premultiplied);
    const int r = tint.red(), g = tint.green(), b = tint.blue(), alpha = tint.alpha();
    for (int y = 0; y < scaled.height(); y++) {
        const uchar *in = scaled.constScanLine(y);
        QRgb *out = reinterpret_cast<QRgb *>(image.scanLine(y));
        for (int x = 0; x < scaled.width(); x++) {
            const int a = in[x] * alpha / 255;
            out[x] = qRgba(r * a / 255, g * a / 255, b * a / 255, a);
        }
    }
    return image;
}

QString KisBrushStrokePreviewCache::keyFor(KisPaintOpPresetSP preset)
{
    if (!preset) return QString();
    return keyOf(preset->resourceId(), preset->md5Sum(false), preset->isDirty() ? settingsFingerprint(preset) : QString());
}

bool KisBrushStrokePreviewCache::isKnown(const QString &key) const
{
    return m_d->masks.contains(key) || QFile::exists(m_d->pathOf(key));
}

bool KisBrushStrokePreviewCache::hasPreview(KisPaintOpPresetSP preset) const
{
    return preset && isKnown(keyFor(preset));
}

bool KisBrushStrokePreviewCache::hasNoPreview(KisPaintOpPresetSP preset) const
{
    if (!preset) return false;
    const QImage *mask = m_d->maskOf(keyFor(preset));
    return mask && mask->width() <= 1;
}

QImage KisBrushStrokePreviewCache::preview(KisPaintOpPresetSP preset, const QSize &size, const QColor &tint)
{
    if (!preset) return QImage();
    bool missing = false;
    const QImage image = m_d->imageFor(preset->resourceId(), keyFor(preset), size, tint, &missing);
    if (missing) m_d->generator->enqueue(preset->resourceId(), preset, true);
    return image;
}

QImage KisBrushStrokePreviewCache::previewForIndex(const QModelIndex &index, const QSize &size, const QColor &tint)
{
    if (!index.isValid()) return QImage();
    const int id = index.data(Qt::UserRole + KisAbstractResourceModel::Id).toInt();
    QString key;
    KisPaintOpPresetSP loaded;
    if (index.data(Qt::UserRole + KisAbstractResourceModel::Dirty).toBool()) {
        // Only a preset already in memory can be dirty, so this loads nothing new.
        const KisAbstractResourceModel *model = dynamic_cast<const KisAbstractResourceModel *>(index.model());
        if (model) loaded = model->resourceForIndex(index).dynamicCast<KisPaintOpPreset>();
    }
    if (loaded) {
        key = keyFor(loaded);
    } else {
        key = keyOf(id, index.data(Qt::UserRole + KisAbstractResourceModel::MD5).toString(), QString());
    }
    bool missing = false;
    const QImage image = m_d->imageFor(id, key, size, tint, &missing);
    if (missing) m_d->generator->enqueue(id, loaded, true);
    return image;
}

void KisBrushStrokePreviewCache::request(KisPaintOpPresetSP preset)
{
    if (preset && !hasPreview(preset)) {
        m_d->generator->enqueue(preset->resourceId(), preset, false);
    }
}

void KisBrushStrokePreviewCache::requestAll()
{
    if (!m_d->model) {
        m_d->model = new KisResourceModel(ResourceType::PaintOpPresets, this);
        auto schedule = [this] () {
            if (m_d->requestAllScheduled) return;
            m_d->requestAllScheduled = true;
            QTimer::singleShot(0, this, SLOT(slotRequestAllNow()));
        };
        connect(m_d->model, &QAbstractItemModel::rowsInserted, this, schedule);
        connect(m_d->model, &QAbstractItemModel::modelReset, this, schedule);
    }
    m_d->wantAll = true;
    slotRequestAllNow();
}

void KisBrushStrokePreviewCache::slotRequestAllNow()
{
    m_d->requestAllScheduled = false;
    if (!m_d->wantAll || !m_d->model) return;
    for (int row = 0; row < m_d->model->rowCount(); row++) {
        const QModelIndex index = m_d->model->index(row, 0);
        const int id = index.data(Qt::UserRole + KisAbstractResourceModel::Id).toInt();
        const QString md5 = index.data(Qt::UserRole + KisAbstractResourceModel::MD5).toString();
        // A preset with tweaks is requested when it is shown: this pass only sees the saved state.
        if (!isKnown(keyOf(id, md5, QString()))) {
            m_d->generator->enqueue(id, KisPaintOpPresetSP(), false);
        }
    }
}

void KisBrushStrokePreviewCache::invalidatePreset(int resourceId)
{
    const QString prefix = QString::number(resourceId) + QLatin1Char('_');
    const QStringList files = QDir(m_d->folder).entryList({prefix + QStringLiteral("*.png")}, QDir::Files);
    for (const QString &file : files) {
        QFile::remove(m_d->folder + QLatin1Char('/') + file);
    }
    const QList<QString> known = m_d->masks.keys();
    for (const QString &key : known) {
        if (key.startsWith(prefix)) m_d->masks.remove(key);
    }
    const QList<QString> renderedKeys = m_d->rendered.keys();
    for (const QString &key : renderedKeys) {
        if (key.startsWith(prefix)) m_d->rendered.remove(key);
    }
    m_d->newestKey.remove(resourceId);
}

void KisBrushStrokePreviewCache::storePreview(int resourceId, const QString &key, const QImage &mask)
{
    QImage stored = mask;
    if (stored.isNull()) {
        stored = QImage(1, 1, QImage::Format_Grayscale8);
        stored.fill(0);
    }

    // The newest tweaked state replaces the older tweaked ones of this preset. The saved state stays: Reload returns to it
    // at once. A new saved state (another MD5) replaces everything older.
    const QString prefix = QString::number(resourceId) + QLatin1Char('_');
    const QStringList files = QDir(m_d->folder).entryList({prefix + QStringLiteral("*.png")}, QDir::Files);
    const QString savedPrefix = key.section(QLatin1Char('_'), 0, 1);
    const bool isTweaked = key.count(QLatin1Char('_')) >= 2;
    for (const QString &file : files) {
        const QString other = file.chopped(4);
        if (other == key) continue;
        if (isTweaked && other == savedPrefix) continue;
        QFile::remove(m_d->folder + QLatin1Char('/') + file);
        m_d->masks.remove(other);
    }

    QDir().mkpath(m_d->folder);
    QSaveFile file(m_d->pathOf(key));
    if (file.open(QIODevice::WriteOnly) && stored.save(&file, "PNG")) {
        file.commit();
    } else {
        file.cancelWriting();
    }
    m_d->masks.insert(key, new QImage(stored), costOf(stored));
    m_d->newestKey[resourceId] = key;
    Q_EMIT sigPreviewReady(resourceId);
}

void KisBrushStrokePreviewCache::shutdown()
{
    if (m_d->generator) m_d->generator->shutdown();
}

int KisBrushStrokePreviewCache::pendingCount() const
{
    return m_d->generator->pendingCount();
}

int KisBrushStrokePreviewCache::generatedCount() const
{
    return m_d->generator->generatedCount();
}

int KisBrushStrokePreviewCache::lastGenerationMs() const
{
    return m_d->generator->lastGenerationMs();
}

bool KisBrushStrokePreviewCache::isPaused() const
{
    return m_d->generator->isPaused();
}

void KisBrushStrokePreviewCache::setBusyProbeForTesting(const std::function<bool()> &probe)
{
    m_d->generator->setBusyProbe(probe);
}

void KisBrushStrokePreviewCache::setTimingForTesting(int quietMs, int gapMs)
{
    m_d->generator->setTiming(quietMs, gapMs);
}
