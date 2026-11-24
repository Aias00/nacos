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
"""Prepare a credential-free standard or Dameng container context from a built release."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile


def prepare(server_jar, release_dir, output, variant, dm_plugin=None, dm_driver=None):
    if output.exists():
        raise FileExistsError('Choose a new build context directory')
    if not server_jar.is_file() or not (release_dir / 'conf/application.properties').is_file():
        raise ValueError('Build the Nacos release and integrate Arco before preparing images')
    if variant == 'dameng' and (not dm_plugin or not dm_driver or not dm_plugin.is_file() or not dm_driver.is_file()):
        raise ValueError('Dameng image requires the built dm plugin and JDBC driver')
    template = Path(__file__).resolve().parent
    home = output / 'release'
    for folder in ['conf', 'plugins', 'target', 'bin', 'data', 'logs']:
        (home / folder).mkdir(parents=True)
    shutil.copy2(server_jar, home / 'target/nacos-server.jar')
    shutil.copytree(release_dir / 'conf', home / 'conf', dirs_exist_ok=True)
    for source in (release_dir / 'plugins').glob('*.jar'):
        if source.name.startswith('nacos-datasource-plugin-dm-') or source.name.lower().startswith('dmjdbc'):
            continue
        shutil.copy2(source, home / 'plugins' / source.name)
    for name in ['LICENSE', 'NOTICE']:
        source = release_dir / name
        if not source.is_file():
            raise ValueError('Release must preserve ' + name)
        shutil.copy2(source, home / name)
    with (home / 'conf/application.properties').open('a') as target:
        target.write('\n# Container overrides\n' + (template / 'container.properties').read_text())
        if variant == 'dameng':
            target.write('\nspring.config.import=file:/opt/nacos/conf/dameng.properties\n')
    if variant == 'dameng':
        shutil.copy2(dm_plugin, home / 'plugins' / dm_plugin.name)
        shutil.copy2(dm_driver, home / 'plugins' / dm_driver.name)
        shutil.copy2(template / 'dameng.properties', home / 'conf/dameng.properties')
        with zipfile.ZipFile(dm_plugin) as jar:
            (home / 'conf/dameng-schema.sql').write_bytes(jar.read('META-INF/dameng-schema.sql'))
    else:
        for name in ['dameng.properties', 'dameng-schema.sql']:
            (home / 'conf' / name).unlink(missing_ok=True)
    for name in ['Dockerfile', 'entrypoint.sh']:
        shutil.copy2(template / name, output / name)
    files = {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in output.rglob('*') if p.is_file()}
    (output / 'artifact-manifest.json').write_text(json.dumps(dict(variant=variant, files=files), indent=2))
    return dict(variant=variant, server_sha256=files['release/target/nacos-server.jar'], files=len(files))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server-jar', type=Path, required=True)
    parser.add_argument('--release-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--variant', choices=['standard', 'dameng'], required=True)
    parser.add_argument('--dm-plugin', type=Path)
    parser.add_argument('--dm-driver', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.server_jar, args.release_dir, args.output, args.variant, args.dm_plugin, args.dm_driver)))
