# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""brush_swatch (brush_craft.py; painting-skills 3.3): one fixed sheet of strokes painted with a base preset or a brush
recipe on the plugin's own hidden scratch document, written as a PNG into the chat folder. The scratch document is never
one of the artist's documents (open_documents leaves it out). Stand-in layer and job; files go to a temporary folder."""
import importlib
import os
import shutil
import tempfile
import types
import unittest

import cv2
import numpy as np
import test_native as native                       # loads the plugin package with its stand-in krita and Qt

craft = importlib.import_module('creative_test_package.brush_craft')
maker = importlib.import_module('creative_test_package.brush_maker')
identity = importlib.import_module('creative_test_package.creative_document_identity')

TIP = ('<Brush useAutoSpacing="1" angle="0" spacing="0.1" density="1" BrushVersion="2" type="auto_brush" randomness="0" autoSpacingCoeff="0.8"> '
       '<MaskGenerator spikes="2" hfade="1" ratio="1" diameter="40" id="default" type="circle" antialiasEdges="1" vfade="1"/> </Brush> ')
PRESET = ('<Preset name="b) Basic-5 Size" paintopid="paintbrush"><param name="brush_definition" type="string"><![CDATA[%s]]></param></Preset>' % TIP)


class Job:
    def __init__(self, layer, strokes, error=''):
        self.error, self.total = error, len(strokes)
        if not error:                                  # a dark bar, so the sheet is not blank
            layer.pixels[100:140, 100:900, :3] = 0
    def state(self): return 'failed' if self.error else 'done'
    def wait(self, _ms=-1): return True
    def errorString(self): return self.error
    def strokesDone(self): return 0 if self.error else self.total
    def elapsedMs(self): return 12


class Layer:
    def __init__(self, owner): self.owner, self.pixels = owner, None
    def setPixelData(self, data, x, y, w, h):
        self.owner.events.append('clear')
        self.pixels = np.frombuffer(bytes(data), np.uint8).reshape(h, w, 4).copy()
    def pixelData(self, x, y, w, h): return self.pixels.tobytes()
    def paintStrokes(self, strokes, options=None, selection=None):
        self.owner.events.append('paint'); self.owner.calls.append((strokes, options, selection))
        return Job(self, strokes, self.owner.job_error)


class Scratch:
    def __init__(self, owner): self.owner = owner
    def setModified(self, value): self.owner.events.append('modified=%s' % value)
    def waitForDone(self): pass


class Swatches(craft.BrushCraft):
    def __init__(self, folder):
        self.events, self.calls, self.job_error = [], [], ''
        self.layer, self.scratch, self.session = Layer(self), Scratch(self), {'id': 's', 'output': folder}
    def _brush_scratch(self): return self.scratch, self.layer
    def _brush_preset_xml(self, name):
        if name != 'b) Basic-5 Size': raise KeyError(name)
        return PRESET
    def _brush_patterns(self): return {'Canvas 04': 'Crumpled_Paper.pat'}


