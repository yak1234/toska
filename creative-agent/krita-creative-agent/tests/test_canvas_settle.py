"""A whole-image refresh never follows an async paint call before the stroke has settled (the New Moscow deadlock: ~108
queued update jobs filled the pool while the stroke's final merge needed a thread), and the commands loop never waits
forever on the GUI thread. Fake documents and layers record the call order; nothing here touches Krita."""
import importlib.util
import pathlib
import sys
import time
import types
import unittest
import test_native as native
import test_precision_move as precision
import test_toolbox as toolbox

SOURCE = pathlib.Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
INIT_PACKAGE = 'canvas_settle_init_package'
NOT_SETTLED = 'did not settle'


class Path:
    def __init__(self): self.calls = []
    def moveTo(self, *a): self.calls.append('move')
    def lineTo(self, *a): self.calls.append('line')
    def cubicTo(self, *a): self.calls.append('cubic')


class Doc:
    """Records calls in one list. settles=False: the image never goes idle (tryBarrierLock keeps answering False)."""
    def __init__(self, events, settles=True, barrier=False):
        self.events, self.settles = events, settles
        if barrier:
            self.tryBarrierLock = self._try
    def _try(self):
        self.events.append('try')
        return self.settles
    def unlock(self): self.events.append('unlock')
    def waitForDone(self): self.events.append('wait')
    def refreshProjection(self, *a): self.events.append('refresh')
    def width(self): return 100
    def height(self): return 100


class Layer:
    def __init__(self, events): self.events = events
    def locked(self): return False
    def visible(self): return True
    def paintAbility(self): return 'PAINT'
    def name(self): return 'layer'
    def paintPath(self, *a): self.events.append('paint')
    def paintEllipse(self, *a): self.events.append('paint')
    def paintRectangle(self, *a): self.events.append('paint')
    def paintLine(self, *a): self.events.append('paint')
    def paintPolygon(self, *a): self.events.append('paint')


class View:
    def disablePressure(self): return False
    def setDisablePressure(self, v): pass
    def setBrushRotation(self, v): pass


def load_init_package():
    """The plugin's __init__ (the bridge commands) on stub Krita and Qt modules; the real krita stub is put back after."""
    previous = sys.modules.get('krita')
    package = types.ModuleType(INIT_PACKAGE); package.__path__ = [str(SOURCE)]
    sys.modules[INIT_PACKAGE] = package
    krita = types.ModuleType('krita')
    class Extension:
        def __init__(self, parent=None): pass
    class Anything:
        def __init__(self, *a, **k): pass
    class App:
        def __getattr__(self, name): return lambda *a, **k: None
    krita.Extension, krita.Krita = Extension, types.SimpleNamespace(instance=lambda: App())
    for name in ('Selection', 'InfoObject', 'ManagedColor', 'Node', 'DockWidget', 'DockWidgetFactory', 'DockWidgetFactoryBase'):
        setattr(krita, name, Anything)
    sys.modules['krita'] = krita
    compat = types.ModuleType(INIT_PACKAGE + '.qt_compat')
    compat.QCoreApplication = types.SimpleNamespace(organizationName=lambda: '', processEvents=lambda: None)
    compat.__getattr__ = lambda name: (_ for _ in ()).throw(AttributeError(name)) if name.startswith('__') else \
        type(name, (), {'__init__': lambda self, *a, **k: None})
    compat.QT6 = False
    sys.modules[compat.__name__] = compat; package.qt_compat = compat
    try:
        spec = importlib.util.spec_from_file_location(INIT_PACKAGE, SOURCE / '__init__.py', submodule_search_locations=[str(SOURCE)])
        module = importlib.util.module_from_spec(spec); sys.modules[INIT_PACKAGE] = module
        spec.loader.exec_module(module)
    finally:
        if previous is not None: sys.modules['krita'] = previous
    module.QPainterPath, module.QPointF, module.QPoint, module.QRectF = Path, lambda x, y: (x, y), lambda x, y: (x, y), lambda *a: a
    return module


class SettleHelperTests(unittest.TestCase):
    def helper(self):
        return native.module.canvas_settle

    def test_waits_with_the_barrier_try_and_never_the_unbounded_wait_where_the_binding_has_it(self):
        events = []
        self.assertTrue(self.helper().settle(Doc(events, barrier=True)))
        self.assertEqual(events, ['try', 'unlock'])

    def test_a_document_without_the_try_waits_as_before(self):
        events = []
        self.assertTrue(self.helper().settle(Doc(events)))
        self.assertEqual(events, ['wait'])

    def test_a_canvas_that_never_goes_idle_gives_up_at_the_deadline(self):
        events, started = [], time.monotonic()
        self.assertFalse(self.helper().settle(Doc(events, settles=False, barrier=True), deadline=0.05))
        self.assertLess(time.monotonic() - started, 2)
        self.assertNotIn('wait', events)

    def test_refresh_settled_waits_then_refreshes_and_refuses_to_refresh_an_unsettled_canvas(self):
        events = []
        self.assertTrue(self.helper().refresh_settled(Doc(events)))
        self.assertEqual(events, ['wait', 'refresh', 'wait'])
        events.clear()
        self.assertFalse(self.helper().refresh_settled(Doc(events, settles=False, barrier=True), deadline=0.02))
        self.assertNotIn('refresh', events)


