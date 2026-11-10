# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""review_crops (review_crops.py): the new ground rendered from the document for Luna's blank-canvas review, with 1:1
tiles of it and of the painting beside it. The window choice is plain numpy; the operation runs with real Qt in a
child process against a stub document (the other plugin tests stub Qt). Images are made in memory; nothing is written."""
import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest

import numpy as np

PLUGIN = pathlib.Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
spec = importlib.util.spec_from_file_location('review_crops_under_test', PLUGIN / 'review_crops.py')
crops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crops)


class WindowTests(unittest.TestCase):
    def test_the_most_detailed_window_then_the_median_one(self):
        detail = np.zeros((40, 120), np.float32)
        detail[:, 80:] = 9      # the busiest part
        detail[:, 40:80] = 3
        found = crops.windows(detail, 20, 20)
        self.assertTrue(all(0 <= x <= 100 and 0 <= y <= 20 for _s, (x, y, _w, _h) in found))
        chosen = crops.choose(found, 2)
        self.assertEqual(len(chosen), 2)
        self.assertGreaterEqual(chosen[0][0], 80)
        self.assertLess(chosen[1][0], 80, 'the second is a typical window, not the next busiest')
        self.assertEqual(chosen, crops.choose(crops.windows(detail, 20, 20), 2), 'the same answer each time')

    def test_one_window_when_the_area_is_one_tile(self):
        found = crops.windows(np.ones((10, 10), np.float32), 20, 20)
        self.assertEqual([rect for _s, rect in found], [(0, 0, 10, 10)])
        self.assertEqual(crops.choose(found, 2), [(0, 0, 10, 10)])
        self.assertEqual(crops.choose([], 2), [])


SETUP = '''
import sys, json, base64
import numpy as np, cv2
package = __import__('types').ModuleType('kritamcp_child'); package.__path__ = [%r]; sys.modules['kritamcp_child'] = package
from kritamcp_child.qt_compat import QApplication, QImage, QRect, Qt
app = QApplication.instance() or QApplication([])
import kritamcp_child.review_crops as r
W, H = 6000, 2000
rng = np.random.default_rng(4)
canvas = np.zeros((H, W, 4), np.uint8)
# The left half is a painting (soft shapes, a busy patch); the right half new ground: flat, with one busy patch.
canvas[:, :3000, :3] = cv2.resize(rng.integers(40, 250, (10, 15, 3), dtype=np.uint8), (3000, H), interpolation=cv2.INTER_CUBIC)
canvas[200:1200, 400:1400, :3] = rng.integers(0, 255, (1000, 1000, 3), dtype=np.uint8)
canvas[:, 3000:, :3] = (90, 120, 200)
canvas[600:1700, 4500:5700, :3] = rng.integers(0, 255, (1100, 1200, 3), dtype=np.uint8)
canvas[..., 3] = 255
full = QImage(canvas.data, W, H, W * 4, QImage.Format.Format_ARGB32).copy()
class Doc:
    reads = []
    def width(self): return W
    def height(self): return H
    def waitForDone(self): pass
    def projection(self, *args):
        if len(args) == 2:
            rect, scale = args
            Doc.reads.append(('scaled', rect.width() * rect.height()))
            return full.copy(rect).scaled(round(rect.width() * scale), round(rect.height() * scale), Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        x, y, w, h = args
        Doc.reads.append(('full', w * h))
        return full.copy(QRect(x, y, w, h))
class Stock(Doc):
    def projection(self, *args):
        if len(args) == 2: raise TypeError('no overload')
        return Doc.projection(self, *args)
def size(part):
    data = np.frombuffer(base64.b64decode(part['image_base64']), np.uint8); image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return [image.shape[1], image.shape[0]]
''' % str(PLUGIN)


def run(body, timeout=180):
    done = subprocess.run([sys.executable, '-c', SETUP + body], capture_output=True, text=True, timeout=timeout)
    if done.returncode:
        raise AssertionError(done.stderr.strip()[-2000:] or 'child failed')
    return json.loads(done.stdout.strip().splitlines()[-1])


class OperationTests(unittest.TestCase):
    def test_the_whole_crop_and_tiles_at_actual_pixels(self):
        out = run('''
got = r.review_crops_operation(Doc(), {'fresh': [3000, 0, 3000, 2000], 'painted': [[0, 0, 2000, 2000], [2000, 0, 1000, 2000]]})
inside = lambda t, box: box[0] <= t['source'][0] and box[1] <= t['source'][1] and t['source'][0] + t['source'][2] <= box[0] + box[2] and t['source'][1] + t['source'][3] <= box[1] + box[3]
busy = got['fresh_tiles'][0]['source']
print(json.dumps({'status': got['status'], 'whole': [got['whole']['source'], got['whole']['out'], size(got['whole']), got['whole']['scale'], got['whole']['mime_type']],
  'fresh': [[t['source'][2:], size(t), inside(t, [3000, 0, 3000, 2000])] for t in got['fresh_tiles']],
  'busy_first': busy[0] + 1024 > 4500 and busy[0] < 5700 and busy[1] + 1024 > 600,
  'painting': [[t['source'][2:], size(t), inside(t, [0, 0, 3000, 2000])] for t in got['painting_tiles']],
  'largest_full_read': max(n for kind, n in Doc.reads if kind == 'full'), 'ms': got['ms'] >= 0}))
''')
        self.assertEqual(out['status'], 'ok')
        self.assertEqual(out['whole'], [[3000, 0, 3000, 2000], [1024, 683], [1024, 683], 0.3413, 'image/jpeg'])
        self.assertEqual(out['fresh'], [[[1024, 1024], [1024, 1024], True]] * 2)
        self.assertTrue(out['busy_first'])
        self.assertEqual(out['painting'], [[[1024, 1024], [1024, 1024], True]] * 2)
        self.assertLessEqual(out['largest_full_read'], 1024 * 1024, 'no large area is read at full size')

    def test_a_small_new_area_is_its_own_tile(self):
        out = run('''
got = r.review_crops_operation(Doc(), {'fresh': [3000, 100, 800, 600]})
print(json.dumps([got['whole']['scale'], got['whole']['out'], len(got['fresh_tiles']), len(got['painting_tiles'])]))
''')
        self.assertEqual(out, [1, [800, 600], 0, 0])

    def test_refusals(self):
        out = run('''
errors = []
for doc, params, guides in ((Doc(), {'fresh': [5000, 0, 3000, 2000]}, False), (Doc(), {'fresh': [0, 0, 0, 10]}, False), (Doc(), {'fresh': [0, 0, 10, 10], 'painted': 'left'}, False),
                            (Doc(), {'fresh': [0, 0, 10, 10], 'tiles': 5}, False), (Doc(), {'fresh': [3000, 0, 3000, 2000]}, True), (Stock(), {'fresh': [0, 0, 6000, 2000]}, False)):
    try:
        r.review_crops_operation(doc, params, guides=guides); errors.append('accepted')
    except ValueError as error:
        errors.append(str(error)[:22])
small = r.review_crops_operation(Stock(), {'fresh': [3000, 0, 1500, 1000], 'tiles': 0})
print(json.dumps([errors, small['whole']['out'], len(small['fresh_tiles'])]))
''')
        self.assertEqual(out, [['fresh must fit the can', 'fresh must fit the can', 'painted must be at mos', 'tiles must be 0, 1 or ', 'The guide lines are sh', 'This Krita cannot read'], [1024, 683], 0])


if __name__ == '__main__':
    unittest.main()
