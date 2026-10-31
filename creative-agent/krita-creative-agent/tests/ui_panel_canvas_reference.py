"""Run: uv run -q --with pyqt5 python tests/ui_panel_canvas_reference.py (and --with pyqt6). A UI script like
ui_panel_auto_approve: it stubs krita for the whole process. The canvas reference card (canvas-reference.ts; the artist,
2026-10-25: "not make the edits but make a reference generation of what the edit would look like"): the canvas and the
reference side by side in one picture, the card's notes (the change's share, a warning when it changed a lot, where the
canvas was sent) always visible, and Use as the target / Use as the new goal / Try again / Discard, each sending the card's answer once. It is
never answered by Auto-approve, even set to Immediately. The clock is faked; the picture is written to a temporary
folder that is removed. No dialog opens and no profile is touched (Qt's test mode for standard paths)."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['KRITA_CREATIVE_NO_AUTOSTART'] = '1'
import importlib
import importlib.util

PLUGIN = Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
package = types.ModuleType('panel_reference_test'); package.__path__ = [str(PLUGIN)]; sys.modules['panel_reference_test'] = package
from panel_reference_test.qt_compat import QApplication, QDockWidget, QStandardPaths, QPushButton, QLabel, QImage, QColor, QObject
from panel_reference_test import auto_approve
from panel_reference_test import canvas_reference_viewer as viewer_module
from panel_reference_test.qt_compat import QtCore, QPoint, Qt
QTest = importlib.import_module(QtCore.__name__.split('.')[0] + '.QtTest').QTest
QStandardPaths.setTestModeEnabled(True)


class Instance:
    activeDocument = staticmethod(lambda: None)
    documents = staticmethod(lambda: [])
    addDockWidgetFactory = staticmethod(lambda factory: None)


stub = types.ModuleType('krita'); stub.DockWidget = QDockWidget
stub.DockWidgetFactory = object; stub.DockWidgetFactoryBase = types.SimpleNamespace(DockRight=2)
stub.Krita = types.SimpleNamespace(instance=lambda: Instance)
stub.Selection = object
sys.modules['krita'] = stub
spec = importlib.util.spec_from_file_location('panel_reference_test.creative_docker', PLUGIN / 'creative_docker.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
app = QApplication.instance() or QApplication([])
QProcess = module.QProcess

FIELD = {'key': 'auto_approve', 'label': 'Auto-approve', 'accessible': 'Auto-approve', 'tooltip': 't', 'note': '', 'control': 'combo',
         'options': [{'value': 'off', 'label': 'Off'}, {'value': 0, 'label': 'Immediately'}, {'value': 10, 'label': '10 s'},
                     {'value': 30, 'label': '30 s'}, {'value': 60, 'label': '60 s'}]}
OPTIONS = ['Use as the target', 'Use as the new goal', 'Try again', 'Discard']
ACTIONS = ['use', 'goal', 'retry', 'discard']
MESSAGE = ('A reference of “add more ghosts”: the canvas (left) and the reference (right). The change covers 18% of the canvas, '
           'outlined in red. Nothing is painted until you use it.\n\nYour canvas was sent to ChatGPT (your Codex sign-in) to make this picture.')


class Rules(unittest.TestCase):
    def test_the_canvas_reference_is_never_offered(self):
        class Owner(QObject):
            def show_auto_status(self, text): pass
            def auto_answered(self, card): pass
        owner = Owner(); auto = auto_approve.AutoApprove(owner, clock=lambda: 0.0); auto.set_delay(0)
        self.assertIn('canvas_reference', auto_approve.NEVER)
        self.assertFalse(auto.offer('ref:r1', 'canvas_reference', 'use', 'Using', 'x', lambda panel: None))
        self.assertFalse(auto.counting())


class ViewerGeometry(unittest.TestCase):
    """The viewer's mark (canvas_reference_viewer.py): plain Python, no Qt."""
    def test_a_box_is_four_corners_whichever_way_it_is_dragged(self):
        self.assertEqual(viewer_module.box_points(30, 40, 10, 5), [(10, 5), (30, 5), (30, 40), (10, 40)])

    def test_a_mark_is_in_0_1_canvas_coordinates_clamped_or_none_when_it_encloses_nothing(self):
        self.assertEqual(viewer_module.normalized([(0, 0), (200, 0), (200, 100), (0, 100)], 400, 200), [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]])
        self.assertEqual(viewer_module.normalized([(-5, 0), (500, 0), (500, 300)], 400, 200), [[0, 0], [1, 0], [1, 1]], 'clamped to the picture')
        self.assertIsNone(viewer_module.normalized([(10, 10), (20, 20), (30, 30)], 400, 200), 'a line encloses nothing')
        self.assertIsNone(viewer_module.normalized([(10, 10), (20, 20)], 400, 200))

    def test_freehand_keeps_points_a_step_apart(self):
        points = [(x * 0.5, 0) for x in range(41)]
        self.assertEqual(viewer_module.simplified(points, 5), [(0, 0), (5.0, 0), (10.0, 0), (15.0, 0), (20.0, 0)])


