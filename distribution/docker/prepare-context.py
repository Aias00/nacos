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
"""Prepare a credential-free unified multi-database container context from a built release."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


def prepare(server_jar, release_dir, output, variant, dm_plugin=None, dm_driver=None):
    if output.exists():
        raise FileExistsError('Choose a new build context directory')
    if not server_jar.is_file() or not (release_dir / 'conf/application.properties').is_file():
        raise ValueError('Build the Nacos release and integrate Arco before preparing images')
    if (not dm_plugin or not dm_driver or not dm_plugin.is_file() or not dm_driver.is_file()):
        raise ValueError('Unified image requires the built dm plugin and JDBC driver')
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
        target.write('\nspring.config.import=file:/opt/nacos/conf/datasource.properties\n')
    shutil.copy2(dm_plugin, home / 'plugins' / dm_plugin.name)
    shutil.copy2(dm_driver, home / 'plugins' / dm_driver.name)
    shutil.copy2(template / 'datasource.properties', home / 'conf/datasource.properties')
    shutil.copy2(template / 'datasource.properties', home / 'bin/datasource.properties.template')
    (home / 'conf/dameng.properties').unlink(missing_ok=True)
    schemas = [('nacos-datasource-plugin-mysql-', 'mysql-schema.sql'),
               ('nacos-datasource-plugin-postgresql-', 'pg-schema.sql'),
               ('nacos-datasource-plugin-dm-', 'dameng-schema.sql')]
    for prefix, schema in schemas:
        jars = list((home / 'plugins').glob(prefix + '*.jar'))
        if len(jars) != 1:
            raise ValueError('Expected exactly one plugin for ' + prefix)
        with zipfile.ZipFile(jars[0]) as jar:
            sql = jar.read('META-INF/' + schema).decode('utf-8')
            if schema == 'pg-schema.sql':
                sql = re.sub(r'(?im)^[ \t]*DROP TABLE IF EXISTS \"[^\"]+\"[ \t]*;[ \t]*$', '', sql)
            (home / 'conf' / schema).write_text(sql)
    sources = sorted((template / 'java').rglob('*.java'))
    if not sources:
        raise ValueError('Missing schema initializer sources')
    with tempfile.TemporaryDirectory(prefix='cf-schema-init-') as work:
        classes = Path(work) / 'classes'
        classes.mkdir()
        subprocess.run(['javac', '--release', '17', '-d', str(classes)] +
                       [str(source) for source in sources], check=True)
        subprocess.run(['jar', '--create', '--file', str((home / 'bin/schema-init.jar').resolve()),
                        '-C', str(classes), '.'], check=True)
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
    parser.add_argument('--variant', choices=['unified'], default='unified')
    parser.add_argument('--dm-plugin', type=Path)
    parser.add_argument('--dm-driver', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.server_jar, args.release_dir, args.output, args.variant, args.dm_plugin, args.dm_driver)))
