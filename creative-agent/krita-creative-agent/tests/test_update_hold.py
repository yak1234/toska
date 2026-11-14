# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
"""update_hold.py: the application property that makes an app update wait while the agent paints
(openspec app-updates, task 3.2). Plain Python with a stand-in application; nothing is written to disk."""
import importlib.util
import pathlib
import unittest

PLUGIN = pathlib.Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
spec = importlib.util.spec_from_file_location('update_hold_under_test', PLUGIN / 'update_hold.py')
hold = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hold)


class App:
    def __init__(self):
        self.properties = {}

    def setProperty(self, name, value):
        self.properties[name] = value


class UpdateHoldTests(unittest.TestCase):
    def setUp(self):
        hold.BUSY.clear()

    def test_the_property_follows_one_panel(self):
        app, panel = App(), object()
        self.assertTrue(hold.set_busy(panel, True, app))
        self.assertEqual(app.properties, {'toskaAgentBusy': True})
        self.assertFalse(hold.set_busy(panel, False, app))
        self.assertEqual(app.properties, {'toskaAgentBusy': False})

    def test_an_update_waits_until_every_window_is_idle(self):
        app, first, second = App(), object(), object()
        hold.set_busy(first, True, app)
        hold.set_busy(second, True, app)
        self.assertTrue(hold.set_busy(first, False, app))             # the other window's agent still paints
        self.assertIs(app.properties['toskaAgentBusy'], True)
        self.assertFalse(hold.set_busy(second, False, app))
        self.assertFalse(hold.set_busy(second, False, app))           # idle twice is still idle
        self.assertIs(app.properties['toskaAgentBusy'], False)

    def test_no_application_or_a_failing_one_never_breaks_the_panel(self):
        class Broken:
            def setProperty(self, name, value):
                raise RuntimeError('deleted')
        self.assertTrue(hold.set_busy(object(), True, Broken()))
        hold.BUSY.clear()
        self.assertFalse(hold.set_busy(object(), False, None))        # None: asks Qt; there is no application in this test

    def test_the_name_is_the_one_the_app_reads(self):
        source = (PLUGIN.parents[3] / 'libs' / 'ui' / 'KisMainWindow.cpp').read_text()
        self.assertIn('property("%s")' % hold.PROPERTY, source)


if __name__ == '__main__':
    unittest.main()
