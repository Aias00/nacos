#!/bin/sh
# Copyright 1999-2026 Alibaba Group Holding Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
set -eu
docker_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "${docker_dir}/../.." && pwd)
classes=$(mktemp -d "${TMPDIR:-/tmp}/cf-schema-tests.XXXXXX")
trap 'rm -rf "$classes"' EXIT HUP INT TERM
javac --release 17 -d "$classes" \
  "$docker_dir/java/cn/dap/cf/SchemaInitializer.java" \
  "$docker_dir/tests/SchemaInitializerTest.java" \
  "$docker_dir/tests/SchemaInitializerJdbcTest.java"
java -ea -cp "$classes" cn.dap.cf.SchemaInitializerTest "$repo_dir"
if [ "${CF_SCHEMA_TEST_DISPOSABLE:-false}" = true ]; then
  : "${CF_SCHEMA_TEST_JDBC_DRIVER:?Set path to the selected JDBC driver JAR}"
  java -ea -cp "$classes:$CF_SCHEMA_TEST_JDBC_DRIVER" cn.dap.cf.SchemaInitializerJdbcTest
fi
