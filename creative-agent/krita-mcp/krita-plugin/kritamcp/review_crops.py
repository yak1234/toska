# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""The new ground rendered from the document for Luna's blank-canvas review (openspec full-detail-review-crops).

The review cut the new ground out of the canvas view, 1568 px on the long side: on a 12000 x 4000 canvas (Istanbul,
2026-11-10) a 6000 x 4000 px half was judged from about 780 x 523 px, where a faithful copy and a blurred enlargement
look alike. Here the fresh box is read from the projection: whole at up to SIDE px (one scaled read), with up to two
tiles at actual pixels chosen from that crop (its most detailed window and its median one), and tiles of the painting
the batch did not touch chosen the same way, so finish is compared at one scale.

Read-only: no layer, selection, undo step or refresh (the look before it recomposited). A large area is never read at
full size: without the fork's scaled read (canvas_projection.read_scaled) an area over FULL_READ pixels is refused, and
with the agent's guide lines showing the whole call is (the review judges the painting without them). The companion
then cuts the crop from the view as before.
"""
import time

SIDE = 1024            # the whole crop's long side, and a tile's side at actual pixels
TILES = 2              # tiles of the new ground, and of the painting
FULL_READ = 4000000    # pixels read at full size at most (a tile is about a million)
PAINTED_SIDE = 256     # a painted area is looked over at this many pixels to choose its tiles
PAINTED_LIMIT = 9      # painted areas a call takes (the ninths of the canvas)
REDUCED = 0.67         # a crop reduced below this scale gets tiles; above it the crop shows the pixels well enough
JPEG_QUALITY = 90


def windows(detail, tw, th):
    """Every tw x th window of `detail` (H x W floats) on a half-window grid, the last ones flush with the edges, as
    (mean detail, (x, y, w, h)). An area smaller than a window is one window of its own size."""
    import numpy as np
    h, w = detail.shape
    tw, th = max(1, min(tw, w)), max(1, min(th, h))
    total = np.pad(detail.astype(np.float64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    def starts(size, tile):
        found = list(range(0, size - tile + 1, max(1, tile // 2)))
        return found if found[-1] == size - tile else found + [size - tile]
    out = []
    for y in starts(h, th):
        for x in starts(w, tw):
            mean = (total[y + th, x + tw] - total[y, x + tw] - total[y + th, x] + total[y, x]) / (tw * th)
            out.append((round(float(mean), 6), (x, y, tw, th)))
    return out


def _overlap(a, b):
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return max(0, w) * max(0, h) / float(min(a[2] * a[3], b[2] * b[3]) or 1)


def choose(candidates, count):
    """Rects from (score, rect) candidates: the most detailed, then the median of those that overlap it by less than
    half (a typical part, not the next busiest). Ties go to the top-left, so the answer is the same each time."""
    ranked = sorted(candidates, key=lambda c: (-c[0], c[1][1], c[1][0]))
    if not ranked or count < 1:
        return []
    chosen = [ranked[0][1]]
    rest = [c for c in ranked[1:] if _overlap(c[1], chosen[0]) < 0.5]
    if count > 1 and rest:
        chosen.append(rest[len(rest) // 2][1])
    return chosen


def _rect(value, name, width, height):
    if (not isinstance(value, list) or len(value) != 4 or any(isinstance(v, bool) or not isinstance(v, int) for v in value)
            or value[0] < 0 or value[1] < 0 or value[2] <= 0 or value[3] <= 0 or value[0] + value[2] > width or value[1] + value[3] > height):
        raise ValueError('%s must fit the canvas: [x, y, width, height] in whole canvas pixels' % name)
    return value


def guides_showing(tools, doc, session):
    """Whether the agent's guide lines show in the projection; True on any doubt (the review then uses its view without them)."""
    try:
        group = tools._guide_group(doc, session=session)
        return bool(group is not None and group.visible() and any(child.visible() for child in group.childNodes()))
    except Exception:
        return True


