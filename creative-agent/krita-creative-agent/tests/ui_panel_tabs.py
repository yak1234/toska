"""Run: uv run -q --with pyqt5 python tests/ui_panel_tabs.py (and --with pyqt6). A UI script like ui_panel_layout: it stubs krita
for the whole process. Layers and Brushes as tabs in the agent panel (openspec panel-layers-brushes; the artist, 2026-11-05: "how
feasible would it be if we had those inside our agent panel but separate tab"). The docks here are real QDockWidgets in a real
QMainWindow holding plain widgets, standing in for Krita's: that they survive with Krita's own panels inside is the live check of
task 1, not this script's. No dialog opens and no profile is touched (Qt's test mode for standard paths)."""
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['KRITA_CREATIVE_NO_AUTOSTART'] = '1'

PLUGIN = Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
package = types.ModuleType('panel_tabs_test'); package.__path__ = [str(PLUGIN)]; sys.modules['panel_tabs_test'] = package
from panel_tabs_test.qt_compat import QApplication, QDockWidget, QLabel, QMainWindow, QPoint, QPushButton, QStandardPaths, Qt, QVBoxLayout, QWidget
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
spec = importlib.util.spec_from_file_location('panel_tabs_test.creative_docker', PLUGIN / 'creative_docker.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
app = QApplication.instance() or QApplication([])
QProcess = module.QProcess
RIGHT = Qt.DockWidgetArea.RightDockWidgetArea
SIZES = [(320, 500), (360, 687), (420, 1000)]


def settle():
    for _ in range(6): app.processEvents()


def krita_dock(name):
    """A dock like Krita's: one content widget with a button inside, whose click must keep working wherever it lives."""
    dock = QDockWidget(name); dock.setObjectName(name)
    content = QWidget(); column = QVBoxLayout(content); column.addWidget(QLabel(name))
    dock.button = QPushButton('Add layer'); dock.clicks = []
    dock.button.clicked.connect(lambda: dock.clicks.append(1)); column.addWidget(dock.button)
    dock.setWidget(content); dock.content = content
    return dock


class Tabs(unittest.TestCase):
    def setUp(self):
        self.window = QMainWindow(); self.window.resize(1200, 800); self.window.setCentralWidget(QLabel('canvas'))
        self.addCleanup(self.window.deleteLater)
        self.panel = module.CreativeAgentDocker()
        self.panel.process = types.SimpleNamespace(state=lambda: QProcess.ProcessState.Running)
        self.panel.send = lambda command: None
        self.window.addDockWidget(RIGHT, self.panel)
        self.layers = krita_dock('KisLayerBox'); self.brushes = krita_dock('PresetDocker')
        self.window.addDockWidget(RIGHT, self.layers); self.window.addDockWidget(RIGHT, self.brushes)
        self.window.show(); self.panel.attach_dock_tabs(); settle()

    def open_tab(self, page):
        self.panel.tabs.setCurrentIndex(self.panel.tabs.indexOf(page)); settle()

    def inside(self, widget):
        top_left = widget.mapTo(self.panel, QPoint(0, 0))
        return (widget.isVisible() and top_left.x() >= 0 and top_left.y() >= 0 and top_left.x() + widget.width() <= self.panel.width()
                and top_left.y() + widget.height() <= self.panel.height())

    # ----- an open dock is never moved by an update -------------------------------------------------------------------------
    def test_an_open_dock_stays_and_the_tab_offers_to_move_it(self):
        page = self.panel.layers_page; self.open_tab(page)
        self.assertIs(self.layers.widget(), self.layers.content, 'the artist\'s layout is not touched')
        self.assertTrue(self.layers.isVisible()); self.assertTrue(page.notice.isVisible())
        self.assertEqual(page.notice_text.text(), 'Layers is open as its own panel.')
        self.assertEqual(page.move_button.text(), 'Move it here')

    def test_move_it_here_hides_the_dock_and_shows_the_real_widget(self):
        page = self.panel.layers_page; self.open_tab(page)
        page.move_button.click(); settle()
        self.assertFalse(self.layers.isVisible()); self.assertFalse(page.notice.isVisible())
        self.assertIs(self.layers.content.parentWidget(), page.holder, 'the same widget, not a copy')
        self.assertTrue(self.layers.button.isVisible())
        self.layers.button.click(); self.assertEqual(self.layers.clicks, [1], 'it still works')

    def test_showing_the_dock_from_the_window_menu_sends_it_back(self):
        page = self.panel.layers_page; self.open_tab(page); page.move_button.click(); settle()
        self.layers.toggleViewAction().trigger(); settle()
        self.assertTrue(self.layers.isVisible()); self.assertIs(self.layers.widget(), self.layers.content)
        self.assertTrue(self.layers.button.isVisible()); self.assertTrue(page.notice.isVisible())
        self.layers.button.click(); self.assertEqual(self.layers.clicks, [1])

    def test_a_dock_hidden_before_the_panel_starts_opens_in_the_tab(self):
        window = QMainWindow(); self.addCleanup(window.deleteLater)
        panel = module.CreativeAgentDocker(); window.addDockWidget(RIGHT, panel)
        layers = krita_dock('KisLayerBox'); window.addDockWidget(RIGHT, layers); layers.hide()
        window.show(); panel.attach_dock_tabs(); settle()
        self.assertIs(layers.content.parentWidget(), panel.layers_page.holder)
        self.assertFalse(panel.layers_page.notice.isVisibleTo(panel.layers_page))
        self.assertFalse(panel.tabs.isTabVisible(panel.tabs.indexOf(panel.brushes_page)), 'no Brushes dock in this window: no tab')
        panel.return_dock_widgets()

    def test_a_dock_tabbed_behind_another_still_counts_as_open(self):
        self.window.tabifyDockWidget(self.layers, self.brushes); self.brushes.raise_(); settle()
        self.panel.layers_page.follow(); settle()
        self.assertTrue(self.layers.toggleViewAction().isChecked())
        self.assertIs(self.layers.widget(), self.layers.content, 'it is in the artist\'s layout: not taken')

    def test_a_workspace_switch_is_followed(self):
        page = self.panel.layers_page; self.open_tab(page); page.move_button.click(); settle()
        state = self.window.saveState()
        self.layers.show(); settle(); self.assertIs(self.layers.widget(), self.layers.content)
        self.window.restoreState(state); settle()
        self.assertIs(self.layers.content.parentWidget(), page.holder)
        self.assertTrue(self.layers.isHidden())

    def test_closing_the_window_gives_every_widget_back(self):
        page = self.panel.layers_page; self.open_tab(page); page.move_button.click(); settle()
        self.window.close(); settle()
        self.assertIs(self.layers.widget(), self.layers.content, 'its own dock owns it again before anything is torn down')

    # ----- the tabs ----------------------------------------------------------------------------------------------------------
    def test_five_tabs_in_order_when_a_plan_and_folder_exist(self):
        self.panel.show_tab(self.panel.plan_tab, True); self.panel.show_tab(self.panel.folder_tab, True); settle()
        bar = self.panel.tabs.tabBar()
        self.assertEqual([bar.tabText(i) for i in range(bar.count())], ['Chat', 'Plan', 'Folder', 'Layers', 'Brushes'])
        self.assertTrue(bar.isVisible())

    def test_the_header_belongs_to_the_chat(self):
        self.assertTrue(self.panel.end_button.isVisible())
        self.open_tab(self.panel.layers_page)
        self.assertFalse(self.panel.end_button.isVisible()); self.assertFalse(self.panel.composer.isVisible())

    def test_no_docks_no_tabs(self):
        panel = module.CreativeAgentDocker(); self.addCleanup(panel.deleteLater); panel.show(); panel.attach_dock_tabs(); settle()
        self.assertFalse(panel.tabs.isTabVisible(panel.tabs.indexOf(panel.layers_page)))
        self.assertFalse(panel.tabs.tabBar().isVisible(), 'Chat alone')

    def test_the_largest_text_keeps_every_control_in_the_panel(self):
        self.panel.show_tab(self.panel.plan_tab, True); self.panel.show_tab(self.panel.folder_tab, True)
        self.panel.text_size.setValue(20); self.panel.setFixedSize(320, 500); settle()
        self.open_tab(self.panel.brushes_page)
        self.assertTrue(self.inside(self.panel.auto_toggle)); self.assertLessEqual(self.panel.body_scroll.widget().width(), 320)
        self.assertEqual(self.panel.tabs.tabBar().elideMode(), Qt.TextElideMode.ElideNone)

    def test_every_size_keeps_the_tabs_whole_and_the_status_in_view(self):
        self.panel.show_tab(self.panel.plan_tab, True); self.panel.show_tab(self.panel.folder_tab, True)
        self.window.resize(1600, 1100); self.panel.setFixedSize(320, 500); settle()
        bar = self.panel.tabs.tabBar()
        for width, height in SIZES:
            self.panel.setFixedSize(width, height); settle()
            for page in (self.panel.layers_page, self.panel.brushes_page):
                self.open_tab(page)
                self.assertTrue(self.inside(self.panel.status), '%dx%d' % (width, height)); self.assertTrue(self.inside(self.panel.auto_toggle))
                self.assertTrue(self.inside(page.move_button))
                self.assertLessEqual(bar.tabRect(bar.count() - 1).right(), bar.width(), 'all five fit: %d' % width)

    def test_the_waiting_line_is_on_both_tabs_and_show_returns_to_the_chat(self):
        buttons = self.panel.choice_card('Canvas reference', 'Use this?', [('Use this', 'use')], lambda value: None)
        self.panel.canvas_reference_controls = buttons; self.panel.update_controls(); settle()
        for page in (self.panel.layers_page, self.panel.brushes_page):
            self.open_tab(page); self.assertTrue(self.inside(self.panel.waiting_line))
        self.panel.waiting_show.click(); settle()
        self.assertEqual(self.panel.tabs.currentIndex(), self.panel.chat_tab)


if __name__ == '__main__':
    unittest.main()