class CurveStrokeTests(unittest.TestCase):
    def tools(self, doc, layer):
        module = precision.load_precision_tools()
        module.QPainterPath, module.QColor = Path, lambda c: types.SimpleNamespace(isValid=lambda: True)
        tools = module.PrecisionTools()
        tools._require_layer = lambda: (doc, layer, None)
        tools.get_active_view = lambda: View()
        tools._apply_brush_state = lambda *a, **k: None
        tools.current_brush_size, tools.current_opacity = 10, 1
        return tools

    PARAMS = {'start': [0, 0], 'segments': [[1, 1, 2, 2, 3, 3]]}

    def test_curve_stroke_waits_for_the_stroke_before_the_whole_image_refresh(self):
        events = []
        result = self.tools(Doc(events), Layer(events)).cmd_curve_stroke(dict(self.PARAMS))
        self.assertEqual(result['status'], 'ok')
        self.assertLess(events.index('wait'), events.index('refresh'))
        self.assertEqual(events[0], 'paint')

    def test_curve_stroke_that_never_settles_is_an_error_without_a_refresh(self):
        events = []
        tools = self.tools(Doc(events, settles=False, barrier=True), Layer(events))
        module = sys.modules[type(tools).__module__].canvas_settle
        previous, module.SETTLE_SECONDS = module.SETTLE_SECONDS, 0.05
        try:
            result = tools.cmd_curve_stroke(dict(self.PARAMS))
        finally:
            module.SETTLE_SECONDS = previous
        self.assertIn(NOT_SETTLED, result['error'])
        self.assertNotIn('refresh', events)

    def test_settle_false_leaves_the_wait_to_the_caller(self):
        events = []
        self.tools(Doc(events), Layer(events)).cmd_curve_stroke(dict(self.PARAMS), settle=False)
        self.assertEqual(events, ['paint'])


class BridgeCommandTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.module = load_init_package()

    def extension(self, doc, layer):
        extension = self.module.KritaMCPExtension(None)
        extension._require_layer = lambda: (doc, layer, None)
        extension.get_active_view = lambda: View()
        extension._apply_brush_state = lambda *a, **k: None
        return extension

    def check_order(self, run):
        events = []
        result = run(Doc(events), Layer(events))
        self.assertNotIn('error', result)
        self.assertIn('paint', events)
        self.assertLess(events.index('paint'), events.index('wait'), 'the paint call comes first')
        self.assertLess(events.index('wait'), events.index('refresh'), 'the wait comes before the whole-image refresh')

    def test_native_stroke_waits_before_refreshing(self):
        self.check_order(lambda d, l: self.extension(d, l).cmd_stroke({'points': [[0, 0], [5, 5]]}))

    def test_fill_waits_before_refreshing(self):
        self.check_order(lambda d, l: self.extension(d, l).cmd_fill({'x': 5, 'y': 5, 'radius': 3}))

    def test_outline_shapes_wait_before_refreshing(self):
        self.check_order(lambda d, l: self.extension(d, l).cmd_draw_shape({'shape': 'line', 'x': 0, 'y': 0, 'x2': 5, 'y2': 5}))
        self.check_order(lambda d, l: self.extension(d, l).cmd_draw_shape({'shape': 'polygon', 'points': [[0, 0], [5, 0], [5, 5]]}))

    def test_a_canvas_that_never_settles_is_an_error_from_each_command(self):
        helper = sys.modules[INIT_PACKAGE + '.canvas_settle']
        previous, helper.SETTLE_SECONDS = helper.SETTLE_SECONDS, 0.02
        try:
            for run in (lambda e: e.cmd_stroke({'points': [[0, 0], [5, 5]]}), lambda e: e.cmd_fill({'x': 5, 'y': 5, 'radius': 3}),
                        lambda e: e.cmd_draw_shape({'shape': 'line'})):
                events = []
                result = run(self.extension(Doc(events, settles=False, barrier=True), Layer(events)))
                self.assertIn(NOT_SETTLED, result['error'])
                self.assertNotIn('refresh', events)
        finally:
            helper.SETTLE_SECONDS = previous


class StuckDoc(toolbox.native.Document):
    """A canvas that never goes idle: the barrier try fails forever, and the unbounded waits would hang the GUI thread."""
    def __init__(self): super().__init__(); self.events = []
    def tryBarrierLock(self): return False
    def unlock(self): pass
    def waitForDone(self): self.events.append('wait'); raise AssertionError('unbounded Document.waitForDone on the GUI thread')
    def refreshProjection(self, *a): self.events.append('refresh')


class CommandsLoopTests(unittest.TestCase):
    def test_a_never_settling_canvas_returns_the_did_not_settle_error_within_the_deadline(self):
        h = toolbox.Harness(); h.doc = StuckDoc()
        h._creative_session.update(document_id=native.module.document_id(h.doc))
        h.cmd_new_layer({}); original = h.doc.active
        helper = native.module.canvas_settle
        previous, helper.SETTLE_SECONDS = helper.SETTLE_SECONDS, 0.05
        started = time.monotonic()
        try:
            result = toolbox.call(h, [('curve_stroke', {})], original.identity)
        finally:
            helper.SETTLE_SECONDS = previous
        self.assertLess(time.monotonic() - started, 5)
        self.assertIn(NOT_SETTLED, result['error'])
        self.assertEqual(result['error_code'], 'canvas_not_settled')
        self.assertNotIn('wait', h.doc.events)
        self.assertNotIn('refresh', h.doc.events)


if __name__ == '__main__':
    unittest.main()
