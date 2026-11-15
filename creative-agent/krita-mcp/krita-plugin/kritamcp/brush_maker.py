# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""A brush the painter made (painting-skills goal 2): its recipe checked against the base preset and turned into the
properties a stroke job sets on its own copy of that preset (Node.paintStrokes presetProperties).

A recipe is data from the companion (src/brush-recipe.ts): {base_preset, engine, properties, tip}. It can only set
checked keys of its engine inside limits, and nothing here reads a file, reaches the network or runs code. The check is
made twice on purpose (the companion's, then this one): Krita's engines ignore a key they do not have, silently, so an
unchecked typo would look like a brush that was made.

Kept free of krita and Qt imports, so it is tested outside Krita (tests/test_brush_maker.py).
"""
import json
import math
import os
import re
import xml.etree.ElementTree as ET

# Every setting name of each engine with a vocabulary, read from Toska's own presets (painting-skills task 3.1).
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'brush_engine_keys.json'), encoding='utf-8') as _stream:
    ENGINE_KEYS = {engine: frozenset(keys) for engine, keys in json.load(_stream).items()}

BLENDS = ('normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'dodge', 'burn', 'add', 'hard_light', 'soft_light_svg', 'color')
SENSORS = ('pressure', 'speed', 'drawingangle', 'fade', 'distance', 'fuzzy', 'fuzzystroke')
OPTIONS = ('Size', 'Opacity', 'Flow', 'Rotation', 'Scatter', 'Softness', 'Ratio')
NUMBERS = {'OpacityValue': (0, 1), 'FlowValue': (0, 1), 'ScatterValue': (0, 5), 'ColorRateValue': (0, 1), 'SmudgeRateValue': (0, 1),
           'SmudgeRadiusValue': (0, 300), 'Texture/Pattern/Scale': (0.1, 10), 'Texture/Strength/Value': (0, 1)}
CHOICES = {'PaintOpAction': (1, 2), 'SmudgeRateMode': (0, 1)}
SWITCHES = frozenset(['Pressure' + option for option in OPTIONS] + [option + suffix for option in OPTIONS for suffix in ('UseCurve', 'UseSameCurve')]
                     + ['Scattering/AxisX', 'Scattering/AxisY', 'Texture/Pattern/Enabled', 'PressureTexture/Strength/'])
# Settings one engine alone uses. Presets keep settings of engines they were once saved from (Toska's pixel-brush presets
# carry smudge keys), so a key found in an engine's presets is not proof the engine reads it.
ENGINE_ONLY = {'colorsmudge': frozenset(['ColorRateValue', 'SmudgeRateValue', 'SmudgeRateMode', 'SmudgeRadiusValue']),
               'paintbrush': frozenset(['PaintOpAction', 'PressureSoftness', 'SoftnessUseCurve', 'SoftnessUseSameCurve', 'SoftnessSensor',
                                        'SoftnesscommonCurve', 'FlowUseCurve', 'FlowUseSameCurve', 'FlowSensor', 'FlowcommonCurve'])}
CURVE = r'(?:(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?),(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?);){2,5}'
SENSOR = re.compile(r'(?:<!DOCTYPE params> )?<params id="(%s)"> <curve>%s</curve> </params> ?' % ('|'.join(SENSORS), CURVE))
# Tip attributes a recipe may set: on the Brush element, and on a generated tip's MaskGenerator. Angles are radians.
BRUSH_ATTRIBUTES = {'spacing': (0.01, 10), 'useAutoSpacing': (0, 1), 'angle': (-math.pi, math.pi), 'density': (0, 1), 'randomness': (0, 1)}
MASK_ATTRIBUTES = {'diameter': (1, 1000), 'ratio': (0.01, 1), 'hfade': (0, 1), 'vfade': (0, 1), 'spikes': (2, 12)}
MASK_TYPES = ('circle', 'rect')
NEW_MASK = {'id': 'default', 'type': 'circle', 'diameter': '40', 'ratio': '1', 'hfade': '1', 'vfade': '1', 'spikes': '2', 'antialiasEdges': '1'}


def _fields(value, label, allowed, required=()):
    if not isinstance(value, dict):
        raise ValueError(label + ' must be an object')
    unknown, missing = set(value) - set(allowed), set(required) - set(value)
    if unknown:
        raise ValueError('%s: unknown fields %s' % (label, ', '.join(sorted(unknown))))
    if missing:
        raise ValueError('%s: missing fields %s' % (label, ', '.join(sorted(missing))))


def _number(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('%s must be a number from %s to %s' % (label, low, high))
    return value


def _attribute(name, value, limits, label):
    """A tip attribute as Krita's text: a number in range, given as a number or as its text."""
    if name not in limits:
        raise ValueError('%s cannot set the tip attribute %s (it takes %s)' % (label, name, ', '.join(sorted(limits))))
    try:
        number = float(value) if isinstance(value, str) else value
    except ValueError:
        number = None
    low, high = limits[name]
    _number(number, '%s %s' % (label, name), low, high)
    if name in ('spikes', 'useAutoSpacing') and number != int(number):
        raise ValueError('%s %s must be a whole number' % (label, name))
    return ('%d' % number) if number == int(number) else ('%.6f' % number).rstrip('0')


def _property(key, value):
    if key in SWITCHES:
        if not isinstance(value, bool):
            raise ValueError('%s must be true or false' % key)
    elif key in NUMBERS:
        _number(value, key, *NUMBERS[key])
    elif key in CHOICES:
        if isinstance(value, bool) or value not in CHOICES[key]:
            raise ValueError('%s must be one of %s' % (key, ', '.join(str(v) for v in CHOICES[key])))
    elif key == 'CompositeOp':
        if value not in BLENDS:
            raise ValueError('CompositeOp must be one of ' + ', '.join(BLENDS))
    elif key == 'Texture/Pattern/Name':
        if not isinstance(value, str) or not value.strip() or len(value) > 100:
            raise ValueError('Texture/Pattern/Name must name a pattern (up to 100 characters)')
    elif key.endswith('Sensor') and key[:-len('Sensor')] in OPTIONS:
        if not isinstance(value, str) or len(value) > 400 or not SENSOR.fullmatch(value):
            raise ValueError('%s must be one pen input (%s) with a curve of 2 to 5 points from 0 to 1' % (key, ', '.join(SENSORS)))
    elif key.endswith('commonCurve') and key[:-len('commonCurve')] in OPTIONS:
        if not isinstance(value, str) or not re.fullmatch(CURVE, value):
            raise ValueError('%s must be a curve of 2 to 5 points from 0 to 1' % key)
    else:
        # A real key of the engine that no recipe sets: the tip goes through the tip change (brush_definition), and
        # everything else is outside the vocabulary.
        raise ValueError('%s cannot be set by a brush recipe' % key)


def engine_of(preset_xml):
    """The paintop id of a preset's XML (Preset.toXML())."""
    return ET.fromstring(preset_xml).get('paintopid')


def _tip(change, preset_xml):
    """The base preset's brush_definition with the recipe's tip change applied, as Krita's XML text."""
    _fields(change, 'tip', ('replace', 'brush', 'mask'), ('replace', 'brush', 'mask'))
    if not isinstance(change['replace'], bool):
        raise ValueError('tip replace must be true or false')
    _fields(change['brush'], 'tip brush', tuple(change['brush']) if isinstance(change['brush'], dict) else ())
    _fields(change['mask'], 'tip mask', tuple(change['mask']) if isinstance(change['mask'], dict) else ())
    brush_changes = {name: _attribute(name, value, BRUSH_ATTRIBUTES, 'tip brush') for name, value in change['brush'].items()}
    mask_changes = {}
    for name, value in change['mask'].items():
        if name == 'type':
            if value not in MASK_TYPES:
                raise ValueError('tip mask type must be one of ' + ', '.join(MASK_TYPES))
            mask_changes[name] = value
        else:
            mask_changes[name] = _attribute(name, value, MASK_ATTRIBUTES, 'tip mask')
    definition = next((p.text for p in ET.fromstring(preset_xml).iter('param') if p.get('name') == 'brush_definition'), None)
    if not definition or not definition.strip():
        raise ValueError('The base preset has no tip definition, so its tip cannot be changed')
    base = ET.fromstring(definition.strip())
    base_mask = base.find('MaskGenerator')
    if change['replace']:
        # A new generated tip. It keeps the base's spacing and angle (a tip's shape, not its rhythm, is replaced).
        brush = ET.Element('Brush', {'type': 'auto_brush', 'BrushVersion': '2', 'useAutoSpacing': base.get('useAutoSpacing', '0'),
                                     'autoSpacingCoeff': base.get('autoSpacingCoeff', '1'), 'spacing': base.get('spacing', '0.1'),
                                     'angle': base.get('angle', '0'), 'randomness': base.get('randomness', '0'), 'density': base.get('density', '1')})
        mask = ET.SubElement(brush, 'MaskGenerator', dict(NEW_MASK, **({k: v for k, v in base_mask.attrib.items() if k in NEW_MASK}
                                                                         if base_mask is not None else {})))
    else:
        brush, mask = base, base_mask
        if mask_changes and mask is None:
            raise ValueError('This preset\'s tip is an image, so it has no shape settings: give tip.shape to replace it with a generated tip')
    brush.attrib.update(brush_changes)
    if mask is not None:
        mask.attrib.update(mask_changes)
    return ET.tostring(brush, encoding='unicode') + ' '


def expand(recipe, preset_xml, patterns):
    """{'preset', 'properties', 'composite'} for a stroke job: `properties` goes to presetProperties, `composite` (or
    None) to the job's own compositeOp (a stroke's blend mode is the job's option, not a preset setting).
    `preset_xml` is the base preset's Preset.toXML(); `patterns` maps the library's pattern names to file names.
    Raises ValueError naming what is refused; nothing is changed anywhere."""
    _fields(recipe, 'brush recipe', ('base_preset', 'engine', 'properties', 'tip'), ('base_preset', 'engine', 'properties'))
    engine, properties = recipe['engine'], recipe['properties']
    if engine not in ENGINE_KEYS:
        raise ValueError('No brush can be made for the engine %s yet (only %s)' % (engine, ', '.join(sorted(ENGINE_KEYS))))
    base_engine = engine_of(preset_xml)
    if base_engine != engine:
        raise ValueError('The recipe is for the engine %s, but its base preset is a %s preset' % (engine, base_engine))
    if not isinstance(properties, dict):
        raise ValueError('brush recipe properties must be an object')
    out = {}
    for key, value in properties.items():
        if key not in ENGINE_KEYS[engine] or any(key in only for other, only in ENGINE_ONLY.items() if other != engine):
            raise ValueError('%s is not a setting of the %s engine' % (key, engine))
        _property(key, value)
        out[key] = value
    composite = out.pop('CompositeOp', None)
    if 'Texture/Pattern/Name' in out:
        name = out['Texture/Pattern/Name']
        if name not in patterns:
            raise ValueError('No pattern named %s in the library; some that exist: %s' % (name, ', '.join(sorted(patterns)[:8])))
        out['Texture/Pattern/PatternFileName'] = patterns[name]
    if recipe.get('tip') is not None:
        out['brush_definition'] = _tip(recipe['tip'], preset_xml)
    return {'preset': recipe['base_preset'], 'properties': out, 'composite': composite}
