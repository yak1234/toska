# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""change_map (blank_canvas.py): what a batch painted on empty canvas, measured from the views before and after it.
The measure is plain numpy; the operation decodes with real Qt in a child process (the other plugin tests stub Qt).
Images are made in memory; nothing is written to disk."""
import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest

import numpy as np

PLUGIN = pathlib.Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
spec = importlib.util.spec_from_file_location('blank_canvas_under_test', PLUGIN / 'blank_canvas.py')
blank = importlib.util.module_from_spec(spec)
spec.loader.exec_module(blank)

W, H = 240, 80


def painting(width=W, height=H, seed=3):
    """A textured picture: no colour covers much of it."""
    rng = np.random.default_rng(seed)
    out = rng.integers(40, 250, (height, width, 3), dtype=np.uint8)
    return np.dstack([out, np.full((height, width), 255, np.uint8)])


def half_empty():
    """A finished left half, an empty (black, as a transparent canvas is viewed) right half."""
    out = painting()
    out[:, W // 2:, :3] = 0
    return out


class ChangeMapTests(unittest.TestCase):
    def test_a_copy_onto_the_empty_half_is_all_new_ground(self):
        before = half_empty()
        after = before.copy()
        after[:, W // 2:] = before[:, :W // 2]
        got = blank.change_map(before, after)
        self.assertGreaterEqual(got['fresh_share'], 0.98)
        self.assertEqual(got['removed_share'], 0)
        self.assertAlmostEqual(got['changed_share'], 0.5, delta=0.02)
        x, y, w, h = got['fresh_box']
        self.assertAlmostEqual(x, 0.5, delta=0.02)
        self.assertAlmostEqual(w, 0.5, delta=0.02)
        self.assertEqual((y, h), (0, 1))
        cells = got['cells']
        self.assertEqual(list(cells), ['top_left', 'top_center', 'top_right', 'middle_left', 'center', 'middle_right',
                                       'bottom_left', 'bottom_center', 'bottom_right'])
        self.assertGreaterEqual(cells['middle_right']['empty_before'], 0.98)
        self.assertLessEqual(cells['middle_left']['empty_before'], 0.02)
        self.assertGreaterEqual(cells['middle_right']['fresh'], 0.98)
        self.assertEqual(cells['middle_left']['fresh'], 0)

    def test_paint_over_paint_is_not_new_ground(self):
        before = half_empty()
        after = before.copy()
        after[20:60, 20:80, :3] = 255 - after[20:60, 20:80, :3]
        got = blank.change_map(before, after)
        self.assertEqual(got['fresh_share'], 0)
        self.assertEqual(got['removed_share'], 0)
        self.assertIsNone(got['fresh_box'])

    def test_hiding_the_painting_is_removed_artwork(self):
        before = half_empty()
        after = before.copy()
        after[:, :, :3] = 0
        got = blank.change_map(before, after)
        self.assertGreaterEqual(got['removed_share'], 0.95)
        self.assertEqual(got['fresh_share'], 0)

    def test_nothing_changed(self):
        before = half_empty()
        got = blank.change_map(before, before.copy())
        self.assertEqual((got['changed_share'], got['fresh_share'], got['removed_share'], got['fresh_box']), (0, 0, 0, None))

    def test_a_noisy_empty_area_is_still_empty_and_dark_paint_is_not(self):
        # A JPEG view: the empty half is within a few levels of its colour. Small black shapes inside the painting
        # (ship silhouettes) are paint, not empty canvas.
        rng = np.random.default_rng(5)
        before = half_empty()
        before[:, W // 2:, :3] = rng.integers(0, 5, (H, W - W // 2, 3), dtype=np.uint8)
        before[30:36, 30:40, :3] = 0
        after = before.copy()
        after[:, W // 2:, :3] = 200
        after[30:36, 30:40, :3] = 200
        got = blank.change_map(before, after)
        self.assertGreaterEqual(got['cells']['middle_right']['empty_before'], 0.98)
        self.assertLessEqual(got['cells']['middle_left']['empty_before'], 0.02)
        self.assertGreaterEqual(got['fresh_share'], 0.98)

    def test_a_painting_with_no_empty_colour_has_no_empty_cells(self):
        before = painting()
        after = before.copy()
        after[:, W // 2:, :3] = 10
        got = blank.change_map(before, after)
        self.assertEqual(got['fresh_share'], 0)
        self.assertEqual(max(cell['empty_before'] for cell in got['cells'].values()), 0)

    def test_a_ground_box_counts_as_empty_whatever_it_shows(self):
        # A toned ground went down on the empty half and was kept; the dabs over it are still new ground.
        before = half_empty()
        before[:, W // 2:, :3] = np.random.default_rng(9).integers(90, 220, (H, W - W // 2, 3), dtype=np.uint8)   # rough dabs: no one colour
        after = before.copy()
        after[10:70, 130:230, :3] = 20
        self.assertEqual(blank.change_map(before, after)['fresh_share'], 0, 'without the box it is paint over paint')
        got = blank.change_map(before, after, ground=[[0.5, 0, 0.5, 1]])
        self.assertEqual(got['fresh_share'], 1)
        self.assertEqual(got['removed_share'], 0)
        self.assertEqual(got['cells']['middle_right']['empty_before'], 1)
        self.assertEqual(got['cells']['middle_left']['empty_before'], 0)

    def test_sizes_must_match(self):
        with self.assertRaises(ValueError):
            blank.change_map(painting(), painting(100, 80))


SETUP = '''
import sys, json, base64, hashlib
import numpy as np, cv2
package = __import__('types').ModuleType('kritamcp_child'); package.__path__ = [%r]; sys.modules['kritamcp_child'] = package
from kritamcp_child.qt_compat import QApplication
app = QApplication.instance() or QApplication([])
import kritamcp_child.blank_canvas as b
def part(rgb, ext):
    ok, data = cv2.imencode(ext, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)); data = bytes(data)
    return {'image_base64': base64.b64encode(data).decode(), 'sha256': hashlib.sha256(data).hexdigest()}
''' % str(PLUGIN)


def run(body, timeout=180):
    done = subprocess.run([sys.executable, '-c', SETUP + body], capture_output=True, text=True, timeout=timeout)
    if done.returncode:
        raise AssertionError(done.stderr.strip()[-2000:] or 'child failed')
    return json.loads(done.stdout.strip().splitlines()[-1])


class ChangeMapOperationTests(unittest.TestCase):
    def test_a_png_before_and_a_jpeg_after_of_another_size(self):
        out = run('''
rng = np.random.default_rng(3)
# Broad soft shapes, as a painting has: pixel noise would differ between a PNG and a resized JPEG of it.
before = cv2.resize(rng.integers(40, 250, (8, 24, 3), dtype=np.uint8), (1200, 400), interpolation=cv2.INTER_CUBIC); before[:, 600:] = 0
after = before.copy(); after[:, 600:] = before[:, :600]
after = cv2.resize(after, (900, 300), interpolation=cv2.INTER_AREA)
got = b.change_map_operation({'before': part(before, '.png'), 'after': part(after, '.jpg')})
print(json.dumps([got['status'], got['fresh_share'] >= 0.95, got['removed_share'], got['cells']['middle_right']['empty_before'] >= 0.95, got['ms'] >= 0]))
''')
        self.assertEqual(out, ['ok', True, 0, True, True])

    def test_ground_boxes_are_checked(self):
        out = run('''
img = np.zeros((40, 120, 3), np.uint8); one = part(img, '.png'); errors = []
for ground in ([[0.5, 0, 0.6, 1]], [[0, 0, 0, 1]], 'right', [[0, 0, 1, 1]] * 9, [[0, 0, True, 1]]):
    try:
        b.change_map_operation({'before': one, 'after': one, 'ground': ground}); errors.append('accepted')
    except ValueError as error:
        errors.append(str(error)[:6])
ok = b.change_map_operation({'before': one, 'after': one, 'ground': [[0.5, 0, 0.5, 1]]})
print(json.dumps([errors, ok['status']]))
''')
        self.assertEqual(out, [['each g', 'each g', 'ground', 'ground', 'each g'], 'ok'])

    def test_changed_bytes_are_refused(self):
        out = run('''
img = np.zeros((40, 120, 3), np.uint8); one = part(img, '.png'); bad = dict(one, sha256='0' * 64)
try:
    b.change_map_operation({'before': one, 'after': bad}); print(json.dumps('accepted'))
except ValueError as error:
    print(json.dumps(str(error)))
''')
        self.assertEqual(out, 'Reference content changed.')


if __name__ == '__main__':
    unittest.main()