def review_crops_operation(doc, params, guides=False):
    """The `review_crops` operation. `fresh` [x, y, w, h]: the new ground in canvas pixels. `painted`: up to
    PAINTED_LIMIT areas of the painting the batch did not touch. `tiles`: 0-2 (default TILES).
    Answers `whole` {image_base64, mime_type, source, out, scale}, `fresh_tiles` and `painting_tiles`
    [{image_base64, mime_type, source}] at actual pixels. JPEGs, see-through canvas black as the views show it."""
    from .creative_validation import fields
    fields(params, ('fresh', 'painted', 'tiles'), ('fresh',))
    width, height = doc.width(), doc.height()
    fresh = _rect(params['fresh'], 'fresh', width, height)
    painted = params.get('painted', [])
    if not isinstance(painted, list) or len(painted) > PAINTED_LIMIT:
        raise ValueError('painted must be at most %d areas' % PAINTED_LIMIT)
    painted = [_rect(area, 'each painted area', width, height) for area in painted]
    count = params.get('tiles', TILES)
    if isinstance(count, bool) or count not in (0, 1, 2):
        raise ValueError('tiles must be 0, 1 or 2')
    if guides:
        raise ValueError('The guide lines are showing: the review judges the painting without them.')
    started = time.monotonic()
    import base64
    import numpy as np
    from . import canvas_projection
    from .qt_compat import QBuffer, QIODevice, QImage, QPainter, QSize, Qt
    doc.waitForDone()

    def flat(image):
        out = QImage(image.size(), QImage.Format.Format_RGB32); out.fill(Qt.GlobalColor.black)
        painter = QPainter(out); painter.drawImage(0, 0, image); painter.end()
        return out

    def read(rect, side):
        """rect of the projection, at most `side` on its long side: (image, scale)."""
        x, y, w, h = rect
        scale = min(1.0, side / float(max(w, h)))
        if scale < 1:
            size = QSize(max(1, round(w * scale)), max(1, round(h * scale)))
            image = canvas_projection.read_scaled(doc, rect, scale)
            if image is None:
                if w * h > FULL_READ:
                    raise ValueError('This Krita cannot read a large area reduced.')
                image = doc.projection(x, y, w, h)
            if image.isNull():
                raise ValueError('The canvas could not be read.')
            if image.size() != size:
                image = image.scaled(size, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        else:
            image = doc.projection(x, y, w, h)
            if image.isNull():
                raise ValueError('The canvas could not be read.')
        return flat(image), scale

    def detail(image):
        w, h = image.width(), image.height()
        rows = np.frombuffer(image.constBits().asstring(image.sizeInBytes()), np.uint8).reshape(h, image.bytesPerLine())
        grey = rows[:, : w * 4].reshape(h, w, 4)[..., :3].astype(np.float32).sum(-1)
        out = np.zeros((h, w), np.float32)
        out[:, 1:] += np.abs(np.diff(grey, axis=1)); out[1:, :] += np.abs(np.diff(grey, axis=0))
        return out

    def part(image, **more):
        buffer = QBuffer(); buffer.open(QIODevice.OpenModeFlag.WriteOnly)
        if not image.save(buffer, 'JPEG', JPEG_QUALITY):
            raise ValueError('The crop could not be encoded.')
        return dict(image_base64=base64.b64encode(bytes(buffer.data())).decode('ascii'), mime_type='image/jpeg', **more)

    def candidates(rect, image, scale):
        """(score, a tile of `rect` in canvas pixels) for each window of its reduced image."""
        x, y, w, h = rect
        tw, th = min(SIDE, w), min(SIDE, h)
        out = []
        for score, (wx, wy, _ww, _wh) in windows(detail(image), max(1, round(tw * scale)), max(1, round(th * scale))):
            out.append((score, (min(x + w - tw, x + int(round(wx / scale))), min(y + h - th, y + int(round(wy / scale))), tw, th)))
        return out

    def tiles(found):
        return [part(read(list(tile), SIDE)[0], source=list(tile)) for tile in choose(found, count)]

    whole, scale = read(fresh, SIDE)
    result = {'status': 'ok', 'whole': part(whole, source=fresh, out=[whole.width(), whole.height()], scale=1 if scale >= 1 else round(scale, 4)),
              'fresh_tiles': tiles(candidates(fresh, whole, scale)) if count and scale < REDUCED else [], 'painting_tiles': []}
    if count and painted and scale < REDUCED:
        found = []
        for area in painted:
            image, reduced = read(area, PAINTED_SIDE)
            found += candidates(area, image, reduced)
        result['painting_tiles'] = tiles(found)
    result['ms'] = int((time.monotonic() - started) * 1000)
    return result
