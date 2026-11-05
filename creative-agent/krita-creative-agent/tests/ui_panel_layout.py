"""Run: uv run -q --with pyqt5 python tests/ui_panel_layout.py (and --with pyqt6). A UI script like ui_panel_auto_approve: it
stubs krita for the whole process. The panel redesign's measures (openspec panel-redesign; the artist, 2026-11-05: "cluttered
looking and full screen due to sizing hides sometimes latest agent action"): the chat comes first, a control takes a row only
while it is in use, nothing is cut off, and the look comes from one small set of values. No dialog opens and no profile is
touched (Qt's test mode for standard paths)."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['KRITA_CREATIVE_NO_AUTOSTART'] = '1'

PLUGIN = Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
package = types.ModuleType('panel_layout_test'); package.__path__ = [str(PLUGIN)]; sys.modules['panel_layout_test'] = package
from panel_layout_test.qt_compat import QAbstractButton, QApplication, QColor, QDockWidget, QImage, QPoint, QStandardPaths, Qt
from panel_layout_test import panel_theme
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
spec = importlib.util.spec_from_file_location('panel_layout_test.creative_docker', PLUGIN / 'creative_docker.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
app = QApplication.instance() or QApplication([])
QProcess = module.QProcess

SIZES = [(320, 500), (360, 687), (420, 1000)]     # 320: the dock's own minimum width
GLYPHS = re.compile('[＋↻×■↑↓⌗🛡☕◌✦▧✕◷↗›⌄▾▸]')
LONG = 'Painting stroke 36 of 256 on the right-side ships and their reflections, then the water, then the soldiers, ' * 4


def settle():
    for _ in range(6): app.processEvents()


class Measures(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.picture = os.path.join(self.folder.name, 'picture.png')
        image = QImage(800, 600, QImage.Format.Format_RGB32); image.fill(QColor('#d4693f')); image.save(self.picture)
        self.sent = []
        self.panel = module.CreativeAgentDocker()
        self.panel.process = types.SimpleNamespace(state=lambda: QProcess.ProcessState.Running)
        self.panel.send = lambda command: self.sent.append(command)
        self.panel.model.addItem('moonshotai/Kimi-K3.1-Pro', {'provider': 'custom', 'id': 'moonshotai/Kimi-K3.1-Pro'})
        self.panel.model.setCurrentIndex(0)
        self.panel.chat_mode = 'agent'; self.panel.update_controls()
        self.panel.show()
        self.addCleanup(self.panel.deleteLater)

    def size(self, width, height):
        self.panel.resize(width, height); settle()

    def fill(self, count=30):
        self.panel.empty_state.hide()
        for index in range(count): self.panel.transcript.add_message('Creative Agent', 'Message %d about the ships.' % index)
        settle()

    def attach_four(self):
        self.panel.pending_references = [{'path': self.picture, 'name': 'r%d.png' % i} for i in range(4)]
        self.panel.show_references(); settle()

    def inside(self, widget):
        top_left = widget.mapTo(self.panel, QPoint(0, 0))
        return (widget.isVisible() and top_left.x() >= 0 and top_left.y() >= 0 and top_left.x() + widget.width() <= self.panel.width()
                and top_left.y() + widget.height() <= self.panel.height())

    def card(self):
        buttons = self.panel.choice_card('Canvas reference', 'Should I work from this?', [('Use this', 'use'), ('Discard', 'no')],
                                         lambda value: None, self.picture)
        self.panel.canvas_reference_controls = buttons; self.panel.update_controls(); settle()
        return buttons

    # ----- the chat comes first ------------------------------------------------------------------------------------------
    def test_the_chat_has_most_of_the_panel(self):
        self.attach_four()
        for width, height in SIZES[1:]:
            self.size(width, height)
            share = self.panel.transcript.height() / self.panel.height()
            self.assertGreaterEqual(share, 0.60, '%dx%d: chat %d pt of %d' % (width, height, self.panel.transcript.height(), height))

    def test_idle_controls_take_no_row(self):
        self.attach_four(); self.size(360, 687)
        self.assertFalse(self.panel.attachments.isVisible(), 'four attachments are one chip until opened')
        self.assertTrue(self.panel.attach_chip.isVisible()); self.assertEqual(self.panel.attach_chip.accessibleName(), '4 attached')
        self.assertFalse(self.panel.features_section.isVisible(), 'no features: no Protected row')
        self.assertFalse(self.panel.context_hint.isVisible(), 'the hint is a tooltip, until there is an error')
        self.assertIn(self.panel.context_hint.text(), self.panel.canvas_button.toolTip())
        self.assertFalse(self.panel.paint_only.button.isVisible()); self.assertFalse(self.panel.paint_only.find_button.isVisible())
        self.assertFalse(self.panel.provider_filter.isVisible()); self.assertFalse(self.panel.model.isVisible())
        self.assertFalse(self.panel.save_status.isVisible()); self.assertFalse(self.panel.folder_button.isVisible())
        self.assertFalse(self.panel.tabs.tabBar().isVisible(), 'Chat alone needs no tab bar')

    def test_chips_open_what_they_hold(self):
        self.attach_four(); self.size(360, 687)
        self.panel.attach_chip.click(); settle()
        self.assertTrue(self.panel.attachments.isVisible())
        self.assertTrue(all(button.isVisible() for button in self.panel.reference_remove_buttons), 'each one can be removed')
        self.panel.attach_chip.click(); settle(); self.assertFalse(self.panel.attachments.isVisible())
        self.panel.model_chip.click(); settle()
        self.assertTrue(self.panel.provider_filter.isVisible()); self.assertTrue(self.panel.model.isVisible())
        self.assertIn('Kimi-K3.1-Pro', self.panel.model_chip.toolTip())
        self.panel.model.modelChosen.emit(); settle()
        self.assertFalse(self.panel.model.isVisible(), 'choosing a model closes the row')

    def test_paint_only_and_find_it_are_in_the_plus_menu(self):
        labels = [action.text() for action in self.panel.attach_menu.actions()]
        self.assertIn('Paint only here', labels); self.assertIn('Find it for me', labels)

    def test_a_capture_error_still_shows_as_a_line(self):
        self.size(360, 687)
        self.panel.canvas_context.update({'selected': True, 'state': 'error', 'error': 'Could not capture', 'canvas': {'name': 'a.kra', 'document_id': 'd'}})
        self.panel.render_context(); settle()
        self.assertTrue(self.panel.context_hint.isVisible()); self.assertEqual(self.panel.context_hint.text(), 'Could not capture')

    def test_the_footer_is_in_the_more_menu(self):
        self.panel.more_menu.aboutToShow.emit()
        labels = [action.text() for action in self.panel.more_menu.actions()]
        self.assertIn('Settings…', labels); self.assertIn(self.panel.folder_button.text(), labels)
        self.assertIn(self.panel.save_status.text(), labels)

    # ----- nothing is cut off -------------------------------------------------------------------------------------------
    def test_send_and_the_mode_stay_inside_the_panel(self):
        self.attach_four()
        for width, height in SIZES:
            self.size(width, height)
            for control in (self.panel.send_button, self.panel.mode_selector, self.panel.prompt, self.panel.model_chip, self.panel.reference_button):
                self.assertTrue(self.inside(control), '%dx%d: %s' % (width, height, control.accessibleName()))

    def test_every_row_stays_in_the_panel_at_the_largest_text(self):
        self.panel.text_size.setValue(20); self.attach_four(); self.size(320, 500)
        self.panel.busy = True; self.panel.update_controls(); settle()
        for control in (self.panel.send_button, self.panel.stop_button, self.panel.mode_selector, self.panel.attach_chip):
            self.assertTrue(self.inside(control), control.accessibleName())

    def test_a_short_panel_scrolls_as_a_whole(self):
        self.attach_four(); self.panel.attach_chip.click(); self.panel.model_chip.click()
        self.panel.setMinimumHeight(0); self.size(320, 300)
        area = self.panel.body_scroll
        self.assertGreater(area.verticalScrollBar().maximum(), 0, 'what does not fit can be scrolled to')
        area.ensureWidgetVisible(self.panel.send_button); settle()
        visible = self.panel.send_button.visibleRegion().boundingRect()
        self.assertEqual(visible.height(), self.panel.send_button.height(), 'Send can be reached')

    # ----- the status line ------------------------------------------------------------------------------------------------
    def test_a_long_status_moves_nothing(self):
        self.size(360, 687)
        self.panel.status.setText('Ready'); settle()
        before = self.panel.status.height(), self.panel.transcript.height(), self.panel.composer.height()
        self.panel.status.setText(LONG); settle()
        self.assertEqual((self.panel.status.height(), self.panel.transcript.height(), self.panel.composer.height()), before)
        self.assertEqual(self.panel.status.text(), LONG, 'the words are kept'); self.assertEqual(self.panel.status.toolTip(), LONG)

    def test_auto_approve_and_the_status_are_on_every_tab(self):
        self.size(360, 687)
        self.panel.show_tab(self.panel.plan_tab, True)
        self.panel.tabs.setCurrentIndex(self.panel.plan_tab); settle()
        self.assertTrue(self.inside(self.panel.auto_toggle)); self.assertTrue(self.inside(self.panel.status))
        self.assertFalse(self.panel.composer.isVisible(), 'the message box belongs to the chat')
        self.assertTrue(self.panel.tabs.tabBar().isVisible())
        self.panel.tabs.setCurrentIndex(self.panel.chat_tab); settle()
        self.assertTrue(self.panel.composer.isVisible())

    def test_tab_names_are_never_shortened(self):
        self.assertEqual(self.panel.tabs.tabBar().elideMode(), Qt.TextElideMode.ElideNone)

    # ----- following the chat -------------------------------------------------------------------------------------------
    def scroll_up(self):
        bar = self.panel.transcript.verticalScrollBar(); bar.setValue(0); self.panel.transcript.track_scroll(); settle()
        self.assertFalse(self.panel.transcript.follow)

    def test_sending_jumps_to_the_newest_message(self):
        self.size(360, 687); self.fill(); self.scroll_up()
        self.panel.prompt.setPlainText('Now the water.'); self.panel.submit(); settle()
        bar = self.panel.transcript.verticalScrollBar()
        self.assertTrue(self.panel.transcript.follow); self.assertEqual(bar.value(), bar.maximum())

    def test_history_stays_held_and_latest_counts(self):
        self.size(360, 687); self.fill(); self.scroll_up()
        transcript_height = self.panel.transcript.height()
        self.assertTrue(self.panel.jump_button.isVisible()); self.assertEqual(self.panel.transcript.height(), transcript_height, 'it takes no row')
        self.assertIs(self.panel.jump_button.parent(), self.panel.transcript)
        self.panel.transcript.add_message('Creative Agent', 'Hull done.'); self.panel.transcript.add_message('Creative Agent', 'Sails done.'); settle()
        self.assertEqual(self.panel.transcript.verticalScrollBar().value(), 0, 'reading history is not interrupted')
        self.assertIn('2 new', self.panel.jump_button.text())
        self.panel.jump_button.click(); settle()
        self.assertTrue(self.panel.jump_button.isHidden()); self.assertEqual(self.panel.transcript.unread, 0)

    def test_a_waiting_card_is_on_screen_at_every_scroll_position(self):
        self.size(360, 687); self.fill()
        self.assertFalse(self.panel.waiting_line.isVisible())
        buttons = self.card(); self.assertTrue(self.inside(self.panel.waiting_line))
        self.assertIn('canvas reference', self.panel.waiting_text.text())
        self.scroll_up(); self.assertTrue(self.inside(self.panel.waiting_line))
        self.panel.waiting_show.click(); settle()
        self.assertFalse(buttons[0].visibleRegion().isEmpty(), 'Show brings the card into view')
        buttons[0].setEnabled(False); buttons[1].setEnabled(False); self.panel.update_controls(); settle()
        self.assertFalse(self.panel.waiting_line.isVisible(), 'answered: the line goes')

    def test_the_waiting_line_survives_a_new_chat_and_another_tab(self):
        self.size(360, 687); self.card()
        self.panel.show_tab(self.panel.plan_tab, True); self.panel.tabs.setCurrentIndex(self.panel.plan_tab); settle()
        self.assertTrue(self.inside(self.panel.waiting_line))
        self.panel.waiting_show.click(); settle()
        self.assertEqual(self.panel.tabs.currentIndex(), self.panel.chat_tab)
        self.panel.transcript.clear(); self.panel.canvas_reference_controls = []; self.panel.update_controls(); settle()
        self.assertFalse(self.panel.waiting_line.isVisible())

    # ----- cards -----------------------------------------------------------------------------------------------------------
    def test_a_card_fits_with_its_buttons_reachable(self):
        for width, height in SIZES:
            self.size(width, height)
            buttons = self.card(); settle()
            viewport = self.panel.transcript.viewport()
            picture = self.panel.transcript.pictures[-1]['label']
            self.assertLessEqual(picture.pixmap().width(), viewport.width(), 'the picture fits the chat')
            self.assertLess(picture.pixmap().height() + buttons[0].height() * 2, viewport.height(), 'its buttons fit beside it')

    def test_a_caption_never_cuts_a_word(self):
        sentence = 'why is it still generating images like this i wanted a finished ai reference and it keeps making patches'
        self.assertEqual(module.short_title(sentence, 200), sentence)
        short = module.short_title(sentence, 50)
        self.assertTrue(short.endswith('…')); self.assertLessEqual(len(short), 51)
        self.assertTrue(sentence.startswith(short[:-1] + ' '), 'it ends between words: ' + short)
        self.assertEqual(module.short_title('x' * 80, 50), 'x' * 50 + '…')

    # ----- the look -------------------------------------------------------------------------------------------------------
    def test_sizes_and_corners_come_from_the_one_set(self):
        sizes = {int(v) for v in re.findall(r'font-size: *(\d+)px', self.panel.styleSheet())}
        self.assertLessEqual(sizes, set(panel_theme.TEXT_SIZES.values()), 'font sizes')
        corners = {int(v) for v in re.findall(r'border-radius: *(\d+)px', self.panel.styleSheet())}
        self.assertLessEqual(corners, set(panel_theme.CORNERS.values()), 'corners')

    def test_no_text_character_is_an_icon(self):
        self.attach_four(); self.fill(2); self.card()
        self.panel.transcript.add_message('Step', 'Details\nmore', True)
        self.panel.canvas_context.update({'selected': True, 'canvas': {'name': 'a.kra', 'document_id': 'd'}}); self.panel.render_context()
        for button in self.panel.findChildren(QAbstractButton):
            self.assertIsNone(GLYPHS.search(button.text()), 'a text icon: %r (%s)' % (button.text(), button.accessibleName()))
            if not button.text().strip() and button.isVisibleTo(self.panel):      # a hidden chip gets its words when it shows
                self.assertFalse(button.icon().isNull(), 'no icon: %s' % (button.accessibleName() or button.objectName()))
                self.assertTrue(button.accessibleName() or button.toolTip() or isinstance(button, module.PictureButton), 'no name: %r' % button)
        self.assertNotIn('☕', self.panel.awake_indicator.text())

    def test_icons_follow_the_theme(self):
        before = self.panel.send_button.icon().cacheKey()
        self.panel.theme_selector.setCurrentIndex(2); settle()
        self.assertNotEqual(self.panel.send_button.icon().cacheKey(), before); self.assertFalse(self.panel.send_button.icon().isNull())


if __name__ == '__main__':
    unittest.main()
