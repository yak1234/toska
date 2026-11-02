# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""A paint pass's mixing model as job-local preset properties for Krita's brush engines (the fork's stroke job only).
Color Smudge reads ToskaMixingModel; MyPaint reads ToskaMyPaintPaintMode (the only way a MyPaint preset turns spectral).
Sampling the layers below (MergedPaint / ToskaMyPaintSampleMerged) is its own choice, `sample_below`, independent of the
mixing model: wet-into-wet only where the pass asks to blend with what is below, a glaze over dry paint stays translucent."""

from .creative_validation import MODELS   # ('rgb', 'linear', 'perceptual', 'spectral', 'pigment')
COLORSMUDGE = 'colorsmudge'
MYPAINT = 'mypaintbrush'


def mixing_properties(paintop_id, preset_name, mixing_model, new_layer, smudge_overlay, continued=False, sample_below=False):
    """The preset properties a pass adds to its job's copy of the preset. Empty when nothing is asked. `sample_below`
    (the pass asks to blend with the paint below) is the only thing that makes the brush read it, for rgb and spectral
    alike, on a new or a continued layer. Explicit smudge_overlay is applied by the caller on top, so it and smudge_rate
    keep winning. new_layer and continued no longer decide sampling; they stay in the signature for the callers."""
    if mixing_model is not None and mixing_model not in MODELS:
        raise ValueError('mixing_model must be one of ' + ', '.join(MODELS))
    properties = {}
    if paintop_id == MYPAINT:
        if mixing_model == 'spectral':
            properties['ToskaMyPaintPaintMode'] = 1.0
        elif mixing_model not in (None, 'rgb'):
            raise ValueError('MyPaint presets mix by rgb or spectral')
        if sample_below:
            properties['ToskaMyPaintSampleMerged'] = True
    elif mixing_model is not None and paintop_id != COLORSMUDGE:
        raise ValueError('The %s engine has no mixing model; mixing_model works on Color Smudge and MyPaint presets.' % paintop_id)
    elif paintop_id == COLORSMUDGE:
        if mixing_model is not None:
            properties['ToskaMixingModel'] = mixing_model
        if sample_below and not smudge_overlay:
            properties['MergedPaint'] = True
    return properties
