#!/usr/bin/env python3
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
"""Package Arco assets into an existing Nacos server JAR; never change a running installation."""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import zipfile


def integrate(server_jar, ui_dist, output, context_path='/control', name='服务管理平台', favicon=None,
              storage_prefix='platform.console', legacy_storage_prefix=None, enable_ai=False,
              enable_copilot=False):
    server_jar, ui_dist, output = Path(server_jar).resolve(), Path(ui_dist).resolve(), Path(output).resolve()
    if output == server_jar or output.exists():
        raise FileExistsError('Choose a new output path; input and existing files are preserved')
    if not (ui_dist / 'index.html').is_file():
        raise ValueError('Build the Arco frontend before packaging')
    context_path = '/' + context_path.strip('/') if context_path.strip('/') else ''
    assets = {}
    for path in sorted(ui_dist.rglob('*')):
        if path.is_symlink():
            raise ValueError('UI assets must be regular files')
        if path.is_file():
            assets['static/next/' + path.relative_to(ui_dist).as_posix()] = path.read_bytes()
    runtime = {
        'name': name, 'apiBase': context_path + '/', 'enableDemo': False,
        'enableAi': enable_ai is True, 'enableCopilot': enable_copilot is True,
        'storagePrefix': storage_prefix,
    }
    if legacy_storage_prefix:
        runtime['legacyStoragePrefix'] = legacy_storage_prefix
    assets['static/next/runtime-config.js'] = ('window.CONSOLE_CONFIG = '
        + json.dumps(runtime, ensure_ascii=False) + ';\n').encode('utf-8')
    extra = {}
    if favicon is not None:
        extra['BOOT-INF/classes/static/branding/favicon.svg'] = Path(favicon).read_bytes()
        html = assets['static/next/index.html'].decode('utf-8')
        assets['static/next/index.html'] = html.replace('</head>',
            '<link rel="icon" type="image/svg+xml" href="../branding/favicon.svg" /></head>').encode('utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(server_jar) as source:
        candidates = [n for n in source.namelist() if n.startswith('BOOT-INF/lib/nacos-console-') and n.endswith('.jar')]
        if len(candidates) != 1:
            raise ValueError('Expected one Nacos Console module in a Spring Boot server JAR')
        console_name = candidates[0]
        if source.getinfo(console_name).compress_type != zipfile.ZIP_STORED:
            raise ValueError('Nested Boot library entries must be stored without outer compression')
        nested = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(source.read(console_name))) as console:
            if any(n.upper().endswith(('.RSA', '.DSA', '.SF')) for n in console.namelist()):
                raise ValueError('Signed Console modules require their original signing process')
            with zipfile.ZipFile(nested, 'w') as target:
                for info in console.infolist():
                    if not info.filename.startswith('static/next/'):
                        target.writestr(copy.copy(info), console.read(info.filename))
                for key, value in assets.items():
                    target.writestr(key, value, compress_type=zipfile.ZIP_DEFLATED)
            with zipfile.ZipFile(io.BytesIO(nested.getvalue())) as checked:
                if checked.testzip() is not None:
                    raise ValueError('Invalid rebuilt Console module')
                for info in console.infolist():
                    if not info.filename.startswith('static/next/'):
                        assert checked.read(info.filename) == console.read(info.filename)
        with tempfile.TemporaryDirectory(prefix='arco-integrated-', dir=output.parent) as work:
            temporary = Path(work) / 'nacos-server.jar'
            with zipfile.ZipFile(temporary, 'w') as target:
                for info in source.infolist():
                    if info.filename in extra:
                        continue
                    value = nested.getvalue() if info.filename == console_name else source.read(info.filename)
                    target.writestr(copy.copy(info), value)
                for key, value in extra.items():
                    target.writestr(key, value)
            with zipfile.ZipFile(temporary) as checked:
                if checked.testzip() is not None:
                    raise ValueError('Invalid integrated server JAR')
                assert checked.getinfo(console_name).compress_type == zipfile.ZIP_STORED
                for info in source.infolist():
                    if info.filename != console_name and info.filename not in extra:
                        assert checked.getinfo(info.filename).CRC == info.CRC
            if output.exists():
                raise FileExistsError('Output appeared while packaging; choose a new path')
            temporary.replace(output)
    return {'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'api_base': context_path + '/', 'demo_enabled': False, 'ui_assets': len(assets)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server-jar', required=True, type=Path)
    parser.add_argument('--ui-dist', type=Path, default=Path(__file__).resolve().parents[1] / 'dist')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--context-path', default='/control')
    parser.add_argument('--name', default='服务管理平台')
    parser.add_argument('--storage-prefix', default='platform.console')
    parser.add_argument('--legacy-storage-prefix', help='Temporary browser-storage prefix to migrate on upgrade')
    parser.add_argument('--enable-ai', action='store_true', help='Show AI pages; the backend must enable AI separately')
    parser.add_argument('--enable-copilot', action='store_true', help='Show Copilot settings for administrators')
    parser.add_argument('--favicon', type=Path, default=Path(__file__).resolve().parents[1] / 'assets/console-favicon.svg')
    args = parser.parse_args()
    print(json.dumps(integrate(args.server_jar, args.ui_dist, args.output, args.context_path, args.name,
                               args.favicon, args.storage_prefix, args.legacy_storage_prefix,
                               args.enable_ai, args.enable_copilot), ensure_ascii=False))
