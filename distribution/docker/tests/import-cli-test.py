#!/usr/bin/env python3
# Copyright 1999-2026 Alibaba Group Holding Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software is distributed
# on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
# See the License for the specific language governing permissions and limitations.
"""Exercise the real Shell/curl CLI against a local HTTP server; no live credentials."""
import email.policy
import email.parser
import http.server
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.parse
import zipfile

CLI = Path(__file__).resolve().parents[1] / 'cf-server'
PASSWORD = 'do-not-log-password &$;"雪\n'
TOKEN = 'do-not-log-token.with_under-score'


class ImportCliTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = self.root / 'config ; $(literal).yaml'
        self.content = "key: '中文 & $() ;'\r\nlast: no-trailing-newline".encode()
        self.file.write_bytes(self.content)
        self.calls = []
        self.auth_status = 200
        self.auth_body = {'accessToken': TOKEN}
        self.import_status = 200
        self.import_body = {'code': 0, 'data': {'succCount': 1, 'skipCount': 0}}
        self.drop_import = False
        self.auth_sequence = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                path = urllib.parse.urlsplit(self.path).path
                owner.calls.append((path, body, dict(self.headers)))
                if path.endswith('/login'):
                    status, response = owner.auth_sequence.pop(0) if owner.auth_sequence else (owner.auth_status, owner.auth_body)
                elif path.endswith('/import'):
                    if owner.drop_import:
                        self.connection.close()
                        return
                    status, response = owner.import_status, owner.import_body
                else:
                    status, response = 404, {}
                data = json.dumps(response).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f'http://127.0.0.1:{self.server.server_port}/custom'
        self.env = os.environ.copy()
        for key in list(self.env):
            if key.startswith('CF_'):
                del self.env[key]
        self.env.update(CF_USERNAME='user &"中文', CF_PASSWORD=PASSWORD,
                        NO_PROXY='127.0.0.1', no_proxy='127.0.0.1')

    def run_cli(self, *args, env=None, expected=0):
        result = subprocess.run([str(CLI), 'config', 'import', str(self.file),
                                 '--server', self.base, *args], env=env or self.env,
                                capture_output=True, text=True, errors='replace', timeout=15)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        for secret in [PASSWORD, PASSWORD.strip(), TOKEN, self.content.decode()]:
            self.assertNotIn(secret, result.stdout + result.stderr)
        return result

    def imported(self):
        path, body, headers = self.calls[-1]
        self.assertEqual(path, '/custom/v3/admin/cs/config/import')
        message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
            ('Content-Type: ' + headers['Content-Type'] + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
        parts = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True)
                 for part in message.iter_parts()}
        self.assertEqual(headers['Authorization'], 'Bearer ' + TOKEN)
        with zipfile.ZipFile(io.BytesIO(parts['file']), metadata_encoding='utf-8') as package:
            entries = {name: package.read(name) for name in package.namelist()}
        return parts, entries

    def test_single_file_wraps_metadata_and_preserves_content_and_identifiers(self):
        result = self.run_cli('--namespace', 'space+/中文', '--group', 'GROUP ;$"中文')
        auth = urllib.parse.parse_qs(self.calls[0][1].decode(), keep_blank_values=True)
        self.assertEqual(auth['password'], [PASSWORD])
        self.assertEqual(auth['username'], ['user &"中文'])
        parts, entries = self.imported()
        self.assertEqual(parts['namespaceId'].decode(), 'space+/中文')
        self.assertEqual(parts['policy'], b'SKIP')
        metadata = json.loads(entries['.metadata.yml'])['metadata'][0]
        self.assertEqual(metadata['dataId'], self.file.name)
        self.assertEqual(metadata['group'], 'GROUP ;$"中文')
        self.assertEqual(metadata['type'], 'yaml')
        self.assertEqual(entries[metadata['group'] + '/' + metadata['dataId']], self.content)
        self.assertEqual(json.loads(result.stdout), dict(success=True, imported=1, skipped=0, total=1, policy='SKIP'))

    def test_password_file_is_raw_and_wrapped_login_is_supported(self):
        secret = self.root / 'secret'
        secret.write_bytes(PASSWORD.encode())
        env = self.env.copy()
        del env['CF_PASSWORD']
        env['CF_PASSWORD_FILE'] = str(secret)
        self.auth_body = {'code': 0, 'data': {'accessToken': TOKEN}}
        self.run_cli(env=env)
        auth = urllib.parse.parse_qs(self.calls[0][1].decode(), keep_blank_values=True)
        self.assertEqual(auth['password'], [PASSWORD])

    def test_token_file_and_overwrite_do_not_login(self):
        secret = self.root / 'token'
        secret.write_text(TOKEN + '\n')
        env = self.env.copy()
        env['CF_TOKEN_FILE'] = str(secret)
        self.run_cli('--overwrite', '--data-id', 'renamed.json', '--type', 'json', env=env)
        self.assertEqual(len(self.calls), 1)
        parts, entries = self.imported()
        self.assertEqual(parts['policy'], b'OVERWRITE')
        self.assertEqual(json.loads(entries['.metadata.yml'])['metadata'][0]['type'], 'json')
        self.assertEqual(entries['DEFAULT_GROUP/renamed.json'], self.content)

    def make_zip(self, entries=None):
        self.file = self.root / 'configs.zip'
        with zipfile.ZipFile(self.file, 'w') as package:
            for name, content in (entries or {
                '.metadata.yml': 'metadata:\n- dataId: one.yaml\n  group: CUSTOM\n  type: yaml\n',
                'CUSTOM/one.yaml': self.content,
            }).items():
                package.writestr(name, content)

    def test_native_zip_keeps_packaged_identity_and_skip_is_success(self):
        self.make_zip()
        self.import_body['data'] = {'succCount': 0, 'skipCount': 1, 'skipData': [{'dataId': 'one.yaml'}]}
        result = self.run_cli()
        parts, entries = self.imported()
        self.assertEqual(entries['CUSTOM/one.yaml'], self.content)
        self.assertEqual(json.loads(result.stdout)['skipped'], 1)

    def test_native_zip_rejects_group_override_before_network(self):
        self.make_zip()
        self.run_cli('--group', 'OTHER', expected=2)
        self.assertEqual(self.calls, [])

    def test_non_native_and_unsafe_zip_fail_before_network(self):
        for entries in [{'ONE/config.yaml': 'value'}, {'.metadata.yml': '{}', '../escape': 'value'},
                        {'.metadata.yml': '{}', '.meta.yml': '{}', 'ONE/config.yaml': 'value'}]:
            with self.subTest(entries=list(entries)):
                self.make_zip(entries)
                self.run_cli(expected=2)
                self.assertEqual(self.calls, [])

    def test_single_file_rejects_path_traversal_before_network(self):
        self.run_cli('--group', '..', expected=2)
        self.assertEqual(self.calls, [])
        self.run_cli('--data-id', 'a/b', expected=2)
        self.assertEqual(self.calls, [])
        self.run_cli('--group', 'line\nbreak', expected=2)
        self.assertEqual(self.calls, [])

    def test_http_and_business_auth_errors_hide_server_body(self):
        self.auth_status = 403
        self.auth_body = {'message': PASSWORD, 'accessToken': TOKEN}
        self.run_cli(expected=3)
        self.assertEqual(len(self.calls), 1)
        self.calls.clear()
        self.auth_status = 200
        self.auth_body = {'code': 10001, 'data': PASSWORD}
        self.run_cli(expected=3)
        self.assertEqual(len(self.calls), 1)

    def test_explicit_fresh_account_wait_retries_only_login(self):
        self.auth_sequence = [(403, {'message': 'not cached'}),
                              (200, {'accessToken': TOKEN, 'globalAdmin': False})]
        self.auth_body = {'accessToken': TOKEN, 'globalAdmin': True}
        env = self.env.copy()
        env.update(CF_AUTH_WAIT_SECONDS='4', CF_AUTH_REQUIRE_ADMIN='true')
        self.run_cli(env=env)
        self.assertEqual(len([c for c in self.calls if c[0].endswith('/login')]), 3)
        self.assertEqual(len([c for c in self.calls if c[0].endswith('/import')]), 1)

    def test_authentication_wait_is_bounded_and_no_import_occurs_on_expiry(self):
        self.auth_status = 403
        env = self.env.copy()
        env['CF_AUTH_WAIT_SECONDS'] = '1'
        self.run_cli(env=env, expected=3)
        self.assertGreaterEqual(len(self.calls), 1)
        self.assertFalse(any(c[0].endswith('/import') for c in self.calls))

    def test_import_http_and_business_errors_are_failures(self):
        self.import_status = 403
        self.import_body = {'code': 10001, 'message': PASSWORD}
        self.run_cli(expected=4)
        self.import_status = 200
        self.run_cli(expected=4)

    def test_partial_unrecognized_and_mismatched_counts_fail(self):
        for data in [dict(succCount=1, skipCount=0, unrecognizedCount=1),
                     dict(succCount=1, skipCount=0, failData=[{'dataId': 'bad'}]),
                     dict(succCount=0, skipCount=0), dict(succCount='1', skipCount=0),
                     dict(succCount=1, skipCount=0, failedCount=1)]:
            with self.subTest(data=data):
                self.import_body = {'code': 0, 'data': data}
                self.run_cli(expected=5)

    def test_write_network_error_is_not_retried(self):
        self.drop_import = True
        self.run_cli(expected=6)
        self.assertEqual(len([call for call in self.calls if call[0].endswith('/import')]), 1)

    def test_token_header_injection_is_rejected(self):
        env = self.env.copy()
        env['CF_TOKEN'] = TOKEN + '\nInjected: secret'
        self.run_cli(env=env, expected=3)
        self.assertEqual(self.calls, [])

    def test_invalid_utf8_fails_before_network(self):
        for content in ['中文'.encode('gbk'), b'\x00\x01\xff\xfe', b'truncated: \xe4\xb8']:
            with self.subTest(content=content):
                self.file.write_bytes(content)
                self.run_cli(expected=2)
                self.assertEqual(self.calls, [])

    def test_external_arguments_do_not_contain_credentials_or_token(self):
        tools = self.root / 'tools'
        tools.mkdir()
        arguments = self.root / 'external-arguments'
        for tool in ['curl', 'jq']:
            executable = subprocess.check_output(['sh', '-c', 'command -v ' + tool], text=True).strip()
            wrapper = tools / tool
            wrapper.write_text('#!/bin/sh\nprintf "%s\\n" "$@" >> "$CLI_ARGUMENT_LOG"\nexec "' + executable + '" "$@"\n')
            wrapper.chmod(0o755)
        env = self.env.copy()
        env.update(PATH=str(tools) + os.pathsep + env['PATH'], CLI_ARGUMENT_LOG=str(arguments))
        self.run_cli(env=env)
        logged = arguments.read_text()
        for secret in [PASSWORD.strip(), TOKEN, self.env['CF_USERNAME']]:
            self.assertNotIn(secret, logged)


if __name__ == '__main__':
    unittest.main()
