"""Run: uv run -q --with pyqt5 python tests/ui_panel_connect_model.py (and --with pyqt6). Connect a model (the artist,
2026-11-01: "You shouldn't hardcode shit like that. It should be based on the model"): the providers are the ones Pi
knows, a provider Pi knows takes only its key, and a custom endpoint sends its address, an optional name and model id.
No endpoint, model id or limit is preset. No dialog is shown and no profile is touched."""
import os
from pathlib import Path
import sys
import types
import unittest
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ['KRITA_CREATIVE_NO_AUTOSTART'] = '1'
import importlib.util

PLUGIN = Path(__file__).resolve().parents[2] / 'krita-mcp/krita-plugin/kritamcp'
package = types.ModuleType('panel_connect_test'); package.__path__ = [str(PLUGIN)]; sys.modules['panel_connect_test'] = package
from panel_connect_test.qt_compat import QApplication, QDockWidget, QStandardPaths
QStandardPaths.setTestModeEnabled(True)

stub = types.ModuleType('krita'); stub.DockWidget = QDockWidget
stub.DockWidgetFactory = object; stub.DockWidgetFactoryBase = types.SimpleNamespace(DockRight=2)
stub.Krita = types.SimpleNamespace(instance=lambda: types.SimpleNamespace(activeDocument=lambda: None, documents=lambda: [], addDockWidgetFactory=lambda f: None))
stub.Selection = object
sys.modules['krita'] = stub
spec = importlib.util.spec_from_file_location('panel_connect_test.creative_docker', PLUGIN / 'creative_docker.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
app = QApplication.instance() or QApplication([])

PROVIDERS = [{'id': 'deepseek', 'configured': True}, {'id': 'anthropic', 'configured': False}, {'id': 'openrouter', 'configured': True}]


def visible(dialog, field):
    label = dialog.form.labelForField(field)
    return not field.isHidden() and (label is None or not label.isHidden())


class ConnectModel(unittest.TestCase):
    def test_the_providers_are_pis_and_custom_comes_last(self):
        dialog = module.ProviderDialog(None, PROVIDERS, 'anthropic')
        labels = [dialog.provider.itemText(i) for i in range(dialog.provider.count())]
        self.assertEqual(labels, ['Anthropic', 'DeepSeek · connected', 'OpenRouter · connected', 'Custom endpoint…'])
        self.assertEqual(dialog.provider.currentData(), 'anthropic')
        for field in (dialog.endpoint, dialog.model, dialog.name):
            self.assertEqual(field.text(), '', 'nothing is preset')
            self.assertFalse(visible(dialog, field), 'a known provider asks only for its key')
        self.assertTrue(visible(dialog, dialog.key))
        self.assertIn("Pi's catalog", dialog.note.text())
        self.assertNotIn('memory', dialog.note.text())

    def test_a_known_provider_sends_only_its_key(self):
        dialog = module.ProviderDialog(None, PROVIDERS, 'anthropic')
        dialog.accept()
        self.assertEqual(dialog.result(), 0, 'no key: not accepted')
        self.assertIn('API key', dialog.buttons.button(module.QDialogButtonBox.StandardButton.Ok).text())
        dialog.key.setText('  test-only-key ')
        dialog.accept()
        self.assertEqual(dialog.result(), 1)
        self.assertEqual(dialog.command(), {'type': 'configure_provider', 'provider': 'anthropic', 'api_key': 'test-only-key'})

    def test_a_custom_endpoint_sends_its_address_and_may_skip_the_key(self):
        dialog = module.ProviderDialog(None, PROVIDERS, None)
        dialog.provider.setCurrentIndex(dialog.provider.findData(module.ProviderDialog.CUSTOM))
        for field in (dialog.endpoint, dialog.model, dialog.name, dialog.key):
            self.assertTrue(visible(dialog, field))
        dialog.accept()
        self.assertEqual(dialog.result(), 0, 'no endpoint: not accepted')
        dialog.endpoint.setText('http://localhost:1234/v1'); dialog.name.setText('LM Studio')
        dialog.accept()
        self.assertEqual(dialog.result(), 1)
        self.assertEqual(dialog.command(), {'type': 'configure_provider', 'base_url': 'http://localhost:1234/v1', 'name': 'LM Studio',
                                            'model': '', 'api_key': ''})

    def test_no_preset_endpoints_or_models_remain_in_the_panel(self):
        source = (PLUGIN / 'creative_docker.py').read_text()
        dialog = source[source.index('class ProviderDialog'):source.index('class ElidedComboBox')]
        for preset in ('api.deepseek.com', 'openrouter.ai/api', 'deepseek-flash', "'Custom'", 'accepts images and tool calls'):
            self.assertNotIn(preset, dialog)


if __name__ == '__main__':
    unittest.main()
