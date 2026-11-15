# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""brush_swatch (painting-skills goal 2, task 3.3): show what a brush does before it is kept.

  brush_swatch  {preset | recipe, out_path, size?}

One fixed sheet of strokes (brush_maker.swatch_sheet) is painted with a base preset as saved, or with a brush recipe
expanded onto its base (brush_maker.expand), and written as a PNG into the chat folder. The painter sees the two beside
a close-up of the original; Luna says which is closer.

The sheet is painted on the plugin's own scratch document: made once, with no view, cleared before every swatch and
never closed while Toska runs (the plugin lets go of it when Toska quits). It is never the artist's: creative_document_identity leaves it out of the open
documents, it is never saved, and it is left unmodified so quitting asks nothing. brush_probe is never called. Not a
pass, a checkpoint or a journal entry: no painting is read or changed.
"""
import time

from . import brush_maker
from .creative_validation import fields, numeric, text

SHEET = (1600, 1000)                  # the sheet's size in pixels
SCRATCH_NAME = 'Toska brush swatches'
JOB_SECONDS = 60
STRIPE, STRIPE_COLOURS = 80, ((40, 60, 200), (190, 110, 40))     # stripe width in pixels; a warm and a cool colour, BGR
SWATCH_FIELDS = ('preset', 'recipe', 'out_path', 'size')


class BrushCraft:
    def _brush_scratch(self):
        """(document, layer) of the scratch sheet, made at the first swatch and kept while it is still open."""
        from krita import Krita
        from .creative_document_identity import hide_document, _same_document
        app = Krita.instance()
        held = getattr(self, '_brush_scratch_held', None)
        if held and any(_same_document(held[0], doc) for doc in app.documents()):
            return held
        doc = app.createDocument(SHEET[0], SHEET[1], SCRATCH_NAME, 'RGBA', 'U8', '', 300.0)
        hide_document(doc)
        doc.setBatchmode(True)
        layer = doc.createNode('swatch', 'paintlayer')
        doc.rootNode().addChildNode(layer, None)
        self._brush_scratch_held = (doc, layer)
        if not getattr(self, '_brush_release_connected', False):
            # Held while Toska shuts down, the document crashed the process at exit (kritarunner, exit 139).
            from .qt_compat import QCoreApplication
            application = getattr(QCoreApplication, 'instance', lambda: None)()
            if application is not None:
                application.aboutToQuit.connect(self._brush_release)
                self._brush_release_connected = True
        return self._brush_scratch_held

    def _brush_release(self):
        """Let go of the scratch document (Krita then closes it: it has no view and nothing else holds it)."""
        held, self._brush_scratch_held = getattr(self, '_brush_scratch_held', None), None
        if held:
            from .creative_document_identity import unhide_document
            unhide_document(held[0])

    def _brush_preset_xml(self, name):
        from krita import Krita, Preset
        return Preset(Krita.instance().resources('preset')[name]).toXML()

    def _brush_patterns(self):
        from krita import Krita
        return {name: resource.filename() for name, resource in Krita.instance().resources('pattern').items()}

    def _brush_swatch(self, session, params):
        import cv2
        import numpy as np
        from .qt_compat import QCoreApplication
        fields(params, SWATCH_FIELDS, ('out_path',))
        if ('preset' in params) == ('recipe' in params):
            raise ValueError('Give a preset or a recipe, one of them.')
        target = brush_maker.inside(session.get('output'), params['out_path'], 'out_path')
        if not target.lower().endswith('.png'):
            raise ValueError('out_path is a .png file.')
        size = numeric(params.get('size', 60), 'size', 4, 300)
        base = text(params['preset'], 'preset', 200) if 'preset' in params else None
        recipe = params.get('recipe')
        if recipe is not None and (not isinstance(recipe, dict) or not isinstance(recipe.get('base_preset'), str)):
            raise ValueError('recipe is a brush recipe with its base_preset.')
        try:
            xml = self._brush_preset_xml(base or recipe['base_preset'])
        except KeyError:
            raise ValueError('Use an exact installed preset name from list_brushes') from None
        expanded = brush_maker.expand(recipe, xml, self._brush_patterns()) if recipe is not None else {'preset': base, 'properties': {}, 'composite': None}
        doc, layer = self._brush_scratch()
        if not hasattr(layer, 'paintStrokes'):
            raise ValueError('A brush swatch needs Toska (stroke jobs are the fork\'s).')
        width, height = SHEET
        strokes = brush_maker.swatch_sheet(width, height, size)
        options = {'preset': expanded['preset'], 'name': 'Brush swatch', 'size': size}
        if expanded['properties']:
            options['presetProperties'] = expanded['properties']
        if expanded['composite']:
            options['compositeOp'] = expanded['composite']
        # The ground: white for a brush that lays paint. A blender lays none, so it gets two colours in stripes to drag
        # across (every stroke of the sheet crosses several), or its swatch would be white on white.
        ground = np.full((height, width, 4), 255, np.uint8)
        if brush_maker.engine_of(xml) == 'colorsmudge':
            columns = (np.arange(width) // STRIPE) % 2 == 0
            ground[:, columns, :3], ground[:, ~columns, :3] = STRIPE_COLOURS[0], STRIPE_COLOURS[1]
        layer.setPixelData(ground.tobytes(), 0, 0, width, height)
        job = layer.paintStrokes(strokes, options, None)
        deadline = time.monotonic() + JOB_SECONDS
        try:
            while job.state() in ('queued', 'running'):
                QCoreApplication.processEvents()                # the job's feeder runs from the event loop
                if job.wait(50):
                    break
                if time.monotonic() > deadline:
                    job.cancel()
                    raise RuntimeError('The brush swatch took too long and was stopped.')
            if hasattr(doc, 'waitForDone'):
                doc.waitForDone()
            if job.state() == 'failed':
                return {'status': 'rejected', 'error_code': 'validation_rejected',
                        'error': 'Krita refused the swatch and painted nothing: ' + (job.errorString() or 'no reason given')}
            pixels = np.frombuffer(bytes(layer.pixelData(0, 0, width, height)), np.uint8).reshape(height, width, 4)   # BGRA, as OpenCV writes
            if not cv2.imwrite(target, pixels):
                raise RuntimeError('The brush swatch could not be written.')
            ink = float((pixels[:, :, :3].min(axis=2) < 250).mean())
        finally:
            doc.setModified(False)                               # never a document to save: quitting asks nothing
        return {'status': 'ok', 'path': target, 'width': width, 'height': height, 'preset': expanded['preset'], 'engine': brush_maker.engine_of(xml), 'size': size,
                'properties': sorted(expanded['properties']), 'strokes': job.strokesDone(), 'ms': job.elapsedMs(), 'ink_share': round(ink, 4)}
