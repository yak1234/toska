# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""brush_maker.expand: a brush recipe (the companion's brush-recipe.ts) checked against its base preset and turned into
the properties a stroke job sets on its own copy of the preset (painting-skills 3.2). Pure: no Krita, no Qt."""
import importlib.util
import math
import pathlib
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location(
    'brush_maker', pathlib.Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp/brush_maker.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

AUTO_TIP = ('<Brush useAutoSpacing="1" angle="0" spacing="0.1" density="1" BrushVersion="2" type="auto_brush" randomness="0" '
            'autoSpacingCoeff="0.8"> <MaskGenerator spikes="2" hfade="1" ratio="1" diameter="40" id="default" type="circle" '
            'antialiasEdges="1" vfade="1"/> </Brush> ')
IMAGE_TIP = ('<Brush scale="0.266667" type="png_brush" useAutoSpacing="0" autoSpacingCoeff="1" angle="0" spacing="0.05" '
             'BrushVersion="2" filename="chalk_round_hard.png"/> ')
PATTERNS = {'Canvas 04': 'Crumpled_Paper.pat'}


def preset(tip=AUTO_TIP, engine='paintbrush'):
    return ('<Preset embedded_resources="0" name="base" paintopid="%s">'
            '<param name="brush_definition" type="string"><![CDATA[%s]]></param>'
            '<param name="PressureSize" type="string"><![CDATA[true]]></param></Preset>' % (engine, tip))


def recipe(properties=None, tip=None, engine='paintbrush'):
    return dict({'base_preset': 'base', 'engine': engine, 'properties': properties or {}}, **({'tip': tip} if tip else {}))


def tip_of(result):
    brush = ET.fromstring(result['properties']['brush_definition'])
    return brush, brush.find('MaskGenerator')


class Expand(unittest.TestCase):
    def test_nothing_set_gives_no_properties(self):
        self.assertEqual(m.expand(recipe(), preset(), PATTERNS), {'preset': 'base', 'properties': {}, 'composite': None})

    def test_a_replaced_tip_is_a_new_generated_tip_that_keeps_the_base_spacing(self):
        result = m.expand(recipe(tip={'replace': True, 'brush': {'angle': '1.5708'},
                                      'mask': {'type': 'rect', 'ratio': '0.5', 'hfade': '0.75', 'vfade': '0.75'}}), preset(IMAGE_TIP), PATTERNS)
        brush, mask = tip_of(result)
        self.assertEqual((brush.get('type'), brush.get('spacing'), brush.get('angle'), brush.get('filename')), ('auto_brush', '0.05', '1.5708', None))
        self.assertEqual((mask.get('type'), mask.get('ratio'), mask.get('hfade'), mask.get('vfade'), mask.get('id')), ('rect', '0.5', '0.75', '0.75', 'default'))

    def test_a_patch_sets_only_what_it_names_on_the_base_tip(self):
        result = m.expand(recipe(tip={'replace': False, 'brush': {'spacing': '0.4', 'useAutoSpacing': '0'}, 'mask': {'ratio': '0.3'}}), preset(), PATTERNS)
        brush, mask = tip_of(result)
        self.assertEqual((brush.get('spacing'), brush.get('useAutoSpacing'), brush.get('autoSpacingCoeff')), ('0.4', '0', '0.8'))
        self.assertEqual((mask.get('ratio'), mask.get('diameter'), mask.get('type')), ('0.3', '40', 'circle'))

    def test_an_image_tip_takes_spacing_but_no_shape_settings(self):
        brush, mask = tip_of(m.expand(recipe(tip={'replace': False, 'brush': {'spacing': '0.2', 'useAutoSpacing': '0'}, 'mask': {}}), preset(IMAGE_TIP), PATTERNS))
        self.assertEqual((brush.get('type'), brush.get('spacing'), mask), ('png_brush', '0.2', None))
        with self.assertRaisesRegex(ValueError, 'image.*tip.shape'):
            m.expand(recipe(tip={'replace': False, 'brush': {}, 'mask': {'ratio': '0.3'}}), preset(IMAGE_TIP), PATTERNS)

    def test_tip_attributes_are_named_and_in_range(self):
        for tip, message in (({'replace': False, 'brush': {'filename': 'x.png'}, 'mask': {}}, 'filename'),
                             ({'replace': False, 'brush': {}, 'mask': {'ratio': '7'}}, 'ratio'),
                             ({'replace': True, 'brush': {}, 'mask': {'type': 'star'}}, 'type'),
                             ({'replace': False, 'brush': {'spacing': 'wide'}, 'mask': {}}, 'spacing'),
                             ({'replace': False, 'brush': {'angle': str(math.pi * 2)}, 'mask': {}}, 'angle'),
                             ({'replace': 'yes', 'brush': {}, 'mask': {}}, 'replace'),
                             ({'replace': False, 'brush': {}, 'mask': {}, 'glow': 1}, 'glow')):
            with self.assertRaisesRegex(ValueError, message):
                m.expand(recipe(tip=tip), preset(), PATTERNS)

    def test_the_engine_must_be_the_base_presets(self):
        with self.assertRaisesRegex(ValueError, 'colorsmudge.*paintbrush'):
            m.expand(recipe(engine='colorsmudge'), preset(), PATTERNS)
        with self.assertRaisesRegex(ValueError, 'hairybrush'):
            m.expand(recipe(engine='hairybrush'), preset(engine='hairybrush'), PATTERNS)

    def test_a_key_the_engine_does_not_have_is_refused_by_name(self):
        with self.assertRaisesRegex(ValueError, 'PressureSzie'):
            m.expand(recipe({'PressureSzie': True}), preset(), PATTERNS)
        with self.assertRaisesRegex(ValueError, 'SmudgeRateValue'):
            m.expand(recipe({'SmudgeRateValue': 0.5}), preset(), PATTERNS)
        self.assertEqual(m.expand(recipe({'SmudgeRateValue': 0.5}, engine='colorsmudge'), preset(engine='colorsmudge'), PATTERNS)['properties'],
                         {'SmudgeRateValue': 0.5})

    def test_the_tip_is_set_only_through_the_tip_change(self):
        with self.assertRaisesRegex(ValueError, 'brush_definition'):
            m.expand(recipe({'brush_definition': AUTO_TIP}), preset(), PATTERNS)

    def test_values_are_plain_and_in_range(self):
        for properties, message in (({'OpacityValue': 1.5}, 'OpacityValue'), ({'OpacityValue': float('nan')}, 'OpacityValue'),
                                    ({'ScatterValue': 9}, 'ScatterValue'), ({'PaintOpAction': 3}, 'PaintOpAction'),
                                    ({'PressureSize': 'maybe'}, 'PressureSize'), ({'SizeSensor': {'id': 'pressure'}}, 'SizeSensor'),
                                    ({'SizeSensor': 'x' * 3000}, 'SizeSensor'), ({'SizecommonCurve': '0,0;2,1;'}, 'SizecommonCurve'),
                                    ({'SizeSensor': '<params id="mood"> <curve>0,0;1,1;</curve> </params>'}, 'SizeSensor')):
            with self.assertRaisesRegex(ValueError, message):
                m.expand(recipe(properties), preset(), PATTERNS)
        good = {'PressureSize': True, 'SizeUseCurve': True, 'SizeUseSameCurve': False, 'SizecommonCurve': '0,0;0.8,0.05;1,1;',
                'SizeSensor': '<!DOCTYPE params> <params id="pressure"> <curve>0,0;0.8,0.05;1,1;</curve> </params> ',
                'OpacityValue': 0.6, 'ScatterValue': 1.5, 'PaintOpAction': 1}
        self.assertEqual(m.expand(recipe(good), preset(), PATTERNS)['properties'], good)

    def test_a_texture_names_a_pattern_of_the_library(self):
        result = m.expand(recipe({'Texture/Pattern/Enabled': True, 'Texture/Pattern/Name': 'Canvas 04'}), preset(), PATTERNS)
        self.assertEqual(result['properties'], {'Texture/Pattern/Enabled': True, 'Texture/Pattern/Name': 'Canvas 04',
                                                'Texture/Pattern/PatternFileName': 'Crumpled_Paper.pat'})
        with self.assertRaisesRegex(ValueError, 'Linen.*Canvas 04'):
            m.expand(recipe({'Texture/Pattern/Enabled': True, 'Texture/Pattern/Name': 'Linen'}), preset(), PATTERNS)

    def test_the_blend_mode_is_the_jobs_own_option(self):
        self.assertEqual(m.expand(recipe({'CompositeOp': 'multiply', 'FlowValue': 0.4}), preset(), PATTERNS),
                         {'preset': 'base', 'properties': {'FlowValue': 0.4}, 'composite': 'multiply'})
        with self.assertRaisesRegex(ValueError, 'CompositeOp'):
            m.expand(recipe({'CompositeOp': 'erase'}), preset(), PATTERNS)

    def test_a_recipe_is_a_map_of_its_four_fields(self):
        for bad in ('soft', {'base_preset': 'base', 'engine': 'paintbrush'}, dict(recipe(), code='import os'),
                    dict(recipe(), properties=['PressureSize'])):
            with self.assertRaises(ValueError):
                m.expand(bad, preset(), PATTERNS)


if __name__ == '__main__':
    unittest.main()
