# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""A paint pass with a brush the painter made (painting-skills 3.5): the pass carries the brush's recipe, the plugin
checks it against the pass's preset and sets its properties on the stroke job's own copy of that preset. The stroke-job
stand-ins of test_native."""
import unittest

import test_native as native

module = native.module
TIP = ('<Brush useAutoSpacing="1" angle="0" spacing="0.1" density="1" BrushVersion="2" type="auto_brush" randomness="0" autoSpacingCoeff="0.8"> '
       '<MaskGenerator spikes="2" hfade="1" ratio="1" diameter="40" id="default" type="circle" antialiasEdges="1" vfade="1"/> </Brush> ')
PRESET = '<Preset name="b) Basic-1" paintopid="paintbrush"><param name="brush_definition" type="string"><![CDATA[%s]]></param></Preset>' % TIP


def recipe(properties=None, base='b) Basic-1', **extra):
    return dict({'base_preset': base, 'engine': 'paintbrush', 'properties': properties or {}}, **extra)


class BrushPass(unittest.TestCase):
    setUp = native.ForkStrokeJobTests.setUp
    _pass = native.ForkStrokeJobTests._pass

    def harness(self):
        h = native.ForkStrokeJobTests.harness(self)
        h._brush_preset_xml = lambda name: PRESET
        h._brush_patterns = lambda: {'Canvas 04': 'Crumpled_Paper.pat'}
        return h

    def test_the_brushs_settings_go_to_the_job_on_the_pass_preset(self):
        h = self.harness()
        result = self._pass(h, 2, brush_recipe=recipe({'PressureSize': False}, tip={'replace': True, 'brush': {}, 'mask': {'type': 'rect', 'ratio': '0.5'}}))
        self.assertEqual(result['status'], 'ok', result.get('error'))
        options = h.job_calls[0][1]
        self.assertEqual((options['preset'], options['presetProperties']['PressureSize']), ('b) Basic-1', False))
        self.assertIn('type="rect"', options['presetProperties']['brush_definition'])
        self.assertNotIn('compositeOp', options)

    def test_the_brushs_blend_mode_is_the_jobs_own_option(self):
        h = self.harness()
        self._pass(h, 1, brush_recipe=recipe({'CompositeOp': 'multiply', 'FlowValue': 0.4}))
        options = h.job_calls[0][1]
        self.assertEqual((options['compositeOp'], options['presetProperties']), ('multiply', {'FlowValue': 0.4}))

    def test_a_pass_without_a_brush_is_as_before(self):
        h = self.harness()
        self._pass(h, 1)
        self.assertNotIn('presetProperties', h.job_calls[0][1])

    def refused(self, h, message, **extra):
        try:
            result = self._pass(h, 1, **extra)
        except ValueError as error:
            result = {'error': str(error)}
        self.assertRegex(result.get('error') or '', message)
        self.assertEqual(h.job_calls, [], 'nothing was painted')

    def test_a_recipe_that_does_not_check_paints_nothing(self):
        self.refused(self.harness(), 'PressureSzie', brush_recipe=recipe({'PressureSzie': True}))
        self.refused(self.harness(), 'base preset', brush_recipe=recipe(base='b) Basic-5 Size'))
        self.refused(self.harness(), 'brush_recipe', brush_recipe='soft-pastel/stick-side')

    def test_a_made_brush_needs_stroke_jobs(self):
        module._FORK = False
        self.refused(self.harness(), 'Toska', brush_recipe=recipe({'PressureSize': False}))


if __name__ == '__main__':
    unittest.main()
