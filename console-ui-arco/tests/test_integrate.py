# Copyright 1999-2026 Alibaba Group Holding Ltd.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('integrate', Path(__file__).resolve().parents[1] / 'scripts/integrate.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IntegratedPackagingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.ui = self.root / 'ui'
        self.ui.mkdir()
        (self.ui / 'index.html').write_text('<html><head></head><body>Arco</body></html>')
        (self.ui / 'runtime-config.js').write_text('standalone-settings')
        (self.ui / 'NOTICE').write_text('Nacos redistribution notice')
        (self.ui / 'THIRD_PARTY_NOTICES.md').write_text('Third-party notices')
        (self.ui / 'assets').mkdir()
        (self.ui / 'assets/editor.worker.js').write_text('worker-content')
        self.server = self.root / 'original.jar'
        self.output = self.root / 'integrated.jar'

    def server_fixture(self, signed=False):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as console:
            console.writestr('com/example/Keep.class', b'unchanged-class-bytes')
            console.writestr('static/legacy/index.html', 'legacy-ui')
            console.writestr('static/legacy/js/main.js', 'legacy-javascript')
            console.writestr('static/legacy/css/main.css', 'legacy-styles')
            console.writestr('META-INF/NOTICE', 'Retained dependency notice')
            console.writestr('static/custom/logo.svg', 'custom-logo')
            console.writestr('static/next/old.js', 'obsolete-next-build')
            if signed:
                console.writestr('META-INF/SIGNATURE.SF', 'signature')
        with zipfile.ZipFile(self.server, 'w') as boot:
            boot.writestr('BOOT-INF/lib/nacos-console-3.3.0.jar', nested.getvalue(), compress_type=zipfile.ZIP_STORED)
            boot.writestr('BOOT-INF/classes/Keep.class', b'bootstrap-class-bytes')

    def test_removes_legacy_while_preserving_backend_and_legal_notices(self):
        self.server_fixture()
        original = self.server.read_bytes()
        favicon = self.root / 'favicon.svg'
        favicon.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
        result = module.integrate(self.server, self.ui, self.output, '/management/', '测试平台', favicon)
        self.assertEqual(result['api_base'], '/management/')
        self.assertEqual(self.server.read_bytes(), original)
        with zipfile.ZipFile(self.output) as boot:
            self.assertEqual(boot.read('BOOT-INF/classes/Keep.class'), b'bootstrap-class-bytes')
            self.assertEqual(boot.read('BOOT-INF/classes/static/branding/favicon.svg'), favicon.read_bytes())
            self.assertEqual(boot.getinfo('BOOT-INF/lib/nacos-console-3.3.0.jar').compress_type, zipfile.ZIP_STORED)
            with zipfile.ZipFile(io.BytesIO(boot.read('BOOT-INF/lib/nacos-console-3.3.0.jar'))) as console:
                self.assertEqual(console.read('com/example/Keep.class'), b'unchanged-class-bytes')
                self.assertFalse(any(name.startswith('static/legacy/') for name in console.namelist()))
                self.assertEqual(console.read('META-INF/NOTICE'), b'Retained dependency notice')
                self.assertEqual(console.read('static/custom/logo.svg'), b'custom-logo')
                self.assertEqual(console.read('static/next/NOTICE'), b'Nacos redistribution notice')
                self.assertEqual(console.read('static/next/THIRD_PARTY_NOTICES.md'), b'Third-party notices')
                self.assertEqual(console.read('static/next/assets/editor.worker.js'), b'worker-content')
                self.assertNotIn('static/next/old.js', console.namelist())
                runtime = console.read('static/next/runtime-config.js').decode()
                self.assertIn('"enableDemo": false', runtime)
                self.assertIn('"enableAi": false', runtime)
                self.assertIn('"enableCopilot": false', runtime)
                self.assertIn('"apiBase": "/management/"', runtime)
                self.assertIn('"storagePrefix": "platform.console"', runtime)
                self.assertNotIn('legacyStoragePrefix', runtime)
                self.assertIn('测试平台', runtime)

    def test_packages_only_explicit_storage_migration_settings(self):
        self.server_fixture()
        module.integrate(self.server, self.ui, self.output, storage_prefix='custom.console',
                         legacy_storage_prefix='previous.console', enable_ai=True, enable_copilot=True)
        with zipfile.ZipFile(self.output) as boot:
            with zipfile.ZipFile(io.BytesIO(boot.read('BOOT-INF/lib/nacos-console-3.3.0.jar'))) as console:
                runtime = console.read('static/next/runtime-config.js').decode()
                self.assertIn('"storagePrefix": "custom.console"', runtime)
                self.assertIn('"legacyStoragePrefix": "previous.console"', runtime)
                self.assertIn('"enableAi": true', runtime)
                self.assertIn('"enableCopilot": true', runtime)

    def test_refuses_to_overwrite_input_or_existing_output(self):
        self.server_fixture()
        with self.assertRaises(FileExistsError):
            module.integrate(self.server, self.ui, self.server)
        self.output.write_bytes(b'keep-existing-output')
        with self.assertRaises(FileExistsError):
            module.integrate(self.server, self.ui, self.output)
        self.assertEqual(self.output.read_bytes(), b'keep-existing-output')

    def test_rejects_signed_console_without_creating_output(self):
        self.server_fixture(signed=True)
        with self.assertRaisesRegex(ValueError, 'Signed'):
            module.integrate(self.server, self.ui, self.output)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
