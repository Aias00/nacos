#!/usr/bin/env python3
# Copyright 1999-2026 Alibaba Group Holding Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software is distributed
# on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
# See the License for the specific language governing permissions and limitations.
"""Disposable real-container checks for startup import, preservation and termination."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile


def run(image, output):
    output.mkdir(parents=True, exist_ok=True)
    suffix = secrets.token_hex(4)
    names, volumes, checks = [], [], []
    identity = secrets.token_hex(24)
    password = 'Import-' + secrets.token_hex(18) + '!'
    env = {'NACOS_AUTH_IDENTITY_KEY': 'import-test-identity',
           'NACOS_AUTH_IDENTITY_VALUE': identity,
           'NACOS_AUTH_TOKEN': base64.b64encode(os.urandom(48)).decode()}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def docker(args, data=None, check=True):
        result = subprocess.run(['docker'] + args, input=data, capture_output=True, text=True)
        if check and result.returncode:
            raise AssertionError('Docker operation failed: ' + args[0] + ' (' + str(result.returncode) + ')')
        return result

    def container_logs(name):
        result = docker(['logs', name])
        return result.stdout + result.stderr

    def api(path, params=None, method='GET'):
        url = 'http://127.0.0.1:18886/nacos' + path
        data = urllib.parse.urlencode(params or {}).encode() if method == 'POST' else None
        if params and data is None:
            url += '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, data=data, method=method,
                                        headers={'import-test-identity': identity})
        with opener.open(request, timeout=5) as response:
            value = json.load(response)
        if 'code' in value:
            assert value['code'] == 0, 'API rejected ' + path
            return value.get('data')
        return value

    def wait(callback, seconds=120):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                value = callback()
                if value:
                    return value
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(0.3)
        raise AssertionError('Container condition timed out')

    with tempfile.TemporaryDirectory(prefix='.cf-import-e2e-', dir=Path(__file__).resolve().parents[4]) as work:
        fixture = Path(work)
        source = fixture / 'admin-password'
        initial = 'feature:\n  name: 中文\n  value: "$(not-executed)"\nlast: visible'
        source.write_text(initial)
        manual = fixture / 'manual.yaml'
        manual.write_text('manual: true\n')
        archive = fixture / 'configs.zip'
        with zipfile.ZipFile(archive, 'w') as package:
            package.writestr('.metadata.yml', json.dumps({'metadata': [
                {'group': 'ZIP_GROUP', 'dataId': 'zip.yaml', 'type': 'yaml', 'appName': '', 'desc': ''},
                {'group': 'ZIP_GROUP', 'dataId': 'second.properties', 'type': 'properties', 'appName': '', 'desc': ''}]}))
            package.writestr('ZIP_GROUP/zip.yaml', 'zip: original\n')
            package.writestr('ZIP_GROUP/second.properties', 'enabled=true\n')
        malformed = fixture / 'broken.zip'
        malformed.write_bytes(b'not a zip')
        for path in fixture.iterdir():
            path.chmod(0o644)
        fixture.chmod(0o755)

        def start(label, extra, volume=None):
            name = 'cf-import-' + label + '-' + suffix
            if volume is None:
                volume = 'cf-import-' + label + '-data-' + suffix
                volumes.append(volume)
            names.append(name)
            command = ['run', '-d', '--name', name, '-p', '127.0.0.1:18886:8848',
                       '-p', '127.0.0.1:18102:8080', '-v', str(fixture) + ':/imports:ro',
                       '-v', volume + ':/opt/nacos/data']
            for key, value in {**env, **extra}.items():
                command += ['-e', key + '=' + value]
            docker(command + [image])
            return name, volume

        def completed(name):
            value = json.loads(docker(['inspect', name]).stdout)[0]
            if not value['State']['Running']:
                raise AssertionError('Import container exited before success')
            return (docker(['exec', name, 'test', '-f', '/tmp/cf-server-import-ready'], check=False).returncode == 0
                    and api('/v3/admin/core/state/readiness') == 'ok')

        def config(data_id, group='DEFAULT_GROUP'):
            return api('/v3/admin/cs/config', {'namespaceId': 'public', 'groupName': group, 'dataId': data_id})

        try:
            name, volume = start('single', {'CF_INIT_CONFIG_FILE': '/imports/admin-password',
                                           'CF_INIT_DATA_ID': 'application.yaml', 'CF_INIT_TYPE': 'yaml',
                                           'CF_INIT_OVERWRITE': 'true', 'CF_INIT_ADMIN_PASSWORD': password})
            wait(lambda: completed(name))
            assert config('application.yaml')['content'] == initial
            assert docker(['exec', name, '/opt/nacos/bin/healthcheck.sh']).returncode == 0
            logs = container_logs(name)
            assert password not in logs
            api('/v3/admin/cs/config', {'namespaceId': 'public', 'groupName': 'DEFAULT_GROUP',
                                      'dataId': 'application.yaml', 'content': 'changed: manually', 'type': 'yaml'}, 'POST')
            docker(['restart', name])
            wait(lambda: completed(name))
            assert config('application.yaml')['content'] == 'changed: manually'
            assert 'already completed' in container_logs(name)
            source.write_text('changed: source-file\n')
            docker(['restart', name])
            wait(lambda: completed(name))
            assert config('application.yaml')['content'] == 'changed: source-file\n'
            checks.append('single file raw content, snapshot name collision, restart skip and changed-file overwrite')
            docker(['stop', name])

            name, _ = start('zip', {'CF_INIT_CONFIG_FILE': '/imports/configs.zip', 'CF_INIT_ADMIN_PASSWORD': password})
            wait(lambda: completed(name))
            assert config('zip.yaml', 'ZIP_GROUP')['content'] == 'zip: original\n'
            assert config('second.properties', 'ZIP_GROUP')['content'] == 'enabled=true\n'
            docker(['exec', '-i', name, 'sh', '-c', 'umask 077; cat > /tmp/cli-password'], data=password)
            cli = ['exec', '-e', 'CF_USERNAME=nacos', '-e', 'CF_PASSWORD_FILE=/tmp/cli-password', name,
                   'cf-server', 'config', 'import', '/imports/manual.yaml', '--group', 'ZIP_GROUP', '--data-id', 'zip.yaml']
            result = json.loads(docker(cli).stdout)
            assert result['skipped'] == 1 and result['imported'] == 0
            assert config('zip.yaml', 'ZIP_GROUP')['content'] == 'zip: original\n'
            result = json.loads(docker(cli + ['--overwrite']).stdout)
            assert result['imported'] == 1
            assert config('zip.yaml', 'ZIP_GROUP')['content'] == 'manual: true\n'
            checks.append('native ZIP startup and in-container CLI atomic skip/overwrite')
            docker(['stop', name])

            name, volume = start('invalid', {'CF_INIT_CONFIG_FILE': '/imports/broken.zip', 'CF_INIT_ADMIN_PASSWORD': password})
            wait(lambda: not json.loads(docker(['inspect', name]).stdout)[0]['State']['Running'])
            state = json.loads(docker(['inspect', name]).stdout)[0]['State']
            assert state['ExitCode'] != 0
            assert 'Initialization import failed' in container_logs(name)
            docker(['run', '--rm', '--entrypoint', 'sh', '-v', volume + ':/testdata', image, '-c', 'test -z "$(find /testdata/init-import -name \"*.done\" -print -quit 2>/dev/null)"'])
            checks.append('invalid archive aborts startup and Java without a completion marker')

            name, volume = start('blank', {'CF_INIT_CONFIG_FILE': '/imports/configs.zip', 'CF_INIT_ADMIN_PASSWORD': ' \t\n\x1c'})
            wait(lambda: not json.loads(docker(['inspect', name]).stdout)[0]['State']['Running'])
            assert json.loads(docker(['inspect', name]).stdout)[0]['State']['ExitCode'] != 0
            assert 'must not be blank' in container_logs(name)
            probe, _ = start('blank-probe', {}, volume=volume)
            wait(lambda: api('/v3/admin/core/state/readiness') == 'ok')
            # A success here proves the blank-password run did not create an unknown administrator.
            admin = api('/v3/auth/user/admin', {'password': password}, 'POST')
            assert admin['username'] == 'nacos'
            checks.append('blank bootstrap password rejected without creating a random administrator')
            docker(['stop', probe])

            name, _ = start('signal', {'CF_INIT_CONFIG_FILE': '/imports/configs.zip', 'CF_INIT_ADMIN_PASSWORD': password})
            time.sleep(0.5)
            before = time.monotonic()
            docker(['stop', '--time', '5', name])
            assert time.monotonic() - before < 8
            assert json.loads(docker(['inspect', name]).stdout)[0]['State']['ExitCode'] != 137
            checks.append('termination during initialization stops Java without forced kill')
        except Exception:
            for name in names:
                result = docker(['logs', name], check=False)
                path = output / (name + '.log')
                path.write_text(result.stdout + result.stderr)
                path.chmod(0o600)
            raise
        finally:
            for name in names:
                docker(['rm', '-f', name], check=False)
            for volume in volumes:
                docker(['volume', 'rm', volume], check=False)
    report = {'passed': True, 'checks': checks}
    (output / 'result.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--output', type=Path, default=Path('/tmp/cf-startup-import-e2e'))
    args = parser.parse_args()
    run(args.image, args.output)
