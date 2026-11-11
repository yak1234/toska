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
    """Sampling the layers below is its own choice (sample_below), never a consequence of the mixing model."""
    def test_nothing_samples_below_unless_asked(self):
        for paintop, preset in ((SMUDGE, 'k) Blender Basic'), (SMUDGE, 'i) Wet Bristles'), (MYPAINT, 'Ramon')):
            for model in (None, 'rgb', 'spectral') if paintop == MYPAINT else (None, 'rgb', 'spectral', 'pigment'):
                for new_layer in (True, False):
                    props = mixing.mixing_properties(paintop, preset, model, new_layer, False)
                    self.assertNotIn('MergedPaint', props, (paintop, preset, model, new_layer))
                    self.assertNotIn('ToskaMyPaintSampleMerged', props, (paintop, preset, model, new_layer))

    def test_spectral_mypaint_on_a_new_layer_only_changes_the_paint_mode(self):
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'spectral', True, False), {'ToskaMyPaintPaintMode': 1.0})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'rgb', True, False), {})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', None, True, False), {})

    def test_sample_below_samples_merged_for_rgb_and_spectral_alike(self):
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'rgb', True, False, sample_below=True),
                         {'ToskaMyPaintSampleMerged': True})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', None, True, False, sample_below=True),
                         {'ToskaMyPaintSampleMerged': True})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'spectral', True, False, sample_below=True),
                         {'ToskaMyPaintPaintMode': 1.0, 'ToskaMyPaintSampleMerged': True})

    def test_sample_below_on_a_continued_layer_samples_too(self):
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'spectral', False, False, continued=True, sample_below=True),
                         {'ToskaMyPaintPaintMode': 1.0, 'ToskaMyPaintSampleMerged': True})
        self.assertEqual(mixing.mixing_properties(MYPAINT, 'Ramon', 'spectral', False, False, continued=True),
                         {'ToskaMyPaintPaintMode': 1.0})

    def test_colour_smudge_model_is_passed_and_sampling_follows_sample_below_only(self):
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', 'spectral', True, False), {'ToskaMixingModel': 'spectral'})
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', 'rgb', True, False), {'ToskaMixingModel': 'rgb'})
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'k) Blender Basic', None, True, False, sample_below=True), {'MergedPaint': True})
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', 'spectral', True, False, sample_below=True),
                         {'ToskaMixingModel': 'spectral', 'MergedPaint': True})
        self.assertEqual(mixing.mixing_properties(SMUDGE, 'i) Wet Bristles', 'rgb', True, False, sample_below=True),
                         {'ToskaMixingModel': 'rgb', 'MergedPaint': True})

    def test_explicit_overlay_is_not_second_guessed(self):
        self.assertNotIn('MergedPaint', mixing.mixing_properties(SMUDGE, 'k) Blender Basic', None, True, True, sample_below=True))

    def test_sample_below_must_be_boolean(self):
        params = {'name': 'Sky', 'preset': 'b) Basic-1', 'sample_below': 'yes', 'strokes': []}
        with self.assertRaisesRegex(ValueError, 'sample_below must be boolean'):
            validation.validate_pass(params, 100, 100, {'b) Basic-1'})

    def test_mypaint_refuses_pigment(self):
        for model in ('pigment', 'linear', 'perceptual'):
            with self.assertRaisesRegex(ValueError, 'MyPaint presets mix by rgb or spectral'):
                mixing.mixing_properties(MYPAINT, 'Ramon', model, True, False)

    def test_other_engines_mix_through_a_blend_mode(self):
        # The pixel brush and every other engine: the fork's toska_mix_<model> blend mode lays the dab by the model.
        self.assertEqual(mixing.mixing_properties('paintbrush', 'b) Basic-3 Flow', 'pigment', True, False), {'CompositeOp': 'toska_mix_pigment'})
        self.assertEqual(mixing.mixing_properties('paintbrush', 'b) Basic-3 Flow', 'spectral', True, False, composite_op='normal'),
                         {'CompositeOp': 'toska_mix_spectral'})
        self.assertEqual(mixing.mixing_properties('roundmarker', 'b) Basic-1', 'linear', True, False), {'CompositeOp': 'toska_mix_linear'})
        self.assertEqual(mixing.mixing_properties('paintbrush', 'b) Basic-1', None, True, False), {})
        self.assertEqual(mixing.mixing_properties('paintbrush', 'b) Basic-1', 'rgb', True, False), {})

    def test_a_preset_with_its_own_blend_mode_keeps_it(self):
        # Dodge, Multiply and the like are their blend mode: a model cannot replace it.
        with self.assertRaisesRegex(ValueError, r'l\) Adjust Multiply paints with its own blend mode \(multiply\)'):
            mixing.mixing_properties('paintbrush', 'l) Adjust Multiply', 'pigment', True, False, composite_op='multiply')
        self.assertEqual(mixing.mixing_properties('paintbrush', 'l) Adjust Multiply', None, True, False, composite_op='multiply'), {})

    def test_unknown_model_refused_by_validation(self):
        params = {'name': 'Sky', 'preset': 'b) Basic-1', 'mixing_model': 'oil',
                  'strokes': [{'start': [10, 10], 'segments': [[20, 20, 30, 30, 40, 40]], 'size': 20, 'opacity': 1, 'flow': 1, 'color': '#aabbcc'}]}
        with self.assertRaisesRegex(ValueError, 'mixing_model must be one of rgb, linear, perceptual, spectral, pigment'):
            validation.validate_pass(params, 600, 450, ['b) Basic-1'])
        params['mixing_model'] = 'spectral'
        self.assertIs(validation.validate_pass(params, 600, 450, ['b) Basic-1']), params)


if __name__ == '__main__':
    unittest.main()