class PanelCanvasReference(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix='ui-canvas-reference-')
        self.picture = os.path.join(self.folder, 'compare.png')
        image = QImage(408, 150, QImage.Format.Format_RGB32); image.fill(QColor(90, 110, 160)); image.save(self.picture)
        # The viewer's pictures: the reference (400 x 300), the canvas view it was made from, the found area (a mask).
        self.paths = {name: os.path.join(self.folder, name + '.png') for name in ('reference', 'canvas', 'mask')}
        for name, size, color in (('reference', (400, 300), QColor(200, 120, 60)), ('canvas', (200, 150), QColor(60, 90, 200)), ('mask', (100, 75), QColor(0, 0, 0))):
            picture = QImage(*size, QImage.Format.Format_RGB32); picture.fill(color); picture.save(self.paths[name])
        self.commands = []; self.now = [1000.0]
        self.panel = module.CreativeAgentDocker(); self.panel.resize(320, 900); self.panel.show()
        self.panel.process = types.SimpleNamespace(state=lambda: QProcess.ProcessState.Running,
                                                   write=lambda data: self.commands.append(json.loads(data)))
        self.panel.auto_approve.clock = lambda: self.now[0]
        self.panel.handle_event({'type': 'ready', 'models': [{'provider': 'openrouter', 'id': 'm', 'name': 'M', 'configured': True}],
                                 'bridge': {}, 'build': {'version': '1', 'build_id': 'b'}})
        self.panel.handle_event({'type': 'settings_schema', 'fields': [FIELD]})
        self.panel.handle_event({'type': 'execution_settings', 'settings': {'auto_approve': 0, 'reasoning': 'auto'}})   # Immediately
        self.commands.clear()

    def tearDown(self):
        self.panel.process = None; self.panel.close(); self.panel.deleteLater()
        for _ in range(4): app.processEvents()
        module.QCoreApplication.sendPostedEvents(None, module.QEvent.Type.DeferredDelete)
        shutil.rmtree(self.folder, ignore_errors=True)

    def card(self, **extra):
        event = dict({'type': 'canvas_reference', 'id': 'r1', 'title': 'Canvas reference', 'message': MESSAGE, 'image_path': self.picture,
                      'options': OPTIONS, 'actions': ACTIONS, 'share': 0.18, 'wide': False, 'auto_approve': False}, **extra)
        self.panel.handle_event(event); app.processEvents()
        return [b for b in self.panel.canvas_reference_controls]

    def wait(self, seconds):
        self.now[0] += seconds; self.panel.auto_approve.tick(); app.processEvents()

    def texts(self):
        return [label.text() for label in self.panel.findChildren(QLabel) if label.isVisible()]

    def test_the_card_shows_both_pictures_its_notes_and_its_answers(self):
        buttons = self.card()
        self.assertEqual([b.text() for b in buttons], OPTIONS)
        pictures = [l for l in self.panel.findChildren(QLabel) if l.objectName() == 'questionImage' and l.isVisible()]
        self.assertTrue(pictures and not pictures[-1].pixmap().isNull(), 'the side-by-side picture')
        shown = '\n'.join(self.texts())
        self.assertIn('18% of the canvas', shown)
        self.assertIn('Your canvas was sent to ChatGPT', shown, 'the upload notice is always visible, not folded away')

    def test_auto_approve_never_answers_it(self):
        self.card()
        self.wait(0); self.wait(120)
        self.assertEqual([c for c in self.commands if c['type'] in ('canvas_reference', 'auto_approved')], [])
        self.assertFalse([t for t in self.texts() if t.startswith('Auto-approve:')])

    def test_each_answer_is_sent_once(self):
        for action, index in (('use', 0), ('goal', 1), ('retry', 2), ('discard', 3)):
            self.commands.clear()
            buttons = self.card(id='r-' + action)
            buttons[index].click(); app.processEvents()
            self.assertEqual([c for c in self.commands if c['type'] == 'canvas_reference'], [{'type': 'canvas_reference', 'id': 'r-' + action, 'action': action}])
            self.assertTrue(all(not b.isEnabled() for b in buttons), 'answered once')

    def test_a_wide_change_is_warned_about(self):
        self.card(message=MESSAGE.split('\n\n')[0] + '\n\nThe model changed a lot (72% of the canvas): try a narrower instruction, or name an area (… in the sky).', wide=True)
        self.assertTrue(any('changed a lot' in t for t in self.texts()))

    def viewer_card(self):
        buttons = self.card(reference_path=self.paths['reference'], canvas_path=self.paths['canvas'], mask_path=self.paths['mask'], mask_size=[100, 75])
        picture = [l for l in self.panel.findChildren(QLabel) if l.objectName() == 'questionImage' and l.isVisible()][-1]
        QTest.mouseClick(picture, Qt.MouseButton.LeftButton); app.processEvents()
        viewer = self.panel.reference_viewer
        self.assertTrue(viewer.isVisible() and viewer.isWindow(), 'clicking the picture opens its own window')
        return buttons, viewer

    def test_the_viewer_zooms_pans_and_shows_the_canvas_before(self):
        _buttons, viewer = self.viewer_card()
        self.assertEqual([b.text() for b in viewer.answer_buttons], OPTIONS, "the card's answers")
        viewer.view.set_zoom(1.0); self.assertAlmostEqual(viewer.view.zoom(), 1.0); self.assertEqual(viewer.zoom_label.text(), '100%')
        viewer.zoom_box.activated.emit(3); self.assertAlmostEqual(viewer.view.zoom(), 2.0, msg='the 200% item')
        QTest.mouseClick(viewer.view.viewport(), Qt.MouseButton.LeftButton)            # a click in Move marks nothing
        self.assertIsNone(viewer.mark)
        viewer.view.wheelEvent(types.SimpleNamespace(angleDelta=lambda: QPoint(0, 240)))
        self.assertAlmostEqual(viewer.view.zoom(), 2.0 * viewer_module.WHEEL_STEP ** 2, places=3)
        self.assertFalse(viewer.view.canvas.isVisible())
        QTest.keyPress(viewer, Qt.Key.Key_Space); self.assertTrue(viewer.view.canvas.isVisible(), 'hold Space: the canvas as it was')
        QTest.keyRelease(viewer, Qt.Key.Key_Space); self.assertFalse(viewer.view.canvas.isVisible())
        viewer.before.click(); self.assertTrue(viewer.view.canvas.isVisible(), 'or the toggle')
        self.assertTrue(viewer.view.area.isVisible()); viewer.show_found.click(); self.assertFalse(viewer.view.area.isVisible())
        self.assertEqual(self.commands, [], 'looking sends nothing')

    def test_a_marked_box_goes_with_use_and_closes_the_card(self):
        buttons, viewer = self.viewer_card()
        viewer.view.set_zoom(1.0); viewer.view.centerOn(200, 150); app.processEvents()
        viewer.tool_buttons['box'].click()
        start = viewer.view.mapFromScene(100, 75); end = viewer.view.mapFromScene(300, 225)
        QTest.mousePress(viewer.view.viewport(), Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, start)
        QTest.mouseMove(viewer.view.viewport(), end)
        QTest.mouseRelease(viewer.view.viewport(), Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, end)
        self.assertEqual(len(viewer.mark), 4)
        for (x, y), (ex, ey) in zip(viewer.mark, [(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)]):
            self.assertAlmostEqual(x, ex, delta=0.01); self.assertAlmostEqual(y, ey, delta=0.01)
        self.assertTrue(viewer.clear.isEnabled())
        viewer.answer_buttons[0].click(); app.processEvents()
        sent = [c for c in self.commands if c['type'] == 'canvas_reference']
        self.assertEqual(len(sent), 1); self.assertEqual(sent[0]['action'], 'use'); self.assertEqual(sent[0]['area'], viewer.mark)
        self.assertFalse(viewer.isVisible(), 'the window closes')
        self.assertTrue(all(not b.isEnabled() for b in buttons), "the card's buttons close too")
        self.panel.open_reference_viewer({}, None, buttons)
        self.assertIn('already answered', self.panel.status.text())

    def test_describe_edits_sends_try_again_with_the_words_and_clear_drops_the_mark(self):
        _buttons, viewer = self.viewer_card()
        viewer.set_mark([(0, 0), (200, 0), (200, 150)]); self.assertIsNotNone(viewer.mark)
        viewer.clear.click(); self.assertIsNone(viewer.mark)
        viewer.describe.setText('  make the general older  '); QTest.keyClick(viewer.describe, Qt.Key.Key_Return); app.processEvents()
        self.assertEqual([c for c in self.commands if c['type'] == 'canvas_reference'],
                         [{'type': 'canvas_reference', 'id': 'r1', 'action': 'retry', 'text': 'make the general older'}])

    def test_no_change_offers_only_try_again_and_discard(self):
        buttons = self.card(options=['Try again', 'Discard'], actions=['retry', 'discard'])
        self.assertEqual([b.text() for b in buttons], ['Try again', 'Discard'])
        buttons[0].click()
        self.assertEqual(self.commands[-1], {'type': 'canvas_reference', 'id': 'r1', 'action': 'retry'})


if __name__ == '__main__':
    unittest.main()
