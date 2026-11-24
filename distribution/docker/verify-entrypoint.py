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
"""Verify conflicting datasource settings fail before any JDBC/server startup."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path


def verify(image):
    base = ['docker', 'run', '--rm', '-e', 'DB_TYPE=mysql',
            '-e', 'DB_URL=jdbc:mysql://unreachable.invalid/cf', '-e', 'DB_USER=test',
            '-e', 'DB_PASSWORD=do-not-log-this-sentinel']
    cases = [
        (['-e', 'NACOS_PLUGIN_DATASOURCE_DB_URL_0=jdbc:mysql://other.invalid/other'], []),
        (['-e', 'SPRING_APPLICATION_JSON={"db":{"user":"other"}}'], []),
        (['-e', 'JAVA_OPTS=-Ddb.url.0=jdbc:mysql://other.invalid/other'], []),
        (['-e', 'JAVA_TOOL_OPTIONS=-Dnacos.plugin.datasource.db.pool.config.schema=other'], []),
        (['-e', 'JDK_JAVA_OPTIONS=@/tmp/other.options'], []),
        ([], ['--db.url.0=jdbc:mysql://other.invalid/other']),
        ([], ['--spring.application.json={"db":{"user":"other"}}']),
        ([], ['--spring.config.location=/tmp/other.properties']),
    ]
    with tempfile.TemporaryDirectory(prefix='.cf-entrypoint-', dir=Path(__file__).resolve().parents[3]) as work:
        other = Path(work) / 'application.properties'
        other.write_text('nacos.plugin.datasource.db.pool.config.catalog=other\n')
        cases.append((['-v', str(other) + ':/opt/nacos/conf/application.properties:ro'], []))
        cases.append((['-v', str(other) + ':/opt/nacos/conf/datasource.properties:ro'], []))
        for number, (options, args) in enumerate(cases, 1):
            result = subprocess.run(base + options + [image] + args, capture_output=True, text=True)
            output = result.stdout + result.stderr
            assert result.returncode == 2, (number, result.returncode, output)
            assert 'do-not-log-this-sentinel' not in output, 'Credential leaked'
            assert 'Schema initialization complete' not in output
    return {'passed': True, 'conflicting_sources_rejected': len(cases), 'credentials_not_logged': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.image)))
