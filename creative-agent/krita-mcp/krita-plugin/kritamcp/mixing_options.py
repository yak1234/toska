# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""A paint pass's mixing model as job-local preset properties for Krita's brush engines (the fork's stroke job only).
Color Smudge reads ToskaMixingModel; MyPaint reads ToskaMyPaintPaintMode (the only way a MyPaint preset turns spectral)
and ToskaMyPaintSampleMerged. A blending pass on the agent's new, empty layer samples the paint below (MergedPaint)."""
import re

from .creative_validation import MODELS   # ('rgb', 'linear', 'perceptual', 'spectral', 'pigment')
COLORSMUDGE = 'colorsmudge'
MYPAINT = 'mypaintbrush'
BLENDING_PRESET = re.compile(r'blend|smudg', re.I)


def mixing_properties(paintop_id, preset_name, mixing_model, new_layer, smudge_overlay):
    """The preset properties a pass adds to its job's copy of the preset. Empty when nothing is asked and nothing samples
    below. Explicit smudge_overlay is applied by the caller on top, so it and smudge_rate keep winning."""
    if mixing_model is not None and mixing_model not in MODELS:
        raise ValueError('mixing_model must be one of ' + ', '.join(MODELS))
    properties = {}
    if mixing_model is not None and paintop_id == MYPAINT:
        if mixing_model == 'spectral':
            properties['ToskaMyPaintPaintMode'] = 1.0
            if new_layer:
                properties['ToskaMyPaintSampleMerged'] = True
        elif mixing_model != 'rgb':
            raise ValueError('MyPaint presets mix by rgb or spectral')
    elif mixing_model is not None and paintop_id != COLORSMUDGE:
        raise ValueError('The %s engine has no mixing model; mixing_model works on Color Smudge and MyPaint presets.' % paintop_id)
    elif paintop_id == COLORSMUDGE:
        if mixing_model is not None:
            properties['ToskaMixingModel'] = mixing_model
        if new_layer and not smudge_overlay and (BLENDING_PRESET.search(preset_name) or mixing_model not in (None, 'rgb')):
            properties['MergedPaint'] = True
    return properties
