# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""mixing_options (Task 5): a pass's mixing model as preset properties, and blending passes on new layers sampling below."""
import importlib
import pathlib
import sys
import types
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[2] / 'krita-mcp' / 'krita-plugin' / 'kritamcp'
package = types.ModuleType('mixing_test_package'); package.__path__ = [str(SOURCE)]
sys.modules['mixing_test_package'] = package
mixing = importlib.import_module('mixing_test_package.mixing_options')
validation = importlib.import_module('mixing_test_package.creative_validation')
SMUDGE, MYPAINT = 'colorsmudge', 'mypaintbrush'


class MixingOptionsTests(unittest.TestCase):
    def test_blender_on_new_layer_samples_below(self):
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'k) Blender Basic', None, True, False), {'MergedPaint': True})

    def test_continued_layer_is_left_alone(self):
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'k) Blender Basic', None, False, False), {})

    def test_colour_laying_smudge_preset_unchanged_without_model(self):
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', None, True, False), {})

    def test_model_on_smudge_is_passed_and_samples_below(self):
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', 'spectral', True, False),
                         {'ToskaMixingModel': 'spectral', 'MergedPaint': True})
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', 'rgb', True, False), {'ToskaMixingModel': 'rgb'})

    def test_explicit_overlay_is_not_second_guessed(self):
        self.assertNotIn('MergedPaint', mixing.mixing_properties(SMUDGE, 'k) Blender Basic', None, True, True))

    def test_mypaint_spectral_sets_paint_mode_and_samples_merged(self):
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'spectral', True, False),
                         {'ToskaMyPaintPaintMode': 1.0, 'ToskaMyPaintSampleMerged': True})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'spectral', False, False), {'ToskaMyPaintPaintMode': 1.0})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'rgb', True, False), {})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', None, True, False), {})

    def test_mypaint_refuses_pigment(self):
        for model in ('pigment', 'linear', 'perceptual'):
            with self.assertRaisesRegex(ValueError, 'MyPaint presets mix by rgb or spectral'):
                mixing.mixing_properties(MYPAINT, 'Ramon', model, True, False)

    def test_other_engine_with_model_names_the_engine(self):
        with self.assertRaisesRegex(ValueError, 'paintbrush'):
            mixing.mixing_properties('paintbrush', 'b) Basic-1', 'spectral', True, False)
        self.assertEqual(mixing.mixing_properties('paintbrush', 'b) Basic-1', None, True, False), {})

    def test_unknown_model_refused_by_validation(self):
        params = {'name': 'Sky', 'preset': 'b) Basic-1', 'mixing_model': 'oil',
                  'strokes': [{'start': [10, 10], 'segments': [[20, 20, 30, 30, 40, 40]], 'size': 20, 'opacity': 1, 'flow': 1, 'color': '#aabbcc'}]}
        with self.assertRaisesRegex(ValueError, 'mixing_model must be one of rgb, linear, perceptual, spectral, pigment'):
            validation.validate_pass(params, 600, 450, ['b) Basic-1'])
        params['mixing_model'] = 'spectral'
        self.assertIs(validation.validate_pass(params, 600, 450, ['b) Basic-1']), params)


if __name__ == '__main__':
    unittest.main()
