# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""What a batch painted on empty canvas (openspec blank-canvas-review, goal 1).

Luna's move review compares the canvas before and after a batch. On empty canvas every batch is "a new rectangle that
BEFORE did not show", so a perfect copy onto an empty half was undone as a flat block (Istanbul, 2026-11-10). Whether
canvas was empty is measured here from the two views, never asked of a model: the share of the change that landed on
empty canvas, the share of the painting that became empty, the box of the new ground, and both per ninth (the cells
Luna's location question uses). Nothing here touches a document.

Empty is the view's commonest colour in large flat areas (painted_share's rule), so a big flat fill of that colour counts
as empty too: paint on it is judged as new ground, by what it reads as. The views carry no transparency to tell them apart.
"""
import time

SIDE = 256             # the views are compared at this many pixels on the long side
TOLERANCE = 10         # levels a channel: an empty area in a JPEG view is within a few levels of its colour
CHANGE = 16            # levels a channel: a pixel the batch changed
EMPTY_MIN = 0.05       # the canvas has empty areas only when its commonest colour covers this share of BEFORE
WINDOW = 8             # an empty area is at least 1/WINDOW of the short side across: dark shapes in the paint are paint
GROUND_LIMIT = 8      # boxes of unsettled ground a chat keeps
CELLS = ('top_left', 'top_center', 'top_right', 'middle_left', 'center', 'middle_right',
         'bottom_left', 'bottom_center', 'bottom_right')


def _box_mean(mask, k):
    """The mean of a k x k window around each pixel, edges repeated."""
    import numpy as np
    before, after = k // 2, k - 1 - k // 2
    padded = np.pad(mask.astype(np.float32), ((before, after), (before, after)), mode='edge')
    total = np.pad(padded.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    h, w = mask.shape
    return (total[k:k + h, k:k + w] - total[:h, k:k + w] - total[k:k + h, :w] + total[:h, :w]) / (k * k)


def _empty(rgb, colour, k):
    """Pixels of the empty colour that sit in an area of it at least k across (an opening: specks and small dark shapes
    inside the painting are not empty canvas, and the edge of a real empty area is kept)."""
    import numpy as np
    near = np.abs(rgb.astype(np.int16) - colour).max(-1) <= TOLERANCE
    core = _box_mean(near, k) >= 0.98
    return near & (_box_mean(core, k) > 0)


def change_map(before, after, ground=()):
    """before, after: H x W x 4 (or 3) uint8 arrays of one size, the canvas views around a batch.
    ground: boxes [x, y, w, h] in fractions of the view that count as empty before whatever they show: canvas that was
    empty when the chat first painted on it and has not read as a picture yet (a toned ground, a first layer of dabs).
    The next layer over it is still new ground, not paint laid over a painting.

    fresh_share: of the pixels the batch changed, the share that was empty canvas before.
    removed_share: of the pixels that were painted before, the share that is empty after.
    changed_share: of all pixels, the share the batch changed.
    fresh_box: [x, y, w, h] of the new ground as fractions of the view, or None.
    cells: per ninth, empty_before (share of the cell) and fresh (share of the cell that is new ground).
    """
    import numpy as np
    if before.shape[:2] != after.shape[:2]:
        raise ValueError('The two views must have one size.')
    b, a = before[..., :3], after[..., :3]
    h, w = b.shape[:2]
    # The canvas's empty colour: the commonest colour of BEFORE (painted_share's rule), in steps of 8 levels.
    keys = (b >> 3).astype(np.uint32)
    keys = (keys[..., 0] << 10) | (keys[..., 1] << 5) | keys[..., 2]
    values, counts = np.unique(keys, return_counts=True)
    top = int(counts.argmax())
    k = max(3, min(h, w) // WINDOW)
    if counts[top] / (h * w) >= EMPTY_MIN:
        colour = np.median(b[keys == values[top]].astype(np.int16), axis=0)
        empty_before, empty_after = _empty(b, colour, k), _empty(a, colour, k)
    else:
        empty_before = empty_after = np.zeros((h, w), bool)
    for x, y, bw, bh in ground:
        if empty_before is empty_after:
            empty_after = empty_after.copy()
        left, top_row = int(round(x * w)), int(round(y * h))
        empty_before[top_row:max(top_row + 1, int(round((y + bh) * h))), left:max(left + 1, int(round((x + bw) * w)))] = True
    changed = np.abs(b.astype(np.int16) - a.astype(np.int16)).max(-1) > CHANGE
    fresh = changed & empty_before
    painted = ~empty_before
    share = lambda part, whole: round(float(part.sum()) / float(whole.sum()), 4) if whole.any() else 0
    box = None
    if fresh.any():
        ys, xs = np.nonzero(fresh)
        left, top_row, right, bottom = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        box = [round(float(v), 4) for v in (left / w, top_row / h, (right - left) / w, (bottom - top_row) / h)]
        box = [int(v) if v in (0, 1) else v for v in box]
    cells = {}
    for index, name in enumerate(CELLS):
        row, column = divmod(index, 3)
        window = (slice(row * h // 3, (row + 1) * h // 3), slice(column * w // 3, (column + 1) * w // 3))
        size = max(1, empty_before[window].size)
        cells[name] = {'empty_before': round(float(empty_before[window].sum()) / size, 4),
                       'fresh': round(float(fresh[window].sum()) / size, 4)}
    return {'fresh_share': share(fresh, changed), 'removed_share': share(painted & empty_after, painted),
            'changed_share': round(float(changed.sum()) / (h * w), 4), 'fresh_box': box, 'cells': cells}


def change_map_operation(params):
    """The `change_map` operation: `before` and `after`, each {image_base64, sha256} (a PNG or JPEG view of the canvas),
    and optionally `ground` (boxes that count as empty before: change_map).
    Both are decoded reduced while read and compared at one small size. Read-only; no document is touched."""
    from .creative_validation import fields
    fields(params, ('before', 'after', 'ground'), ('before', 'after'))
    ground = params.get('ground', [])
    if not isinstance(ground, list) or len(ground) > GROUND_LIMIT:
        raise ValueError('ground must be at most %d boxes' % GROUND_LIMIT)
    for box in ground:
        if (not isinstance(box, list) or len(box) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in box)
                or box[2] <= 0 or box[3] <= 0 or box[0] + box[2] > 1.0001 or box[1] + box[3] > 1.0001):
            raise ValueError('each ground box is [x, y, w, h] in fractions of the view')
    started = time.monotonic()
    import numpy as np
    from .creative_reference import _trace_decode
    from .qt_compat import Qt
    images = []
    for key in ('before', 'after'):
        part = params[key]
        if not isinstance(part, dict):
            raise ValueError('%s must be {image_base64, sha256}' % key)
        fields(part, ('image_base64', 'sha256'), ('image_base64', 'sha256'))
        images.append(_trace_decode(part, SIDE)[0])
    width, height = images[0].width(), images[0].height()
    arrays = []
    for image in images:
        if (image.width(), image.height()) != (width, height):
            image = image.scaled(width, height, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        rows = np.frombuffer(image.constBits().asstring(image.sizeInBytes()), np.uint8).reshape(height, image.bytesPerLine())
        arrays.append(rows[:, : width * 4].reshape(height, width, 4).copy())
    return dict(change_map(*arrays, ground=ground), status='ok', ms=int((time.monotonic() - started) * 1000))