class BrushSwatch(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix='brush-swatch-')
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.h = Swatches(self.folder)
        self.out = os.path.join(self.folder, 'swatch.png')

    def swatch(self, **params):
        return self.h._brush_swatch(self.h.session, dict({'out_path': self.out}, **params))

    def test_a_base_preset_is_painted_as_saved_and_written_as_a_png(self):
        result = self.swatch(preset='b) Basic-5 Size')
        self.assertEqual((result['status'], result['path'], result['width'], result['height']), ('ok', os.path.realpath(self.out), craft.SHEET[0], craft.SHEET[1]))
        image = cv2.imread(self.out, cv2.IMREAD_UNCHANGED)
        self.assertEqual(image.shape[:2], (craft.SHEET[1], craft.SHEET[0]))
        self.assertEqual((int(image[120, 500, 0]), int(image[400, 500, 0])), (0, 255), 'the paint and the white ground')
        strokes, options, selection = self.h.calls[0]
        self.assertEqual(strokes, maker.swatch_sheet(craft.SHEET[0], craft.SHEET[1], 60))
        self.assertEqual((options['preset'], options['size'], 'presetProperties' in options, 'compositeOp' in options, selection),
                         ('b) Basic-5 Size', 60, False, False, None))
        self.assertGreater(result['ink_share'], 0)
        self.assertEqual(result['engine'], 'paintbrush', 'the base preset\'s engine, which a recipe is made for')
        self.assertEqual(result['strokes'], len(strokes))

    def test_the_sheet_is_cleared_before_painting_and_the_document_left_unmodified(self):
        self.swatch(preset='b) Basic-5 Size'); self.swatch(preset='b) Basic-5 Size')
        self.assertEqual(self.h.events, ['clear', 'paint', 'modified=False'] * 2)

    def test_a_recipe_is_expanded_into_the_jobs_properties(self):
        recipe = {'base_preset': 'b) Basic-5 Size', 'engine': 'paintbrush', 'properties': {'PressureSize': False, 'CompositeOp': 'multiply'},
                  'tip': {'replace': True, 'brush': {}, 'mask': {'type': 'rect', 'ratio': '0.5'}}}
        result = self.swatch(recipe=recipe, size=90)
        options = self.h.calls[0][1]
        self.assertEqual((options['preset'], options['size'], options['compositeOp'], options['presetProperties']['PressureSize']),
                         ('b) Basic-5 Size', 90, 'multiply', False))
        self.assertIn('type="rect"', options['presetProperties']['brush_definition'])
        self.assertEqual(result['properties'], ['PressureSize', 'brush_definition'])

    def test_what_is_refused(self):
        outside = os.path.join(os.path.dirname(self.folder), 'x.png')
        bad_recipe = {'base_preset': 'b) Basic-5 Size', 'engine': 'paintbrush', 'properties': {'PressureSzie': True}}
        for params, message in (({'preset': 'b) Basic-5 Size', 'out_path': outside}, 'chat folder'),
                                ({'preset': 'b) Basic-5 Size', 'out_path': self.out[:-4] + '.jpg'}, r'\.png'),
                                ({}, 'preset or a recipe'),
                                ({'preset': 'b) Basic-5 Size', 'recipe': bad_recipe}, 'preset or a recipe'),
                                ({'preset': 'Nope'}, 'exact installed preset'),
                                ({'recipe': bad_recipe}, 'PressureSzie'),
                                ({'preset': 'b) Basic-5 Size', 'size': 2000}, 'size'),
                                ({'preset': 'b) Basic-5 Size', 'colour': 'red'}, 'colour')):
            with self.assertRaisesRegex(ValueError, message):
                self.swatch(**params)
        self.assertEqual(self.h.calls, [], 'nothing was painted')

    def test_a_blender_gets_coloured_stripes_to_drag_and_a_pixel_brush_a_white_ground(self):
        grounds = []
        self.h.layer.setPixelData = lambda data, x, y, w, h: (grounds.append(np.frombuffer(bytes(data), np.uint8).reshape(h, w, 4).copy()),
                                                               setattr(self.h.layer, 'pixels', grounds[-1].copy()))
        self.swatch(preset='b) Basic-5 Size')
        self.h._brush_preset_xml = lambda name: PRESET.replace('paintbrush', 'colorsmudge')
        self.swatch(preset='b) Basic-5 Size')
        self.assertEqual(int(grounds[0].min()), 255, 'white for a brush that lays paint')
        stripes = grounds[1][500, :, :3]
        self.assertGreater(len({tuple(pixel) for pixel in stripes}), 1, 'two colours side by side for a brush that drags paint')
        self.assertEqual(int(grounds[1][:, :, 3].min()), 255)

    def test_a_refused_job_is_a_rejected_swatch_with_no_file(self):
        self.h.job_error = 'no preset'
        result = self.swatch(preset='b) Basic-5 Size')
        self.assertEqual((result['status'], result['error_code']), ('rejected', 'validation_rejected'))
        self.assertIn('no preset', result['error'])
        self.assertFalse(os.path.exists(self.out))

    def test_a_layer_without_stroke_jobs_says_the_fork_is_needed(self):
        self.h.layer = types.SimpleNamespace(setPixelData=lambda *a: None)
        with self.assertRaisesRegex(ValueError, 'Toska'):
            self.swatch(preset='b) Basic-5 Size')


class Release(unittest.TestCase):
    def test_letting_go_of_the_scratch_document_drops_it_and_shows_it_again(self):
        """Held through shutdown, the hidden document crashed the process at exit (seen in kritarunner, exit 139)."""
        h, doc = Swatches(tempfile.gettempdir()), object()
        self.addCleanup(identity._hidden.clear)
        identity.hide_document(doc)
        h._brush_scratch_held = (doc, object())
        h._brush_release(); h._brush_release()
        self.assertIsNone(h._brush_scratch_held)
        self.assertFalse(identity.is_hidden(doc))


class Sheet(unittest.TestCase):
    def test_the_sheet_is_fixed_and_inside_the_picture(self):
        strokes = maker.swatch_sheet(1600, 1000, 60)
        self.assertEqual(strokes, maker.swatch_sheet(1600, 1000, 60))
        self.assertGreaterEqual(len(strokes), 20)
        self.assertTrue(any('segments' in s for s in strokes) and any(len(s.get('points', [])) == 1 for s in strokes))
        self.assertEqual({s['color'] for s in strokes}, {'#000000', '#c8321e', '#1e46c8'})
        for stroke in strokes:
            points = stroke.get('points') or ([stroke['start']] + [segment[4:] for segment in stroke['segments']])
            for point in points:
                self.assertTrue(0 <= point[0] <= 1600 and 0 <= point[1] <= 1000 and 0 < point[2] <= 1, point)

    def test_a_path_must_be_a_file_inside_the_folder(self):
        folder = tempfile.mkdtemp(prefix='brush-inside-')
        self.addCleanup(shutil.rmtree, folder, True)
        self.assertEqual(maker.inside(folder, os.path.join(folder, 'a.png'), 'out_path'), os.path.join(os.path.realpath(folder), 'a.png'))
        for path in (os.path.join(folder, '..', 'a.png'), 'a.png', folder, os.path.dirname(folder) + '/a.png', 7):
            with self.assertRaisesRegex(ValueError, 'chat folder'):
                maker.inside(folder, path, 'out_path')


class HiddenDocuments(unittest.TestCase):
    def test_a_hidden_document_is_not_one_of_the_open_documents(self):
        artist, scratch = object(), object()
        previous = identity.Krita
        self.addCleanup(setattr, identity, 'Krita', previous)
        self.addCleanup(identity._hidden.clear)
        identity.Krita = types.SimpleNamespace(instance=lambda: types.SimpleNamespace(documents=lambda: [artist, scratch], windows=lambda: []))
        self.assertEqual(identity.open_documents(), [artist, scratch])
        identity.hide_document(scratch); identity.hide_document(scratch)
        self.assertEqual(identity.open_documents(), [artist])
        self.assertTrue(identity.is_hidden(scratch) and not identity.is_hidden(artist))


if __name__ == '__main__':
    unittest.main()
