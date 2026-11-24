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
case "${MODE}" in
  standalone) standalone=true ;;
  cluster) standalone=false ;;
  *) echo "MODE must be standalone or cluster" >&2; exit 2 ;;
esac
case "${DEPLOYMENT}" in
  merged|server|console) ;;
  *) echo "DEPLOYMENT must be merged, server or console" >&2; exit 2 ;;
esac
if [ -f "${NACOS_HOME}/conf/dameng.properties" ]; then
  : "${DM_URL:?Set DM_URL to the Dameng JDBC URL}"
  : "${DM_USER:?Set DM_USER to the dedicated Nacos database user}"
  : "${DM_PASSWORD:?Set DM_PASSWORD to its password}"
fi
# JAVA_OPTS intentionally accepts whitespace-separated JVM options, never eval.
exec java ${JAVA_OPTS} \
  --add-opens=java.base/java.lang=ALL-UNNAMED \
  --add-opens=java.base/java.lang.reflect=ALL-UNNAMED \
  --add-opens=java.base/java.util=ALL-UNNAMED \
  "-Dnacos.home=${NACOS_HOME}" "-Dloader.path=${NACOS_HOME}/plugins" \
  "-Dnacos.standalone=${standalone}" "-Dnacos.deployment.type=${DEPLOYMENT}" \
  -jar "${NACOS_HOME}/target/nacos-server.jar" \
  "--spring.config.additional-location=file:${NACOS_HOME}/conf/" \
  "--logging.config=${NACOS_HOME}/conf/nacos-logback.xml" "$@"
